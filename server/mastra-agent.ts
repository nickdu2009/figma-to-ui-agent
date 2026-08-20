import { Agent } from "@mastra/core/agent";
import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
import { randomUUID } from "node:crypto";
// pi-lens-ignore: ts:5097
import {
  CHAT_SYSTEM_PROMPT,
  STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT,
} from "./prompt.ts";
// pi-lens-ignore: ts:5097
import { GenerationCoordinator } from "./generation-coordinator.ts";
import type { GenerationLifecyclePort } from "./generation/lifecycle.ts";
// pi-lens-ignore: ts:5097
import {
  createGenerateSpecTool,
  type SpecGeneratorFactory,
} from "./generate-spec-tool.ts";
// pi-lens-ignore: ts:5097
import { CoordinatedMastraAgent } from "./coordinated-mastra-agent.ts";
// pi-lens-ignore: ts:5097
import {
  PRODUCTION_MODEL_POLICY,
  createLiteLlmExecutionOptions,
  createLiteLlmModelConfig,
  resolveLiteLlmConfig,
} from "./model-policy.ts";
// pi-lens-ignore: ts:5097
import {
  ControlledAgentRuntime,
  createControlledAgentRuntime,
} from "./agent-runtime.ts";

/**
 * 创建聊天 Agent（生产路径：受控 Mastra Runtime + LiteLLM 单一路径，设计 §4.1）。
 * - 聊天 Agent：CHAT_SYSTEM_PROMPT + 服务器工具 generate_spec；
 *   固定模型 gpt-5.6-terra，推理强度 medium，maxRetries: 1；
 * - 生成器 Agent：只在 generate_spec 内部使用 SPEC_GENERATION_SYSTEM_PROMPT，
 *   固定模型 gpt-5.6-sol，推理强度 high，maxRetries: 1；
 * - 静态 Chat Agent 注册进受控 Mastra Runtime（logger: false）；
 * - 外层统一包 CoordinatedMastraAgent（唯一的 AG-UI adapter）。
 */
export function createChatAgent(
  lifecycle?: GenerationLifecyclePort,
  runtime?: ControlledAgentRuntime,
): AbstractAgent {
  const config = resolveLiteLlmConfig();
  if (!config.apiKey) {
    throw new Error(
      "LITELLM_API_KEY (or OPENAI_API_KEY) is required for VMA_AGENT_MODE=openai (use VMA_AGENT_MODE=probe|mock for local runs without a key)",
    );
  }

  // 模型与推理强度是服务端固定策略，客户端请求和本地环境都不能覆盖。
  const chatModel = createLiteLlmModelConfig(
    PRODUCTION_MODEL_POLICY.chat.modelId,
    config,
  );
  const generatorModel = createLiteLlmModelConfig(
    PRODUCTION_MODEL_POLICY.spec.modelId,
    config,
  );

  const coordinator = new GenerationCoordinator(lifecycle);
  // 该变量在 createChatAgent 返回前赋值。Generator factory 真正执行发生在
  // 后续工具调用中；若生命周期被错误重排，则 fail closed 而不是裸 stream。
  let agentRuntime: ControlledAgentRuntime | undefined;

  // 每次 generate_spec 创建独立生成器，私有 emit_patch_operations 工具闭包只
  // 绑定当前 {threadId, runId, generationId}，不会泄漏到其他 generation。
  const createGeneratorAgent: SpecGeneratorFactory = (tools) => {
    if (!agentRuntime) {
      throw new Error("受控 Agent Runtime 尚未初始化");
    }
    const generator = new Agent({
      id: "spec-generator",
      name: "spec-generator",
      instructions: STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT,
      model: generatorModel,
      maxRetries: PRODUCTION_MODEL_POLICY.spec.maxRetries,
      tools,
      defaultOptions: createLiteLlmExecutionOptions(
        PRODUCTION_MODEL_POLICY.spec.reasoningEffort,
      ),
    });
    // createGenerateSpecTool 会消费 fullStream；这里的代理保证 stream 建立时
    // 注册到 Mastra，且该 fullStream 的终态（done/throw/return）必然注销。
    return agentRuntime.createManagedDynamicStreamAgent(
      generator,
      `spec-generator-${randomUUID()}`,
    );
  };

  const generateSpecTool = createGenerateSpecTool(
    coordinator,
    createGeneratorAgent,
  );

  const chatAgent = new Agent({
    id: "chat",
    name: "chat",
    instructions: CHAT_SYSTEM_PROMPT,
    model: chatModel,
    maxRetries: PRODUCTION_MODEL_POLICY.chat.maxRetries,
    tools: { generate_spec: generateSpecTool },
    // 聊天层只负责澄清、确认和发起一次 generate_spec；上限防止模型在
    // 已有工具结果后继续无界推理/工具循环。
    defaultOptions: {
      ...createLiteLlmExecutionOptions(
        PRODUCTION_MODEL_POLICY.chat.reasoningEffort,
      ),
      maxSteps: PRODUCTION_MODEL_POLICY.chat.maxSteps,
    },
  });

  agentRuntime =
    runtime ??
    createControlledAgentRuntime({
      staticAgents: { chat: chatAgent },
    });
  // 确保 chat Agent 在受控 runtime 中注册为静态 Agent
  if (!agentRuntime.getAgent("chat")) {
    agentRuntime.addStaticAgent(chatAgent, "chat");
  }
  const registeredChatAgent = agentRuntime.getAgent("chat");
  if (!registeredChatAgent) {
    throw new Error("受控 Agent Runtime 未注册 chat Agent");
  }

  // AG-UI adapter 只取得 Mastra registry 中的 static Agent；不保留创建时的
  // 裸 Agent 引用，避免生产执行路径绕过 ControlledAgentRuntime。
  const inner = new MastraAgent({ agent: registeredChatAgent, agentId: "chat" });
  return new CoordinatedMastraAgent(inner, coordinator, { agentId: "chat" });
}
