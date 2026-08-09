import { z } from "zod";

import { SCHEMA_VERSION } from "../project-store/schemas.ts";
import { productM9MetricsSchema } from "./product-m9-flow-contracts.ts";

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

export const productM9EvidenceClassificationSchema = z.enum([
  "positive.change_to_variant",
  "positive.confirmed_submit",
  "pending.submit_like_confirmation",
  "gap.no_executable_evidence",
  "gap.missing_evidence",
  "gap.unsupported",
  "gap.failed_fixture",
]);

export const productM9EvidenceSampleInputSchema = z
  .object({
    sampleId: idSchema,
    category: z.string().min(1).max(128).optional(),
    status: z.enum(["passed", "partial", "failed"]),
    ok: z.boolean(),
    errorCategory: z.string().min(1).max(128).nullable().optional(),
    nextAction: z.string().min(1).max(2_000).optional(),
    metrics: productM9MetricsSchema,
    artifactRefs: z.record(z.string(), artifactRefSchema).optional(),
    validation: z
      .object({
        status: z.enum(["passed", "partial", "failed"]).optional(),
        reasons: z.array(z.string().min(1).max(2_000)).optional(),
        successfulFixtureCount: z.number().int().nonnegative().optional(),
        failedFixtureCount: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const productM9EvidenceFindingSchema = z
  .object({
    classification: productM9EvidenceClassificationSchema,
    evidence: z.string().min(1).max(2_000),
  })
  .strict();

export const productM9EvidenceSampleReportSchema = z
  .object({
    sampleId: idSchema,
    category: z.string().min(1).max(128).optional(),
    status: z.enum(["passed", "partial", "failed"]),
    ok: z.boolean(),
    classifications: z.array(productM9EvidenceFindingSchema).min(1).max(20),
    metrics: productM9MetricsSchema,
    validationReasons: z.array(z.string().min(1).max(2_000)).max(1_000),
    recommendedUse: z.string().min(1).max(2_000),
    artifactRefs: z.record(z.string(), artifactRefSchema).optional(),
  })
  .strict();

export const productM9EvidenceTotalsSchema = z
  .object({
    sampleCount: z.number().int().nonnegative(),
    changeToVariantPositive: z.number().int().nonnegative(),
    confirmedSubmitPositive: z.number().int().nonnegative(),
    submitLikeNeedsConfirmation: z.number().int().nonnegative(),
    noExecutableEvidence: z.number().int().nonnegative(),
    missingEvidence: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    failedFixture: z.number().int().nonnegative(),
  })
  .strict();

export const productM9EvidenceReportSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    scope: z.literal("product_m9_evidence_classification"),
    status: z.enum(["passed", "partial", "failed"]),
    runId: idSchema,
    sourceRef: artifactRefSchema.optional(),
    totals: productM9EvidenceTotalsSchema,
    samples: z.array(productM9EvidenceSampleReportSchema).min(1).max(1_000),
    decision: z.string().min(1).max(4_000),
    nextActions: z.array(z.string().min(1).max(2_000)).min(1).max(20),
  })
  .strict()
  .superRefine((report, ctx) => {
    const totals = aggregateProductM9EvidenceSamples(report.samples);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      if (report.totals[key] !== totals[key]) {
        ctx.addIssue({
          code: "custom",
          path: ["totals", key],
          message: "Product-M9 evidence totals 必须与 samples 重新计算结果一致",
        });
      }
    }
    if (
      report.status === "passed" &&
      (report.totals.changeToVariantPositive < 1 ||
        report.totals.confirmedSubmitPositive < 1 ||
        report.totals.failedFixture > 0 ||
        report.totals.unsupported > 0 ||
        report.totals.missingEvidence > 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Product-M9 evidence passed 需要同时具备 CHANGE_TO 与 confirmed submit 正向样本，且无失败 fixture/unsupported/missing evidence",
      });
    }
  });

export type ProductM9EvidenceSampleInput = z.infer<
  typeof productM9EvidenceSampleInputSchema
>;
export type ProductM9EvidenceSampleReport = z.infer<
  typeof productM9EvidenceSampleReportSchema
>;
export type ProductM9EvidenceReport = z.infer<
  typeof productM9EvidenceReportSchema
>;

function count(list: readonly unknown[] | undefined): number {
  return list?.length ?? 0;
}

