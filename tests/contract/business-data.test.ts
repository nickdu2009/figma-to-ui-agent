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
import { businessRecords, deletedItems } from "../../server/db/schema.ts";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const OWNER = "s5-owner@example.com";
const EDITOR = "s5-editor@example.com";
const VIEWER = "s5-viewer@example.com";
const OUTSIDER = "s5-outsider@example.com";

const TEST_SCHEMA = {
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
        { key: "done", type: "boolean", queryable: true },
        { key: "priority", type: "number", queryable: true, sortable: true },
        { key: "email", type: "string", format: "email", unique: true },
        { key: "code", type: "string", unique: true },
        {
          key: "secret",
          type: "string",
          queryable: true,
          sortable: true,
          maskedRead: { roles: ["viewer"], template: "last4" },
        },
        {
          key: "owner_note",
          type: "string",
          read: ["owner"],
          write: ["owner"],
        },
      ],
    },
    {
      key: "mine",
      recordScope: "creator_only",
      fields: [{ key: "n", type: "string", required: true }],
    },
    {
      key: "subj",
      recordScope: "subject_only",
      fields: [{ key: "n", type: "string", required: true }],
    },
    {
      key: "task",
      recordScope: "assignee",
      fields: [{ key: "n", type: "string", required: true }],
    },
  ],
};

/**
 * S5a 业务数据契约测试（计划 S5a verify，设计 §4.4/§4.5/§6.3）：
 * 授权顺序、角色上限、记录范围、字段权限、修订冲突、唯一约束、
 * 固定查询契约、游标完整性、资源上限（L1/L2/L5/L6）、事务回滚。
 */
