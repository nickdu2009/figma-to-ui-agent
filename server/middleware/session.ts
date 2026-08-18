import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { AuthService, SessionInfo } from "../auth/service.ts";
import { forbidden, unauthorized } from "./errors.ts";

/**
 * 会话与 CSRF 中间件（GATE-00 决策补充 §2/§3）。
 */

export const SESSION_COOKIE_NAME = "vma_session";

// mutation 请求的 Origin 白名单（本地 dev 代理：Vite 3100 / 直连 3101）
const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:3100",
  "http://localhost:3100",
  "http://127.0.0.1:3101",
  "http://localhost:3101",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF：Cookie 认证的 mutation 必须来自同源白名单 Origin。 */
export async function csrfGuard(c: Context, next: Next): Promise<void> {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  const origin = c.req.header("Origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    throw forbidden("csrf_rejected", "跨站或缺失 Origin 的写请求被拒绝");
  }
  await next();
}

export interface SessionVariables {
  session: SessionInfo;
}

/**
 * 会话解析：从 vma_session Cookie 读取不透明令牌，经 AuthService
 * 解析（含过期校验与滑动续期）；失败一律 401。
 */
export function createSessionMiddleware(authService: AuthService) {
  return async function sessionMiddleware(
    c: Context,
    next: Next,
  ): Promise<void> {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) throw unauthorized();
    const session = await authService.resolveSession(token);
    if (!session) throw unauthorized();
    c.set("session", session);
    await next();
  };
}

/** 从 Context 取已认证的会话信息（必须在 sessionMiddleware 之后）。 */
export function requireSession(c: Context): SessionInfo {
  const session = c.get("session") as SessionInfo | undefined;
  if (!session) throw unauthorized();
  return session;
}

/** 要求管理员身份（治理端点；不因此获得业务数据读取权，设计 §5）。 */
export function requireAdmin(c: Context): SessionInfo {
  const session = requireSession(c);
  if (!session.user.isAdmin) {
    throw forbidden("admin_required", "需要管理员身份");
  }
  return session;
}
