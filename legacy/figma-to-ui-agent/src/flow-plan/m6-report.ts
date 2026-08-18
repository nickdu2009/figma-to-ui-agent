import { z } from "zod";

import {
  figmaInteractionSourceSchema,
  flowPlanInteractionSchema,
} from "./schema.ts";

const idSchema = z.string().min(1).max(256);
const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const validationSummarySchema = z
  .object({
    schemaVersion: z.literal("1"),
    runId: runIdSchema,
    previewUrl: z.string().url().max(2_048),
    passed: z.boolean(),
    resultCount: z.number().int().nonnegative(),
    failedCheckCount: z.number().int().nonnegative(),
  })
  .strict();

export const flowM6RouteExecutionReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M6"),
    scope: z.literal("route_execution_only"),
    status: z.enum(["passed", "partial", "failed"]),
    projectId: z.string().min(1).max(64),
    runId: runIdSchema,
    figmaInteractionSource: figmaInteractionSourceSchema.optional(),
    sourceDesignBundleRevision: z.number().int().positive(),
    sourceUISpecRevision: z.number().int().positive().optional(),
    sourceFlowPlanRevision: z.number().int().positive().optional(),
    savedUISpecRevision: z.number().int().positive().optional(),
    routeCount: z.number().int().nonnegative(),
    navigateActionCount: z.number().int().nonnegative(),
    behaviorFixtureCount: z.number().int().nonnegative(),
    convertedNavigateActionIds: z.array(idSchema).max(10_000),
    behaviorFixtureIds: z.array(idSchema).max(10_000),
    unresolvedInteractions: z
      .array(flowPlanInteractionSchema)
      .max(10_000),
    insufficientReason: z.string().min(1).max(2_000).optional(),
    validation: validationSummarySchema.optional(),
    residualRisks: z.array(z.string().min(1).max(2_000)).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "passed" && value.convertedNavigateActionIds.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Flow-M6 passed 状态必须至少包含一个已转换 navigate action",
      });
    }
    if (value.status === "failed" && value.validation?.passed !== false) {
      ctx.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Flow-M6 failed 状态必须包含失败的验证摘要",
      });
    }
    if (value.status === "partial" && value.insufficientReason === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["insufficientReason"],
        message: "Flow-M6 partial 状态必须说明条件不足原因",
      });
    }
  });

export type FlowM6RouteExecutionReport = z.infer<
  typeof flowM6RouteExecutionReportSchema
>;
export type FlowM6ValidationSummary = z.infer<
  typeof validationSummarySchema
>;

export function parseFlowM6RouteExecutionReport(
  raw: unknown,
): FlowM6RouteExecutionReport {
  return flowM6RouteExecutionReportSchema.parse(raw);
}

export function summarizeFlowM6Validation(
  validation: {
    readonly schemaVersion: "1";
    readonly runId: string;
    readonly previewUrl: string;
    readonly passed: boolean;
    readonly results: readonly {
      readonly checks: readonly { readonly passed: boolean }[];
    }[];
  },
): FlowM6ValidationSummary {
  return validationSummarySchema.parse({
    schemaVersion: validation.schemaVersion,
    runId: validation.runId,
    previewUrl: validation.previewUrl,
    passed: validation.passed,
    resultCount: validation.results.length,
    failedCheckCount: validation.results.reduce(
      (count, result) =>
        count + result.checks.filter((check) => !check.passed).length,
      0,
    ),
  });
}
