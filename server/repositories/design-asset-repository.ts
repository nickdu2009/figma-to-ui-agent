import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  designAssetBlobs,
  designAssetExtractionJobs,
  designAssetExtractions,
  designAssetSources,
  type DesignAssetBlobRow,
  type DesignAssetExtractionJobRow,
  type DesignAssetExtractionRow,
  type DesignAssetSourceRow,
} from "../db/schema.ts";
import { isDuplicateEntry } from "./errors.ts";

/**
 * DesignAsset Repository（设计 §5.4，计划 S2 操作 8-9）：
 * - Blob 元数据按内容哈希去重；正文只存在 VMA_ASSET_ROOT（本表不保存路径）；
 * - source→Blob 外键；ready Extraction 行不可变（拒绝 UPDATE）；
 * - 重新提取新建 extractionId，再以 source 的 CAS 切换 readyExtractionId；
 * - ExtractionJob 状态机 queued/running/succeeded/failed（CHECK 兜底），
 *   lease 领取用条件更新，终态只保存有界稳定错误码/resultExtractionId；
 * - 所有状态推进均为条件更新，lease 以数据库时间判定。
 */
export type DesignAssetBlobKind = "image" | "svg" | "font" | "pdf";
export type DesignAssetSourcePurpose =
  | "brand_guide_pdf"
  | "reference_screenshot"
  | "publishable_source";
export type DesignAssetSourceStatus =
  | "uploaded"
  | "extracting"
  | "ready"
  | "failed"
  | "deleted";
export type ExtractionJobStatus = "queued" | "running" | "succeeded" | "failed";

export class ImmutableExtractionError extends Error {
  readonly code = "extraction_immutable";
  constructor() {
    super("ready Extraction 行不可变（extraction_immutable）");
    this.name = "ImmutableExtractionError";
  }
}

export interface DesignAssetRepository {
  // ---------- Blob ----------
  /** 按内容哈希去重插入；已存在且定义一致时复用（幂等）。 */
  ensureBlob(input: {
    contentHash: string;
    mimeType: string;
    byteLength: number;
    kind: DesignAssetBlobKind;
  }): Promise<DesignAssetBlobRow>;
  findBlob(contentHash: string): Promise<DesignAssetBlobRow | null>;

  // ---------- Source ----------
  /** 只有 Blob 已存在才能提交 source（FK 之外的显式核对）。 */
  createSource(input: {
    appId: string;
    createdByMembershipId: string;
    blobContentHash: string;
    purpose: DesignAssetSourcePurpose;
    displayName: string;
  }): Promise<DesignAssetSourceRow>;
  findSourceById(id: string): Promise<DesignAssetSourceRow | null>;
  listSources(appId: string): Promise<DesignAssetSourceRow[]>;
  /** uploaded → extracting（条件更新）。 */
  markExtracting(input: { sourceId: string }): Promise<boolean>;
  /** extracting → failed（条件更新）。 */
  markExtractionFailed(input: { sourceId: string }): Promise<boolean>;
  /**
   * extracting → ready 并以 CAS 切换 readyExtractionId（同一更新）；
   * 要求 extraction 属于该 source 且为 ready。
   */
  markReadyWithExtraction(input: {
    sourceId: string;
    extractionId: string;
  }): Promise<boolean>;
  /** 显式删除：标记 deleted 进入 7 天恢复窗口（数据库时间）。 */
  markDeleted(input: { sourceId: string }): Promise<boolean>;

  // ---------- Extraction（ready 行不可变） ----------
  createReadyExtraction(input: {
    sourceId: string;
    sourceContentHash: string;
    extractorProfileVersion: string;
    schemaVersion: number;
    structuredSummary: unknown;
    summaryDigest: string;
    byteLength: number;
  }): Promise<DesignAssetExtractionRow>;
  findExtractionById(id: string): Promise<DesignAssetExtractionRow | null>;
  listExtractionsBySource(sourceId: string): Promise<DesignAssetExtractionRow[]>;

