import { z } from "zod";

import type { FlowM11ArtifactLoadResult } from "./m11-artifact-loader.ts";
import type { FlowM11PlannerResult } from "./m11-fixture-planner.ts";
import {
  flowM11ValidationSummarySchema,
  type FlowM11ValidationSummary,
} from "./m11-fixture-schema.ts";

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

export const flowM11NetworkBoundarySchema = z
  .object({
    figmaRestCalled: z.boolean(),
    openaiCalled: z.literal(false),
    mode: z.enum(["local", "restricted-live"]),
  })
  .strict();

export const flowM11ReportCountsSchema = z
  .object({
    fixtureCount: z.number().int().nonnegative().max(10_000),
    successfulFixtureCount: z.number().int().nonnegative().max(10_000),
    failedFixtureCount: z.number().int().nonnegative().max(10_000),
    stepCount: z.number().int().nonnegative().max(100_000),
    failedCheckCount: z.number().int().nonnegative().max(100_000),
    preSatisfiedExpectationCount: z
      .number()
      .int()
      .nonnegative()
      .max(100_000),
    summaryOnlyRejectionCount: z.number().int().nonnegative().max(10_000),
    scenarioOnlyRejectionCount: z.number().int().nonnegative().max(10_000),
    untrustedSourceRejectionCount: z
      .number()
      .int()
      .nonnegative()
      .max(10_000),
    referenceDanglingRejectionCount: z
      .number()
      .int()
      .nonnegative()
      .max(10_000),
  })
  .strict();

export const flowM11FixtureReportSchema = z
  .object({
    fixtureId: idSchema,
    interactionId: idSchema,
    intent: z.enum(["navigate", "set_state", "open_dialog", "submit", "unknown"]),
    source: z.enum(["figma", "inferred", "user_confirmed", "missing"]),
    submit: z.boolean(),
    inputStepCount: z.number().int().nonnegative().max(1_000),
    selectRadioToggleStepCount: z.number().int().nonnegative().max(1_000),
    postconditionStepCount: z.number().int().nonnegative().max(1_000),
  })
  .strict();

export const flowM11ExecutionReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M11"),
    scope: z.literal("multistep_execution"),
    status: z.enum(["passed", "partial", "failed"]),
    input: z
      .object({
        runId: idSchema,
        mode: z.enum(["local", "restricted-live"]),
        flowPlanRef: artifactRefSchema,
        uiSpecRef: artifactRefSchema.optional(),
        reportRef: artifactRefSchema.optional(),
        networkBoundary: flowM11NetworkBoundarySchema,
      })
      .strict(),
    artifact: z
      .object({
        status: z.enum(["loaded", "partial", "rejected"]),
        reasonCodes: z.array(idSchema).max(1_000),
        rejectionCount: z.number().int().nonnegative().max(10_000),
      })
      .strict(),
    counts: flowM11ReportCountsSchema,
    fixtures: z.array(flowM11FixtureReportSchema).max(10_000),
    successfulFixtureIds: z.array(idSchema).max(10_000),
    failedFixtureIds: z.array(idSchema).max(10_000),
    reasons: z.array(reasonSchema).max(1_000),
    residualRisks: z.array(reasonSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (
      report.counts.fixtureCount !==
      report.successfulFixtureIds.length + report.failedFixtureIds.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "fixtureCount"],
        message: "fixtureCount 必须等于成功和失败 fixture 数之和",
      });
    }
    if (
      report.counts.successfulFixtureCount !==
      report.successfulFixtureIds.length ||
      report.counts.failedFixtureCount !== report.failedFixtureIds.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["counts"],
        message: "fixture 成功/失败计数必须与 fixture id 列表一致",
      });
    }
    if (report.status === "passed") {
      if (report.failedFixtureIds.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["status"],
          message: "Flow-M11 passed 不能包含失败 fixture",
        });
      }
      if (report.counts.preSatisfiedExpectationCount > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["counts", "preSatisfiedExpectationCount"],
          message: "Flow-M11 passed 不能包含 pre-satisfied expectation",
        });
      }
      if (!report.fixtures.some((fixture) => fixture.submit)) {
        ctx.addIssue({
          code: "custom",
          path: ["fixtures"],
          message: "Flow-M11 passed 必须至少包含 submit fixture",
        });
      }
      if (
        !report.fixtures.some(
          (fixture) =>
            fixture.submit &&
            fixture.inputStepCount > 0 &&
            fixture.postconditionStepCount > 0,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["fixtures"],
          message: "Flow-M11 passed 必须包含多步骤 submit fixture",
        });
      }
      if (
        !report.fixtures.some(
          (fixture) => fixture.selectRadioToggleStepCount > 0,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["fixtures"],
          message: "Flow-M11 passed 必须覆盖 select/radio/toggle",
        });
      }
    }
  });

export type FlowM11ExecutionReport = z.infer<
  typeof flowM11ExecutionReportSchema
>;

export function redactionCheckFlowM11Report(value: unknown): void {
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
      throw new Error(`flow_m11_report_redaction_failed:${reason}`);
    }
  }
}

