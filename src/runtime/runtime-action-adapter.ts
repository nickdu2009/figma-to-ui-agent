/**
 * Browser Host 的 RuntimeActionAdapter（设计 §9.1/§9.2，计划 S4 骨架、S8 服务端）。
 *
 * - 10 个 P0 custom Action 的合同来自 src/catalog/action-contracts.ts（单一事实）；
 * - ui 类（openDialog/closeDialog/showToast）在宿主内本地执行（platformUi 面），
 *   不产生网络请求；
 * - 数据类（queryRecords/…/downloadExport）经版本化 Hono 路由
 *   POST /api/apps/:appId/runtime-actions 受控执行（S8 实现服务端；
 *   在此之前路由 404 → 稳定 action_transport_failed，fail closed）；
 * - handlers/contracts 在创建时冻结；dispatchId/idempotencyKey 由 Dispatcher
 *   生成，Spec 不可提供。
 */
import type {
  RuntimeActionAdapter,
  RuntimeActionContract,
  RuntimeActionHandler,
  RuntimeActionResult,
  RuntimeHostEffects,
} from "@next-app-runtime/client";

import {
  actionStateTargetsSchema,
  p0CustomActions,
  type ActionContract,
} from "../catalog/action-contracts.ts";
import {
  createDownloadIntentHost,
  type DownloadIntentHost,
} from "./download-intent.ts";

/** 与服务端 server/actions/contracts.ts 对齐的响应信封。 */
interface ServerActionResponse {
  serverRequestId: string;
  status: "success" | "error";
  data?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

const PUBLISHED_VERSION_HEADER = "x-vma-published-version";

/** 宿主效果面：Controller 注入（navigate/store 落点）。 */
export interface BrowserActionHostSurface {
  navigate(href: string, replace?: boolean): void;
  showToast(input: {
    variant: "default" | "success" | "warning" | "error";
    title: string;
    description?: string;
  }): void;
  setDialogOpen(elementId: string, open: boolean): void;
}

/** ui 类 Action 的共享惰性目标（params 不含 targets；dispatcher 仍需可写目标）。 */
const UI_ACTION_TARGETS = Object.freeze({
  loadingStatePath: "/runtime/actions/__ui/loading",
  errorStatePath: "/runtime/actions/__ui/error",
});

type ParseCheck =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: "action_params_invalid" };

function mapParamsParse(
  parsed: { success: boolean; data?: unknown },
): ParseCheck {
  if (parsed.success && parsed.data && typeof parsed.data === "object") {
    return { ok: true, value: parsed.data as Record<string, unknown> };
  }
  return { ok: false, code: "action_params_invalid" };
}

function makeUiContract(action: ActionContract): RuntimeActionContract {
  return {
    validateParams: (params) => mapParamsParse(action.params.safeParse(params)),
    validateTargets: () => ({ ok: true, value: { ...UI_ACTION_TARGETS } }),
    permissionClass: "ui",
    concurrency: "latest-wins",
  };
}

function makeDataContract(action: ActionContract): RuntimeActionContract {
  return {
    validateParams: (params) => mapParamsParse(action.params.safeParse(params)),
    validateTargets: (targets) => {
      const parsed = actionStateTargetsSchema.safeParse(targets);
      if (parsed.success) {
        return { ok: true, value: { ...parsed.data } };
      }
      return { ok: false, code: "action_targets_invalid" as const };
    },
    permissionClass: action.permissionClass,
    concurrency: action.permissionClass === "record-read" ? "latest-wins" : "exclusive",
  };
}

function dispatchUrl(appId: string): string {
  return `/api/apps/${encodeURIComponent(appId)}/runtime-actions/dispatch`;
}

function exportUrl(appId: string): string {
  return `/api/apps/${encodeURIComponent(appId)}/runtime-actions/export`;
}

function draftQueryUrl(appId: string, draftId: string, collectionKey: string): string {
  return `/api/apps/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}/data-view/${encodeURIComponent(collectionKey)}/query`;
}

