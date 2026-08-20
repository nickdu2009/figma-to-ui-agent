/**
 * S8 集成测试 4：RecycleBin UoW 回归（计划 S8 完成标准第 4 条）。
 * S8 事务原语重构后，回收站既有行为不变：软删除入站（deleted_items）、
 * restoreRecord 恢复（记录 + 投影重建 + 出站条目移除）、cleanupExpired
 * 到期硬删除。隔离 schema（vma_test_<随机>）。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlAppRepository } from "../../../server/repositories/app-repository.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";
import { BusinessDataRepository } from "../../../server/repositories/business-data-repository.ts";
import { BusinessDataService } from "../../../server/business-data/service.ts";
import { RecycleBinService } from "../../../server/recycle-bin/service.ts";
import {
  findCollection,
  validateBusinessSchema,
} from "../../../server/business-data/schema-contract.ts";
import type { CallerContext } from "../../../server/business-data/policy.ts";

const BUSINESS_SCHEMA = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "title", type: "string", required: true, queryable: true, sortable: true },
        { key: "email", type: "string", format: "email", unique: true },
      ],
    },
  ],
} as const;

describe("S8 回归：回收站行为不变", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let service: BusinessDataService;
  let recycleBin: RecycleBinService;
  let data: BusinessDataRepository;
  let appId: string;
  let owner: CallerContext;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    const appRepository = new MysqlAppRepository(handle.db);
    data = new BusinessDataRepository(handle.db);
    service = new BusinessDataService({
      appRepository,
      releaseRepository: new MysqlReleaseRepository(handle.db),
      data,
    });
    recycleBin = new RecycleBinService({ db: handle.db, appRepository, data });
    const userId = randomUUID();
    appId = randomUUID();
    const membershipId = randomUUID();
    owner = { userId, membershipId, role: "owner" };
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
    const publishedVersionId = randomUUID();
    await pool.query(
      "INSERT INTO `published_versions` (`id`, `app_id`, `spec`, `business_schema`, `published_by_membership_id`, `published_at`) VALUES (?, ?, '{}', ?, ?, UTC_TIMESTAMP(3))",
      [publishedVersionId, appId, JSON.stringify(BUSINESS_SCHEMA), membershipId],
    );
    await pool.query(
      "INSERT INTO `release_pointers` (`app_id`, `published_version_id`, `updated_at`, `revision`) VALUES (?, ?, UTC_TIMESTAMP(3), 1)",
      [appId, publishedVersionId],
    );
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("软删除入站 → restoreRecord 恢复（数据/唯一投影/出站条目）", async () => {
    const email = `recycle-${randomUUID()}@example.com`;
    const created = await service.create({
      appId,
      collectionKey: "tasks",
      caller: owner,
      data: { title: "回收站回归", email },
    });
    await service.remove({
      appId,
      collectionKey: "tasks",
      recordId: created.recordId,
      caller: owner,
      expectedRevision: 1,
    });
    // 入站条目存在
    const [binRows] = await pool.query(
      "SELECT `id` FROM `deleted_items` WHERE `app_id` = ? AND `item_ref` = ? AND `item_type` = 'record'",
      [appId, created.recordId],
    );
    const binId = (binRows as Array<{ id: string }>)[0]?.id;
    expect(binId).toBeTruthy();
    // 软删除释放唯一值占用：同 email 可再创建
    const recreated = await service.create({
      appId,
      collectionKey: "tasks",
      caller: owner,
      data: { title: "占位", email },
    });
    // 恢复被删记录（唯一值被占位 → 恢复应失败并保持回收站条目）
    const collection = findCollection(
      validateBusinessSchema(BUSINESS_SCHEMA),
      "tasks",
    )!;
    await expect(
      recycleBin.restoreRecord({
        appId,
        deletedItemId: binId!,
        collection,
      }),
    ).rejects.toThrow();
    // 清掉占位后恢复成功
    await service.remove({
      appId,
      collectionKey: "tasks",
      recordId: recreated.recordId,
      caller: owner,
      expectedRevision: 1,
    });
    await recycleBin.restoreRecord({
      appId,
      deletedItemId: binId!,
      collection,
    });
    const restored = await service.query({
      appId,
      collectionKey: "tasks",
      caller: owner,
      body: { where: [{ field: "title", op: "eq", value: "回收站回归" }] },
    });
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0]!.recordId).toBe(created.recordId);
    // 出站条目已移除
    const [binAfter] = await pool.query(
      "SELECT COUNT(*) AS n FROM `deleted_items` WHERE `id` = ?",
      [binId],
    );
    expect(Number((binAfter as Array<{ n: number }>)[0]!.n)).toBe(0);
  });

  it("cleanupExpired：到期记录硬删除且出站条目移除；未到期保留", async () => {
    const created = await service.create({
      appId,
      collectionKey: "tasks",
      caller: owner,
      data: { title: "到期清理回归" },
    });
    await service.remove({
      appId,
      collectionKey: "tasks",
      recordId: created.recordId,
      caller: owner,
      expectedRevision: 1,
    });
    // 未到期：不清理
    const early = await recycleBin.cleanupExpired(new Date());
    const [stillThere] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_records` WHERE `id` = ?",
      [created.recordId],
    );
    expect(Number((stillThere as Array<{ n: number }>)[0]!.n)).toBe(1);
    // 强制到期：把出站条目的 expires_at 改到过去
    await pool.query(
      "UPDATE `deleted_items` SET `expires_at` = UTC_TIMESTAMP(3) - INTERVAL 1 DAY WHERE `app_id` = ? AND `item_ref` = ?",
      [appId, created.recordId],
    );
    const purged = await recycleBin.cleanupExpired(new Date());
    expect(purged).toBeGreaterThanOrEqual(1);
    const [gone] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_records` WHERE `id` = ?",
      [created.recordId],
    );
    expect(Number((gone as Array<{ n: number }>)[0]!.n)).toBe(0);
    expect(early).toBeGreaterThanOrEqual(0);
  });
});
