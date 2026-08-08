import { describe, expect, it } from "vitest";

import { generateFlowM10ConfirmationQuestions } from "../../../src/flow-plan/m10-confirmation-questions.ts";
import type { FlowM9RestrictedLiveExtractionReport } from "../../../src/flow-plan/m9-report.ts";
import { flowPlanDraftSchema } from "../../../src/flow-plan/schema.ts";

const flowPlan = flowPlanDraftSchema.parse({
  schemaVersion: "1",
  projectId: "demo-project",
  sourceDesignBundleRevision: 1,
  figmaInteractionSource: "absent",
  pages: [
    {
      id: "home",
      sourcePageId: "page-home",
      name: "登录",
      role: "entry",
      confidence: "high",
      reason: "fixture",
    },
  ],
  interactions: [
    {
      id: "missing-login-submit",
      source: "missing",
      uiNodeId: "submit-review",
      sourceNodeName: "Log In",
      trigger: "submit",
      intent: "unknown",
      fromPageId: "home",
      confirmed: false,
      confidence: "low",
      reason: "requires confirmation",
      blockedReason: "interaction_target_missing",
    },
    {
      id: "figma-trusted-state",
      source: "figma",
      uiNodeId: "switch",
      trigger: "click",
      intent: "set_state",
      stateKey: "enabled",
      value: true,
      targetNodeId: "enabled-panel",
      confirmed: true,
      confidence: "high",
      reason: "trusted",
    },
  ],
  confirmationQuestions: [],
  confirmations: [],
  stateMachines: [],
  report: {
    unsupportedCount: 1,
    unresolvedInteractionCount: 1,
    convertedActionCount: 0,
    behaviorFixtureCount: 0,
    confirmationCount: 0,
  },
});

const m9Report = {
  schemaVersion: "1",
  milestone: "Flow-M9",
  scope: "restricted_live_interaction_extraction",
  status: "passed",
  input: {
    runId: "flow-m9",
    sampleManifestRef: "tests/fixtures/figma/community-sample-manifest.json",
    sampleIds: ["community-login-001", "a", "b"],
    networkBoundary: {
      figmaRestCalled: true,
      openaiCalled: false,
      mode: "restricted-live",
    },
  },
  samples: [
    {
      sampleId: "community-login-001",
      category: "login-register",
      expectedViewport: "mobile",
      accessStatus: "readable",
      interactionSource: "absent",
      counts: {
        prototypeInteractionCount: 0,
        flowPlanInteractionCount: 1,
        trustedNavigate: 0,
        trustedStateChange: 0,
        submitLikeNeedsConfirmation: 1,
        unsupported: 0,
        missingEvidence: 1,
      },
      classifications: [
        {
          classification: "needs_confirmation.submit_like",
          interactionId: "missing-real-submit",
          intent: "unknown",
          sourceNodeName: "Log In",
          blockedReason: "interaction_target_missing",
          evidence: "真实样本文案暗示提交，但缺少 postcondition。",
        },
        {
          classification: "missing_evidence",
          evidence: "no prototype interactions",
        },
      ],
      blockedReasons: ["interaction_target_missing"],
      artifactRefs: {
        flowPlanPath: "ephemeral-flow-plan",
      },
    },
    {
      sampleId: "a",
      category: "mobile",
      expectedViewport: "mobile",
      accessStatus: "readable",
      interactionSource: "present",
      counts: {
        prototypeInteractionCount: 1,
        flowPlanInteractionCount: 1,
        trustedNavigate: 0,
        trustedStateChange: 1,
        submitLikeNeedsConfirmation: 0,
        unsupported: 0,
        missingEvidence: 0,
      },
      classifications: [
        {
          classification: "trusted.set_state",
          interactionId: "trusted-a",
          intent: "set_state",
          evidence: "trusted",
        },
      ],
      blockedReasons: [],
      artifactRefs: {},
    },
    {
      sampleId: "b",
      category: "mobile",
      expectedViewport: "mobile",
      accessStatus: "readable",
      interactionSource: "present",
      counts: {
        prototypeInteractionCount: 1,
        flowPlanInteractionCount: 1,
        trustedNavigate: 0,
        trustedStateChange: 0,
        submitLikeNeedsConfirmation: 0,
        unsupported: 1,
        missingEvidence: 0,
      },
      classifications: [
        {
          classification: "unsupported",
          interactionId: "unsupported-b",
          evidence: "unsupported",
        },
      ],
      blockedReasons: ["unsupported"],
      artifactRefs: {},
    },
  ],
  aggregate: {
    totalSamples: 3,
    readableSamples: 3,
    trustedNavigate: 0,
    trustedStateChange: 1,
    submitLikeNeedsConfirmation: 1,
    unsupported: 1,
    missingEvidence: 1,
    notAccessible: 0,
  },
  reasons: [],
  residualRisks: ["fixture"],
} satisfies FlowM9RestrictedLiveExtractionReport;

describe("Flow-M10 question generator", () => {
  it("从 FlowPlan 和 M9 summary 生成结构化问题，不重复可信 figma interaction", () => {
    const questions = generateFlowM10ConfirmationQuestions({
      flowPlan,
      m9Report,
    });

    expect(questions.map((question) => question.id)).toEqual([
      "m10-missing-login-submit",
      "m10-community-login-001-missing-real-submit",
    ]);
    expect(questions[0]).toMatchObject({
      questionKind: "submit_like",
      applyCarrier: "flow_plan",
      allowedAnswerKinds: expect.arrayContaining(["submit", "decline"]),
    });
    expect(questions[1]).toMatchObject({
      sampleId: "community-login-001",
      applyCarrier: "summary_only",
    });
  });
});
