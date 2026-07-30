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
    source: z.enum(["figma", "user_confirmed"]),
  })
  .strict();

const behaviorFixtureSummarySchema = z
  .object({
    fixtureId: idSchema,
    source: z.enum(["flow_plan", "scenario"]),
    intent: flowIntentSchema.optional(),
    submit: z.boolean().optional(),
    stateMachineTransition: z.boolean().optional(),
    selectRadioAssertionCount: z.number().int().nonnegative().optional(),
  })
  .strict();

const countsSchema = z
  .object({
    trustedSubmitConverted: z.number().int().nonnegative(),
    userConfirmedConverted: z.number().int().nonnegative(),
    stateMachineTransitions: z.number().int().nonnegative(),
    selectRadioAssertions: z.number().int().nonnegative(),
    scenarioOnlyFixtures: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
  })
  .strict();

export const flowM8FormSubmitStateMachineReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M8"),
    scope: z.literal("form_submit_state_machine"),
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
    if (value.validation?.passed !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Flow-M8 passed 必须包含通过的行为验证摘要",
      });
    }
    if (
      value.counts.trustedSubmitConverted < 1 &&
      value.counts.stateMachineTransitions < 2
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["counts"],
        message:
          "Flow-M8 passed 必须至少包含一个可信 submit 或两个状态机 transition",
      });
    }
    const successful = new Set(value.validation?.successfulFixtureIds ?? []);
    const hasSuccessfulM8Fixture = value.behaviors.fixtures.some(
      (fixture) =>
        fixture.source === "flow_plan" &&
        (fixture.submit || fixture.stateMachineTransition) &&
        successful.has(fixture.fixtureId),
    );
    if (!hasSuccessfulM8Fixture) {
      ctx.addIssue({
        code: "custom",
        path: ["validation", "successfulFixtureIds"],
        message: "Flow-M8 passed 必须至少有一个 submit 或状态机 fixture 成功",
      });
    }
  });

export type FlowM8FormSubmitStateMachineReport = z.infer<
  typeof flowM8FormSubmitStateMachineReportSchema
>;
export type FlowM8ValidationSummary = z.infer<
  typeof validationSummarySchema
>;

export function parseFlowM8FormSubmitStateMachineReport(
  raw: unknown,
): FlowM8FormSubmitStateMachineReport {
  return flowM8FormSubmitStateMachineReportSchema.parse(raw);
}

export function summarizeFlowM8Validation(validation: {
  readonly schemaVersion: "1";
  readonly runId: string;
  readonly previewUrl: string;
  readonly passed: boolean;
  readonly results: readonly {
    readonly checks: readonly {
      readonly passed: boolean;
      readonly message: string;
    }[];
  }[];
}): FlowM8ValidationSummary {
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
