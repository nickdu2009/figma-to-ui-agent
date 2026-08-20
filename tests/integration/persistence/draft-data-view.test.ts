/**
 * S8 集成测试 2：DraftDataView（计划 S8 动作 6 / 验证）。
 * 隔离 schema（vma_test_<随机>）：
 * - 当前/候选 Schema 最严交集：字段候选删除→不可见、任一侧脱敏→脱敏、
 *   动作两侧都允许才可读、集合任一侧缺失→空视图；
 * - bounded query + 游标绑定（appId/draftId/policy digest）：翻页一致、
 *   篡改游标/跨 draft 游标稳定拒绝；
 * - 单条读取（迟到 load 面）；
 * - 写入/导出稳定拒绝 draft_readonly（不落存储）。
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
import { BusinessDataRepository } from "../../../server/repositories/business-data-repository.ts";
import { DraftDataViewService } from "../../../server/draft-data-view/service.ts";
import { BusinessActionError } from "../../../server/actions/contracts.ts";
import { buildIndexValues } from "../../../server/business-data/service.ts";
import {
  validateBusinessSchema,
  findCollection,
} from "../../../server/business-data/schema-contract.ts";
import type { CallerContext } from "../../../server/business-data/policy.ts";

const CURRENT_SCHEMA = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "title", type: "string", required: true, queryable: true, sortable: true },
        { key: "phone", type: "string" },
        { key: "internal_note", type: "string" },
      ],
    },
  ],
} as const;

/** 候选 Schema：phone 脱敏收紧、internal_note 删除（最严交集验证面）。 */
const CANDIDATE_SCHEMA = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "title", type: "string", required: true, queryable: true, sortable: true },
        {
          key: "phone",
          type: "string",
          maskedRead: { roles: ["owner", "editor", "viewer"], template: "phone" },
        },
      ],
    },
  ],
} as const;

