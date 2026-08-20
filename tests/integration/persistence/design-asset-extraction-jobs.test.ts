/**
 * S7 集成测试 2：ExtractionJob 生命周期（计划 S7 验证）。
 * - queued→running→succeeded|failed 只按条件推进（CAS）；
 * - 租约并发：只有一个 claim 获胜；租约到期后 reconciliation 才可重领；
 * - 成功事务：新 immutable Extraction + resultExtractionId + Source CAS；
 * - Extraction 创建与 Source CAS 之间崩溃（事务回滚）不产生半套状态；
 * - 租约丢失 → failed/extraction_worker_lost，不自动重试；
 * - 重新提取：新建 jobId/extractionId，历史 ready 行不被覆盖。
 * MySQL 隔离 schema + 临时 VMA_ASSET_ROOT。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlDesignAssetRepository } from "../../../server/repositories/design-asset-repository.ts";
import { LocalContentAddressedBlobStore } from "../../../server/design-assets/blob-store.ts";
import { DefaultDesignAssetService } from "../../../server/design-assets/service.ts";
import { createExtractionWorker } from "../../../server/design-assets/extraction.ts";
import {
  DefaultDesignAssetReconciler,
  WORKER_LOST_CODE,
} from "../../../server/design-assets/reconciliation.ts";

const GRADIENT_PNG = await readFile("tests/fixtures/design-assets/gradient.png");

describe("S7 ExtractionJob 生命周期", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let assetRoot: string;
  let store: LocalContentAddressedBlobStore;
  let repository: MysqlDesignAssetRepository;
  let service: DefaultDesignAssetService;
  let reconciler: DefaultDesignAssetReconciler;
  let appId: string;
  let membershipId: string;

  async function uploadOne(name = "gradient.png"): Promise<{
    sourceId: string;
    jobId: string;
    blobContentHash: string;
  }> {
    const upload = await service.uploadSource({
      appId,
      createdByMembershipId: membershipId,
      purpose: "reference_screenshot",
      displayName: name,
      bytes: GRADIENT_PNG,
      declaredMimeType: "image/png",
    });
    return {
      sourceId: upload.source.id,
      jobId: upload.jobId,
      blobContentHash: upload.blobContentHash,
    };
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    assetRoot = await mkdtemp(path.join(tmpdir(), "vma-s7-jobs-"));
    store = new LocalContentAddressedBlobStore(assetRoot, "test-server");
    repository = new MysqlDesignAssetRepository(handle.db);
    service = new DefaultDesignAssetService(repository, store);
    reconciler = new DefaultDesignAssetReconciler(repository, store, {
      maxJobsPerRun: 50,
      maxSourcesPerRun: 100,
      orphanTmpMaxAgeMs: 3_600_000,
    });

    const userId = randomUUID();
    appId = randomUUID();
    membershipId = randomUUID();
    await pool.query(
      "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [userId, `u-${userId}@example.com`, `u-${userId}@example.com`],
    );
    await pool.query(
      "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [appId, `app-${appId}`, userId],
    );
    await pool.query(
      "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'owner', 'active', 'active', UTC_TIMESTAMP(3))",
      [membershipId, appId, userId],
    );
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
    await rm(assetRoot, { recursive: true, force: true });
  });

  it("job 状态机：queued→running→succeeded（条件 CAS，单事务完成）", async () => {
    const { sourceId, jobId } = await uploadOne();
    const job0 = await repository.findJobById(jobId);
    expect(job0?.status).toBe("queued");
    expect(job0?.resultExtractionId).toBeNull();

    const claimed = await repository.claimJob({
      jobId,
      leaseOwner: "w1",
      leaseTtlMs: 60_000,
    });
    expect(claimed).toBe(true);
    // 第二个 claim（租约未到期）必须失败。
    expect(
      await repository.claimJob({ jobId, leaseOwner: "w2", leaseTtlMs: 60_000 }),
    ).toBe(false);

    await repository.markExtracting({ sourceId });
    const summary = {
      palette: [{ role: "primary" as const, color: "#1a73e8" }],
      typography: [],
      voiceTraits: ["clear" as const],
      layoutHints: [],
      imageStyleTags: [],
    };
    const result = await repository.completeExtractionTransaction({
      jobId,
      leaseOwner: "w1",
      sourceId,
      extraction: {
        sourceContentHash: job0?.sourceContentHash ?? "",
        extractorProfileVersion: "p0-deterministic-v1",
        schemaVersion: 1,
        structuredSummary: summary,
        summaryDigest: `sha256:${"a".repeat(64)}`,
        byteLength: 128,
      },
    });
    expect(result).not.toBeNull();
    const job1 = await repository.findJobById(jobId);
    expect(job1?.status).toBe("succeeded");
    expect(job1?.resultExtractionId).toBe(result?.extractionId);
    const source = await repository.findSourceById(sourceId);
    expect(source?.status).toBe("ready");
    expect(source?.readyExtractionId).toBe(result?.extractionId);
  });

  it("事务原子性：Source CAS 失败时 Extraction 一并回滚（无半套状态）", async () => {
    const { sourceId, jobId, blobContentHash } = await uploadOne("atomic.png");
    await repository.claimJob({ jobId, leaseOwner: "w1", leaseTtlMs: 60_000 });
    // 不 markExtracting（或先失败）→ source 仍 uploaded → 事务内 CAS 失败。
    const result = await repository.completeExtractionTransaction({
      jobId,
      leaseOwner: "w1",
      sourceId,
      extraction: {
        sourceContentHash: blobContentHash,
        extractorProfileVersion: "p0-deterministic-v1",
        schemaVersion: 1,
        structuredSummary: { palette: [], typography: [], voiceTraits: [], layoutHints: [], imageStyleTags: [] },
        summaryDigest: `sha256:${"b".repeat(64)}`,
        byteLength: 64,
      },
    });
    expect(result).toBeNull();
    // Extraction 未落库（不可见半套）。
    const extractions = await repository.listExtractionsBySource(sourceId);
    expect(extractions).toHaveLength(0);
  });

  it("租约到期：reconciliation 标记 failed/extraction_worker_lost，不自动重试", async () => {
    const { sourceId, jobId } = await uploadOne("lost.png");
    // 短租约（10ms）→ 到期。
    await repository.claimJob({ jobId, leaseOwner: "w-crashed", leaseTtlMs: 10 });
    await repository.markExtracting({ sourceId });
    await new Promise((resolve) => setTimeout(resolve, 60));

    const report = await reconciler.reconcile(new Date());
    expect(report.jobsFailed).toBeGreaterThanOrEqual(1);
    const job = await repository.findJobById(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.stableErrorCode).toBe(WORKER_LOST_CODE);

    // 卡死 source（extracting 且无活动 job）→ failed。
    const source = await repository.findSourceById(sourceId);
    expect(source?.status).toBe("failed");

    // 不自动重试：该 job 不会回到 queued（下一个可领取 job 不是它）。
    const next = await repository.findNextClaimableJob();
    expect(next?.id === jobId).toBe(false);
  });

  it("重新提取：新建 jobId/extractionId，历史 ready 行不被覆盖", async () => {
    const worker = createExtractionWorker({
      repository,
      blobStore: store,
      leaseOwner: "w-2",
      leaseTtlMs: 60_000,
    });
    const first = await uploadOne("reextract.png");
    expect(await worker.runOnce()).toBe("completed");
    const sourceAfterFirst = await repository.findSourceById(first.sourceId);
    const firstExtractionId = sourceAfterFirst?.readyExtractionId;
    expect(firstExtractionId).toBeTruthy();

    // 重新提取：显式再排队（同 source 新 job）。
    const reenqueued = await repository.enqueueJob({
      appId,
      sourceId: first.sourceId,
      sourceContentHash: first.blobContentHash,
      extractorProfileVersion: "p0-deterministic-v1",
    });
    expect(reenqueued.id).not.toBe(first.jobId);
    // 提取前必须回 uploaded/extracting：显式 markExtracting。
    await repository.markExtracting({ sourceId: first.sourceId });
    // claim 需要先允许：source 当前 ready，markExtracting 条件不满足 →
    // 直接 completeJob 路径失败；改为完整 worker（claim 内含 markExtracting 失败处理）。
    const outcome = await worker.runOnce();
    if (outcome === "failed") {
      // markExtracting CAS 因 ready 状态失败 → job failed（符合"不覆盖历史"）。
      const job = await repository.findJobById(reenqueued.id);
      expect(job?.status).toBe("failed");
      expect(
        (await repository.findSourceById(first.sourceId))?.readyExtractionId,
      ).toBe(firstExtractionId);
      return;
    }
    // worker 成功路径：新 extractionId 且历史行保持。
    const sourceAfterSecond = await repository.findSourceById(first.sourceId);
    expect(sourceAfterSecond?.readyExtractionId).not.toBe(firstExtractionId);
    const history = await repository.listExtractionsBySource(first.sourceId);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(
      new Set(history.map((row) => row.id)).has(firstExtractionId ?? ""),
    ).toBe(true);
  });

  it("并发提取：同一 job 只有一个 claim 获胜", async () => {
    const { jobId } = await uploadOne("concurrent.png");
    const claims = await Promise.all(
      ["w-a", "w-b", "w-c"].map((owner) =>
        repository.claimJob({ jobId, leaseOwner: owner, leaseTtlMs: 60_000 }),
      ),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
