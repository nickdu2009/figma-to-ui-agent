import { describe, expect, it } from "vitest";

import type { FlowM11ArtifactLoadResult } from "../../../src/flow-plan/m11-artifact-loader.ts";
import type { FlowM11PlannerResult } from "../../../src/flow-plan/m11-fixture-planner.ts";
import {
  buildFlowM11ExecutionReport,
  flowM11ExecutionReportSchema,
  redactionCheckFlowM11Report,
} from "../../../src/flow-plan/m11-report.ts";
import { createUISpecDraft } from "../../fixtures/contracts.ts";

function artifact(): FlowM11ArtifactLoadResult {
  return {
    status: "partial",
    artifactRef: "tests/fixtures/flow-plan/m11/flow-plan.json",
    flowPlan: {
      schemaVersion: "1",
      projectId: "demo-project",
      sourceDesignBundleRevision: 1,
      figmaInteractionSource: "present",
      pages: [],
      interactions: [],
      confirmationQuestions: [],
      confirmations: [],
      stateMachines: [],
      report: {
        unsupportedCount: 0,
        unresolvedInteractionCount: 0,
        convertedActionCount: 0,
        behaviorFixtureCount: 0,
        confirmationCount: 0,
      },
    },
    reasonCodes: ["flow_plan_untrusted_source"],
    rejections: [
      {
        reasonCode: "flow_plan_untrusted_source",
        message: "negative fixture",
        interactionId: "inferred-submit",
      },
    ],
  };
}

function planner(): FlowM11PlannerResult {
  const uiSpec = createUISpecDraft();
  uiSpec.behaviorFixtures = [
    {
      id: "flow-submit-fixture",
      name: "submit",
      viewportId: "desktop",
      initialPageId: "home",
      steps: [
        { kind: "fill", nodeId: "email", value: "flow-m11@example.com" },
        { kind: "expect_value", nodeId: "email", value: "flow-m11@example.com" },
        { kind: "select_option", nodeId: "plan", value: "pro" },
        { kind: "expect_selected", nodeId: "plan", value: "pro" },
        { kind: "click", nodeId: "submit" },
        { kind: "expect_visible", nodeId: "review-text" },
      ],
    },
  ];
  return {
    status: "partial",
    uiSpec,
    behaviorFixtures: [
      {
        fixtureId: "flow-submit-fixture",
        interactionId: "submit",
        intent: "submit",
        source: "figma",
        submit: true,
        inputStepCount: 1,
        selectRadioToggleStepCount: 1,
        postconditionStepCount: 3,
      },
    ],
    executableFixtureIds: ["flow-submit-fixture"],
    rejectedInteractions: [],
    artifactRejections: [],
    unresolvedCount: 0,
    trustedSubmitFixtureCount: 1,
    multiStepSubmitFixtureCount: 1,
    selectRadioToggleStepCount: 1,
    reasons: ["flow_plan_untrusted_source"],
  };
}

describe("Flow-M11 report", () => {
  it("生成 passed 报告并统计负例、fixture 和 pre-satisfied", () => {
    const report = buildFlowM11ExecutionReport({
      runId: "flow-m11-local",
      mode: "local",
      flowPlanRef: "tests/fixtures/flow-plan/m11/flow-plan.json",
      uiSpecRef: "tests/fixtures/flow-plan/m11/ui-spec.json",
      artifact: artifact(),
      planner: planner(),
      validation: {
        schemaVersion: "1",
        runId: "flow-m11-local",
        passed: true,
        resultCount: 1,
        failedCheckCount: 0,
        successfulFixtureIds: ["flow-submit-fixture"],
        failedFixtureIds: [],
        preSatisfiedExpectationCount: 0,
      },
    });

    expect(report.status).toBe("passed");
    expect(report.counts).toMatchObject({
      fixtureCount: 1,
      successfulFixtureCount: 1,
      failedFixtureCount: 0,
      untrustedSourceRejectionCount: 1,
      preSatisfiedExpectationCount: 0,
    });
  });

  it("拒绝计数不一致的报告", () => {
    const report = buildFlowM11ExecutionReport({
      runId: "flow-m11-local",
      mode: "local",
      flowPlanRef: "tests/fixtures/flow-plan/m11/flow-plan.json",
      artifact: artifact(),
      planner: planner(),
      validation: {
        schemaVersion: "1",
        runId: "flow-m11-local",
        passed: true,
        resultCount: 1,
        failedCheckCount: 0,
        successfulFixtureIds: ["flow-submit-fixture"],
        failedFixtureIds: [],
        preSatisfiedExpectationCount: 0,
      },
    });

    expect(() =>
      flowM11ExecutionReportSchema.parse({
        ...report,
        counts: { ...report.counts, fixtureCount: 2 },
      }),
    ).toThrow("fixtureCount");
  });

  it("拒绝敏感字段和绝对路径", () => {
    expect(() =>
      redactionCheckFlowM11Report({
        designUrl: "https://www.figma.com/design/abc?node-id=1-2",
      }),
    ).toThrow("flow_m11_report_redaction_failed:figma_design_url");

    expect(() =>
      redactionCheckFlowM11Report({
        output: "/Users/duxiaobo/workspaces/private/report.json",
      }),
    ).toThrow("flow_m11_report_redaction_failed:absolute_path");

    expect(() =>
      redactionCheckFlowM11Report({
        token: "figd_secret",
      }),
    ).toThrow("flow_m11_report_redaction_failed:figma_token");
  });
});
