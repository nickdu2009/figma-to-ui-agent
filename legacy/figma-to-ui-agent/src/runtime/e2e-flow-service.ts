import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import { FigmaImageDownloader } from "../figma/assets.ts";
import { FigmaInspector } from "../figma/inspector.ts";
import {
  FigmaRestClient,
  FigmaRestError,
  type FigmaFetch,
  type FigmaRateLimitLogEvent,
  type FigmaRestClientOptions,
} from "../figma/rest-client.ts";
import {
  FigmaInputError,
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
} from "../figma/url.ts";
import { ProjectStore, ProjectStoreError } from "../project-store/store.ts";
import { SCHEMA_VERSION } from "../project-store/schemas.ts";
import {
  buildStaticUISpecFromDesignBundle,
} from "../static-generation/service.ts";
import type {
  M5StaticReport,
} from "../static-generation/report.ts";
import { RenderAndCompareService } from "../validation/render-and-compare.ts";
import {
  type M7DesignBundleRevisionSource,
  type M7RunError,
  type M7RunErrorCategory,
  type M7RunRequest,
  type M7RunResult,
  type M7RunStep,
  m7RunRequestSchema,
  m7RunResultSchema,
  redactM7Secrets,
} from "./e2e-flow-contracts.ts";
import { writeM7Report } from "./e2e-flow-report.ts";

export interface RunM7E2EFlowOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  runId?: () => string;
  rateLimitLogger?: (event: FigmaRateLimitLogEvent) => void;
  figmaFetchImpl?: FigmaFetch;
  figmaMaxRetries?: number;
  figmaSleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface NormalizedM7Request {
  request: M7RunRequest;
  fileKey?: string;
  nodeId?: string;
  figmaUrl?: string;
}

function createRunId(): string {
  return `${Date.now().toString(36)}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function errorFor(
  category: M7RunErrorCategory,
  message: string,
  nextAction: string,
  options: {
    recoverable?: boolean;
    details?: Record<string, unknown>;
  } = {},
): M7RunError {
  return {
    category,
    message,
    recoverable: options.recoverable ?? true,
    nextAction,
    details: options.details
      ? (redactM7Secrets(options.details) as Record<string, unknown>)
      : undefined,
  };
}

function failedStep(id: string, message: string): M7RunStep {
  return { id, status: "failed", message };
}

function passedStep(id: string, message: string): M7RunStep {
  return { id, status: "passed", message };
}

function skippedStep(id: string, message: string): M7RunStep {
  return { id, status: "skipped", message };
}

function normalizeThresholdPercent(value: number | undefined): number {
  return value ?? 5;
}

function safeProjectId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
    ? value
    : undefined;
}

function safeMode(value: unknown): M7RunRequest["mode"] | undefined {
  return value === "local" ||
    value === "restricted-live" ||
    value === "live"
    ? value
    : undefined;
}

function normalizeRequest(rawInput: unknown): NormalizedM7Request {
  const request = m7RunRequestSchema.parse(rawInput);
  let fileKey = request.fileKey;
  let nodeId = request.nodeId
    ? normalizeFigmaNodeId(request.nodeId)
    : undefined;
  let figmaUrl = request.figmaUrl;
  if (request.figmaUrl) {
    const parsed = parseFigmaDesignUrl(request.figmaUrl);
    fileKey = parsed.fileKey;
    nodeId = nodeId ?? parsed.nodeId;
  } else if (fileKey && request.mode !== "local") {
    const url = new URL(
      `https://www.figma.com/design/${encodeURIComponent(fileKey)}/M7`,
    );
    if (nodeId) {
      url.searchParams.set("node-id", nodeId.replaceAll(":", "-"));
    }
    figmaUrl = url.href;
  }
  return { request, fileKey, nodeId, figmaUrl };
}

