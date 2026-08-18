export const CLAUDE_SPEC_BENCHMARK_REASONING_EFFORT = "xhigh" as const;
export const GPT_SPEC_BENCHMARK_REASONING_EFFORT = "max" as const;
export type SpecBenchmarkReasoningEffort =
  | typeof CLAUDE_SPEC_BENCHMARK_REASONING_EFFORT
  | typeof GPT_SPEC_BENCHMARK_REASONING_EFFORT;

export type SpecBenchmarkProtocol = "anthropic-native" | "openai-compatible";
type BenchmarkJsonValue = null | boolean | number | string | BenchmarkJsonValue[] | {
  [key: string]: BenchmarkJsonValue;
};
type BenchmarkProviderOptions = Record<string, Record<string, BenchmarkJsonValue>>;

export function protocolForSpecBenchmark(model: string): SpecBenchmarkProtocol {
  return model.startsWith("claude-") ? "anthropic-native" : "openai-compatible";
}

export function reasoningEffortForSpecBenchmark(model: string): SpecBenchmarkReasoningEffort {
  return protocolForSpecBenchmark(model) === "anthropic-native"
    ? CLAUDE_SPEC_BENCHMARK_REASONING_EFFORT
    : GPT_SPEC_BENCHMARK_REASONING_EFFORT;
}

export function anthropicNativeBaseURL(openAICompatibleBaseURL: string): string {
  const url = new URL(openAICompatibleBaseURL);
  // LiteLLM's unified /v1/messages endpoint accepts the Anthropic Messages
  // wire protocol while retaining proxy authentication and model routing.
  // /anthropic/v1 is provider pass-through and requires an upstream key.
  url.pathname = url.pathname.replace(/\/$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

/**
 * Keep reasoning effort explicit while using each model family's native wire
 * protocol and provider-specific reasoning summary controls.
 */
export function providerOptionsForSpecBenchmark(model: string): BenchmarkProviderOptions {
  if (protocolForSpecBenchmark(model) === "anthropic-native") {
    return {
      anthropic: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: reasoningEffortForSpecBenchmark(model),
      },
    };
  }
  return {
    openai: {
      reasoningEffort: reasoningEffortForSpecBenchmark(model),
      reasoningSummary: "detailed",
    },
  };
}
