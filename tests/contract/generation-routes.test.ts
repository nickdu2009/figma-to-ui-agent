import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
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
import { createAgentContextMiddleware } from "../../server/middleware/agent-context.ts";
import { errorResponse } from "../../server/middleware/errors.ts";

const OWNER = "s3-owner@example.com";
const OUTSIDER = "s3-outsider@example.com";

/**
 * S3 生成路由与 Agent 上下文中间件契约测试（计划 S3/§6.4，设计 §4.2/§7）：
 * - heartbeat/abort/runs：Session + owner 成员资格；
 * - agent run 端点：401/400/404 边界 + forwardedProps.__vma 服务端重写。
 */
describe("generation routes & agent context (S3)", () => {
  let handle: TestDatabaseHandle;
  let t: TestAppHandle;
  let appId: string;
  let ownerCookie: string;
  let outsiderCookie: string;

  beforeAll(async () => {
    handle = await createTestDatabase();
    // adminEmails 引导两个可登录用户；成员资格检查独立于 isAdmin，
    // 不削弱 404/角色断言。
    t = createTestApp(handle, {
      adminEmails: [OWNER, OUTSIDER],
    });
    ownerCookie = await loginViaOtp(t, OWNER);
    outsiderCookie = await loginViaOtp(t, OUTSIDER);
    const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
    const created = await t.appRepository.createAppWithOwner({
      name: "生成路由",
      createdByUserId: owner!.id,
    });
    appId = created.app.id;
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  describe("generation routes", () => {
    it("无会话 → 401", async () => {
      const res = await api(t.app, `/api/apps/${appId}/generation/runs`);
      expect(res.status).toBe(401);
      const hb = await api(t.app, `/api/apps/${appId}/generation/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ generationId: "gen-x" }),
      });
      expect(hb.status).toBe(401);
    });

    it("非成员 → 404（不可见）", async () => {
      const res = await api(t.app, `/api/apps/${appId}/generation/runs`, {
        cookie: outsiderCookie,
      });
      expect(res.status).toBe(404);
    });

    it("owner 可中止运行并列出运行（幂等）", async () => {
      const owner = await t.authRepository.findUserByEmailNormalized(OWNER);
      const membership = await t.appRepository.findActiveMembership(
        appId,
        owner!.id,
      );
      await t.lifecycle.startRun({
        appId,
        membershipId: membership!.id,
        generationId: "gen-route-1",
      });
      const hb = await apiJson<{ ok: boolean }>(
        t.app,
        `/api/apps/${appId}/generation/heartbeat`,
        {
          method: "POST",
          cookie: ownerCookie,
          body: JSON.stringify({ generationId: "gen-route-1", protocolVersion: 2 }),
        },
      );
      expect(hb.status).toBe(200);
      expect(hb.body.ok).toBe(true);
      const abort = await apiJson<{ ok: boolean }>(
        t.app,
        `/api/apps/${appId}/generation/abort`,
        {
          method: "POST",
          cookie: ownerCookie,
          body: JSON.stringify({ generationId: "gen-route-1", protocolVersion: 2 }),
        },
      );
      expect(abort.status).toBe(200);
      expect(abort.body.ok).toBe(true);
      const runs = await apiJson<{
        runs: Array<{ correlationRef: string; status: string }>;
      }>(t.app, `/api/apps/${appId}/generation/runs`, { cookie: ownerCookie });
      expect(runs.status).toBe(200);
      const run = runs.body.runs.find(
        (r) => r.correlationRef === "gen-route-1",
      );
      expect(run?.status).toBe("incomplete");
    });
  });

  describe("agent-context middleware", () => {
    function buildAgentEchoApp(): Hono {
      const mini = new Hono();
      mini.onError((error, c) => errorResponse(c, error));
      mini.use(
        "/api/copilotkit/agent/:agentId/run",
        createAgentContextMiddleware({
          authService: t.authService,
          appRepository: t.appRepository,
        }),
      );
      mini.post("/api/copilotkit/agent/:agentId/run", async (c) => {
        const body = await c.req.json();
        return c.json({ forwardedProps: body.forwardedProps ?? null });
      });
      return mini;
    }

    const runBody = (forwardedProps: Record<string, unknown>) =>
      JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps,
      });

    it("无会话 → 401", async () => {
      const mini = buildAgentEchoApp();
      const res = await api(mini, "/api/copilotkit/agent/chat/run", {
        method: "POST",
        body: runBody({ appId }),
      });
      expect(res.status).toBe(401);
    });

    it("缺少 appId → 400 app_context_required", async () => {
      const mini = buildAgentEchoApp();
      const res = await api(mini, "/api/copilotkit/agent/chat/run", {
        method: "POST",
        cookie: ownerCookie,
        body: runBody({}),
      });
      expect(res.status).toBe(400);
    });

    it("非成员 → 404", async () => {
      const mini = buildAgentEchoApp();
      const res = await api(mini, "/api/copilotkit/agent/chat/run", {
        method: "POST",
        cookie: outsiderCookie,
        body: runBody({ appId }),
      });
      expect(res.status).toBe(404);
    });

    it("owner 通过：__vma 被服务端重写，客户端伪造被剥离", async () => {
      const mini = buildAgentEchoApp();
      const res = await api(mini, "/api/copilotkit/agent/chat/run", {
        method: "POST",
        cookie: ownerCookie,
        body: runBody({
          appId,
          theme: "dark",
          __vma: { appId: "forged", userId: "forged", membershipId: "forged" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        forwardedProps: {
          appId: string;
          theme: string;
          __vma: {
            appId: string;
            userId: string;
            membershipId: string;
            role: string;
          };
        };
      };
      expect(body.forwardedProps.theme).toBe("dark");
      expect(body.forwardedProps.__vma.appId).toBe(appId);
      expect(body.forwardedProps.__vma.role).toBe("owner");
      expect(body.forwardedProps.__vma.membershipId).not.toBe("forged");
    });
  });
});