function mapUnknownError(error: unknown): M7RunError {
  if (error instanceof FigmaInputError || error instanceof z.ZodError) {
    return errorFor(
      "input_invalid",
      error instanceof z.ZodError
        ? "M7 输入无效"
        : error.message,
      "修正 figmaUrl、fileKey、nodeId、projectId、mode 或 designBundleRevision 后重试。",
      { details: { issues: error instanceof z.ZodError ? error.issues : undefined } },
    );
  }
  if (error instanceof ProjectStoreError) {
    return errorFor(
      error.code === "not_found"
        ? "bundle_generation_failed"
        : "internal_error",
      error.message,
      "检查本地 ProjectStore 中是否存在对应 projectId 和 DesignBundle revision。",
      { recoverable: error.code === "not_found", details: { code: error.code } },
    );
  }
  if (error instanceof FigmaRestError) {
    if (error.status === 401 || error.status === 403) {
      return errorFor(
        "figma_permission_denied",
        error.message,
        "检查 Figma token 权限和文件访问权限后重试。",
        { details: { code: error.code, status: error.status } },
      );
    }
    if (error.status === 404) {
      return errorFor(
        "figma_not_found",
        error.message,
        "检查 Figma URL、fileKey、nodeId 或 token 文件权限后重试。",
        { details: { code: error.code, status: error.status } },
      );
    }
    if (error.status === 429) {
      return errorFor(
        "figma_rate_limited",
        error.message,
        "等待 Retry-After 后重试，或降低 Figma REST 请求频率。",
        { details: { code: error.code, status: error.status } },
      );
    }
  }
  return errorFor(
    "internal_error",
    error instanceof Error ? error.message : "M7 内部错误",
    "查看 summary.md 和 step trace，定位实现缺陷后重试。",
    {
      recoverable: false,
      details: {
        name: error instanceof Error ? error.name : undefined,
      },
    },
  );
}

function metricsFrom(input: {
  report: M5StaticReport;
  renderOutput?: Awaited<ReturnType<RenderAndCompareService["render"]>>;
}): NonNullable<M7RunResult["metrics"]> {
  const ratios =
    input.renderOutput?.results.map((result) => result.diffPixelRatio * 100) ??
    [];
  return {
    pages: input.report.pages.length,
    passedPages: input.renderOutput
      ? input.renderOutput.results.filter((result) =>
          result.checks.every((check) => check.passed),
        ).length
      : input.report.status === "passed"
        ? input.report.pages.length
        : undefined,
    maxPixelDiffPercent:
      ratios.length > 0 ? Math.max(...ratios) : undefined,
    averagePixelDiffPercent:
      ratios.length > 0
        ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length
        : undefined,
    warnings: input.report.warnings.length,
    unsupported: input.report.unsupportedFeatures.length,
  };
}

function successNextAction(mode: M7RunRequest["mode"]): string {
  if (mode === "restricted-live") {
    return "M7 restricted-live Figma 读取与本地生成完成；未调用 OpenAI。如需 full live 验证，请单独授权 OpenAI gate。";
  }
  if (mode === "live") {
    return "M7 live 端到端流程完成；检查 summary 与 validation artifact 后进入下一阶段。";
  }
  return "M7 local 端到端流程完成；如需 live 验证，请单独授权 GATE-M7-LIVE-FIGMA。";
}

async function acquireDesignBundle(input: {
  normalized: NormalizedM7Request;
  projectStore: ProjectStore;
  env: NodeJS.ProcessEnv;
  rateLimitLogger?: (event: FigmaRateLimitLogEvent) => void;
  figmaFetchImpl?: FigmaFetch;
  figmaMaxRetries?: number;
  figmaSleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}): Promise<{
  revision: number;
  source: M7DesignBundleRevisionSource;
}> {
  const { request, nodeId, figmaUrl } = input.normalized;
  if (request.mode === "local") {
    const bundle = await input.projectStore.loadDesignBundle(
      request.projectId,
      request.designBundleRevision,
    );
    return {
      revision: bundle.revision,
      source: request.designBundleRevision ? "explicit" : "current",
    };
  }

  if (!request.gates?.allowFigmaNetwork) {
    throw errorFor(
      "auth_missing",
      "restricted-live/live 模式未授权 Figma 网络访问",
      "添加 allowFigmaNetwork gate 或改用 local 模式。",
    );
  }
  if (request.mode === "live" && !request.gates.allowOpenAI) {
    throw errorFor(
      "auth_missing",
      "live 模式未授权 OpenAI gate",
      "添加 allowOpenAI gate，或使用 restricted-live/local 模式。",
    );
  }
  const token = input.env.FIGMA_API_KEY?.trim();
  if (!token) {
    throw errorFor(
      "auth_missing",
      "缺少 FIGMA_API_KEY 本地环境配置",
      "配置 FIGMA_API_KEY 后重试，或使用 local 模式。",
    );
  }
  if (!figmaUrl) {
    throw errorFor(
      "input_invalid",
      "restricted-live/live 模式必须提供 figmaUrl 或 fileKey",
      "提供完整 Figma design URL 或 fileKey 后重试。",
    );
  }

  const restClientOptions: FigmaRestClientOptions = { token };
  if (input.rateLimitLogger) {
    restClientOptions.rateLimitLogger = input.rateLimitLogger;
  }
  if (input.figmaFetchImpl) {
    restClientOptions.fetchImpl = input.figmaFetchImpl;
  }
  if (input.figmaMaxRetries !== undefined) {
    restClientOptions.maxRetries = input.figmaMaxRetries;
  }
  if (input.figmaSleep) {
    restClientOptions.sleep = input.figmaSleep;
  }
  const restClient = new FigmaRestClient(restClientOptions);
  const inspector = new FigmaInspector({
    restClient,
    imageDownloader: new FigmaImageDownloader({
      projectStore: input.projectStore,
    }),
    projectStore: input.projectStore,
  });
  const output = await inspector.inspect(
    {
      schemaVersion: SCHEMA_VERSION,
      projectId: request.projectId,
      figmaUrl,
      targetNodes: nodeId ? [nodeId] : undefined,
    },
    input.signal,
    request.mode === "restricted-live"
      ? { variablesMode: "disabled_restricted_live" }
      : undefined,
  );
  return {
    revision: output.designBundleRevision,
    source: "generated",
  };
}

