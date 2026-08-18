import { serve } from "@hono/node-server";
import { redactForLog } from "./log-redact.ts";
import { Hono } from "hono";
import type { AbstractAgent } from "@ag-ui/client";
import { mountCopilotKitRuntime } from "./copilotkit-runtime.ts";
import { ProbeAgent } from "./probe-agent.ts";
import {
 createDatabase,
 healthCheck,
 readDatabaseUrl,
} from "./persistence/database.ts";
import { runStartupMigrations } from "./persistence/migrations.ts";
import { MysqlAuthRepository } from "./repositories/auth-repository.ts";
import { MysqlAppRepository } from "./repositories/app-repository.ts";
import { MysqlWorkspaceRepository } from "./repositories/workspace-repository.ts";
import { MysqlReleaseRepository } from "./repositories/release-repository.ts";
import { MysqlGenerationLifecycle } from "./generation/lifecycle.ts";
import { AuthService } from "./auth/service.ts";
import { normalizeEmail } from "./auth/email.ts";
import { DevMailDelivery } from "./auth/dev-mail.ts";
import { csrfGuard } from "./middleware/session.ts";
import { errorResponse } from "./middleware/errors.ts";
import { createAuthRoutes, createDevMailRoutes } from "./routes/auth.ts";
import { createAppMemberRoutes } from "./routes/apps-members.ts";
import { createGenerationRoutes } from "./routes/generation.ts";
import { createReleaseRoutes } from "./routes/releases.ts";
import { ReleaseService } from "./release/service.ts";
import { createBusinessDataRoutes } from "./routes/business-data.ts";
import { BusinessDataService } from "./business-data/service.ts";
import { BusinessDataRepository } from "./repositories/business-data-repository.ts";
import { SchemaMigrationService } from "./schema-migrations/service.ts";
import { createRecycleBinRoutes } from "./routes/recycle-bin.ts";
import { RecycleBinService } from "./recycle-bin/service.ts";
import { createAgentContextMiddleware } from "./middleware/agent-context.ts";

// 注：服务端以 Node 24 类型剥离直接运行，相对导入必须显式 .ts 扩展名
//（tsconfig 已启用 allowImportingTsExtensions；tsc --noEmit 通过）。

/**
 * 本地开发服务器入口。
 *
 * VMA_AGENT_MODE：
 *   - "probe"  ：注册脚本化探针 Agent（transport 探针 / G1 门禁，不调 LLM）。
 *   - "mock"   ：注册脚本化 Mock 聊天 Agent（浏览器 E2E，不调 LLM）。
 *   - "openai"（默认）：注册真实 Mastra 聊天 Agent（需要服务端 OPENAI_API_KEY）。
 *
 * 浏览器永远不持有 API Key；Key 只从本进程环境读取（计划 §8）。
 */
const mode = process.env.VMA_AGENT_MODE ?? "openai";

async function buildAgents(
 lifecycle?: MysqlGenerationLifecycle,
): Promise<Record<string, AbstractAgent>> {
 if (mode === "probe") {
  return { probe: new ProbeAgent() };
 }
 if (mode === "mock") {
  // 动态导入 + 显式 .ts 扩展名：Node 24 类型剥离不重写说明符。
  const { MockChatAgent } = await import("./mock-agent.ts");
  const { GenerationCoordinator } = await import("./generation-coordinator.ts");
  const { CoordinatedMastraAgent } = await import(
   "./coordinated-mastra-agent.ts"
  );
  const coordinator = new GenerationCoordinator(lifecycle);
  const inner = new MockChatAgent(coordinator);
  return {
   chat: new CoordinatedMastraAgent(inner, coordinator, { agentId: "chat" }),
  };
 }
 const { createChatAgent } = await import("./mastra-agent.ts");
 return { chat: createChatAgent(lifecycle) };
}

const app = new Hono();

// 启动持久化（fail-closed，设计 §9 / GATE-00 §5）：
// MySQL 不可用或平台表迁移失败即拒绝启动，不降级为内存模式。
const databaseUrl = readDatabaseUrl();
const { db, pool } = createDatabase(databaseUrl);
try {
 await healthCheck(pool);
 await runStartupMigrations(db);
} catch (error) {
 console.error(
  "[vite-multipage-agent] 数据库启动检查失败，服务拒绝启动：",
  redactForLog(error),
 );
 process.exit(1);
}

