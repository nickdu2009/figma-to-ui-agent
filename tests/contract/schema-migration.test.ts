import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../helpers/test-database.ts";
import {
  api,
  apiJson,
  createTestApp,
  loginViaOtp,
  type TestAppHandle,
} from "../helpers/test-app.ts";
import { deletedItems } from "../../server/db/schema.ts";
import { eq } from "drizzle-orm";

const ADMIN = "s5b-admin@example.com";
const OWNER = "s5b-owner@example.com";

const SCHEMA_V1 = {
  collections: [
    {
      key: "todos",
      recordScope: "shared",
      fields: [
        {
          key: "title",
          type: "string",
          required: true,
          queryable: true,
          sortable: true,
        },
        { key: "email", type: "string", format: "email", unique: true },
      ],
    },
  ],
};

const SCHEMA_V2 = {
  collections: [
    {
      key: "todos",
      recordScope: "shared",
      fields: [
        {
          key: "name",
          type: "string",
          required: true,
          queryable: true,
          sortable: true,
        },
        { key: "done", type: "boolean" },
        { key: "email", type: "string", format: "email", unique: true },
      ],
    },
  ],
};

const PLAN_V1_TO_V2 = {
  collections: [
    {
      key: "todos",
      dropFields: ["title"],
      mapFields: [{ key: "name", from: "title" }],
      defaults: [{ key: "done", value: false }],
    },
  ],
};

const PLAN_V2_TO_V1 = {
  collections: [
    {
      key: "todos",
      dropFields: ["done"],
      mapFields: [{ key: "title", from: "name" }],
    },
  ],
};

/**
 * S5b 测试（计划 S5b verify，设计 §4.4/§4.6、AC5/AC7/AC9/AC15）：
 * 迁移门禁、内存验证、原子提交、跨 Schema 回滚、回收站与治理端点。
 */
