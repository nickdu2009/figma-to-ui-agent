import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AuthService } from "../auth/service.ts";
import type { AuthRepository } from "../repositories/auth-repository.ts";
import { authStartInputSchema, authVerifyInputSchema } from "../contracts.ts";
import { badRequest, errorResponse, notFound } from "../middleware/errors.ts";
import {
  createSessionMiddleware,
  requireSession,
  SESSION_COOKIE_NAME,
} from "../middleware/session.ts";

/**
 * 认证路由（设计 §6.1、GATE-00 §2/§3）：
 * - POST /api/auth/start  通用接受结果，不泄漏邮箱存在性；
 * - POST /api/auth/verify 校验成功写 HttpOnly 会话 Cookie；
 * - POST /api/auth/logout 服务端删除 Session 行并清除 Cookie；
 * - GET  /api/auth/session 当前会话（未登录 401）；
 * - GET  /api/dev/mail-inbox 开发收件箱（仅非生产环境挂载）。
 */
export function createAuthRoutes(deps: {
  authService: AuthService;
  sessionTtlSeconds: number;
}): Hono {
  const { authService, sessionTtlSeconds } = deps;
  const routes = new Hono();

  routes.post("/auth/start", async (c) => {
    try {
      const body = authStartInputSchema.safeParse(await c.req.json());
      if (!body.success) {
        throw badRequest("invalid_input", "请求格式不正确");
      }
      const result = await authService.startAuth(body.data);
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post("/auth/verify", async (c) => {
    try {
      const body = authVerifyInputSchema.safeParse(await c.req.json());
      if (!body.success) {
        throw badRequest("invalid_input", "请求格式不正确");
      }
      const verified =
        body.data.method === "otp"
          ? await authService.verifyOtp({
              email: body.data.email,
              code: body.data.code,
            })
          : await authService.verifyMagicLink({ token: body.data.token });
      if (!verified) {
        // 失败关闭：同一通用错误，不区分原因
        return c.json(
          {
            error: { code: "invalid_or_expired", message: "凭据无效或已过期" },
          },
          401,
        );
      }
      setCookie(c, SESSION_COOKIE_NAME, verified.sessionToken, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: sessionTtlSeconds,
      });
      return c.json({
        user: {
          id: verified.user.id,
          email: verified.user.emailDisplay,
          isAdmin: verified.user.isAdmin,
        },
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  routes.post(
    "/auth/logout",
    createSessionMiddleware(authService),
    async (c) => {
      try {
        const token = getCookie(c, SESSION_COOKIE_NAME);
        if (token) await authService.logout(token);
        deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
        return c.json({ ok: true });
      } catch (error) {
        return errorResponse(c, error);
      }
    },
  );

  routes.get(
    "/auth/session",
    createSessionMiddleware(authService),
    async (c) => {
      try {
        const { user } = requireSession(c);
        return c.json({
          user: {
            id: user.id,
            email: user.emailDisplay,
            isAdmin: user.isAdmin,
          },
        });
      } catch (error) {
        return errorResponse(c, error);
      }
    },
  );

  return routes;
}

/** 开发收件箱读取端点：仅非生产环境挂载（AC10）。 */
export function createDevMailRoutes(deps: {
  authRepository: AuthRepository;
}): Hono | null {
  if (process.env.NODE_ENV === "production") return null;
  const routes = new Hono();
  routes.get("/dev/mail-inbox", async (c) => {
    try {
      const query = z
        .object({ email: z.string().email().max(320) })
        .safeParse({ email: c.req.query("email") });
      if (!query.success) throw badRequest("invalid_input", "参数不正确");
      const mails = await deps.authRepository.listDevMail(query.data.email);
      return c.json({
        mails: mails.map((m) => ({
          id: m.id,
          subject: m.subject,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  return routes;
}

export { notFound };
