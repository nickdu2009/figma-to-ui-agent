/**
 * S8 集成测试 3：/data 公共 wrapper UoW 回归（计划 S8 完成标准第 4 条）。
 * S8 为 BusinessDataRepository 增加事务原语后，既有 public 方法保留为
 * “开启自身 transaction” 的兼容 wrapper，供 /data 路由继续使用。本测试锁定
 * 该兼容面的行为不变：create/query/update/唯一冲突/软删除语义与错误形状。
 * 隔离 schema（vma_test_<随机>）。
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

describe("S8 回归：/data 兼容 wrapper 行为不变", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let service: BusinessDataService;
  let appId: string;
  let owner: CallerContext;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    service = new BusinessDataService({
      appRepository: new MysqlAppRepository(handle.db),
      releaseRepository: new MysqlReleaseRepository(handle.db),
      data: new BusinessDataRepository(handle.db),
    });
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

  it("create → query → update → remove 全链路（既有 /data 语义）", async () => {
    const created = await service.create({
      appId,
      collectionKey: "tasks",
      caller: owner,
      data: { title: "回归记录", email: `reg-${randomUUID()}@example.com` },
    });
    expect(created.revision).toBe(1);
    expect(created.data.title).toBe("回归记录");

    const queried = await service.query({
      appId,
      collectionKey: "tasks",
      caller: owner,
      body: { where: [{ field: "title", op: "eq", value: "回归记录" }] },
    });
    expect(queried.items.some((item) => item.recordId === created.recordId)).toBe(
      true,
    );

    const updated = await service.update({
      appId,
      collectionKey: "tasks",
      recordId: created.recordId,
      caller: owner,
      expectedRevision: 1,
      patch: { title: "回归记录-改" },
    });
    expect(updated.revision).toBe(2);
    expect(updated.data.title).toBe("回归记录-改");

    await service.remove({
      appId,
      collectionKey: "tasks",
      recordId: created.recordId,
      caller: owner,
      expectedRevision: 2,
    });
    const afterRemove = await service.query({
      appId,
      collectionKey: "tasks",
      caller: owner,
      body: { where: [{ field: "title", op: "eq", value: "回归记录-改" }] },
    });
    expect(afterRemove.items).toHaveLength(0);
  });

  it("唯一值冲突保持 conflict 错误形状（unique_conflict）", async () => {
    const email = `dup-reg-${randomUUID()}@example.com`;
    await service.create({
      appId,
      collectionKey: "tasks",
      caller: owner,
      data: { title: "唯一回归A", email },
    });
    await expect(
      service.create({
        appId,
        collectionKey: "tasks",
        caller: owner,
        data: { title: "唯一回归B", email },
      }),
    ).rejects.toMatchObject({
      code: "unique_conflict",
    });
  });

  it("update expectedRevision 冲突保持 409 revision_conflict", async () => {
    const created = await service.create({
      appId,
      collectionKey: "tasks",
      caller: owner,
      data: { title: "修订回归" },
    });
    await expect(
      service.update({
        appId,
        collectionKey: "tasks",
        recordId: created.recordId,
        caller: owner,
        expectedRevision: 42,
        patch: { title: "不应生效" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "revision_conflict" });
    // 冲突未写入
    const queried = await service.query({
      appId,
      collectionKey: "tasks",
      caller: owner,
      body: { where: [{ field: "title", op: "eq", value: "不应生效" }] },
    });
    expect(queried.items).toHaveLength(0);
  });
});
