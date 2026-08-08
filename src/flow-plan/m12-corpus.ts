import { z } from "zod";

const idSchema = z.string().min(1).max(256);
const artifactRefSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/.test(value),
    "artifact ref 不能是绝对路径",
  );
const reasonSchema = z.string().min(1).max(2_000);

export const flowM12CapabilitySchema = z.enum([
  "navigate",
  "set_state",
  "submit",
  "state_machine",
  "select_radio_checkbox",
  "restricted_live_summary",
]);

export const flowM12SampleSourceSchema = z.enum([
  "local_fixture",
  "restricted_live_artifact",
  "restricted_live_summary",
]);

export const flowM12CorpusSampleSchema = z
  .object({
    sampleId: idSchema,
    category: idSchema,
    source: flowM12SampleSourceSchema,
    capabilityHints: z.array(flowM12CapabilitySchema).max(20).default([]),
    flowPlanPath: artifactRefSchema.optional(),
    uiSpecPath: artifactRefSchema.optional(),
    seedStoreFrom: artifactRefSchema.optional(),
    upstreamReportPath: artifactRefSchema.optional(),
    upstreamSampleId: idSchema.optional(),
  })
  .strict();

export const flowM12CorpusManifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    corpusId: idSchema,
    samples: z.array(flowM12CorpusSampleSchema).min(1).max(100),
  })
  .strict();

export const flowM12CoverageSchema = z
  .object({
    navigate: z.boolean(),
    setState: z.boolean(),
    submit: z.boolean(),
    stateMachine: z.boolean(),
    selectRadioCheckbox: z.boolean(),
    restrictedLiveSummary: z.boolean(),
  })
  .strict();

export const flowM12SampleReportSchema = z
  .object({
    sampleId: idSchema,
    category: idSchema,
    source: flowM12SampleSourceSchema,
    status: z.enum(["passed", "partial", "failed", "not_executable"]),
    capabilities: flowM12CoverageSchema,
    executionReportRef: artifactRefSchema.optional(),
    upstreamReportRef: artifactRefSchema.optional(),
    reasons: z.array(reasonSchema).max(100),
  })
  .strict();

export const flowM12ReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M12"),
    scope: z.literal("corpus_regression"),
    status: z.enum(["passed", "partial", "failed"]),
    input: z
      .object({
        runId: idSchema,
        manifestRef: artifactRefSchema,
        networkBoundary: z
          .object({
            figmaRestCalled: z.literal(false),
            openaiCalled: z.literal(false),
            mode: z.literal("local-corpus"),
          })
          .strict(),
      })
      .strict(),
    counts: z
      .object({
        sampleCount: z.number().int().nonnegative().max(100),
        executableSampleCount: z.number().int().nonnegative().max(100),
        passedExecutableSampleCount: z.number().int().nonnegative().max(100),
        partialExecutableSampleCount: z.number().int().nonnegative().max(100),
        failedExecutableSampleCount: z.number().int().nonnegative().max(100),
        notExecutableSampleCount: z.number().int().nonnegative().max(100),
        restrictedLiveSummarySampleCount: z
          .number()
          .int()
          .nonnegative()
          .max(100),
      })
      .strict(),
    coverage: flowM12CoverageSchema,
    samples: z.array(flowM12SampleReportSchema).max(100),
    reasons: z.array(reasonSchema).max(100),
    residualRisks: z.array(reasonSchema).min(1).max(100),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.counts.sampleCount !== report.samples.length) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "sampleCount"],
        message: "sampleCount 必须等于 samples 数量",
      });
    }
    const executableCount = report.samples.filter(
      (sample) => sample.status !== "not_executable",
    ).length;
    if (report.counts.executableSampleCount !== executableCount) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "executableSampleCount"],
        message: "executableSampleCount 必须与样本状态一致",
      });
    }
  });

export type FlowM12CorpusManifest = z.infer<
  typeof flowM12CorpusManifestSchema
>;
export type FlowM12SampleReport = z.infer<typeof flowM12SampleReportSchema>;
export type FlowM12Report = z.infer<typeof flowM12ReportSchema>;
export type FlowM12Coverage = z.infer<typeof flowM12CoverageSchema>;

export function emptyFlowM12Coverage(): FlowM12Coverage {
  return {
    navigate: false,
    setState: false,
    submit: false,
    stateMachine: false,
    selectRadioCheckbox: false,
    restrictedLiveSummary: false,
  };
}

export function mergeFlowM12Coverage(
  items: readonly FlowM12Coverage[],
): FlowM12Coverage {
  return items.reduce<FlowM12Coverage>(
    (merged, item) => ({
      navigate: merged.navigate || item.navigate,
      setState: merged.setState || item.setState,
      submit: merged.submit || item.submit,
      stateMachine: merged.stateMachine || item.stateMachine,
      selectRadioCheckbox:
        merged.selectRadioCheckbox || item.selectRadioCheckbox,
      restrictedLiveSummary:
        merged.restrictedLiveSummary || item.restrictedLiveSummary,
    }),
    emptyFlowM12Coverage(),
  );
}

