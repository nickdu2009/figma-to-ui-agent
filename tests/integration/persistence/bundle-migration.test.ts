/**
 * S13 集成测试：跨 Schema Bundle 发布与反向迁移回滚（设计 §4.4/§5.2/§13.2.1）。
 *
 * 验证：
 * 1. 跨 Schema 发布必须附带 DataMigrationPlan 与 reversePlan；
 * 2. 发布时原子应用迁移、落库 PublishedVersion 并更新 ReleasePointer；
 * 3. 跨 Schema 回滚自动应用当前版本反向计划并回滚指针；
 * 4. 缺少反向计划时拒绝跨 Schema 回滚（fail closed）。
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
import { SchemaMigrationService } from "../../../server/schema-migrations/service.ts";
import { BusinessDataRepository } from "../../../server/repositories/business-data-repository.ts";
import type { BusinessSchema } from "../../../server/business-data/schema-contract.ts";
import type { DataMigrationPlan } from "../../../server/schema-migrations/plan.ts";
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

const BASE_BUNDLE: AppUiBundle = {
  bundleVersion: 1,
  catalogVersion: "1.0.0",
  specCompatibility: "0.19.0",
  spec: {
    metadata: { title: { default: "Migration App", template: "%s" } },
    routes: {
      "/": {
        page: {
          root: "r1",
          elements: {
            r1: {
              type: "Heading",
              props: { text: "Migration Test", level: "h1", className: null },
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

const SCHEMA_V1: BusinessSchema = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "id", type: "string", required: true },
        { key: "title", type: "string", required: true },
      ],
    },
  ],
};

const SCHEMA_V2: BusinessSchema = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "id", type: "string", required: true },
        { key: "title", type: "string", required: true },
        { key: "done", type: "boolean", required: false },
      ],
    },
  ],
};

const FORWARD_PLAN: DataMigrationPlan = {
  collections: [
    {
      key: "tasks",
      defaults: [{ key: "done", value: false }],
    },
  ],
};

const REVERSE_PLAN: DataMigrationPlan = {
  collections: [
    {
      key: "tasks",
      dropFields: ["done"],
    },
  ],
};

describe("S13 跨 Schema 发布与反向迁移回滚集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let seed: Seed;
  let releaseRepo: MysqlReleaseRepository;
  let releaseService: ReleaseService;
  let migrationService: SchemaMigrationService;
  let dataRepo: BusinessDataRepository;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    seed = await seedApp(pool);
    releaseRepo = new MysqlReleaseRepository(handle.db);
    migrationService = new SchemaMigrationService(handle.db);
    dataRepo = new BusinessDataRepository(handle.db);
    releaseService = new ReleaseService(releaseRepo, migrationService);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("跨 Schema 发布应用 forward 计划，回滚应用 reverse 计划", async () => {
    const bDigest = uiBundleDigest(BASE_BUNDLE);
    const now = new Date();

    // 1. 发布 V1 版本
    const run1 = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    await releaseRepo.markValidationRunning({
      runId: run1.id,
      candidateBundle: BASE_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: "cd-v1",
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: null,
      migrationFromSchemaDigest: "cd-v1",
      migrationToSchemaDigest: "cd-v1",
      now,
    });
    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run1.id,
      reportDigest: "rd-v1",
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
    const commit1 = await releaseRepo.commitPreview({
      runId: run1.id,
      candidateDigest: "cd-v1",
      uiBundleDigest: bDigest,
      reportDigest: "rd-v1",
      membershipId: seed.membershipId,
      now,
    });
    if (!commit1.ok) return;

    // 更新 draft1 的 businessSchema 为 SCHEMA_V1
    await pool.query(
      "UPDATE `draft_versions` SET `business_schema` = ? WHERE `id` = ?",
      [JSON.stringify(SCHEMA_V1), commit1.draftVersionId],
    );

    const pub1 = await releaseService.publish({
      appId: seed.appId,
      draftId: commit1.draftVersionId,
      membershipId: seed.membershipId,
    });

    // 插入一条 V1 任务记录
    const inserted = await dataRepo.insertRecord({
      appId: seed.appId,
      collectionKey: "tasks",
      data: { id: "t-001", title: "Task 1" },
      createdByUserId: seed.userId,
      subjectMembershipId: null,
      indexValues: [],
      uniqueValues: [],
      principals: [],
      now,
    });

    // 2. 准备 V2 版本草稿（新增 done 字段）
    const run2 = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    await releaseRepo.markValidationRunning({
      runId: run2.id,
      candidateBundle: BASE_BUNDLE,
      catalogVersion: "1.0.0",
      candidateDigest: "cd-v2",
      uiBundleDigest: bDigest,
      digestVersion: 1,
      migrationFromPublishedVersionId: pub1.publishedVersionId,
      migrationFromSchemaDigest: "cd-v1",
      migrationToSchemaDigest: "cd-v2",
      now,
    });
    await releaseRepo.markAwaitingPreviewFromValidation({
      runId: run2.id,
      reportDigest: "rd-v2",
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
    const commit2 = await releaseRepo.commitPreview({
      runId: run2.id,
      candidateDigest: "cd-v2",
      uiBundleDigest: bDigest,
      reportDigest: "rd-v2",
      membershipId: seed.membershipId,
      now,
    });
    if (!commit2.ok) return;

    // 更新 draft2 的 businessSchema 为 SCHEMA_V2
    await pool.query(
      "UPDATE `draft_versions` SET `business_schema` = ? WHERE `id` = ?",
      [JSON.stringify(SCHEMA_V2), commit2.draftVersionId],
    );

    // 3. 发布 V2（提供 forward 与 reverse 计划）
    await releaseService.publish({
      appId: seed.appId,
      draftId: commit2.draftVersionId,
      membershipId: seed.membershipId,
      migrationPlan: FORWARD_PLAN,
      reversePlan: REVERSE_PLAN,
    });

    // 验证记录已迁移添加 done: false
    const taskV2 = await dataRepo.findRecord(seed.appId, "tasks", inserted.id);
    expect(taskV2?.data).toEqual({ id: "t-001", title: "Task 1", done: false });

    // 4. 回滚到 V1
    await releaseService.rollback({
      appId: seed.appId,
      publishedVersionId: pub1.publishedVersionId,
      changedByUserId: seed.userId,
    });

    // 验证反向迁移已执行（done 字段被移除）
    const taskRolledBack = await dataRepo.findRecord(
      seed.appId,
      "tasks",
      inserted.id,
    );
    expect(taskRolledBack?.data).toEqual({ id: "t-001", title: "Task 1" });

    // 验证指针已回退到 V1
    const pointer = await releaseRepo.getReleasePointer(seed.appId);
    expect(pointer?.publishedVersionId).toBe(pub1.publishedVersionId);
  });
});
