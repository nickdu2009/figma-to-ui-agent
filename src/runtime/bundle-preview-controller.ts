/**
 * BundlePreviewController（设计 §5.1.1，计划 S4）：宿主唯一的 Bundle 预览事务边界。
 *
 * 事务顺序固定（任一步失败销毁候选并保留旧 revision）：
 * 1. （v2）校验完整 AppUiBundle：schema + 字节/数量门禁 + 重算 uiBundleDigest；
 * 2. 创建候选 Runtime（staging gate，Adapter handlers 冻结，custom Action 稳定拒绝）；
 * 3. 对 bundle.spec 恰好调用一次 runtime.applySource（v1 兼容路径先以 initialSource
 *    携带当前 spec 出生，再应用唯一一次 jsonl-patch）；
 * 4. 最小 smoke（specStatus ready + current 存在；隐藏 DOM 渲染 smoke 属 S6 containment）；
 * 5. 一次原子提交（store 单次 notify = 单个 React commit）：active Runtime、
 *    navigation、bundleRevision 同步切换；新 gate 单调推进 staging→unsaved；
 *    旧 Adapter 立即撤销，旧 Runtime 在切换完成后销毁；
 * 6. Preview Commit 返回 draft_committed 后经 confirmDraftCommitted 核对
 *    appId/candidateDigest/bundleRevision/draftId 并推进 phase→draft
 *    （draft-bound 资源重绑定属 S7/S13；S4 只推进 gate）。
 *
 * 浏览器不维护第二套长期 Renderer；dispose 即撤销一切 gate 与 Runtime，
 * 旧闭包（迟到 finish/回调）稳定拒绝。
 */
import {
  RuntimeError,
  type NextAppRuntime,
  type NextAppSpec,
  type NextAppSpecSource,
  type RuntimeActionIdentity,
  type RuntimeActionPhase,
  type RuntimeErrorCode,
  type SourceResult,
} from "@next-app-runtime/client";

import {
  appUiBundleSchema,
  type AppUiBundle,
} from "../catalog/app-ui-bundle.ts";
import { validateBundleGates } from "../catalog/bundle-gates.ts";
import {
  digestCanonicalJson,
  type Sha256Digest,
} from "../catalog/canonical-json.ts";
import {
  createPreviewNavigation,
  type PreviewNavigation,
} from "./preview-navigation.ts";
import type {
  ActivePreviewHandle,
  BundlePreviewStore,
  PreviewExecutionBinding,
} from "./bundle-preview-store.ts";
import { BundlePreviewStore as Store } from "./bundle-preview-store.ts";
import type { BrowserActionHostSurface } from "./runtime-action-adapter.ts";
import { TokenCompilerError, compileTokens } from "./token-compiler.ts";
import { CssCompilerError, compileApplicationCss } from "./css-compiler.ts";
import {
  AssetUrlResolver,
  type AssetByteSource,
  type AssetReadBinding,
} from "./asset-url-resolver.ts";
import {
  createDownloadIntentHost,
  type DownloadIntentHost,
} from "./download-intent.ts";

export type { BundlePreviewSnapshot } from "./bundle-preview-store.ts";

const DEFAULT_STAGING_TIMEOUT_MS = 30_000;

/** 宿主提供的候选 Runtime 工厂（catalog/registry/Adapter 组装在宿主侧闭合）。 */
export interface PreviewRuntimeFactoryInput {
  navigation: PreviewNavigation;
  executionContext: {
    phase: RuntimeActionPhase;
    identity: RuntimeActionIdentity;
  };
  initialSource?: NextAppSpecSource;
  /** Adapter hostEffects 面（Controller 拥有；navigate 读当前 active navigation）。 */
  hostSurface: BrowserActionHostSurface;
  /** S8：DownloadIntent Host（Controller 拥有；随执行上下文 revoke 联动）。 */
  downloadIntents: DownloadIntentHost;
}

export type PreviewRuntimeFactory = (
  input: PreviewRuntimeFactoryInput,
) => NextAppRuntime;

/** v2 权威 Bundle 的服务端期望值（S11 finish 载荷）。 */
export interface BundleExpectation {
  candidateDigest: string;
  uiBundleDigest: string;
  reportDigest?: string;
  /** finish 载荷的 sequence/operationCount（正整数；跨值核对属 S11 接线）。 */
  sequence?: number;
  operationCount?: number;
}

