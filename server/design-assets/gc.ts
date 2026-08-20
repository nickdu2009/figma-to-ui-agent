/**
 * DesignAsset GC（设计 §5.4 L428，计划 S7 动作 8）：
 * - 权威可达集：有效/恢复窗口内 source、非终态提取任务、Draft/Published
 *   版本 Manifest 与 GenerationRun brandSourceSnapshot/AssetManifest；
 * - Extraction 只有在无任何 source readyExtractionId 指向且无 GC 保护
 *   run 快照引用时才可删除（二期摘要表级回收：P0 只标记，不物理删行——
 *   ready 行不可变，历史审计保底 7 天）；
 * - Blob：同一数据库快照标记候选，删除前以新快照二次确认不可达；
 *   引用计数只作加速，不作第二事实；
 * - 每批有界、幂等；删除只针对内容寻址文件（元数据行保留审计）。
 */
import type { Database } from "../persistence/database.ts";
import {
  designAssetBlobs,
  designAssetSources,
  generationRuns,
  draftVersions,
  publishedVersions,
} from "../db/schema.ts";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BlobStore } from "./blob-store.ts";

export interface GcReport {
  candidateBlobs: number;
  deletedBlobs: number;
  keptProtected: number;
}

export interface DesignAssetGc {
  /** 执行一轮有界 GC（幂等；双快照复核）。 */
  collect(now: Date): Promise<GcReport>;
}

interface BundleAssetRef {
  assetId: string;
  contentHash: string;
}

/** 从 Bundle JSON 提取 AssetManifest 引用（缺 bundle/manifest 时为空集）。 */
function bundleAssetHashes(bundleJson: unknown): Set<string> {
  const hashes = new Set<string>();
  if (
    bundleJson === null ||
    typeof bundleJson !== "object" ||
    !("assets" in bundleJson)
  ) {
    return hashes;
  }
  const entries = (bundleJson as { assets?: { entries?: unknown } }).assets
    ?.entries;
  if (!Array.isArray(entries)) return hashes;
  for (const entry of entries) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "contentHash" in entry &&
      typeof (entry as BundleAssetRef).contentHash === "string"
    ) {
      hashes.add((entry as BundleAssetRef).contentHash);
    }
  }
  return hashes;
}

/** 从 GenerationRun brandSourceSnapshot 提取 source 哈希引用。 */
function brandSnapshotHashes(snapshotJson: unknown): Set<string> {
  const hashes = new Set<string>();
  if (!Array.isArray(snapshotJson)) return hashes;
  for (const entry of snapshotJson) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "sourceContentHash" in entry &&
      typeof (entry as { sourceContentHash?: unknown }).sourceContentHash ===
        "string"
    ) {
      hashes.add(
        (entry as { sourceContentHash: string }).sourceContentHash,
      );
    }
  }
  return hashes;
}

export class DefaultDesignAssetGc implements DesignAssetGc {
  private readonly db: Database;
  private readonly blobStore: BlobStore;
  private readonly limits: { maxBlobsPerRun: number };

  constructor(
    db: Database,
    blobStore: BlobStore,
    limits: { maxBlobsPerRun: number },
  ) {
    this.db = db;
    this.blobStore = blobStore;
    this.limits = limits;
  }

  /**
   * 数据库当前快照下的全部受保护内容哈希（单一查询序列组成一致性读；
   * REPEATABLE READ 下同一事务的两阶段查询即构成快照复核边界）。
   */
  private async protectedHashes(tx: Parameters<
    Parameters<Database["transaction"]>[0]
  >[0]): Promise<Set<string>> {
    const protectedSet = new Set<string>();

    // 1) 有效与恢复窗口内 source（非 deleted 全保留：7 天窗口内含 deleted）。
    const sources = await tx
      .select({
        blobContentHash: designAssetSources.blobContentHash,
        status: designAssetSources.status,
      })
      .from(designAssetSources)
      .where(sql`${designAssetSources.status} <> 'deleted'`);
    for (const source of sources) {
      protectedSet.add(source.blobContentHash);
    }

    // deleted 但仍在 7 天恢复窗口内的 source 同样保护。
    const deleted = await tx
      .select({
        blobContentHash: designAssetSources.blobContentHash,
        deletedAt: designAssetSources.deletedAt,
      })
      .from(designAssetSources)
      .where(
        and(
          eq(designAssetSources.status, "deleted"),
          sql`${designAssetSources.deletedAt} >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY`,
        ),
      );
    for (const source of deleted) {
      protectedSet.add(source.blobContentHash);
    }

    // 2) 非终态 run 与终态 7 天审计窗口内的 brandSourceSnapshot + candidate Bundle。
    const runs = await tx
      .select({
        status: generationRuns.status,
        createdAt: generationRuns.createdAt,
        brandSourceSnapshot: generationRuns.brandSourceSnapshot,
        candidateBundle: generationRuns.candidateBundle,
      })
      .from(generationRuns)
      .where(
        sql`${generationRuns.status} NOT IN ('succeeded','failed','incomplete','recovery_consumed') OR ${generationRuns.createdAt} >= UTC_TIMESTAMP(3) - INTERVAL 7 DAY`,
      );
    for (const run of runs) {
      // 查询已由数据库时间限制为非终态或审计窗口内。
      for (const hash of brandSnapshotHashes(run.brandSourceSnapshot)) {
        protectedSet.add(hash);
      }
      for (const hash of bundleAssetHashes(run.candidateBundle)) {
        protectedSet.add(hash);
      }
    }

    // 3) Draft/Published（含回收站版本）的 Bundle Manifest。
    const drafts = await tx
      .select({ bundle: draftVersions.bundle })
      .from(draftVersions);
    for (const draft of drafts) {
      for (const hash of bundleAssetHashes(draft.bundle)) {
        protectedSet.add(hash);
      }
    }
    const published = await tx
      .select({ bundle: publishedVersions.bundle })
      .from(publishedVersions);
    for (const version of published) {
      for (const hash of bundleAssetHashes(version.bundle)) {
        protectedSet.add(hash);
      }
    }

    // 4) 活动（queued/running）提取任务引用。
    const activeJobs = await tx
      .select({
        sourceContentHash:
          sql<string>`source_content_hash`.as("source_content_hash"),
      })
      .from(sql`design_asset_extraction_jobs`)
      .where(sql`status in ('queued','running')`);
    for (const job of activeJobs) {
      protectedSet.add(job.sourceContentHash);
    }

    return protectedSet;
  }

