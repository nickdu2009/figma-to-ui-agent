/**
 * S8：浏览器 E2E 公共辅助。
 * - UI 登录：走真实登录页（OTP 从开发收件箱 API 读取，不依赖真实邮件）
 * - API 辅助：创建应用、邀请/接受成员（服务端授权事实为准）
 */
import { expect, type Page } from "@playwright/test";

/**
 * 并行 worker 必须使用不同邮箱：同一邮箱的并发登录会让
 * “取最新 OTP” 读到别的 worker 的验证码（凭据无效）。
 */
export function adminEmailFor(workerIndex: number): string {
  return `e2e-admin-${workerIndex}@example.com`;
}
export function editorEmailFor(workerIndex: number): string {
  return `e2e-editor-${workerIndex}@example.com`;
}
export function viewerEmailFor(workerIndex: number): string {
  return `e2e-viewer-${workerIndex}@example.com`;
}

async function fetchOtpCode(page: Page, email: string): Promise<string> {
  await expect
    .poll(async () => {
      const res = await page.request.get(
        `/api/dev/mail-inbox?email=${encodeURIComponent(email)}`,
      );
      if (!res.ok()) return null;
      const body = (await res.json()) as {
        mails: Array<{ body: string; createdAt: string }>;
      };
      const latest = body.mails[0];
      const match = latest?.body.match(/验证码：(\d{6})/);
      return match?.[1] ?? null;
    })
    .not.toBeNull();
  const res = await page.request.get(
    `/api/dev/mail-inbox?email=${encodeURIComponent(email)}`,
  );
  const body = (await res.json()) as { mails: Array<{ body: string }> };
  const match = body.mails[0]!.body.match(/验证码：(\d{6})/);
  return match![1];
}

/** 通过真实登录页完成 OTP 登录，落到应用门。 */
export async function uiLogin(page: Page, email: string): Promise<void> {
  await page.goto("/");
  const login = page.getByTestId("login-page");
  await expect(login).toBeVisible();
  await login.getByRole("textbox").fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByTestId("otp-hint")).toBeVisible();
  await expect(page.getByTestId("dev-otp-code")).toHaveText(/\d{6}/);
  const code = await fetchOtpCode(page, email);
  await login.getByRole("textbox").fill(code);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("app-gate")).toBeVisible();
}

/** 通过 API 创建应用（当前会话必须是已登录用户）。返回 appId。 */
export async function createAppViaApi(
  page: Page,
  name: string,
): Promise<string> {
  // 管理员自助授予创建资格（幂等：已授予时服务端冲突忽略）
  const session = await page.request.get("/api/auth/session");
  const { user } = (await session.json()) as { user: { id: string } };
  await page.request.post(`/api/admin/users/${user.id}/creator-grant`, {
    data: {},
    headers: { Origin: "http://127.0.0.1:3100" },
  });
  const res = await page.request.post("/api/apps", {
    data: { name },
    headers: { Origin: "http://127.0.0.1:3100" },
  });
  if (!res.ok())
    throw new Error(`创建应用失败：${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { app: { id: string } };
  return body.app.id;
}

/**
 * owner 发出邀请（被邀请人无需已登录）。返回 invitationId。
 * 顺序约束（S2 授权）：必须先有有效邀请，被邀请人邮箱才具备登录资格。
 */
export async function inviteViaApi(
  ownerPage: Page,
  appId: string,
  email: string,
  role: "editor" | "viewer",
): Promise<string> {
  const invite = await ownerPage.request.post(
    `/api/apps/${appId}/invitations`,
    { data: { email, role }, headers: { Origin: "http://127.0.0.1:3100" } },
  );
  if (!invite.ok()) throw new Error(`邀请失败：${invite.status()}`);
  const list = await ownerPage.request.get(`/api/apps/${appId}/invitations`);
  const { invitations } = (await list.json()) as {
    invitations: Array<{ id: string; email: string }>;
  };
  const found = invitations.find((i) => i.email === email);
  if (!found) throw new Error("邀请未出现在列表中");
  return found.id;
}

/** 被邀请人（已登录）接受邀请。 */
export async function acceptInvitationViaApi(
  inviteePage: Page,
  invitationId: string,
): Promise<void> {
  const accept = await inviteePage.request.post(
    `/api/invitations/${invitationId}/accept`,
    { data: {}, headers: { Origin: "http://127.0.0.1:3100" } },
  );
  if (!accept.ok()) throw new Error(`接受邀请失败：${accept.status()}`);
}

/** 直接进入应用工作台（URL 恢复路径，GATE-00 §4）。 */
export async function enterApp(page: Page, appId: string): Promise<void> {
  await page.goto(`/apps/${appId}`);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("preview-panel")).toBeVisible();
}

/** 登录（UI）→ 创建应用（API）→ 进入工作台。 */
export async function loginCreateAndEnter(
  page: Page,
  email: string,
  appName: string,
): Promise<string> {
  await uiLogin(page, email);
  const appId = await createAppViaApi(page, appName);
  await enterApp(page, appId);
  return appId;
}

/**
 * 发送聊天消息：先等 CopilotKit 连接就绪（composer 发送按钮启用），
 * 避免连接前按 Enter 丢消息（并行 worker 冷启动时尤其明显）。
 */
export async function sendChat(page: Page, text: string): Promise<void> {
  const panel = page.getByTestId("chat-panel");
  const input = panel.locator("textarea").first();
  await input.fill(text);
  await expect
    .poll(async () => panel.locator("button:not([disabled])").count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await input.press("Enter");
}
