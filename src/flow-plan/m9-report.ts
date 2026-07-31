import { z } from "zod";

import {
  figmaInteractionSourceSchema,
  flowIntentSchema,
} from "./schema.ts";

const idSchema = z.string().min(1).max(256);
const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const artifactPathSchema = z.string().min(1).max(2_048);

export const flowM9ClassificationSchema = z.enum([
  "trusted.navigate",
  "trusted.set_state",
  "needs_confirmation.submit_like",
  "unsupported",
  "missing_evidence",
  "not_accessible",
]);

export const flowM9SampleAccessStatusSchema = z.enum([
  "readable",
  "missing_evidence",
  "not_accessible",
  "skipped",
]);

export const flowM9NetworkBoundarySchema = z
  .object({
    figmaRestCalled: z.boolean(),
    openaiCalled: z.literal(false),
    mode: z.enum(["local", "restricted-live"]),
  })
  .strict();

export const flowM9SampleClassificationSchema = z
  .object({
    classification: flowM9ClassificationSchema,
    interactionId: idSchema.optional(),
    intent: flowIntentSchema.optional(),
    sourceNodeId: idSchema.optional(),
    sourceNodeName: z.string().min(1).max(512).optional(),
    blockedReason: z.string().min(1).max(2_000).optional(),
    evidence: z.string().min(1).max(2_000),
  })
  .strict();

export const flowM9SampleCountsSchema = z
  .object({
    prototypeInteractionCount: z.number().int().nonnegative(),
    flowPlanInteractionCount: z.number().int().nonnegative(),
    trustedNavigate: z.number().int().nonnegative(),
    trustedStateChange: z.number().int().nonnegative(),
    submitLikeNeedsConfirmation: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    missingEvidence: z.number().int().nonnegative(),
  })
  .strict();

export const flowM9SampleReportSchema = z
  .object({
    sampleId: idSchema,
    category: z.string().min(1).max(128),
    expectedViewport: z.enum(["mobile", "desktop", "unknown"]),
    accessStatus: flowM9SampleAccessStatusSchema,
    interactionSource: figmaInteractionSourceSchema,
    counts: flowM9SampleCountsSchema,
    classifications: z.array(flowM9SampleClassificationSchema).max(10_000),
    blockedReasons: z.array(z.string().min(1).max(2_000)).max(10_000),
    artifactRefs: z
      .object({
        designBundlePath: artifactPathSchema.optional(),
        uiSpecPath: artifactPathSchema.optional(),
        flowPlanPath: artifactPathSchema.optional(),
        reportPath: artifactPathSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const flowM9AggregateSchema = z
  .object({
    totalSamples: z.number().int().nonnegative(),
    readableSamples: z.number().int().nonnegative(),
    trustedNavigate: z.number().int().nonnegative(),
    trustedStateChange: z.number().int().nonnegative(),
    submitLikeNeedsConfirmation: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    missingEvidence: z.number().int().nonnegative(),
    notAccessible: z.number().int().nonnegative(),
  })
  .strict();

export const flowM9RestrictedLiveExtractionReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M9"),
    scope: z.literal("restricted_live_interaction_extraction"),
    status: z.enum(["passed", "partial", "failed"]),
    input: z
      .object({
        runId: runIdSchema,
        sampleManifestRef: artifactPathSchema,
        sampleIds: z.array(idSchema).min(1).max(10),
        networkBoundary: flowM9NetworkBoundarySchema,
      })
      .strict(),
    samples: z.array(flowM9SampleReportSchema).min(1).max(10),
    aggregate: flowM9AggregateSchema,
    reasons: z.array(z.string().min(1).max(2_000)).max(1_000),
    residualRisks: z.array(z.string().min(1).max(2_000)).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const aggregate = aggregateFlowM9Samples(value.samples);
    if (
      value.aggregate.totalSamples !== aggregate.totalSamples ||
      value.aggregate.readableSamples !== aggregate.readableSamples ||
      value.aggregate.trustedNavigate !== aggregate.trustedNavigate ||
      value.aggregate.trustedStateChange !== aggregate.trustedStateChange ||
      value.aggregate.submitLikeNeedsConfirmation !==
        aggregate.submitLikeNeedsConfirmation ||
      value.aggregate.unsupported !== aggregate.unsupported ||
      value.aggregate.missingEvidence !== aggregate.missingEvidence ||
      value.aggregate.notAccessible !== aggregate.notAccessible
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["aggregate"],
        message: "Flow-M9 aggregate 必须与 samples 重新计算结果一致",
      });
    }
    if (value.status === "passed") {
      if (value.aggregate.readableSamples < 3) {
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "Flow-M9 passed 必须至少包含 3 个 readable 样本",
        });
      }
      if (
        value.aggregate.trustedNavigate +
          value.aggregate.trustedStateChange <
        1
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["aggregate"],
          message: "Flow-M9 passed 必须至少包含 1 个可信 FlowPlan 候选",
        });
      }
      if (value.aggregate.submitLikeNeedsConfirmation < 1) {
        ctx.addIssue({
          code: "custom",
          path: ["aggregate", "submitLikeNeedsConfirmation"],
          message: "Flow-M9 passed 必须至少包含 1 个 needs_confirmation.submit_like",
        });
      }
    }
  });

