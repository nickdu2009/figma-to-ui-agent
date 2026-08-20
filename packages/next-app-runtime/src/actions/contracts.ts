/**
 * Runtime Action 受控合同（设计 §9.1/§9.2/§9.3，计划 S3）。
 *
 * 边界约定：
 * - 四个内置 Action（navigate/setState/pushState/removeState）继续走上游
 *   json-render 执行路径，绝不进入 RuntimeActionAdapter.handlers；
 * - custom Action 只有 RuntimeActionDispatcher 一个执行边界：校验
 *   params/targets/execution、批量写 loading、唯一消费一次 ActionResult
 *   终态、单次静态回调并重新过 Gate；
 * - Adapter 是 NextAppRuntime 与 Browser Host 的窄接口，不向 Spec 暴露
 *   可调用对象；Spec 不能提供或覆盖 dispatchId/idempotencyKey。
 */

/** 运行时执行阶段（设计 §9.2 上下文矩阵；生成实例只允许单调推进）。 */
export type RuntimeActionPhase =
  | "validation"
  | "staging"
  | "unsaved"
  | "draft"
  | "published";

/** Action 权限类别（与 Catalog ActionContract.permissionClass 键闭合）。 */
export type RuntimeActionPermissionClass =
  | "ui"
  | "record-read"
  | "record-write"
  | "attachment"
  | "export";

/** 绑定 Gate 的执行身份：任何标识不匹配即 fail closed。 */
export interface RuntimeActionIdentity {
  appId: string;
  candidateDigest: string;
  bundleRevision: number;
  generationId?: string;
  draftId?: string;
  publishedVersionId?: string;
}

/** 受控状态目标（与宿主 ActionStateTargets 同形；loading/error 必填、result 可选）。 */
export interface RuntimeActionTargets {
  loadingStatePath: string;
  resultStatePath?: string;
  errorStatePath: string;
}

/** Dispatcher 允许的静态回调：只允许纯 UI/导航，重新过 Gate 后执行。 */
export type RuntimeStaticCallback =
  | { kind: "navigate"; href: string; replace?: boolean }
  | { kind: "showToast"; variant: "default" | "success" | "warning" | "error"; title: string; description?: string }
  | { kind: "openDialog"; targetElementId: string }
  | { kind: "closeDialog"; targetElementId: string };

/** 运行时侧 Action 合同：params/targets 校验 + 权限类别 + 静态回调。 */
export interface RuntimeActionContract {
  /** 结构化 params 校验（safeParse 语义；不进入模型上下文）。 */
  validateParams: (params: unknown) => { ok: true; value: Record<string, unknown> } | { ok: false; code: "action_params_invalid" };
  /** 校验精确 loading/result/error 目标路径与 result 写入路径的匹配。 */
  validateTargets: (targets: unknown) => { ok: true; value: RuntimeActionTargets } | { ok: false; code: "action_targets_invalid" };
  permissionClass: RuntimeActionPermissionClass;
  /** 读操作 latest-wins；写/导出/附件 pending 期间去重。 */
  concurrency: "latest-wins" | "exclusive";
  onSuccess?: RuntimeStaticCallback;
  onError?: RuntimeStaticCallback;
}

/** ActionResult 终态（设计 §9.3；错误对象有界且脱敏）。 */
export type RuntimeActionResult =
  | { status: "success"; dispatchId: string; serverRequestId: string; data: unknown }
  | {
      status: "error";
      dispatchId: string;
      serverRequestId?: string;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

export const RUNTIME_ACTION_ERROR_MESSAGE_LIMIT = 500;
export const RUNTIME_ACTION_ERROR_CODE_LIMIT = 64;

/** 归一化有界错误（丢弃 SQL/堆栈/超大 payload）。 */
export function normalizeActionError(
  error: unknown,
  fallbackCode = "action_failed",
): {
  code: string;
  message: string;
} {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    const code =
      typeof candidate.code === "string" && candidate.code.length > 0 &&
      candidate.code.length <= RUNTIME_ACTION_ERROR_CODE_LIMIT && /^[a-z0-9_]+$/.test(candidate.code)
        ? candidate.code
        : fallbackCode;
    const message =
      typeof candidate.message === "string" && candidate.message.length > 0
        ? candidate.message.slice(0, RUNTIME_ACTION_ERROR_MESSAGE_LIMIT)
        : fallbackCode;
    return { code, message };
  }
  return { code: fallbackCode, message: fallbackCode };
}

/** 上下文阶段矩阵（设计 §9.2 表格的运行时投影）。 */
const PHASE_MATRIX: Record<
  RuntimeActionPhase,
  Partial<Record<RuntimeActionPermissionClass, { allowed: boolean; stableCode?: string }>>
> = {
  validation: {
    ui: { allowed: true },
    "record-read": { allowed: true },
    "record-write": { allowed: false, stableCode: "validation_action_forbidden" },
    attachment: { allowed: false, stableCode: "validation_action_forbidden" },
    export: { allowed: false, stableCode: "validation_action_forbidden" },
  },
  staging: {
    ui: { allowed: true },
    "record-read": { allowed: false, stableCode: "preview_staging" },
    "record-write": { allowed: false, stableCode: "preview_staging" },
    attachment: { allowed: false, stableCode: "preview_staging" },
    export: { allowed: false, stableCode: "preview_staging" },
  },
  unsaved: {
    ui: { allowed: true },
    "record-read": { allowed: false, stableCode: "preview_not_saved" },
    "record-write": { allowed: false, stableCode: "preview_not_saved" },
    attachment: { allowed: false, stableCode: "preview_not_saved" },
    export: { allowed: false, stableCode: "preview_not_saved" },
  },
  draft: {
    ui: { allowed: true },
    "record-read": { allowed: true },
    "record-write": { allowed: false, stableCode: "draft_write_forbidden" },
    attachment: { allowed: false, stableCode: "draft_write_forbidden" },
    export: { allowed: false, stableCode: "draft_write_forbidden" },
  },
  published: {
    ui: { allowed: true },
    "record-read": { allowed: true },
    "record-write": { allowed: true },
    attachment: { allowed: true },
    export: { allowed: true },
  },
};