function draftRecordUrl(
  appId: string,
  draftId: string,
  collectionKey: string,
  recordId: string,
): string {
  return `/api/apps/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}/data-view/${encodeURIComponent(collectionKey)}/records/${encodeURIComponent(recordId)}`;
}

type HandlerInput = Parameters<RuntimeActionHandler>[0];

function errorResult(
  dispatchId: string,
  code: string,
  message: string,
): RuntimeActionResult {
  return { status: "error", dispatchId, error: { code, message } };
}

function transportFailed(dispatchId: string, message: string): RuntimeActionResult {
  return errorResult(dispatchId, "action_transport_failed", message);
}

/** 非 published/draft 可读路径的稳定失败：不发出任何 Hono 业务请求。 */
function phaseRejected(input: HandlerInput): RuntimeActionResult {
  return errorResult(
    input.dispatchId,
    "action_forbidden",
    `当前预览阶段（${input.phase}）不执行数据 Action`,
  );
}

function mapServerResponse(
  input: HandlerInput,
  body: unknown,
): RuntimeActionResult {
  const candidate = body as Partial<ServerActionResponse> | null;
  if (!candidate || (candidate.status !== "success" && candidate.status !== "error")) {
    return transportFailed(input.dispatchId, "Action 响应形状非法");
  }
  if (candidate.status === "success") {
    return {
      status: "success",
      dispatchId: input.dispatchId,
      serverRequestId:
        typeof candidate.serverRequestId === "string"
          ? candidate.serverRequestId
          : "unknown",
      data: candidate.data ?? null,
    };
  }
  return errorResult(
    input.dispatchId,
    typeof candidate.error?.code === "string"
      ? candidate.error.code
      : "action_failed",
    typeof candidate.error?.message === "string"
      ? candidate.error.message
      : "Action 执行失败",
  );
}

async function parseJsonOrTransport(
  input: HandlerInput,
  response: Response,
): Promise<RuntimeActionResult> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return transportFailed(input.dispatchId, "Action 响应不可解析");
  }
  return mapServerResponse(input, body);
}

/** published 阶段：POST dispatch 路由（版本头 + 严格信封；body 无身份/角色）。 */
async function dispatchPublished(
  appId: string,
  actionName: string,
  input: HandlerInput,
  fetchImpl: typeof fetch,
): Promise<RuntimeActionResult> {
  const publishedVersionId = input.identity.publishedVersionId;
  if (!publishedVersionId) {
    return errorResult(
      input.dispatchId,
      "action_forbidden",
      "缺少已发布版本身份，fail closed",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(dispatchUrl(appId), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [PUBLISHED_VERSION_HEADER]: publishedVersionId,
      },
      signal: input.signal,
      body: JSON.stringify({
        protocolVersion: 1,
        publishedVersionId,
        actionName,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        canonicalParams: input.params,
      }),
    });
  } catch {
    return transportFailed(input.dispatchId, "Action 请求未能到达服务端");
  }
  return parseJsonOrTransport(input, response);
}

/** draft 阶段：只读 DraftDataView；写入/导出在适配层稳定拒绝（无网络）。 */
async function dispatchDraftRead(
  appId: string,
  actionName: string,
  input: HandlerInput,
  fetchImpl: typeof fetch,
): Promise<RuntimeActionResult> {
  const draftId = input.identity.draftId;
  if (!draftId) {
    return errorResult(
      input.dispatchId,
      "draft_data_unavailable",
      "缺少草稿身份，fail closed",
    );
  }
  const params = input.params as {
    collectionKey?: unknown;
    recordId?: unknown;
    where?: unknown;
    orderBy?: unknown;
    limit?: unknown;
    cursor?: unknown;
  };
  const collectionKey = typeof params.collectionKey === "string" ? params.collectionKey : "";
  if (!collectionKey) {
    return errorResult(input.dispatchId, "action_params_invalid", "缺少 collectionKey");
  }
  try {
    if (actionName === "queryRecords") {
      const response = await fetchImpl(
        draftQueryUrl(appId, draftId, collectionKey),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          signal: input.signal,
          body: JSON.stringify({
            where: params.where,
            orderBy: params.orderBy,
            limit: params.limit,
            cursor: params.cursor,
          }),
        },
      );
      return await parseDraftReadResponse(input, response);
    }
    // loadRecordForm
    const recordId = typeof params.recordId === "string" ? params.recordId : "";
    if (!recordId) {
      return errorResult(input.dispatchId, "action_params_invalid", "缺少 recordId");
    }
    const response = await fetchImpl(
      draftRecordUrl(appId, draftId, collectionKey, recordId),
      { credentials: "include", signal: input.signal },
    );
    return await parseDraftReadResponse(input, response);
  } catch {
    return transportFailed(input.dispatchId, "草稿数据请求未能到达服务端");
  }
}

