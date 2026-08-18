export type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
};

export type BenchmarkUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
};

const COST_KEYS = new Set([
  "response_cost",
  "responseCost",
  "cost",
  "spend",
]);

function finiteNonNegative(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/** 从 LiteLLM 常见响应头或 provider metadata 中提取单步实际花费。 */
export function extractGatewayCost(
  headers: Record<string, string> | undefined,
  providerMetadata: unknown,
): number | null {
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      const normalized = key.toLowerCase();
      if (
        normalized === "x-litellm-response-cost" ||
        normalized === "x-litellm-response-cost-original"
      ) {
        const parsed = finiteNonNegative(value);
        if (parsed !== null) return parsed;
      }
    }
  }

  const queue: unknown[] = [providerMetadata];
  const seen = new Set<object>();
  let visited = 0;
  while (queue.length > 0 && visited < 200) {
    const current = queue.shift();
    visited += 1;
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (COST_KEYS.has(key)) {
        const parsed = finiteNonNegative(value);
        if (parsed !== null) return parsed;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

export function estimateCostUsd(
  usage: BenchmarkUsage,
  price: ModelPrice | undefined,
): number | null {
  if (!price) return null;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  return (
    (uncached * price.inputPerMillion +
      cached * cachedRate +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000
  );
}

export function parsePriceMap(raw: string | undefined): Record<string, ModelPrice> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("VMA_BENCHMARK_PRICES_JSON must be a JSON object");
  }
  const result: Record<string, ModelPrice> = {};
  for (const [model, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid price for model ${model}`);
    }
    const record = value as Record<string, unknown>;
    const inputPerMillion = finiteNonNegative(record.inputPerMillion);
    const outputPerMillion = finiteNonNegative(record.outputPerMillion);
    const cachedInputPerMillion = finiteNonNegative(record.cachedInputPerMillion);
    if (inputPerMillion === null || outputPerMillion === null) {
      throw new Error(`Invalid input/output price for model ${model}`);
    }
    result[model] = {
      inputPerMillion,
      outputPerMillion,
      ...(cachedInputPerMillion === null ? {} : { cachedInputPerMillion }),
    };
  }
  return result;
}

