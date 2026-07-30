import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Spec } from "@json-render/core";
import {
  createStateStore,
  JSONUIProvider,
  Renderer,
} from "@json-render/react";

import type { DesignBundle } from "../../src/design-bundle/schema.ts";
import { toPreviewJsonSpec } from "../../src/preview/json-render-adapter.ts";
import type { UISpec } from "../../src/ui-spec/schema.ts";
import type { ValidationRecord } from "../../src/validation/schema.ts";
import { registry } from "./catalog-registry.tsx";
import {
  loadRegisteredFonts,
  setFontStatus,
  type FontAssetStatus,
} from "./font-assets.ts";

type LoadState =
  | { status: "loading" }
  | { status: "empty" }
  | {
      status: "ready";
      bundle: DesignBundle;
      uiSpec: UISpec;
      validation?: ValidationRecord;
    }
  | { status: "error"; message: string };

function projectImageUrl(
  projectId: string,
  path: string,
  designBundleRevision: number,
): string {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/projects/${encodeURIComponent(
    projectId,
  )}/files/${encodedPath}?revision=${designBundleRevision}`;
}

async function getJson<T>(
  path: string,
  signal: AbortSignal,
): Promise<T | null> {
  const response = await fetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`读取项目数据失败：HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function useProjectData(
  projectId: string | undefined,
  runId: string | undefined,
  designBundleRevision: number | undefined,
  uiSpecRevision: number | undefined,
): LoadState {
  const [state, setState] = useState<LoadState>(() =>
    projectId ? { status: "loading" } : { status: "empty" },
  );
  useEffect(() => {
    if (!projectId) {
      setState({ status: "empty" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    Promise.all([
      getJson<DesignBundle>(
        `/api/projects/${encodeURIComponent(
          projectId,
        )}/design-bundle${
          designBundleRevision
            ? `?revision=${designBundleRevision}`
            : ""
        }`,
        controller.signal,
      ),
      getJson<UISpec>(
        `/api/projects/${encodeURIComponent(projectId)}/ui-spec${
          uiSpecRevision ? `?revision=${uiSpecRevision}` : ""
        }`,
        controller.signal,
      ),
      runId
        ? getJson<ValidationRecord>(
            `/api/projects/${encodeURIComponent(
              projectId,
            )}/runs/${encodeURIComponent(runId)}`,
            controller.signal,
          )
        : Promise.resolve(null),
    ])
      .then(([bundle, uiSpec, validation]) => {
        if (!bundle || !uiSpec) {
          setState({ status: "empty" });
          return;
        }
        setState({
          status: "ready",
          bundle,
          uiSpec,
          validation: validation ?? undefined,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "读取项目数据失败",
        });
      });
    return () => controller.abort();
  }, [
    designBundleRevision,
    projectId,
    runId,
    uiSpecRevision,
  ]);
  return state;
}

function screenshotForPage(
  bundle: DesignBundle,
  pageId: string,
): string | undefined {
  const pageSourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "page" && entry.entityId === pageId,
  )?.sourceIdHash;
  const screenshotPath = pageSourceHash
    ? bundle.provenance.find(
        (entry) =>
          entry.entityKind === "screenshot" &&
          entry.sourceIdHash === pageSourceHash,
      )?.entityId
    : undefined;
  return screenshotPath;
}

function runArtifactUrl(
  projectId: string,
  relativePath: string,
): string {
  const match = relativePath.match(
    /^runs\/([^/]+)\/(screenshots|diffs)\/([^/]+)$/,
  );
  if (!match) {
    return "";
  }
  return `/api/projects/${encodeURIComponent(
    projectId,
  )}/run-files/${encodeURIComponent(
    match[1]!,
  )}/${match[2]}/${encodeURIComponent(match[3]!)}`;
}

function imageMetadataByPath(
  bundle: DesignBundle,
): Map<string, { width: number; height: number }> {
  return new Map(
    [...bundle.assets, ...bundle.screenshots].map((image) => [
      image.path,
      { width: image.width, height: image.height },
    ]),
  );
}

function useRegisteredFonts(
  bundle: DesignBundle,
  projectId: string,
): FontAssetStatus {
  const [status, setStatus] = useState<FontAssetStatus>(() => {
    const initial = {
      status: "loading",
      registered: bundle.fonts.length,
      loaded: 0,
      failed: 0,
      missing: 0,
      errors: [],
    } satisfies FontAssetStatus;
    setFontStatus(initial);
    return initial;
  });
  useEffect(() => {
    let cancelled = false;
    const loading = {
      status: "loading",
      registered: bundle.fonts.length,
      loaded: 0,
      failed: 0,
      missing: 0,
      errors: [],
    } satisfies FontAssetStatus;
    setFontStatus(loading);
    setStatus(loading);
    loadRegisteredFonts(bundle, (path) =>
      projectImageUrl(projectId, path, bundle.revision),
    ).then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bundle, projectId]);
  return status;
}

type BundleNode = DesignBundle["pages"][number]["nodes"][number];
type TextStyleHint = NonNullable<UISpec["nodes"][number]["style"]>;

interface TextRenderHint {
  style: TextStyleHint;
  visualOverlay?: {
    assetRef: string;
    sourceWidth: number;
    sourceHeight: number;
    frame: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}

function normalizedTextKey(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase();
}

function canonicalText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim().toLocaleLowerCase();
}

function fontWeightName(
  value: number | undefined,
): TextStyleHint["fontWeight"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value;
}

function usesDisplayFallback(value: string | undefined): boolean {
  return Boolean(
    value &&
      /(tenor|didot|bodoni|playfair|cormorant|garamond)/i.test(value),
  );
}

function fontFamilyWithFallback(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const quoted = value.includes(" ") ? `"${value}"` : value;
  if (usesDisplayFallback(value)) {
    return `${quoted}, Didot, "Bodoni 72", "Times New Roman", serif`;
  }
  return `${quoted}, "Helvetica Neue", Arial, sans-serif`;
}

function relativeBounds(
  node: BundleNode,
  root: BundleNode,
): { left: number; top: number; width: number; height: number } | undefined {
  if (!node.bounds || !root.bounds) {
    return undefined;
  }
  return {
    left: node.bounds.x - root.bounds.x,
    top: node.bounds.y - root.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
  };
}

function buildTextStyleHints(
  bundle: DesignBundle,
  uiSpec: UISpec,
  pageId: string,
): Map<string, TextRenderHint> {
  const uiPage = uiSpec.pages.find((page) => page.id === pageId);
  const sourcePage = uiPage
    ? bundle.pages.find((page) => page.id === uiPage.sourcePageId)
    : undefined;
  if (!uiPage || !sourcePage) {
    return new Map();
  }
  const root =
    sourcePage.nodes.find((node) =>
      sourcePage.rootNodeIds.includes(node.id),
    ) ?? sourcePage.nodes.find((node) => node.id === sourcePage.id);
  if (!root) {
    return new Map();
  }
  const usesCompactArtboardTextOverlay =
    root.bounds !== undefined && root.bounds.width <= 600;
  const pageScreenshotPath = screenshotForPage(bundle, sourcePage.id);
  const pageScreenshot = pageScreenshotPath
    ? imageMetadataByPath(bundle).get(pageScreenshotPath)
    : undefined;
  const candidates = sourcePage.nodes
    .filter((node) => node.kind === "text" && node.text)
    .map((node) => ({
      node,
      key: normalizedTextKey(node.text!.characters),
      canonical: canonicalText(node.text!.characters),
      bounds: relativeBounds(node, root),
    }))
    .filter((candidate) => candidate.bounds);
  const hints = new Map<string, TextRenderHint>();
  for (const node of uiSpec.nodes) {
    if (
      node.kind !== "text" ||
      !node.style ||
      node.style.position !== "absolute"
    ) {
      continue;
    }
    const key = normalizedTextKey(node.text);
    const bounds = {
      left: node.style.left ?? 0,
      top: node.style.top ?? 0,
      width: node.style.width ?? 0,
      height: node.style.height ?? 0,
    };
    const match = candidates
      .filter((candidate) => candidate.key === key)
      .map((candidate) => {
        const candidateBounds = candidate.bounds!;
        return {
          ...candidate,
          score:
            Math.abs(candidateBounds.left - bounds.left) +
            Math.abs(candidateBounds.top - bounds.top) +
            Math.abs(candidateBounds.width - bounds.width) * 0.25 +
            Math.abs(candidateBounds.height - bounds.height) * 0.25,
        };
      })
      .sort((left, right) => left.score - right.score)[0];
    if (!match?.node.text) {
      continue;
    }
    const text = match.node.text;
    if (
      !usesDisplayFallback(text.fontFamily) &&
      !usesCompactArtboardTextOverlay
    ) {
      continue;
    }
    const lineHeight =
      text.fontSize && text.lineHeight
        ? text.lineHeight / text.fontSize
        : undefined;
    hints.set(node.id, {
      style: {
        fontFamily: fontFamilyWithFallback(text.fontFamily),
        fontSize: text.fontSize,
        fontWeight: fontWeightName(text.fontWeight),
        lineHeight:
          lineHeight && Number.isFinite(lineHeight)
            ? lineHeight
            : undefined,
        letterSpacing:
          canonicalText(node.text) === match.canonical
            ? text.letterSpacing
            : undefined,
        textAlign: text.textAlign,
      },
      visualOverlay:
        pageScreenshotPath && pageScreenshot && match.bounds
          ? {
              assetRef: pageScreenshotPath,
              sourceWidth: pageScreenshot.width,
              sourceHeight: pageScreenshot.height,
              frame: {
                x: Math.max(0, match.bounds.left),
                y: Math.max(0, match.bounds.top),
                width: match.bounds.width,
                height: match.bounds.height,
              },
            }
          : undefined,
    });
  }
  return hints;
}

function parseCanvasDimension(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100_000) {
    return undefined;
  }
  return Math.round(parsed);
}

function ImplementationCanvas(props: {
  projectId: string;
  bundle: DesignBundle;
  uiSpec: UISpec;
  pageId: string;
  viewportId: string;
  canvasSize?: { width: number; height: number };
  zoom: number;
  pixelated: boolean;
  onNavigate: (pageId: string) => void;
}) {
  const viewport =
    props.uiSpec.viewports.find(
      (item) => item.id === props.viewportId,
    ) ?? props.uiSpec.viewports[0]!;
  const canvasViewport = props.canvasSize
    ? {
        ...viewport,
        width: props.canvasSize.width,
        height: props.canvasSize.height,
      }
    : viewport;
  const imageMetadata = useMemo(
    () => imageMetadataByPath(props.bundle),
    [props.bundle],
  );
  const fontStatus = useRegisteredFonts(
    props.bundle,
    props.projectId,
  );
  const previewSpec = useMemo(
    () => {
      const textStyleHints = buildTextStyleHints(
        props.bundle,
        props.uiSpec,
        props.pageId,
      );
      return toPreviewJsonSpec(props.uiSpec, props.pageId, {
        imageUrl: (path) =>
          projectImageUrl(
            props.projectId,
            path,
            props.bundle.revision,
        ),
        imageMetadata: (path) => imageMetadata.get(path),
        textStyleForNode: (node) => textStyleHints.get(node.id)?.style,
        textVisualOverlayForNode: (node) =>
          textStyleHints.get(node.id)?.visualOverlay,
      });
    },
    [imageMetadata, props.bundle.revision, props.pageId, props.projectId, props.uiSpec],
  );
  const store = useMemo(
    () => createStateStore(previewSpec.state),
    [previewSpec],
  );
  const handlers = useMemo(
    () => ({
      dispatch: (params: Record<string, unknown>) => {
        const actionId = params.actionId;
        if (typeof actionId !== "string") {
          return;
        }
        const action = props.uiSpec.actions.find(
          (candidate) => candidate.id === actionId,
        );
        if (!action) {
          return;
        }
        if (action.kind === "navigate") {
          props.onNavigate(action.pageId);
        } else if (action.kind === "set_state") {
          store.set(`/${action.stateKey}`, action.value);
        } else if (action.kind === "open_dialog") {
          const dialog = props.uiSpec.nodes.find(
            (node) =>
              node.id === action.dialogNodeId &&
              node.kind === "dialog",
          );
          if (dialog?.kind === "dialog") {
            store.set(`/${dialog.openStateKey}`, true);
          }
        } else if (action.kind === "submit") {
          const effect = action.effect;
          if (effect.kind === "navigate") {
            props.onNavigate(effect.pageId);
          } else if (effect.kind === "set_state") {
            store.set(`/${effect.stateKey}`, effect.value);
          } else if (effect.kind === "open_dialog") {
            const dialog = props.uiSpec.nodes.find(
              (node) =>
                node.id === effect.dialogNodeId &&
                node.kind === "dialog",
            );
            if (dialog?.kind === "dialog") {
              store.set(`/${dialog.openStateKey}`, true);
            }
          }
        }
      },
    }),
    [props, store],
  );

  return (
    <div className="implementation-scroll">
      <div
        className={`implementation-scale${
          props.pixelated ? " is-pixelated" : ""
        }`}
        style={{
          width: canvasViewport.width * props.zoom,
          height: canvasViewport.height * props.zoom,
        }}
      >
        <div
          className="implementation-canvas"
          data-page-id={props.pageId}
          data-viewport-id={viewport.id}
          style={{
            width: canvasViewport.width,
            height: canvasViewport.height,
            transform: `scale(${props.zoom})`,
          }}
        >
          <JSONUIProvider
            registry={registry}
            store={store}
            handlers={handlers}
          >
            <Renderer
              spec={previewSpec as Spec}
              registry={registry}
            />
          </JSONUIProvider>
          {fontStatus.status === "failed" ? (
            <span
              data-font-status="failed"
              hidden
            >
              {fontStatus.errors.join("; ")}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyPanel(props: {
  title: string;
  message: string;
}) {
  return (
    <section className="state-panel" aria-live="polite">
      <strong>{props.title}</strong>
      <span>{props.message}</span>
    </section>
  );
}

export function PreviewApp() {
  const parameters = new URLSearchParams(window.location.search);
  const projectId = parameters.get("projectId") ?? undefined;
  const runId = parameters.get("runId") ?? undefined;
  const renderMode = parameters.get("renderMode");
  const parsedDesignRevision = Number(
    parameters.get("designRevision") ?? "0",
  );
  const parsedSpecRevision = Number(
    parameters.get("specRevision") ?? "0",
  );
  const designRevision =
    Number.isInteger(parsedDesignRevision) &&
    parsedDesignRevision > 0
      ? parsedDesignRevision
      : undefined;
  const specRevision =
    Number.isInteger(parsedSpecRevision) &&
    parsedSpecRevision > 0
      ? parsedSpecRevision
      : undefined;
  const canvasWidth = parseCanvasDimension(
    parameters.get("canvasWidth"),
  );
  const canvasHeight = parseCanvasDimension(
    parameters.get("canvasHeight"),
  );
  const canvasSize =
    canvasWidth && canvasHeight
      ? { width: canvasWidth, height: canvasHeight }
      : undefined;
  const state = useProjectData(
    projectId,
    runId,
    designRevision,
    specRevision,
  );
  const [pageId, setPageId] = useState(
    parameters.get("pageId") ?? "",
  );
  const [viewportId, setViewportId] = useState(
    parameters.get("viewportId") ?? "",
  );
  const [zoom, setZoom] = useState(1);
  const [pixelated, setPixelated] = useState(false);

  if (state.status === "loading") {
    return (
      <EmptyPanel title="正在加载" message="读取项目修订" />
    );
  }
  if (state.status === "error") {
    return <EmptyPanel title="加载失败" message={state.message} />;
  }
  if (state.status === "empty" || !projectId) {
    return (
      <EmptyPanel title="暂无项目" message="没有可预览的有效修订" />
    );
  }

  const activePageId =
    state.uiSpec.pages.some((page) => page.id === pageId)
      ? pageId
      : state.uiSpec.pages[0]!.id;
  const activeViewportId =
    state.uiSpec.viewports.some(
      (viewport) => viewport.id === viewportId,
    )
      ? viewportId
      : state.uiSpec.viewports[0]!.id;
  const activeUISpecPage = state.uiSpec.pages.find(
    (page) => page.id === activePageId,
  )!;
  const sourcePage = state.bundle.pages.find(
    (page) => page.id === activeUISpecPage.sourcePageId,
  );
  const screenshotPath = sourcePage
    ? screenshotForPage(state.bundle, sourcePage.id)
    : undefined;
  const requestedRevisionStale =
    (designRevision !== undefined &&
      designRevision !== state.bundle.revision) ||
    (specRevision !== undefined &&
      specRevision !== state.uiSpec.revision);
  const validationRevisionStale =
    state.validation !== undefined &&
    (state.validation.designBundleRevision !==
      state.bundle.revision ||
      state.validation.uiSpecRevision !== state.uiSpec.revision);
  const stale =
    requestedRevisionStale || validationRevisionStale;
  const navigate = (nextPageId: string) => {
    setPageId(nextPageId);
    const url = new URL(window.location.href);
    url.searchParams.set("pageId", nextPageId);
    window.history.replaceState({}, "", url);
  };
  if (renderMode === "canvas") {
    return (
      <main className="validation-canvas-mode">
        <ImplementationCanvas
          projectId={projectId}
          bundle={state.bundle}
          uiSpec={state.uiSpec}
          pageId={activePageId}
          viewportId={activeViewportId}
          canvasSize={canvasSize}
          zoom={1}
          pixelated={false}
          onNavigate={navigate}
        />
      </main>
    );
  }

  const validationResult = state.validation?.output.results.find(
    (result) =>
      result.pageId === activePageId &&
      result.viewportId === activeViewportId,
  );

  return (
    <main className="preview-shell">
      <header className="toolbar">
        <div className="project-title">
          <strong>{projectId}</strong>
          <span>
            Design {state.bundle.revision} / UISpec{" "}
            {state.uiSpec.revision}
          </span>
        </div>
        <label>
          <span>页面</span>
          <select
            aria-label="页面"
            value={activePageId}
            onChange={(event) => navigate(event.target.value)}
          >
            {state.uiSpec.pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>视口</span>
          <select
            aria-label="视口"
            value={activeViewportId}
            onChange={(event) =>
              setViewportId(event.target.value)
            }
          >
            {state.uiSpec.viewports.map((viewport) => (
              <option key={viewport.id} value={viewport.id}>
                {viewport.id} {viewport.width}×{viewport.height}
              </option>
            ))}
          </select>
        </label>
        <div className="zoom-control" aria-label="缩放">
          <button
            type="button"
            title="缩小"
            aria-label="缩小"
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
          >
            −
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            title="放大"
            aria-label="放大"
            onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
          >
            +
          </button>
        </div>
        <label className="pixel-toggle">
          <input
            type="checkbox"
            checked={pixelated}
            onChange={(event) => setPixelated(event.target.checked)}
          />
          <span>像素</span>
        </label>
      </header>

      {stale ? (
        <div className="stale-banner" role="status">
          {validationRevisionStale
            ? "当前显示修订与验证记录不一致"
            : `请求的 UISpec 修订已过期，当前为 ${state.uiSpec.revision}`}
        </div>
      ) : null}

      <div className="workspace">
        <section className="workspace-panel reference-panel">
          <header>
            <strong>Figma 参考</strong>
            <span>{sourcePage?.name ?? "无匹配页面"}</span>
          </header>
          <div className="reference-stage">
            {screenshotPath ? (
              <img
                src={projectImageUrl(
                  projectId,
                  screenshotPath,
                  state.bundle.revision,
                )}
                alt={`${sourcePage?.name ?? activePageId} 参考截图`}
              />
            ) : (
              <EmptyPanel
                title="无参考截图"
                message="当前页面没有登记截图"
              />
            )}
          </div>
        </section>

        <section className="workspace-panel implementation-panel">
          <header>
            <strong>当前实现</strong>
            <span>{activePageId}</span>
          </header>
          <ImplementationCanvas
            projectId={projectId}
            bundle={state.bundle}
            uiSpec={state.uiSpec}
            pageId={activePageId}
            viewportId={activeViewportId}
            zoom={zoom}
            pixelated={pixelated}
            onNavigate={navigate}
          />
        </section>

        <section className="workspace-panel validation-panel">
          <header>
            <strong>检查结果</strong>
            <span>
              {state.validation
                ? state.validation.output.passed
                  ? "通过"
                  : "未通过"
                : "尚未运行"}
            </span>
          </header>
          {validationResult ? (
            <div className="validation-content">
              <ul className="check-list">
                {validationResult.checks.map((check, index) => (
                  <li
                    key={`${check.kind}-${index}`}
                    data-passed={check.passed}
                  >
                    <strong>{check.kind}</strong>
                    <span>{check.message ?? "无详情"}</span>
                  </li>
                ))}
              </ul>
              <dl className="diff-summary">
                <div>
                  <dt>差异像素</dt>
                  <dd>{validationResult.diffPixelCount}</dd>
                </div>
                <div>
                  <dt>差异比例</dt>
                  <dd>
                    {validationResult.diffPixelRatio.toFixed(6)}
                  </dd>
                </div>
              </dl>
              <div className="validation-images">
                <figure>
                  <figcaption>Actual</figcaption>
                  <img
                    src={runArtifactUrl(
                      projectId,
                      validationResult.actualImage,
                    )}
                    alt="实际渲染"
                  />
                </figure>
                {validationResult.diffImage ? (
                  <figure>
                    <figcaption>Diff</figcaption>
                    <img
                      src={runArtifactUrl(
                        projectId,
                        validationResult.diffImage,
                      )}
                      alt="像素差异"
                    />
                  </figure>
                ) : null}
              </div>
            </div>
          ) : (
            <EmptyPanel
              title="无验证记录"
              message="当前页面与视口尚未执行 render_and_compare"
            />
          )}
        </section>
      </div>
    </main>
  );
}
