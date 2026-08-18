import { describe, expect, it } from "vitest";

import {
  anthropicNativeBaseURL,
  CLAUDE_SPEC_BENCHMARK_REASONING_EFFORT,
  GPT_SPEC_BENCHMARK_REASONING_EFFORT,
  protocolForSpecBenchmark,
  providerOptionsForSpecBenchmark,
  reasoningEffortForSpecBenchmark,
  // pi-lens-ignore: ts:5097
} from "../../server/benchmark/spec-benchmark-model-options.ts";

describe("spec benchmark model options", () => {
  it("uses native adaptive xhigh thinking for Claude", () => {
    expect(CLAUDE_SPEC_BENCHMARK_REASONING_EFFORT).toBe("xhigh");
    expect(protocolForSpecBenchmark("claude-opus-4-8")).toBe("anthropic-native");
    expect(reasoningEffortForSpecBenchmark("claude-opus-4-8")).toBe("xhigh");
    expect(providerOptionsForSpecBenchmark("claude-opus-4-8")).toEqual({
      anthropic: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: "xhigh",
      },
    });
  });

  it("uses OpenAI max reasoning for GPT", () => {
    expect(GPT_SPEC_BENCHMARK_REASONING_EFFORT).toBe("max");
    expect(protocolForSpecBenchmark("gpt-5.6-terra")).toBe("openai-compatible");
    expect(reasoningEffortForSpecBenchmark("gpt-5.6-terra")).toBe("max");
    expect(providerOptionsForSpecBenchmark("gpt-5.6-terra")).toEqual({
      openai: { reasoningEffort: "max", reasoningSummary: "detailed" },
    });
  });

  it("uses the LiteLLM unified native Messages prefix without retaining query data", () => {
    expect(anthropicNativeBaseURL("https://gateway.example.test/team/v1?ignored=1"))
      .toBe("https://gateway.example.test/team/v1");
  });
});
