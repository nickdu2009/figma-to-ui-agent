import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  draftVersions,
  generationRecoveryRecords,
  generationRuns,
  previewSelections,
  publishedVersions,
  releasePointers,
  type DraftVersionRow,
  type GenerationRecoveryRecordRow,
  type GenerationRunRow,
  type PublishedVersionRow,
  type ReleasePointerRow,
} from "../db/schema.ts";
import { isDuplicateEntry } from "./errors.ts";
import type { UnitOfWork } from "./business-action-idempotency-repository.ts";
import {
  toLegacySpecProjection,
  type AppUiBundle,
} from "../application-candidate.ts";
import { DIGEST_VERSION, uiBundleDigest } from "../bundle/digests.ts";

/**
 * 把 JS 值编码为已序列化的 JSON 文档绑定（与 markAwaitingPreview 的
 * serialiseJson 语义一致）：绕开 drizzle mysql JSON encoder 对 null/undefined
 * 的处理；undefined（未提供）抛错，调用方用 encodeOptionalJson 处理可选项。
 */
function encodeJson(value: unknown, field: string) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error(`${field} 必须是可序列化的 JSON 值`);
  }
  return sql`${encoded}`;
}

/** 可选 JSON：undefined/null 返回 undefined（保持列既有 NULL）。 */
function encodeOptionalJson(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  return encodeJson(value, field);
}

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
  | "validation_running"
  | "awaiting_preview"
  | "recovery_pending"
  | "recovery_consumed"
  | "succeeded"
  | "failed"
  | "incomplete";

/** 旧心跳/启动扫描覆盖的开放状态（S3 语义保留）。 */
export const OPEN_RUN_STATUSES: GenerationRunStatus[] = [
  "running",
  "awaiting_preview",
];

/**
 * 设计 §13.2.1 短时开放集合：90 秒陈旧扫描与服务启动扫描只把这三个状态
 * 条件更新为 incomplete；recovery_pending 不受短心跳扫描影响。
 */
export const SHORT_LIVED_OPEN_STATUSES: GenerationRunStatus[] = [
  "running",
  "validation_running",
  "awaiting_preview",
];

export interface CommitPreviewInput {
  runId: string;
  candidateDigest: string;
  uiBundleDigest: string;
  reportDigest: string;
  membershipId?: string;
  now: Date;
}

export type CommitPreviewResult =
  | {
      ok: true;
      draftVersionId: string;
      candidateDigest: string;
      uiBundleDigest: string;
    }
  | {
      ok: false;
      code:
        | "generation_run_not_found"
        | "generation_run_status_invalid"
        | "candidate_digest_mismatch"
        | "report_digest_mismatch"
        | "ui_bundle_digest_mismatch"
        | "candidate_bundle_missing"
        | "candidate_has_fatal_issues";
      message: string;
    };

export type AtomicRecoveryDecisionResult =
  | {
      ok: true;
      replayed: boolean;
      record: GenerationRecoveryRecordRow;
      successorGenerationId: string | null;
    }
  | { ok: false; code: string; message: string };

export interface ReleaseRepository {
  /**
   * Preview Commit（设计 §13.2.1/§13.2.3，计划 S11 动作 6）：
   * 同一事务校验 run/digest/report/result，幂等创建 DraftVersion、
   * 将 GenerationRun 标记为 succeeded，并更新发起者 PreviewSelection。
   */
  commitPreview(input: CommitPreviewInput): Promise<CommitPreviewResult>;
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

