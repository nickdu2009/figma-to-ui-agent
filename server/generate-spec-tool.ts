import { createTool } from "@mastra/core/tools";
import type { Agent } from "@mastra/core/agent";
import {
  applyJsonPatch,
  isJsonPatchOperation,
  type JsonPatchOperation,
} from "@next-app-runtime/client/stream";
import {
  emitPatchOperationsInputSchema,
  emitPatchOperationsOutputSchema,
  generateSpecInputSchema,
  generateSpecOutputSchema,
  validatePatchGenerationInputSchema,
  validatePatchGenerationOutputSchema,
  type EmitPatchOperationsInput,
  type GenerateSpecInput,
  // pi-lens-ignore: ts:5097
} from "./contracts.ts";
// pi-lens-ignore: ts:5097
import type { GenerationCoordinator } from "./generation-coordinator.ts";
// pi-lens-ignore: ts:5097
import { modelCatalog } from "./model-catalog.ts";
import {
  CATALOG_VERSION,
  SPEC_COMPATIBILITY,
} from "./model-catalog.ts";
import {
  finalizeParse,
  type ApplicationCandidate,
} from "./application-candidate.ts";

type CoordinatorKeys = { threadId: string; runId: string };

/** 一个生成请求专属的 Agent 工厂，避免私有工具闭包跨 generation 泄漏。 */
export type SpecGeneratorFactory = (tools: {
  emit_patch_operations: ReturnType<typeof createTool>;
  validate_patch_generation: ReturnType<typeof createTool>;
}) => Agent;

const MAX_GENERATION_OPERATIONS = 1_000;

const EMPTY_SCHEMA_DIGEST =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * 模型只可流式编辑 uiBundle.spec。其余 Candidate 字段由服务端构造；特别是
 * migrationEdge 会在 lifecycle 中按当前 ReleasePointer 重算并覆盖。
 */
function buildServerCandidate(spec: unknown): ApplicationCandidate {
  return {
    uiBundle: {
      bundleVersion: 1,
      catalogVersion: CATALOG_VERSION,
      specCompatibility: SPEC_COMPATIBILITY,
      spec: spec as ApplicationCandidate["uiBundle"]["spec"],
      designSystem: {
        tokens: { primitive: {}, semantic: {}, component: {} },
        applicationCss: "",
      },
      assets: { entries: [] },
    },
    businessSchema: null,
    // 占位值不可作为事实使用；lifecycle 在落库前无条件按服务端当前发布版本
    // 重算该对象，保留此字段只是让 Candidate 在进入 strict parser 前完整。
    migrationEdge: {
      fromPublishedVersionId: null,
      fromSchemaDigest: EMPTY_SCHEMA_DIGEST,
      toSchemaDigest: EMPTY_SCHEMA_DIGEST,
    },
  };
}

const CLIENT_SPEC_PREFIX = "/uiBundle/spec";
const MODEL_EDITABLE_PREFIXES = [
  "/uiBundle/spec",
  "/uiBundle/designSystem",
  "/uiBundle/assets",
] as const;

function isModelEditableCandidatePath(path: string): boolean {
  return MODEL_EDITABLE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/** 模型不能写业务 Schema 或任何 migration 字段，避免 LLM 成为数据迁移权威。 */
function validateCandidateOperations(
  operations: readonly JsonPatchOperation[],
): JsonPatchOperation[] {
  return operations.map((operation) => {
    if (!isModelEditableCandidatePath(operation.path)) {
      throw new Error(
        `emit_patch_operations: forbidden ApplicationCandidate path ${operation.path}`,
      );
    }
    if (
      (operation.op === "move" || operation.op === "copy") &&
      !isModelEditableCandidatePath(operation.from)
    ) {
      throw new Error(
        `emit_patch_operations: forbidden ApplicationCandidate source ${operation.from}`,
      );
    }
    return operation;
  });
}

/**
 * Client 的 JSONL 仅是流式视觉反馈，不能携带业务 Schema 或迁移计划。把
 * Candidate 内 uiBundle.spec 的操作翻译为旧 Spec 根路径；其它 Candidate
 * 字段只留在服务端，最终由权威 Bundle 整体交付。
 */
function toClientSpecOperation(
  operation: JsonPatchOperation,
): JsonPatchOperation | null {
  if (
    operation.path !== CLIENT_SPEC_PREFIX &&
    !operation.path.startsWith(`${CLIENT_SPEC_PREFIX}/`)
  ) {
    return null;
  }
  const path = operation.path.slice(CLIENT_SPEC_PREFIX.length) || "";
  if ((operation.op === "move" || operation.op === "copy") &&
    operation.from !== CLIENT_SPEC_PREFIX &&
    !operation.from.startsWith(`${CLIENT_SPEC_PREFIX}/`)) {
    // 不能把 Candidate 的非 UI 字段复制到浏览器 Spec；服务端 finalise 仍会
    // 校验完整 Candidate，但该中间视觉流必须保持单域。
    return null;
  }
  if (operation.op === "move" || operation.op === "copy") {
    return { ...operation, path, from: operation.from.slice(CLIENT_SPEC_PREFIX.length) || "" };
  }
  return { ...operation, path } as JsonPatchOperation;
}

/**
 * 只接受运行时认可的 RFC 6902 operation，并由服务端保证 JSONL 行边界。
 * 这是模型到浏览器 Patch 流的唯一序列化点；客户端仍照常流式 applySource。
 */
export function validatePatchOperations(
  operations: ReadonlyArray<EmitPatchOperationsInput["operations"][number]>,
): JsonPatchOperation[] {
  const checked: JsonPatchOperation[] = [];
  for (const operation of operations) {
    if (!isJsonPatchOperation(operation)) {
      throw new Error("emit_patch_operations: invalid RFC 6902 operation");
    }
    checked.push(operation);
  }
  return checked;
}

export function serializePatchOperations(
  operations: ReadonlyArray<EmitPatchOperationsInput["operations"][number]>,
): string {
  const checked = validatePatchOperations(operations);
  return checked.map((operation) => JSON.stringify(operation) + "\n").join("");
}

function boundedValidationError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return raw.replaceAll(/\s+/g, " ").slice(0, 320);
}