describe("schema migrations & recycle bin (S5b)", () => {
  let handle: TestDatabaseHandle;
  let t: TestAppHandle;
  let appId: string;
  let ownerMembershipId: string;
  let adminCookie: string;
  let ownerCookie: string;
  let seq = 0;

  async function publishDraft(
    businessSchema: unknown,
    extra: Record<string, unknown> = {},
    targetAppId: string = appId,
    membershipId: string = ownerMembershipId,
  ) {
    seq += 1;
    const gid = `s5b-${seq}`;
    await t.lifecycle.startRun({
      appId: targetAppId,
      membershipId,
      generationId: gid,
    });
    await t.lifecycle.markAwaitingPreview({
      generationId: gid,
      candidateSpec: { root: "p" },
      candidateBusinessSchema: businessSchema,
      diagnostics: null,
    });
    await t.lifecycle.applyResult({ generationId: gid, outcome: "committed" });
    const run = await t.releaseRepository.findRunByCorrelationRef(gid);
    const drafts = await t.releaseRepository.listDrafts(targetAppId);
    const draft = drafts.find((d) => d.generationRunId === run!.id)!;
    return api(t.app, `/api/apps/${targetAppId}/releases/publish`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ draftId: draft.id, ...extra }),
    });
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    // ADMIN 通过 adminEmails 引导为管理员；OWNER 为非管理员（创建者授权）
    t = createTestApp(handle, { adminEmails: [ADMIN] });
    adminCookie = await loginViaOtp(t, ADMIN);
    const admin = await t.authRepository.findUserByEmailNormalized(ADMIN);
    const owner = await t.authRepository.createUser({
      emailNormalized: OWNER,
      emailDisplay: OWNER,
      isAdmin: false,
    });
    await t.authRepository.createCreatorGrant({
      userId: owner.id,
      grantedByUserId: admin!.id,
    });
    ownerCookie = await loginViaOtp(t, OWNER);
    const created = await t.appRepository.createAppWithOwner({
      name: "迁移回收站",
      createdByUserId: owner.id,
    });
    appId = created.app.id;
    ownerMembershipId = created.ownerMembership.id;
    // 基线：发布 v1
    const v1 = await publishDraft(SCHEMA_V1);
    expect(v1.status).toBe(200);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("跨 Schema 发布无迁移计划 → 409 migration_plan_required", async () => {
    const res = await publishDraft(SCHEMA_V2);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("migration_plan_required");
  });

  it("计划未覆盖破坏性删除 → 409 migration_plan_incomplete", async () => {
    const res = await publishDraft(SCHEMA_V2, {
      migrationPlan: { collections: [{ key: "todos" }] }, // 未声明 dropFields
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("migration_plan_incomplete");
  });

  it("完整计划原子发布：记录变换 + 投影重建 + 指针移动", async () => {
    // 造数：两条记录
    const r1 = await api(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        data: { title: "任务A", email: "a@example.com" },
      }),
    });
    expect(r1.status).toBe(201);
    const r2 = await api(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        data: { title: "任务B", email: "b@example.com" },
      }),
    });
    expect(r2.status).toBe(201);
    const res = await publishDraft(SCHEMA_V2, {
      migrationPlan: PLAN_V1_TO_V2,
      reversePlan: PLAN_V2_TO_V1,
    });
    expect(res.status).toBe(200);
    // 数据已按 v2 变换：name 出现、title 消失、done 默认 false
    const query = await apiJson<{
      items: Array<{ data: Record<string, unknown> }>;
    }>(t.app, `/api/apps/${appId}/data/todos/query`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        where: [{ field: "name", op: "eq", value: "任务A" }],
      }),
    });
    expect(query.status).toBe(200);
    expect(query.body.items).toHaveLength(1);
    expect(query.body.items[0]!.data.name).toBe("任务A");
    expect(query.body.items[0]!.data.done).toBe(false);
    expect(query.body.items[0]!.data.title).toBeUndefined();
    // 发布版本存储了迁移计划与反向计划
    const current = await apiJson<{
      current: { publishedVersionId: string } | null;
    }>(t.app, `/api/apps/${appId}/releases/current`, { cookie: ownerCookie });
    const version = await t.releaseRepository.findPublishedVersionById(
      current.body.current!.publishedVersionId,
    );
    expect(version?.migrationPlan).toEqual(PLAN_V1_TO_V2);
    expect(version?.reversePlan).toEqual(PLAN_V2_TO_V1);
  });

  it("跨 Schema 回滚：有反向计划 → 200 且数据还原", async () => {
    const versions = await apiJson<{
      versions: Array<{ id: string; publishedAt: string }>;
    }>(t.app, `/api/apps/${appId}/releases/published`, { cookie: ownerCookie });
    // 最早发布的是 v1
    const v1 = versions.body.versions[versions.body.versions.length - 1]!;
    const res = await api(t.app, `/api/apps/${appId}/releases/rollback`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ publishedVersionId: v1.id }),
    });
    expect(res.status).toBe(200);
    const query = await apiJson<{
      items: Array<{ data: Record<string, unknown> }>;
    }>(t.app, `/api/apps/${appId}/data/todos/query`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        where: [{ field: "title", op: "eq", value: "任务A" }],
      }),
    });
    expect(query.status).toBe(200);
    expect(query.body.items).toHaveLength(1);
    expect(query.body.items[0]!.data.title).toBe("任务A");
  });

  it("无反向计划的跨 Schema 回滚 → 409 rollback_not_supported", async () => {
    // 再发布 v2（不带反向计划）
    const res = await publishDraft(SCHEMA_V2, {
      migrationPlan: PLAN_V1_TO_V2,
    });
    expect(res.status).toBe(200);
    const versions = await apiJson<{
      versions: Array<{ id: string }>;
    }>(t.app, `/api/apps/${appId}/releases/published`, { cookie: ownerCookie });
    const v1 = versions.body.versions[versions.body.versions.length - 1]!;
    const rollback = await api(t.app, `/api/apps/${appId}/releases/rollback`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ publishedVersionId: v1.id }),
    });
    expect(rollback.status).toBe(409);
    const body = (await rollback.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rollback_not_supported");
  });

  it("记录回收站：删除 → 列表 → 恢复；唯一占用时恢复 409", async () => {
    const created = await apiJson<{
      record: { recordId: string };
    }>(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        data: { name: "待恢复", email: "restore@example.com" },
      }),
    });
    const recordId = created.body.record.recordId;
    const del = await api(t.app, `/api/apps/${appId}/data/todos/${recordId}`, {
      method: "DELETE",
      cookie: ownerCookie,
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(del.status).toBe(200);
    const bin = await apiJson<{
      items: Array<{ id: string; recordId: string }>;
    }>(t.app, `/api/apps/${appId}/recycle-bin`, { cookie: ownerCookie });
    const item = bin.body.items.find((i) => i.recordId === recordId)!;
    expect(item).toBeDefined();
    // 占用唯一值后恢复 → 409 unique_conflict
    const occupy = await api(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        data: { name: "占位", email: "restore@example.com" },
      }),
    });
    expect(occupy.status).toBe(201);
    const conflicted = await api(
      t.app,
      `/api/apps/${appId}/recycle-bin/${item.id}/restore`,
      { method: "POST", cookie: ownerCookie, body: JSON.stringify({}) },
    );
    expect(conflicted.status).toBe(409);
    // 释放后恢复成功
    const occupyBody = (await occupy.json()) as {
      record: { recordId: string };
    };
    await api(
      t.app,
      `/api/apps/${appId}/data/todos/${occupyBody.record.recordId}`,
      {
        method: "DELETE",
        cookie: ownerCookie,
        body: JSON.stringify({ expectedRevision: 1 }),
      },
    );
    const restored = await api(
      t.app,
      `/api/apps/${appId}/recycle-bin/${item.id}/restore`,
      { method: "POST", cookie: ownerCookie, body: JSON.stringify({}) },
    );
    expect(restored.status).toBe(200);
    const visible = await api(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      { cookie: ownerCookie },
    );
    expect(visible.status).toBe(200);
  });

  it("过期条目永久清理：有界、幂等", async () => {
    // 手工置一条过期回收站条目（记录已软删）
    const created = await apiJson<{
      record: { recordId: string };
    }>(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ data: { name: "过期" } }),
    });
    const recordId = created.body.record.recordId;
    await api(t.app, `/api/apps/${appId}/data/todos/${recordId}`, {
      method: "DELETE",
      cookie: ownerCookie,
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    await handle.db
      .update(deletedItems)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(deletedItems.itemRef, recordId));
    // 非管理员触发清理 → 403
    const forbidden = await api(t.app, "/api/platform/recycle-bin/cleanup", {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({}),
    });
    expect(forbidden.status).toBe(403);
    // 管理员触发
    const cleanup = await apiJson<{ purged: number }>(
      t.app,
      "/api/platform/recycle-bin/cleanup",
      { method: "POST", cookie: adminCookie, body: JSON.stringify({}) },
    );
    expect(cleanup.status).toBe(200);
    expect(cleanup.body.purged).toBeGreaterThanOrEqual(1);
    // 幂等：再次清理 0
    const again = await apiJson<{ purged: number }>(
      t.app,
      "/api/platform/recycle-bin/cleanup",
      { method: "POST", cookie: adminCookie, body: JSON.stringify({}) },
    );
    expect(again.body.purged).toBe(0);
    // 记录已永久删除（恢复端点 404）
    const bin = await apiJson<{ items: Array<{ recordId: string }> }>(
      t.app,
      `/api/apps/${appId}/recycle-bin`,
      { cookie: ownerCookie },
    );
    expect(bin.body.items.some((i) => i.recordId === recordId)).toBe(false);
  });

  it("应用删除关闭全部正常路由；治理端点恢复后可用", async () => {
    // owner 删除应用
    const del = await api(t.app, `/api/apps/${appId}`, {
      method: "DELETE",
      cookie: ownerCookie,
    });
    expect(del.status).toBe(200);
    // 正常路由全部关闭
    const data = await api(t.app, `/api/apps/${appId}/data/todos/query`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({}),
    });
    expect(data.status).toBe(404);
    const releases = await api(t.app, `/api/apps/${appId}/releases/current`, {
      cookie: ownerCookie,
    });
    expect(releases.status).toBe(404);
    const runs = await api(t.app, `/api/apps/${appId}/generation/runs`, {
      cookie: ownerCookie,
    });
    expect(runs.status).toBe(404);
    // 非管理员治理端点 → 403
    const forbidden = await api(t.app, `/api/platform/apps/${appId}/restore`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({}),
    });
    expect(forbidden.status).toBe(403);
    // 管理员恢复
    const restore = await api(t.app, `/api/platform/apps/${appId}/restore`, {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({}),
    });
    expect(restore.status).toBe(200);
    // 恢复后路由可用
    const after = await api(t.app, `/api/apps/${appId}/releases/current`, {
      cookie: ownerCookie,
    });
    expect(after.status).toBe(200);
  });
});
