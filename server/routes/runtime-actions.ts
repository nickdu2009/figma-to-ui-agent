/**
 * Runtime Actions 路由（设计 §9.2/§9.4，计划 S8 动作 1–2、6）。
 *
 * - POST /apps/:appId/runtime-actions/dispatch：published 业务 Action 唯一
 *   服务端入口。只信 path appId + Session/Membership；body 不含身份/角色/
 *   替代 appId。X-VMA-Published-Version 头必须与 body.publishedVersionId
 *   一致，事务内锁 ReleasePointer 后核对（executor）。
 * - POST /apps/:appId/runtime-actions/export：CSV 导出字节通道；正文不经
 *   ActionResult/Runtime state/日志，成功返回 text/csv + Content-Disposition。
 * - /apps/:appId/drafts/:draftId/data-view/*：DraftDataView 只读端点；
 *   写入/导出稳定拒绝 draft_readonly。
 */
import { Hono } from "hono";
import type { AuthService } from "../auth/service.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import {
  createSessionMiddleware,
  requireSession,
} from "../middleware/session.ts";
import { requireRole } from "../middleware/app-guard.ts";
import {
  BusinessActionError,
  businessActionCommandSchema,
  type BusinessActionResponse,
} from "../actions/contracts.ts";
import type { TransactionalBusinessActionExecutor } from "../actions/executor.ts";
import type { DraftDataViewService } from "../draft-data-view/service.ts";
import type { CallerContext } from "../business-data/policy.ts";
import {
  assertMutationAllowed,
  ProtocolFenceError,
  type ProtocolMode,
} from "../persistence/protocol-mode.ts";

export const PUBLISHED_VERSION_HEADER = "x-vma-published-version";

