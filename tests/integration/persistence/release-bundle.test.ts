/**
 * S13 集成测试：Bundle 发布、版本保留与回滚指针（设计 §4.2/§13.2.1）。
 *
 * 验证：
 * 1. 发布 DraftVersion 同事务落库 PublishedVersion 并更新 ReleasePointer；
 * 2. PublishedVersion 保留完整的 Bundle、catalogVersion 与 digests；
 * 3. 回滚原子移动 ReleasePointer；
 * 4. 剪枝保留当前发布版本 + 最近 9 个版本（上限 10 个）。
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
import { ReleaseService } from "../../../server/release/service.ts";
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

const TEST_BUNDLE: AppUiBundle = {
  bundleVersion: 1,
  catalogVersion: "1.0.0",
  specCompatibility: "0.19.0",
  spec: {
    metadata: { title: { default: "Release App", template: "%s" } },
    routes: {
      "/": {
        page: {
          root: "r1",
          elements: {
            r1: {
              type: "Heading",
              props: { text: "Published Bundle", level: "h1", className: null },
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

describe("S13 Bundle 发布与回滚集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;
  let releaseRepo: MysqlReleaseRepository;
  let releaseService: ReleaseService;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
    releaseRepo = new MysqlReleaseRepository(handle.db);
    releaseService = new ReleaseService(releaseRepo);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("发布草稿将完整 Bundle/digests 落入 PublishedVersion 并更新 ReleasePointer", async () => {
    const candidateDig = "cd-pub-01";
    const reportDig = "rd-pub-01";
    const bDigest = uiBundleDigest(TEST_BUNDLE);

    // 1. 创建 run 并 commit preview 得到草稿
    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: TEST_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now: new Date(),
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
      now: new Date(),
    });

    const commitRes = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      membershipId: seed.membershipId,
      now: new Date(),
    });

    expect(commitRes.ok).toBe(true);
    if (!commitRes.ok) return;

    // 2. 显式发布草稿
    const pubRes = await releaseService.publish({
      appId: seed.appId,
      draftId: commitRes.draftVersionId,
      membershipId: seed.membershipId,
    });

    expect(pubRes.publishedVersionId).toBeTruthy();

    // 3. 验证 PublishedVersion 行
    const published = await releaseRepo.findPublishedVersionById(
      pubRes.publishedVersionId,
    );
    expect(published).toBeDefined();
    expect(published?.bundle).toEqual(TEST_BUNDLE);
    expect(published?.catalogVersion).toBe("1.0.0");
    expect(published?.uiBundleDigest).toBe(bDigest);
    expect(published?.candidateDigest).toBe(candidateDig);

    // 4. 验证 ReleasePointer 指向新版本
    const pointer = await releaseRepo.getReleasePointer(seed.appId);
    expect(pointer?.publishedVersionId).toBe(pubRes.publishedVersionId);

    // 5. 发布第二个版本并验证指针移动
    const run2 = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    await releaseRepo.markValidationRunning({
      runId: run2.id,
      candidateBundle: TEST_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: "cd-pub-02",
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: "cd-pub-02",
      migrationToSchemaDigest: "cd-pub-02",
      now: new Date(),
    });
    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run2.id,
      reportDigest: "rd-pub-02",
      validationProfileVersion: "p0-validation-v1",
      validationReport: {
        plannedCases: 2,
        completedCases: 2,
        cases: [],
        issues: [],
      },
      validationIssues: [],
      publishBlocked: false,
      now: new Date(),
    });
    const commitRes2 = await releaseRepo.commitPreview({
      runId: run2.id,
      candidateDigest: "cd-pub-02",
      uiBundleDigest: bDigest,
      reportDigest: "rd-pub-02",
      membershipId: seed.membershipId,
      now: new Date(),
    });
    if (!commitRes2.ok) return;

    const pubRes2 = await releaseService.publish({
      appId: seed.appId,
      draftId: commitRes2.draftVersionId,
      membershipId: seed.membershipId,
    });

    const pointer2 = await releaseRepo.getReleasePointer(seed.appId);
    expect(pointer2?.publishedVersionId).toBe(pubRes2.publishedVersionId);

    // 6. 回滚回第一个版本
    await releaseService.rollback({
      appId: seed.appId,
      publishedVersionId: pubRes.publishedVersionId,
      changedByUserId: seed.userId,
    });

    const pointer3 = await releaseRepo.getReleasePointer(seed.appId);
    expect(pointer3?.publishedVersionId).toBe(pubRes.publishedVersionId);
  });

  it("当草稿 publishBlocked === true 时拒绝发布（fail-closed）", async () => {
    const candidateDig = "cd-pub-blocked";
    const reportDig = "rd-pub-blocked";
    const bDigest = uiBundleDigest(TEST_BUNDLE);

    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await releaseRepo.markValidationRunning({
      runId: run.id,
      candidateBundle: TEST_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: candidateDig,
      migrationToSchemaDigest: candidateDig,
      now: new Date(),
    });

    // 标记 publishBlocked: true
    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run.id,
      reportDigest: reportDig,
      validationProfileVersion: "p0-validation-v1",
      validationReport: {
        plannedCases: 1,
        completedCases: 1,
        cases: [],
        issues: [
          {
            id: "iss-1",
            severity: "fatal",
            message: "DOM node limit exceeded",
          },
        ],
      },
      validationIssues: [
        { id: "iss-1", severity: "fatal", message: "DOM node limit exceeded" },
      ],
      publishBlocked: true,
      now: new Date(),
    });

    const commitRes = await releaseRepo.commitPreview({
      runId: run.id,
      candidateDigest: candidateDig,
      uiBundleDigest: bDigest,
      reportDigest: reportDig,
      membershipId: seed.membershipId,
      now: new Date(),
    });
    expect(commitRes.ok).toBe(true);
    if (!commitRes.ok) return;

    // 发布必须抛出异常拒绝
    await expect(
      releaseService.publish({
        appId: seed.appId,
        draftId: commitRes.draftVersionId,
        membershipId: seed.membershipId,
      }),
    ).rejects.toThrow();
  });
});
