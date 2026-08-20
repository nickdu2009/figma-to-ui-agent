import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import {
  applyJsonPatch,
  type JsonPatchOperation,
} from "@next-app-runtime/client/stream";
import {
  createMemoryNavigation,
  createRuntimeWithNavigation,
} from "@next-app-runtime/client/testing";

// pi-lens-ignore: ts:5097
import {
  emitPatchOperationsInputSchema,
  emitPatchOperationsOutputSchema,
  validatePatchGenerationInputSchema,
  validatePatchGenerationOutputSchema,
} from "../contracts.ts";
// pi-lens-ignore: ts:5097
import { validatePatchOperations } from "../generate-spec-tool.ts";
// pi-lens-ignore: ts:5097
import { STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT } from "../prompt.ts";
// pi-lens-ignore: ts:5097
import {
  SPEC_BENCHMARK_CASES,
  type SpecBenchmarkCase,
} from "./spec-benchmark-cases.ts";
// pi-lens-ignore: ts:5097
import {
  estimateCostUsd,
  extractGatewayCost,
  parsePriceMap,
  type BenchmarkUsage,
} from "./spec-benchmark-cost.ts";
// pi-lens-ignore: ts:5097
import {
  evaluateSpecQuality,
  type SpecQuality,
} from "./spec-benchmark-quality.ts";
// pi-lens-ignore: ts:5097
import {
  protocolForSpecBenchmark,
  providerOptionsForSpecBenchmark,
  reasoningEffortForSpecBenchmark,
  type SpecBenchmarkProtocol,
  type SpecBenchmarkReasoningEffort,
} from "./spec-benchmark-model-options.ts";
// pi-lens-ignore: ts:5097
import {
  BENCHMARK_FALLBACKS,
  BENCHMARK_RUNTIME_LIMITS,
  modelBenchmarkCatalog,
  modelBenchmarkRegistry,
} from "./spec-benchmark-runtime.ts";
// pi-lens-ignore: ts:5097
import { createReasoningSummaryObserver } from "./spec-benchmark-reasoning-output.ts";
// pi-lens-ignore: ts:5097
import { createControlledAgentRuntime } from "../agent-runtime.ts";
// pi-lens-ignore: ts:5097
import { createLiteLlmModelConfig } from "../model-policy.ts";

const DEFAULT_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;
const MAX_OPERATIONS = 1_000;
const MAX_STEPS = 32;

type CliOptions = {
  models: string[];
  caseIds: string[];
  repeats: number;
  outputPath: string;
  confirmSpend: boolean;
};

type BenchmarkResult = {
  experimentId: string;
  generationId: string;
  caseId: string;
  repeat: number;
  model: string;
  protocol: SpecBenchmarkProtocol;
  reasoningEffort: SpecBenchmarkReasoningEffort;
  startedAt: string;
  durationMs: number;
  usage: BenchmarkUsage;
  gatewayCostUsd: number | null;
  gatewayCostComplete: boolean;
  estimatedCostUsd: number | null;
  costSource: "gateway" | "estimated" | "unavailable";
  modelSteps: number;
  toolCalls: number;
  patchOperations: number;
  validationAttempts: number;
  catalogValid: boolean;
  applyStatus: "committed" | "rejected" | "cancelled" | "not_run";
  runtimeRouteChecks: Array<{
    route: string;
    applyStatus: "committed" | "rejected" | "cancelled";
    routeStatus: string;
    error?: string;
  }>;
  quality: SpecQuality | null;
  blindReviewId: string;
  status: "succeeded" | "failed";
  error?: string;
  candidateSpecPath?: string;
};

function boundedError(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause))
    .replaceAll(/\s+/g, " ")
    .slice(0, 500);
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`${flag} must be an integer from 1 to 100`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const options: CliOptions = {
    models: [...DEFAULT_MODELS],
    caseIds: SPEC_BENCHMARK_CASES.map((item) => item.id),
    repeats: 3,
    outputPath: resolve(`data/spec-model-benchmarks/${timestamp}.jsonl`),
    confirmSpend: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--confirm-spend") {
      options.confirmSpend = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--models") options.models = value.split(",").filter(Boolean);
    else if (flag === "--cases")
      options.caseIds = value.split(",").filter(Boolean);
    else if (flag === "--repeats")
      options.repeats = parsePositiveInteger(value, flag);
    else if (flag === "--output") options.outputPath = resolve(value);
    else throw new Error(`Unknown argument: ${flag}`);
    index += 1;
  }
  if (options.models.length === 0 || options.caseIds.length === 0) {
    throw new Error("At least one model and one case are required");
  }
  return options;
}

function usageNumber(value: number | undefined): number {
  return value ?? 0;
}

function blindReviewId(generationId: string): string {
  return `candidate-${createHash("sha256").update(generationId).digest("hex").slice(0, 12)}`;
}

