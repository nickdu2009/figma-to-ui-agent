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
): Promise<void> {
  await request("/api/auth/start", {
    method: "POST",
    body: JSON.stringify({ email, method }),
  });
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