describe("S8 DraftDataView：最严交集 + 游标绑定 + 只读", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let service: DraftDataViewService;
  let data: BusinessDataRepository;
  let appId: string;
  let draftId: string;
  let otherDraftId: string;
  let owner: CallerContext;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    const releaseRepository = new MysqlReleaseRepository(handle.db);
    data = new BusinessDataRepository(handle.db);
    service = new DraftDataViewService({
      db: handle.db,
      releaseRepository,
      data,
    });

    const userId = randomUUID();
    appId = randomUUID();
    draftId = randomUUID();
    otherDraftId = randomUUID();
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
      [publishedVersionId, appId, JSON.stringify(CURRENT_SCHEMA), membershipId],
    );
    await pool.query(
      "INSERT INTO `release_pointers` (`app_id`, `published_version_id`, `updated_at`, `revision`) VALUES (?, ?, UTC_TIMESTAMP(3), 1)",
      [appId, publishedVersionId],
    );
    // 草稿（候选 Schema）与另一草稿（游标跨 draft 拒绝验证面）；
    // draft_versions.generation_run_id 唯一 → 每个 draft 独立 run
    for (const id of [draftId, otherDraftId]) {
      const generationRunId = randomUUID();
      await pool.query(
        "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, 'succeeded', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [generationRunId, appId],
      );
      await pool.query(
        "INSERT INTO `draft_versions` (`id`, `app_id`, `generation_run_id`, `spec`, `business_schema`, `status`, `created_at`) VALUES (?, ?, ?, '{}', ?, 'ready', UTC_TIMESTAMP(3))",
        [id, appId, generationRunId, JSON.stringify(CANDIDATE_SCHEMA)],
      );
    }
    // 业务记录（经既有 /data 面公共 wrapper 写入——S8 兼容面）；
    // indexValues 必须与真实写入路径一致（排序/查询走 index 投影表）
    const tasksCollection = findCollection(
      validateBusinessSchema(CURRENT_SCHEMA),
      "tasks",
    )!;
    await data.insertRecord({
      appId,
      collectionKey: "tasks",
      data: { title: "交集验证-1", phone: "13800138000", internal_note: "secret" },
      createdByUserId: userId,
      subjectMembershipId: null,
      indexValues: buildIndexValues(tasksCollection, {
        title: "交集验证-1",
        phone: "13800138000",
        internal_note: "secret",
      }),
      uniqueValues: [],
      principals: [],
      now: new Date(),
    });
    await data.insertRecord({
      appId,
      collectionKey: "tasks",
      data: { title: "交集验证-2", phone: "13900139000", internal_note: "secret2" },
      createdByUserId: userId,
      subjectMembershipId: null,
      indexValues: buildIndexValues(tasksCollection, {
        title: "交集验证-2",
        phone: "13900139000",
        internal_note: "secret2",
      }),
      uniqueValues: [],
      principals: [],
      now: new Date(),
    });
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("最严交集投影：候选删除字段不可见、候选脱敏生效", async () => {
    const result = await service.queryCollection({
      appId,
      draftId,
      collectionKey: "tasks",
      caller: owner,
      request: { orderBy: { field: "title", direction: "asc" } },
    });
    expect(result.items).toHaveLength(2);
    const first = result.items[0]!;
    expect(first.data.title).toBe("交集验证-1");
    // 候选 maskedRead → 脱敏（任一侧脱敏则脱敏）
    expect(String(first.data.phone)).toMatch(/^\*\*\*/);
    // 候选已删除 internal_note → 最严交集不可见
    expect("internal_note" in first.data).toBe(false);
  });

  it("游标翻页一致；篡改游标与跨 draft 游标稳定拒绝", async () => {
    const page1 = await service.queryCollection({
      appId,
      draftId,
      collectionKey: "tasks",
      caller: owner,
      request: { orderBy: { field: "title", direction: "asc" }, limit: 1 },
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await service.queryCollection({
      appId,
      draftId,
      collectionKey: "tasks",
      caller: owner,
      request: {
        orderBy: { field: "title", direction: "asc" },
        limit: 1,
        cursor: page1.nextCursor,
      },
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]!.recordId).not.toBe(page1.items[0]!.recordId);

    // 篡改游标（HMAC 完整性）
    await expect(
      service.queryCollection({
        appId,
        draftId,
        collectionKey: "tasks",
        caller: owner,
        request: {
          orderBy: { field: "title", direction: "asc" },
          limit: 1,
          cursor: `${page1.nextCursor}x`,
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_query" });

    // 跨 draft 游标（绑定 appId/draftId/policy digest）
    await expect(
      service.queryCollection({
        appId,
        draftId: otherDraftId,
        collectionKey: "tasks",
        caller: owner,
        request: {
          orderBy: { field: "title", direction: "asc" },
          limit: 1,
          cursor: page1.nextCursor,
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_query" });
  });

  it("集合在候选侧缺失 → 空视图（不报错）", async () => {
    // 另一草稿使用一个当前侧不存在的集合键：两侧交集为空
    const empty = await service.queryCollection({
      appId,
      draftId,
      collectionKey: "nonexistent",
      caller: owner,
      request: {},
    });
    expect(empty).toEqual({ items: [], nextCursor: null });
  });

  it("单条读取：交集投影 + 不存在 404", async () => {
    const list = await service.queryCollection({
      appId,
      draftId,
      collectionKey: "tasks",
      caller: owner,
      request: { limit: 1 },
    });
    const recordId = list.items[0]!.recordId;
    const item = await service.getRecord({
      appId,
      draftId,
      collectionKey: "tasks",
      recordId,
      caller: owner,
    });
    expect(item.recordId).toBe(recordId);
    expect("internal_note" in item.data).toBe(false);
    await expect(
      service.getRecord({
        appId,
        draftId,
        collectionKey: "tasks",
        recordId: randomUUID(),
        caller: owner,
      }),
    ).rejects.toMatchObject({ code: "record_not_found" });
  });

  it("写入/导出稳定拒绝 draft_readonly，不落存储", async () => {
    expect(() => service.rejectWriteOrExport()).toThrowError(BusinessActionError);
    try {
      service.rejectWriteOrExport();
      expect.unreachable();
    } catch (error) {
      expect((error as BusinessActionError).code).toBe("draft_readonly");
      expect((error as BusinessActionError).status).toBe(409);
    }
    // 无账本、无新业务行（只读路径零写入）
    const [ledger] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_action_idempotency` WHERE `app_id` = ?",
      [appId],
    );
    expect(Number((ledger as Array<{ n: number }>)[0]!.n)).toBe(0);
    const [records] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_records` WHERE `app_id` = ?",
      [appId],
    );
    expect(Number((records as Array<{ n: number }>)[0]!.n)).toBe(2);
  });

  it("draft 不存在 → draft_data_unavailable", async () => {
    await expect(
      service.queryCollection({
        appId,
        draftId: randomUUID(),
        collectionKey: "tasks",
        caller: owner,
        request: {},
      }),
    ).rejects.toMatchObject({ code: "draft_data_unavailable" });
  });
});
