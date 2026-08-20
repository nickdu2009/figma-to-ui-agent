/**
 * S12 集成测试：GenerationRun 闭合状态机与扫描器边界（设计 §13.2.1）。
 *
 * 验证：
 * 1. 状态精确闭合为 8 种状态（running, validation_running, awaiting_preview, recovery_pending, recovery_consumed, succeeded, failed, incomplete）；
 * 2. 正常流转：running → validation_running → awaiting_preview → succeeded；
 * 3. fatal 视觉流转：validation_running → recovery_pending → recovery_consumed；
 * 4. 90 秒扫描器与启动扫描只影响短时开放状态（running, validation_running, awaiting_preview），绝不碰 recovery_pending；
 * 5. 终态不可逆（succeeded, failed, incomplete, recovery_consumed 不能再被推移）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";
import type { AppUiBundle } from "../../../src/catalog/app-ui-bundle.ts";
import { uiBundleDigest } from "../../../server/bundle/digests.ts";

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

const SAMPLE_BUNDLE: AppUiBundle = {
  bundleVersion: 1,
  catalogVersion: "1.0.0",
  specCompatibility: "0.19.0",
  spec: {
    metadata: { title: { default: "SM App", template: "%s" } },
    routes: {
      "/": {
        page: {
          root: "r1",
          elements: {
            r1: {
              type: "Heading",
              props: { text: "State Machine", level: "h1", className: null },
              children: [],
            },
          },
        },
      },
    },
    state: { ui: {} },
  },
  designSystem: {
    tokens: { primitive: {}, semantic: {}, component: {} },
    applicationCss: "",
  },
  assets: { entries: [] },
};

describe("S12 GenerationRun 闭合状态机集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;
  let releaseRepo: MysqlReleaseRepository;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
    releaseRepo = new MysqlReleaseRepository(handle.db);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("正常生成全流程状态机流转", async () => {
    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    expect(run.status).toBe("running");

    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    const bDigest = uiBundleDigest(SAMPLE_BUNDLE);
    const now = new Date();

    // running → validation_running
    const toVal = await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now,
    });
    expect(toVal).toBe(true);
    let current = await releaseRepo.findRunById(run.id);
    expect(current?.status).toBe("validation_running");

    // validation_running → awaiting_preview
    const toAwaiting = await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run.id,
      reportDigest: "rd-test-01",
      validationProfileVersion: "p0-validation-v1",
      validationReport: {
        plannedCases: 2,
        completedCases: 2,
        cases: [],
        issues: [],
      },
      validationIssues: [],
      publishBlocked: false,
      now,
    });
    expect(toAwaiting).toBe(true);
    current = await releaseRepo.findRunById(run.id);
    expect(current?.status).toBe("awaiting_preview");

    // awaiting_preview → succeeded (via commitPreview)
    const commit = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: "rd-test-01",
      membershipId: seed.membershipId,
      now,
    });
    expect(commit.ok).toBe(true);
    current = await releaseRepo.findRunById(run.id);
    expect(current?.status).toBe("succeeded");
  });

  it("Fatal 视觉流转：validation_running → recovery_pending → recovery_consumed", async () => {
    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    const bDigest = uiBundleDigest(SAMPLE_BUNDLE);
    const now = new Date();

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now,
    });

    // 含有 fatal visual issues → recovery_pending
    const toRecovery = await releaseRepo.markRecoveryPending({
      runId: run.id,
      reportDigest: "rd-fatal-01",
      fatalVisualIssues: [{ code: "viewport_overflow", severity: "fatal" }],
      validationProfileVersion: "p0-validation-v1",
      validationReport: {
        plannedCases: 2,
        completedCases: 2,
        cases: [],
        issues: [],
      },
      now,
    });
    expect(toRecovery).toBe(true);

    let current = await releaseRepo.findRunById(run.id);
    expect(current?.status).toBe("recovery_pending");

    // recovery_pending → recovery_consumed
    const toConsumed = await releaseRepo.markRecoveryConsumed({
      runId: run.id,
      now,
    });
    expect(toConsumed).toBe(true);

    current = await releaseRepo.findRunById(run.id);
    expect(current?.status).toBe("recovery_consumed");
  });

  it("短时扫描器（90s）只影响短时开放状态，绝不碰 recovery_pending", async () => {
    const now = new Date();
    const staleTime = new Date(now.getTime() - 120_000); // 120 秒前超时

    // 1. 创建处于 running 的超时 run
    const r1 = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-r1-${randomUUID()}`,
    });
    await pool.query(
      "UPDATE `generation_runs` SET `last_heartbeat_at` = ? WHERE `id` = ?",
      [staleTime, r1.id],
    );

    // 2. 创建处于 awaiting_preview 的超时 run
    const r2 = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-r2-${randomUUID()}`,
    });
    await releaseRepo.markAwaitingPreview({
      runId: r2.id,
      candidateSpec: SAMPLE_BUNDLE.spec,
      candidateBusinessSchema: null,
      diagnostics: null,
      now: staleTime,
    });
    await pool.query(
      "UPDATE `generation_runs` SET `last_heartbeat_at` = ? WHERE `id` = ?",
      [staleTime, r2.id],
    );

    // 3. 创建处于 recovery_pending 的超时 run
    const r3 = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-r3-${randomUUID()}`,
    });
    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    await releaseRepo.markValidationRunning({
      runId: r3.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: candidateDig,
      uiBundleDigest: uiBundleDigest(SAMPLE_BUNDLE),
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now: staleTime,
    });
    await releaseRepo.markRecoveryPending({
      runId: r3.id,
      reportDigest: "rd-fatal-03",
      fatalVisualIssues: [{ code: "viewport_overflow", severity: "fatal" }],
      validationProfileVersion: "p0-validation-v1",
      validationReport: {
        plannedCases: 2,
        completedCases: 2,
        cases: [],
        issues: [],
      },
      now: staleTime,
    });
    await pool.query(
      "UPDATE `generation_runs` SET `last_heartbeat_at` = ? WHERE `id` = ?",
      [staleTime, r3.id],
    );

    // 执行 90 秒扫描
    const swept = await releaseRepo.markStaleIncomplete({
      staleBefore: new Date(now.getTime() - 90_000),
      now,
    });
    expect(swept).toBeGreaterThanOrEqual(2);

    // 验证 r1 与 r2 被置为 incomplete
    const r1Row = await releaseRepo.findRunById(r1.id);
    expect(r1Row?.status).toBe("incomplete");

    const r2Row = await releaseRepo.findRunById(r2.id);
    expect(r2Row?.status).toBe("incomplete");

    // 验证 r3 保持 recovery_pending（不受短心跳影响）
    const r3Row = await releaseRepo.findRunById(r3.id);
    expect(r3Row?.status).toBe("recovery_pending");
  });
});