/**
 * 从 Mastra requestContext 取回 CoordinatedMastraAgent 注入的
 * threadId/runId（经 input.context 透传）。取不到则 fail closed。
 */
function coordinatorKeys(requestContext: unknown): CoordinatorKeys | null {
  const agui = (
    requestContext as { get?: (key: string) => unknown } | undefined
  )?.get?.("ag-ui") as
    | { context?: Array<{ description: string; value: string }> }
    | undefined;
  const entries = agui?.context ?? [];
  const threadId = entries.find(
    (e) => e.description === "coordinator-thread-id",
  )?.value;
  const runId = entries.find(
    (e) => e.description === "coordinator-run-id",
  )?.value;
  if (!threadId || !runId) return null;
  return { threadId, runId };
}

function buildGeneratorUserMessage(
  input: GenerateSpecInput,
  plan: string | null,
): string {
  const parts: string[] = [
    `用户请求：${input.request}`,
    "Patch 根对象是 ApplicationCandidate：只能编辑 /uiBundle/spec、/uiBundle/designSystem、/uiBundle/assets；businessSchema、migrationPlan、reverseMigrationPlan 与 migrationEdge 均由服务端拥有，禁止修改。",
  ];
  if (plan) parts.push(`已确认计划：${plan}`);
  if (input.target.base === "current") {
    parts.push(
      `编辑模式：base=current，baseRevision=${input.target.baseRevision}。保留未要求修改的内容。`,
      `当前应用 Spec：${JSON.stringify(input.target.currentSpec)}`,
    );
  } else {
    parts.push(
      "创建模式：base=empty。生成完整应用（metadata、layouts、routes）。",
    );
  }
  return parts.join("\n\n");
}

/**
 * generate_spec：唯一能改变应用的服务器工具。拥有生成器 LLM 与权威
 * catalog.prompt()；JSONL Patch 逐段经 Coordinator 以 AG-UI CUSTOM 事件
 * （spec.patch.*）发送给浏览器；生产收尾由服务端 Candidate → Validation →
 * Preview Commit 闭环决定，浏览器永远不能用本地 Spec 直接创建草稿。
 */
