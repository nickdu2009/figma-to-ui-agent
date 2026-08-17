import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  draftVersions,
  generationRuns,
  publishedVersions,
  releasePointers,
  type DraftVersionRow,
  type GenerationRunRow,
  type PublishedVersionRow,
  type ReleasePointerRow,
} from "../db/schema.ts";
import { isDuplicateEntry } from "./errors.ts";

/**
 * ReleaseRepository（S3 部分）：GenerationRun 生命周期的唯一事实 owner。
 * S4 在此扩展 DraftVersion / PublishedVersion / 剪枝。
 *
 * 语义（设计 §4.2、AC8/AC11/AC14）：
 * - running → awaiting_preview：仅当服务端 Catalog/Spec 校验通过，
 *   保存完整候选 Spec/业务 Schema/有界诊断（不是草稿）；
 * - awaiting_preview → succeeded/failed：仅由匹配的浏览器 apply 结果推进；
 * - running/awaiting_preview → incomplete：心跳超时（90s）、流中止、
 *   浏览器刷新或服务启动扫描；不恢复、不重放；
 * - 所有状态推进均为条件更新（当前状态匹配才写入），迟到/重复结果
 *   因条件不命中被拒绝（fail-closed）。
 */

export type GenerationRunStatus =
  | "running"
  | "awaiting_preview"
  | "succeeded"
  | "failed"
  | "incomplete";

export const OPEN_RUN_STATUSES: GenerationRunStatus[] = [
  "running",
  "awaiting_preview",
];

export interface ReleaseRepository {
  createRun(input: {
    appId: string;
    createdByMembershipId: string;
    correlationRef: string;
  }): Promise<GenerationRunRow>;
  findRunById(id: string): Promise<GenerationRunRow | null>;
  /** 按流水线 generationId 定位 run（心跳/apply 结果的关联入口）。 */
  findRunByCorrelationRef(
    correlationRef: string,
  ): Promise<GenerationRunRow | null>;
  /**
   * 原子完成（设计 §4.2）：仅当 run 处于 awaiting_preview 时，
   * 同事务创建 DraftVersion 并把 run 转为 succeeded。
   * 返回 null 表示迟到/重复/错配（fail-closed，不产生草稿）。
   */
  createDraftAndMarkSucceeded(input: {
    runId: string;
    now: Date;
  }): Promise<{ draftVersionId: string } | null>;
  listRuns(appId: string): Promise<GenerationRunRow[]>;
  /** 浏览器心跳续约：仅当 run 仍处于开放状态时更新 lastHeartbeatAt。 */
  heartbeatRun(input: { runId: string; now: Date }): Promise<boolean>;
  /** running → awaiting_preview：保存完整候选与有界诊断。 */
  markAwaitingPreview(input: {
    runId: string;
    candidateSpec: unknown;
    candidateBusinessSchema: unknown;
    diagnostics: unknown;
    now: Date;
  }): Promise<boolean>;
  /**
   * awaiting_preview → succeeded：仅匹配的 committed 结果可推进；
   * 草稿创建在同一事务由 S4 的发布服务完成。
   */
  markSucceeded(input: { runId: string; now: Date }): Promise<boolean>;
  /** awaiting_preview → failed：浏览器 failed/aborted 结果，存有界诊断。 */
  markFailed(input: {
    runId: string;
    diagnostics: unknown;
    now: Date;
  }): Promise<boolean>;
  /** 开放状态 → incomplete（单个，条件更新）。 */
  markIncomplete(input: { runId: string; now: Date }): Promise<boolean>;
  /** 心跳超时扫描：lastHeartbeatAt 早于 staleBefore 的开放 run 全部 incomplete。 */
  markStaleIncomplete(input: { staleBefore: Date; now: Date }): Promise<number>;
  /** 启动扫描：所有开放 run 原子标记 incomplete（不恢复、不重放）。 */
  markAllOpenIncomplete(input: { now: Date }): Promise<number>;