export function coverageFromHints(
  hints: readonly z.infer<typeof flowM12CapabilitySchema>[],
): FlowM12Coverage {
  return {
    navigate: hints.includes("navigate"),
    setState: hints.includes("set_state"),
    submit: hints.includes("submit"),
    stateMachine: hints.includes("state_machine"),
    selectRadioCheckbox: hints.includes("select_radio_checkbox"),
    restrictedLiveSummary: hints.includes("restricted_live_summary"),
  };
}

export function buildFlowM12Report(input: {
  readonly runId: string;
  readonly manifestRef: string;
  readonly samples: readonly FlowM12SampleReport[];
}): FlowM12Report {
  const samples = input.samples.map((sample) =>
    flowM12SampleReportSchema.parse(sample),
  );
  const counts = {
    sampleCount: samples.length,
    executableSampleCount: samples.filter(
      (sample) => sample.status !== "not_executable",
    ).length,
    passedExecutableSampleCount: samples.filter(
      (sample) => sample.status === "passed",
    ).length,
    partialExecutableSampleCount: samples.filter(
      (sample) => sample.status === "partial",
    ).length,
    failedExecutableSampleCount: samples.filter(
      (sample) => sample.status === "failed",
    ).length,
    notExecutableSampleCount: samples.filter(
      (sample) => sample.status === "not_executable",
    ).length,
    restrictedLiveSummarySampleCount: samples.filter(
      (sample) => sample.source === "restricted_live_summary",
    ).length,
  };
  const reasons = new Set<string>();
  if (counts.sampleCount < 5) {
    reasons.add("flow_m12_less_than_five_samples");
  }
  if (counts.passedExecutableSampleCount < 1) {
    reasons.add("flow_m12_no_passing_executable_sample");
  }
  const artifactMissing = samples.some(
    (sample) =>
      sample.status === "not_executable" &&
      sample.reasons.some((reason) =>
        [
          "flow_plan_artifact_missing",
          "ui_spec_artifact_missing",
          "upstream_report_missing",
          "upstream_sample_missing",
        ].includes(reason),
      ),
  );
  if (artifactMissing) {
    reasons.add("flow_m12_real_flowplan_artifacts_missing");
  } else if (counts.notExecutableSampleCount > 0) {
    reasons.add("flow_m12_non_executable_samples");
  }
  if (counts.failedExecutableSampleCount > 0) {
    reasons.add("flow_m12_executable_sample_failed");
  }
  const coverage = mergeFlowM12Coverage(
    samples.map((sample) => sample.capabilities),
  );
  for (const [field, covered] of Object.entries(coverage)) {
    if (field === "restrictedLiveSummary") {
      continue;
    }
    if (!covered) {
      reasons.add(`flow_m12_coverage_missing_${field}`);
    }
  }
  const status =
    reasons.size === 0
      ? "passed"
      : counts.passedExecutableSampleCount > 0 &&
          counts.failedExecutableSampleCount === 0
        ? "partial"
        : "failed";
  const report = flowM12ReportSchema.parse({
    schemaVersion: "1",
    milestone: "Flow-M12",
    scope: "corpus_regression",
    status,
    input: {
      runId: input.runId,
      manifestRef: input.manifestRef,
      networkBoundary: {
        figmaRestCalled: false,
        openaiCalled: false,
        mode: "local-corpus",
      },
    },
    counts,
    coverage,
    samples,
    reasons: [...reasons],
    residualRisks: [
      "Flow-M12 corpus runner 只执行本地已有 artifact，不调用 Figma/OpenAI；restricted-live summary 样本只能证明真实 provenance，不能替代 M11 可执行 artifact。",
    ],
  });
  redactionCheckFlowM12Report(report);
  return report;
}

export function redactionCheckFlowM12Report(value: unknown): void {
  const serialized = JSON.stringify(value);
  const checks: Array<readonly [RegExp, string]> = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/[?&]node-id=/, "figma_node_query"],
    [/"rawResponse"\s*:/, "raw_response"],
    [/"designUrl"\s*:/, "design_url"],
    [/"fileKey"\s*:/, "file_key"],
    [/"figmaUrl"\s*:/, "figma_url"],
    [/"token"\s*:/i, "token_field"],
    [/\/Users\/[^"]+/, "absolute_path"],
    [/\/var\/folders\/[^"]+/, "absolute_path"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`flow_m12_report_redaction_failed:${reason}`);
    }
  }
}