async function runM7E2EFlowInternal(
  rawInput: unknown,
  options: RunM7E2EFlowOptions,
  signal?: AbortSignal,
): Promise<M7RunResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runId =
    typeof rawInput === "object" &&
    rawInput !== null &&
    typeof Reflect.get(rawInput, "runId") === "string"
      ? Reflect.get(rawInput, "runId")
      : (options.runId?.() ?? createRunId());
  const rawReportRoot =
    typeof rawInput === "object" &&
    rawInput !== null &&
    typeof Reflect.get(rawInput, "reportRoot") === "string"
      ? String(Reflect.get(rawInput, "reportRoot"))
      : "reports/m7-e2e";
  const reportRoot = resolve(cwd, rawReportRoot);
  const steps: M7RunStep[] = [];
  let normalizedResultInput: Record<string, unknown> = {};
  const baseArtifacts = {
    summaryJson: `${rawReportRoot}/${runId}/summary.json`,
    summaryMarkdown: `${rawReportRoot}/${runId}/summary.md`,
  };

  try {
    const normalized = normalizeRequest(rawInput);
    const { request, fileKey, nodeId } = normalized;
    normalizedResultInput = {
      ...(request.figmaUrl ? { figmaUrl: request.figmaUrl } : {}),
      ...(fileKey ? { fileKey } : {}),
      ...(nodeId ? { nodeId } : {}),
      mode: request.mode,
    };
    steps.push(passedStep("validate_input", "输入契约校验通过"));

    const dataRoot = resolve(cwd, request.dataRoot ?? "data");
    const projectStore = new ProjectStore(dataRoot);
    steps.push(passedStep("create_run_context", "已创建 runId 和报告上下文"));

    const acquired = await acquireDesignBundle({
      normalized,
      projectStore,
      env: options.env ?? process.env,
      rateLimitLogger: options.rateLimitLogger,
      figmaFetchImpl: options.figmaFetchImpl,
      figmaMaxRetries: options.figmaMaxRetries,
      figmaSleep: options.figmaSleep,
      signal,
    });
    steps.push(
      passedStep(
        "acquire_design",
        `DesignBundle revision=${acquired.revision} source=${acquired.source}`,
      ),
    );

    const designBundle = await projectStore.loadDesignBundle(
      request.projectId,
      acquired.revision,
    );
    const { uiSpecDraft, reportDraft } =
      buildStaticUISpecFromDesignBundle(designBundle, {
        m4ValidationStatus: "not_required",
      });
    steps.push(passedStep("generate_ui_spec", "已从 DesignBundle 生成 UISpec"));

    const currentUiSpec = await projectStore
      .loadUISpec(request.projectId)
      .catch((error) => {
        if (error instanceof ProjectStoreError && error.code === "not_found") {
          return undefined;
        }
        throw error;
      });
    const savedUiSpec = await projectStore.saveUISpec({
      projectId: request.projectId,
      baseRevision: currentUiSpec?.revision ?? 0,
      draft: uiSpecDraft,
    });
    steps.push(
      passedStep("save_ui_spec", `UISpec revision=${savedUiSpec.revision}`),
    );

    const report: M5StaticReport = {
      ...reportDraft,
      runId,
      projectId: request.projectId,
      uiSpecRevision: savedUiSpec.revision,
    };
    let renderOutput:
      | Awaited<ReturnType<RenderAndCompareService["render"]>>
      | undefined;
    let validation: M7RunResult["validation"] = {
      status: "skipped",
      reason: request.runCompare
        ? "render_compare_skipped_no_pages"
        : "render_compare_not_requested",
    };

    if (request.runCompare && report.pages.length > 0) {
      const renderer = new RenderAndCompareService({
        dataRoot,
        projectStore,
      });
      try {
        const thresholdPercent = normalizeThresholdPercent(
          request.threshold?.pixelDiffPercent,
        );
        renderOutput = await renderer.render({
          schemaVersion: SCHEMA_VERSION,
          projectId: request.projectId,
          pageIds: report.pages.map((page) => page.pageId),
          viewportIds: request.viewportIds,
          comparison: {
            maxDiffPixelRatio: thresholdPercent / 100,
            maxDiffPixels: 10_000,
            timeoutMs: 30_000,
          },
        });
        validation = {
          status: renderOutput.passed ? "passed" : "failed",
          reason: renderOutput.passed
            ? "render_compare_passed"
            : "render_compare_failed",
        };
        steps.push(
          passedStep(
            "render_compare",
            `render-and-compare ${validation.status}`,
          ),
        );
      } finally {
        await renderer.close();
      }
    } else {
      steps.push(
        skippedStep(
          "render_compare",
          validation.reason ?? "render compare skipped",
        ),
      );
    }

    const metrics = metricsFrom({ report, renderOutput });
    const partial =
      report.status !== "passed" ||
      metrics.warnings > 0 ||
      metrics.unsupported > 0;
    const validationFailed = validation.status === "failed";
    const error = partial
      ? errorFor(
          "static_generation_partial",
          "静态生成存在 warnings 或 unsupported features",
          "检查 summary 中的 warnings/unsupported，补齐后重跑 M7。",
        )
      : validationFailed
        ? errorFor(
            "validation_failed",
            "render-and-compare 未通过",
            "查看 validation artifact 和 diff 后修复视觉或渲染问题。",
          )
        : undefined;
    const result = m7RunResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      ok: !error,
      runId,
      projectId: request.projectId,
      input: {
        figmaUrl: request.figmaUrl,
        fileKey,
        nodeId,
        designBundleRevision: acquired.revision,
        designBundleRevisionSource: acquired.source,
        mode: request.mode,
      },
      artifacts: {
        ...baseArtifacts,
        designBundleRef: `project:${request.projectId}:designBundle:${acquired.revision}`,
        uiSpecRef: `project:${request.projectId}:uiSpec:${savedUiSpec.revision}`,
        generatedAppRef: `project:${request.projectId}:uiSpec:${savedUiSpec.revision}`,
        validationRef: renderOutput
          ? `project:${request.projectId}:validation:${renderOutput.runId}`
          : undefined,
      },
      metrics,
      validation,
      steps: [
        ...steps,
        passedStep("write_report", "已写入 summary.json 和 summary.md"),
      ],
      error,
      nextAction: error
        ? error.nextAction
        : successNextAction(request.mode),
    });
    return await writeM7Report({ result, reportRoot, runId });
  } catch (error) {
    const mapped =
      typeof error === "object" &&
      error !== null &&
      "category" in error
        ? (error as M7RunError)
        : mapUnknownError(error);
    const maybeProjectId = safeProjectId(
      typeof rawInput === "object" &&
        rawInput !== null
        ? Reflect.get(rawInput, "projectId")
        : undefined,
    );
    const maybeMode = safeMode(
      typeof rawInput === "object" &&
        rawInput !== null
        ? Reflect.get(rawInput, "mode")
        : undefined,
    );
    const result = m7RunResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      runId,
      projectId: maybeProjectId,
      input:
        Object.keys(normalizedResultInput).length > 0
          ? normalizedResultInput
          : maybeMode
            ? { mode: maybeMode }
            : {},
      artifacts: baseArtifacts,
      validation: {
        status: "skipped",
        reason: "flow_failed_before_validation",
      },
      steps: [...steps, failedStep("m7_flow", mapped.message)],
      error: mapped,
      nextAction: mapped.nextAction,
    });
    return await writeM7Report({ result, reportRoot, runId });
  }
}

export async function runM7E2EFlow(
  rawInput: unknown,
  options: RunM7E2EFlowOptions = {},
  signal?: AbortSignal,
): Promise<M7RunResult> {
  return await runM7E2EFlowInternal(rawInput, options, signal);
}
