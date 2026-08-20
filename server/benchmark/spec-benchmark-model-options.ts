/**
 * Benchmark 模型与推理强度策略（设计 §4.1，计划 S10 动作 5）。
 * 统一改用 Mastra OpenAICompatibleConfig + LiteLLM 单一路径；
 * Anthropic 等模型同样经过 LiteLLM 的 OpenAI-compatible 通道。
 */
import {
  LITELLM_PROVIDER_ID,
  type ReasoningEffortLevel,
} from "../model-policy.ts";

export const DEFAULT_BENCHMARK_MODEL = "gpt-5.6-sol" as const;
export const DEFAULT_BENCHMARK_REASONING_EFFORT: ReasoningEffortLevel = "high";

export type SpecBenchmarkReasoningEffort = ReasoningEffortLevel;

export type SpecBenchmarkProtocol = "openai-compatible";

export function protocolForSpecBenchmark(
  _model: string,
): SpecBenchmarkProtocol {
  // S10：全部模型统一使用 LiteLLM OpenAI-compatible 通道
  return "openai-compatible";
}

export function reasoningEffortForSpecBenchmark(
  model: string,
): SpecBenchmarkReasoningEffort {
  if (model.includes("sol") || model.includes("opus")) {
    return "high";
  }
  if (model.includes("terra") || model.includes("sonnet")) {
    return "medium";
  }
  return DEFAULT_BENCHMARK_REASONING_EFFORT;
}

/** 构造 Benchmark 的 providerOptions（providerId: "litellm"）。 */
export function providerOptionsForSpecBenchmark(
  model: string,
  reasoningEffort?: ReasoningEffortLevel,
): { providerOptions: { litellm: { reasoningEffort: ReasoningEffortLevel } } } {
  const effort = reasoningEffort ?? reasoningEffortForSpecBenchmark(model);
  return {
    providerOptions: {
      [LITELLM_PROVIDER_ID]: {
        reasoningEffort: effort,
      },
    },
  };
}
