import { Hono } from "hono";
import type { TestDatabaseHandle } from "./test-database.ts";
import { MysqlAuthRepository } from "../../server/repositories/auth-repository.ts";
import { MysqlAppRepository } from "../../server/repositories/app-repository.ts";
import { AuthService } from "../../server/auth/service.ts";
import { DevMailDelivery } from "../../server/auth/dev-mail.ts";
import { csrfGuard } from "../../server/middleware/session.ts";
import { errorResponse } from "../../server/middleware/errors.ts";
import {
  createAuthRoutes,
  createDevMailRoutes,
} from "../../server/routes/auth.ts";
import { createAppMemberRoutes } from "../../server/routes/apps-members.ts";
import { createGenerationRoutes } from "../../server/routes/generation.ts";
import { createReleaseRoutes } from "../../server/routes/releases.ts";
import { ReleaseService } from "../../server/release/service.ts";
import { createBusinessDataRoutes } from "../../server/routes/business-data.ts";
import { BusinessDataService } from "../../server/business-data/service.ts";
import { BusinessDataRepository } from "../../server/repositories/business-data-repository.ts";
import { SchemaMigrationService } from "../../server/schema-migrations/service.ts";
import { createRecycleBinRoutes } from "../../server/routes/recycle-bin.ts";
import { RecycleBinService } from "../../server/recycle-bin/service.ts";
import { MysqlWorkspaceRepository } from "../../server/repositories/workspace-repository.ts";
import { MysqlReleaseRepository } from "../../server/repositories/release-repository.ts";
import { MysqlGenerationLifecycle } from "../../server/generation/lifecycle.ts";

/**
 * 测试用内存 Hono 应用（不监听端口）：
 * 与 server/index.ts 相同的中间件/路由接线，注入 per-test schema 的
 * Repository 与可控制的时钟。
 */
export interface TestAppHandle {
  app: Hono;
  authService: AuthService;
  authRepository: MysqlAuthRepository;
  appRepository: MysqlAppRepository;
  workspaceRepository: MysqlWorkspaceRepository;
  releaseRepository: MysqlReleaseRepository;
  lifecycle: MysqlGenerationLifecycle;
  releaseService: ReleaseService;
  businessData: BusinessDataService;
  setNow(now: Date): void;
  resetNow(): void;
}

const TEST_ORIGIN = "http://127.0.0.1:3100";

export function createTestApp(
  handle: TestDatabaseHandle,
  options?: { adminEmails?: string[] },
): TestAppHandle {
  const authRepository = new MysqlAuthRepository(handle.db);
  const appRepository = new MysqlAppRepository(handle.db);
  const workspaceRepository = new MysqlWorkspaceRepository(handle.db);
  const releaseRepository = new MysqlReleaseRepository(handle.db);
  const lifecycle = new MysqlGenerationLifecycle(
    releaseRepository,
    workspaceRepository,
  );
  const mailDelivery = new DevMailDelivery(authRepository);
  // nowOverride 为 null 时时钟正常走动；setNow 仅用于过期场景，用后 resetNow。
  let nowOverride: Date | null = null;
  const authService = new AuthService(
    authRepository,
    appRepository,
    mailDelivery,
    {
      adminEmails: new Set(options?.adminEmails ?? []),
      now: () => nowOverride ?? new Date(),
    },
  );

  const app = new Hono();
  app.onError((error, c) => errorResponse(c, error));
  app.use("/api/*", csrfGuard);
  app.route(
    "/api",
    createAuthRoutes({ authService, sessionTtlSeconds: 7 * 24 * 60 * 60 }),
  );
  const devMailRoutes = createDevMailRoutes({ authRepository });
  if (devMailRoutes) app.route("/api", devMailRoutes);
  app.route(
    "/api",
    createAppMemberRoutes({ authService, appRepository, mailDelivery }),
  );
  app.route(
    "/api",
    createGenerationRoutes({
      authService,
      appRepository,
      releaseRepository,
      lifecycle,
    }),
  );
  const releaseService = new ReleaseService(
    releaseRepository,
    new SchemaMigrationService(handle.db),
  );
  app.route(
    "/api",
    createReleaseRoutes({
      authService,
      appRepository,
      releaseRepository,
      releaseService,
    }),
  );
  const businessDataRepository = new BusinessDataRepository(handle.db);
  const businessDataService = new BusinessDataService({
    appRepository,
    releaseRepository,
    data: businessDataRepository,
  });
  const recycleBinService = new RecycleBinService({
    db: handle.db,
    appRepository,
    data: businessDataRepository,
  });
  app.route(
    "/api",
    createRecycleBinRoutes({
      authService,
      appRepository,
      businessDataRepository,
      recycleBin: recycleBinService,
      businessData: businessDataService,
    }),
  );
  app.route(
    "/api",
    createBusinessDataRoutes({
      authService,
      businessData: businessDataService,
    }),
  );

  return {
    app,
    authService,
    authRepository,
    appRepository,
    workspaceRepository,
    releaseRepository,
    lifecycle,
    releaseService,
    businessData: businessDataService,
    setNow(now: Date) {
      nowOverride = now;
    },
    resetNow() {
      nowOverride = null;
    },
  };
}

export interface RequestInit2 extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

/** 测试请求辅助：mutation 默认带同源 Origin（CSRF 契约）。 */
export async function api(
  app: Hono,
  path: string,
  init?: RequestInit2 & { cookie?: string },
): Promise<Response> {
  const headers: Record<string, string> = { ...init?.headers };
  const method = (init?.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["Origin"] ??= TEST_ORIGIN;
    headers["Content-Type"] ??= "application/json";
  }
  if (init?.cookie) headers["Cookie"] = init.cookie;
  return app.request(path, { ...init, headers });
}

export async function apiJson<T = unknown>(
  app: Hono,
  path: string,
  init?: RequestInit2 & { cookie?: string },
): Promise<{ status: number; body: T; setCookie: string | null }> {
  const res = await api(app, path, init);
  return {
    status: res.status,
    body: (await res.json()) as T,
    setCookie: res.headers.get("set-cookie"),
  };
}

/** 完整 OTP 登录：start → 读开发收件箱取验证码 → verify → 返回 Cookie。 */
export async function loginViaOtp(
  testApp: TestAppHandle,
  email: string,
): Promise<string> {
  const start = await apiJson(testApp.app, "/api/auth/start", {
    method: "POST",
    body: JSON.stringify({ email, method: "otp" }),
  });
  if (start.status !== 200) throw new Error(`start failed: ${start.status}`);
  const mails = await testApp.authRepository.listDevMail(email.toLowerCase());
  const latest = mails[0];
  if (!latest) throw new Error("开发收件箱中没有验证码邮件");
  const match = latest.body.match(/验证码：(\d{6})/);
  if (!match) throw new Error("邮件中没有验证码");
  const verify = await apiJson<{ user: { id: string } }>(
    testApp.app,
    "/api/auth/verify",
    {
      method: "POST",
      body: JSON.stringify({ method: "otp", email, code: match[1] }),
    },
  );
  if (verify.status !== 200 || !verify.setCookie) {
    throw new Error(`verify failed: ${verify.status}`);
  }
  return verify.setCookie.split(";")[0];
}
