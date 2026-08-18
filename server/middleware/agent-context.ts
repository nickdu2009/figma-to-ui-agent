import type { Context, Next } from "hono";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import { badRequest, notFound, unauthorized } from "./errors.ts";
import { SESSION_COOKIE_NAME } from "./session.ts";
import { getCookie } from "hono/cookie";

/**
 * Agent 端点上下文中间件（S3，计划 S3/§7）：
 * 作用于 POST /api/copilotkit/agent/:agentId/run。
 *
 * 1. Session 必须有效（401）；
 * 2. 请求体 forwardedProps.appId（客户端提示）经服务端全链路校验：
 *    App 存在且未删除 → 当前用户 active Membership（404，不可见）；
 * 3. 重写 forwardedProps.__vma = { appId, userId, membershipId } 为服务端
 *    鉴证值（客户端伪造的 __vma 一律剥离），agent 侧可直接信任；
 * 4. 生成/工作区属 owner-only（设计 §4.3）：非 owner 一律 404。
 */

export interface VmaAgentContext {
  appId: string;
  userId: string;
  membershipId: string;
  role: string;
}

export function createAgentContextMiddleware(deps: {
  authService: AuthService;
  appRepository: AppRepository;
}) {
  return async function agentContextMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) throw unauthorized();
    const session = await deps.authService.resolveSession(token);
    if (!session) throw unauthorized();

    // 直接读原始 Request，避免污染 HonoRequest.bodyCache
    // （任一缓存键都会使下游 c.req.json() 返回旧体）。
    const rawBody = await c.req.raw.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw badRequest("invalid_input", "请求体不是合法 JSON");
    }
    const forwardedProps =
      (body.forwardedProps as Record<string, unknown> | undefined) ?? {};
    const appId =
      typeof forwardedProps.appId === "string" ? forwardedProps.appId : null;
    if (!appId) {
      throw badRequest("app_context_required", "缺少应用上下文");
    }
    const app = await deps.appRepository.findAppById(appId);
    if (!app || app.status === "deleted") throw notFound();
    const membership = await deps.appRepository.findActiveMembership(
      appId,
      session.user.id,
    );
    if (!membership) throw notFound();
    if (membership.role !== "owner") {
      // 工作区/生成为 owner-only（设计 §4.3）；不区分可见性
      throw notFound();
    }

    // 剥离客户端伪造的 __vma，注入服务端鉴证上下文
    const { __vma: _stripped, ...clientProps } = forwardedProps;
    const context: VmaAgentContext = {
      appId,
      userId: session.user.id,
      membershipId: membership.id,
      role: membership.role,
    };
    body.forwardedProps = { ...clientProps, __vma: context };
    c.set("vmaAgentContext", context);

    // 重建 Request：剥离 content-length，避免新旧体长度不一致。
    const headers = new Headers(c.req.raw.headers);
    headers.delete("content-length");
    const rewritten = new Request(c.req.url, {
      method: c.req.method,
      headers,
      body: JSON.stringify(body),
    });
    c.req.raw = rewritten;
    await next();
  };
}

export function requireVmaAgentContext(c: Context): VmaAgentContext {
  const context = c.get("vmaAgentContext") as VmaAgentContext | undefined;
  if (!context) throw unauthorized();
  return context;
}
