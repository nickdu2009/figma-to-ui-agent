/**
 * DesignAsset reconciliation（设计 §5.4，计划 S7 动作 8）：
 * - 过期租约 job → failed/extraction_worker_lost（不自动重试；重新提取
 *   必须新建 jobId/extractionId）；
 * - extracting 但无任何 queued/running job 引用的 source → failed；
 * - 元数据指向缺失 Blob 的 source：不修改资产状态，只收集报告
 *   （读取面 fail closed 已由 read-resolver 保证）；
 * - 进程崩溃残留 tmp 文件清扫（有界、按 mtime 年龄）；
 * - 数据库时间判定（leaseExpiresAt 与 UTC_TIMESTAMP 比较）。
 */
import type { DesignAssetRepository } from "../repositories/design-asset-repository.ts";
import type { BlobStore } from "./blob-store.ts";

export const WORKER_LOST_CODE = "extraction_worker_lost";

export interface ReconciliationReport {
  jobsFailed: number;
  sourcesFailed: number;
  missingBlobs: Array<{ sourceId: string; blobContentHash: string }>;
  orphanTmpSwept: number;
}

export interface DesignAssetReconciler {
  /** 执行一轮有界 reconciliation（幂等）。 */
  reconcile(now: Date): Promise<ReconciliationReport>;
}

export class DefaultDesignAssetReconciler implements DesignAssetReconciler {
  private readonly repository: DesignAssetRepository;
  private readonly blobStore: BlobStore;
  private readonly limits: {
    maxJobsPerRun: number;
    maxSourcesPerRun: number;
    orphanTmpMaxAgeMs: number;
  };

  constructor(
    repository: DesignAssetRepository,
    blobStore: BlobStore,
    limits: {
      maxJobsPerRun: number;
      maxSourcesPerRun: number;
      orphanTmpMaxAgeMs: number;
    },
  ) {
    this.repository = repository;
    this.blobStore = blobStore;
    this.limits = limits;
  }

  async reconcile(now: Date): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      jobsFailed: 0,
      sourcesFailed: 0,
      missingBlobs: [],
      orphanTmpSwept: 0,
    };

    // 1) 过期租约 job → failed/extraction_worker_lost（CAS：仍 running 且到期）。
    const expired = await this.repository.findExpiredLeaseJobs(
      this.limits.maxJobsPerRun,
    );
    for (const job of expired) {
      const failed = await this.repository.failJobByReconciliation({
        jobId: job.id,
        stableErrorCode: WORKER_LOST_CODE,
      });
      if (failed) report.jobsFailed += 1;
    }

    // 2) extracting 且无活动 job 的 source → failed（崩溃残留状态）。
    const activeBindings = new Set(
      (await this.repository.listActiveJobBindings(this.limits.maxJobsPerRun)).map(
        (binding) => binding.sourceId,
      ),
    );
    const sources = await this.repository.listAllActiveSources(
      this.limits.maxSourcesPerRun,
    );
    for (const source of sources) {
      if (source.status !== "extracting") continue;
      if (activeBindings.has(source.id)) continue;
      const marked = await this.repository.markSourceFailedIfNoActiveJob({
        sourceId: source.id,
      });
      if (marked) report.sourcesFailed += 1;
    }

    // 3) 元数据指向缺失 Blob（只报告；读取面 fail closed 不受影响）。
    for (const source of sources) {
      if (source.status === "deleted") continue;
      const blob = await this.repository.findBlob(source.blobContentHash);
      if (!blob) {
        report.missingBlobs.push({
          sourceId: source.id,
          blobContentHash: source.blobContentHash,
        });
        continue;
      }
      const hashHex = blob.contentHash.replace(/^sha256:/, "");
      const ok = await this.blobStore.verifyOnDisk(
        `sha256/${hashHex.slice(0, 2)}/${hashHex}`,
        blob.byteLength,
      );
      if (!ok) {
        report.missingBlobs.push({
          sourceId: source.id,
          blobContentHash: blob.contentHash,
        });
      }
    }

    // 4) 崩溃残留 tmp 清扫。
    report.orphanTmpSwept = await this.blobStore.sweepOrphanTmp(
      now,
      this.limits.orphanTmpMaxAgeMs,
    );

    return report;
  }
}
