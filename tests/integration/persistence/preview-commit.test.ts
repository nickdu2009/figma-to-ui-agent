/**
 * S11 集成测试：Preview Commit 事务、幂等与 PreviewSelection（设计 §13.2.1/§13.2.3）。
 *
 * 验证：
 * 1. commitPreview 同一事务校验 run/digests/report，幂等创建 DraftVersion、完成 run、更新 PreviewSelection；
 * 2. 派生 legacy spec 投影与 publishBlocked 字段；
 * 3. G1-fatal 问题拒绝创建草稿；
 * 4. G1 普通问题创建草稿但标记 publishBlocked=true；
 * 5. digest 不匹配时拒绝提交；
 * 6. PreviewSelection 路由正确切换 Draft 视图与 Published 哨兵。
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
import { MysqlPreviewSelectionRepository } from "../../../server/repositories/preview-selection-repository.ts";
import { uiBundleDigest } from "../../../server/bundle/digests.ts";
import type { AppUiBundle } from "../../../src/catalog/app-ui-bundle.ts";

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
  catalogVersion: "p0-v1",
  specCompatibility: "0.19.0",
  spec: {
    metadata: { title: { default: "Preview App", template: "%s | Preview" } },
    routes: {
      "/": {
        page: {
          root: "r1",
          elements: {
            r1: {
              type: "Heading",
              props: { text: "Hello S11", level: "h1", className: null },
              children: [],
            },
          },
        },
      },
    },
    state: { ui: {} },
  },
  designSystem: {
    tokens: {
      primitive: { "color.primary": { type: "color", value: "#0066cc" } },
      semantic: {},
      component: {},
    },
    applicationCss: "",
  },
  assets: { entries: [] },
};

describe("S11 Preview Commit 与 PreviewSelection 集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;
  let releaseRepo: MysqlReleaseRepository;
  let selectionRepo: MysqlPreviewSelectionRepository;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
    releaseRepo = new MysqlReleaseRepository(handle.db);
    selectionRepo = new MysqlPreviewSelectionRepository(handle.db);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("commitPreview 正常路径：同一事务落库草稿、更新 run 与 PreviewSelection", async () => {
    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    const reportDig = `sha256:${randomUUID().slice(0, 32)}`;
    const predecessorId = randomUUID();
    const fromSchemaDigest = `sha256:${randomUUID().slice(0, 32)}`;
    const toSchemaDigest = `sha256:${randomUUID().slice(0, 32)}`;
    const bDigest = uiBundleDigest(SAMPLE_BUNDLE);
    const now = new Date();

    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "p0-v1",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: predecessorId,
      migrationFromSchemaDigest: fromSchemaDigest,
      migrationToSchemaDigest: toSchemaDigest,
      now,
    });

    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run.id,
      reportDigest: reportDig,
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

    const commitRes = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      membershipId: seed.membershipId,
      now,
    });

    expect(commitRes.ok).toBe(true);
    if (!commitRes.ok) return;

    expect(commitRes.candidateDigest).toBe(candidateDig);
    expect(commitRes.uiBundleDigest).toBe(bDigest);
    expect(commitRes.draftVersionId).toBeTruthy();

    // 验证草稿行
    const draft = await releaseRepo.findDraftById(commitRes.draftVersionId);
    expect(draft).toBeDefined();
    expect(draft?.appId).toBe(seed.appId);
    expect(draft?.generationRunId).toBe(run.id);
    expect(draft?.publishBlocked).toBe(false);
    expect(draft?.spec).toEqual(SAMPLE_BUNDLE.spec);
    expect(draft?.bundle).toEqual(SAMPLE_BUNDLE);
    expect(draft?.migrationFromPublishedVersionId).toBe(predecessorId);
    expect(draft?.migrationFromSchemaDigest).toBe(fromSchemaDigest);
    expect(draft?.migrationToSchemaDigest).toBe(toSchemaDigest);

    // 验证 run 状态变更为 succeeded
    const runRow = await releaseRepo.findRunById(run.id);
    expect(runRow?.status).toBe("succeeded");

    // 验证 PreviewSelection 自动更新为当前 draft
    const selection = await selectionRepo.findSelection(
      seed.appId,
      seed.membershipId,
    );
    expect(selection?.kind).toBe("draft");
    expect(selection?.versionId).toBe(commitRes.draftVersionId);

    // 幂等测试：重复提交返回相同 draftVersionId
    const replayRes = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      membershipId: seed.membershipId,
      now,
    });
    expect(replayRes.ok).toBe(true);
    if (replayRes.ok) {
      expect(replayRes.draftVersionId).toBe(commitRes.draftVersionId);
    }
  });

  it("commitPreview 拒绝 G1-fatal 候选创建草稿", async () => {
    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    const reportDig = `sha256:${randomUUID().slice(0, 32)}`;
    const bDigest = uiBundleDigest(SAMPLE_BUNDLE);
    const now = new Date();

    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "p0-v1",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now,
    });

    // 进入 recovery_pending（有 fatal visual issues）
    await releaseRepo.markRecoveryPending({
      runId: run.id,
      reportDigest: reportDig,
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

    const commitRes = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      membershipId: seed.membershipId,
      now,
    });

    expect(commitRes.ok).toBe(false);
    if (!commitRes.ok) {
      expect(commitRes.code).toBe("generation_run_status_invalid");
    }
  });

  it("commitPreview 保存 G1 普通问题草稿并标记 publishBlocked=true", async () => {
    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    const reportDig = `sha256:${randomUUID().slice(0, 32)}`;
    const bDigest = uiBundleDigest(SAMPLE_BUNDLE);
    const now = new Date();

    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "p0-v1",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now,
    });

    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run.id,
      reportDigest: reportDig,
      validationProfileVersion: "p0-validation-v1",
      validationReport: {
        plannedCases: 2,
        completedCases: 2,
        cases: [],
        issues: [{ code: "contrast_low", severity: "warning" }],
      },
      validationIssues: [{ code: "contrast_low", severity: "warning" }],
      publishBlocked: true,
      now,
    });

    const commitRes = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      membershipId: seed.membershipId,
      now,
    });

    expect(commitRes.ok).toBe(true);
    if (commitRes.ok) {
      const draft = await releaseRepo.findDraftById(commitRes.draftVersionId);
      expect(draft?.publishBlocked).toBe(true);
      expect(draft?.validationIssues).toEqual([
        { code: "contrast_low", severity: "warning" },
      ]);
    }
  });

  it("commitPreview 在 digest 不匹配时拒绝提交", async () => {
    const candidateDig = `sha256:${randomUUID().slice(0, 32)}`;
    const reportDig = `sha256:${randomUUID().slice(0, 32)}`;
    const bDigest = uiBundleDigest(SAMPLE_BUNDLE);
    const now = new Date();

    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: SAMPLE_BUNDLE,
      catalogVersion: "p0-v1",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now,
    });

    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run.id,
      reportDigest: reportDig,
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

    // candidateDigest 不匹配
    const res1 = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: "wrong-candidate-digest",
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      now,
    });
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.code).toBe("candidate_digest_mismatch");

    // reportDigest 不匹配
    const res2 = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: "wrong-report-digest",
      now,
    });
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.code).toBe("report_digest_mismatch");

    // uiBundleDigest 不匹配
    const res3 = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: "wrong-bundle-digest",
      reportDigest: reportDig,
      now,
    });
    expect(res3.ok).toBe(false);
    if (!res3.ok) expect(res3.code).toBe("ui_bundle_digest_mismatch");
  });

  it("PreviewSelection 切换与 published 哨兵语义", async () => {
    // 切换到 published
    await selectionRepo.upsertSelection({
      appId: seed.appId,
      membershipId: seed.membershipId,
      kind: "published",
    });

    const s1 = await selectionRepo.findSelection(seed.appId, seed.membershipId);
    expect(s1?.kind).toBe("published");
    expect(s1?.versionId).toBeNull(); // published 只存哨兵

    // 切换到 draft
    const draftId = randomUUID();
    await selectionRepo.upsertSelection({
      appId: seed.appId,
      membershipId: seed.membershipId,
      kind: "draft",
      versionId: draftId,
      revision: 1,
    });

    const s2 = await selectionRepo.findSelection(seed.appId, seed.membershipId);
    expect(s2?.kind).toBe("draft");
    expect(s2?.versionId).toBe(draftId);
  });
});
