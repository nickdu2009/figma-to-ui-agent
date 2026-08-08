import { z } from "zod";

import {
  behaviorFixtureSchema,
  behaviorStepSchema,
} from "../ui-spec/schema.ts";

const idSchema = z.string().min(1).max(256);
const reasonSchema = z.string().min(1).max(2_000);

export const flowM11BehaviorStepSchema = behaviorStepSchema;
export const flowM11BehaviorFixtureSchema = behaviorFixtureSchema;

export const flowM11ExecutableStepSchema = z
  .object({
    stepId: idSchema,
    step: flowM11BehaviorStepSchema,
  })
  .strict();

export const flowM11ExecutableFixtureSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(512),
    viewportId: idSchema,
    initialPageId: idSchema,
    steps: z.array(flowM11ExecutableStepSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    const seen = new Set<string>();
    fixture.steps.forEach((step, index) => {
      if (seen.has(step.stepId)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "stepId"],
          message: `重复步骤标识：${step.stepId}`,
        });
      }
      seen.add(step.stepId);
    });
  });

export const flowM11ExecutionCheckSchema = z
  .object({
    fixtureId: idSchema,
    stepIndex: z.number().int().nonnegative().max(999),
    stepKind: z.string().min(1).max(128),
    passed: z.boolean(),
    reasonCode: idSchema.optional(),
    message: reasonSchema.optional(),
  })
  .strict();

export const flowM11FixtureExecutionResultSchema = z
  .object({
    fixtureId: idSchema,
    passed: z.boolean(),
    checks: z.array(flowM11ExecutionCheckSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((result, ctx) => {
    const failedCheck = result.checks.some((check) => !check.passed);
    if (result.passed === failedCheck) {
      ctx.addIssue({
        code: "custom",
        path: ["passed"],
        message: "fixture passed 必须与 step checks 保持一致",
      });
    }
  });

export const flowM11ValidationSummarySchema = z
  .object({
    schemaVersion: z.literal("1"),
    runId: idSchema,
    passed: z.boolean(),
    resultCount: z.number().int().nonnegative().max(10_000),
    failedCheckCount: z.number().int().nonnegative().max(10_000),
    successfulFixtureIds: z.array(idSchema).max(10_000),
    failedFixtureIds: z.array(idSchema).max(10_000),
    preSatisfiedExpectationCount: z
      .number()
      .int()
      .nonnegative()
      .max(10_000),
  })
  .strict()
  .superRefine((summary, ctx) => {
    if (
      summary.resultCount !==
      summary.successfulFixtureIds.length + summary.failedFixtureIds.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["resultCount"],
        message: "resultCount 必须等于成功和失败 fixture 数之和",
      });
    }
    if (summary.passed !== (summary.failedFixtureIds.length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["passed"],
        message: "summary passed 必须与 failedFixtureIds 保持一致",
      });
    }
  });

export type FlowM11BehaviorStep = z.infer<
  typeof flowM11BehaviorStepSchema
>;
export type FlowM11BehaviorFixture = z.infer<
  typeof flowM11BehaviorFixtureSchema
>;
export type FlowM11ExecutableFixture = z.infer<
  typeof flowM11ExecutableFixtureSchema
>;
export type FlowM11ExecutionCheck = z.infer<
  typeof flowM11ExecutionCheckSchema
>;
export type FlowM11FixtureExecutionResult = z.infer<
  typeof flowM11FixtureExecutionResultSchema
>;
export type FlowM11ValidationSummary = z.infer<
  typeof flowM11ValidationSummarySchema
>;
