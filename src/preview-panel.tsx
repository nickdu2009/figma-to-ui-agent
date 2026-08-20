import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  createRuntimeWithNavigation,
  NextAppRenderer,
  NextAppRuntimeProvider,
  type NextAppRuntime,
  type RuntimeFallbacks,
  type RuntimeLimits,
} from "@next-app-runtime/client";

import { catalog, registry } from "./runtime/catalog";
import { minimalBaseSpec } from "./runtime/minimal-base-spec";
import {
  createPreviewNavigation,
  type PreviewNavigation,
} from "./runtime/preview-navigation";
import {
  createBundlePreviewController,
  type BundlePreviewController,
} from "./runtime/bundle-preview-controller.ts";
import { createBrowserRuntimeActionAdapter } from "./runtime/runtime-action-adapter.ts";

export const PREVIEW_RUNTIME_LIMITS: RuntimeLimits = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};

function PreviewFallback({ children }: { children: ReactNode }) {
  return <div className="preview-fallback">{children}</div>;
}

export const PREVIEW_FALLBACKS: RuntimeFallbacks = {
  loading: () => <PreviewFallback>加载中…</PreviewFallback>,
  error: ({ snapshot }) => (
    <PreviewFallback>
      渲染出错：{snapshot.error?.message ?? "未知错误"}
    </PreviewFallback>
  ),
  notFound: () => <PreviewFallback>页面不存在</PreviewFallback>,
  unmatched: () => (
    <PreviewFallback>当前应用还没有可渲染的页面</PreviewFallback>
  ),
};

export interface PreviewRuntimeHandle {
  runtime: NextAppRuntime;
  navigation: PreviewNavigation;
}

/**
 * 每个 Workbench 必须拥有自己的 Preview runtime。把它放在模块单例会让
 * A 应用的 Spec 在切到 B 应用后继续渲染，且前端工具会读到错误应用的数据。
 */
export function createPreviewRuntime(): PreviewRuntimeHandle {
  const navigation = createPreviewNavigation();
  const runtime = createRuntimeWithNavigation(
    {
      catalog,
      registry,
      limits: PREVIEW_RUNTIME_LIMITS,
      fallbacks: PREVIEW_FALLBACKS,
      ...(import.meta.env.VITE_SPEC_BENCHMARK === "1"
        ? {
            observer: (event: { name: string }) => {
              benchmarkRuntimeEvents.push(event.name);
              if (benchmarkRuntimeEvents.length > 200)
                benchmarkRuntimeEvents.shift();
            },
          }
        : {}),
    },
    navigation,
  );
  return { runtime, navigation };
}

/**
 * S4：工作台的唯一 BundlePreviewController（设计 §5.1.1）。
 *
 * 候选/active Runtime 的组装面在此闭合：同一 catalog/registry、同一
 * Preview 限额与回退、同一 BrowserActionAdapter（custom Action 键与
 * catalog.data.actions 精确闭合；S4 期间为空集）。执行阶段与身份由
 * Controller 传入，Adapter handlers 在 Runtime 创建时冻结。
 */
export function createWorkbenchPreviewController(
  appId: string,
): BundlePreviewController {
  return createBundlePreviewController({
    appId,
    createPreviewRuntime: ({
      navigation,
      executionContext,
      initialSource,
      hostSurface,
      downloadIntents,
    }) => {
      const catalogActionNames = Object.keys(
        (catalog.data as { actions?: Record<string, unknown> }).actions ?? {},
      );
      const actionAdapter = createBrowserRuntimeActionAdapter({
        appId,
        surface: hostSurface,
        downloadIntents,
        includeActionNames: catalogActionNames,
      });
      return createRuntimeWithNavigation(
        {
          catalog,
          registry,
          limits: PREVIEW_RUNTIME_LIMITS,
          fallbacks: PREVIEW_FALLBACKS,
          actionAdapter,
          actionExecutionContext: executionContext,
          initialSource,
        },
        navigation,
      );
    },
  });
}

// 基准页没有账户/应用工作台；保留它专用的惰性实例，避免把基准兼容性
// 误当成产品态的跨应用共享。
let benchmarkPreview: PreviewRuntimeHandle | null = null;
const benchmarkRuntimeEvents: string[] = [];

export function getSharedPreviewRuntime(): NextAppRuntime {
  if (benchmarkPreview === null) {
    benchmarkPreview = createPreviewRuntime();
    if (typeof window !== "undefined") {
      if (import.meta.env.VITE_SPEC_BENCHMARK === "1") {
        Object.assign(window as unknown as Record<string, unknown>, {
          __previewNavigation: benchmarkPreview.navigation,
          __previewRuntimeEvents: benchmarkRuntimeEvents,
        });
      }
    }
  }
  return benchmarkPreview.runtime;
}

function getSharedPreviewNavigation(): PreviewNavigation {
  getSharedPreviewRuntime();
  if (benchmarkPreview === null) {
    throw new Error("preview navigation was not initialized");
  }
  return benchmarkPreview.navigation;
}

