/**
 * S7：共享 app-guard 中间件语义测试。
 * - 草稿列表：owner/editor 可读，viewer 404（conceal）
 * - 当前发布版本：任何有效成员可读（viewer 只读预览依赖）
 * - 已删除应用：全部正常路由 404
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../helpers/test-database.ts";
import {
  api,
  createTestApp,
  loginViaOtp,
  type TestAppHandle,
} from "../helpers/test-app.ts";

const ADMIN = "guard-admin@example.com";
const OWNER = "guard-owner@example.com";
const EDITOR = "guard-editor@example.com";
const VIEWER = "guard-viewer@example.com";

describe("S7 应用授权守卫", () => {
  let handle: TestDatabaseHandle;
  let t: TestAppHandle;
  let appId: string;
  let ownerCookie: string;
  let editorCookie: string;
  let viewerCookie: string;
  let ownerMembershipId: string;

  async function inviteAndAccept(email: string, role: "editor" | "viewer") {
    const user = await t.authRepository.findUserByEmailNormalized(email);
    const invitation = await t.appRepository.createInvitation({
      appId,
      emailNormalized: email,
      role,
      createdByUserId: user!.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    return (await t.appRepository.acceptInvitation({
      invitationId: invitation.id,
      userId: user!.id,
      now: new Date(),
    }))!;
  }

  /** 产生一个 committed 草稿；publish=true 时发布（空业务 Schema）。 */
  async function produceDraft(publish: boolean) {
    const gid = `guard-${Math.random().toString(36).slice(2)}`;
    await t.lifecycle.startRun({
      appId,
      membershipId: ownerMembershipId,
      generationId: gid,
    });
    await t.lifecycle.markAwaitingPreview({
      generationId: gid,
      candidateSpec: { root: "p" },
      candidateBusinessSchema: { collections: [] },
      diagnostics: null,
    });
    await t.lifecycle.applyResult({ generationId: gid, outcome: "committed" });
    if (!publish) return;
    const run = await t.releaseRepository.findRunByCorrelationRef(gid);
    const drafts = await t.releaseRepository.listDrafts(appId);
    const draft = drafts.find((d) => d.generationRunId === run!.id)!;
    const res = await api(t.app, `/api/apps/${appId}/releases/publish`, {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ draftId: draft.id, protocolVersion: 2 }),
    });
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    handle = await createTestDatabase();
    t = createTestApp(handle, { adminEmails: [ADMIN] });
    await loginViaOtp(t, ADMIN);
    const admin = await t.authRepository.findUserByEmailNormalized(ADMIN);
    for (const email of [OWNER, EDITOR, VIEWER]) {
      await t.authRepository.createUser({
        emailNormalized: email,
        emailDisplay: email,
        isAdmin: false,
      });
    }
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    await t.authRepository.createCreatorGrant({
      userId: owner!.id,
      grantedByUserId: admin!.id,
    });
    ownerCookie = await loginViaOtp(t, OWNER);
    editorCookie = await loginViaOtp(t, EDITOR);
    viewerCookie = await loginViaOtp(t, VIEWER);
    const created = await t.appRepository.createAppWithOwner({
      name: "guard-app",
      createdByUserId: owner!.id,
    });
    appId = created.app.id;
    ownerMembershipId = created.ownerMembership.id;
    await inviteAndAccept(EDITOR, "editor");
    await inviteAndAccept(VIEWER, "viewer");
    await produceDraft(false);
    await produceDraft(true);
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("草稿列表：owner/editor 200，viewer 404", async () => {
    for (const [cookie, expected] of [
      [ownerCookie, 200],
      [editorCookie, 200],
      [viewerCookie, 404],
    ] as const) {
      const res = await api(t.app, `/api/apps/${appId}/drafts`, { cookie });
      expect(res.status).toBe(expected);
    }
  });

  it("当前发布版本：owner/editor/viewer 均可读", async () => {
    for (const cookie of [ownerCookie, editorCookie, viewerCookie]) {
      const res = await api(t.app, `/api/apps/${appId}/releases/current`, {
        cookie,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { current: { spec: unknown } | null };
      expect(body.current).not.toBeNull();
    }
  });

  it("发布历史与发布/回滚仍仅 owner", async () => {
    for (const cookie of [editorCookie, viewerCookie]) {
      const res = await api(t.app, `/api/apps/${appId}/releases/published`, {
        cookie,
      });
      expect(res.status).toBe(404);
    }
  });

  it("应用删除后全部正常路由 404", async () => {
    const del = await api(t.app, `/api/apps/${appId}`, {
      method: "DELETE",
      cookie: ownerCookie,
    });
    expect(del.status).toBe(200);
    for (const path of [
      `/api/apps/${appId}/drafts`,
      `/api/apps/${appId}/releases/current`,
      `/api/apps/${appId}/releases/published`,
      `/api/apps/${appId}/generation/runs`,
    ]) {
      const res = await api(t.app, path, { cookie: ownerCookie });
      expect(res.status, path).toBe(404);
    }
    // 已删除应用不得出现在应用列表（设计 §4.5）
    const list = await api(t.app, "/api/apps", { cookie: ownerCookie });
    const body = (await list.json()) as {
      apps: Array<{ app: { id: string } }>;
    };
    expect(body.apps.some((a) => a.app.id === appId)).toBe(false);
  });
});
