import { Hono } from "hono";
import { z } from "zod";
import type { AuthService } from "../auth/service.ts";
import type { BusinessDataService } from "../business-data/service.ts";
import {
  createSessionMiddleware,
  requireSession,
} from "../middleware/session.ts";
import { badRequest } from "../middleware/errors.ts";
import {
  FieldValueError,
  FieldWriteDeniedError,
  PolicyDeniedError,
  QueryRejected,
} from "../business-data/service.ts";
import { UniqueConflictError } from "../repositories/business-data-repository.ts";

/**
 * 业务数据路由（S5a，设计 §6.3）：
 * GET    /apps/:appId/data/:collection          列表（query 参数走固定契约）
 * POST   /apps/:appId/data/:collection          创建
 * POST   /apps/:appId/data/:collection/query    固定查询（游标分页）
 * GET    /apps/:appId/data/:collection/export   导出（owner）
 * GET    /apps/:appId/data/:collection/:recordId
 * PATCH  /apps/:appId/data/:collection/:recordId（expectedRevision）
 * DELETE /apps/:appId/data/:collection/:recordId（expectedRevision）
 */
const createSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  subjectMembershipId: z.string().max(64).optional(),
  principals: z.array(z.string().max(64)).optional(),
});

const patchSchema = z.object({
  expectedRevision: z.number().int().min(1),
  data: z.record(z.string(), z.unknown()),
  subjectMembershipId: z.string().max(64).optional(),
  principals: z.array(z.string().max(64)).optional(),
});

const deleteSchema = z.object({
  expectedRevision: z.number().int().min(1),
});

/** 领域错误 → HTTP 映射（契约统一）。 */
function mapDomainError(error: unknown): never {
  if (error instanceof z.ZodError) {
    throw badRequest("invalid_query", "请求结构非法");
  }
  if (error instanceof PolicyDeniedError) {
    throw badRequest("forbidden", error.message);
  }
  if (error instanceof FieldWriteDeniedError) {
    throw badRequest("field_write_forbidden", error.message, {
      fields: error.fields,
    });
  }
  if (error instanceof FieldValueError) {
    throw badRequest("field_invalid", error.message);
  }
  if (error instanceof QueryRejected) {
    throw badRequest("invalid_query", error.message);
  }
  if (error instanceof UniqueConflictError) {
    throw badRequest("unique_conflict", error.message);
  }
  throw error;
}

export function createBusinessDataRoutes(deps: {
  authService: AuthService;
  businessData: BusinessDataService;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  async function callerOf(c: {
    req: { param: (name: string) => string };
    get: (key: string) => unknown;
  }) {
    const { user } = requireSession(c as Parameters<typeof requireSession>[0]);
    return deps.businessData.resolveCaller(c.req.param("appId"), user.id);
  }

  routes.post("/apps/:appId/data/:collection", async (c) => {
    try {
      const caller = await callerOf(c);
      const body = createSchema.parse(await c.req.json());
      const record = await deps.businessData.create({
        appId: c.req.param("appId"),
        collectionKey: c.req.param("collection"),
        caller,
        data: body.data,
        subjectMembershipId: body.subjectMembershipId,
        principals: body.principals,
      });
      return c.json({ record }, 201);
    } catch (error) {
      return mapDomainError(error);
    }
  });

  routes.post("/apps/:appId/data/:collection/query", async (c) => {
    try {
      const caller = await callerOf(c);
      const body = await c.req.json().catch(() => ({}));
      const result = await deps.businessData.query({
        appId: c.req.param("appId"),
        collectionKey: c.req.param("collection"),
        caller,
        body,
      });
      return c.json(result);
    } catch (error) {
      return mapDomainError(error);
    }
  });

  // DraftDataView（S5b，设计 §4.3）：当前与候选策略最严交集的只读视图
  routes.get(
    "/apps/:appId/drafts/:draftId/data-view/:collection",
    async (c) => {
      try {
        const caller = await callerOf(c);
        const result = await deps.businessData.previewDraftData({
          appId: c.req.param("appId"),
          draftId: c.req.param("draftId"),
          collectionKey: c.req.param("collection"),
          caller,
        });
        return c.json(result);
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );

  routes.get("/apps/:appId/data/:collection/export", async (c) => {
    try {
      const caller = await callerOf(c);
      const result = await deps.businessData.export({
        appId: c.req.param("appId"),
        collectionKey: c.req.param("collection"),
        caller,
      });
      return c.json(result);
    } catch (error) {
      return mapDomainError(error);
    }
  });

  routes.get("/apps/:appId/data/:collection/:recordId", async (c) => {
    try {
      const caller = await callerOf(c);
      const record = await deps.businessData.get({
        appId: c.req.param("appId"),
        collectionKey: c.req.param("collection"),
        caller,
        recordId: c.req.param("recordId"),
      });
      return c.json({ record });
    } catch (error) {
      return mapDomainError(error);
    }
  });

  routes.patch("/apps/:appId/data/:collection/:recordId", async (c) => {
    try {
      const caller = await callerOf(c);
      const body = patchSchema.parse(await c.req.json());
      const record = await deps.businessData.update({
        appId: c.req.param("appId"),
        collectionKey: c.req.param("collection"),
        caller,
        recordId: c.req.param("recordId"),
        expectedRevision: body.expectedRevision,
        patch: body.data,
        subjectMembershipId: body.subjectMembershipId,
        principals: body.principals,
      });
      return c.json({ record });
    } catch (error) {
      return mapDomainError(error);
    }
  });

  routes.delete("/apps/:appId/data/:collection/:recordId", async (c) => {
    try {
      const caller = await callerOf(c);
      const body = deleteSchema.parse(await c.req.json());
      await deps.businessData.remove({
        appId: c.req.param("appId"),
        collectionKey: c.req.param("collection"),
        caller,
        recordId: c.req.param("recordId"),
        expectedRevision: body.expectedRevision,
      });
      return c.json({ ok: true });
    } catch (error) {
      return mapDomainError(error);
    }
  });

  return routes;
}
