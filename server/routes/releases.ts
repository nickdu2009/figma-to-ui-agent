import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { ReleaseService } from "../release/service.ts";
import {
  createSessionMiddleware,
  requireSession,
} from "../middleware/session.ts";
import {
  requireMembership,
  requireOwnerMembership,
  requireRole,
} from "../middleware/app-guard.ts";
import { HttpError, badRequest } from "../middleware/errors.ts";
import { MigrationRejected } from "../schema-migrations/plan.ts";
import { BusinessSchemaError } from "../business-data/schema-contract.ts";

/**
 * 发布路由（S4，设计 §4.2、AC3/AC4）：
 * - 草稿/已发布版本/当前指针：owner 只读列表；
 * - publish/rollback：仅 owner 显式触发；Schema 门禁在服务层。
 */
const publishSchema = z.object({
  draftId: z.string().min(1).max(64),
  migrationPlan: z.unknown().optional(),
  reversePlan: z.unknown().optional(),
});
const rollbackSchema = z.object({
  publishedVersionId: z.string().min(1).max(64),
});

export function createReleaseRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  releaseRepository: ReleaseRepository;
  releaseService: ReleaseService;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));
  const guard = (appId: string, userId: string) =>
    requireOwnerMembership(deps.appRepository, appId, userId, {
      conceal: true,
    });

  routes.get("/apps/:appId/drafts", async (c) => {
    const { user } = requireSession(c);
    // 草稿列表：owner + editor 可读（S6/S7，设计 §4.2）；viewer 404
    await requireRole(
      deps.appRepository,
      c.req.param("appId"),
      user.id,
      "editor",
      {
        conceal: true,
      },
    );
    const drafts = await deps.releaseRepository.listDrafts(
      c.req.param("appId"),
    );
    return c.json({
      drafts: drafts.map((draft) => ({
        id: draft.id,
        generationRunId: draft.generationRunId,
        status: draft.status,
        createdAt: draft.createdAt,
        // spec/businessSchema 体积大：列表不含正文，按需单独取
      })),
    });
  });

  // 编辑态 Preview 在刷新后需要恢复最新草稿；列表刻意不返回 Spec 正文，
  // 因此提供一个受同等 editor 授权保护的 current 读模型。
  routes.get("/apps/:appId/drafts/current", async (c) => {
    const { user } = requireSession(c);
    await requireRole(
      deps.appRepository,
      c.req.param("appId"),
      user.id,
      "editor",
      { conceal: true },
    );
    const draft = (await deps.releaseRepository.listDrafts(
      c.req.param("appId"),
    ))[0];
    if (!draft) return c.json({ current: null });
    return c.json({
      current: {
        draftVersionId: draft.id,
        generationRunId: draft.generationRunId,
        createdAt: draft.createdAt,
        spec: draft.spec,
        businessSchema: draft.businessSchema,
      },
    });
  });

  routes.get("/apps/:appId/releases/published", async (c) => {
    const { user } = requireSession(c);
    await guard(c.req.param("appId"), user.id);
    const versions = await deps.releaseRepository.listPublishedVersions(
      c.req.param("appId"),
    );
    return c.json({
      versions: versions.map((version) => ({
        id: version.id,
        draftVersionId: version.draftVersionId,
        publishedAt: version.publishedAt,
        publishedByMembershipId: version.publishedByMembershipId,
      })),
    });
  });

  routes.get("/apps/:appId/releases/current", async (c) => {
    const { user } = requireSession(c);
    // 当前发布版本：任何有效成员可读（viewer 的只读预览依赖它，S6/S7）
    await requireMembership(deps.appRepository, c.req.param("appId"), user.id, {
      conceal: true,
    });
    const pointer = await deps.releaseRepository.getReleasePointer(
      c.req.param("appId"),
    );
    if (!pointer) return c.json({ current: null });
    const version = await deps.releaseRepository.findPublishedVersionById(
      pointer.publishedVersionId,
    );
    if (!version) return c.json({ current: null });
    return c.json({
      current: {
        publishedVersionId: version.id,
        draftVersionId: version.draftVersionId,
        publishedAt: version.publishedAt,
        spec: version.spec,
        businessSchema: version.businessSchema,
      },
    });
  });

  routes.post("/apps/:appId/releases/publish", async (c) => {
    const { user } = requireSession(c);
    const membership = await guard(c.req.param("appId"), user.id);
    const body = publishSchema.parse(await c.req.json());
    try {
      const result = await deps.releaseService.publish({
        appId: c.req.param("appId"),
        draftId: body.draftId,
        membershipId: membership.id,
        migrationPlan: body.migrationPlan,
        reversePlan: body.reversePlan,
      });
      return c.json(result);
    } catch (error) {
      return mapReleaseDomainError(error);
    }
  });

  routes.post("/apps/:appId/releases/rollback", async (c) => {
    const { user } = requireSession(c);
    await guard(c.req.param("appId"), user.id);
    const body = rollbackSchema.parse(await c.req.json());
    try {
      await deps.releaseService.rollback({
        appId: c.req.param("appId"),
        publishedVersionId: body.publishedVersionId,
        changedByUserId: user.id,
      });
      return c.json({ ok: true });
    } catch (error) {
      return mapReleaseDomainError(error);
    }
  });

  return routes;
}

/** 迁移领域错误 → HTTP 映射（不暴露内部细节）。 */
function mapReleaseDomainError(error: unknown): never {
  if (error instanceof MigrationRejected) {
    throw new HttpError(409, error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    throw badRequest("invalid_migration_plan", "迁移计划结构非法");
  }
  if (error instanceof BusinessSchemaError) {
    throw badRequest("schema_invalid", error.message);
  }
  throw error;
}