export interface StageBundleInput {
  generationId: string;
  bundle: unknown;
  expected: BundleExpectation;
  signal?: AbortSignal;
}

export interface StageGenerationPatchInput {
  generationId: string;
  base: "empty" | "current";
  patchText: string;
  signal?: AbortSignal;
}

export type PersistedExecution =
  | { phase: "draft"; draftId: string; generationId?: string }
  | { phase: "published"; publishedVersionId: string };

export interface StagePersistedInput {
  spec: unknown;
  bundle?: AppUiBundle | null;
  execution: PersistedExecution;
  signal?: AbortSignal;
}

export interface ConfirmDraftInput {
  appId: string;
  candidateDigest: string;
  bundleRevision: number;
  draftId: string;
}

export type ConfirmDraftResult = { ok: true } | { ok: false; code: string };

export interface BundlePreviewControllerOptions {
  appId: string;
  createPreviewRuntime: PreviewRuntimeFactory;
  stagingTimeoutMs?: number;
  /**
   * S6：受控字节源（fixture；S7 接管真实 private,no-store 路由）。
   * 提供时对 bundle.assets 建 Controller-private 资源句柄；缺省跳过资源解析
   * （CSS 中的 url(asset:*) 会因无法闭合而拒绝该 Bundle）。
   */
  assetByteSource?: AssetByteSource;
  /**
   * S7：按执行绑定派生受权字节源（generation/draft/published 版本化读取面；
   * 每次重新授权，不复用响应）。与 assetByteSource 二选一，本项优先。
   */
  assetByteSourceFor?: (binding: AssetReadBinding) => AssetByteSource;
  /** Node 测试环境（无 Image/FontFace）注入。 */
  skipAssetDecode?: boolean;
  /** S8：DownloadIntent Host（测试注入；缺省由 Controller 创建并拥有）。 */
  downloadIntents?: DownloadIntentHost;
}

/** 设计编译失败的稳定 code（S6 合同测试锁定）。 */
export function designFailureCode(cause: unknown): string {
  if (cause instanceof TokenCompilerError) {
    return `design_${cause.code}`;
  }
  if (cause instanceof CssCompilerError) {
    // CSS 错误码已带 css_ 前缀，避免双重前缀。
    return cause.code;
  }
  if (cause instanceof Error && cause.message.startsWith("asset_")) {
    return cause.message.split(":")[0] ?? "asset_fetch_failed";
  }
  return "design_compile_failed";
}

/**
 * S6：编译 Bundle 的 Token/CSS/资源三件套。
 * - token → CSS 自定义属性 + 字体资源 IR；
 * - applicationCss → 作用域选择器 + 命名空间 keyframes + 资源占位；
 * - 资源占位经 AssetUrlResolver 解析后替换为 blob: URL（原子：失败返回 null
 *   交由调用方丢弃候选并保留旧 Preview）。
 */
async function compileBundleDesign(
  bundle: AppUiBundle,
  digestPrefix: string,
  options: BundlePreviewControllerOptions,
  /** 预留的 bundleRevision：CSS 作用域属性与提交句柄共用同一数值。 */
  scopeRevision: number,
  /** S7：版本化读取绑定（generation 面）；优先派生受权字节源。 */
  readBinding: AssetReadBinding | null,
): Promise<{ cssText: string; disposeAssets: (() => void) | null }> {
  const tokens = compileTokens({
    tokens: bundle.designSystem.tokens as never,
    digestPrefix,
  });

  const scopeAttribute = `[data-vma-preview-root][data-bundle-revision="${scopeRevision}"]`;

  const manifestIds = new Set(
    bundle.assets.entries.map((entry) => entry.assetId),
  );
  const compiled = compileApplicationCss({
    applicationCss: bundle.designSystem.applicationCss,
    scopeAttribute,
    digestPrefix,
    tokenCustomProperties: tokens.customProperties,
    manifestAssetIds: manifestIds,
  });

  const assetIds = [
    ...new Set([
      ...compiled.assetRefs.map((ref) => ref.assetId),
      ...tokens.fontAssetRefs.map((ref) => ref.assetId),
    ]),
  ];
  for (const assetId of assetIds) {
    if (!manifestIds.has(assetId)) {
      throw new CssCompilerError(
        "css_dangling_asset_ref",
        `资源引用不在 Manifest：${assetId}`,
      );
    }
  }

  if (assetIds.length === 0) {
    return { cssText: compiled.cssText, disposeAssets: null };
  }
  const byteSource =
    (readBinding !== null && options.assetByteSourceFor
      ? options.assetByteSourceFor(readBinding)
      : null) ??
    options.assetByteSource ??
    null;
  if (byteSource === null) {
    throw new Error(
      "asset_fetch_failed: no asset byte source (S6 fixture/S7 route)",
    );
  }
  const resolver = new AssetUrlResolver({
    manifest: bundle.assets as never,
    fetchBytes: byteSource,
    digestPrefix,
    skipDecode: options.skipAssetDecode,
  });
  try {
    await resolver.stageCandidate(assetIds);
    resolver.commitCandidate();
  } catch (cause) {
    resolver.dispose();
    throw cause;
  }
  let substituted = compiled.cssText;
  compiled.assetRefs.forEach((ref, index) => {
    const handle = resolver.getActiveHandle(ref.assetId);
    if (!handle) {
      resolver.dispose();
      throw new Error(`asset_fetch_failed:${ref.assetId}`);
    }
    substituted = substituted.replaceAll(
      `var(__VMA_ASSET_${index}__)`,
      `url("${handle.objectUrl}")`,
    );
  });
  return {
    cssText: substituted,
    disposeAssets: () => {
      resolver.disposeRetired();
      resolver.dispose();
    },
  };
}