export function createRuntimeActionRoutes(deps: {
  authService: AuthService;
  appRepository: AppRepository;
  executor: TransactionalBusinessActionExecutor;
  draftDataView: DraftDataViewService;
  protocolMode?: ProtocolMode;
}): Hono {
  const routes = new Hono();
  routes.use("*", createSessionMiddleware(deps.authService));

  const resolveCaller = async (
    appId: string,
    userId: string,
  ): Promise<CallerContext> => {
    const membership = await requireRole(
      deps.appRepository,
      appId,
      userId,
      "viewer",
      { conceal: true },
    );
    return {
      userId,
      membershipId: membership.id,
      role: membership.role as CallerContext["role"],
    };
  };

  const parseEnvelope = async (c: {
    req: {
      json: () => Promise<unknown>;
      header: (name: string) => string | undefined;
    };
  }) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new BusinessActionError(400, "action_params_invalid", "请求体非法");
    }
    const parsed = businessActionCommandSchema.safeParse(body);
    if (!parsed.success) {
      throw new BusinessActionError(
        400,
        "action_params_invalid",
        "Action 请求信封不合法",
      );
    }
    const header = c.req.header(PUBLISHED_VERSION_HEADER);
    if (!header || header !== parsed.data.publishedVersionId) {
      throw new BusinessActionError(
        400,
        "action_params_invalid",
        "发布版本头与请求体不一致",
      );
    }
    return parsed.data;
  };

  const toErrorResponse = (
    error: unknown,
  ): {
    status: number;
    body: BusinessActionResponse;
  } => {
    if (error instanceof BusinessActionError) {
      return {
        status: error.status,
        body: {
          serverRequestId: "route-rejected",
          status: "error",
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        },
      };
    }
    throw error;
  };

  routes.post("/apps/:appId/runtime-actions/dispatch", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    const caller = await resolveCaller(appId, user.id);
    try {
      assertMutationAllowed(deps.protocolMode ?? "v2", "runtime_action");
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          {
            serverRequestId: "fence-blocked",
            status: "error",
            error: { code: err.code, message: err.message },
          },
          err.status as 423,
        );
      }
      throw err;
    }
    let command;
    try {
      command = await parseEnvelope(c);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return c.json(mapped.body, mapped.status as 400);
    }
    if (command.actionName === "downloadExport") {
      const mapped = toErrorResponse(
        new BusinessActionError(
          400,
          "action_params_invalid",
          "downloadExport 必须经 /runtime-actions/export 字节通道",
        ),
      );
      return c.json(mapped.body, mapped.status as 400);
    }
    const result = await deps.executor.execute({ appId, caller, command });
    const status =
      result.status === "success"
        ? 200
        : statusForErrorCode(result.error?.code ?? "internal_error");
    return c.json(result, status as 200);
  });

  routes.post("/apps/:appId/runtime-actions/export", async (c) => {
    const { user } = requireSession(c);
    const appId = c.req.param("appId");
    const caller = await resolveCaller(appId, user.id);
    try {
      assertMutationAllowed(deps.protocolMode ?? "v2", "runtime_action");
    } catch (err) {
      if (err instanceof ProtocolFenceError) {
        return c.json(
          {
            serverRequestId: "fence-blocked",
            status: "error",
            error: { code: err.code, message: err.message },
          },
          err.status as 423,
        );
      }
      throw err;
    }
    let command;
    try {
      command = await parseEnvelope(c);
    } catch (error) {
      const mapped = toErrorResponse(error);
      return c.json(mapped.body, mapped.status as 400);
    }
    if (command.actionName !== "downloadExport") {
      const mapped = toErrorResponse(
        new BusinessActionError(
          400,
          "action_params_invalid",
          "export 通道只接受 downloadExport",
        ),
      );
      return c.json(mapped.body, mapped.status as 400);
    }
    const result = await deps.executor.execute({ appId, caller, command });
    if (result.status !== "success") {
      const status = statusForErrorCode(result.error?.code ?? "internal_error");
      return c.json(result, status as 400);
    }
    const summary = result.data as {
      fileName: string;
      rowCount: number;
      byteLength: number;
      __csvBody?: string;
    };
    if (typeof summary.__csvBody !== "string") {
      return c.json(
        {
          serverRequestId: result.serverRequestId,
          status: "error",
          error: { code: "internal_error", message: "导出正文缺失" },
        } satisfies BusinessActionResponse,
        500,
      );
    }
    // 字节只经此响应面下发；摘要在 Content-Disposition/自定义头中携带。
    return new Response(summary.__csvBody, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${summary.fileName}"`,
        "x-vma-export-row-count": String(summary.rowCount),
        "x-vma-export-byte-length": String(summary.byteLength),
        "cache-control": "no-store",
      },
    });
  });

  // ---------- DraftDataView（只读） ----------

  routes.post(
    "/apps/:appId/drafts/:draftId/data-view/:collectionKey/query",
    async (c) => {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      const caller = await resolveCaller(appId, user.id);
      let request: unknown = {};
      try {
        request = await c.req.json();
      } catch {
        request = {};
      }
      try {
        const result = await deps.draftDataView.queryCollection({
          appId,
          draftId: c.req.param("draftId"),
          collectionKey: c.req.param("collectionKey"),
          caller,
          request,
        });
        return c.json(result, 200);
      } catch (error) {
        const mapped = toErrorResponse(error);
        return c.json(mapped.body, mapped.status as 400);
      }
    },
  );

  routes.get(
    "/apps/:appId/drafts/:draftId/data-view/:collectionKey/records/:recordId",
    async (c) => {
      const { user } = requireSession(c);
      const appId = c.req.param("appId");
      const caller = await resolveCaller(appId, user.id);
      try {
        const item = await deps.draftDataView.getRecord({
          appId,
          draftId: c.req.param("draftId"),
          collectionKey: c.req.param("collectionKey"),
          recordId: c.req.param("recordId"),
          caller,
        });
        return c.json(item, 200);
      } catch (error) {
        const mapped = toErrorResponse(error);
        return c.json(mapped.body, mapped.status as 400);
      }
    },
  );

  // 草稿写入/导出的稳定拒绝（不落存储、不建账本、不发出下游请求）
  const rejectDraftWrite = (c: {
    json: (body: unknown, status: number) => Response;
  }) => {
    const mapped = toErrorResponse(
      new BusinessActionError(
        409,
        "draft_readonly",
        "草稿阶段业务数据只读，发布后可写",
      ),
    );
    return c.json(mapped.body, mapped.status);
  };
  routes.post(
    "/apps/:appId/drafts/:draftId/data-view/:collectionKey/export",
    rejectDraftWrite,
  );
  routes.post(
    "/apps/:appId/drafts/:draftId/data-view/:collectionKey/records",
    rejectDraftWrite,
  );
  routes.put(
    "/apps/:appId/drafts/:draftId/data-view/:collectionKey/records/:recordId",
    rejectDraftWrite,
  );
  routes.delete(
    "/apps/:appId/drafts/:draftId/data-view/:collectionKey/records/:recordId",
    rejectDraftWrite,
  );

  return routes;
}

function statusForErrorCode(code: string): number {
  switch (code) {
    case "policy_denied":
      return 403;
    case "record_not_found":
    case "collection_not_found":
    case "schema_not_found":
    case "draft_data_unavailable":
      return 404;
    case "published_version_changed":
    case "revision_conflict":
    case "revision_required":
    case "unique_conflict":
    case "idempotency_key_conflict":
    case "limit_record_bytes":
    case "limit_collection_records":
    case "limit_principals":
    case "draft_readonly":
      return 409;
    case "export_too_large":
      return 413;
    case "internal_error":
      return 500;
    default:
      return 400;
  }
}