  async collect(_now: Date): Promise<GcReport> {
    const report: GcReport = {
      candidateBlobs: 0,
      deletedBlobs: 0,
      keptProtected: 0,
    };

    // 阶段一（快照 A）：标记候选 —— 元数据存在但不在保护集的 Blob。
    const candidates = await this.db.transaction(async (tx) => {
      const protectedSet = await this.protectedHashes(tx);
      const blobs = await tx
        .select({
          contentHash: designAssetBlobs.contentHash,
        })
        .from(designAssetBlobs)
        .where(eq(designAssetBlobs.status, "ready"))
        .limit(this.limits.maxBlobsPerRun * 4);
      return blobs
        .filter((blob) => !protectedSet.has(blob.contentHash))
        .map((blob) => blob.contentHash);
    });

    report.candidateBlobs = candidates.length;
    if (candidates.length === 0) return report;

    // 阶段二（快照 B）：删除前二次确认不可达（新事务新快照）。
    const confirmed = await this.db.transaction(async (tx) => {
      const protectedSet = await this.protectedHashes(tx);
      const unprotected = candidates
        .filter((hash) => !protectedSet.has(hash))
        .slice(0, this.limits.maxBlobsPerRun);
      if (unprotected.length === 0) return [];
      // 先把元数据从 ready 预留为 deleting；createSource 对同一 Blob 行
      // FOR UPDATE，因而不能在二次复核与实际删除之间新建引用。
      const [updated] = await tx
        .update(designAssetBlobs)
        .set({ status: "deleting" })
        .where(
          and(
            inArray(designAssetBlobs.contentHash, unprotected),
            eq(designAssetBlobs.status, "ready"),
          ),
        );
      if (updated.affectedRows === 0) return [];
      const reserved = await tx
        .select({ contentHash: designAssetBlobs.contentHash })
        .from(designAssetBlobs)
        .where(
          and(
            inArray(designAssetBlobs.contentHash, unprotected),
            eq(designAssetBlobs.status, "deleting"),
          ),
        );
      return reserved.map((row) => row.contentHash);
    });

    for (const hash of confirmed) {
      const hashHex = hash.replace(/^sha256:/, "");
      const relativePath = `sha256/${hashHex.slice(0, 2)}/${hashHex}`;
      try {
        await this.blobStore.remove(relativePath);
        await this.db
          .update(designAssetBlobs)
          .set({ status: "deleted" })
          .where(
            and(
              eq(designAssetBlobs.contentHash, hash),
              eq(designAssetBlobs.status, "deleting"),
            ),
          );
        report.deletedBlobs += 1;
      } catch {
        // 失败不把元数据伪装为可读：只有尚处 deleting 的行才可回 ready，
        // 后续 GC 会再次双快照复核。
        await this.db
          .update(designAssetBlobs)
          .set({ status: "ready" })
          .where(
            and(
              eq(designAssetBlobs.contentHash, hash),
              eq(designAssetBlobs.status, "deleting"),
            ),
          );
      }
    }
    report.keptProtected = candidates.length - report.deletedBlobs;
    return report;
  }
}

/** 保留给后续集成：元数据与保护集对账（不删除）。 */
export async function auditUnreferencedBlobMetadata(
  db: Database,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(designAssetBlobs)
    .where(
      sql`not exists (select 1 from design_asset_sources s where s.blob_content_hash = ${designAssetBlobs.contentHash})`,
    );
  return Number(rows[0]?.count ?? 0);
}
