import { z } from "zod";

import { projectIdSchema } from "../project-store/project-id.ts";
import {
  behaviorFixtureSchema,
  behaviorStepSchema,
} from "../ui-spec/schema.ts";

const idSchema = z.string().min(1).max(256);

const submitLikeExpectationSchema = z
  .object({
    fixtureId: idSchema,
    clickNodeId: idSchema,
    convertedActionId: idSchema.optional(),
  })
  .strict();

export const flowM7BehaviorScenarioSchema = z
  .object({
    schemaVersion: z.literal("1"),
    projectId: projectIdSchema,
    fixtures: z.array(behaviorFixtureSchema).max(1_000),
    submitLikeExpectations: z
      .array(submitLikeExpectationSchema)
      .max(1_000)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fixtureIds = new Set(value.fixtures.map((fixture) => fixture.id));
    value.submitLikeExpectations.forEach((expectation, index) => {
      const fixture = value.fixtures.find(
        (candidate) => candidate.id === expectation.fixtureId,
      );
      if (!fixture) {
        ctx.addIssue({
          code: "custom",
          path: ["submitLikeExpectations", index, "fixtureId"],
          message: `悬空 submit-like fixture 引用：${expectation.fixtureId}`,
        });
        return;
      }
      const clickIndex = fixture.steps.findIndex(
        (step) =>
          step.kind === "click" && step.nodeId === expectation.clickNodeId,
      );
      if (clickIndex < 0) {
        ctx.addIssue({
          code: "custom",
          path: ["submitLikeExpectations", index, "clickNodeId"],
          message: "submit-like 期望必须引用 fixture 内的 click step",
        });
        return;
      }
      const hasPostcondition = fixture.steps
        .slice(clickIndex + 1)
        .some((step) =>
          step.kind === "expect_page" ||
          step.kind === "expect_visible" ||
          step.kind === "expect_text" ||
          step.kind === "expect_value" ||
          step.kind === "expect_checked",
        );
      if (!hasPostcondition) {
        ctx.addIssue({
          code: "custom",
          path: ["submitLikeExpectations", index],
          message: "submit-like 期望必须包含 click 后的可观察 postcondition",
        });
      }
    });

    const referenced = new Set(
      value.submitLikeExpectations.map((expectation) => expectation.fixtureId),
    );
    for (const fixtureId of referenced) {
      if (!fixtureIds.has(fixtureId)) {
        ctx.addIssue({
          code: "custom",
          path: ["submitLikeExpectations"],
          message: `悬空 submit-like fixture 引用：${fixtureId}`,
        });
      }
    }
  });

export type FlowM7BehaviorScenario = z.infer<
  typeof flowM7BehaviorScenarioSchema
>;
export type FlowM7BehaviorScenarioFixture =
  FlowM7BehaviorScenario["fixtures"][number];
export type FlowM7BehaviorScenarioStep = z.infer<
  typeof behaviorStepSchema
>;

export function parseFlowM7BehaviorScenario(
  raw: unknown,
): FlowM7BehaviorScenario {
  return flowM7BehaviorScenarioSchema.parse(raw);
}
