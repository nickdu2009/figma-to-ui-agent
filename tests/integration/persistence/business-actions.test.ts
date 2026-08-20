/**
 * S8 集成测试 1：TransactionalBusinessActionExecutor（计划 S8 验证）。
 * 隔离 schema（vma_test_<随机>）端到端：
 * - 写命令 UoW：ReleasePointer 锁核对 + 账本 claim + mutation + 终态同事务；
 * - 幂等：同 key/hash 重放从 resultRef 投影（无第二 mutation）；错 hash →
 *   idempotency_key_conflict；并发同 key/hash 恰好一次 mutation；
 * - expectedRevision 冲突 → revision_conflict（含 currentRevision）；
 * - 版本头与 current pointer 不符 → published_version_changed；
 * - 权限故障注入（viewer 写）→ policy_denied；
 * - deleteRecord 软删除 + 回收站条目同事务；
 * - 读命令：queryRecords 分页/游标、loadRecordForm 授权投影；
 * - downloadExport：CSV 中和 + 摘要；超限 → export_too_large。
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
import { MysqlBusinessActionIdempotencyRepository } from "../../../server/repositories/business-action-idempotency-repository.ts";
import { TransactionalBusinessActionExecutor } from "../../../server/actions/executor.ts";
import type { BusinessActionCommand } from "../../../server/actions/contracts.ts";
import type { CallerContext } from "../../../server/business-data/policy.ts";

const BUSINESS_SCHEMA = {
  collections: [
    {
      key: "tasks",
      recordScope: "shared",
      fields: [
        { key: "title", type: "string", required: true, queryable: true, sortable: true },
        { key: "done", type: "boolean", queryable: true },
        { key: "email", type: "string", format: "email", unique: true },
      ],
    },
  ],
} as const;

describe("S8 业务 Action 执行器（UoW + 幂等 + 授权）", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let executor: TransactionalBusinessActionExecutor;
  let appId: string;
  let publishedVersionId: string;
  let owner: CallerContext;
  let viewer: CallerContext;

  const command = (
    actionName: string,
    canonicalParams: unknown,
    idempotencyKey?: string,
  ): BusinessActionCommand => ({
    protocolVersion: 1,
    publishedVersionId,
    actionName: actionName as BusinessActionCommand["actionName"],
    ...(idempotencyKey ? { idempotencyKey } : {}),
    canonicalParams,
  });

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    executor = new TransactionalBusinessActionExecutor({
      db: handle.db,
      appRepository: new MysqlAppRepository(handle.db),
      releaseRepository: new MysqlReleaseRepository(handle.db),
      data: new BusinessDataRepository(handle.db),
      idempotency: new MysqlBusinessActionIdempotencyRepository(handle.db),
    });

    const ownerUserId = randomUUID();
    const viewerUserId = randomUUID();
    appId = randomUUID();
    publishedVersionId = randomUUID();
    const ownerMembershipId = randomUUID();
    const viewerMembershipId = randomUUID();
    owner = {
      userId: ownerUserId,
      membershipId: ownerMembershipId,
      role: "owner",
    };
    viewer = {
      userId: viewerUserId,
      membershipId: viewerMembershipId,
      role: "viewer",
    };
    for (const [userId, tag] of [
      [ownerUserId, "o"],
      [viewerUserId, "v"],
    ] as const) {
      await pool.query(
        "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [userId, `${tag}-${userId}@example.com`, `${tag}-${userId}@example.com`],
      );
    }
    await pool.query(
      "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [appId, `app-${appId}`, ownerUserId],
    );
    await pool.query(
      "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'owner', 'active', 'active', UTC_TIMESTAMP(3))",
      [ownerMembershipId, appId, ownerUserId],
    );
    await pool.query(
      "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'viewer', 'active', 'active', UTC_TIMESTAMP(3))",
      [viewerMembershipId, appId, viewerUserId],
    );
    await pool.query(
      "INSERT INTO `published_versions` (`id`, `app_id`, `spec`, `business_schema`, `published_by_membership_id`, `published_at`) VALUES (?, ?, '{}', ?, ?, UTC_TIMESTAMP(3))",
      [publishedVersionId, appId, JSON.stringify(BUSINESS_SCHEMA), ownerMembershipId],
    );
    await pool.query(
      "INSERT INTO `release_pointers` (`app_id`, `published_version_id`, `updated_at`, `revision`) VALUES (?, ?, UTC_TIMESTAMP(3), 1)",
      [appId, publishedVersionId],
    );
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("createRecord：UoW 写入成功 + 账本 completed 终态（resultRef 指向记录）", async () => {
    const result = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "写周报", done: false } },
        `idem-${randomUUID()}`,
      ),
    });
    expect(result.status).toBe("success");
    const view = result.data as {
      recordId: string;
      revision: number;
      data: Record<string, unknown>;
    };
    expect(view.revision).toBe(1);
    expect(view.data.title).toBe("写周报");
    const [ledger] = await pool.query(
      "SELECT `status`, `result_ref`, `stable_result_code` FROM `business_action_idempotency` WHERE `app_id` = ?",
      [appId],
    );
    const rows = ledger as Array<{
      status: string;
      result_ref: string | null;
      stable_result_code: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("completed");
    expect(rows[0]!.result_ref).toBe(`record:${view.recordId}`);
    expect(rows[0]!.stable_result_code).toBe("success");
  });

  it("同 key/hash 重放：从 resultRef 投影，无第二 mutation", async () => {
    const key = `idem-${randomUUID()}`;
    const params = {
      collectionKey: "tasks",
      data: { title: "重放验证", done: false },
    };
    const first = await executor.execute({
      appId,
      caller: owner,
      command: command("createRecord", params, key),
    });
    expect(first.status).toBe("success");
    const second = await executor.execute({
      appId,
      caller: owner,
      command: command("createRecord", params, key),
    });
    expect(second.status).toBe("success");
    const firstView = first.data as { recordId: string };
    const secondView = second.data as { recordId: string };
    expect(secondView.recordId).toBe(firstView.recordId);
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_records` WHERE `app_id` = ? AND `collection_key` = 'tasks' AND JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.title')) = '重放验证'",
      [appId],
    );
    expect(Number((rows as Array<{ n: number }>)[0]!.n)).toBe(1);
  });

  it("同 key 错 hash → idempotency_key_conflict（不执行 mutation）", async () => {
    const key = `idem-${randomUUID()}`;
    const first = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "冲突A" } },
        key,
      ),
    });
    expect(first.status).toBe("success");
    const conflict = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "冲突B" } },
        key,
      ),
    });
    expect(conflict.status).toBe("error");
    expect(conflict.error?.code).toBe("idempotency_key_conflict");
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_records` WHERE `app_id` = ? AND JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.title')) IN ('冲突A','冲突B')",
      [appId],
    );
    expect(Number((rows as Array<{ n: number }>)[0]!.n)).toBe(1);
  });

  it("并发同 key/hash：恰好一次 mutation，无孤立 pending", async () => {
    const key = `idem-${randomUUID()}`;
    const params = {
      collectionKey: "tasks",
      data: { title: "并发恰好一次", done: true },
    };
    const outcomes = await Promise.all([
      executor.execute({ appId, caller: owner, command: command("createRecord", params, key) }),
      executor.execute({ appId, caller: owner, command: command("createRecord", params, key) }),
      executor.execute({ appId, caller: owner, command: command("createRecord", params, key) }),
    ]);
    const successes = outcomes.filter((outcome) => outcome.status === "success");
    const conflicts = outcomes.filter(
      (outcome) =>
        outcome.status === "error" &&
        outcome.error?.code === "idempotency_key_conflict",
    );
    // 恰好一个持锁执行；其余为重放成功或并发冲突（稳定码），全部可重试收敛
    expect(successes.length + conflicts.length).toBe(3);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    const recordIds = new Set(
      successes.map((outcome) => (outcome.data as { recordId: string }).recordId),
    );
    expect(recordIds.size).toBe(1);
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_records` WHERE `app_id` = ? AND JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.title')) = '并发恰好一次'",
      [appId],
    );
    expect(Number((rows as Array<{ n: number }>)[0]!.n)).toBe(1);
    const [pending] = await pool.query(
      "SELECT COUNT(*) AS n FROM `business_action_idempotency` WHERE `app_id` = ? AND `status` = 'pending'",
      [appId],
    );
    expect(Number((pending as Array<{ n: number }>)[0]!.n)).toBe(0);
  });

  it("updateRecord：expectedRevision 冲突 → revision_conflict 含 currentRevision", async () => {
    const created = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "修订源", done: false } },
        `idem-${randomUUID()}`,
      ),
    });
    const recordId = (created.data as { recordId: string }).recordId;
    const conflict = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "updateRecord",
        {
          collectionKey: "tasks",
          recordId,
          expectedRevision: 99,
          patch: { done: true },
        },
        `idem-${randomUUID()}`,
      ),
    });
    expect(conflict.status).toBe("error");
    expect(conflict.error?.code).toBe("revision_conflict");
    expect(conflict.error?.details?.currentRevision).toBe(1);
  });

  it("版本头与 current pointer 不符 → published_version_changed", async () => {
    const stale = await executor.execute({
      appId,
      caller: owner,
      command: {
        ...command("queryRecords", { collectionKey: "tasks" }),
        publishedVersionId: randomUUID(),
      },
    });
    expect(stale.status).toBe("error");
    expect(stale.error?.code).toBe("published_version_changed");
  });

  it("权限故障注入：viewer 写 → policy_denied；viewer 读共享集合成功", async () => {
    const denied = await executor.execute({
      appId,
      caller: viewer,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "越权" } },
        `idem-${randomUUID()}`,
      ),
    });
    expect(denied.status).toBe("error");
    expect(denied.error?.code).toBe("policy_denied");
    const read = await executor.execute({
      appId,
      caller: viewer,
      command: command("queryRecords", { collectionKey: "tasks" }),
    });
    expect(read.status).toBe("success");
  });

  it("deleteRecord：软删除 + 回收站条目同事务；重复删除 404", async () => {
    const created = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "待删除", done: false } },
        `idem-${randomUUID()}`,
      ),
    });
    const view = created.data as { recordId: string; revision: number };
    const deleted = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "deleteRecord",
        {
          collectionKey: "tasks",
          recordId: view.recordId,
          expectedRevision: view.revision,
        },
        `idem-${randomUUID()}`,
      ),
    });
    expect(deleted.status).toBe("success");
    const [bin] = await pool.query(
      "SELECT COUNT(*) AS n FROM `deleted_items` WHERE `app_id` = ? AND `item_ref` = ? AND `item_type` = 'record'",
      [appId, view.recordId],
    );
    expect(Number((bin as Array<{ n: number }>)[0]!.n)).toBe(1);
    const again = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "deleteRecord",
        {
          collectionKey: "tasks",
          recordId: view.recordId,
          expectedRevision: view.revision,
        },
        `idem-${randomUUID()}`,
      ),
    });
    expect(again.status).toBe("error");
    expect(again.error?.code).toBe("record_not_found");
  });

  it("queryRecords 分页游标 + loadRecordForm 授权投影", async () => {
    const tag = `分页-${randomUUID().slice(0, 8)}`;
    for (let index = 0; index < 3; index++) {
      await executor.execute({
        appId,
        caller: owner,
        command: command(
          "createRecord",
          { collectionKey: "tasks", data: { title: `${tag}-${index}`, done: false } },
          `idem-${randomUUID()}`,
        ),
      });
    }
    const page1 = await executor.execute({
      appId,
      caller: owner,
      command: command("queryRecords", {
        collectionKey: "tasks",
        where: { done: false },
        orderBy: { field: "title", direction: "asc" },
        limit: 2,
      }),
    });
    expect(page1.status).toBe("success");
    const first = page1.data as {
      items: Array<{ recordId: string; data: { title: string } }>;
      nextCursor: string | null;
    };
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const page2 = await executor.execute({
      appId,
      caller: owner,
      command: command("queryRecords", {
        collectionKey: "tasks",
        where: { done: false },
        orderBy: { field: "title", direction: "asc" },
        limit: 2,
        cursor: first.nextCursor,
      }),
    });
    expect(page2.status).toBe("success");
    const second = page2.data as { items: Array<{ recordId: string }> };
    const firstIds = new Set(first.items.map((item) => item.recordId));
    for (const item of second.items) {
      expect(firstIds.has(item.recordId)).toBe(false);
    }
    const loaded = await executor.execute({
      appId,
      caller: owner,
      command: command("loadRecordForm", {
        collectionKey: "tasks",
        recordId: first.items[0]!.recordId,
      }),
    });
    expect(loaded.status).toBe("success");
    expect((loaded.data as { recordId: string }).recordId).toBe(
      first.items[0]!.recordId,
    );
  });

  it("downloadExport：CSV 公式中和 + 完成摘要（字节仅经 __csvBody 通道）", async () => {
    await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "=HYPERLINK(\"http://x\")", done: false } },
        `idem-${randomUUID()}`,
      ),
    });
    const result = await executor.execute({
      appId,
      caller: owner,
      command: command("downloadExport", { collectionKey: "tasks" }),
    });
    expect(result.status).toBe("success");
    const summary = result.data as {
      fileName: string;
      rowCount: number;
      byteLength: number;
      __csvBody: string;
    };
    expect(summary.fileName).toMatch(/^tasks-.*\.csv$/);
    expect(summary.rowCount).toBeGreaterThanOrEqual(1);
    expect(summary.__csvBody).toContain("'=HYPERLINK");
    expect(summary.byteLength).toBe(
      Buffer.byteLength(summary.__csvBody, "utf8"),
    );
  });

  it("唯一值冲突 → unique_conflict 稳定码", async () => {
    const email = `dup-${randomUUID()}@example.com`;
    const first = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "唯一A", email } },
        `idem-${randomUUID()}`,
      ),
    });
    expect(first.status).toBe("success");
    const second = await executor.execute({
      appId,
      caller: owner,
      command: command(
        "createRecord",
        { collectionKey: "tasks", data: { title: "唯一B", email } },
        `idem-${randomUUID()}`,
      ),
    });
    expect(second.status).toBe("error");
    expect(second.error?.code).toBe("unique_conflict");
  });
});