function hasMetric(
  sample: ProductM9EvidenceSampleInput,
  metric: keyof z.infer<typeof productM9MetricsSchema>,
): boolean {
  const value = sample.metrics[metric];
  return typeof value === "number" && value > 0;
}

function successfulFixtureCount(sample: ProductM9EvidenceSampleInput): number {
  return Math.max(
    count(sample.metrics.successfulFixtureIds),
    sample.validation?.successfulFixtureCount ?? 0,
  );
}

function failedFixtureCount(sample: ProductM9EvidenceSampleInput): number {
  return Math.max(
    count(sample.metrics.failedFixtureIds),
    sample.validation?.failedFixtureCount ?? 0,
  );
}

export function classifyProductM9EvidenceSample(
  raw: unknown,
): ProductM9EvidenceSampleReport {
  const sample = productM9EvidenceSampleInputSchema.parse(raw);
  const findings: z.infer<typeof productM9EvidenceFindingSchema>[] = [];
  const successfulFixtures = successfulFixtureCount(sample);
  const failedFixtures = failedFixtureCount(sample);

  if (hasMetric(sample, "trustedStateChange") && successfulFixtures > 0) {
    findings.push({
      classification: "positive.change_to_variant",
      evidence:
        "trustedStateChange > 0 且至少一个行为 fixture 成功，可作为 CHANGE_TO / variant state-change restricted-live 回归样本。",
    });
  }
  if (hasMetric(sample, "confirmedSubmit") && successfulFixtures > 0) {
    findings.push({
      classification: "positive.confirmed_submit",
      evidence:
        "confirmedSubmit > 0 且至少一个行为 fixture 成功，可作为 submit/dialog 正向交付样本。",
    });
  }
  if (hasMetric(sample, "submitLikeNeedsConfirmation")) {
    findings.push({
      classification: "pending.submit_like_confirmation",
      evidence:
        "样本包含 submit-like interaction，但缺少已确认 postcondition，需要结构化 confirmation answer 后才能当正向 submit 证据。",
    });
  }
  if (hasMetric(sample, "missingEvidence")) {
    findings.push({
      classification: "gap.missing_evidence",
      evidence: "样本仍存在 target、页面映射或 interaction evidence 缺口。",
    });
  }
  if (hasMetric(sample, "unsupported")) {
    findings.push({
      classification: "gap.unsupported",
      evidence: "样本包含当前 Product-M9 不能安全表达的 Figma action。",
    });
  }
  if (failedFixtures > 0) {
    findings.push({
      classification: "gap.failed_fixture",
      evidence: "行为 fixture 存在执行失败，不能作为正向交付证据。",
    });
  }
  if (findings.length === 0) {
    findings.push({
      classification: "gap.no_executable_evidence",
      evidence: "样本没有成功 fixture、confirmed submit、trusted state change 或待确认 submit-like 证据。",
    });
  }

  return productM9EvidenceSampleReportSchema.parse({
    sampleId: sample.sampleId,
    category: sample.category,
    status: sample.status,
    ok: sample.ok,
    classifications: findings,
    metrics: sample.metrics,
    validationReasons: sample.validation?.reasons ?? [],
    recommendedUse: recommendedUseFor(findings),
    artifactRefs: sample.artifactRefs,
  });
}

function hasClassification(
  findings: readonly z.infer<typeof productM9EvidenceFindingSchema>[],
  classification: z.infer<typeof productM9EvidenceClassificationSchema>,
): boolean {
  return findings.some((finding) => finding.classification === classification);
}

function recommendedUseFor(
  findings: readonly z.infer<typeof productM9EvidenceFindingSchema>[],
): string {
  if (hasClassification(findings, "positive.confirmed_submit")) {
    return "用作 Product-M9 submit/dialog 正向 restricted-live 回归样本。";
  }
  if (hasClassification(findings, "positive.change_to_variant")) {
    return "用作 Flow-M14 CHANGE_TO / variant state-change restricted-live 回归样本。";
  }
  if (hasClassification(findings, "pending.submit_like_confirmation")) {
    return "保留为 submit-like confirmation 样本；补结构化确认后再重跑。";
  }
  if (hasClassification(findings, "gap.no_executable_evidence")) {
    return "不用于当前交付正向证据；换样本或选择包含 prototype interaction 的节点。";
  }
  return "只用于缺口诊断，不作为正向交付样本。";
}