app.get("/api/health", (c) => c.json({ ok: true, mode, db: true }));

// ---------- S2：认证、应用与成员（设计 §4.1/§6.1/§6.2） ----------
const authRepository = new MysqlAuthRepository(db);
const appRepository = new MysqlAppRepository(db);
const workspaceRepository = new MysqlWorkspaceRepository(db);
const releaseRepository = new MysqlReleaseRepository(db);
const generationLifecycle = new MysqlGenerationLifecycle(
 releaseRepository,
 workspaceRepository,
);

// 启动扫描（S3，设计 §9）：所有开放 GenerationRun 原子标记 incomplete，
// 不恢复、不重放中断的生成任务。
const swept = await generationLifecycle.sweepOrphanRuns();
if (swept > 0) {
 console.log(
  `[vite-multipage-agent] 启动扫描：${swept} 个开放运行已标记 incomplete`,
 );
}
const mailDelivery = new DevMailDelivery(authRepository);
const adminEmails = new Set(
 (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => normalizeEmail(e))
  .filter((e) => e.length > 0),
);
const authService = new AuthService(
 authRepository,
 appRepository,
 mailDelivery,
 {
  adminEmails,
 },
);

// CSRF：所有 /api 写请求必须来自同源白名单 Origin（GATE-00 §3）
app.onError((error, c) => errorResponse(c, error));
app.use("/api/*", csrfGuard);

// probe 模式（本地传输探针，无账号体系）：先于各路由工厂的 Session
// 中间件挂载 CopilotKit，使 /api/copilotkit/* 不经账号守卫。
// 非 probe 模式在正常位置挂载，Session + Membership 中间件先生效（S7）。
const agents = await buildAgents(generationLifecycle);
if (mode === "probe") {
 mountCopilotKitRuntime(app, agents);
}
app.route(
 "/api",
 createAuthRoutes({
  authService,
  sessionTtlSeconds: 7 * 24 * 60 * 60,
 }),
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
  lifecycle: generationLifecycle,
 }),
);
// S4：草稿/发布/回滚（设计 §4.2，AC3/AC4）
const releaseService = new ReleaseService(
 releaseRepository,
 new SchemaMigrationService(db),
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
// S5a：业务数据（设计 §4.4/§4.5，AC1/AC2/AC6/AC12/AC13/AC15/AC16）
const businessDataRepository = new BusinessDataRepository(db);
const businessDataService = new BusinessDataService({
 appRepository,
 releaseRepository,
 data: businessDataRepository,
});
app.route(
 "/api",
 createBusinessDataRoutes({ authService, businessData: businessDataService }),
);
// S5b：回收站与平台治理（设计 §4.6，AC9/AC15）
const recycleBinService = new RecycleBinService({
 db,
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

// 周期扫描（有界、幂等；普通请求绝不隐式清理）：
// 1. 生成运行心跳超时 → incomplete；2. 回收站过期条目永久清理（每次 ≤500）。
const STALE_MS = 60_000;
await recycleBinService.cleanupExpired(new Date()).catch(() => 0);
const sweeper = setInterval(() => {
 void generationLifecycle
  .sweepStaleRuns(new Date(Date.now() - STALE_MS))
  .catch((error) =>
   console.error(
    "[vite-multipage-agent] 心跳超时扫描失败：",
    redactForLog(error),
   ),
  );
 void recycleBinService
  .cleanupExpired(new Date())
  .catch((error) =>
   console.error(
    "[vite-multipage-agent] 回收站清理失败：",
    redactForLog(error),
   ),
  );
}, 30_000);
sweeper.unref();

// S3/S7：Agent 运行端点的 Session + Membership + 服务端鉴证 appId。
// probe 模式为本地传输探针（无账号体系），跳过该中间件。
if (mode !== "probe") {
 app.use(
  "/api/copilotkit/agent/:agentId/run",
  createAgentContextMiddleware({ authService, appRepository }),
 );
}

if (mode !== "probe") {
 mountCopilotKitRuntime(app, agents);
}

const port = Number(process.env.VMA_SERVER_PORT ?? 3101);
serve({ fetch: app.fetch, port }, (info) => {
 console.log(
  `[vite-multipage-agent] server listening on http://localhost:${info.port} (mode=${mode})`,
 );
});
