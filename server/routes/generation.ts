import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { GenerationLifecyclePort } from "../generation/lifecycle.ts";
import type { GenerationRecoveryRepository } from "../repositories/generation-recovery-repository.ts";
import type { RecoveryCoordinator } from "../generation/recovery-coordinator.ts";
import {
  assertMutationAllowed,
  assertMutationProtocolVersion,
  ProtocolFenceError,
  type ProtocolMode,
} from "../persistence/protocol-mode.ts";
import {
  createSessionMiddleware,
  requireSession,
} from "../middleware/session.ts";
import { requireOwnerMembership as guardOwner } from "../middleware/app-guard.ts";

/**
 * 生成生命周期路由（S3/S12，设计 §10.4/§13.2.4）：
 * - heartbeat：运行中续租（心跳超时 → 扫描器标记 incomplete）；
 * - abort：owner 显式中止（条件更新，已终态则幂等 false）；
 * - runs：列出本应用的生成运行（重启恢复只读视图）；
 * - generation-recovery：查询/消费 Fatal 恢复决定（纯投影恢复，不隐式启动模型）。
 *
 * 不恢复、不重放中断的生成任务：中断 run 只读可见，无任何 resume 端点。
 */
const generationIdSchema = z.object({
  generationId: z.string().min(1).max(128),
  protocolVersion: z.number().int().optional(),
}).strict();

const recoveryDecisionBodySchema = z.object({
  action: z.enum(["repair_candidate", "regenerate_quality", "keep_current"]),
  candidateDigest: z.string().min(1),
  protocolVersion: z.number().int().optional(),
}).strict();

export function createGenerationRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  releaseRepository: ReleaseRepository;
  lifecycle: GenerationLifecyclePort;
  recoveryRepository?: GenerationRecoveryRepository;
  recoveryCoordinator?: RecoveryCoordinator;
  protocolMode?: ProtocolMode;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  const requireOwnerMembership = (appId: string, userId: string) =>
    guardOwner(deps.appRepository, appId, userId, { conceal: true });

  routes.post("/apps/:appId/generation/heartbeat", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    const body = generationIdSchema.parse(await c.req.json());
    assertMutationProtocolVersion(
      deps.protocolMode ?? "compat",
      "generation",
      body.protocolVersion,
    );
    const ok = await deps.lifecycle.heartbeat({
      generationId: body.generationId,
    });
    return c.json({ ok });
  });

  routes.post("/apps/:appId/generation/abort", async (c) => {
    const { user } = requireSession(c);
    await requireOwnerMembership(c.req.param("appId"), user.id);
    try {
      assertMutationAllowed(deps.protocolMode ?? "compat", "generation");
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status as 423,
        );
      }
      throw err;
    }
    const body = generationIdSchema.parse(await c.req.json());
    assertMutationProtocolVersion(
      deps.protocolMode ?? "compat",
      "generation",
      body.protocolVersion,
    );
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

  // S12：GET /apps/:appId/generation-recovery/:generationId（纯投影只读，不启动模型）
  routes.get("/apps/:appId/generation-recovery/:generationId", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    await requireOwnerMembership(appId, user.id);
    const generationId = c.req.param("generationId");

    const run =
      (await deps.releaseRepository.findRunByCorrelationRef(generationId)) ??
      (await deps.releaseRepository.findRunById(generationId));

    if (!run || run.appId !== appId) {
      return c.json(
        { error: { code: "run_not_found", message: "生成记录不存在" } },
        404,
      );
    }

    let recoveryRecord = null;
    if (deps.recoveryRepository && run.candidateDigest) {
      recoveryRecord = await deps.recoveryRepository.findByKey({
        appId,
        failedGenerationId: generationId,
        failedCandidateDigest: run.candidateDigest,
      });
    }

    return c.json({
      generationId,
      runId: run.id,
      status: run.status,
      candidateDigest: run.candidateDigest,
      fatalVisualIssues: run.fatalVisualIssues ?? null,
      recoveryRecord: recoveryRecord
        ? {
            status: recoveryRecord.status,
            decision: recoveryRecord.decision,
            decisionExpiresAt: recoveryRecord.decisionExpiresAt,
            successorGenerationId: recoveryRecord.successorGenerationId,
          }
        : null,
    });
  });

  // S12：POST /apps/:appId/generation-recovery/:generationId（消费恢复决定）
  routes.post("/apps/:appId/generation-recovery/:generationId", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    const membership = await requireOwnerMembership(appId, user.id);
    const generationId = c.req.param("generationId");

    try {
      assertMutationAllowed(deps.protocolMode ?? "compat", "generation");
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status as 423,
        );
      }
      throw err;
    }

    const parsed = recoveryDecisionBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: { code: "invalid_params", message: "恢复决定参数无效" } },
        400,
      );
    }
    try {
      assertMutationProtocolVersion(
        deps.protocolMode ?? "compat",
        "generation",
        parsed.data.protocolVersion,
      );
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          { error: { code: err.code, message: err.message } },
          err.status as 400,
        );
      }
      throw err;
    }

    if (!deps.recoveryCoordinator) {
      return c.json(
        {
          error: {
            code: "recovery_not_available",
            message: "恢复协调器未装配",
          },
        },
        503,
      );
    }

    const outcome = await deps.recoveryCoordinator.executeDecision({
      appId,
      failedGenerationId: generationId,
      failedCandidateDigest: parsed.data.candidateDigest,
      action: parsed.data.action,
      userId: user.id,
      membershipId: membership.id,
    });

    if (!outcome.ok) {
      return c.json(
        {
          error: {
            code: outcome.code,
            message: outcome.message,
          },
        },
        409,
      );
    }

    return c.json({
      ok: true,
      decision: outcome.decision,
      successorGenerationId: outcome.successorGenerationId,
    });
  });

  return routes;
}
