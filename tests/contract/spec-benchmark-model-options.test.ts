/**
 * S10 契约测试：Benchmark 模型选项（设计 §4.1，统一 LiteLLM Responses）。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BENCHMARK_MODEL,
  DEFAULT_BENCHMARK_REASONING_EFFORT,
  protocolForSpecBenchmark,
  providerOptionsForSpecBenchmark,
  reasoningEffortForSpecBenchmark,
  // pi-lens-ignore: ts:5097
} from "../../server/benchmark/spec-benchmark-model-options.ts";

describe("spec benchmark model options (S10 LiteLLM single path)", () => {
  it("默认 Benchmark 模型为 gpt-5.6-sol / high", () => {
    expect(DEFAULT_BENCHMARK_MODEL).toBe("gpt-5.6-sol");
    expect(DEFAULT_BENCHMARK_REASONING_EFFORT).toBe("high");
  });

  it("所有模型统一走 openai-responses 协议（LiteLLM）", () => {
    expect(protocolForSpecBenchmark("claude-opus-4-8")).toBe(
      "openai-responses",
    );
    expect(protocolForSpecBenchmark("gpt-5.6-sol")).toBe("openai-responses");
    expect(protocolForSpecBenchmark("gpt-5.6-terra")).toBe("openai-responses");
  });

  it("providerOptions 统一生成 Responses summary 选项", () => {
    expect(providerOptionsForSpecBenchmark("gpt-5.6-sol")).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "high",
          reasoningSummary: "detailed",
          store: false,
        },
      },
    });

    expect(providerOptionsForSpecBenchmark("gpt-5.6-terra")).toEqual({
      providerOptions: {
        openai: {
          reasoningEffort: "medium",
          reasoningSummary: "detailed",
          store: false,
        },
      },
    });
  });

  it("推理强度按模型类别受控映射", () => {
    expect(reasoningEffortForSpecBenchmark("claude-opus-4-8")).toBe("high");
    expect(reasoningEffortForSpecBenchmark("gpt-5.6-sol")).toBe("high");
    expect(reasoningEffortForSpecBenchmark("gpt-5.6-terra")).toBe("medium");
  });
});
