import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";

import {
  FigmaInputError,
  parseFigmaDesignUrl,
  resolveFigmaTargetNodes,
} from "./figma/url.ts";
import {
  assertToolBoundary,
  configureToolBoundary,
  EXACT_TOOL_NAMES,
  extractProviderToolNames,
  TOOL_SCHEMA_VERSION,
} from "./runtime/tool-boundary.ts";
import { summarizeProviderInput } from "./runtime/provider-audit.ts";
import {
  assertFrozenRenderInput,
  assertFrozenUISpec,
  type FrozenRunPolicy,
  loadFrozenRunPolicy,
} from "./runtime/frozen-run-policy.ts";
import {
  type ExtensionToolServices,
  type InspectToolSupplement,
  LocalExtensionToolServices,
} from "./runtime/tool-services.ts";
import {
  inspectFigmaParameters,
  inspectFigmaInputSchema,
  loadUISpecParameters,
  loadUISpecInputSchema,
  renderAndCompareParameters,
  renderAndCompareInputSchema,
  saveUISpecParameters,
  saveUISpecInputSchema,
} from "./tools/contracts.ts";

const AUDIT_RELATIVE_PATH = "data/audit/m0-boundary.jsonl";
const PROMPT_VERSION = "p2-visual-layers-v4";
const MAX_ITERATIONS_PER_TURN = 3;
const MAX_AGENT_AUDIT_ERROR_LENGTH = 1000;

const CONTROLLED_SYSTEM_PROMPT = [
  `Figma-to-UI Agent controlled prompt ${PROMPT_VERSION}.`,
  "只能调用 inspect_figma、load_ui_spec、save_ui_spec、render_and_compare。",
  "先检查设计和当前 UISpec，再保存完整修订，最后执行渲染与比较。",
  "调用 inspect_figma 时，figmaUrl 必须逐字符复制用户提供的完整 https://www.figma.com/design/... URL；不要改写、缩短、翻译、移除查询参数或替换为文件名。",
  "targetNodes 只在用户明确提供目标节点时填写为字符串数组；如果 URL 已包含 node-id 且用户没有额外目标节点，不要填冲突节点。",
  "必须以 Figma 参考截图和 inspect_agent_context 作为视觉校验锚点；不得把 figma/screenshots/... 作为覆盖整页或页面主体的普通 image 交付通过。复杂插画、图标和装饰优先使用局部 figma/assets/...；局部 figma/screenshots/... 只能作为受审计 fallback，并且表单、按钮、文本必须保持结构化节点。",
  "生成 UISpec 时必须读取 inspect_agent_context.pages[].visualLayers；大面积矢量、图片填充、局部截图、logo/icon/illustration/background 等视觉层是关键视觉信号，必须优先映射为局部 image 或 pixel_overlay，并保留 pageRelativeBounds、zOrder、layerRole、visual 元数据和推荐用途。名称只能作为弱提示，最终以节点类型、面积比例、资产引用、层级、opacity/blend/mask/clip/vectorPathCount、overlapContentNodeCount、nearbyContentNodeCount 和坐标为准。所有定位应以 pageRelativeBounds 为准，不要根据负数全局 bounds 猜测位置。",
  "需要精确复原 Figma canvas 时，可以在受控 style 中使用 position:'relative'|'absolute'、left、top、width、height、zIndex。根画布或局部舞台应设置 position:'relative'，视觉层和关键控件可按 pageRelativeBounds 绝对定位。",
  "pixel_overlay.frame 只表示从更大源图内部裁剪的区域；如果引用的是 visualLayers[].renderedAssetPath 这种局部节点截图，不要把 pageRelativeBounds 填入 frame，应省略 frame 并用 style.left/top/width/height 放置节点。",
  "visualLayers[].layerRole 为 container_background 时，只能作为对应结构化内容的背景层使用，children 必须包含真实 input/button/link/text 等结构化节点并显示在 overlay 上方；不得用整块 ContentFrame/Panel 截图覆盖或替代表单内容。",
  "当 visualLayers 提供 renderedAssetPath 时，优先引用该局部渲染图；当只提供 localImageRefs 时，优先引用局部资产。不得忽略大面积背景、品牌色块、插画或 logo 后只交付表单结构。",
  "登录、注册、搜索、设置等表单界面必须使用真实 input/button/checkbox/text 节点表达；email/password/search 字段要使用对应 inputType；第三方登录、带图标 CTA、导航动作等入口也必须保留真实 button/link 语义，可用 leadingIconAssetRef/trailingIconAssetRef 承载图标。",
  "不得猜测 Figma 未提供且 behaviorNotes 未声明的业务行为；未声明行为只能报告为 missingBehaviorNotes 或未建模动作，不能归类为 unsupportedFeatures。",
  "unsupportedFeatures 只用于报告 Catalog、UISpec schema、renderer 或工具链无法表达/验证的真实能力缺口；不要把三轮内未调准、未实现动作或缺少业务说明称为不支持。",
  "报告 unsupportedFeatures 时必须同时说明证据来源：inspect warning、Schema 限制、渲染器限制或验证产物。",
  "每轮最多执行 3 次 save_ui_spec → render_and_compare 迭代。",
  "一次比较通过后立即停止修改；三次均未通过时停止并报告最后一次证据。",
].join("\n");