/** v2 Bundle 事务结果（设计 §5.1.1 BundlePreviewResult 投影）。 */
export type BundleStageOutcome =
  | {
      status: "committed";
      candidateDigest: Sha256Digest;
      uiBundleDigest: Sha256Digest;
      bundleRevision: number;
      runtimeRevision: number;
    }
  | { status: "failed" | "cancelled"; code: string };

interface StagingState {
  generationId: string | null;
  runtime: NextAppRuntime;
  navigation: PreviewNavigation;
  abort: AbortController;
}

function defaultRouteOf(spec: NextAppSpec): string | null {
  const routes = Object.keys(spec.routes ?? {});
  if (routes.length === 0) return null;
  if (routes.includes("/")) return "/";
  return routes[0]!;
}

function waitForSpecReady(
  runtime: NextAppRuntime,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // timer/unsubscribe 延后赋值：首次同步 check 通过时 settle 不得引用
    // 未初始化的 const（TDZ ReferenceError）。
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe?.();
      if (err) reject(err);
      else resolve();
    };
    const check = () => {
      const snapshot = runtime.getSnapshot();
      if (snapshot.specStatus === "ready" && snapshot.current != null) {
        settle(null);
        return true;
      }
      if (
        snapshot.specStatus === "invalid" ||
        snapshot.specStatus === "cancelled"
      ) {
        settle(new RuntimeError("preview_smoke_failed", "候选预览初始化失败"));
        return true;
      }
      return false;
    };
    if (check()) return;
    timer = setTimeout(() => {
      settle(new RuntimeError("preview_staging_timeout", "候选预览初始化超时"));
    }, timeoutMs);
    unsubscribe = runtime.subscribe(() => {
      check();
    });
  });
}

export interface BundlePreviewController {
  readonly appId: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReturnType<BundlePreviewStore["getSnapshot"]>;
  getActiveRuntime(): NextAppRuntime | null;
  getActiveNavigation(): PreviewNavigation | null;
  /** v1 兼容：generation 补丁的候选事务（结果与 SourceResult 同形）。 */
  stageGenerationPatch(input: StageGenerationPatchInput): Promise<SourceResult>;
  /** v2：权威 AppUiBundle 的候选事务。 */
  stageBundle(input: StageBundleInput): Promise<BundleStageOutcome>;
  /** 刷新/发布/回滚装载：draft 或 published 绑定的候选事务。 */
  stagePersisted(input: StagePersistedInput): Promise<SourceResult>;
  /** Preview Commit（draft_committed）后的 gate 推进。 */
  confirmDraftCommitted(input: ConfirmDraftInput): ConfirmDraftResult;
  dispose(): void;
}

