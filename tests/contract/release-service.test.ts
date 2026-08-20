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

const OWNER = "s4-owner@example.com";
const OUTSIDER = "s4-outsider@example.com";

/**
 * S4 草稿/发布/回滚/剪枝测试（计划 S4 verify，设计 §4.2、AC3/AC4）：
 * - apply 失败不产生可发布草稿；只有 ready 草稿可发布；
 * - 非 owner 发布/回滚被拒（404）；
 * - S4 Schema 门禁：首次仅空业务 Schema；后续须与当前已发布相同；
 * - 第 11 个版本剪枝时当前发布版本可用；回滚只移动指针（幂等）。
 */
describe("release service (S4)", () => {
  let handle: TestDatabaseHandle;
  let t: TestAppHandle;
  let appId: string;
  let membershipId: string;
  let ownerCookie: string;
  let outsiderCookie: string;

  async function createReadyDraft(
    generationId: string,
    spec: unknown,
    businessSchema: unknown = null,
  ): Promise<string> {
    await t.lifecycle.startRun({ appId, membershipId, generationId });
    await t.lifecycle.markAwaitingPreview({
      generationId,
      candidateSpec: spec,
      candidateBusinessSchema: businessSchema,
      diagnostics: null,
    });
    const committed = await t.lifecycle.applyResult({
      generationId,
      outcome: "committed",
    });
    expect(committed).toBe(true);
    const run = await t.releaseRepository.findRunByCorrelationRef(generationId);
    const drafts = await t.releaseRepository.listDrafts(appId);
    const draft = drafts.find((d) => d.generationRunId === run!.id);
    expect(draft).toBeDefined();
    return draft!.id;
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    t = createTestApp(handle, { adminEmails: [OWNER, OUTSIDER] });
    ownerCookie = await loginViaOtp(t, OWNER);
    outsiderCookie = await loginViaOtp(t, OUTSIDER);
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    const created = await t.appRepository.createAppWithOwner({
      name: "发布回滚",
      createdByUserId: owner!.id,
    });
    appId = created.app.id;
    membershipId = created.ownerMembership.id;
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("生成失败/中止不产生可发布草稿", async () => {
    await t.lifecycle.startRun({
      appId,
      membershipId,
      generationId: "s4-fail-1",
    });
    await t.lifecycle.markAwaitingPreview({
      generationId: "s4-fail-1",
      candidateSpec: { root: "p" },
      candidateBusinessSchema: null,
      diagnostics: null,
    });
    const failed = await t.lifecycle.applyResult({
      generationId: "s4-fail-1",
      outcome: "failed",
      diagnostics: { error: "校验失败" },
    });
    expect(failed).toBe(true);
    const drafts = await t.releaseRepository.listDrafts(appId);
    expect(drafts).toHaveLength(0);
  });

  it("S5b 门禁：首次发布的非空 Schema 必须通过 fail-closed 校验", async () => {
    // 非法 Schema（字段缺 fields）→ 400 schema_invalid
    const invalidDraftId = await createReadyDraft(
      "s4-gate-1",
      { root: "p" },
      { collections: [{ key: "todos" }] },
    );
    const invalid = await api(t.app, `/api/apps/${appId}/releases/publish`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ draftId: invalidDraftId, protocolVersion: 2 }),
    });
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: { code: string } };
    expect(invalidBody.error.code).toBe("schema_invalid");
    // S5b 后：合法非空 Schema 首次发布允许（尚无业务记录，无迁移风险）。
    // 用独立应用验证，避免污染本文件后续用例的空 Schema 基线。
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    const app2 = await t.appRepository.createAppWithOwner({
      name: "首次非空发布",
      createdByUserId: owner!.id,
    });
    const gid2 = "s4-gate-1c";
    await t.lifecycle.startRun({
      appId: app2.app.id,
      membershipId: app2.ownerMembership.id,
      generationId: gid2,
    });
    await t.lifecycle.markAwaitingPreview({
      generationId: gid2,
      candidateSpec: { root: "p" },
      candidateBusinessSchema: {
        collections: [
          {
            key: "notes",
            recordScope: "shared",
            fields: [{ key: "n", type: "string", required: true }],
          },
        ],
      },
      diagnostics: null,
    });
    await t.lifecycle.applyResult({ generationId: gid2, outcome: "committed" });
    const run2 = await t.releaseRepository.findRunByCorrelationRef(gid2);
    const drafts2 = await t.releaseRepository.listDrafts(app2.app.id);
    const draft2 = drafts2.find((d) => d.generationRunId === run2!.id)!;
    const valid = await api(
      t.app,
      `/api/apps/${app2.app.id}/releases/publish`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ draftId: draft2.id, protocolVersion: 2 }),
      },
    );
    expect(valid.status).toBe(200);
    // 主应用基线未被污染：仍无发布指针
    const pointer = await t.releaseRepository.getReleasePointer(appId);
    expect(pointer).toBeNull();
  });

  it("发布空 Schema 草稿成功；非 owner 发布/回滚被拒", async () => {
    const draftId = await createReadyDraft("s4-pub-1", { root: "page-v1" });
    const outsider = await api(t.app, `/api/apps/${appId}/releases/publish`, {
      method: "POST",
      cookie: outsiderCookie,
      body: JSON.stringify({ draftId, protocolVersion: 2 }),
    });
    expect(outsider.status).toBe(404);
    const published = await apiJson<{ publishedVersionId: string }>(
      t.app,
      `/api/apps/${appId}/releases/publish`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ draftId, protocolVersion: 2 }),
      },
    );
    expect(published.status).toBe(200);
    const current = await apiJson<{
      current: { publishedVersionId: string; spec: unknown } | null;
    }>(t.app, `/api/apps/${appId}/releases/current`, { cookie: ownerCookie });
    expect(current.body.current?.publishedVersionId).toBe(
      published.body.publishedVersionId,
    );
    expect(current.body.current?.spec).toEqual({ root: "page-v1" });
    const outsiderRollback = await api(
      t.app,
      `/api/apps/${appId}/releases/rollback`,
      {
        method: "POST",
        cookie: outsiderCookie,
        body: JSON.stringify({
          publishedVersionId: published.body.publishedVersionId,
          protocolVersion: 2,
        }),
      },
    );
    expect(outsiderRollback.status).toBe(404);
  });

  it("S5b 门禁：候选 Schema 不同且无迁移计划 → 409 migration_plan_required", async () => {
    const draftId = await createReadyDraft(
      "s4-gate-2",
      { root: "p" },
      { collections: [] }, // 空集合数组与 null 不同：规范化不同
    );
    const res = await api(t.app, `/api/apps/${appId}/releases/publish`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ draftId, protocolVersion: 2 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("migration_plan_required");
  });

  it("同 Schema 再发布与回滚：指针移动且幂等", async () => {
    // 当前已发布 businessSchema 为 null（上一步发布）
    const draftA = await createReadyDraft("s4-rb-1", { root: "page-a" });
    const pubA = await apiJson<{ publishedVersionId: string }>(
      t.app,
      `/api/apps/${appId}/releases/publish`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ draftId: draftA, protocolVersion: 2 }),
      },
    );
    expect(pubA.status).toBe(200);
    const draftB = await createReadyDraft("s4-rb-2", { root: "page-b" });
    const pubB = await apiJson<{ publishedVersionId: string }>(
      t.app,
      `/api/apps/${appId}/releases/publish`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ draftId: draftB, protocolVersion: 2 }),
      },
    );
    expect(pubB.status).toBe(200);
    // 回滚到 A
    const rollback = await api(t.app, `/api/apps/${appId}/releases/rollback`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        publishedVersionId: pubA.body.publishedVersionId,
        protocolVersion: 2,
      }),
    });
    expect(rollback.status).toBe(200);
    const current = await apiJson<{
      current: { publishedVersionId: string; spec: unknown } | null;
    }>(t.app, `/api/apps/${appId}/releases/current`, { cookie: ownerCookie });
    expect(current.body.current?.publishedVersionId).toBe(
      pubA.body.publishedVersionId,
    );
    expect(current.body.current?.spec).toEqual({ root: "page-a" });
    // 幂等：再次回滚到 A
    const again = await api(t.app, `/api/apps/${appId}/releases/rollback`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({
        publishedVersionId: pubA.body.publishedVersionId,
        protocolVersion: 2,
      }),
    });
    expect(again.status).toBe(200);
  });

  it("剪枝保留当前发布版本 + 最近九个其他版本（AC4）", async () => {
    // 再发布 9 个版本（此前已有 2 个：pub-1、rb-1/rb-2 中的版本）
    for (let i = 0; i < 9; i += 1) {
      const draftId = await createReadyDraft(`s4-prune-${i}`, {
        root: `page-${i}`,
      });
      const res = await api(t.app, `/api/apps/${appId}/releases/publish`, {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ draftId, protocolVersion: 2 }),
      });
      expect(res.status).toBe(200);
    }
    const listed = await apiJson<{ versions: Array<{ id: string }> }>(
      t.app,
      `/api/apps/${appId}/releases/published`,
      { cookie: ownerCookie },
    );
    expect(listed.body.versions.length).toBeLessThanOrEqual(10);
    // 当前发布版本（最新一次发布）必然在保留集合中
    const current = await apiJson<{
      current: { publishedVersionId: string } | null;
    }>(t.app, `/api/apps/${appId}/releases/current`, { cookie: ownerCookie });
    expect(current.body.current).not.toBeNull();
    expect(
      listed.body.versions.some(
        (v) => v.id === current.body.current!.publishedVersionId,
      ),
    ).toBe(true);
  });
});