function toolResult<T>(
  details: T,
  supplement?: InspectToolSupplement,
): AgentToolResult<T> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(details),
      },
      ...(supplement
        ? [
            {
              type: "text" as const,
              text: JSON.stringify(supplement.context),
            },
            ...supplement.images.map((image) => ({
              type: "image" as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          ]
        : []),
    ],
    details,
  };
}

async function appendAuditRecord(
  cwd: string,
  record: Record<string, unknown>,
): Promise<void> {
  const auditPath = resolve(cwd, AUDIT_RELATIVE_PATH);
  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(
    auditPath,
    `${JSON.stringify({
      schemaVersion: TOOL_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      ...record,
    })}\n`,
    "utf8",
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function auditHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function summarizeAuditField(
  key: string,
  value: unknown,
): Record<string, unknown> {
  if (typeof value === "string") {
    const summary: Record<string, unknown> = {
      type: "string",
      length: value.length,
      sha256_12: auditHash(value),
    };
    if (key === "figmaUrl") {
      try {
        const parsed = parseFigmaDesignUrl(value);
        summary.figmaUrlValid = true;
        summary.fileKeyHash = auditHash(parsed.fileKey);
        summary.hasNodeId = Boolean(parsed.nodeId);
      } catch (error) {
        summary.figmaUrlValid = false;
        summary.errorCode =
          error instanceof FigmaInputError
            ? error.code
            : "invalid_url";
      }
    }
    return summary;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return { type: value === null ? "null" : typeof value };
  }
  if (Array.isArray(value)) {
    const summary: Record<string, unknown> = {
      type: "array",
      length: value.length,
      itemTypes: [...new Set(value.map((item) => typeof item))].sort(),
    };
    if (key === "targetNodes") {
      summary.stringHashes = value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 20)
        .map((item) => auditHash(item));
    }
    return summary;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return {
      type: "object",
      keyCount: keys.length,
      keys: keys.slice(0, 20),
    };
  }
  return { type: typeof value };
}

function summarizeM3ToolArgs(
  args: unknown,
): Record<string, unknown> {
  if (!isRecord(args)) {
    return summarizeAuditField("args", args);
  }
  const keys = Object.keys(args).sort();
  const fields = Object.fromEntries(
    keys.slice(0, 20).map((key) => [
      key,
      summarizeAuditField(key, args[key]),
    ]),
  );
  if (
    typeof args.figmaUrl === "string" &&
    Array.isArray(args.targetNodes)
  ) {
    try {
      fields.targetNodes = {
        ...(fields.targetNodes as Record<string, unknown>),
        conflictWithUrl: false,
        resolvedCount: resolveFigmaTargetNodes(
          parseFigmaDesignUrl(args.figmaUrl),
          args.targetNodes.filter(
            (item): item is string => typeof item === "string",
          ),
        ).length,
      };
    } catch (error) {
      fields.targetNodes = {
        ...(fields.targetNodes as Record<string, unknown>),
        conflictWithUrl:
          error instanceof FigmaInputError &&
          error.code === "conflicting_node_id",
        errorCode:
          error instanceof FigmaInputError
            ? error.code
            : "invalid_target_nodes",
      };
    }
  }
  return {
    type: "object",
    keyCount: keys.length,
    keys: keys.slice(0, 20),
    fields,
  };
}

function configuredFigmaFileKeys(): string[] {
  return [
    process.env.M3_FLOW_FIGMA_URL,
    process.env.M3_FIGMA_URL,
  ].flatMap((value) => {
    if (!value) {
      return [];
    }
    try {
      const pathSegments = new URL(value).pathname
        .split("/")
        .filter(Boolean);
      return pathSegments[0] === "design" ||
        pathSegments[0] === "file"
        ? pathSegments.slice(1, 2)
        : [];
    } catch {
      return [];
    }
  });
}

function redactM3AgentAuditText(value: string): string {
  let redacted = value
    .replace(
      /https?:\/\/(?:www\.)?figma\.com\/[^\s"'<>]+/giu,
      "<figma-url-redacted>",
    )
    .replace(
      /\bfigd_[A-Za-z0-9_-]+\b/gu,
      "<figma-token-redacted>",
    )
    .replace(
      /\bsk-[A-Za-z0-9_-]+\b/gu,
      "<openai-token-redacted>",
    );
  const configuredSecrets = [
    ...configuredFigmaFileKeys().map((secret) => ({
      secret,
      replacement: "<figma-file-key-redacted>",
    })),
    {
      secret: process.env.M3_FLOW_FIGMA_URL,
      replacement: "<figma-url-redacted>",
    },
    {
      secret: process.env.M3_FIGMA_URL,
      replacement: "<figma-url-redacted>",
    },
    {
      secret: process.env.FIGMA_API_KEY,
      replacement: "<figma-token-redacted>",
    },
    {
      secret: process.env.OPENAI_API_KEY,
      replacement: "<openai-token-redacted>",
    },
  ];
  for (const { secret, replacement } of configuredSecrets) {
    if (secret) {
      redacted = redacted.replaceAll(secret, replacement);
    }
  }
  return redacted.slice(0, MAX_AGENT_AUDIT_ERROR_LENGTH);
}

function extractM3AgentAuditError(result: unknown): string | undefined {
  if (typeof result === "string") {
    return redactM3AgentAuditText(result);
  }
  if (!isRecord(result)) {
    return undefined;
  }
  for (const key of ["message", "error"] as const) {
    if (typeof result[key] === "string") {
      return redactM3AgentAuditText(result[key]);
    }
  }
  if (!Array.isArray(result.content)) {
    return undefined;
  }
  const text = result.content.find(
    (item) =>
      isRecord(item) &&
      item.type === "text" &&
      typeof item.text === "string",
  );
  return isRecord(text) && typeof text.text === "string"
    ? redactM3AgentAuditText(text.text)
    : undefined;
}

async function appendM3AgentAuditRecord(
  cwd: string,
  record: Record<string, unknown>,
): Promise<void> {
  const configuredPath =
    process.env.M3_AGENT_AUDIT_RELATIVE_PATH?.trim();
  if (!configuredPath) {
    return;
  }
  const dataRoot = resolve(cwd, "data");
  const auditPath = resolve(cwd, configuredPath);
  const pathWithinData = relative(dataRoot, auditPath);
  if (
    !pathWithinData ||
    pathWithinData.startsWith("..") ||
    isAbsolute(pathWithinData)
  ) {
    throw new Error("m3_agent_audit_path_outside_data");
  }
  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(
    auditPath,
    `${JSON.stringify({
      schemaVersion: TOOL_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      ...record,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(auditPath, 0o600);
}

function abortAndThrow(ctx: ExtensionContext, error: unknown): never {
  ctx.abort();
  throw error;
}

function assertNoDiscoveredResources(
  event: {
    systemPromptOptions: {
      contextFiles?: readonly unknown[];
      skills?: readonly unknown[];
      selectedTools?: readonly string[];
    };
  },
  ctx: ExtensionContext,
): void {
  const { contextFiles = [], skills = [], selectedTools = [] } =
    event.systemPromptOptions;

  try {
    if (contextFiles.length > 0) {
      throw new Error("resource_boundary_violation:context_files_loaded");
    }
    if (skills.length > 0) {
      throw new Error("resource_boundary_violation:skills_loaded");
    }
    if (selectedTools.length > 0) {
      const normalized = [...selectedTools].sort().join(",");
      const expected = [...EXACT_TOOL_NAMES].sort().join(",");
      if (normalized !== expected) {
        throw new Error(
          `resource_boundary_violation:selected_tools:${normalized}`,
        );
      }
    }
  } catch (error) {
    abortAndThrow(ctx, error);
  }
}

export interface FigmaToUiExtensionOptions {
  services?: ExtensionToolServices;
  createServices?: (cwd: string) => ExtensionToolServices;
  frozenRunPolicy?: FrozenRunPolicy | null;
}

export function createFigmaToUiExtension(
  options: FigmaToUiExtensionOptions = {},
): (pi: ExtensionAPI) => void {
  const frozenRunPolicy =
    options.frozenRunPolicy === undefined
      ? loadFrozenRunPolicy()
      : options.frozenRunPolicy ?? undefined;

  return (pi) => {
    const servicesByCwd = new Map<string, ExtensionToolServices>();
    let saveCallsThisTurn = 0;
    let renderCallsThisTurn = 0;
    let savedSinceLastRender = false;
    let lastSavedFingerprint: string | undefined;
    let loopCompleted = false;
    const failedInspectProjectsThisTurn = new Set<string>();
    const activeToolAudits = new Map<
      string,
      { projectId?: string; toolName: string }
    >();

    const resetBoundedLoop = () => {
      saveCallsThisTurn = 0;
      renderCallsThisTurn = 0;
      savedSinceLastRender = false;
      lastSavedFingerprint = undefined;
      loopCompleted = false;
      failedInspectProjectsThisTurn.clear();
    };

    const servicesFor = (cwd: string): ExtensionToolServices => {
      if (options.services) {
        return options.services;
      }
      const existing = servicesByCwd.get(cwd);
      if (existing) {
        return existing;
      }
      const services = options.createServices
        ? options.createServices(cwd)
        : new LocalExtensionToolServices(cwd);
      servicesByCwd.set(cwd, services);
      return services;
    };

    pi.registerTool({
      name: "inspect_figma",
      label: "Inspect Figma",
      description:
        "Inspect an allowed Figma design and create or update its normalized DesignBundle.",
      parameters: inspectFigmaParameters,
      executionMode: "sequential",
      async execute(_toolCallId, rawInput, signal, _onUpdate, ctx) {
        const input = inspectFigmaInputSchema.parse(rawInput);
        if (failedInspectProjectsThisTurn.has(input.projectId)) {
          throw new Error(
            "bounded_loop_inspect_failed: inspect_figma 已在当前请求内完成内部重试并失败，禁止重复请求 Figma",
          );
        }
        const services = servicesFor(ctx.cwd);
        let output;
        try {
          output = await services.inspect(input, signal);
        } catch (error) {
          failedInspectProjectsThisTurn.add(input.projectId);
          throw error;
        }
        const supplement =
          await services.inspectSupplement?.(output);
        return toolResult(output, supplement);
      },
    });

    pi.registerTool({
      name: "load_ui_spec",
      label: "Load UI Spec",
      description:
        "Load a validated current or historical UISpec by project identifier.",
      parameters: loadUISpecParameters,
      executionMode: "sequential",
      async execute(_toolCallId, rawInput, _signal, _onUpdate, ctx) {
        const input = loadUISpecInputSchema.parse(rawInput);
        return toolResult(await servicesFor(ctx.cwd).load(input));
      },
    });

    pi.registerTool({
      name: "save_ui_spec",
      label: "Save UI Spec",
      description:
        "Validate and atomically save a complete UISpec using optimistic revision control.",
      parameters: saveUISpecParameters,
      executionMode: "sequential",
      async execute(_toolCallId, rawInput, _signal, _onUpdate, ctx) {
        if (loopCompleted) {
          throw new Error(
            "bounded_loop_complete: 当前轮比较已通过，禁止继续修改",
          );
        }
        if (
          saveCallsThisTurn >= MAX_ITERATIONS_PER_TURN ||
          savedSinceLastRender
        ) {
          throw new Error(
            "bounded_loop_violation: 每次保存后必须比较，且每轮最多保存 3 次",
          );
        }
        const input = saveUISpecInputSchema.parse(rawInput);
        assertFrozenUISpec(frozenRunPolicy, input.uiSpec);
        const fingerprint = JSON.stringify(input.uiSpec);
        if (fingerprint === lastSavedFingerprint) {
          throw new Error(
            "bounded_loop_no_progress: UISpec 与上一轮保存候选相同",
          );
        }
        const output = await servicesFor(ctx.cwd).save(input);
        saveCallsThisTurn += 1;
        savedSinceLastRender = true;
        lastSavedFingerprint = fingerprint;
        return toolResult(output);
      },
    });

    pi.registerTool({
      name: "render_and_compare",
      label: "Render and Compare",
      description:
        "Render a saved UISpec locally and run bounded functional and visual validation.",
      parameters: renderAndCompareParameters,
      executionMode: "sequential",
      async execute(_toolCallId, rawInput, signal, _onUpdate, ctx) {
        if (
          !savedSinceLastRender ||
          renderCallsThisTurn >= MAX_ITERATIONS_PER_TURN
        ) {
          throw new Error(
            "bounded_loop_violation: render_and_compare 必须紧跟保存，且每轮最多比较 3 次",
          );
        }
        const input = renderAndCompareInputSchema.parse(rawInput);
        assertFrozenRenderInput(frozenRunPolicy, input);
        renderCallsThisTurn += 1;
        savedSinceLastRender = false;
        const output = await servicesFor(ctx.cwd).render(
          input,
          signal,
        );
        loopCompleted = output.passed;
        return toolResult(output);
      },
    });

    pi.on("session_start", (_event, ctx) => {
      try {
        configureToolBoundary(pi, "session_start");
      } catch (error) {
        abortAndThrow(ctx, error);
      }
    });

    pi.on("input", (_event, ctx) => {
      try {
        assertToolBoundary(pi, "input");
        resetBoundedLoop();
        return { action: "continue" as const };
      } catch (error) {
        ctx.abort();
        if (ctx.hasUI) {
          ctx.ui.notify(
            error instanceof Error
              ? error.message
              : "tool boundary violation",
            "error",
          );
        }
        return { action: "handled" as const };
      }
    });

    pi.on("before_agent_start", (event, ctx) => {
      try {
        assertToolBoundary(pi, "before_agent_start");
      } catch (error) {
        abortAndThrow(ctx, error);
      }
      assertNoDiscoveredResources(event, ctx);
      return { systemPrompt: CONTROLLED_SYSTEM_PROMPT };
    });

    pi.on("turn_start", (_event, ctx) => {
      try {
        assertToolBoundary(pi, "turn_start");
      } catch (error) {
        abortAndThrow(ctx, error);
      }
    });

    pi.on("tool_execution_start", async (event, ctx) => {
      const projectId =
        isRecord(event.args) &&
        typeof event.args.projectId === "string" &&
        /^[a-z0-9][a-z0-9_-]{0,47}$/.test(
          event.args.projectId,
        )
          ? event.args.projectId
          : undefined;
      activeToolAudits.set(event.toolCallId, {
        projectId,
        toolName: event.toolName,
      });
      try {
        await appendM3AgentAuditRecord(ctx.cwd, {
          event: "tool_execution_start",
          toolName: event.toolName,
          projectId,
          argsSummary: summarizeM3ToolArgs(event.args),
        });
      } catch (error) {
        abortAndThrow(ctx, error);
      }
    });

    pi.on("tool_execution_end", async (event, ctx) => {
      const active = activeToolAudits.get(event.toolCallId);
      activeToolAudits.delete(event.toolCallId);
      try {
        await appendM3AgentAuditRecord(ctx.cwd, {
          event: "tool_execution_end",
          toolName: active?.toolName ?? event.toolName,
          projectId: active?.projectId,
          isError: event.isError,
          ...(event.isError
            ? {
                errorMessage:
                  extractM3AgentAuditError(event.result),
              }
            : {}),
        });
      } catch (error) {
        abortAndThrow(ctx, error);
      }
    });

    pi.on("message_end", async (event, ctx) => {
      if (
        event.message.role !== "assistant" ||
        !Array.isArray(event.message.content)
      ) {
        return;
      }
      const contentTypes = event.message.content.map(
        (item) => item.type,
      );
      const toolNames = event.message.content.flatMap((item) =>
        item.type === "toolCall" ? [item.name] : [],
      );
      try {
        await appendM3AgentAuditRecord(ctx.cwd, {
          event: "assistant_message_end",
          stopReason: event.message.stopReason,
          contentTypes,
          toolNames,
          hasText: contentTypes.includes("text"),
          ...(event.message.errorMessage
            ? {
                errorMessage: redactM3AgentAuditText(
                  event.message.errorMessage,
                ),
              }
            : {}),
        });
      } catch (error) {
        abortAndThrow(ctx, error);
      }
    });

    pi.on("before_provider_request", async (event, ctx) => {
      try {
        const toolNames = extractProviderToolNames(event.payload);
        const input = summarizeProviderInput(event.payload);
        await appendAuditRecord(ctx.cwd, {
          event: "provider_tool_names",
          toolNames,
          ...input,
        });
      } catch (error) {
        abortAndThrow(ctx, error);
      }
    });

    pi.on("user_bash", async (event, ctx) => {
      await appendAuditRecord(ctx.cwd, {
        event: "user_bash_denied",
        excludeFromContext: event.excludeFromContext,
      });

      return {
        result: {
          output: "managed_mode_shell_denied",
          exitCode: 126,
          cancelled: false,
          truncated: false,
        },
      };
    });

    pi.on("session_shutdown", async () => {
      const services = options.services
        ? [options.services]
        : [...servicesByCwd.values()];
      await Promise.all(
        [...new Set(services)].map((service) => service.close?.()),
      );
    });
  };
}

const figmaToUiExtension = createFigmaToUiExtension();

export default figmaToUiExtension;