export type FlowM9Classification = z.infer<
  typeof flowM9ClassificationSchema
>;
export type FlowM9SampleReport = z.infer<
  typeof flowM9SampleReportSchema
>;
export type FlowM9RestrictedLiveExtractionReport = z.infer<
  typeof flowM9RestrictedLiveExtractionReportSchema
>;
export type FlowM9SampleClassification = z.infer<
  typeof flowM9SampleClassificationSchema
>;

export function aggregateFlowM9Samples(
  samples: readonly FlowM9SampleReport[],
): z.infer<typeof flowM9AggregateSchema> {
  return {
    totalSamples: samples.length,
    readableSamples: samples.filter((sample) => sample.accessStatus === "readable")
      .length,
    trustedNavigate: samples.reduce(
      (count, sample) => count + sample.counts.trustedNavigate,
      0,
    ),
    trustedStateChange: samples.reduce(
      (count, sample) => count + sample.counts.trustedStateChange,
      0,
    ),
    submitLikeNeedsConfirmation: samples.reduce(
      (count, sample) => count + sample.counts.submitLikeNeedsConfirmation,
      0,
    ),
    unsupported: samples.reduce(
      (count, sample) => count + sample.counts.unsupported,
      0,
    ),
    missingEvidence: samples.reduce(
      (count, sample) => count + sample.counts.missingEvidence,
      0,
    ),
    notAccessible: samples.filter((sample) =>
      sample.accessStatus === "not_accessible" ||
      sample.accessStatus === "skipped",
    ).length,
  };
}

export function statusForFlowM9Aggregate(
  aggregate: z.infer<typeof flowM9AggregateSchema>,
): "passed" | "partial" | "failed" {
  if (
    aggregate.readableSamples >= 3 &&
    aggregate.trustedNavigate + aggregate.trustedStateChange >= 1 &&
    aggregate.submitLikeNeedsConfirmation >= 1
  ) {
    return "passed";
  }
  return aggregate.readableSamples > 0 ? "partial" : "failed";
}

export function parseFlowM9RestrictedLiveExtractionReport(
  raw: unknown,
): FlowM9RestrictedLiveExtractionReport {
  return flowM9RestrictedLiveExtractionReportSchema.parse(raw);
}

export function createFlowM9SampleCounts(
  classifications: readonly FlowM9SampleClassification[],
  input: {
    readonly prototypeInteractionCount: number;
    readonly flowPlanInteractionCount: number;
  },
): z.infer<typeof flowM9SampleCountsSchema> {
  return {
    prototypeInteractionCount: input.prototypeInteractionCount,
    flowPlanInteractionCount: input.flowPlanInteractionCount,
    trustedNavigate: classifications.filter(
      (item) => item.classification === "trusted.navigate",
    ).length,
    trustedStateChange: classifications.filter(
      (item) => item.classification === "trusted.set_state",
    ).length,
    submitLikeNeedsConfirmation: classifications.filter(
      (item) => item.classification === "needs_confirmation.submit_like",
    ).length,
    unsupported: classifications.filter(
      (item) => item.classification === "unsupported",
    ).length,
    missingEvidence: classifications.filter(
      (item) => item.classification === "missing_evidence",
    ).length,
  };
}

export function redactionCheckFlowM9Report(value: unknown): void {
  const serialized = JSON.stringify(value);
  const checks: Array<readonly [RegExp, string]> = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/"fileKey"\s*:/, "figma_file_key_field"],
    [/"designUrl"\s*:/, "figma_design_url_field"],
    [/"rawResponse"\s*:/, "raw_response_field"],
  ];
  for (const [pattern, code] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`report_redaction_failed:${code}`);
    }
  }
}
