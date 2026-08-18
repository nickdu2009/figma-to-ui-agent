/**
 * 会话与应用 API 客户端（S2 前端）：
 * 同源请求自动携带 Cookie；mutation 由浏览器自动带 Origin（CSRF 契约）。
 */

export interface SessionUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

export interface AppListItem {
  id: string;
  name: string;
  status: string;
  myRole: "owner" | "editor" | "viewer";
  myMembershipId: string;
  revision: number;
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

export async function getSession(): Promise<SessionUser | null> {
  const { status, body } = await request<{ user: SessionUser }>(
    "/api/auth/session",
  );
  return status === 200 ? body.user : null;
}

export async function startAuth(
  email: string,
  method: "otp" | "magic_link",
): Promise<{ ok: boolean; message?: string }> {
  const { status, body } = await request<{ error?: { message: string } }>(
    "/api/auth/start",
    {
    method: "POST",
    body: JSON.stringify({ email, method }),
    },
  );
  return status === 200
    ? { ok: true }
    : { ok: false, message: body.error?.message ?? "验证码发送失败，请稍后重试" };
}

/**
 * 本地手工测试辅助。服务端只在非生产环境挂载此收件箱接口；调用方仍须
 * 通过 import.meta.env.DEV 限制 UI，避免生产构建读取或显示 OTP。
 */
export async function getLatestDevOtp(email: string): Promise<string | null> {
  const { status, body } = await request<{
    mails?: Array<{ body?: string }>;
  }>(`/api/dev/mail-inbox?email=${encodeURIComponent(email)}`);
  if (status !== 200) return null;
  const match = body.mails?.[0]?.body?.match(/验证码：(\d{6})/);
  return match?.[1] ?? null;
}

export async function verifyOtp(
  email: string,
  code: string,
): Promise<{ ok: boolean; message?: string }> {
  const { status, body } = await request<{ error?: { message: string } }>(
    "/api/auth/verify",
    { method: "POST", body: JSON.stringify({ method: "otp", email, code }) },
  );
  return status === 200
    ? { ok: true }
    : { ok: false, message: body.error?.message ?? "校验失败" };
}

export async function logout(): Promise<void> {
  await request("/api/auth/logout", { method: "POST" });
}

export async function listApps(): Promise<AppListItem[]> {
  const { status, body } = await request<{ apps: AppListItem[] }>("/api/apps");
  return status === 200 ? body.apps : [];
}

export async function createApp(
  name: string,
): Promise<{ ok: boolean; app?: AppListItem; message?: string }> {
  const { status, body } = await request<{
    app: AppListItem;
    error?: { message: string };
  }>("/api/apps", { method: "POST", body: JSON.stringify({ name }) });
  return status === 201
    ? { ok: true, app: body.app }
    : { ok: false, message: body.error?.message ?? "创建失败" };
}