async function parseDraftReadResponse(
  input: HandlerInput,
  response: Response,
): Promise<RuntimeActionResult> {
  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return transportFailed(input.dispatchId, "草稿数据响应不可解析");
    }
    return {
      status: "success",
      dispatchId: input.dispatchId,
      serverRequestId: "draft-data-view",
      data: body ?? null,
    };
  }
  return parseJsonOrTransport(input, response);
}

/**
 * downloadExport（published）：DownloadIntent 合同。
 * handler 同步前缀在真实 click/submit 栈内创建单次 Host handle 与同源空白
 * target；异步字节到达后恰好消费一次。字节不进入 ActionResult/state/日志。
 */
function makeDownloadExportHandler(
  appId: string,
  fetchImpl: typeof fetch,
  downloadIntents: DownloadIntentHost,
): RuntimeActionHandler {
  return (input) => {
    // —— 同步前缀（user-gesture 栈内）——
    if (input.phase !== "published") {
      return Promise.resolve(phaseRejected(input));
    }
    const publishedVersionId = input.identity.publishedVersionId;
    if (!publishedVersionId) {
      return Promise.resolve(
        errorResult(input.dispatchId, "action_forbidden", "缺少已发布版本身份"),
      );
    }
    const intent = downloadIntents.beginDownloadIntent();
    if (!intent) {
      return Promise.resolve(
        errorResult(
          input.dispatchId,
          "download_intent_unavailable",
          "无法创建下载目标（可能被浏览器拦截）",
        ),
      );
    }
    // —— 异步正文获取与一次性消费 ——
    return (async (): Promise<RuntimeActionResult> => {
      let response: Response;
      try {
        response = await fetchImpl(exportUrl(appId), {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            [PUBLISHED_VERSION_HEADER]: publishedVersionId,
          },
          signal: input.signal,
          body: JSON.stringify({
            protocolVersion: 1,
            publishedVersionId,
            actionName: "downloadExport",
            ...(input.idempotencyKey
              ? { idempotencyKey: input.idempotencyKey }
              : {}),
            canonicalParams: input.params,
          }),
        });
      } catch {
        downloadIntents.cancelDownload(intent);
        return transportFailed(input.dispatchId, "导出请求未能到达服务端");
      }
      if (!response.ok) {
        downloadIntents.cancelDownload(intent);
        return parseJsonOrTransport(input, response);
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        downloadIntents.cancelDownload(intent);
        return transportFailed(input.dispatchId, "导出正文读取失败");
      }
      const fileName =
        parseContentDispositionFileName(
          response.headers.get("content-disposition"),
        ) ?? "export.csv";
      const complete = downloadIntents.completeDownload(
        intent,
        fileName,
        bytes,
        "text/csv; charset=utf-8",
      );
      if (!complete.ok) {
        return errorResult(
          input.dispatchId,
          complete.code,
          "下载目标已不可用（重复消费或已撤销）",
        );
      }
      // ActionResult 只携带完成摘要；CSV 字节不进入 result。
      return {
        status: "success",
        dispatchId: input.dispatchId,
        serverRequestId: "export",
        data: {
          fileName,
          rowCount: Number(
            response.headers.get("x-vma-export-row-count") ?? "0",
          ),
          byteLength: Number(
            response.headers.get("x-vma-export-byte-length") ?? "0",
          ),
        },
      };
    })();
  };
}

function parseContentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}

export interface BrowserRuntimeActionAdapterOptions {
  appId: string;
  surface: BrowserActionHostSurface;
  /** DownloadIntent Host（Controller 注入；缺省内部创建，phase revoke 不联动）。 */
  downloadIntents?: DownloadIntentHost;
  /** 注入用（测试/探针）；缺省使用全局 fetch。 */
  fetchImpl?: typeof fetch;
  /**
   * 只注册这些 P0 Action（默认全部）。catalog gate 要求
   * catalog.actions = handlers ∪ adapterActionNames 精确闭合。
   */
  includeActionNames?: readonly string[];
}

export function createBrowserRuntimeActionAdapter(
  options: BrowserRuntimeActionAdapterOptions,
): RuntimeActionAdapter {
  const { appId, surface } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const downloadIntents =
    options.downloadIntents ?? createDownloadIntentHost();
  const include = options.includeActionNames
    ? new Set(options.includeActionNames)
    : null;

  const handlers: Record<string, RuntimeActionHandler> = {};
  const contracts: Record<string, RuntimeActionContract> = {};

  for (const [name, action] of Object.entries(p0CustomActions)) {
    if (include && !include.has(name)) continue;
    if (action.permissionClass === "ui") {
      contracts[name] = makeUiContract(action);
      handlers[name] = async (input) => {
        const params = input.params as Record<string, unknown>;
        if (name === "openDialog") {
          surface.setDialogOpen(String(params.targetElementId), true);
          return {
            status: "success",
            dispatchId: input.dispatchId,
            serverRequestId: "local",
            data: { opened: true },
          };
        }
        if (name === "closeDialog") {
          surface.setDialogOpen(String(params.targetElementId), false);
          return {
            status: "success",
            dispatchId: input.dispatchId,
            serverRequestId: "local",
            data: { closed: true },
          };
        }
        // showToast（ui 类唯一其余成员）
        surface.showToast({
          variant: params.variant as "default" | "success" | "warning" | "error",
          title: String(params.title),
          description:
            typeof params.description === "string" ? params.description : undefined,
        });
        return {
          status: "success",
          dispatchId: input.dispatchId,
          serverRequestId: "local",
          data: { shown: true },
        };
      };
      continue;
    }
    contracts[name] = makeDataContract(action);
    if (name === "downloadExport") {
      handlers[name] = makeDownloadExportHandler(
        appId,
        fetchImpl,
        downloadIntents,
      );
      continue;
    }
    const isRead = action.permissionClass === "record-read";
    handlers[name] = async (input) => {
      if (input.phase === "published") {
        return dispatchPublished(appId, name, input, fetchImpl);
      }
      if (input.phase === "draft" && isRead) {
        return dispatchDraftRead(appId, name, input, fetchImpl);
      }
      // draft 写入/导出、unsaved/staging 一切数据 Action：fail closed，无网络
      if (input.phase === "draft") {
        return errorResult(
          input.dispatchId,
          "draft_readonly",
          "草稿阶段业务数据只读，发布后可写",
        );
      }
      return phaseRejected(input);
    };
  }

  const hostEffects: RuntimeHostEffects = {
    platformUi: {
      navigate: (href, replace) => surface.navigate(href, replace),
      openDialog: (elementId) => surface.setDialogOpen(elementId, true),
      closeDialog: (elementId) => surface.setDialogOpen(elementId, false),
      showToast: (input) => surface.showToast(input),
    },
  };

  return Object.freeze({
    protocolVersion: 1 as const,
    handlers: Object.freeze(handlers),
    contracts: Object.freeze(contracts),
    hostEffects,
  });
}
