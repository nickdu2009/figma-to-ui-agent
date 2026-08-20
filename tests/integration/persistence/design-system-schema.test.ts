/**
 * S2：新表结构约束与 Repository 骨架行为（计划 S2 验证）。
 * 1. CHECK 约束（preview_selections / design_asset_extraction_jobs）fail closed；
 * 2. 必需索引存在；
 * 3. 五个 Repository 的核心语义：
 *    PreviewSelection（upsert/成员校验/回退）、Recovery（幂等/容量/CAS/重放/到期）、
 *    DesignAsset（Blob 去重/Source 生命周期/Extraction/job lease）、
 *    Idempotency（claim/重放/冲突/清理）、Release（闭合状态机条件推进 + Bundle 草稿）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlPreviewSelectionRepository } from "../../../server/repositories/preview-selection-repository.ts";
import {
  MysqlGenerationRecoveryRepository,
  RecoveryCapacityExceededError,
  RecoveryDecisionConsumedError,
  RECOVERY_PENDING_LIMIT_PER_APP,
} from "../../../server/repositories/generation-recovery-repository.ts";
import { MysqlDesignAssetRepository } from "../../../server/repositories/design-asset-repository.ts";
import {
  IdempotencyClaimConflictError,
  MysqlBusinessActionIdempotencyRepository,
} from "../../../server/repositories/business-action-idempotency-repository.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";

interface Seed {
  appId: string;
  userId: string;
  membershipId: string;
}

async function seedApp(pool: mysql.Pool): Promise<Seed> {
  const userId = randomUUID();
  const appId = randomUUID();
  const membershipId = randomUUID();
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
  return { appId, userId, membershipId };
}

async function expectCheckViolation(fn: () => Promise<unknown>): Promise<void> {
  await expect(fn()).rejects.toMatchObject({
    code: "ER_CHECK_CONSTRAINT_VIOLATED",
  });
}

describe("S2 新表约束与 Repository 骨架", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  // ---------- CHECK 约束 ----------

  it("preview_selections：draft 必须带 versionId/revision，empty/published 不得携带", async () => {
    await expectCheckViolation(() =>
      pool.query(
        "INSERT INTO `preview_selections` (`app_id`, `membership_id`, `kind`, `updated_at`) VALUES (?, ?, 'draft', UTC_TIMESTAMP(3))",
        [seed.appId, seed.membershipId],
      ),
    );
    await expectCheckViolation(() =>
      pool.query(
        "INSERT INTO `preview_selections` (`app_id`, `membership_id`, `kind`, `version_id`, `revision`, `updated_at`) VALUES (?, ?, 'empty', ?, 1, UTC_TIMESTAMP(3))",
        [seed.appId, seed.membershipId, randomUUID()],
      ),
    );
  });

  it("design_asset_extraction_jobs：queued/running 不带结果，succeeded 必带结果，failed 必带稳定错误码", async () => {
    const blobHash = `sha256:${randomUUID()}`;
    const sourceId = randomUUID();
    await pool.query(
      "INSERT INTO `design_asset_blobs` (`content_hash`, `mime_type`, `byte_length`, `kind`, `status`, `created_at`) VALUES (?, 'image/png', 10, 'image', 'ready', UTC_TIMESTAMP(3))",
      [blobHash],
    );
    await pool.query(
      "INSERT INTO `design_asset_sources` (`id`, `app_id`, `created_by_membership_id`, `blob_content_hash`, `purpose`, `display_name`, `status`, `created_at`, `revision`) VALUES (?, ?, ?, ?, 'reference_screenshot', 's', 'uploaded', UTC_TIMESTAMP(3), 1)",
      [sourceId, seed.appId, seed.membershipId, blobHash],
    );
    const base = "INSERT INTO `design_asset_extraction_jobs` (`id`, `app_id`, `source_id`, `source_content_hash`, `extractor_profile_version`, `status`, `created_at`, `revision`";
    // queued 携带 result_extraction_id → 拒绝
    await expectCheckViolation(() =>
      pool.query(
        `${base}, \`result_extraction_id\`) VALUES (?, ?, ?, ?, 'v1', 'queued', UTC_TIMESTAMP(3), 1, ?)`,
        [randomUUID(), seed.appId, sourceId, blobHash, randomUUID()],
      ),
    );
    // succeeded 无 result_extraction_id → 拒绝
    await expectCheckViolation(() =>
      pool.query(
        `${base}) VALUES (?, ?, ?, ?, 'v1', 'succeeded', UTC_TIMESTAMP(3), 1)`,
        [randomUUID(), seed.appId, sourceId, blobHash],
      ),
    );
    // failed 无 stable_error_code → 拒绝
    await expectCheckViolation(() =>
      pool.query(
        `${base}) VALUES (?, ?, ?, ?, 'v1', 'failed', UTC_TIMESTAMP(3), 1)`,
        [randomUUID(), seed.appId, sourceId, blobHash],
      ),
    );
  });

  it("必需索引存在", async () => {
    const [rows] = await pool.query(
      "SELECT DISTINCT INDEX_NAME AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN ('generation_recovery_records', 'business_action_idempotency', 'design_asset_sources', 'design_asset_extraction_jobs', 'preview_selections')",
    );
    const names = new Set(
      (rows as Array<{ name: string }>).map((r) => r.name),
    );
    for (const required of [
      "generation_recovery_records_key",
      "generation_recovery_records_app_expiry",
      "business_action_idempotency_key",
      "design_asset_sources_app_status",
      "design_asset_extraction_jobs_lease",
      "preview_selections_app_membership",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  // ---------- Repository 行为 ----------

  it("PreviewSelection：upsert、跨应用成员拒绝、草稿回退", async () => {
    const repo = new MysqlPreviewSelectionRepository(handle.db);
    const draftVersionId = randomUUID();
    // 另一应用的成员
    const otherSeed = await seedApp(pool);
    await expect(
      repo.upsertSelection({
        appId: seed.appId,
        membershipId: otherSeed.membershipId,
        kind: "draft",
        versionId: draftVersionId,
        revision: 1,
      }),
    ).rejects.toThrow(/preview_selection_membership_mismatch/);
    // 合法 draft
    await repo.upsertSelection({
      appId: seed.appId,
      membershipId: seed.membershipId,
      kind: "draft",
      versionId: draftVersionId,
      revision: 3,
    });
    let found = await repo.findSelection(seed.appId, seed.membershipId);
    expect(found?.kind).toBe("draft");
    expect(found?.versionId).toBe(draftVersionId);
    expect(found?.revision).toBe(3);
    // upsert 切换 published
    await repo.upsertSelection({
      appId: seed.appId,
      membershipId: seed.membershipId,
      kind: "published",
    });
    found = await repo.findSelection(seed.appId, seed.membershipId);
    expect(found?.kind).toBe("published");
    expect(found?.versionId).toBeNull();
    // 回退：重新选 draft 后回退到 published
    await repo.upsertSelection({
      appId: seed.appId,
      membershipId: seed.membershipId,
      kind: "draft",
      versionId: draftVersionId,
      revision: 3,
    });
    const reverted = await repo.fallbackDraftSelections({
      appId: seed.appId,
      draftVersionId,
    });
    expect(reverted).toBe(1);
    found = await repo.findSelection(seed.appId, seed.membershipId);
    expect(found?.kind).toBe("published");
  });

  it("Recovery：幂等创建、容量上限、CAS 消费、重放与冲突、到期物化", async () => {
    const repo = new MysqlGenerationRecoveryRepository(handle.db);
    const failedGenerationId = randomUUID();
    const failedDigest = `sha256:${randomUUID()}`;
    const first = await repo.createPending({
      appId: seed.appId,
      failedGenerationId,
      failedCandidateDigest: failedDigest,
    });
    expect(first.status).toBe("pending");
    // 幂等：同键重放返回既有行
    const replay = await repo.createPending({
      appId: seed.appId,
      failedGenerationId,
      failedCandidateDigest: failedDigest,
    });
    expect(replay.id).toBe(first.id);
    // 容量：再建 4 个达到 5 上限，第 6 个拒绝
    const others = [];
    for (let i = 0; i < RECOVERY_PENDING_LIMIT_PER_APP - 1; i += 1) {
      others.push(
        await repo.createPending({
          appId: seed.appId,
          failedGenerationId: randomUUID(),
          failedCandidateDigest: `sha256:${randomUUID()}`,
        }),
      );
    }
    expect(await repo.countPending(seed.appId)).toBe(
      RECOVERY_PENDING_LIMIT_PER_APP,
    );
    await expect(
      repo.createPending({
        appId: seed.appId,
        failedGenerationId: randomUUID(),
        failedCandidateDigest: `sha256:${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(RecoveryCapacityExceededError);
    // CAS 消费：repair 必须 successor
    const successorId = randomUUID();
    await expect(
      repo.consumeDecision({
        appId: seed.appId,
        failedGenerationId,
        failedCandidateDigest: failedDigest,
        decision: "repair",
        decidedBy: seed.membershipId,
      }),
    ).rejects.toThrow(/successorGenerationId/);
    const consumed = await repo.consumeDecision({
      appId: seed.appId,
      failedGenerationId,
      failedCandidateDigest: failedDigest,
      decision: "repair",
      decidedBy: seed.membershipId,
      successorGenerationId: successorId,
    });
    expect(consumed.status).toBe("consumed");
    expect(consumed.successorGenerationId).toBe(successorId);
    // 相同决定重放返回第一次结果
    const replayDecision = await repo.consumeDecision({
      appId: seed.appId,
      failedGenerationId,
      failedCandidateDigest: failedDigest,
      decision: "repair",
      decidedBy: seed.membershipId,
      successorGenerationId: successorId,
    });
    expect(replayDecision.id).toBe(consumed.id);
    // 不同决定竞争 → 拒绝
    await expect(
      repo.consumeDecision({
        appId: seed.appId,
        failedGenerationId,
        failedCandidateDigest: failedDigest,
        decision: "keep_current",
        decidedBy: seed.membershipId,
      }),
    ).rejects.toBeInstanceOf(RecoveryDecisionConsumedError);
    // 到期物化：把其余 pending 的到期时间改到过去
    await pool.query(
      "UPDATE `generation_recovery_records` SET `decision_expires_at` = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE `status` = 'pending'",
    );
    const expired = await repo.expirePending({ limit: 10 });
    expect(expired).toBe(others.length);
    expect(await repo.countPending(seed.appId)).toBe(0);
  });

  it("DesignAsset：Blob 去重、Source 生命周期、Extraction 与 job lease", async () => {
    const repo = new MysqlDesignAssetRepository(handle.db);
    const contentHash = `sha256:${randomUUID().slice(0, 32)}`;
    const blob = await repo.ensureBlob({
      contentHash,
      mimeType: "image/png",
      byteLength: 128,
      kind: "image",
    });
    // 幂等去重
    const again = await repo.ensureBlob({
      contentHash,
      mimeType: "image/png",
      byteLength: 128,
      kind: "image",
    });
    expect(again.contentHash).toBe(blob.contentHash);
    // source 依赖已存在 Blob
    const source = await repo.createSource({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      blobContentHash: contentHash,
      purpose: "brand_guide_pdf",
      displayName: "brand.pdf",
    });
    expect(source.status).toBe("uploaded");
    await expect(
      repo.createSource({
        appId: seed.appId,
        createdByMembershipId: seed.membershipId,
        blobContentHash: `sha256:missing-${randomUUID().slice(0, 16)}`,
        purpose: "brand_guide_pdf",
        displayName: "x",
      }),
    ).rejects.toThrow(/design_asset_blob_missing/);
    // 生命周期：uploaded → extracting →（extraction ready）→ ready
    const job = await repo.enqueueJob({
      appId: seed.appId,
      sourceId: source.id,
      sourceContentHash: contentHash,
      extractorProfileVersion: "extractor-v1",
    });
    expect(await repo.markExtracting({ sourceId: source.id })).toBe(true);
    // lease：owner A 领取
    expect(await repo.claimJob({ jobId: job.id, leaseOwner: "worker-a", leaseTtlMs: 60_000 })).toBe(true);
    // owner B 在 lease 有效期内领取失败
    expect(await repo.claimJob({ jobId: job.id, leaseOwner: "worker-b", leaseTtlMs: 60_000 })).toBe(false);
    // owner B 完成/失败均被拒绝（lease owner 不匹配）
    expect(
      await repo.completeJob({ jobId: job.id, leaseOwner: "worker-b", resultExtractionId: randomUUID() }),
    ).toBe(false);
    const extraction = await repo.createReadyExtraction({
      sourceId: source.id,
      sourceContentHash: contentHash,
      extractorProfileVersion: "extractor-v1",
      schemaVersion: 1,
      structuredSummary: { palette: ["#0f172a"] },
      summaryDigest: `sha256:${randomUUID().slice(0, 32)}`,
      byteLength: 42,
    });
    // extraction 与 source 不匹配 → 拒绝
    await expect(
      repo.markReadyWithExtraction({ sourceId: source.id, extractionId: randomUUID() }),
    ).rejects.toThrow(/design_asset_extraction_mismatch/);
    expect(
      await repo.completeJob({
        jobId: job.id,
        leaseOwner: "worker-a",
        resultExtractionId: extraction.id,
      }),
    ).toBe(true);
    expect(await repo.markReadyWithExtraction({ sourceId: source.id, extractionId: extraction.id })).toBe(true);
    const ready = await repo.findSourceById(source.id);
    expect(ready?.status).toBe("ready");
    expect(ready?.readyExtractionId).toBe(extraction.id);
    // 显式删除进入 deleted（7 天恢复窗口由维护任务处理）
    expect(await repo.markDeleted({ sourceId: source.id })).toBe(true);
    // 过期 running job 不得重领或由另一 worker 终止：避免隐式 retry/replay。
    const job2 = await repo.enqueueJob({
      appId: seed.appId,
      sourceId: source.id,
      sourceContentHash: contentHash,
      extractorProfileVersion: "extractor-v1",
    });
    expect(await repo.claimJob({ jobId: job2.id, leaseOwner: "worker-a", leaseTtlMs: 60_000 })).toBe(true);
    await pool.query(
      "UPDATE `design_asset_extraction_jobs` SET `lease_expires_at` = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE `id` = ?",
      [job2.id],
    );
    expect(await repo.claimJob({ jobId: job2.id, leaseOwner: "worker-b", leaseTtlMs: 60_000 })).toBe(false);
    expect(
      await repo.failJob({ jobId: job2.id, leaseOwner: "worker-b", stableErrorCode: "extractor_timeout" }),
    ).toBe(false);
    const failedJob = await repo.findJobById(job2.id);
    expect(failedJob?.status).toBe("running");
    expect(failedJob?.stableErrorCode).toBeNull();
  });

  it("Idempotency：claim、重放、冲突与清理", async () => {
    const repo = new MysqlBusinessActionIdempotencyRepository(handle.db);
    const key = `idem-${randomUUID()}`;
    const requestHash = `sha256:${randomUUID().slice(0, 32)}`;
    const input = {
      appId: seed.appId,
      membershipId: seed.membershipId,
      canonicalActionName: "crm.createCustomer",
      idempotencyKey: key,
      protocolVersion: 1,
      publishedVersionId: null,
      requestHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    // claim 与终态同事务
    const result = await handle.db.transaction(async (tx) => {
      const claimed = await repo.claimInTransaction(tx, input);
      expect(claimed.claimed).toBe(true);
      const done = await repo.completeInTransaction(tx, {
        id: claimed.row.id,
        status: "completed",
        resultRef: `published_version:${randomUUID()}`,
        resultDigest: `sha256:${randomUUID().slice(0, 32)}`,
        stableResultCode: "ok",
      });
      expect(done).toBe(true);
      return claimed.row;
    });
    // 重放：相同 requestHash → claimed=false 返回既有行
    await handle.db.transaction(async (tx) => {
      const replay = await repo.claimInTransaction(tx, input);
      expect(replay.claimed).toBe(false);
      expect(replay.row.id).toBe(result.id);
    });
    // 冲突：不同 requestHash
    await expect(
      handle.db.transaction(async (tx) =>
        repo.claimInTransaction(tx, {
          ...input,
          requestHash: `sha256:different-${randomUUID().slice(0, 16)}`,
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyClaimConflictError);
    // 清理：过期行删除
    await pool.query(
      "UPDATE `business_action_idempotency` SET `expires_at` = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE `id` = ?",
      [result.id],
    );
    const pruned = await repo.pruneExpired({ limit: 10 });
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(await repo.findByKey(input)).toBeNull();
  });

  it("Release：闭合状态机条件推进 + Bundle 草稿同事务", async () => {
    const repo = new MysqlReleaseRepository(handle.db);
    const bundle = {
      spec: { routes: { "/": { root: "Home" } } },
      designSystem: { tokens: {} },
    };
    const digest = `sha256:${randomUUID().slice(0, 32)}`;

    // 快乐路径：running → validation_running → awaiting_preview → succeeded(+draft)
    const runA = await repo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    // 非法源状态推进失败（fail closed）
    expect(
      await repo.markAwaitingPreviewFromValidation({
        runId: runA.id,
        validationReport: {},
        reportDigest: digest,
        validationProfileVersion: "vp-1",
        validationIssues: [],
        publishBlocked: false,
        now: new Date(),
      }),
    ).toBe(false);
    expect(
      await repo.markValidationRunning({
        runId: runA.id,
        candidateBundle: bundle,
        catalogVersion: "ds-v1",
        candidateDigest: digest,
        uiBundleDigest: digest,
        digestVersion: 1,
        migrationFromPublishedVersionId: null,
        migrationFromSchemaDigest: digest,
        migrationToSchemaDigest: digest,
        now: new Date(),
      }),
    ).toBe(true);
    // 重复推进（已是 validation_running）失败
    expect(
      await repo.markValidationRunning({
        runId: runA.id,
        candidateBundle: bundle,
        catalogVersion: "ds-v1",
        candidateDigest: digest,
        uiBundleDigest: digest,
        digestVersion: 1,
        migrationFromPublishedVersionId: null,
        migrationFromSchemaDigest: digest,
        migrationToSchemaDigest: digest,
        now: new Date(),
      }),
    ).toBe(false);
    expect(
      await repo.markAwaitingPreviewFromValidation({
        runId: runA.id,
        validationReport: { checks: [] },
        reportDigest: digest,
        validationProfileVersion: "vp-1",
        validationIssues: [],
        publishBlocked: false,
        now: new Date(),
      }),
    ).toBe(true);
    const draft = await repo.createBundleDraftAndMarkSucceeded({
      runId: runA.id,
      bundle,
      catalogVersion: "ds-v1",
      validationIssues: [],
      publishBlocked: false,
      candidateDigest: digest,
      uiBundleDigest: digest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: digest,
      migrationToSchemaDigest: digest,
      businessSchema: { tables: {} },
      now: new Date(),
    });
    expect(draft).not.toBeNull();
    const [rows] = await pool.query(
      "SELECT r.status AS run_status, d.spec AS spec, d.bundle AS draft_bundle, d.catalog_version AS catalog_version FROM `generation_runs` r JOIN `draft_versions` d ON d.generation_run_id = r.id WHERE r.id = ?",
      [runA.id],
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    expect(row?.run_status).toBe("succeeded");
    // spec 只读兼容投影来自 bundle.spec（同一事务派生）
    expect(row?.spec).toEqual(bundle.spec);
    expect(row?.catalog_version).toBe("ds-v1");
    const storedBundle = row?.draft_bundle as { spec: unknown };
    expect(storedBundle.spec).toEqual(bundle.spec);
    // run 已 succeeded：再推进失败
    expect(
      await repo.markFailedFrom({
        runId: runA.id,
        from: "awaiting_preview",
        diagnostics: { code: "x" },
        now: new Date(),
      }),
    ).toBe(false);

    // fatal 路径：validation_running → recovery_pending → recovery_consumed
    const runB = await repo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    await repo.markValidationRunning({
      runId: runB.id,
      candidateBundle: bundle,
      catalogVersion: "ds-v1",
      candidateDigest: digest,
      uiBundleDigest: digest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: digest,
      migrationToSchemaDigest: digest,
      now: new Date(),
    });
    expect(
      await repo.markRecoveryPending({
        runId: runB.id,
        fatalVisualIssues: [{ id: "FV-1" }],
        validationReport: { checks: [] },
        reportDigest: digest,
        validationProfileVersion: "vp-1",
        now: new Date(),
      }),
    ).toBe(true);
    expect(await repo.markRecoveryConsumed({ runId: runB.id, now: new Date() })).toBe(true);
    // recovery_consumed 是终态：不能回 awaiting_preview
    expect(
      await repo.markAwaitingPreviewFromValidation({
        runId: runB.id,
        validationReport: {},
        reportDigest: digest,
        validationProfileVersion: "vp-1",
        validationIssues: [],
        publishBlocked: false,
        now: new Date(),
      }),
    ).toBe(false);

    // failed 路径：validation_running → failed（诊断稳定码）
    const runC = await repo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    await repo.markValidationRunning({
      runId: runC.id,
      candidateBundle: bundle,
      catalogVersion: "ds-v1",
      candidateDigest: digest,
      uiBundleDigest: digest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: digest,
      migrationToSchemaDigest: digest,
      now: new Date(),
    });
    expect(
      await repo.markFailedFrom({
        runId: runC.id,
        from: "validation_running",
        diagnostics: { code: "validation_worker_crashed" },
        now: new Date(),
      }),
    ).toBe(true);
    const [failedRows] = await pool.query(
      "SELECT `status`, JSON_EXTRACT(`diagnostics`, '$.code') AS code FROM `generation_runs` WHERE `id` = ?",
      [runC.id],
    );
    const failed = (failedRows as Array<Record<string, unknown>>)[0];
    expect(failed?.status).toBe("failed");
    // mysql2 自动解析 JSON 表达式：返回已去引号的字符串
    expect(failed?.code).toBe("validation_worker_crashed");
  });
});
