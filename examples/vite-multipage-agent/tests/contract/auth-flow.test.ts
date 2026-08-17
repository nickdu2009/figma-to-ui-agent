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
import { normalizeEmail } from "../../server/auth/email.ts";

/**
 * S2 契约测试（计划 S2 验收 + AC6/AC10）：
 * 邮箱规范化、challenge 单次消费、会话创建/过期/登出、邀请接受/撤销、
 * 成员移除、拒绝移除最后 owner、未知邮箱通用接受、CSRF 跨站拒绝、
 * 越权伪造 appId 一律 404。
 */

const ADMIN = "admin@example.com";
const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";

let dbHandle: TestDatabaseHandle;
let t: TestAppHandle;

beforeAll(async () => {
  dbHandle = await createTestDatabase();
  t = createTestApp(dbHandle, { adminEmails: [normalizeEmail(ADMIN)] });
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(dbHandle);
});

describe("邮箱规范化", () => {
  it("trim + NFC + 小写", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
    // NFC 折叠：é 的组合写法与单一码点等价
    expect(normalizeEmail("café@x.com")).toBe(normalizeEmail("café@x.com"));
  });
});

describe("登录资格与通用接受结果", () => {
  it("过期邀请：不换取登录资格（评审修复回归）", async () => {
    const adminCookie = await loginViaOtp(t, ADMIN);
    const admin = await t.authRepository.findUserByEmailNormalized(ADMIN);
    const created = await t.appRepository.createAppWithOwner({
      name: "过期邀请应用",
      createdByUserId: admin!.id,
    });
    void adminCookie;
    // 直接以过期时间创建邀请（绕过路由的将来时校验，模拟历史遗留过期邀请）
    await t.appRepository.createInvitation({
      appId: created.app.id,
      emailNormalized: "expired@example.com",
      role: "viewer",
      createdByUserId: admin!.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await apiJson(t.app, "/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ email: "expired@example.com", method: "otp" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true }); // 防枚举：通用接受
    const mails = await t.authRepository.listDevMail("expired@example.com");
    expect(mails).toHaveLength(0); // 但不投递凭据
  });

  it("未知邮箱：200 accepted 但不投递凭据", async () => {
    const res = await apiJson(t.app, "/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ email: "ghost@example.com", method: "otp" }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    const mails = await t.authRepository.listDevMail("ghost@example.com");
    expect(mails).toHaveLength(0);
  });

  it("ADMIN_EMAILS 首次验证建立 admin 用户", async () => {
    const cookie = await loginViaOtp(t, ADMIN);
    const session = await apiJson<{ user: { isAdmin: boolean } }>(
      t.app,
      "/api/auth/session",
      { cookie },
    );
    expect(session.status).toBe(200);
    expect(session.body.user.isAdmin).toBe(true);
  });
});

describe("challenge 单次消费与会话生命周期", () => {
  it("同一 OTP 只能使用一次", async () => {
    const email = "once@example.com";
    // 让该邮箱具备资格：先授予邀请
    const adminCookie = await loginViaOtp(t, ADMIN);
    const user = await t.authRepository.findUserByEmailNormalized(ADMIN);
    await t.authRepository.createUser({
      emailNormalized: email,
      emailDisplay: email,
      isAdmin: false,
    });
    void user;
    void adminCookie;

    await apiJson(t.app, "/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ email, method: "otp" }),
    });
    const mails = await t.authRepository.listDevMail(email);
    const code = mails[0].body.match(/验证码：(\d{6})/)?.[1];
    expect(code).toBeTruthy();
    const first = await apiJson(t.app, "/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ method: "otp", email, code }),
    });
    expect(first.status).toBe(200);
    const second = await apiJson(t.app, "/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ method: "otp", email, code }),
    });
    expect(second.status).toBe(401);
  });

  it("magic link 全流程：投递、校验、单次消费", async () => {
    const email = "magic@example.com";
    await t.authRepository.createUser({
      emailNormalized: email,
      emailDisplay: email,
      isAdmin: false,
    });
    await apiJson(t.app, "/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ email, method: "magic_link" }),
    });
    const mails = await t.authRepository.listDevMail(email);
    const token = mails[0].body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    const first = await apiJson(t.app, "/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ method: "magic_link", token }),
    });
    expect(first.status).toBe(200);
    expect(first.setCookie).toContain("vma_session=");
    expect(first.setCookie?.toLowerCase()).toContain("httponly");
    expect(first.setCookie).toContain("SameSite=Lax");
    const second = await apiJson(t.app, "/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ method: "magic_link", token }),
    });
    expect(second.status).toBe(401);
  });

  it("登出后旧 Cookie 立即 401", async () => {
    const cookie = await loginViaOtp(t, ADMIN);
    const out = await apiJson(t.app, "/api/auth/logout", {
      method: "POST",
      cookie,
    });
    expect(out.status).toBe(200);
    const session = await apiJson(t.app, "/api/auth/session", { cookie });
    expect(session.status).toBe(401);
  });

  it("会话过期后 401", async () => {
    const cookie = await loginViaOtp(t, ADMIN);
    // 时钟拨到 8 天后（超过 7 天绝对有效期）
    t.setNow(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    const session = await apiJson(t.app, "/api/auth/session", { cookie });
    expect(session.status).toBe(401);
    t.resetNow();
  });
});

