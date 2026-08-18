import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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

const PREVIEW_RUNTIME_LIMITS: RuntimeLimits = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};

function PreviewFallback({ children }: { children: ReactNode }) {
  return <div className="preview-fallback">{children}</div>;
}

const PREVIEW_FALLBACKS: RuntimeFallbacks = {
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

export function PreviewPanel(props: Partial<PreviewRuntimeHandle>) {
  const runtime = props.runtime ?? getSharedPreviewRuntime();
  const navigation = props.navigation ?? getSharedPreviewNavigation();
  useEffect(() => {
    // StrictMode 会探测性地调用 state initializer；仅在已挂载的 Panel 中
    // 暴露诊断入口，才能保证它是实际渲染的应用实例。
    (window as unknown as Record<string, unknown>).__previewRuntime = runtime;
  }, [runtime]);
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
      <div className="preview-surface">
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
              key={snapshot.revision}
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