  // ---------- ExtractionJob ----------
  enqueueJob(input: {
    appId: string;
    sourceId: string;
    sourceContentHash: string;
    extractorProfileVersion: string;
  }): Promise<DesignAssetExtractionJobRow>;
  findJobById(id: string): Promise<DesignAssetExtractionJobRow | null>;
  /**
   * 领取 lease：只允许 queued → running；一个 CAS 获胜。
   *
   * 已过期的 running job 必须先由 reconciliation 物化为 failed，绝不能被
   * 新 worker 静默重领。否则同一 extraction 会出现两个可能的执行者，且与
   * “不自动重试”的恢复语义冲突。
   */
  claimJob(input: {
    jobId: string;
    leaseOwner: string;
    leaseTtlMs: number;
  }): Promise<boolean>;
  /** running → succeeded（必须 resultExtractionId，lease owner 匹配）。 */
  completeJob(input: {
    jobId: string;
    leaseOwner: string;
    resultExtractionId: string;
  }): Promise<boolean>;
  /** running → failed（只保存有界稳定错误码，lease owner 匹配）。 */
  failJob(input: {
    jobId: string;
    leaseOwner: string;
    stableErrorCode: string;
  }): Promise<boolean>;

  // ---------- worker / reconciliation / GC（S7） ----------
  /** 最老的 queued job（无可用时 null；worker 轮询入口）。 */
  findNextClaimableJob(): Promise<DesignAssetExtractionJobRow | null>;
  /**
   * 成功收尾单事务（计划 S7 动作 3）：创建新 immutable ready Extraction →
   * completeJob（写 resultExtractionId）→ Source CAS 切换 readyExtractionId。
   * 任一 CAS 失败整体回滚；返回 extractionId，失败返回 null。
   */
  completeExtractionTransaction(input: {
    jobId: string;
    leaseOwner: string;
    sourceId: string;
    extraction: {
      sourceContentHash: string;
      extractorProfileVersion: string;
      schemaVersion: number;
      structuredSummary: unknown;
      summaryDigest: string;
      byteLength: number;
    };
  }): Promise<{ extractionId: string } | null>;
  /** running 且 lease 已到期（数据库时间）的 job（reconciliation 扫描）。 */
  findExpiredLeaseJobs(limit: number): Promise<DesignAssetExtractionJobRow[]>;
  /** 过期租约 → failed（仅当仍 running 且到期；reconciliation 专用 CAS）。 */
  failJobByReconciliation(input: {
    jobId: string;
    stableErrorCode: string;
  }): Promise<boolean>;
  /** extracting → failed（仅当无 queued/running job 引用该 source）。 */
  markSourceFailedIfNoActiveJob(input: { sourceId: string }): Promise<boolean>;
  /** app 有效（非 deleted）source 数与引用去重 Blob 合计字节（限额 Gate）。 */
  getAppSourceUsage(appId: string): Promise<{
    sourceCount: number;
    totalBlobBytes: number;
  }>;
  /** 列出全部非 deleted source（GC 权威集合输入）。 */
  listAllActiveSources(limit: number): Promise<DesignAssetSourceRow[]>;
  /** 列出 queued/running job 引用的 sourceId 与 blob hash（GC 保护集）。 */
  listActiveJobBindings(limit: number): Promise<
    Array<{ sourceId: string; sourceContentHash: string }>
  >;
}