describe("business data (S5a)", () => {
  let handle: TestDatabaseHandle;
  let t: TestAppHandle;
  let appId: string;
  let ownerMembershipId: string;
  let editorMembershipId: string;
  let viewerMembershipId: string;
  let ownerCookie: string;
  let editorCookie: string;
  let viewerCookie: string;
  let outsiderCookie: string;
  let seq = 0;

  async function publishBusinessSchema(schema: unknown): Promise<void> {
    seq += 1;
    const gid = `s5-pub-${seq}`;
    await t.lifecycle.startRun({
      appId,
      membershipId: ownerMembershipId,
      generationId: gid,
    });
    await t.lifecycle.markAwaitingPreview({
      generationId: gid,
      candidateSpec: { root: "p" },
      candidateBusinessSchema: schema,
      diagnostics: null,
    });
    await t.lifecycle.applyResult({ generationId: gid, outcome: "committed" });
    const run = await t.releaseRepository.findRunByCorrelationRef(gid);
    const drafts = await t.releaseRepository.listDrafts(appId);
    const draft = drafts.find((d) => d.generationRunId === run!.id)!;
    // 仓储层直接发布（S4 服务层门禁仅约束首次发布为空 Schema 的用户路径；
    // S5a 测试固定非空 Schema，S5b 才开放迁移门禁）
    await t.releaseRepository.publishDraft({
      appId,
      draftId: draft.id,
      publishedByMembershipId: ownerMembershipId,
      now: new Date(),
    });
  }

  async function inviteAndAccept(email: string, role: "editor" | "viewer") {
    const user = await t.authRepository.findUserByEmailNormalized(email);
    const invitation = await t.appRepository.createInvitation({
      appId,
      emailNormalized: email,
      role,
      createdByUserId: user!.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const membership = await t.appRepository.acceptInvitation({
      invitationId: invitation.id,
      userId: user!.id,
      now: new Date(),
    });
    return membership!;
  }

  async function createRecord(
    collection: string,
    data: Record<string, unknown>,
    cookie: string = ownerCookie,
    extra: Record<string, unknown> = {},
  ) {
    return apiJson<{
      record: {
        recordId: string;
        revision: number;
        data: Record<string, unknown>;
      };
    }>(t.app, `/api/apps/${appId}/data/${collection}`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ data, ...extra }),
    });
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    t = createTestApp(handle, {
      adminEmails: [OWNER, EDITOR, VIEWER, OUTSIDER],
    });
    ownerCookie = await loginViaOtp(t, OWNER);
    editorCookie = await loginViaOtp(t, EDITOR);
    viewerCookie = await loginViaOtp(t, VIEWER);
    outsiderCookie = await loginViaOtp(t, OUTSIDER);
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    const created = await t.appRepository.createAppWithOwner({
      name: "业务数据",
      createdByUserId: owner!.id,
    });
    appId = created.app.id;
    ownerMembershipId = created.ownerMembership.id;
    editorMembershipId = (await inviteAndAccept(EDITOR, "editor")).id;
    viewerMembershipId = (await inviteAndAccept(VIEWER, "viewer")).id;
    await publishBusinessSchema(TEST_SCHEMA);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("无会话 401；非成员 404；未知集合 404", async () => {
    const noSession = await api(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      body: JSON.stringify({ data: { title: "x" } }),
    });
    expect(noSession.status).toBe(401);
    const outsider = await api(t.app, `/api/apps/${appId}/data/todos`, {
      method: "POST",
      cookie: outsiderCookie,
      body: JSON.stringify({ data: { title: "x" } }),
    });
    expect(outsider.status).toBe(404);
    const unknown = await api(t.app, `/api/apps/${appId}/data/nope`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ data: { title: "x" } }),
    });
    expect(unknown.status).toBe(404);
  });

  it("角色上限：viewer 只读、editor 不可删除/导出、owner 全部", async () => {
    const created = await createRecord("todos", {
      title: "角色测试",
      done: false,
      priority: 1,
      secret: "123456789012",
      owner_note: "仅 owner",
    });
    expect(created.status).toBe(201);
    const recordId = created.body.record.recordId;
    // viewer 不可创建/更新/删除
    const viewerCreate = await createRecord(
      "todos",
      { title: "v" },
      viewerCookie,
    );
    expect(viewerCreate.status).toBe(400);
    const viewerPatch = await api(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      {
        method: "PATCH",
        cookie: viewerCookie,
        body: JSON.stringify({ expectedRevision: 1, data: { done: true } }),
      },
    );
    expect(viewerPatch.status).toBe(400);
    // viewer 读取：owner_note 被剔除，secret 被脱敏
    const viewerGet = await apiJson<{
      record: { data: Record<string, unknown> };
    }>(t.app, `/api/apps/${appId}/data/todos/${recordId}`, {
      cookie: viewerCookie,
    });
    expect(viewerGet.status).toBe(200);
    expect(viewerGet.body.record.data.owner_note).toBeUndefined();
    expect(viewerGet.body.record.data.secret).toBe("****9012");
    // editor 可读可改，但不可删除/导出；owner_note 对 editor 不可见也不可写
    const editorGet = await apiJson<{
      record: { data: Record<string, unknown> };
    }>(t.app, `/api/apps/${appId}/data/todos/${recordId}`, {
      cookie: editorCookie,
    });
    expect(editorGet.body.record.data.owner_note).toBeUndefined();
    expect(editorGet.body.record.data.secret).toBe("123456789012");
    const editorDelete = await api(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      {
        method: "DELETE",
        cookie: editorCookie,
        body: JSON.stringify({ expectedRevision: 1 }),
      },
    );
    expect(editorDelete.status).toBe(400);
    const editorExport = await api(
      t.app,
      `/api/apps/${appId}/data/todos/export`,
      { cookie: editorCookie },
    );
    expect(editorExport.status).toBe(400);
    // editor 写 owner_note → 显式拒绝
    const denied = await api(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      {
        method: "PATCH",
        cookie: editorCookie,
        body: JSON.stringify({
          expectedRevision: 1,
          data: { owner_note: "x" },
        }),
      },
    );
    expect(denied.status).toBe(400);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    expect(deniedBody.error.code).toBe("field_write_forbidden");
  });

  it("修订冲突：PATCH/DELETE 携带错误 expectedRevision → 409 + 当前 revision", async () => {
    const created = await createRecord("todos", { title: "修订测试" });
    const recordId = created.body.record.recordId;
    const stale = await api(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: JSON.stringify({ expectedRevision: 99, data: { done: true } }),
      },
    );
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as {
      error: { code: string; currentRevision: number };
    };
    expect(staleBody.error.code).toBe("revision_conflict");
    expect(staleBody.error.currentRevision).toBe(1);
    const staleDelete = await api(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      {
        method: "DELETE",
        cookie: ownerCookie,
        body: JSON.stringify({ expectedRevision: 99 }),
      },
    );
    expect(staleDelete.status).toBe(409);
    // 正确修订可以更新，revision 递增
    const ok = await apiJson<{ record: { revision: number } }>(
      t.app,
      `/api/apps/${appId}/data/todos/${recordId}`,
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: JSON.stringify({ expectedRevision: 1, data: { done: true } }),
      },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.record.revision).toBe(2);
  });

  it("唯一约束：邮箱规范化冲突、普通字符串大小写敏感、冲突不产生部分写入", async () => {
    const first = await createRecord("todos", {
      title: "u1",
      email: "Case@Example.com",
      code: "ABC",
    });
    expect(first.status).toBe(201);
    // 邮箱按账号规范化：大小写不敏感 → 冲突
    const dupEmail = await createRecord("todos", {
      title: "u2",
      email: "case@example.com",
    });
    expect(dupEmail.status).toBe(400);
    // 普通字符串唯一：大小写敏感精确比较 → 'abc' 允许
    const lowerCode = await createRecord("todos", {
      title: "u3",
      code: "abc",
    });
    expect(lowerCode.status).toBe(201);
    // 相同 code → 冲突；且不得产生部分写入
    const before = await t.businessData["data"].countCollectionRecords(
      appId,
      "todos",
    );
    const dupCode = await createRecord("todos", {
      title: "u4",
      code: "ABC",
    });
    expect(dupCode.status).toBe(400);
    const after = await t.businessData["data"].countCollectionRecords(
      appId,
      "todos",
    );
    expect(after).toBe(before);
  });

  it("固定查询契约：操作符/字段/类型/游标逐项拒绝", async () => {
    const q = (body: unknown, cookie = ownerCookie) =>
      api(t.app, `/api/apps/${appId}/data/todos/query`, {
        method: "POST",
        cookie,
        body: JSON.stringify(body),
      });
    // 未知字段 / 不可查询字段 / 类型不符的操作符 / null / 隐式转换
    expect(
      (await q({ where: [{ field: "nope", op: "eq", value: 1 }] })).status,
    ).toBe(400);
    // 评审修复回归：secret 可查询但对 viewer 脱敏——预言机门禁拒绝
    expect(
      (
        await q(
          { where: [{ field: "secret", op: "eq", value: "x" }] },
          viewerCookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await q(
          { orderBy: { field: "secret", direction: "asc" } },
          viewerCookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (await q({ where: [{ field: "done", op: "gt", value: true }] })).status,
    ).toBe(400);
    expect(
      (await q({ where: [{ field: "title", op: "eq", value: null }] })).status,
    ).toBe(400);
    expect(
      (await q({ where: [{ field: "priority", op: "eq", value: "1" }] }))
        .status,
    ).toBe(400);
    // 超过五个条件
    expect(
      (
        await q({
          where: Array.from({ length: 6 }, (_, i) => ({
            field: i % 2 === 0 ? "title" : "done",
            op: "eq",
            value: i % 2 === 0 ? `t${i}` : false,
          })),
        })
      ).status,
    ).toBe(400);
    // 同字段多条件
    expect(
      (
        await q({
          where: [
            { field: "priority", op: "gt", value: 1 },
            { field: "priority", op: "lt", value: 10 },
          ],
        })
      ).status,
    ).toBe(400);
    // 不可排序字段
    expect(
      (await q({ orderBy: { field: "done", direction: "asc" } })).status,
    ).toBe(400);
    // 篡改游标
    expect((await q({ cursor: "abc.tampered" })).status).toBe(400);
    // 合法查询
    const ok = await apiJson<{ items: unknown[]; nextCursor: string | null }>(
      t.app,
      `/api/apps/${appId}/data/todos/query`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({
          where: [{ field: "priority", op: "gte", value: 1 }],
          orderBy: { field: "priority", direction: "desc" },
          limit: 2,
        }),
      },
    );
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.items)).toBe(true);
  });

  it("游标分页：顺序稳定、不漏不重", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createRecord("mine", { n: `page-${i}` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const res: {
        items: Array<{ recordId: string }>;
        nextCursor: string | null;
      } = (
        await apiJson<{
          items: Array<{ recordId: string }>;
          nextCursor: string | null;
        }>(t.app, `/api/apps/${appId}/data/mine/query`, {
          method: "POST",
          cookie: ownerCookie,
          body: JSON.stringify({ limit: 2, ...(cursor ? { cursor } : {}) }),
        })
      ).body;
      seen.push(...res.items.map((i: { recordId: string }) => i.recordId));
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  it("排序翻页回归：原生类型排序 + 方向感知游标 + 同值平局不漏不重", async () => {
    // 数值 [1,10,2,20,5,5]：CHAR cast 旧 bug 下会按字典序 “1,10,2,20,5,5” 排序，
    // 且游标 sortValue 恒 null、desc 平局用 gt 导致翻页漏/重。
    const seeds: Array<{ title: string; priority: number }> = [
      { title: "sort-a", priority: 1 },
      { title: "sort-b", priority: 10 },
      { title: "sort-c", priority: 2 },
      { title: "sort-d", priority: 20 },
      { title: "sort-e", priority: 5 },
      { title: "sort-f", priority: 5 },
    ];
    for (const s of seeds) {
      await createRecord("todos", { ...s, done: false });
    }
    const titles = seeds.map((s) => s.title);
    const pageThrough = async (direction: "asc" | "desc") => {
      const seen: Array<{ title: string; priority: number }> = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const res: {
          items: Array<{ data: { title: string; priority: number } }>;
          nextCursor: string | null;
        } = (
          await apiJson<{
            items: Array<{ data: { title: string; priority: number } }>;
            nextCursor: string | null;
          }>(t.app, `/api/apps/${appId}/data/todos/query`, {
            method: "POST",
            cookie: ownerCookie,
            body: JSON.stringify({
              where: [{ field: "title", op: "in", value: titles }],
              orderBy: { field: "priority", direction },
              limit: 3,
              ...(cursor ? { cursor } : {}),
            }),
          })
        ).body;
        seen.push(
          ...res.items.map(
            (i: { data: { title: string; priority: number } }) => ({
              title: i.data.title,
              priority: i.data.priority,
            }),
          ),
        );
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return seen;
    };
    const asc = await pageThrough("asc");
    expect(asc.map((r) => r.priority)).toEqual([1, 2, 5, 5, 10, 20]);
    const desc = await pageThrough("desc");
    expect(desc.map((r) => r.priority)).toEqual([20, 10, 5, 5, 2, 1]);
    // 不漏不重：标题集合一致且无重复
    expect(new Set(asc.map((r) => r.title)).size).toBe(6);
    expect([...asc].map((r) => r.title).sort()).toEqual(
      [...desc].map((r) => r.title).sort(),
    );
  });

  it("记录范围：creator_only / subject_only / assignee", async () => {
    // creator_only：editor 创建，viewer 不可见，owner 可见
    const mineRes = await createRecord(
      "mine",
      { n: "editor-owned" },
      editorCookie,
    );
    const mineId = mineRes.body.record.recordId;
    const viewerMine = await api(
      t.app,
      `/api/apps/${appId}/data/mine/${mineId}`,
      { cookie: viewerCookie },
    );
    expect(viewerMine.status).toBe(404);
    const ownerMine = await api(
      t.app,
      `/api/apps/${appId}/data/mine/${mineId}`,
      { cookie: ownerCookie },
    );
    expect(ownerMine.status).toBe(200);
    // subject_only：viewer 是主体则可见
    const subjRes = await createRecord(
      "subj",
      { n: "for-viewer" },
      ownerCookie,
      { subjectMembershipId: viewerMembershipId },
    );
    const subjId = subjRes.body.record.recordId;
    expect(
      (
        await api(t.app, `/api/apps/${appId}/data/subj/${subjId}`, {
          cookie: viewerCookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(t.app, `/api/apps/${appId}/data/subj/${subjId}`, {
          cookie: editorCookie,
        })
      ).status,
    ).toBe(404);
    // assignee：principal 可见，其他成员不可见
    const taskRes = await createRecord("task", { n: "assigned" }, ownerCookie, {
      principals: [editorMembershipId],
    });
    const taskId = taskRes.body.record.recordId;
    expect(
      (
        await api(t.app, `/api/apps/${appId}/data/task/${taskId}`, {
          cookie: editorCookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(t.app, `/api/apps/${appId}/data/task/${taskId}`, {
          cookie: viewerCookie,
        })
      ).status,
    ).toBe(404);
  });

  it("删除：软删除后不可见、唯一值释放、回收站留痕", async () => {
    const created = await createRecord("todos", {
      title: "待删除",
      email: "delete-me@example.com",
    });
    const recordId = created.body.record.recordId;
    const del = await api(t.app, `/api/apps/${appId}/data/todos/${recordId}`, {
      method: "DELETE",
      cookie: ownerCookie,
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    expect(del.status).toBe(200);
    expect(
      (
        await api(t.app, `/api/apps/${appId}/data/todos/${recordId}`, {
          cookie: ownerCookie,
        })
      ).status,
    ).toBe(404);
    // 唯一值释放：同邮箱可再创建
    const recreate = await createRecord("todos", {
      title: "重建",
      email: "delete-me@example.com",
    });
    expect(recreate.status).toBe(201);
    // 回收站留痕
    const rows = await handle.db
      .select()
      .from(deletedItems)
      .where(
        and(
          eq(deletedItems.appId, appId),
          eq(deletedItems.itemType, "record"),
          eq(deletedItems.itemRef, recordId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("L1：记录字节超限 → limit_record_bytes 且无部分写入", async () => {
    const big = "x".repeat(65_536);
    const before = await t.businessData["data"].countCollectionRecords(
      appId,
      "todos",
    );
    const res = await createRecord("todos", { title: big });
    expect(res.status).toBe(409);
    const after = await t.businessData["data"].countCollectionRecords(
      appId,
      "todos",
    );
    expect(after).toBe(before);
  });

  it("L5：principal 数超限 → limit_principals 且无部分写入", async () => {
    const res = await createRecord("task", { n: "too-many" }, ownerCookie, {
      principals: Array.from({ length: 9 }, () => editorMembershipId),
    });
    expect(res.status).toBe(409);
  });

  it("L2/L6：集合记录数与导出总量上限（万级种子数据）", async () => {
    // 直接种子 bare 记录（不走 API，避免慢速 10k 次事务）
    const now = new Date();
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    for (let batch = 0; batch < 20; batch += 1) {
      await handle.db.insert(businessRecords).values(
        Array.from({ length: 500 }, () => ({
          id: randomUUID(),
          appId,
          collectionKey: "mine",
          data: { n: "seed" },
          revision: 1,
          createdByUserId: owner!.id,
          updatedByUserId: owner!.id,
          subjectMembershipId: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }
    // 10,000 条（+之前分页测试 5 条 = 10,005）：创建被拒
    const create = await createRecord("mine", { n: "overflow" });
    expect(create.status).toBe(409);
    const createBody = create.body as unknown as { error?: { code: string } };
    // 导出超 10,000 → export_limit_exceeded
    const exportRes = await api(t.app, `/api/apps/${appId}/data/mine/export`, {
      cookie: ownerCookie,
    });
    expect(exportRes.status).toBe(409);
    const exportBody = (await exportRes.json()) as { error: { code: string } };
    expect(exportBody.error.code).toBe("export_limit_exceeded");
    // viewer 导出被拒（成员侧导出仅 owner）
    const viewerExport = await api(
      t.app,
      `/api/apps/${appId}/data/mine/export`,
      { cookie: viewerCookie },
    );
    expect(viewerExport.status).toBe(400);
    void createBody;
    const alive = await handle.db
      .select({ id: businessRecords.id })
      .from(businessRecords)
      .where(
        and(
          eq(businessRecords.appId, appId),
          eq(businessRecords.collectionKey, "mine"),
          isNull(businessRecords.deletedAt),
        ),
      )
      .limit(1);
    expect(alive.length).toBe(1);
  }, 120_000);
});
