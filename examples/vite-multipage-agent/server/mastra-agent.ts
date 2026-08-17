import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
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

/**
 * 服务端 LLM 设置（计划 §8）：模型与推理强度为服务端固定值，
 * 不接受也不透传请求体字段；API Key 只从进程环境读取。
 */
const SERVER_LLM_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
} as const;

/**
 * 创建聊天 Agent（生产路径）。
 * - 聊天 Agent：CHAT_SYSTEM_PROMPT + 服务器工具 generate_spec；
 *   其余三个工具（get_current_spec / summarize_current_app /
 *   ask_question）由客户端声明为前端工具，经 clientTools 进入模型。
 * - 生成器 Agent：只在 generate_spec 内部使用 SPEC_GENERATION_SYSTEM_PROMPT。
 * - 外层统一包 CoordinatedMastraAgent（唯一的 AG-UI adapter）。
 */
export function createChatAgent(
  lifecycle?: GenerationLifecyclePort,
): AbstractAgent {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for VMA_AGENT_MODE=openai (use VMA_AGENT_MODE=probe|mock for local runs without a key)",
    );
  }

  const openai = createOpenAI({
    apiKey,
    baseURL: process.env.VMA_OPENAI_BASE_URL ?? SERVER_LLM_SETTINGS.baseUrl,
  });
  // 模型与推理强度是服务端固定策略，客户端请求和本地环境都不能覆盖。
  const model = openai(SERVER_LLM_SETTINGS.model);
  const providerOptions = {
    openai: {
      reasoningEffort: SERVER_LLM_SETTINGS.reasoningEffort,
    },
  } as const;

  const coordinator = new GenerationCoordinator(lifecycle);

  // 每次 generate_spec 创建独立生成器，私有 emit_patch_operations 工具闭包只
  // 绑定当前 {threadId, runId, generationId}，不会泄漏到其他 generation。
  const createGeneratorAgent: SpecGeneratorFactory = (tools) =>
    new Agent({
      id: "spec-generator",
      name: "spec-generator",
      instructions: STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT,
      model,
      tools,
      defaultOptions: { providerOptions },
    });

  const generateSpecTool = createGenerateSpecTool(
    coordinator,
    createGeneratorAgent,
  );

  const chatAgent = new Agent({
    id: "chat",
    name: "chat",
    instructions: CHAT_SYSTEM_PROMPT,
    model,
    tools: { generate_spec: generateSpecTool },
    // 聊天层只负责澄清、确认和发起一次 generate_spec；上限防止模型在
    // 已有工具结果后继续无界推理/工具循环。
    defaultOptions: { providerOptions, maxSteps: 12 },
  });

  const inner = new MastraAgent({ agent: chatAgent, agentId: "chat" });
  return new CoordinatedMastraAgent(inner, coordinator, { agentId: "chat" });
}
