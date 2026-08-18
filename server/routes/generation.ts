import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { GenerationLifecyclePort } from "../generation/lifecycle.ts";
import {
  createSessionMiddleware,
  requireSession,
} from "../middleware/session.ts";
import { requireOwnerMembership as guardOwner } from "../middleware/app-guard.ts";

/**
 * 生成生命周期路由（S3，计划 S3/§6.4）：
 * - heartbeat：运行中续租（心跳超时 → 扫描器标记 incomplete）；
 * - abort：owner 显式中止（条件更新，已终态则幂等 false）；
 * - runs：列出本应用的生成运行（重启恢复只读视图）。
 *
 * 不恢复、不重放中断的生成任务：中断 run 只读可见，无任何 resume 端点。
 */
const generationIdSchema = z.object({
  generationId: z.string().min(1).max(128),
});

export function createGenerationRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  releaseRepository: ReleaseRepository;
  lifecycle: GenerationLifecyclePort;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  const requireOwnerMembership = (appId: string, userId: string) =>
    guardOwner(deps.appRepository, appId, userId, { conceal: true });

  routes.post("/apps/:appId/generation/heartbeat", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    const body = generationIdSchema.parse(await c.req.json());
    const ok = await deps.lifecycle.heartbeat({
      generationId: body.generationId,
    });
    return c.json({ ok });
  });

  routes.post("/apps/:appId/generation/abort", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    const body = generationIdSchema.parse(await c.req.json());
    const ok = await deps.lifecycle.abortRun({
      generationId: body.generationId,
    });
    return c.json({ ok });
  });

  routes.get("/apps/:appId/generation/runs", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    const runs = await deps.releaseRepository.listRuns(c.req.param("appId"));
    return c.json({
      runs: runs.map((run) => ({
        id: run.id,
        correlationRef: run.correlationRef,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      })),
    });
  });

  return routes;
}