export function createBundlePreviewController(
  options: BundlePreviewControllerOptions,
): BundlePreviewController {
  const { appId } = options;
  const timeoutMs = options.stagingTimeoutMs ?? DEFAULT_STAGING_TIMEOUT_MS;
  const store = new Store();
  let bundleRevisionCounter = 0;
  let staging: StagingState | null = null;
  let retired: Array<{
    runtime: NextAppRuntime;
    /** S6：退役代的资源销毁钩（与 Runtime 同步销毁）。 */
    disposeAssets?: (() => void) | null;
  }> = [];
  let disposed = false;
  /** 已进入终态的 generation（旧 finish / 重复 finish 稳定拒绝）。 */
  const settledGenerations = new Set<string>();

  const hostSurface: BrowserActionHostSurface = {
    navigate: (href, replace) => {
      const navigation = store.getSnapshot().active?.navigation;
      if (!navigation) return;
      if (replace) navigation.replace(href);
      else navigation.push(href);
    },
    showToast: (input) => void store.pushToast(input),
    setDialogOpen: (elementId, open) => store.setDialogOpen(elementId, open),
  };
  /** S8：Controller 拥有的 DownloadIntent Host（执行上下文 revoke 时联动）。 */
  const downloadIntents = options.downloadIntents ?? createDownloadIntentHost();

  const createCandidate = (input: {
    identity: RuntimeActionIdentity;
    phase: RuntimeActionPhase;
    initialSource?: NextAppSpecSource;
  }): { runtime: NextAppRuntime; navigation: PreviewNavigation } => {
    const currentPathname =
      store.getSnapshot().active?.navigation.getSnapshot().pathname ?? "/";
    const navigation = createPreviewNavigation(currentPathname);
    const runtime = options.createPreviewRuntime({
      navigation,
      executionContext: { phase: input.phase, identity: input.identity },
      initialSource: input.initialSource,
      hostSurface,
      downloadIntents,
    });
    return { runtime, navigation };
  };

  const destroyCandidate = (candidate: { runtime: NextAppRuntime }): void => {
    const dispatcher = candidate.runtime.getActionDispatcher();
    dispatcher?.revoke();
    downloadIntents.revokeAll();
    candidate.runtime.dispose();
  };

  const retireActive = (): void => {
    const active = store.getSnapshot().active;
    if (!active) return;
    const dispatcher = active.runtime.getActionDispatcher();
    dispatcher?.revoke();
    downloadIntents.revokeAll();
    retired.push({
      runtime: active.runtime,
      disposeAssets: active.disposeAssets,
    });
    if (retired.length > 4) {
      const dropped = retired.splice(0, retired.length - 4);
      for (const entry of dropped) {
        entry.disposeAssets?.();
        entry.runtime.dispose();
      }
    }
    // 主切换提交后的下一个宏任务销毁退役 Runtime（切换完成后 dispose）。
    setTimeout(() => {
      retired = retired.filter((entry) => {
        entry.disposeAssets?.();
        entry.runtime.dispose();
        return false;
      });
    }, 0);
  };

  const commitCandidate = (handle: ActivePreviewHandle): void => {
    retireActive();
    store.commitActive(handle);
  };

  // 初始 active：空 Runtime（无内容；Adapter 零 handler，无可派发 Action）。
  const initial = createCandidate({
    identity: {
      appId,
      candidateDigest: "v1:empty",
      bundleRevision: 0,
    },
    phase: "unsaved",
  });
  store.commitActive({
    runtime: initial.runtime,
    navigation: initial.navigation,
    bundleRevision: 0,
    runtimeRevision: 0,
    candidateDigest: "v1:empty",
    uiBundleDigest: null,
    execution: { phase: "unsaved", generationId: "__initial__" },
    bundle: null,
    spec: null,
    designCss: null,
    disposeAssets: null,
  });

  const activeRevision = (): number =>
    store.getSnapshot().active?.runtime.getSnapshot().revision ?? 0;

  const rejectStaging = (
    code: RuntimeErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): SourceResult => ({
    status: "rejected",
    revision: activeRevision(),
    error: new RuntimeError(code, message, details),
  });

  /** 共享事务骨架：候选创建 → 唯一 applySource → smoke → 原子提交。 */
  const runStagingTransaction = async (input: {
    generationId: string | null;
    phase: RuntimeActionPhase;
    identity: RuntimeActionIdentity;
    initialSource?: NextAppSpecSource;
    apply: (runtime: NextAppRuntime) => Promise<SourceResult>;
    execution: PreviewExecutionBinding;
    bundle: AppUiBundle | null;
    uiBundleDigest: Sha256Digest | null;
    /** S6：编译后的应用 CSS（已替换资源 URL；失败路径 null）。 */
    designCss?: string | null;
    /** S6：本代资源销毁钩（commit 后由 active 拥有）。 */
    disposeAssets?: (() => void) | null;
    /**
     * S6：stageBundle 路径在编译前预留的 bundleRevision（CSS 作用域属性与
     * 提交句柄必须同一数值）。缺省时事务自行递增（stageDraft 等旧路径）。
     */
    reservedBundleRevision?: number;
    signal?: AbortSignal;
  }): Promise<SourceResult> => {
    if (disposed) {
      return { status: "cancelled", revision: activeRevision() };
    }
    if (staging !== null) {
      return rejectStaging("preview_staging_busy", "已有候选预览在暂存中");
    }
    const candidate = createCandidate({
      identity: input.identity,
      phase: input.phase,
      initialSource: input.initialSource,
    });
    const abort = new AbortController();
    const forwardAbort = () => abort.abort();
    if (input.signal?.aborted) abort.abort();
    else input.signal?.addEventListener("abort", forwardAbort, { once: true });
    staging = {
      generationId: input.generationId,
      runtime: candidate.runtime,
      navigation: candidate.navigation,
      abort,
    };
    store.beginStaging();
    let outcome: SourceResult;
    try {
      if (input.initialSource) {
        await waitForSpecReady(candidate.runtime, timeoutMs);
      }
      outcome = await input.apply(candidate.runtime);
      if (outcome.status === "committed") {
        const snapshot = candidate.runtime.getSnapshot();
        // 最小 smoke：specStatus ready + current 存在（隐藏 DOM 渲染属 S6）。
        if (snapshot.specStatus !== "ready" || snapshot.current == null) {
          outcome = rejectStaging(
            "preview_smoke_failed",
            "候选预览未达到可渲染状态",
          );
        } else if (snapshot.routeStatus === "unmatched") {
          const fallback = defaultRouteOf(snapshot.current);
          if (fallback !== null) candidate.navigation.push(fallback);
        }
      }
    } catch (cause) {
      if (cause instanceof RuntimeError) {
        // 初始化超时/失败等稳定 code 保留（如 preview_staging_timeout）。
        outcome = {
          status: "rejected",
          revision: activeRevision(),
          error: cause,
        };
      } else {
        outcome = {
          status: "cancelled",
          revision: activeRevision(),
        };
        if (cause instanceof Error && cause.name !== "AbortError") {
          outcome = rejectStaging("preview_staging_failed", "候选预览事务失败");
        }
      }
      void cause;
    }
    staging = null;
    if (input.signal) input.signal.removeEventListener("abort", forwardAbort);

    if (outcome.status !== "committed" || disposed) {
      input.disposeAssets?.();
      destroyCandidate(candidate);
      store.markFailed();
      if (input.generationId !== null)
        settledGenerations.add(input.generationId);
      if (outcome.status === "committed") {
        return { status: "cancelled", revision: activeRevision() };
      }
      return outcome;
    }

    const snapshot = candidate.runtime.getSnapshot();
    let nextRevision = input.reservedBundleRevision;
    if (nextRevision === undefined) {
      bundleRevisionCounter += 1;
      nextRevision = bundleRevisionCounter;
    }
    if (input.generationId !== null) settledGenerations.add(input.generationId);
    const dispatcher = candidate.runtime.getActionDispatcher();
    if (dispatcher && input.phase === "staging") {
      const transition = dispatcher.transitionPhase("unsaved");
      if (!transition.ok) {
        destroyCandidate(candidate);
        store.markFailed();
        return rejectStaging(
          "preview_staging_failed",
          "候选预览阶段推进被拒绝",
          {
            code: transition.code,
          },
        );
      }
    }
    commitCandidate({
      runtime: candidate.runtime,
      navigation: candidate.navigation,
      bundleRevision: nextRevision,
      runtimeRevision: snapshot.revision,
      candidateDigest: input.identity.candidateDigest as Sha256Digest,
      uiBundleDigest: input.uiBundleDigest,
      execution: input.execution,
      bundle: input.bundle,
      spec: snapshot.current,
      designCss: input.designCss ?? null,
      disposeAssets: input.disposeAssets ?? null,
    });
    return outcome;
  };

  const controller: BundlePreviewController = {
    appId,
    subscribe: (listener) => store.subscribe(listener),
    getSnapshot: () => store.getSnapshot(),
    getActiveRuntime: () => store.getSnapshot().active?.runtime ?? null,
    getActiveNavigation: () => store.getSnapshot().active?.navigation ?? null,

    async stageGenerationPatch(input) {
      if (disposed) {
        return { status: "cancelled", revision: activeRevision() };
      }
      if (settledGenerations.has(input.generationId)) {
        return rejectStaging("stale_generation", "该生成事务已进入终态");
      }
      const activeSpec =
        store.getSnapshot().active?.runtime.getSnapshot().current ?? null;
      if (input.base === "current" && activeSpec == null) {
        settledGenerations.add(input.generationId);
        return rejectStaging("base_spec_missing", "增量补丁缺少当前 Spec 基线");
      }
      return runStagingTransaction({
        generationId: input.generationId,
        phase: "staging",
        identity: {
          appId,
          candidateDigest: `v1gen:${input.generationId}`,
          bundleRevision: bundleRevisionCounter + 1,
          generationId: input.generationId,
        },
        initialSource:
          input.base === "current" && activeSpec != null
            ? { kind: "object", value: activeSpec }
            : undefined,
        apply: (runtime) =>
          runtime.applySource(
            {
              kind: "jsonl-patch",
              base: input.base,
              value: input.patchText,
            },
            { signal: staging?.abort.signal },
          ),
        execution: { phase: "unsaved", generationId: input.generationId },
        bundle: null,
        uiBundleDigest: null,
        signal: input.signal,
      });
    },

    async stageBundle(input) {
      const parsed = appUiBundleSchema.safeParse(input.bundle);
      if (!parsed.success) {
        return { status: "failed", code: "bundle_invalid" };
      }
      const bundle = parsed.data;
      const gates = validateBundleGates(bundle);
      if (!gates.ok) {
        return { status: "failed", code: gates.code };
      }
      if (
        Number.isFinite(input.expected.sequence) &&
        (!Number.isInteger(input.expected.sequence) ||
          input.expected.sequence! < 1)
      ) {
        return { status: "failed", code: "finish_meta_invalid" };
      }
      if (
        Number.isFinite(input.expected.operationCount) &&
        (!Number.isInteger(input.expected.operationCount) ||
          input.expected.operationCount! < 1)
      ) {
        return { status: "failed", code: "finish_meta_invalid" };
      }
      const recomputed = await digestCanonicalJson(bundle);
      if (recomputed !== input.expected.uiBundleDigest) {
        return { status: "failed", code: "bundle_digest_mismatch" };
      }
      // S6：Token/CSS 编译（fail closed：编译失败保留旧 Preview）。
      const digestPrefix = recomputed.replace(/^sha256:/, "").slice(0, 8);
      // 编译前预留 bundleRevision：CSS 作用域属性与提交句柄共用同一数值。
      bundleRevisionCounter += 1;
      const reservedRevision = bundleRevisionCounter;
      let design: {
        cssText: string;
        disposeAssets: (() => void) | null;
      };
      try {
        design = await compileBundleDesign(
          bundle,
          digestPrefix,
          options,
          reservedRevision,
          {
            kind: "generation",
            appId,
            generationId: input.generationId,
            candidateDigest: input.expected.candidateDigest,
          },
        );
      } catch (cause) {
        if (settledGenerations.has(input.generationId)) {
          return { status: "failed", code: "stale_generation" };
        }
        return {
          status: "failed",
          code: designFailureCode(cause),
        };
      }
      if (disposed) {
        design.disposeAssets?.();
        return { status: "cancelled", code: "controller_disposed" };
      }
      if (settledGenerations.has(input.generationId)) {
        design.disposeAssets?.();
        return { status: "failed", code: "stale_generation" };
      }
      const sourceResult = await runStagingTransaction({
        generationId: input.generationId,
        phase: "staging",
        identity: {
          appId,
          candidateDigest: input.expected.candidateDigest,
          bundleRevision: reservedRevision,
          generationId: input.generationId,
        },
        apply: (runtime) =>
          runtime.applySource(
            { kind: "object", value: bundle.spec },
            { signal: staging?.abort.signal },
          ),
        execution: { phase: "unsaved", generationId: input.generationId },
        bundle,
        uiBundleDigest: recomputed,
        designCss: design.cssText,
        disposeAssets: design.disposeAssets,
        reservedBundleRevision: reservedRevision,
        signal: input.signal,
      });
      if (sourceResult.status === "committed") {
        return {
          status: "committed",
          candidateDigest: input.expected.candidateDigest as Sha256Digest,
          uiBundleDigest: recomputed,
          bundleRevision: bundleRevisionCounter,
          runtimeRevision: sourceResult.revision,
        };
      }
      return {
        status: sourceResult.status === "rejected" ? "failed" : "cancelled",
        code:
          sourceResult.status === "rejected"
            ? sourceResult.error.code
            : "staging_aborted",
      };
    },

    async stagePersisted(input) {
      const execution: PersistedExecution = input.execution;
      bundleRevisionCounter += 1;
      const reservedRevision = bundleRevisionCounter;
      const identity: RuntimeActionIdentity =
        execution.phase === "draft"
          ? {
              appId,
              candidateDigest: `draft:${execution.draftId}`,
              bundleRevision: reservedRevision,
              draftId: execution.draftId,
              generationId: execution.generationId,
            }
          : {
              appId,
              candidateDigest: `published:${execution.publishedVersionId}`,
              bundleRevision: reservedRevision,
              publishedVersionId: execution.publishedVersionId,
            };
      const binding: PreviewExecutionBinding =
        execution.phase === "draft"
          ? {
              phase: "draft",
              draftId: execution.draftId,
              generationId: execution.generationId,
            }
          : {
              phase: "published",
              publishedVersionId: execution.publishedVersionId,
            };

      let design: { cssText: string; disposeAssets: (() => void) | null } = {
        cssText: "",
        disposeAssets: null,
      };
      let uiBundleDigest: Sha256Digest | null = null;
      let validBundle: AppUiBundle | null = null;
      let specToApply: unknown = input.spec;

      if (input.bundle) {
        const parsed = appUiBundleSchema.safeParse(input.bundle);
        if (parsed.success) {
          validBundle = parsed.data;
          specToApply = validBundle.spec;
          uiBundleDigest = (await digestCanonicalJson(
            validBundle,
          )) as Sha256Digest;
          const digestPrefix = uiBundleDigest
            .replace(/^sha256:/, "")
            .slice(0, 8);
          try {
            design = await compileBundleDesign(
              validBundle,
              digestPrefix,
              options,
              reservedRevision,
              execution.phase === "draft"
                ? { kind: "draft", appId, draftId: execution.draftId }
                : {
                    kind: "published",
                    appId,
                    publishedVersionId: execution.publishedVersionId,
                  },
            );
          } catch {
            // fail closed or empty css fallback
            design = { cssText: "", disposeAssets: null };
          }
        }
      }

      return runStagingTransaction({
        generationId: null,
        phase: execution.phase,
        identity,
        apply: (runtime) =>
          runtime.applySource(
            { kind: "object", value: specToApply },
            { signal: staging?.abort.signal },
          ),
        execution: binding,
        bundle: validBundle,
        uiBundleDigest,
        designCss: design.cssText,
        disposeAssets: design.disposeAssets,
        reservedBundleRevision: reservedRevision,
        signal: input.signal,
      });
    },

    confirmDraftCommitted(input) {
      const active = store.getSnapshot().active;
      if (!active) return { ok: false, code: "no_active_preview" };
      if (active.execution.phase !== "unsaved") {
        return { ok: false, code: "phase_mismatch" };
      }
      if (
        input.appId !== appId ||
        input.candidateDigest !== active.candidateDigest ||
        input.bundleRevision !== active.bundleRevision
      ) {
        return { ok: false, code: "identity_mismatch" };
      }
      const dispatcher = active.runtime.getActionDispatcher();
      if (!dispatcher) return { ok: false, code: "no_active_dispatcher" };
      const transition = dispatcher.transitionPhase("draft");
      if (!transition.ok) return { ok: false, code: transition.code };
      store.updateActiveExecution({
        phase: "draft",
        draftId: input.draftId,
        generationId:
          active.execution.phase === "unsaved"
            ? active.execution.generationId
            : undefined,
      });
      return { ok: true };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (staging !== null) {
        staging.abort.abort();
        destroyCandidate(staging);
        staging = null;
      }
      const active = store.getSnapshot().active;
      if (active) {
        active.runtime.getActionDispatcher()?.revoke();
        active.runtime.dispose();
      }
      downloadIntents.dispose();
      for (const entry of retired) {
        entry.disposeAssets?.();
        entry.runtime.dispose();
      }
      retired = [];
      store.clearActive();
      store.shutdown();
    },
  };

  return controller;
}
