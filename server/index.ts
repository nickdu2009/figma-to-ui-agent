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
// S7：DesignAsset 管道（设计 §5.4）。
import { createDesignAssetRoutes } from "./routes/design-assets.ts";
import { createRuntimeActionRoutes } from "./routes/runtime-actions.ts";
import { TransactionalBusinessActionExecutor } from "./actions/executor.ts";
import { DraftDataViewService } from "./draft-data-view/service.ts";
import { MysqlBusinessActionIdempotencyRepository } from "./repositories/business-action-idempotency-repository.ts";
import { LocalContentAddressedBlobStore } from "./design-assets/blob-store.ts";
import { DefaultDesignAssetService } from "./design-assets/service.ts";
import { DefaultDesignAssetReconciler } from "./design-assets/reconciliation.ts";
import { createExtractionWorker } from "./design-assets/extraction.ts";
import { DefaultDesignAssetReadResolver } from "./design-assets/read-resolver.ts";
import { MysqlDesignAssetRepository } from "./repositories/design-asset-repository.ts";
import { createAgentContextMiddleware } from "./middleware/agent-context.ts";
// S9：P0 Validation Scheduler / worker / capability（设计 §11.5）。
import { ValidationScheduler } from "./validation/scheduler.ts";
import {
 ValidationService,
 ValidationServiceError,
 createValidationRoutes,
} from "./validation/service.ts";
import { ValidationSessionIssuer } from "./validation/session.ts";
// S11：PreviewSelection 与 Preview Commit 路由（设计 §13.2.3）。
import { createPreviewSelectionRoutes } from "./routes/preview-selection.ts";
import { MysqlPreviewSelectionRepository } from "./repositories/preview-selection-repository.ts";
// S12：Fatal Recovery 仓库、协调器与 30 天到期维护任务（设计 §13.2.4）。
import { MysqlGenerationRecoveryRepository } from "./repositories/generation-recovery-repository.ts";
import { RecoveryCoordinator } from "./generation/recovery-coordinator.ts";
import { RecoveryExpiryMaintenance } from "./generation/recovery-expiry-maintenance.ts";
// S13：协议模式状态机（设计 §13.2.1/§13.2.3）。
import {
 resolveProtocolMode,
 computeCompatibilityDigest,
 SERVER_PROTOCOL_VERSION,
 COMPAT_PROTOCOL_VERSION,
} from "./persistence/protocol-mode.ts";
import { blobRelativePath } from "./design-assets/blob-store.ts";
import { fileURLToPath } from "node:url";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE_NAME } from "./middleware/session.ts";

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
// S9：Validation capability 端点（无 Session 中间件；能力即授权）。
// 必须挂在任何 use("*") 会话中间件的子路由（如 generation）之前——Hono
// 按注册顺序应用中间件，否则 capability 请求会被 401 拦截。
// readAssetBytes 惰性解析：S7 块在后方赋值（VMA_ASSET_ROOT 缺省时保持
// undefined，资产端点 404）。
const validationSessionIssuer = new ValidationSessionIssuer();
let validationAssetReader:
 | ((
    contentHash: string,
   ) => Promise<{ bytes: Uint8Array; mimeType: string } | null>)
 | undefined;
app.route(
 "/api",
 createValidationRoutes({
  sessionIssuer: validationSessionIssuer,
  releaseRepository,
  readAssetBytes: (contentHash) =>
   validationAssetReader
    ? validationAssetReader(contentHash)
    : Promise.resolve(null),
 }),
);
app.route(
 "/api",
 createAppMemberRoutes({ authService, appRepository, mailDelivery }),
);
const protocolMode = resolveProtocolMode();

// S13：协议模式握手端点（设计 §13.2.1/§13.2.3）
app.get("/api/protocol", (c) => {
 return c.json({
  protocolMode,
  serverProtocolVersion:
   protocolMode === "v2" ? SERVER_PROTOCOL_VERSION : COMPAT_PROTOCOL_VERSION,
  compatibilityDigest: computeCompatibilityDigest(protocolMode),
 });
});

// S12：Recovery 仓库、协调器与到期维护任务
const generationRecoveryRepository = new MysqlGenerationRecoveryRepository(db);
const recoveryCoordinator = new RecoveryCoordinator({
 releaseRepository,
 recoveryRepository: generationRecoveryRepository,
});
const recoveryExpiryMaintenance = new RecoveryExpiryMaintenance({
 recoveryRepository: generationRecoveryRepository,
});
recoveryExpiryMaintenance.start();