  // ---------- DS S2：闭合状态机扩展（设计 §13.2.1） ----------
  /**
   * running → validation_running：完整 Candidate 通过 B0/G0 后，
   * 保存不可变 Bundle、digest 对与迁移边（服务端拥有的 migrationEdge）。
   */
  markValidationRunning(input: {
    runId: string;
    candidateBundle: unknown;
    catalogVersion: string;
    candidateDigest: string;
    uiBundleDigest: string;
    digestVersion: number;
    migrationFromPublishedVersionId: string | null;
    migrationFromSchemaDigest: string;
    migrationToSchemaDigest: string;
    candidateMigrationPlan?: unknown;
    candidateReverseMigrationPlan?: unknown;
    now: Date;
  }): Promise<boolean>;
  /**
   * validation_running → awaiting_preview：完整报告无 fatal，
   * 保存 report/reportDigest/validationIssues/publishBlocked。
   */
  markAwaitingPreviewFromValidation(input: {
    runId: string;
    validationReport: unknown;
    reportDigest: string;
    validationProfileVersion: string;
    validationIssues: unknown;
    publishBlocked: boolean;
    now: Date;
  }): Promise<boolean>;
  /**
   * validation_running → recovery_pending：完整报告含 fatal
   * （RecoveryRecord 由 recovery repository 同事务创建）。
   */
  markRecoveryPending(input: {
    runId: string;
    fatalVisualIssues: unknown;
    validationReport: unknown;
    reportDigest: string;
    validationProfileVersion: string;
    now: Date;
  }): Promise<boolean>;
  /** recovery_pending → recovery_consumed（与 RecoveryRecord 终态同事务）。 */
  markRecoveryConsumed(input: { runId: string; now: Date }): Promise<boolean>;
  /**
   * 锁定 RecoveryRecord 与原 GenerationRun，在一个事务内消费决定、可选创建
   * successor，并推进原 run。调用者不能把这三个事实拆成独立提交。
   */
  consumeRecoveryDecisionAtomically(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
    decision: "repair" | "regenerate" | "keep_current";
    decidedBy: string;
    createdByMembershipId: string;
    successorCorrelationRef?: string;
    now: Date;
  }): Promise<AtomicRecoveryDecisionResult>;
  /**
   * 从指定的短时开放状态 → failed（设计 §13.2.1 合法后继）；
   * 稳定 diagnostics code（不新增 validation_failed 状态）。
   */
  markFailedFrom(input: {
    runId: string;
    from: "running" | "validation_running" | "awaiting_preview";
    diagnostics: unknown;
    now: Date;
  }): Promise<boolean>;
  /**
   * Bundle 草稿创建（设计 §13.2.9）：接口只接受 Bundle，
   * 同一事务内把 bundle.spec 写入旧 spec 列作为只读兼容投影（不独立更新），
   * 并把 run 条件推进为 succeeded。
   */
  createBundleDraftAndMarkSucceeded(input: {
    runId: string;
    bundle: unknown;
    catalogVersion: string;
    validationIssues: unknown;
    publishBlocked: boolean;
    candidateDigest: string;
    uiBundleDigest: string;
    digestVersion: number;
    migrationPlan?: unknown;
    reversePlan?: unknown;
    migrationFromPublishedVersionId: string | null;
    migrationFromSchemaDigest: string;
    migrationToSchemaDigest: string;
    businessSchema: unknown;
    now: Date;
  }): Promise<{ draftVersionId: string } | null>;

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

  async commitPreview(input: CommitPreviewInput): Promise<CommitPreviewResult> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.id, input.runId))
        .limit(1);
      const run = rows[0];
      if (!run) {
        return {
          ok: false,
          code: "generation_run_not_found",
          message: "GenerationRun 不存在",
        };
      }

      // 幂等处理：若已 succeeded，返回既有草稿
      if (run.status === "succeeded") {
        const existingDrafts = await tx
          .select()
          .from(draftVersions)
          .where(eq(draftVersions.generationRunId, run.id))
          .limit(1);
        const existing = existingDrafts[0];
        if (existing) {
          return {
            ok: true,
            draftVersionId: existing.id,
            candidateDigest:
              existing.candidateDigest ?? run.candidateDigest ?? "",
            uiBundleDigest: existing.uiBundleDigest ?? input.uiBundleDigest,
          };
        }
      }

      if (run.status !== "awaiting_preview") {
        return {
          ok: false,
          code: "generation_run_status_invalid",
          message: `run 状态非 awaiting_preview：${run.status}`,
        };
      }

      if (
        run.candidateDigest &&
        run.candidateDigest !== input.candidateDigest
      ) {
        return {
          ok: false,
          code: "candidate_digest_mismatch",
          message: "candidateDigest 与 run 记录不匹配",
        };
      }

      if (run.reportDigest && run.reportDigest !== input.reportDigest) {
        return {
          ok: false,
          code: "report_digest_mismatch",
          message: "reportDigest 与 run 记录不匹配",
        };
      }

      if (!run.candidateBundle) {
        return {
          ok: false,
          code: "candidate_bundle_missing",
          message: "run 缺少 candidateBundle",
        };
      }

      // G1-fatal 不创建草稿
      const fatalIssues = (run.fatalVisualIssues as unknown[]) ?? [];
      if (Array.isArray(fatalIssues) && fatalIssues.length > 0) {
        return {
          ok: false,
          code: "candidate_has_fatal_issues",
          message: "候选包含未恢复的 fatal 视觉问题，禁止创建草稿",
        };
      }

      const bundle = run.candidateBundle as AppUiBundle;
      const calculatedUiBundleDigest = uiBundleDigest(bundle);
      if (calculatedUiBundleDigest !== input.uiBundleDigest) {
        return {
          ok: false,
          code: "ui_bundle_digest_mismatch",
          message: "uiBundleDigest 与 Bundle 计算值不匹配",
        };
      }

      const legacySpec = toLegacySpecProjection(bundle);
      const validationReport = run.validationReport as {
        issues?: unknown[];
      } | null;
      const issues = Array.isArray(validationReport?.issues)
        ? validationReport.issues
        : [];
      const publishBlocked = issues.length > 0;

      const draftId = randomUUID();
      try {
        await tx.insert(draftVersions).values({
          id: draftId,
          appId: run.appId,
          generationRunId: run.id,
          spec: legacySpec,
          businessSchema: run.candidateBusinessSchema,
          bundle: bundle,
          catalogVersion: bundle.catalogVersion ?? "1.0.0",
          validationIssues: issues.length > 0 ? issues : null,
          publishBlocked,
          candidateDigest: run.candidateDigest ?? input.candidateDigest,
          uiBundleDigest: input.uiBundleDigest,
          digestVersion: DIGEST_VERSION,
          // 迁移边由生成 run 固化；Preview Commit 只复制服务端已保存的
          // 计划，绝不接受浏览器或发布路由重新提交的 plan。
          migrationPlan: encodeOptionalJson(
            run.candidateMigrationPlan,
            "candidateMigrationPlan",
          ),
          reversePlan: encodeOptionalJson(
            run.candidateReverseMigrationPlan,
            "candidateReverseMigrationPlan",
          ),
          status: "ready",
          createdAt: input.now,
          revision: 1,
        });
      } catch (error) {
        if (isDuplicateEntry(error)) {
          const existingDrafts = await tx
            .select()
            .from(draftVersions)
            .where(eq(draftVersions.generationRunId, run.id))
            .limit(1);
          const existing = existingDrafts[0];
          if (existing) {
            return {
              ok: true,
              draftVersionId: existing.id,
              candidateDigest:
                existing.candidateDigest ?? run.candidateDigest ?? "",
              uiBundleDigest: existing.uiBundleDigest ?? input.uiBundleDigest,
            };
          }
        }
        throw error;
      }

      await tx
        .update(generationRuns)
        .set({ status: "succeeded", updatedAt: input.now })
        .where(eq(generationRuns.id, run.id));

      if (input.membershipId) {
        await tx
          .insert(previewSelections)
          .values({
            appId: run.appId,
            membershipId: input.membershipId,
            kind: "draft",
            versionId: draftId,
            revision: 1,
            updatedAt: input.now,
          })
          .onDuplicateKeyUpdate({
            set: {
              kind: "draft",
              versionId: draftId,
              revision: 1,
              updatedAt: input.now,
            },
          });
      }

      return {
        ok: true,
        draftVersionId: draftId,
        candidateDigest: run.candidateDigest ?? input.candidateDigest,
        uiBundleDigest: input.uiBundleDigest,
      };
    });
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
      candidateBundle: null,
      catalogVersion: null,
      validationIssues: null,
      fatalVisualIssues: null,
      publishBlocked: null,
      candidateDigest: null,
      uiBundleDigest: null,
      digestVersion: null,
      validationProfileVersion: null,
      validationReport: null,
      reportDigest: null,
      candidateMigrationPlan: null,
      candidateReverseMigrationPlan: null,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: null,
      migrationToSchemaDigest: null,
      brandSourceSnapshot: null,
      generationContextDigest: null,
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
    // Drizzle's mysql JSON update encoder does not accept a JavaScript null
    // value (it dereferences `value.constructor`).  `null` here means that the
    // optional payload was not supplied, so leave the column at the null value
    // installed by createRun instead of serialising a new null parameter.
    const serialiseJson = (value: unknown, field: string) => {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) {
        throw new Error(`${field} 必须是可序列化的 JSON 值`);
      }
      // Bind an already-encoded JSON document. This deliberately avoids the
      // ORM's object-value mapper, whose handling of model-produced optional
      // values has caused the successful Preview to be rejected at persistence.
      return sql`${encoded}`;
    };
    const optionalJson = {
      ...(input.candidateBusinessSchema == null
        ? {}
        : {
            candidateBusinessSchema: serialiseJson(
              input.candidateBusinessSchema,
              "candidateBusinessSchema",
            ),
          }),
      ...(input.diagnostics == null
        ? {}
        : { diagnostics: serialiseJson(input.diagnostics, "diagnostics") }),
    };
    const [result] = await this.db
      .update(generationRuns)
      .set({
        status: "awaiting_preview",
        candidateSpec: serialiseJson(input.candidateSpec, "candidateSpec"),
        ...optionalJson,
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
          inArray(generationRuns.status, SHORT_LIVED_OPEN_STATUSES),
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
          inArray(generationRuns.status, SHORT_LIVED_OPEN_STATUSES),
          lt(generationRuns.lastHeartbeatAt, input.staleBefore),
        ),
      );
    return result.affectedRows;
  }

  async markAllOpenIncomplete(input: { now: Date }): Promise<number> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ status: "incomplete", updatedAt: input.now })
      .where(inArray(generationRuns.status, SHORT_LIVED_OPEN_STATUSES));
    return result.affectedRows;
  }

  // ---------- DS S2：闭合状态机扩展（设计 §13.2.1） ----------

  async markValidationRunning(input: {
    runId: string;
    candidateBundle: unknown;
    catalogVersion: string;
    candidateDigest: string;
    uiBundleDigest: string;
    digestVersion: number;
    migrationFromPublishedVersionId: string | null;
    migrationFromSchemaDigest: string;
    migrationToSchemaDigest: string;
    candidateMigrationPlan?: unknown;
    candidateReverseMigrationPlan?: unknown;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({
        status: "validation_running",
        candidateBundle: encodeJson(input.candidateBundle, "candidateBundle"),
        catalogVersion: input.catalogVersion,
        candidateDigest: input.candidateDigest,
        uiBundleDigest: input.uiBundleDigest,
        digestVersion: input.digestVersion,
        migrationFromPublishedVersionId: input.migrationFromPublishedVersionId,
        migrationFromSchemaDigest: input.migrationFromSchemaDigest,
        migrationToSchemaDigest: input.migrationToSchemaDigest,
        candidateMigrationPlan: encodeOptionalJson(
          input.candidateMigrationPlan,
          "candidateMigrationPlan",
        ),
        candidateReverseMigrationPlan: encodeOptionalJson(
          input.candidateReverseMigrationPlan,
          "candidateReverseMigrationPlan",
        ),
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

  async markAwaitingPreviewFromValidation(input: {
    runId: string;
    validationReport: unknown;
    reportDigest: string;
    validationProfileVersion: string;
    validationIssues: unknown;
    publishBlocked: boolean;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({
        status: "awaiting_preview",
        validationReport: encodeJson(
          input.validationReport,
          "validationReport",
        ),
        reportDigest: input.reportDigest,
        validationProfileVersion: input.validationProfileVersion,
        validationIssues: encodeJson(
          input.validationIssues,
          "validationIssues",
        ),
        publishBlocked: input.publishBlocked,
        lastHeartbeatAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          eq(generationRuns.status, "validation_running"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markRecoveryPending(input: {
    runId: string;
    fatalVisualIssues: unknown;
    validationReport: unknown;
    reportDigest: string;
    validationProfileVersion: string;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({
        status: "recovery_pending",
        fatalVisualIssues: encodeJson(
          input.fatalVisualIssues,
          "fatalVisualIssues",
        ),
        validationReport: encodeJson(
          input.validationReport,
          "validationReport",
        ),
        reportDigest: input.reportDigest,
        validationProfileVersion: input.validationProfileVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          eq(generationRuns.status, "validation_running"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markRecoveryConsumed(input: {
    runId: string;
    now: Date;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(generationRuns)
      .set({ status: "recovery_consumed", updatedAt: input.now })
      .where(
        and(
          eq(generationRuns.id, input.runId),
          eq(generationRuns.status, "recovery_pending"),
        ),
      );
    return result.affectedRows === 1;
  }

  async consumeRecoveryDecisionAtomically(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
    decision: "repair" | "regenerate" | "keep_current";
    decidedBy: string;
    createdByMembershipId: string;
    successorCorrelationRef?: string;
    now: Date;
  }): Promise<AtomicRecoveryDecisionResult> {
    const needsSuccessor = input.decision !== "keep_current";
    if (needsSuccessor !== Boolean(input.successorCorrelationRef)) {
      return {
        ok: false,
        code: "recovery_successor_invalid",
        message: "恢复决定与 successor 关联不一致",
      };
    }
    return this.db.transaction(async (tx) => {
      const recordRows = await tx
        .select()
        .from(generationRecoveryRecords)
        .where(
          and(
            eq(generationRecoveryRecords.appId, input.appId),
            eq(
              generationRecoveryRecords.failedGenerationId,
              input.failedGenerationId,
            ),
            eq(
              generationRecoveryRecords.failedCandidateDigest,
              input.failedCandidateDigest,
            ),
          ),
        )
        .limit(1)
        .for("update");
      const record = recordRows[0];
      if (!record) {
        return {
          ok: false as const,
          code: "recovery_record_not_found",
          message: "RecoveryRecord 不存在",
        };
      }
      if (record.status === "consumed") {
        if (record.decision === input.decision) {
          return {
            ok: true as const,
            replayed: true,
            record,
            successorGenerationId: record.successorGenerationId,
          };
        }
        return {
          ok: false as const,
          code: "recovery_decision_already_consumed",
          message: "恢复决定已被消费为不同决定",
        };
      }
      if (record.status !== "pending") {
        return {
          ok: false as const,
          code: "recovery_decision_already_consumed",
          message: "恢复决定已过期",
        };
      }

      const runRows = await tx
        .select()
        .from(generationRuns)
        .where(
          and(
            eq(generationRuns.id, input.failedGenerationId),
            eq(generationRuns.appId, input.appId),
          ),
        )
        .limit(1)
        .for("update");
      const run = runRows[0];
      if (!run || run.status !== "recovery_pending") {
        return {
          ok: false as const,
          code: "generation_run_status_invalid",
          message: "GenerationRun 不处于 recovery_pending",
        };
      }
      if (
        input.decision === "repair" &&
        run.correlationRef?.startsWith("repair-")
      ) {
        return {
          ok: false as const,
          code: "repair_chain_limit_exceeded",
          message: "该候选已是修复运行结果，禁止连续再次修复",
        };
      }

      // 数据库时间是到期决策的唯一裁判；在锁内再次 CAS，避免读取后到期。
      const successorId = needsSuccessor ? randomUUID() : null;
      const [consumed] = await tx
        .update(generationRecoveryRecords)
        .set({
          status: "consumed",
          decision: input.decision,
          decidedBy: input.decidedBy,
          decidedAt: sql`UTC_TIMESTAMP(3)`,
          successorGenerationId: successorId,
          revision: sql`revision + 1`,
        })
        .where(
          and(
            eq(generationRecoveryRecords.id, record.id),
            eq(generationRecoveryRecords.status, "pending"),
            sql`${generationRecoveryRecords.decisionExpiresAt} > UTC_TIMESTAMP(3)`,
          ),
        );
      if (consumed.affectedRows !== 1) {
        return {
          ok: false as const,
          code: "recovery_decision_already_consumed",
          message: "恢复决定已过期或被并发消费",
        };
      }
      if (successorId) {
        await tx.insert(generationRuns).values({
          id: successorId,
          appId: input.appId,
          status: "running",
          correlationRef: input.successorCorrelationRef!,
          createdByMembershipId: input.createdByMembershipId,
          createdAt: input.now,
          updatedAt: input.now,
          revision: 1,
        });
      }
      const [runUpdated] = await tx
        .update(generationRuns)
        .set({ status: "recovery_consumed", updatedAt: input.now })
        .where(
          and(
            eq(generationRuns.id, run.id),
            eq(generationRuns.status, "recovery_pending"),
          ),
        );
      if (runUpdated.affectedRows !== 1) {
        throw new Error("RecoveryRecord 已消费但原 GenerationRun 未推进");
      }
      const updatedRows = await tx
        .select()
        .from(generationRecoveryRecords)
        .where(eq(generationRecoveryRecords.id, record.id))
        .limit(1);
      const updated = updatedRows[0];
      if (!updated) throw new Error("RecoveryRecord 消费后读取失败");
      return {
        ok: true as const,
        replayed: false,
        record: updated,
        successorGenerationId: successorId,
      };
    });
  }

  async markFailedFrom(input: {
    runId: string;
    from: "running" | "validation_running" | "awaiting_preview";
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
          eq(generationRuns.status, input.from),
        ),
      );
    return result.affectedRows === 1;
  }

  async createBundleDraftAndMarkSucceeded(input: {
    runId: string;
    bundle: unknown;
    catalogVersion: string;
    validationIssues: unknown;
    publishBlocked: boolean;
    candidateDigest: string;
    uiBundleDigest: string;
    digestVersion: number;
    migrationPlan?: unknown;
    reversePlan?: unknown;
    migrationFromPublishedVersionId: string | null;
    migrationFromSchemaDigest: string;
    migrationToSchemaDigest: string;
    businessSchema: unknown;
    now: Date;
  }): Promise<{ draftVersionId: string } | null> {
    // 接口只接受 Bundle；同一事务派生 spec 只读兼容投影（设计 §13.2.9）。
    const bundle = input.bundle;
    if (
      bundle === null ||
      typeof bundle !== "object" ||
      !("spec" in bundle) ||
      (bundle as { spec: unknown }).spec == null
    ) {
      throw new Error("Bundle 缺少 spec，无法派生兼容投影");
    }
    const specProjection = (bundle as { spec: unknown }).spec;
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
      if (!run) throw new Error("run 不存在，无法创建草稿");
      const draftId = randomUUID();
      try {
        await tx.insert(draftVersions).values({
          id: draftId,
          appId: run.appId,
          generationRunId: run.id,
          spec: encodeJson(specProjection, "spec"),
          businessSchema:
            encodeOptionalJson(input.businessSchema, "businessSchema") ?? null,
          status: "ready",
          bundle: encodeJson(bundle, "bundle"),
          catalogVersion: input.catalogVersion,
          validationIssues: encodeJson(
            input.validationIssues,
            "validationIssues",
          ),
          publishBlocked: input.publishBlocked,
          candidateDigest: input.candidateDigest,
          uiBundleDigest: input.uiBundleDigest,
          digestVersion: input.digestVersion,
          migrationPlan:
            encodeOptionalJson(input.migrationPlan, "migrationPlan") ?? null,
          reversePlan:
            encodeOptionalJson(input.reversePlan, "reversePlan") ?? null,
          migrationFromPublishedVersionId:
            input.migrationFromPublishedVersionId,
          migrationFromSchemaDigest: input.migrationFromSchemaDigest,
          migrationToSchemaDigest: input.migrationToSchemaDigest,
          createdAt: input.now,
          revision: 1,
        });
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new Error("草稿已存在（重复提交）", { cause: error });
        }
        throw error;
      }
      return { draftVersionId: draftId };
    });
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

  /**
   * S8 UoW 原语：调用方事务内 FOR UPDATE 锁定 ReleasePointer（固定锁序第一环：
   * ReleasePointer → ledger → 业务记录）。
   */
  async lockReleasePointerInTransaction(
    tx: UnitOfWork,
    appId: string,
  ): Promise<ReleasePointerRow | null> {
    const rows = await tx
      .select()
      .from(releasePointers)
      .where(eq(releasePointers.appId, appId))
      .limit(1)
      .for("update");
    return rows[0] ?? null;
  }

  /** S8 UoW 原语：调用方事务内读取 PublishedVersion（同事务快照）。 */
  async findPublishedVersionByIdInTransaction(
    tx: UnitOfWork,
    id: string,
  ): Promise<PublishedVersionRow | null> {
    const rows = await tx
      .select()
      .from(publishedVersions)
      .where(eq(publishedVersions.id, id))
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
      if (draft.publishBlocked) {
        throw new Error("草稿包含阻塞性质量问题，禁止发布", {
          cause: { code: "publish_blocked" },
        });
      }
      const publishedVersionId = randomUUID();
      await tx.insert(publishedVersions).values({
        id: publishedVersionId,
        appId: input.appId,
        draftVersionId: draft.id,
        spec: draft.spec,
        businessSchema: draft.businessSchema,
        // DS S2：Bundle 草稿发布时随版本保存相同的 Bundle/digest/迁移边
        bundle: draft.bundle,
        catalogVersion: draft.catalogVersion,
        candidateDigest: draft.candidateDigest,
        uiBundleDigest: draft.uiBundleDigest,
        digestVersion: draft.digestVersion,
        migrationFromPublishedVersionId: draft.migrationFromPublishedVersionId,
        migrationFromSchemaDigest: draft.migrationFromSchemaDigest,
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