  // ---------- S4：草稿 / 发布 / 回滚 / 剪枝 ----------
  listDrafts(appId: string): Promise<DraftVersionRow[]>;
  findDraftById(id: string): Promise<DraftVersionRow | null>;
  getReleasePointer(appId: string): Promise<ReleasePointerRow | null>;
  findPublishedVersionById(id: string): Promise<PublishedVersionRow | null>;
  /** publishedAt desc。 */
  listPublishedVersions(appId: string): Promise<PublishedVersionRow[]>;
  /**
   * 原子发布（设计 §4.2）：同事务创建不可变 PublishedVersion 并移动
   * ReleasePointer；草稿不可变（ready 终态），重复发布产生新版本是允许的，
   * 但同一草稿重复发布由服务层以幂等键拒绝。
   */
  publishDraft(input: {
    appId: string;
    draftId: string;
    publishedByMembershipId: string;
    now: Date;
  }): Promise<{ publishedVersionId: string }>;
  /** 回滚：仅移动 ReleasePointer 到同应用的既有版本。 */
  rollbackPointer(input: {
    appId: string;
    publishedVersionId: string;
    now: Date;
  }): Promise<boolean>;
  /** 剪枝：删除 keepIds 之外的本应用发布版本（有界、幂等）。 */
  prunePublishedVersions(input: {
    appId: string;
    keepIds: string[];
  }): Promise<number>;
}