function BrowserIconButton(props: {
  label: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="preview-browser-button"
      data-testid={props.testId}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function AddressLockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.25" />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

const EMPTY_SUBSCRIBE = () => () => undefined;

/** controller 模式的稳定空快照（避免每次渲染新对象触发 useSyncExternalStore 告警）。 */
const NULL_SNAPSHOT = null;

export function PreviewPanel(
  props: {
    controller?: BundlePreviewController;
  } & Partial<PreviewRuntimeHandle>,
) {
  // controller 模式：active 句柄（Runtime/导航/bundleRevision）来自唯一的
  // BundlePreviewController；无 controller 时退回基准页共享实例。
  const controllerSnapshot = useSyncExternalStore(
    props.controller ? props.controller.subscribe : EMPTY_SUBSCRIBE,
    props.controller
      ? props.controller.getSnapshot
      : () => NULL_SNAPSHOT,
    () => NULL_SNAPSHOT,
  );
  const activeHandle = controllerSnapshot?.active ?? null;
  const runtime =
    activeHandle?.runtime ?? props.runtime ?? getSharedPreviewRuntime();
  const navigation =
    activeHandle?.navigation ?? props.navigation ?? getSharedPreviewNavigation();
  const bundleRevision = activeHandle?.bundleRevision ?? 0;
  const designCss = activeHandle?.designCss ?? null;
  // S6：编译后的应用 CSS 注入 containment root。designCss 是 css-compiler 的
  // 白名单产物（仅作用域选择器/命名空间 keyframes/blob: URL），不经过 HTML
  // 解析器：命令式创建 <style> 并赋值 textContent，随 bundleRevision 原子替换。
  const previewSurfaceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const surface = previewSurfaceRef.current;
    if (!surface || designCss === null) return;
    const style = document.createElement("style");
    style.setAttribute("data-vma-design-css", "");
    style.textContent = designCss;
    surface.insertBefore(style, surface.firstChild);
    return () => {
      style.remove();
    };
  }, [designCss, bundleRevision]);
  useEffect(() => {
    // StrictMode 会探测性地调用 state initializer；仅在已挂载的 Panel 中
    // 暴露诊断入口，才能保证它是实际渲染的应用实例。
    (window as unknown as Record<string, unknown>).__previewRuntime = runtime;
    // S6：暴露 Controller 诊断入口（浏览器隔离验收用；仅 controller 模式）。
    if (props.controller) {
      (window as unknown as Record<string, unknown>).__previewController =
        props.controller;
    }
  }, [runtime, props.controller]);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const [applyError, setApplyError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const previewAddress = `preview.local${snapshot.location.pathname}${snapshot.location.search}${snapshot.location.hash}`;

  const handleReset = useCallback(() => {
    setApplyError(null);
    setResetting(true);
    void runtime
      .applySource({ kind: "object", value: minimalBaseSpec })
      .then((result) => {
        // A rejected apply keeps the last valid `current` inside the runtime;
        // we only surface the error and never clear the preview ourselves.
        if (result.status === "rejected") {
          setApplyError(`${result.error.code}: ${result.error.message}`);
        }
      })
      .catch((cause: unknown) => {
        setApplyError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        setResetting(false);
      });
  }, [runtime]);

  return (
    <section data-testid="preview-panel" className="preview-panel">
      <header className="preview-browser-shell">
        <div className="preview-browser-chrome">
          <span className="preview-browser-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div className="preview-browser-controls" aria-label="预览导航">
            <BrowserIconButton
              label="后退"
              testId="preview-back"
              disabled={!navigation.canGoBack()}
              onClick={() => navigation.back()}
            >
              ‹
            </BrowserIconButton>
            <BrowserIconButton
              label="前进"
              testId="preview-forward"
              disabled={!navigation.canGoForward()}
              onClick={() => navigation.forward()}
            >
              ›
            </BrowserIconButton>
            <BrowserIconButton
              label="刷新预览"
              testId="preview-reload"
              onClick={() => navigation.reload()}
            >
              ↻
            </BrowserIconButton>
          </div>
          <div
            data-testid="preview-address"
            className="preview-address"
            title={previewAddress}
          >
            <AddressLockIcon />
            {previewAddress}
          </div>
          <span className="preview-browser-spacer" aria-hidden="true" />
        </div>
        <div className="preview-toolbar">
          <span data-testid="preview-revision" className="preview-revision">
            revision {snapshot.revision}
          </span>
          <span data-testid="preview-status" className="preview-status">
            {snapshot.specStatus} / {snapshot.routeStatus}
          </span>
          <span className="preview-path">{snapshot.location.pathname}</span>
          <button
            type="button"
            data-testid="preview-reset"
            className="preview-reset"
            onClick={handleReset}
            disabled={resetting}
          >
            重置应用
          </button>
        </div>
      </header>
      {applyError === null ? null : (
        <div data-testid="preview-error" role="alert" className="preview-error">
          {applyError}
        </div>
      )}
      <div
        ref={previewSurfaceRef}
        className="preview-surface"
        data-vma-preview-root={designCss === null ? undefined : ""}
        data-bundle-revision={bundleRevision}
      >
        <NextAppRuntimeProvider runtime={runtime}>
          {snapshot.specStatus === "empty" ? (
            <div data-testid="preview-empty" className="preview-fallback">
              <div className="preview-empty-inner">
                <div className="preview-empty-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 48 48"
                    width="44"
                    height="44"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="6" y="10" width="36" height="28" rx="3" />
                    <path d="M6 18h36" />
                    <path
                      d="M20 34l4-8 4 4 6-10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p className="preview-empty-title">还没有可预览的内容</p>
                <p className="preview-empty-hint">
                  在左侧对话中描述你想要的应用，生成并提交后
                  预览会在这里实时渲染。
                </p>
              </div>
            </div>
          ) : (
            <div
              key={`${bundleRevision}:${snapshot.revision}`}
              data-testid="preview-content"
              className="preview-content-enter"
            >
              <NextAppRenderer />
            </div>
          )}
        </NextAppRuntimeProvider>
      </div>
    </section>
  );
}
