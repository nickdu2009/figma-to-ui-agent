import { describe, expect, it } from "vitest";

import {
  flowM11BehaviorStepSchema,
  flowM11ExecutableFixtureSchema,
  flowM11FixtureExecutionResultSchema,
  flowM11ValidationSummarySchema,
} from "../../../src/flow-plan/m11-fixture-schema.ts";

describe("Flow-M11 fixture schema", () => {
  it("接受 Flow-M11 要求的所有 behavior step 类型", () => {
    const steps = [
      { kind: "fill", nodeId: "email", value: "m11@example.com" },
      { kind: "select_option", nodeId: "plan", value: "pro" },
      { kind: "choose_radio", nodeId: "role", value: "admin" },
      { kind: "toggle", nodeId: "terms" },
      { kind: "click", nodeId: "submit" },
      { kind: "expect_page", pageId: "success" },
      { kind: "expect_visible", nodeId: "review-text" },
      { kind: "expect_value", nodeId: "email", value: "m11@example.com" },
      { kind: "expect_checked", nodeId: "terms", checked: true },
      { kind: "expect_selected", nodeId: "plan", value: "pro" },
    ];

    expect(
      steps.map((step) => flowM11BehaviorStepSchema.parse(step).kind),
    ).toEqual([
      "fill",
      "select_option",
      "choose_radio",
      "toggle",
      "click",
      "expect_page",
      "expect_visible",
      "expect_value",
      "expect_checked",
      "expect_selected",
    ]);
  });

  it("拒绝缺少动作内容、非法 selector 和超长输入值", () => {
    expect(() => flowM11BehaviorStepSchema.parse({ kind: "click" })).toThrow();
    expect(() =>
      flowM11BehaviorStepSchema.parse({
        kind: "select_option",
        nodeId: "plan",
        value: "",
      }),
    ).toThrow();
    expect(() =>
      flowM11BehaviorStepSchema.parse({
        kind: "fill",
        nodeId: "email",
        value: "x".repeat(10_001),
      }),
    ).toThrow();
  });

  it("拒绝重复 step id", () => {
    expect(() =>
      flowM11ExecutableFixtureSchema.parse({
        id: "fixture",
        name: "Fixture",
        viewportId: "desktop",
        initialPageId: "home",
        steps: [
          {
            stepId: "step-1",
            step: { kind: "fill", nodeId: "email", value: "a@example.com" },
          },
          {
            stepId: "step-1",
            step: { kind: "click", nodeId: "submit" },
          },
        ],
      }),
    ).toThrow("重复步骤标识");
  });

  it("校验 fixture result 和 validation summary 的派生状态", () => {
    expect(
      flowM11FixtureExecutionResultSchema.parse({
        fixtureId: "submit-flow",
        passed: false,
        checks: [
          {
            fixtureId: "submit-flow",
            stepIndex: 0,
            stepKind: "click",
            passed: false,
            reasonCode: "pre_satisfied_expectation",
          },
        ],
      }),
    ).toMatchObject({ passed: false });

    expect(() =>
      flowM11FixtureExecutionResultSchema.parse({
        fixtureId: "submit-flow",
        passed: true,
        checks: [
          {
            fixtureId: "submit-flow",
            stepIndex: 0,
            stepKind: "click",
            passed: false,
          },
        ],
      }),
    ).toThrow("fixture passed");

    expect(
      flowM11ValidationSummarySchema.parse({
        schemaVersion: "1",
        runId: "flow-m11-local",
        passed: true,
        resultCount: 1,
        failedCheckCount: 0,
        successfulFixtureIds: ["submit-flow"],
        failedFixtureIds: [],
        preSatisfiedExpectationCount: 0,
      }),
    ).toMatchObject({ passed: true });

    expect(() =>
      flowM11ValidationSummarySchema.parse({
        schemaVersion: "1",
        runId: "flow-m11-local",
        passed: true,
        resultCount: 2,
        failedCheckCount: 0,
        successfulFixtureIds: ["submit-flow"],
        failedFixtureIds: [],
        preSatisfiedExpectationCount: 0,
      }),
    ).toThrow("resultCount");
  });
});
