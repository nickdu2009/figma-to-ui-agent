import { describe, expect, it } from "vitest";

import {
  parseFlowM7InteractiveBehaviorReport,
  summarizeFlowM7Validation,
} from "../../../src/flow-plan/m7-report.ts";

function baseReport() {
  return {
    schemaVersion: "1",
    milestone: "Flow-M7",
    scope: "interactive_behavior",
    status: "passed",
    input: {
      projectId: "demo-project",
      runId: "m7-run",
      flowPlanPath: "project-store/current-flow-plan",
      uiSpecRevision: 1,
      flowPlanRevision: 1,
      savedUISpecRevision: 2,
      figmaInteractionSource: "present",
    },
    actions: {
      converted: [
        {
          interactionId: "figma-open-dialog",
          actionId: "flow-figma-open-dialog",
          intent: "open_dialog",
          trusted: true,
        },
      ],
      rejected: [],
    },
    behaviors: {
      fixtures: [
        {
          fixtureId: "flow-figma-open-dialog-fixture",
          source: "flow_plan",
          intent: "open_dialog",
        },
      ],
    },
    counts: {
      trustedNonRouteConverted: 1,
      scenarioOnlyFixtures: 0,
      submitLikeVerified: 0,
      unresolved: 0,
    },
    validation: {
      schemaVersion: "1",
      runId: "m7-run",
      previewUrl: "http://127.0.0.1:4173/",
      passed: true,
      resultCount: 1,
      failedCheckCount: 0,
      successfulFixtureIds: ["flow-figma-open-dialog-fixture"],
      failedFixtureIds: [],
    },
    reasons: [],
    residualRisks: ["fixture"],
  };
}

describe("Flow-M7 report", () => {
  it("接受包含可信非 route 转换和成功 fixture 的 passed 报告", () => {
    expect(parseFlowM7InteractiveBehaviorReport(baseReport())).toMatchObject({
      milestone: "Flow-M7",
      scope: "interactive_behavior",
      status: "passed",
      counts: {
        trustedNonRouteConverted: 1,
      },
    });
  });

  it("拒绝 scenario-only passed 报告", () => {
    const invalid = baseReport();
    invalid.actions.converted = [];
    invalid.behaviors.fixtures = [
      {
        fixtureId: "m7-form-fill",
        source: "scenario",
        intent: "set_state",
      },
    ];
    invalid.counts.trustedNonRouteConverted = 0;
    invalid.counts.scenarioOnlyFixtures = 1;
    invalid.validation.successfulFixtureIds = ["m7-form-fill"];

    expect(() => parseFlowM7InteractiveBehaviorReport(invalid)).toThrow(
      /可信非 navigate/,
    );
  });

  it("从 RenderAndCompare 输出汇总 fixture 成功和失败", () => {
    const summary = summarizeFlowM7Validation({
      schemaVersion: "1",
      runId: "m7-run",
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
              message: "fixture-b:expect_value 未通过",
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
