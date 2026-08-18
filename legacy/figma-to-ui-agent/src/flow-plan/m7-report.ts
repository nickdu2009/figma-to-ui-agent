import { z } from "zod";

import {
  figmaInteractionSourceSchema,
  flowIntentSchema,
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
    successfulFixtureIds: z.array(idSchema).max(10_000),
    failedFixtureIds: z.array(idSchema).max(10_000),
  })
  .strict();

const convertedActionSchema = z
  .object({
    interactionId: idSchema,
    actionId: idSchema,
    intent: flowIntentSchema,
    trusted: z.literal(true),
  })
  .strict();

const behaviorFixtureSummarySchema = z
  .object({
    fixtureId: idSchema,
    source: z.enum(["flow_plan", "scenario"]),
    intent: flowIntentSchema.optional(),
    submitLike: z.boolean().optional(),
  })
  .strict();

const countsSchema = z
  .object({
    trustedNonRouteConverted: z.number().int().nonnegative(),
    scenarioOnlyFixtures: z.number().int().nonnegative(),
    submitLikeVerified: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  })
  .strict();

export const flowM7InteractiveBehaviorReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M7"),
    scope: z.literal("interactive_behavior"),
    status: z.enum(["passed", "partial", "failed"]),
    input: z
      .object({
        projectId: z.string().min(1).max(64),
        runId: runIdSchema,
        flowPlanPath: z.string().min(1).max(2_048),
        uiSpecRevision: z.number().int().positive().optional(),
        flowPlanRevision: z.number().int().positive().optional(),
        savedUISpecRevision: z.number().int().positive().optional(),
        figmaInteractionSource: figmaInteractionSourceSchema.optional(),
      })
      .strict(),
    actions: z
      .object({
        converted: z.array(convertedActionSchema).max(10_000),
        rejected: z.array(flowPlanInteractionSchema).max(10_000),
      })
      .strict(),
    behaviors: z
      .object({
        fixtures: z.array(behaviorFixtureSummarySchema).max(10_000),
      })
      .strict(),
    counts: countsSchema,
    validation: validationSummarySchema.optional(),
    reasons: z.array(z.string().min(1).max(2_000)).max(1_000),
    residualRisks: z.array(z.string().min(1).max(2_000)).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status !== "passed") {
      return;
    }
    if (value.counts.trustedNonRouteConverted < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Flow-M7 passed 必须至少包含一个可信非 navigate FlowPlan 转换",
      });
    }
    if (value.validation?.passed !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Flow-M7 passed 必须包含通过的行为验证摘要",
      });
    }
    const successful = new Set(value.validation?.successfulFixtureIds ?? []);
    const hasNonNavigateFixtureSuccess = value.behaviors.fixtures.some(
      (fixture) =>
        fixture.source === "flow_plan" &&
        fixture.intent !== "navigate" &&
        successful.has(fixture.fixtureId),
    );
    if (!hasNonNavigateFixtureSuccess) {
      ctx.addIssue({
        code: "custom",
        path: ["validation", "successfulFixtureIds"],
        message: "Flow-M7 passed 必须至少有一个非 navigate fixture 成功",
      });
    }
  });

export type FlowM7InteractiveBehaviorReport = z.infer<
  typeof flowM7InteractiveBehaviorReportSchema
>;
export type FlowM7ValidationSummary = z.infer<
  typeof validationSummarySchema
>;

export function parseFlowM7InteractiveBehaviorReport(
  raw: unknown,
): FlowM7InteractiveBehaviorReport {
  return flowM7InteractiveBehaviorReportSchema.parse(raw);
}

export function summarizeFlowM7Validation(
  validation: {
    readonly schemaVersion: "1";
    readonly runId: string;
    readonly previewUrl: string;
    readonly passed: boolean;
    readonly results: readonly {
      readonly checks: readonly { readonly passed: boolean; readonly message: string }[];
    }[];
  },
): FlowM7ValidationSummary {
  const successfulFixtureIds = new Set<string>();
  const failedFixtureIds = new Set<string>();
  let failedCheckCount = 0;
  for (const result of validation.results) {
    for (const check of result.checks) {
      if (!check.passed) {
        failedCheckCount += 1;
      }
      const match = check.message.match(/^([^:]+):/);
      if (!match) {
        continue;
      }
      if (check.passed) {
        successfulFixtureIds.add(match[1]!);
      } else {
        failedFixtureIds.add(match[1]!);
      }
    }
  }
  return validationSummarySchema.parse({
    schemaVersion: validation.schemaVersion,
    runId: validation.runId,
    previewUrl: validation.previewUrl,
    passed: validation.passed,
    resultCount: validation.results.length,
    failedCheckCount,
    successfulFixtureIds: [...successfulFixtureIds],
    failedFixtureIds: [...failedFixtureIds],
  });
}