export class MysqlDesignAssetRepository implements DesignAssetRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async ensureBlob(input: {
    contentHash: string;
    mimeType: string;
    byteLength: number;
    kind: DesignAssetBlobKind;
  }): Promise<DesignAssetBlobRow> {
    const row: DesignAssetBlobRow = {
      contentHash: input.contentHash,
      mimeType: input.mimeType,
      byteLength: input.byteLength,
      kind: input.kind,
      status: "ready",
      createdAt: new Date(),
    };
    try {
      await this.db.insert(designAssetBlobs).values(row);
      return row;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const existing = await this.findBlob(input.contentHash);
        if (
          existing &&
          existing.mimeType === input.mimeType &&
          existing.byteLength === input.byteLength &&
          existing.kind === input.kind
        ) {
          // GC 保留元数据审计行，因此相同内容重新上传时会复用一条
          // deleted/deleting 元数据。正文已由调用方原子写回，此处把它重新
          // 激活，避免后续 source/read 面看到“有文件但不可读”的脱节状态。
          if (existing.status !== "ready") {
            await this.db
              .update(designAssetBlobs)
              .set({ status: "ready" })
              .where(eq(designAssetBlobs.contentHash, input.contentHash));
            return { ...existing, status: "ready" };
          }
          return existing;
        }
        // 同哈希不同定义：内容寻址矛盾，fail closed
        throw new Error("Blob 内容哈希与元数据不一致", { cause: error });
      }
      throw error;
    }
  }

  async findBlob(contentHash: string): Promise<DesignAssetBlobRow | null> {
    const rows = await this.db
      .select()
      .from(designAssetBlobs)
      .where(eq(designAssetBlobs.contentHash, contentHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async createSource(input: {
    appId: string;
    createdByMembershipId: string;
    blobContentHash: string;
    purpose: DesignAssetSourcePurpose;
    displayName: string;
  }): Promise<DesignAssetSourceRow> {
    const row: DesignAssetSourceRow = {
      id: randomUUID(),
      appId: input.appId,
      createdByMembershipId: input.createdByMembershipId,
      blobContentHash: input.blobContentHash,
      purpose: input.purpose,
      displayName: input.displayName,
      status: "uploaded",
      readyExtractionId: null,
      createdAt: new Date(),
      retentionUntil: null,
      deletedAt: null,
      revision: 1,
    };
    return this.db.transaction(async (tx) => {
      // 与 GC 对 Blob 元数据行使用同一把 FOR UPDATE 锁：GC 已预留/删除的
      // Blob 不能在两阶段复核后又被新 source 引用。
      const blobs = await tx
        .select()
        .from(designAssetBlobs)
        .where(eq(designAssetBlobs.contentHash, input.blobContentHash))
        .limit(1)
        .for("update");
      const blob = blobs[0];
      if (!blob || blob.status !== "ready") {
        throw new Error("Blob 不存在或不可用，不能提交 source（design_asset_blob_missing）");
      }
      await tx.insert(designAssetSources).values(row);
      return row;
    });
  }

  async findSourceById(id: string): Promise<DesignAssetSourceRow | null> {
    const rows = await this.db
      .select()
      .from(designAssetSources)
      .where(eq(designAssetSources.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listSources(appId: string): Promise<DesignAssetSourceRow[]> {
    return this.db
      .select()
      .from(designAssetSources)
      .where(eq(designAssetSources.appId, appId));
  }

  async markExtracting(input: { sourceId: string }): Promise<boolean> {
    const [result] = await this.db
      .update(designAssetSources)
      .set({ status: "extracting", revision: sql`revision + 1` })
      .where(
        and(
          eq(designAssetSources.id, input.sourceId),
          eq(designAssetSources.status, "uploaded"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markExtractionFailed(input: { sourceId: string }): Promise<boolean> {
    const [result] = await this.db
      .update(designAssetSources)
      .set({ status: "failed", revision: sql`revision + 1` })
      .where(
        and(
          eq(designAssetSources.id, input.sourceId),
          eq(designAssetSources.status, "extracting"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markReadyWithExtraction(input: {
    sourceId: string;
    extractionId: string;
  }): Promise<boolean> {
    const extraction = await this.findExtractionById(input.extractionId);
    if (!extraction || extraction.sourceId !== input.sourceId) {
      throw new Error("Extraction 不属于该 source（design_asset_extraction_mismatch）");
    }
    const [result] = await this.db
      .update(designAssetSources)
      .set({
        status: "ready",
        readyExtractionId: input.extractionId,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(designAssetSources.id, input.sourceId),
          eq(designAssetSources.status, "extracting"),
        ),
      );
    return result.affectedRows === 1;
  }

  async markDeleted(input: { sourceId: string }): Promise<boolean> {
    const [result] = await this.db
      .update(designAssetSources)
      .set({
        status: "deleted",
        // 状态闭合约束要求只有 ready 可保留就绪 extraction 指针；删除后
        // 原 extraction 仍保留作审计记录，但 Source 不再暴露它为当前事实。
        readyExtractionId: null,
        deletedAt: sql`UTC_TIMESTAMP(3)`,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(designAssetSources.id, input.sourceId),
          isNull(designAssetSources.deletedAt),
        ),
      );
    return result.affectedRows === 1;
  }

  async createReadyExtraction(input: {
    sourceId: string;
    sourceContentHash: string;
    extractorProfileVersion: string;
    schemaVersion: number;
    structuredSummary: unknown;
    summaryDigest: string;
    byteLength: number;
  }): Promise<DesignAssetExtractionRow> {
    const encoded = JSON.stringify(input.structuredSummary);
    if (encoded === undefined) {
      throw new Error("structuredSummary 必须是可序列化的 JSON 值");
    }
    const row: DesignAssetExtractionRow = {
      id: randomUUID(),
      sourceId: input.sourceId,
      sourceContentHash: input.sourceContentHash,
      extractorProfileVersion: input.extractorProfileVersion,
      schemaVersion: input.schemaVersion,
      structuredSummary: sql`${encoded}` as unknown,
      summaryDigest: input.summaryDigest,
      byteLength: input.byteLength,
      status: "ready",
      createdAt: new Date(),
    };
    await this.db.insert(designAssetExtractions).values(row);
    return row;
  }

  async findExtractionById(
    id: string,
  ): Promise<DesignAssetExtractionRow | null> {
    const rows = await this.db
      .select()
      .from(designAssetExtractions)
      .where(eq(designAssetExtractions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listExtractionsBySource(
    sourceId: string,
  ): Promise<DesignAssetExtractionRow[]> {
    return this.db
      .select()
      .from(designAssetExtractions)
      .where(eq(designAssetExtractions.sourceId, sourceId));
  }

  async enqueueJob(input: {
    appId: string;
    sourceId: string;
    sourceContentHash: string;
    extractorProfileVersion: string;
  }): Promise<DesignAssetExtractionJobRow> {
    const row: DesignAssetExtractionJobRow = {
      id: randomUUID(),
      appId: input.appId,
      sourceId: input.sourceId,
      sourceContentHash: input.sourceContentHash,
      extractorProfileVersion: input.extractorProfileVersion,
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      resultExtractionId: null,
      stableErrorCode: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      revision: 1,
    };
    await this.db.insert(designAssetExtractionJobs).values(row);
    return row;
  }

  async findJobById(id: string): Promise<DesignAssetExtractionJobRow | null> {
    const rows = await this.db
      .select()
      .from(designAssetExtractionJobs)
      .where(eq(designAssetExtractionJobs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async claimJob(input: {
    jobId: string;
    leaseOwner: string;
    leaseTtlMs: number;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(designAssetExtractionJobs)
      .set({
        status: "running",
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: sql`UTC_TIMESTAMP(3) + INTERVAL ${input.leaseTtlMs * 1000} MICROSECOND`,
        startedAt: sql`UTC_TIMESTAMP(3)`,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(designAssetExtractionJobs.id, input.jobId),
          eq(designAssetExtractionJobs.status, "queued"),
        ),
      );
    return result.affectedRows === 1;
  }

  async completeJob(input: {
    jobId: string;
    leaseOwner: string;
    resultExtractionId: string;
  }): Promise<boolean> {
    const [result] = await this.db
      .update(designAssetExtractionJobs)
      .set({
        status: "succeeded",
        resultExtractionId: input.resultExtractionId,
        completedAt: sql`UTC_TIMESTAMP(3)`,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(designAssetExtractionJobs.id, input.jobId),
          eq(designAssetExtractionJobs.status, "running"),
          eq(designAssetExtractionJobs.leaseOwner, input.leaseOwner),
          sql`${designAssetExtractionJobs.leaseExpiresAt} > UTC_TIMESTAMP(3)`,
        ),
      );
    return result.affectedRows === 1;
  }

  async failJob(input: {
    jobId: string;
    leaseOwner: string;
    stableErrorCode: string;
  }): Promise<boolean> {
    if (input.stableErrorCode.length > 64) {
      throw new Error("stableErrorCode 必须有界（≤64 字符）");
    }
    const [result] = await this.db
      .update(designAssetExtractionJobs)
      .set({
        status: "failed",
        stableErrorCode: input.stableErrorCode,
        completedAt: sql`UTC_TIMESTAMP(3)`,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(designAssetExtractionJobs.id, input.jobId),
          eq(designAssetExtractionJobs.status, "running"),
          eq(designAssetExtractionJobs.leaseOwner, input.leaseOwner),
          sql`${designAssetExtractionJobs.leaseExpiresAt} > UTC_TIMESTAMP(3)`,
        ),
      );
    return result.affectedRows === 1;
  }

  async findNextClaimableJob(): Promise<DesignAssetExtractionJobRow | null> {
    const rows = await this.db
      .select()
      .from(designAssetExtractionJobs)
      .where(eq(designAssetExtractionJobs.status, "queued"))
      .orderBy(asc(designAssetExtractionJobs.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async completeExtractionTransaction(input: {
    jobId: string;
    leaseOwner: string;
    sourceId: string;
    extraction: {
      sourceContentHash: string;
      extractorProfileVersion: string;
      schemaVersion: number;
      structuredSummary: unknown;
      summaryDigest: string;
      byteLength: number;
    };
  }): Promise<{ extractionId: string } | null> {
    try {
      return await this.db.transaction(async (tx) => {
        const extractionId = randomUUID();
        await tx.insert(designAssetExtractions).values({
          id: extractionId,
          sourceId: input.sourceId,
          sourceContentHash: input.extraction.sourceContentHash,
          extractorProfileVersion: input.extraction.extractorProfileVersion,
          schemaVersion: input.extraction.schemaVersion,
          structuredSummary: input.extraction.structuredSummary,
          summaryDigest: input.extraction.summaryDigest,
          byteLength: input.extraction.byteLength,
          status: "ready",
          createdAt: sql`UTC_TIMESTAMP(3)`,
        });
        const [jobUpdate] = await tx
          .update(designAssetExtractionJobs)
          .set({
            status: "succeeded",
            resultExtractionId: extractionId,
            completedAt: sql`UTC_TIMESTAMP(3)`,
            revision: sql`revision + 1`,
          })
          .where(
            and(
              eq(designAssetExtractionJobs.id, input.jobId),
              eq(designAssetExtractionJobs.status, "running"),
              eq(designAssetExtractionJobs.leaseOwner, input.leaseOwner),
              sql`${designAssetExtractionJobs.leaseExpiresAt} > UTC_TIMESTAMP(3)`,
            ),
          );
        if (jobUpdate.affectedRows !== 1) {
          throw new ImmutableExtractionError();
        }
        const [sourceUpdate] = await tx
          .update(designAssetSources)
          .set({
            status: "ready",
            readyExtractionId: extractionId,
            revision: sql`revision + 1`,
          })
          .where(
            and(
              eq(designAssetSources.id, input.sourceId),
              eq(designAssetSources.status, "extracting"),
            ),
          );
        if (sourceUpdate.affectedRows !== 1) {
          throw new ImmutableExtractionError();
        }
        return { extractionId };
      });
    } catch {
      return null;
    }
  }

  async findExpiredLeaseJobs(
    limit: number,
  ): Promise<DesignAssetExtractionJobRow[]> {
    return this.db
      .select()
      .from(designAssetExtractionJobs)
      .where(
        and(
          eq(designAssetExtractionJobs.status, "running"),
          sql`${designAssetExtractionJobs.leaseExpiresAt} <= UTC_TIMESTAMP(3)`,
        ),
      )
      .orderBy(asc(designAssetExtractionJobs.leaseExpiresAt))
      .limit(limit);
  }

  async failJobByReconciliation(input: {
    jobId: string;
    stableErrorCode: string;
  }): Promise<boolean> {
    if (input.stableErrorCode.length > 64) {
      throw new Error("stableErrorCode 必须有界（≤64 字符）");
    }
    const [result] = await this.db
      .update(designAssetExtractionJobs)
      .set({
        status: "failed",
        stableErrorCode: input.stableErrorCode,
        completedAt: sql`UTC_TIMESTAMP(3)`,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(designAssetExtractionJobs.id, input.jobId),
          eq(designAssetExtractionJobs.status, "running"),
          sql`${designAssetExtractionJobs.leaseExpiresAt} <= UTC_TIMESTAMP(3)`,
        ),
      );
    return result.affectedRows === 1;
  }

  async markSourceFailedIfNoActiveJob(input: {
    sourceId: string;
  }): Promise<boolean> {
    const active = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(designAssetExtractionJobs)
      .where(
        and(
          eq(designAssetExtractionJobs.sourceId, input.sourceId),
          inArray(designAssetExtractionJobs.status, ["queued", "running"]),
        ),
      );
    if ((active[0]?.count ?? 0) > 0) return false;
    const [result] = await this.db
      .update(designAssetSources)
      .set({ status: "failed", revision: sql`revision + 1` })
      .where(
        and(
          eq(designAssetSources.id, input.sourceId),
          eq(designAssetSources.status, "extracting"),
        ),
      );
    return result.affectedRows === 1;
  }

  async getAppSourceUsage(appId: string): Promise<{
    sourceCount: number;
    totalBlobBytes: number;
  }> {
    const rows = await this.db
      .select({
        sourceCount: sql<number>`count(*)`,
        totalBlobBytes: sql<number>`coalesce(sum(${designAssetBlobs.byteLength}), 0)`,
      })
      .from(designAssetSources)
      .innerJoin(
        designAssetBlobs,
        eq(designAssetBlobs.contentHash, designAssetSources.blobContentHash),
      )
      .where(
        and(
          eq(designAssetSources.appId, appId),
          sql`${designAssetSources.status} <> 'deleted'`,
        ),
      );
    return {
      sourceCount: Number(rows[0]?.sourceCount ?? 0),
      totalBlobBytes: Number(rows[0]?.totalBlobBytes ?? 0),
    };
  }

  async listAllActiveSources(
    limit: number,
  ): Promise<DesignAssetSourceRow[]> {
    return this.db
      .select()
      .from(designAssetSources)
      .where(sql`${designAssetSources.status} <> 'deleted'`)
      .orderBy(asc(designAssetSources.createdAt))
      .limit(limit);
  }

  async listActiveJobBindings(limit: number): Promise<
    Array<{ sourceId: string; sourceContentHash: string }>
  > {
    return this.db
      .select({
        sourceId: designAssetExtractionJobs.sourceId,
        sourceContentHash: designAssetExtractionJobs.sourceContentHash,
      })
      .from(designAssetExtractionJobs)
      .where(inArray(designAssetExtractionJobs.status, ["queued", "running"]))
      .limit(limit);
  }
}
