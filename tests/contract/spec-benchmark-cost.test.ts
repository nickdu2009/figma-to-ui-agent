import { describe, expect, it } from "vitest";

import {
  estimateCostUsd,
  extractGatewayCost,
  parsePriceMap,
  // pi-lens-ignore: ts:5097
} from "../../server/benchmark/spec-benchmark-cost.ts";

describe("spec benchmark cost accounting", () => {
  it("prefers the bounded LiteLLM response cost header", () => {
    expect(
      extractGatewayCost(
        { "x-litellm-response-cost": "0.125" },
        { response_cost: 9 },
      ),
    ).toBe(0.125);
  });

  it("falls back to nested provider metadata", () => {
    expect(
      extractGatewayCost(undefined, {
        litellm: { hidden: { response_cost: 0.75 } },
      }),
    ).toBe(0.75);
  });

  it("estimates cached and uncached token cost separately", () => {
    expect(
      estimateCostUsd(
        {
          inputTokens: 1_000_000,
          cachedInputTokens: 250_000,
          outputTokens: 100_000,
          reasoningTokens: 0,
          totalTokens: 1_100_000,
        },
        {
          inputPerMillion: 2,
          cachedInputPerMillion: 0.5,
          outputPerMillion: 12,
        },
      ),
    ).toBeCloseTo(2.825);
  });

  it("parses an explicit per-model fallback price map", () => {
    expect(
      parsePriceMap(
        JSON.stringify({
          "gpt-5.6-terra": { inputPerMillion: 2, outputPerMillion: 12 },
        }),
      ),
    ).toEqual({
      "gpt-5.6-terra": { inputPerMillion: 2, outputPerMillion: 12 },
    });
  });
});