app.route(
 "/api",
 createGenerationRoutes({
  authService,
  appRepository,
  releaseRepository,
  lifecycle: generationLifecycle,
  recoveryRepository: generationRecoveryRepository,
  recoveryCoordinator,
  protocolMode,
 }),
);
// S11：PreviewSelection 与 Preview Commit
const previewSelectionRepository = new MysqlPreviewSelectionRepository(db);
app.route(
 "/api",
 createPreviewSelectionRoutes({
  authService,
  appRepository,
  releaseRepository,
  previewSelectionRepository,
  protocolMode,
 }),
);
// S4：草稿/发布/回滚（设计 §4.2，AC3/AC4）
const releaseService = new ReleaseService(
 releaseRepository,
 new SchemaMigrationService(db),
 { requireDirectPredecessor: protocolMode === "v2" },
);
app.route(
 "/api",
 createReleaseRoutes({
  authService,
  appRepository,
  releaseRepository,
  releaseService,
  protocolMode,
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
// S8：生成应用受控业务 Action 分发与 DraftDataView（设计 §9.2/§9.4）
const businessActionIdempotencyRepository =
 new MysqlBusinessActionIdempotencyRepository(db);
const businessActionExecutor = new TransactionalBusinessActionExecutor({
 db,
 appRepository,
 releaseRepository,
 data: businessDataRepository,
 idempotency: businessActionIdempotencyRepository,
});
const draftDataViewService = new DraftDataViewService({
 db,
 releaseRepository,
 data: businessDataRepository,
});
app.route(
 "/api",
 createRuntimeActionRoutes({
  authService,
  appRepository,
  executor: businessActionExecutor,
  draftDataView: draftDataViewService,
  protocolMode,
 }),
);

// S9：Validation Scheduler / Service 编排（capability 端点已在上方挂载）。
const validationScheduler = new ValidationScheduler({
 workerEntry: fileURLToPath(new URL("./validation/worker.ts", import.meta.url)),
});
const validationService = new ValidationService({
 releaseRepository,
 scheduler: validationScheduler,
 sessionIssuer: validationSessionIssuer,
 pageBaseUrl:
  process.env.VMA_VALIDATION_PAGE_BASE_URL ?? "http://127.0.0.1:3100",
 apiBaseUrl:
  process.env.VMA_VALIDATION_API_BASE_URL ??
  process.env.VMA_VALIDATION_BASE_URL ??
  `http://127.0.0.1:${process.env.VMA_SERVER_PORT ?? "3101"}`,
 chromiumExecutablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
// S11：真实生成器只能经 lifecycle 的 v2 收尾进入 validation_running；
// 未注入时该收尾 fail-closed，绝不回退到浏览器 Spec/await_apply_result。
generationLifecycle.setValidationRunner(validationService);

// ---------- S7：DesignAsset 管道（设计 §5.4；VMA_ASSET_ROOT 缺失时 fail closed） ----------
const assetRoot = process.env.VMA_ASSET_ROOT?.trim();
if (assetRoot) {
 const SERVER_ID = process.env.VMA_SERVER_ID ?? `srv-${process.pid}`;
 const designAssetBlobStore = new LocalContentAddressedBlobStore(
  assetRoot,
  SERVER_ID,
 );
 validationAssetReader = async (contentHash) => {
  // contentHash 形如 sha256:<hex>
  const hex = contentHash.startsWith("sha256:")
   ? contentHash.slice("sha256:".length)
   : null;
  if (!hex) return null;
  try {
   const bytes = await designAssetBlobStore.read(blobRelativePath(hex));
   return { bytes, mimeType: "application/octet-stream" };
  } catch {
   return null;
  }
 };
 const designAssetRepository = new MysqlDesignAssetRepository(db);
 const designAssetService = new DefaultDesignAssetService(
  designAssetRepository,
  designAssetBlobStore,
 );
 const designAssetReadResolver = new DefaultDesignAssetReadResolver(
  appRepository,
  releaseRepository,
  designAssetRepository,
  designAssetBlobStore,
 );
 app.route(
  "/api",
  createDesignAssetRoutes({
   authService,
   appRepository,
   service: designAssetService,
   readResolver: designAssetReadResolver,
  }),
 );
 // 启动清扫：崩溃残留 tmp（有界、幂等；不触发 GC/资产删除）。
 const designAssetReconciler = new DefaultDesignAssetReconciler(
  designAssetRepository,
  designAssetBlobStore,
  { maxJobsPerRun: 100, maxSourcesPerRun: 200, orphanTmpMaxAgeMs: 3_600_000 },
 );
 await designAssetReconciler
  .reconcile(new Date())
  .then((report) => {
   if (report.jobsFailed > 0 || report.sourcesFailed > 0) {
    console.log(
     `[vite-multipage-agent] DesignAsset reconciliation：${report.jobsFailed} 个租约丢失 job、${report.sourcesFailed} 个卡死 source 已标记 failed`,
    );
   }
  })
  .catch(() => undefined);
 // 提取 worker：有界租约 claim queued job（设计 §5.4；确定性本地提取，
 // 进程内串行 drain，每 tick 最多 4 个 job，租约丢失由 reconciliation 收尾）。
 const extractionWorker = createExtractionWorker({
  repository: designAssetRepository,
  blobStore: designAssetBlobStore,
  leaseOwner: SERVER_ID,
  leaseTtlMs: 60_000,
 });
 const extractionPump = setInterval(() => {
  void (async () => {
   for (let index = 0; index < 4; index += 1) {
    const outcome = await extractionWorker.runOnce();
    if (outcome === "idle") break;
   }
  })().catch((error) =>
   console.error(
    "[vite-multipage-agent] 提取 worker 失败：",
    redactForLog(error),
   ),
  );
 }, 1_000);
 extractionPump.unref();
} else {
 console.warn(
  "[vite-multipage-agent] VMA_ASSET_ROOT 未设置：DesignAsset 路由未挂载（fail closed）",
 );
}

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

// S9 验证编排的 E2E 触发面（仅 mock 模式；S11 起由 GenerationCoordinator
// 进程内调用，该面随之退出）。Session 鉴权 + 应用成员身份由 service 内
// run/app 归属核对承担。
if (mode === "mock") {
 app.post("/api/mock/validation/:runId/run", async (c) => {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = token ? await authService.resolveSession(token) : null;
  if (!session) {
   return c.json({ error: { code: "unauthenticated" } }, 401);
  }
  try {
   const outcome = await validationService.runValidation(c.req.param("runId"));
   return c.json(outcome, 200);
  } catch (error) {
   if (error instanceof ValidationServiceError) {
    return c.json({ error: { code: error.code } }, 409);
   }
   throw error;
  }
 });
}

const port = Number(process.env.VMA_SERVER_PORT ?? 3101);
serve({ fetch: app.fetch, port }, (info) => {
 console.log(
  `[vite-multipage-agent] server listening on http://localhost:${info.port} (mode=${mode})`,
 );
});