export class MysqlReleaseRepository implements ReleaseRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async createRun(input: {
    appId: string;
    createdByMembershipId: string;
    correlationRef: string;
  }): Promise<GenerationRunRow> {
    const now = new Date();
    const row: GenerationRunRow = {
      id: randomUUID(),
      appId: input.appId,
      status: "running",
      correlationRef: input.correlationRef,
      candidateSpec: null,
      candidateBusinessSchema: null,
      diagnostics: null,
      lastHeartbeatAt: now,
      createdByMembershipId: input.createdByMembershipId,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    try {
      await this.db.insert(generationRuns).values(row);
      return row;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        // correlationRef 唯一约束：同 generationId 重复 startRun 幂等，
        // 返回既有行（工具重试/重复调用不产生第二行）。
        const existing = await this.findRunByCorrelationRef(
          input.correlationRef,
        );
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findRunById(id: string): Promise<GenerationRunRow | null> {
    const rows = await this.db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findRunByCorrelationRef(
    correlationRef: string,
  ): Promise<GenerationRunRow | null> {
    const rows = await this.db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.correlationRef, correlationRef))
      .limit(1);
    return rows[0] ?? null;
  }

  async createDraftAndMarkSucceeded(input: {
    runId: string;
    now: Date;
  }): Promise<{ draftVersionId: string } | null> {
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(generationRuns)
        .set({ status: "succeeded", updatedAt: input.now })
        .where(
          and(
            eq(generationRuns.id, input.runId),
            eq(generationRuns.status, "awaiting_preview"),
          ),
        );
      if (updated.affectedRows === 0) return null;
      const rows = await tx
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.id, input.runId))
        .limit(1);
      const run = rows[0];
      if (!run || run.candidateSpec == null) {
        // 数据完整性失败：回滚（草稿不得缺少候选 Spec）
        throw new Error("run 缺少候选 Spec，无法创建草稿");
      }
      const draftId = randomUUID();
      try {
        await tx.insert(draftVersions).values({
          id: draftId,
          appId: run.appId,
          generationRunId: run.id,
          spec: run.candidateSpec,
          businessSchema: run.candidateBusinessSchema,
          status: "ready",
          createdAt: input.now,
          revision: 1,
        });
      } catch (error) {
        if (isDuplicateEntry(error)) {
          // 同一 run 的草稿已存在：视为重复提交，回滚状态推进
          throw new Error("草稿已存在（重复提交）", { cause: error });
        }
        throw error;
      }
      return { draftVersionId: draftId };
    });
  }

  async listRuns(appId: string): Promise<GenerationRunRow[]> {
    return this.db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.appId, appId))
      .orderBy(desc(generationRuns.createdAt));
  }

  async heartbeatRun(input: { runId: string; now: Date }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ lastHeartbeatAt: input.now })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          inArray(generationRuns.status, OPEN_RUN_STATUSES),
        ),
      );
    return result.affectedRows === 1;
  }

  async markAwaitingPreview(input: {
    runId: string;
    candidateSpec: unknown;
    candidateBusinessSchema: unknown;
    diagnostics: unknown;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({
        status: "awaiting_preview",
        candidateSpec: input.candidateSpec,
        candidateBusinessSchema: input.candidateBusinessSchema,
        diagnostics: input.diagnostics,
        lastHeartbeatAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          eq(generationRuns.status, "running"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markSucceeded(input: { runId: string; now: Date }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ status: "succeeded", updatedAt: input.now })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          eq(generationRuns.status, "awaiting_preview"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markFailed(input: {
    runId: string;
    diagnostics: unknown;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({
        status: "failed",
        diagnostics: input.diagnostics,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          eq(generationRuns.status, "awaiting_preview"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markIncomplete(input: { runId: string; now: Date }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ status: "incomplete", updatedAt: input.now })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          inArray(generationRuns.status, OPEN_RUN_STATUSES),
        ),
      );
    return result.affectedRows === 1;
  }

  async markStaleIncomplete(input: {
    staleBefore: Date;
    now: Date;
  }): Promise<number> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ status: "incomplete", updatedAt: input.now })
      .where(
        and(
          inArray(generationRuns.status, OPEN_RUN_STATUSES),
          lt(generationRuns.lastHeartbeatAt, input.staleBefore),
        ),
      );
    return result.affectedRows;
  }

  async markAllOpenIncomplete(input: { now: Date }): Promise<number> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ status: "incomplete", updatedAt: input.now })
      .where(inArray(generationRuns.status, OPEN_RUN_STATUSES));
    return result.affectedRows;
  }

  // ---------- S4：草稿 / 发布 / 回滚 / 剪枝 ----------

  async listDrafts(appId: string): Promise<DraftVersionRow[]> {
    return this.db
      .select()
      .from(draftVersions)
      .where(eq(draftVersions.appId, appId))
      .orderBy(desc(draftVersions.createdAt));
  }

  async findDraftById(id: string): Promise<DraftVersionRow | null> {
    const rows = await this.db
      .select()
      .from(draftVersions)
      .where(eq(draftVersions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async getReleasePointer(appId: string): Promise<ReleasePointerRow | null> {
    const rows = await this.db
      .select()
      .from(releasePointers)
      .where(eq(releasePointers.appId, appId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPublishedVersionById(
    id: string,
  ): Promise<PublishedVersionRow | null> {
    const rows = await this.db
      .select()
      .from(publishedVersions)
      .where(eq(publishedVersions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPublishedVersions(appId: string): Promise<PublishedVersionRow[]> {
    return this.db
      .select()
      .from(publishedVersions)
      .where(eq(publishedVersions.appId, appId))
      .orderBy(desc(publishedVersions.publishedAt));
  }

  async publishDraft(input: {
    appId: string;
    draftId: string;
    publishedByMembershipId: string;
    now: Date;
  }): Promise<{ publishedVersionId: string }> {
    return this.db.transaction(async (tx) => {
      const drafts = await tx
        .select()
        .from(draftVersions)
        .where(
          and(
            eq(draftVersions.id, input.draftId),
            eq(draftVersions.appId, input.appId),
          ),
        )
        .limit(1);
      const draft = drafts[0];
      if (!draft || draft.status !== "ready") {
        throw new Error("草稿不存在或不可发布", { cause: { code: "draft" } });
      }
      const publishedVersionId = randomUUID();
      await tx.insert(publishedVersions).values({
        id: publishedVersionId,
        appId: input.appId,
        draftVersionId: draft.id,
        spec: draft.spec,
        businessSchema: draft.businessSchema,
        publishedByMembershipId: input.publishedByMembershipId,
        publishedAt: input.now,
      });
      await tx
        .insert(releasePointers)
        .values({
          appId: input.appId,
          publishedVersionId,
          updatedAt: input.now,
          revision: 1,
        })
        .onDuplicateKeyUpdate({
          set: { publishedVersionId, updatedAt: input.now },
        });
      return { publishedVersionId };
    });
  }

  async rollbackPointer(input: {
    appId: string;
    publishedVersionId: string;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(releasePointers)
      .set({
        publishedVersionId: input.publishedVersionId,
        updatedAt: input.now,
      })
      .where(eq(releasePointers.appId, input.appId));
    return result.affectedRows === 1;
  }

  async prunePublishedVersions(input: {
    appId: string;
    keepIds: string[];
  }): Promise<number> {
    if (input.keepIds.length === 0) return 0; // fail-closed：不得全删
    const [result] = await this.db
      .delete(publishedVersions)
      .where(
        and(
          eq(publishedVersions.appId, input.appId),
          notInArray(publishedVersions.id, input.keepIds),
        ),
      );
    return result.affectedRows;
  }
}