export function summarizeFlowM11Validation(validation: {
  readonly schemaVersion: "1";
  readonly runId: string;
  readonly passed: boolean;
  readonly results: readonly {
    readonly checks: readonly {
      readonly passed: boolean;
      readonly message: string;
    }[];
  }[];
}, options: {
  readonly fixtureIds?: readonly string[];
} = {}): FlowM11ValidationSummary {
  const successfulFixtureIds = new Set<string>();
  const failedFixtureIds = new Set<string>();
  let failedCheckCount = 0;
  let preSatisfiedExpectationCount = 0;
  let hasUnattributedFailure = false;
  for (const result of validation.results) {
    for (const check of result.checks) {
      if (!check.passed) {
        failedCheckCount += 1;
      }
      if (check.message.includes("后置断言在点击前已满足")) {
        preSatisfiedExpectationCount += 1;
      }
      const match = check.message.match(/^([^:]+):/);
      if (!match) {
        if (!check.passed) {
          hasUnattributedFailure = true;
        }
        continue;
      }
      if (check.passed) {
        successfulFixtureIds.add(match[1]!);
      } else {
        failedFixtureIds.add(match[1]!);
      }
    }
  }
  if (hasUnattributedFailure) {
    for (const fixtureId of options.fixtureIds ?? []) {
      failedFixtureIds.add(fixtureId);
    }
  }
  for (const failedId of failedFixtureIds) {
    successfulFixtureIds.delete(failedId);
  }
  return flowM11ValidationSummarySchema.parse({
    schemaVersion: validation.schemaVersion,
    runId: validation.runId,
    passed: validation.passed,
    resultCount: successfulFixtureIds.size + failedFixtureIds.size,
    failedCheckCount,
    successfulFixtureIds: [...successfulFixtureIds],
    failedFixtureIds: [...failedFixtureIds],
    preSatisfiedExpectationCount,
  });
}

function rejectionCount(
  artifact: FlowM11ArtifactLoadResult,
  reasonCode: string,
): number {
  return artifact.rejections.filter(
    (rejection) => rejection.reasonCode === reasonCode,
  ).length;
}

function statusFor(input: {
  readonly artifact: FlowM11ArtifactLoadResult;
  readonly planner: FlowM11PlannerResult;
  readonly validation: FlowM11ValidationSummary;
}): FlowM11ExecutionReport["status"] {
  if (
    input.artifact.status === "rejected" ||
    !input.validation.passed ||
    input.validation.preSatisfiedExpectationCount > 0 ||
    input.planner.multiStepSubmitFixtureCount < 1 ||
    input.planner.selectRadioToggleStepCount < 1 ||
    input.planner.executableFixtureIds.length < 1
  ) {
    return input.planner.executableFixtureIds.length > 0 ? "partial" : "failed";
  }
  return "passed";
}

export function buildFlowM11ExecutionReport(input: {
  readonly runId: string;
  readonly mode: "local" | "restricted-live";
  readonly flowPlanRef: string;
  readonly uiSpecRef?: string;
  readonly reportRef?: string;
  readonly figmaRestCalled?: boolean;
  readonly artifact: FlowM11ArtifactLoadResult;
  readonly planner: FlowM11PlannerResult;
  readonly validation: FlowM11ValidationSummary;
  readonly residualRisks?: readonly string[];
}): FlowM11ExecutionReport {
  const validation = flowM11ValidationSummarySchema.parse(input.validation);
  const counts = {
    fixtureCount: validation.resultCount,
    successfulFixtureCount: validation.successfulFixtureIds.length,
    failedFixtureCount: validation.failedFixtureIds.length,
    stepCount: input.planner.uiSpec.behaviorFixtures
      .filter((fixture) =>
        input.planner.executableFixtureIds.includes(fixture.id),
      )
      .reduce((sum, fixture) => sum + fixture.steps.length, 0),
    failedCheckCount: validation.failedCheckCount,
    preSatisfiedExpectationCount: validation.preSatisfiedExpectationCount,
    summaryOnlyRejectionCount: rejectionCount(
      input.artifact,
      "flow_plan_summary_only_carrier",
    ),
    scenarioOnlyRejectionCount: rejectionCount(
      input.artifact,
      "flow_plan_scenario_only_carrier",
    ),
    untrustedSourceRejectionCount: rejectionCount(
      input.artifact,
      "flow_plan_untrusted_source",
    ),
    referenceDanglingRejectionCount: rejectionCount(
      input.artifact,
      "flow_plan_reference_dangling",
    ),
  };
  const report = flowM11ExecutionReportSchema.parse({
    schemaVersion: "1",
    milestone: "Flow-M11",
    scope: "multistep_execution",
    status: statusFor({
      artifact: input.artifact,
      planner: input.planner,
      validation,
    }),
    input: {
      runId: input.runId,
      mode: input.mode,
      flowPlanRef: input.flowPlanRef,
      uiSpecRef: input.uiSpecRef,
      reportRef: input.reportRef,
      networkBoundary: {
        figmaRestCalled: input.figmaRestCalled ?? false,
        openaiCalled: false,
        mode: input.mode,
      },
    },
    artifact: {
      status: input.artifact.status,
      reasonCodes: input.artifact.reasonCodes,
      rejectionCount: input.artifact.rejections.length,
    },
    counts,
    fixtures: input.planner.behaviorFixtures,
    successfulFixtureIds: validation.successfulFixtureIds,
    failedFixtureIds: validation.failedFixtureIds,
    reasons: [...new Set([...input.planner.reasons, ...input.artifact.reasonCodes])],
    residualRisks: input.residualRisks ?? [
      input.mode === "restricted-live"
        ? "restricted-live 只证明真实样本 FlowPlan artifact 可执行，不代表真实后端业务提交成功。"
        : "本地 fixture 证明多步骤行为执行链路，不代表真实 Figma 样本覆盖已完成。",
    ],
  });
  redactionCheckFlowM11Report(report);
  return report;
}