export interface PhaseDecision {
  allowed: boolean;
  stableCode?: string;
}

/** 阶段 × 权限判定（纯函数； revoked 由 Gate 自身处理）。 */
export function decidePhaseAction(
  phase: RuntimeActionPhase,
  permissionClass: RuntimeActionPermissionClass,
): PhaseDecision {
  const entry = PHASE_MATRIX[phase][permissionClass];
  if (!entry) return { allowed: false, stableCode: "action_forbidden" };
  return entry;
}

/** 平台 UI dispatcher：openDialog/closeDialog/showToast 的唯一执行面。 */
export interface RuntimePlatformUiDispatcher {
  navigate(href: string, replace?: boolean): void;
  openDialog(targetElementId: string): void;
  closeDialog(targetElementId: string): void;
  showToast(input: {
    variant: "default" | "success" | "warning" | "error";
    title: string;
    description?: string;
  }): void;
}

/** hostEffects：宿主提供的窄效果面（UI dispatcher + 有界读）。 */
export interface RuntimeHostEffects {
  platformUi: RuntimePlatformUiDispatcher;
}

/** RuntimeActionHandler：只有 Dispatcher 可以调用。 */
export type RuntimeActionHandler = (input: {
  dispatchId: string;
  idempotencyKey: string | null;
  params: Record<string, unknown>;
  phase: RuntimeActionPhase;
  identity: Readonly<RuntimeActionIdentity>;
  signal: AbortSignal;
}) => Promise<RuntimeActionResult>;

/** 版本化 Adapter（Browser Host 组装；handlers 在创建时冻结）。 */
export interface RuntimeActionAdapter {
  protocolVersion: 1;
  handlers: Readonly<Record<string, RuntimeActionHandler>>;
  contracts: Readonly<Record<string, RuntimeActionContract>>;
  hostEffects: RuntimeHostEffects;
}

/** 已通过 Dispatcher 入口校验的单次 dispatch（identity 由宿主层附加，Spec 不可控）。 */
export interface ValidatedCustomActionInvocation {
  actionName: string;
  params: Record<string, unknown>;
  identity: Readonly<RuntimeActionIdentity>;
  /** 显式重试：复用原 dispatch 的 idempotencyKey（仅写操作）。 */
  retryOfDispatchId?: string;
}

export interface RuntimeActionDispatchResult {
  dispatchId: string;
  idempotencyKey: string | null;
}

/** Dispatcher 公开合同（设计 §9.2；组件只获得 void 终态）。 */
export interface RuntimeActionDispatcher {
  dispatchCustomAction(
    invocation: ValidatedCustomActionInvocation,
  ): Promise<RuntimeActionDispatchResult>;
  /** 取得既有 dispatch 的 idempotencyKey（显式重试复用；终态后仍可读）。 */
  getIdempotencyKey(dispatchId: string): string | null;
  /** Adapter 冻结的 custom Action 名（宿主分流用；built-in 永不在内）。 */
  getAdapterActionNames(): readonly string[];
  /** 当前 Gate 身份（宿主层构造 invocation 用；不可被 Spec 影响）。 */
  getExecutionIdentity(): Readonly<RuntimeActionIdentity>;
  /** 页面级 state store 注册（PageRenderer 挂载/卸载时调用；null = 撤销写权限）。 */
  setActiveStateStore(store: StateStoreLike | null): void;
  /** Gate 绑定身份推进（Controller 独占；单调校验）。 */
  transitionPhase(next: RuntimeActionPhase): { ok: true } | { ok: false; code: string };
  revoke(): void;
}

/** Dispatcher 需要的最小 state store 面（prototype-safe store 的 batch update）。 */
export interface StateStoreLike {
  get(path: string): unknown;
  update(updates: Record<string, unknown>): void;
}

/** 内置 Action 名集合（上游路径专属，永不进入 Adapter）。 */
export const RUNTIME_BUILT_IN_ACTION_NAMES: ReadonlySet<string> = new Set([
  "navigate",
  "setState",
  "pushState",
  "removeState",
]);

/** 校验 Adapter 结构（创建时一次；键与 Catalog 精确闭合由 catalog-gate 完成）。 */
export function assertRuntimeActionAdapter(adapter: RuntimeActionAdapter): void {
  if (adapter.protocolVersion !== 1) {
    throw new Error("RuntimeActionAdapter.protocolVersion 必须为 1");
  }
  const handlerKeys = Object.keys(adapter.handlers).sort();
  const contractKeys = Object.keys(adapter.contracts).sort();
  if (
    handlerKeys.length !== contractKeys.length ||
    handlerKeys.some((name, index) => name !== contractKeys[index])
  ) {
    throw new Error(
      "RuntimeActionAdapter.handlers 与 contracts 键不闭合",
    );
  }
  for (const name of handlerKeys) {
    if (RUNTIME_BUILT_IN_ACTION_NAMES.has(name)) {
      throw new Error(`内置 Action 不得进入 Adapter handlers：${name}`);
    }
  }
  if (typeof adapter.hostEffects?.platformUi?.navigate !== "function") {
    throw new Error("RuntimeActionAdapter.hostEffects.platformUi 缺失");
  }
}
