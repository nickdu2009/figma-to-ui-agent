import { describe, expect, it } from "vitest";

import {
  FLOW_PLAN_DRAFT_SCHEMA_VERSION,
  parseFlowPlanDraft,
  summarizeFlowPlanDraft,
} from "../../../src/flow-plan/draft.ts";

describe("FlowPlanDraft spike schema", () => {
  it("接受四类 interaction source 并保持未确认项", () => {
    const draft = parseFlowPlanDraft({
      schemaVersion: FLOW_PLAN_DRAFT_SCHEMA_VERSION,
      projectId: "demo-project",
      sourceDesignBundleRevision: 1,
      pages: [
        {
          id: "home",
          sourcePageId: "page-home",
          name: "首页",
          role: "entry",
          confidence: "medium",
          reason: "fixture",
        },
      ],
      interactions: [
        {
          id: "figma",
          source: "figma",
          intent: "navigate",
          confirmed: true,
          confidence: "high",
          reason: "fixture",
        },
        {
          id: "inferred",
          source: "inferred",
          intent: "navigate",
          confirmed: false,
          confidence: "low",
          reason: "fixture",
        },
        {
          id: "confirmed",
          source: "user_confirmed",
          intent: "navigate",
          confirmed: true,
          confidence: "medium",
          reason: "fixture",
        },
        {
          id: "missing",
          source: "missing",
          intent: "unknown",
          confirmed: false,
          confidence: "low",
          reason: "fixture",
        },
      ],
      confirmationQuestions: [],
      report: {
        unsupportedCount: 1,
        unresolvedInteractionCount: 2,
        convertedActionCount: 0,
        behaviorFixtureCount: 0,
      },
    });

    expect(summarizeFlowPlanDraft(draft).bySource).toEqual({
      figma: 1,
      inferred: 1,
      user_confirmed: 1,
      missing: 1,
    });
  });
});