export function createGenerateSpecTool(
  coordinator: GenerationCoordinator,
  createGeneratorAgent: SpecGeneratorFactory,
) {
  return createTool({
    id: "generate_spec",
    description:
      "创建或编辑多页面应用。仅在用户已确认计划（approved_plan + questionSetId）或提出明确编辑请求（direct_edit）时调用。" +
      "编辑现有应用时 target 必须是 base=current 并携带来自 get_current_spec 的 baseRevision 与 currentSpec。",
    inputSchema: generateSpecInputSchema,
    outputSchema: generateSpecOutputSchema,
    execute: async (input, context) => {
      const keys = coordinatorKeys(context?.requestContext);
      if (!keys) {
        throw new Error(
          "generate_spec: missing coordinator thread/run context",
        );
      }
      const { threadId, runId } = keys;

      // approved_plan 必须由 Coordinator 按 questionSetId 取回原始计划。
      let plan: string | null = null;
      if (input.source.kind === "approved_plan") {
        const approved = await coordinator.consumeApprovedPlan(
          threadId,
          input.source.questionSetId,
        );
        if (!approved) {
          throw new Error(
            "generate_spec: approved_plan questionSetId 无效、未批准或已被消费（fail closed）",
          );
        }
        plan = JSON.stringify(approved);
      }

      const generationId = `gen-${runId}-${Date.now().toString(36)}`;
      coordinator.beginGeneration({ threadId, runId, generationId });

      let totalOperations = 0;
      let candidateDocument: unknown = buildServerCandidate(
        input.target.base === "current" ? input.target.currentSpec : {},
      );
      let finalValidationSucceeded = false;
      let emissionQueue = Promise.resolve();
      const emitPatchOperations = createTool({
        id: "emit_patch_operations",
        description:
          "提交一小批完整 RFC 6902 Patch operation。每批最多 12 个；服务端会校验并立即流式发送到浏览器。",
        inputSchema: emitPatchOperationsInputSchema,
        outputSchema: emitPatchOperationsOutputSchema,
        // LiteLLM 的 OpenAI Responses 兼容层拒绝严格工具 Schema 中的
        // discriminated-union/oneOf；输入仍由 Mastra+Zod 和下方运行时同源
        // RFC 6902 校验双重验证，不能绕过 fail-closed 边界。
        execute: async (batch) => {
          // 同一模型 turn 可能包含多个 tool call；按到达顺序串行发送，保证 Patch
          // 依赖关系不会被并行执行重排。
          let acceptedOperations = 0;
          await (emissionQueue = emissionQueue.then(() => {
            finalValidationSucceeded = false;
            if (
              totalOperations + batch.operations.length >
              MAX_GENERATION_OPERATIONS
            ) {
              throw new Error(
                "emit_patch_operations: Patch exceeds maxOperations",
              );
            }
            const operations = validateCandidateOperations(
              validatePatchOperations(batch.operations),
            );
            // 在发给浏览器前使用与 runtime 相同的 RFC 6902 实现验证当前
            // 累积文档。缺少 JSON Pointer 父节点等错误会在模型仍能修正时
            // 失败，而不是等浏览器最终拒绝。
            candidateDocument = applyJsonPatch(candidateDocument, operations);
            const clientOperations = operations
              .map(toClientSpecOperation)
              .filter((operation): operation is JsonPatchOperation => operation !== null);
            const jsonl = clientOperations
              .map((operation) => JSON.stringify(operation) + "\n")
              .join("");
            if (jsonl) {
              coordinator.emitPatchDelta(threadId, runId, generationId, jsonl);
            }
            totalOperations += batch.operations.length;
            acceptedOperations = batch.operations.length;
          }));
          return { acceptedOperations, totalOperations };
        },
      });
      const validatePatchGeneration = createTool({
        id: "validate_patch_generation",
        description:
          "校验目前累积的完整 NextAppSpec。仅当 valid=true 时才能结束生成；valid=false 时根据 error 继续调用 emit_patch_operations 修正。",
        inputSchema: validatePatchGenerationInputSchema,
        outputSchema: validatePatchGenerationOutputSchema,
        execute: async () => {
          const parsed = finalizeParse(candidateDocument);
          const checked = parsed.ok
            ? modelCatalog.validate(parsed.candidate.uiBundle.spec)
            : { success: false, error: new Error(parsed.message) };
          if (checked.success && parsed.ok) {
            finalValidationSucceeded = true;
            return { valid: true };
          }
          finalValidationSucceeded = false;
          return { valid: false, error: boundedValidationError(checked.error) };
        },
      });
      const generatorAgent = createGeneratorAgent({
        emit_patch_operations: emitPatchOperations,
        validate_patch_generation: validatePatchGeneration,
      });

      try {
        const stream = await generatorAgent.stream(
          buildGeneratorUserMessage(input, plan),
          // 多次内部工具调用构成一个生成过程；不转发任何 text-delta，避免
          // 自由文本绕过结构化 Patch 边界。
          { runId: `${runId}-generator`, maxSteps: 32 },
        );
        for await (const chunk of stream.fullStream) {
          void chunk;
        }
        await emissionQueue;
        if (totalOperations === 0 || !finalValidationSucceeded) {
          throw new Error(
            "generate_spec: generator completed without a valid validate_patch_generation result",
          );
        }
        await coordinator.finishValidatedCandidate(
          threadId,
          runId,
          generationId,
          candidateDocument,
          { totalOperations },
        );
      } catch (cause) {
        coordinator.failPatchStream(
          threadId,
          runId,
          generationId,
          cause instanceof Error ? cause.message : String(cause),
        );
        throw cause;
      }

      return { status: "patch_streaming" as const, generationId };
    },
  });
}