describe("CSRF 防护（GATE-00 §3）", () => {
  it("mutation 无 Origin → 403 csrf_rejected", async () => {
    const res = await api(t.app, "/api/auth/start", {
      method: "POST",
      headers: { Origin: "", "Content-Type": "application/json" },
      body: JSON.stringify({ email: ADMIN, method: "otp" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("csrf_rejected");
  });

  it("跨站 Origin → 403 csrf_rejected", async () => {
    const res = await api(t.app, "/api/auth/start", {
      method: "POST",
      headers: {
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: ADMIN, method: "otp" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("csrf_rejected");
  });

  it("白名单 Origin → 正常处理", async () => {
    const res = await apiJson(t.app, "/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ email: ADMIN, method: "otp" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("应用创建、邀请与成员", () => {
  it("无 CreatorGrant 创建应用 → 403；授予后可创建并成为 owner", async () => {
    // 测试准备：直接建立 OWNER 用户（生产路径为邀请/ADMIN_EMAILS 建立身份）
    await t.authRepository.createUser({
      emailNormalized: OWNER,
      emailDisplay: OWNER,
      isAdmin: false,
    });
    const ownerCookie = await loginViaOtp(t, OWNER);
    const denied = await apiJson(t.app, "/api/apps", {
      method: "POST",
      cookie: ownerCookie,
      body: JSON.stringify({ name: "无资格应用" }),
    });
    expect(denied.status).toBe(403);
    expect((denied.body as { error: { code: string } }).error.code).toBe(
      "creator_grant_required",
    );
    // admin 授予创建资格
    const adminCookie = await loginViaOtp(t, ADMIN);
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    expect(owner).toBeTruthy();
    const grant = await apiJson(
      t.app,
      `/api/admin/users/${owner!.id}/creator-grant`,
      { method: "POST", cookie: adminCookie },
    );
    expect(grant.status).toBe(201);
    const created = await apiJson<{ app: { id: string; myRole: string } }>(
      t.app,
      "/api/apps",
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ name: "订单系统" }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.app.myRole).toBe("owner");
  });

  it("邀请 → 受邀者登录 → 接受（新 Membership ID）→ 重复接受 409", async () => {
    const ownerCookie = await loginViaOtp(t, OWNER);
    const apps = await apiJson<{ apps: Array<{ id: string }> }>(
      t.app,
      "/api/apps",
      { cookie: ownerCookie },
    );
    const appId = apps.body.apps[0].id;

    const invite = await apiJson<{ invitation: { id: string } }>(
      t.app,
      `/api/apps/${appId}/invitations`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: JSON.stringify({ email: EDITOR, role: "editor" }),
      },
    );
    expect(invite.status).toBe(201);
    const invitationId = invite.body.invitation.id;
    // 邀请邮件已投递到开发收件箱
    const mails = await t.authRepository.listDevMail(EDITOR);
    expect(mails[0].body).toContain(invitationId);

    // 受邀者（新用户）经邀请资格登录
    const editorCookie = await loginViaOtp(t, EDITOR);
    const accepted = await apiJson<{
      membership: { membershipId: string; role: string };
    }>(t.app, `/api/invitations/${invitationId}/accept`, {
      method: "POST",
      cookie: editorCookie,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.membership.role).toBe("editor");

    // 重复接受同一邀请 → 409
    const again = await apiJson(
      t.app,
      `/api/invitations/${invitationId}/accept`,
      {
        method: "POST",
        cookie: editorCookie,
      },
    );
    expect(again.status).toBe(409);
  });

  it("成员移除与最后 owner 保护", async () => {
    const ownerCookie = await loginViaOtp(t, OWNER);
    const apps = await apiJson<{ apps: Array<{ id: string }> }>(
      t.app,
      "/api/apps",
      { cookie: ownerCookie },
    );
    const appId = apps.body.apps[0].id;
    const members = await apiJson<{
      members: Array<{ membershipId: string; role: string }>;
    }>(t.app, `/api/apps/${appId}/members`, { cookie: ownerCookie });
    const editor = members.body.members.find((m) => m.role === "editor");
    const owner = members.body.members.find((m) => m.role === "owner");
    expect(editor && owner).toBeTruthy();

    // 移除 editor：成功
    const removed = await apiJson(
      t.app,
      `/api/apps/${appId}/memberships/${editor!.membershipId}`,
      { method: "DELETE", cookie: ownerCookie },
    );
    expect(removed.status).toBe(200);
    // 移除后其成员身份立即失效（GATE-00 不可变规则 4）
    const editorCookie = await loginViaOtp(t, EDITOR);
    const after = await apiJson(t.app, `/api/apps/${appId}/members`, {
      cookie: editorCookie,
    });
    expect(after.status).toBe(404);

    // 移除最后一个 owner（自移除）→ 409
    const denyOwner = await apiJson(
      t.app,
      `/api/apps/${appId}/memberships/${owner!.membershipId}`,
      { method: "DELETE", cookie: ownerCookie },
    );
    expect(denyOwner.status).toBe(409);
    expect((denyOwner.body as { error: { code: string } }).error.code).toBe(
      "last_owner_removal",
    );
  });

  it("越权伪造 appId 一律 404（不区分存在与否）", async () => {
    const editorCookie = await loginViaOtp(t, EDITOR);
    const res = await apiJson(t.app, "/api/apps/nonexistent-app/members", {
      cookie: editorCookie,
    });
    expect(res.status).toBe(404);
  });

  it("持有应用的用户的 CreatorGrant 不可撤销（需先转移所有权）", async () => {
    const adminCookie = await loginViaOtp(t, ADMIN);
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    const res = await apiJson(
      t.app,
      `/api/admin/users/${owner!.id}/creator-grant`,
      { method: "DELETE", cookie: adminCookie },
    );
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      "ownership_transfer_required",
    );
  });
});