async function evaluateRuntime(
  candidateSpec: unknown,
  quality: SpecQuality,
): Promise<BenchmarkResult["runtimeRouteChecks"]> {
  const routes =
    quality.signals.staticRoutes.length > 0
      ? quality.signals.staticRoutes
      : ["/"];
  const checks: BenchmarkResult["runtimeRouteChecks"] = [];
  for (const route of routes) {
    const runtime = createRuntimeWithNavigation(
      {
        catalog: modelBenchmarkCatalog,
        registry: modelBenchmarkRegistry,
        limits: BENCHMARK_RUNTIME_LIMITS,
        fallbacks: BENCHMARK_FALLBACKS,
      },
      createMemoryNavigation(route),
    );
    try {
      const applied = await runtime.applySource({
        kind: "object",
        value: candidateSpec,
      });
      const snapshot = runtime.getSnapshot();
      checks.push({
        route,
        applyStatus: applied.status,
        routeStatus: snapshot.routeStatus,
        ...(applied.status === "rejected"
          ? {
              error:
                `${applied.error.code}: ${boundedError(applied.error)}`.slice(
                  0,
                  320,
                ),
            }
          : {}),
      });
    } finally {
      runtime.dispose();
    }
  }
  return checks;
}

async function runOne(options: {
  apiKey: string;
  baseUrl: string;
  experimentId: string;
  model: string;
  benchmarkCase: SpecBenchmarkCase;
  repeat: number;
  outputPath: string;
  prices: ReturnType<typeof parsePriceMap>;
}): Promise<BenchmarkResult> {
  const startedAt = new Date();
  const generationId = `${options.experimentId}-${options.benchmarkCase.id}-${options.repeat}-${options.model}`;
  let candidateSpec: unknown = {};
  let patchOperations = 0;
  let validationAttempts = 0;
  let catalogValid = false;
  let quality: SpecQuality | null = null;
  let runtimeRouteChecks: BenchmarkResult["runtimeRouteChecks"] = [];
  const reviewId = blindReviewId(generationId);
  let candidateSpecPath: string | undefined;
  let streamOutput: Awaited<ReturnType<Agent["stream"]>> | undefined;

  const emitPatchOperations = createTool({
    id: "emit_patch_operations",
    description: "提交一小批完整 RFC 6902 Patch operation。每批最多 12 个。",
    inputSchema: emitPatchOperationsInputSchema,
    outputSchema: emitPatchOperationsOutputSchema,
    execute: async (batch) => {
      if (patchOperations + batch.operations.length > MAX_OPERATIONS) {
        throw new Error("Patch exceeds maxOperations");
      }
      const operations: JsonPatchOperation[] = validatePatchOperations(
        batch.operations,
      );
      candidateSpec = applyJsonPatch(candidateSpec, operations);
      patchOperations += operations.length;
      catalogValid = false;
      return {
        acceptedOperations: operations.length,
        totalOperations: patchOperations,
      };
    },
  });
  const validatePatchGeneration = createTool({
    id: "validate_patch_generation",
    description: "校验目前累计的完整 NextAppSpec；失败时根据有界错误继续修复。",
    inputSchema: validatePatchGenerationInputSchema,
    outputSchema: validatePatchGenerationOutputSchema,
    execute: async () => {
      validationAttempts += 1;
      const checked = modelBenchmarkCatalog.validate(candidateSpec);
      catalogValid = checked.success;
      return checked.success
        ? { valid: true }
        : { valid: false, error: boundedError(checked.error).slice(0, 320) };
    },
  });

  const runtime = createControlledAgentRuntime();
  try {
    const protocol = protocolForSpecBenchmark(options.model);
    const modelConfig = createLiteLlmModelConfig(options.model, {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
    });
    const agent = new Agent({
      id: `spec-benchmark-${options.model}`,
      name: `spec-benchmark-${options.model}`,
      instructions: STRUCTURED_SPEC_GENERATION_SYSTEM_PROMPT,
      model: modelConfig,
      maxRetries: 1,
      tools: {
        emit_patch_operations: emitPatchOperations,
        validate_patch_generation: validatePatchGeneration,
      },
      defaultOptions: providerOptionsForSpecBenchmark(options.model),
    });

    const registryKey = `benchmark-${generationId}`;
    streamOutput = await runtime.withDynamicAgent(
      agent,
      registryKey,
      async (registeredAgent) => {
        const output = await registeredAgent.stream(
          `用户请求：${options.benchmarkCase.request}\n\n创建模式：base=empty。生成完整应用（metadata、layouts、routes）。`,
          { runId: generationId, maxSteps: MAX_STEPS },
        );
        const observeReasoning = createReasoningSummaryObserver(options.model);
        for await (const chunk of output.fullStream) observeReasoning(chunk);
        return output;
      },
    );

    if (patchOperations === 0 || !catalogValid || !streamOutput) {
      throw new Error("Generator ended without a valid NextAppSpec");
    }
    quality = evaluateSpecQuality(candidateSpec, options.benchmarkCase);
    candidateSpecPath = resolve(
      dirname(options.outputPath),
      "specs",
      `${reviewId}.json`,
    );
    await mkdir(dirname(candidateSpecPath), { recursive: true });
    await writeFile(
      candidateSpecPath,
      `${JSON.stringify(candidateSpec, null, 2)}\n`,
      "utf8",
    );
    runtimeRouteChecks = await evaluateRuntime(candidateSpec, quality);
    const applyStatus = runtimeRouteChecks.every(
      (check) =>
        check.applyStatus === "committed" && check.routeStatus === "ready",
    )
      ? "committed"
      : (runtimeRouteChecks.find((check) => check.applyStatus !== "committed")
          ?.applyStatus ?? "rejected");
    if (applyStatus !== "committed") {
      throw new Error("NextAppSpec did not commit on every static route");
    }
    const totalUsage = await streamOutput.totalUsage;
    const usage: BenchmarkUsage = {
      inputTokens: usageNumber(totalUsage.inputTokens),
      outputTokens: usageNumber(totalUsage.outputTokens),
      totalTokens: usageNumber(totalUsage.totalTokens),
      reasoningTokens: usageNumber(totalUsage.reasoningTokens),
      cachedInputTokens: usageNumber(totalUsage.cachedInputTokens),
    };
    const steps = await streamOutput.steps;
    const stepCosts = steps.map((step) =>
      extractGatewayCost(step.response?.headers, step.providerMetadata),
    );
    const gatewayCostComplete =
      stepCosts.length > 0 && stepCosts.every((cost) => cost !== null);
    const gatewayCostUsd = gatewayCostComplete
      ? stepCosts.reduce<number>((total, cost) => total + (cost ?? 0), 0)
      : null;
    const estimatedCostUsd = estimateCostUsd(
      usage,
      options.prices[options.model],
    );
    return {
      experimentId: options.experimentId,
      generationId,
      caseId: options.benchmarkCase.id,
      repeat: options.repeat,
      model: options.model,
      protocol,
      reasoningEffort: reasoningEffortForSpecBenchmark(options.model),
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      usage,
      gatewayCostUsd,
      gatewayCostComplete,
      estimatedCostUsd,
      costSource:
        gatewayCostUsd === null
          ? estimatedCostUsd === null
            ? "unavailable"
            : "estimated"
          : "gateway",
      modelSteps: steps.length,
      toolCalls: (await streamOutput.toolCalls).length,
      patchOperations,
      validationAttempts,
      catalogValid,
      applyStatus,
      runtimeRouteChecks,
      quality,
      blindReviewId: reviewId,
      status: "succeeded",
      candidateSpecPath,
    };
  } catch (cause) {
    const totalUsage = streamOutput
      ? await streamOutput.totalUsage.catch(() => undefined)
      : undefined;
    const usage: BenchmarkUsage = {
      inputTokens: usageNumber(totalUsage?.inputTokens),
      outputTokens: usageNumber(totalUsage?.outputTokens),
      totalTokens: usageNumber(totalUsage?.totalTokens),
      reasoningTokens: usageNumber(totalUsage?.reasoningTokens),
      cachedInputTokens: usageNumber(totalUsage?.cachedInputTokens),
    };
    const estimatedCostUsd = estimateCostUsd(
      usage,
      options.prices[options.model],
    );
    return {
      experimentId: options.experimentId,
      generationId,
      caseId: options.benchmarkCase.id,
      repeat: options.repeat,
      model: options.model,
      protocol: protocolForSpecBenchmark(options.model),
      reasoningEffort: reasoningEffortForSpecBenchmark(options.model),
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      usage,
      gatewayCostUsd: null,
      gatewayCostComplete: false,
      estimatedCostUsd,
      costSource: estimatedCostUsd === null ? "unavailable" : "estimated",
      modelSteps: streamOutput
        ? (await streamOutput.steps.catch(() => [])).length
        : 0,
      toolCalls: streamOutput
        ? (await streamOutput.toolCalls.catch(() => [])).length
        : 0,
      patchOperations,
      validationAttempts,
      catalogValid,
      applyStatus:
        runtimeRouteChecks.find((check) => check.applyStatus !== "committed")
          ?.applyStatus ?? "not_run",
      runtimeRouteChecks,
      quality,
      blindReviewId: reviewId,
      status: "failed",
      error: boundedError(cause),
      ...(candidateSpecPath ? { candidateSpecPath } : {}),
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const selectedCases = options.caseIds.map((id) => {
    const benchmarkCase = SPEC_BENCHMARK_CASES.find((item) => item.id === id);
    if (!benchmarkCase) throw new Error(`Unknown benchmark case: ${id}`);
    return benchmarkCase;
  });
  const totalRuns =
    options.models.length * selectedCases.length * options.repeats;
  const plan = {
    models: options.models,
    cases: selectedCases.map((item) => item.id),
    repeats: options.repeats,
    totalRuns,
    outputPath: options.outputPath,
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!options.confirmSpend) {
    process.stdout.write(
      "Dry run only. Add --confirm-spend to call the configured LLM gateway.\n",
    );
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    throw new Error("OPENAI_API_KEY is required for a paid benchmark run");
  const baseUrl =
    process.env.VMA_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const prices = parsePriceMap(process.env.VMA_BENCHMARK_PRICES_JSON);
  const experimentId = `spec-model-${Date.now().toString(36)}`;
  const results: BenchmarkResult[] = [];
  await mkdir(dirname(options.outputPath), { recursive: true });
  for (const model of options.models) {
    for (const benchmarkCase of selectedCases) {
      for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
        const result = await runOne({
          apiKey,
          baseUrl,
          experimentId,
          model,
          benchmarkCase,
          repeat,
          outputPath: options.outputPath,
          prices,
        });
        results.push(result);
        await appendFile(
          options.outputPath,
          `${JSON.stringify(result)}\n`,
          "utf8",
        );
        process.stdout.write(
          `${result.model} ${result.caseId} #${result.repeat}: ${result.status}, cost=${result.gatewayCostUsd ?? result.estimatedCostUsd ?? "unknown"}\n`,
        );
      }
    }
  }
  const summary = options.models.map((model) => {
    const modelResults = results.filter((result) => result.model === model);
    const succeeded = modelResults.filter(
      (result) => result.status === "succeeded",
    ).length;
    const knownCosts = modelResults
      .map((result) => result.gatewayCostUsd ?? result.estimatedCostUsd)
      .filter((cost): cost is number => cost !== null);
    const totalKnownCostUsd = knownCosts.reduce(
      (total, cost) => total + cost,
      0,
    );
    return {
      model,
      runs: modelResults.length,
      succeeded,
      successRate:
        modelResults.length === 0 ? 0 : succeeded / modelResults.length,
      costKnownRuns: knownCosts.length,
      costCoverage:
        modelResults.length === 0 ? 0 : knownCosts.length / modelResults.length,
      totalKnownCostUsd,
      averageKnownRunCostUsd:
        knownCosts.length === 0 ? null : totalKnownCostUsd / knownCosts.length,
      knownCostPerSuccessfulSpecUsd:
        succeeded === 0 || knownCosts.length !== modelResults.length
          ? null
          : totalKnownCostUsd / succeeded,
      averageDurationMs:
        modelResults.length === 0
          ? 0
          : modelResults.reduce(
              (total, result) => total + result.durationMs,
              0,
            ) / modelResults.length,
      runtimeApplySuccessRate:
        modelResults.length === 0
          ? 0
          : modelResults.filter((result) => result.applyStatus === "committed")
              .length / modelResults.length,
      averageAutomatedQualityScore:
        modelResults.filter((result) => result.quality !== null).length === 0
          ? null
          : modelResults.reduce(
              (total, result) =>
                total + (result.quality?.automatedQualityScore ?? 0),
              0,
            ) / modelResults.filter((result) => result.quality !== null).length,
      averageRequirementCoverage:
        modelResults.filter((result) => result.quality !== null).length === 0
          ? null
          : modelResults.reduce(
              (total, result) =>
                total + (result.quality?.requirementCoverage ?? 0),
              0,
            ) / modelResults.filter((result) => result.quality !== null).length,
      totalInputTokens: modelResults.reduce(
        (total, result) => total + result.usage.inputTokens,
        0,
      ),
      totalOutputTokens: modelResults.reduce(
        (total, result) => total + result.usage.outputTokens,
        0,
      ),
    };
  });
  const summaryPath = options.outputPath.replace(/\.jsonl$/u, ".summary.json");
  const reviewManifestPath = options.outputPath.replace(
    /\.jsonl$/u,
    ".review.json",
  );
  const reviewCandidates = results
    .filter((result) => result.candidateSpecPath)
    .map((result) => ({
      blindReviewId: result.blindReviewId,
      caseId: result.caseId,
      candidateSpecPath: result.candidateSpecPath!,
    }))
    .sort((left, right) =>
      left.blindReviewId.localeCompare(right.blindReviewId),
    );
  await writeFile(
    reviewManifestPath,
    `${JSON.stringify({ experimentId, candidates: reviewCandidates }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    summaryPath,
    `${JSON.stringify({ experimentId, resultsPath: options.outputPath, reviewManifestPath, models: summary }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`Summary: ${summaryPath}\n`);
}

await main();