export function aggregateProductM9EvidenceSamples(
  samples: readonly ProductM9EvidenceSampleReport[],
): z.infer<typeof productM9EvidenceTotalsSchema> {
  const has = (
    sample: ProductM9EvidenceSampleReport,
    classification: z.infer<typeof productM9EvidenceClassificationSchema>,
  ) => hasClassification(sample.classifications, classification);
  return {
    sampleCount: samples.length,
    changeToVariantPositive: samples.filter((sample) =>
      has(sample, "positive.change_to_variant"),
    ).length,
    confirmedSubmitPositive: samples.filter((sample) =>
      has(sample, "positive.confirmed_submit"),
    ).length,
    submitLikeNeedsConfirmation: samples.filter((sample) =>
      has(sample, "pending.submit_like_confirmation"),
    ).length,
    noExecutableEvidence: samples.filter((sample) =>
      has(sample, "gap.no_executable_evidence"),
    ).length,
    missingEvidence: samples.filter((sample) =>
      has(sample, "gap.missing_evidence"),
    ).length,
    unsupported: samples.filter((sample) => has(sample, "gap.unsupported"))
      .length,
    failedFixture: samples.filter((sample) => has(sample, "gap.failed_fixture"))
      .length,
  };
}

export function statusForProductM9Evidence(
  totals: z.infer<typeof productM9EvidenceTotalsSchema>,
): "passed" | "partial" | "failed" {
  if (
    totals.changeToVariantPositive > 0 &&
    totals.confirmedSubmitPositive > 0 &&
    totals.failedFixture === 0 &&
    totals.unsupported === 0 &&
    totals.missingEvidence === 0
  ) {
    return "passed";
  }
  if (
    totals.changeToVariantPositive > 0 ||
    totals.confirmedSubmitPositive > 0 ||
    totals.submitLikeNeedsConfirmation > 0
  ) {
    return "partial";
  }
  return "failed";
}

export function buildProductM9EvidenceReport(input: {
  readonly runId: string;
  readonly sourceRef?: string;
  readonly samples: readonly unknown[];
}): ProductM9EvidenceReport {
  const samples = input.samples.map((sample) =>
    classifyProductM9EvidenceSample(sample),
  );
  const totals = aggregateProductM9EvidenceSamples(samples);
  const status = statusForProductM9Evidence(totals);
  const nextActions = [
    totals.changeToVariantPositive > 0
      ? "保留已有 CHANGE_TO / variant state-change 正向样本作为 Flow-M14 回归。"
      : "补一个 trustedStateChange > 0 且 fixture 成功的 CHANGE_TO / variant state-change 样本。",
    totals.confirmedSubmitPositive > 0
      ? "保留已有 confirmed submit 正向样本作为 Product-M9 submit/dialog 回归。"
      : "继续寻找或确认一个 confirmedSubmit > 0 且 fixture 成功的 submit/dialog 样本。",
    totals.submitLikeNeedsConfirmation > 0
      ? "对 submit-like confirmation 样本补结构化 confirmation answer；没有确认前不要当作正向 submit 证据。"
      : "优先选择带原生 prototype target/postcondition 的 submit/dialog Community 节点，减少人工确认。",
  ];
  const decision =
    status === "passed"
      ? "Product-M9 evidence 同时覆盖 CHANGE_TO / variant 和 confirmed submit 正向样本，可进入更高层回归收口。"
      : "Product-M9 evidence 尚未同时覆盖 CHANGE_TO / variant 和 confirmed submit 正向样本；当前仍需补 submit/dialog 正向证据。";
  return productM9EvidenceReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    scope: "product_m9_evidence_classification",
    status,
    runId: input.runId,
    sourceRef: input.sourceRef,
    totals,
    samples,
    decision,
    nextActions,
  });
}

export function redactionCheckProductM9EvidenceReport(value: unknown): void {
  const serialized = JSON.stringify(value);
  const checks: Array<readonly [RegExp, string]> = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/[?&]node-id=/, "figma_node_query"],
    [/"rawResponse"\s*:/, "raw_response"],
    [/"designUrl"\s*:/, "design_url"],
    [/"figmaUrl"\s*:/, "figma_url"],
    [/"fileKey"\s*:/, "file_key"],
    [/"token"\s*:/i, "token_field"],
    [/\/Users\/[^"]+/, "absolute_path"],
    [/\/var\/folders\/[^"]+/, "absolute_path"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`product_m9_evidence_redaction_failed:${reason}`);
    }
  }
}
