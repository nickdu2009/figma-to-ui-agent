import { describe, expect, it } from "vitest";

import {
  parseFlowM8FormSubmitStateMachineReport,
  summarizeFlowM8Validation,
} from "../../../src/flow-plan/m8-report.ts";

function baseReport() {
  return {
    schemaVersion: "1",
    milestone: "Flow-M8",
    scope: "form_submit_state_machine",
    status: "passed",
    input: {
      projectId: "demo-project",
      runId: "m8-run",
      flowPlanPath: "project-store/current-flow-plan",
      uiSpecRevision: 1,
      flowPlanRevision: 1,
      savedUISpecRevision: 2,
      figmaInteractionSource: "present",
    },
    actions: {
      converted: [
        {
          interactionId: "figma-submit-review",
          actionId: "flow-figma-submit-review",
          intent: "submit",
          trusted: true,
          source: "figma",
        },
      ],
      rejected: [],
    },
    behaviors: {
      fixtures: [
        {
          fixtureId: "flow-figma-submit-review-fixture",
          source: "flow_plan",
          intent: "submit",
          submit: true,
          stateMachineTransition: true,
          selectRadioAssertionCount: 0,
        },
      ],
    },
    counts: {
      trustedSubmitConverted: 1,
      userConfirmedConverted: 0,
      stateMachineTransitions: 1,
      selectRadioAssertions: 2,
      scenarioOnlyFixtures: 0,
      unresolved: 0,
    },
    validation: {
      schemaVersion: "1",
      runId: "m8-run",
      previewUrl: "http://127.0.0.1:4173/",
      passed: true,
      resultCount: 1,
      failedCheckCount: 0,
      successfulFixtureIds: ["flow-figma-submit-review-fixture"],
      failedFixtureIds: [],
    },
    reasons: [],
    residualRisks: ["fixture"],
  };
}

describe("Flow-M8 report", () => {
  it("接受包含可信 submit 和成功 fixture 的 passed 报告", () => {
    expect(parseFlowM8FormSubmitStateMachineReport(baseReport())).toMatchObject({
      milestone: "Flow-M8",
      scope: "form_submit_state_machine",
      status: "passed",
      counts: {
        trustedSubmitConverted: 1,
      },
    });
  });

  it("拒绝 scenario-only passed 报告", () => {
    const invalid = baseReport() as any;
    invalid.actions.converted = [];
    invalid.behaviors.fixtures = [
      {
        fixtureId: "m8-select-plan",
        source: "scenario",
        selectRadioAssertionCount: 2,
      },
    ];
    invalid.counts.trustedSubmitConverted = 0;
    invalid.counts.stateMachineTransitions = 0;
    invalid.counts.scenarioOnlyFixtures = 1;
    invalid.validation.successfulFixtureIds = ["m8-select-plan"];

    expect(() => parseFlowM8FormSubmitStateMachineReport(invalid)).toThrow(
      /可信 submit/,
    );
  });

  it("从 RenderAndCompare 输出汇总 fixture 成功和失败", () => {
    const summary = summarizeFlowM8Validation({
      schemaVersion: "1",
      runId: "m8-run",
      previewUrl: "http://127.0.0.1:4173/",
      passed: false,
      results: [
        {
          checks: [
            {
              passed: true,
              message: "fixture-a:click",
            },
            {
              passed: false,
              message: "fixture-b:expect_selected 未通过",
            },
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      failedCheckCount: 1,
      successfulFixtureIds: ["fixture-a"],
      failedFixtureIds: ["fixture-b"],
    });
  });
});
