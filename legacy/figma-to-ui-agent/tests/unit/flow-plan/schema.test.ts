import { describe, expect, it } from "vitest";

import {
  FLOW_PLAN_SCHEMA_VERSION,
  parseFlowPlan,
  parseFlowPlanDraft,
  recomputeFlowPlanReport,
  summarizeFlowPlan,
} from "../../../src/flow-plan/schema.ts";

function createFlowPlanDraft() {
  return {
    schemaVersion: FLOW_PLAN_SCHEMA_VERSION,
    projectId: "demo-project",
    sourceDesignBundleRevision: 1,
    sourceUISpecRevision: 1,
    figmaInteractionSource: "absent",
    pages: [
      {
        id: "home",
        sourcePageId: "page-home",
        name: "首页",
        role: "entry",
        confidence: "high",
        reason: "fixture",
      },
      {
        id: "quote",
        sourcePageId: "page-quote",
        name: "报价",
        role: "screen",
        confidence: "medium",
        reason: "fixture",
      },
    ],
    interactions: [
      {
        id: "continue-to-quote",
        source: "user_confirmed",
        uiNodeId: "continue",
        trigger: "click",
        intent: "navigate",
        fromPageId: "home",
        targetPageId: "quote",
        confirmationQuestionId: "confirm-continue",
        confirmed: true,
        confidence: "high",
        reason: "用户确认继续按钮跳转报价页",
      },
    ],
    confirmationQuestions: [
      {
        id: "confirm-continue",
        interactionId: "continue-to-quote",
        question: "继续按钮是否跳转报价页？",
        options: [
          { label: "跳转报价页", value: "target:quote" },
          { label: "保持静态", value: "static" },
        ],
        required: true,
      },
    ],
    confirmations: [
      {
        questionId: "confirm-continue",
        value: "target:quote",
        appliedAt: "2026-07-24T10:00:00.000Z",
        result: "applied",
      },
    ],
    report: {
      unsupportedCount: 0,
      unresolvedInteractionCount: 0,
      convertedActionCount: 1,
      behaviorFixtureCount: 1,
      confirmationCount: 1,
    },
  } as const;
}

describe("正式 FlowPlan schema", () => {
  it("接受正式 draft/stored FlowPlan 并生成摘要", () => {
    const draft = parseFlowPlanDraft(createFlowPlanDraft());
    const stored = parseFlowPlan({
      ...draft,
      revision: 1,
    });

    expect(draft.schemaVersion).toBe("1");
    expect(stored.revision).toBe(1);
    expect(summarizeFlowPlan(stored)).toMatchObject({
      interactionCount: 1,
      confirmationQuestionCount: 1,
      confirmationCount: 1,
      bySource: {
        figma: 0,
        inferred: 0,
        user_confirmed: 1,
        missing: 0,
      },
    });
  });

  it("拒绝 spike schemaVersion 和未知枚举值", () => {
    const draft = createFlowPlanDraft();

    expect(() =>
      parseFlowPlanDraft({
        ...draft,
        schemaVersion: "m4-spike",
      }),
    ).toThrow();
    expect(() =>
      parseFlowPlanDraft({
        ...draft,
        figmaInteractionSource: "desktop_mcp",
      }),
    ).toThrow();
    expect(() =>
      parseFlowPlanDraft({
        ...draft,
        interactions: [
          {
            ...draft.interactions[0],
            source: "prototype",
          },
        ],
      }),
    ).toThrow();
  });

  it("inferred/missing interaction 必须 fail closed", () => {
    const draft = createFlowPlanDraft();

    expect(() =>
      parseFlowPlanDraft({
        ...draft,
        interactions: [
          {
            ...draft.interactions[0],
            source: "inferred",
            confirmed: true,
          },
        ],
      }),
    ).toThrow("inferred/missing interaction 不能被标记为已确认");
  });

  it("校验悬空引用并重算 report", () => {
    const draft = createFlowPlanDraft();
    expect(() =>
      parseFlowPlanDraft({
        ...draft,
        confirmations: [
          {
            questionId: "missing-question",
            value: "target:quote",
            result: "applied",
          },
        ],
      }),
    ).toThrow("悬空确认问题引用");

    expect(
      recomputeFlowPlanReport({
        ...draft,
        interactions: [
          {
            ...draft.interactions[0],
            source: "missing",
            confirmed: false,
            blockedReason: "prototype_absent",
          },
        ],
        confirmations: [],
      }),
    ).toMatchObject({
      unsupportedCount: 0,
      unresolvedInteractionCount: 1,
      confirmationCount: 0,
    });
  });

  it("支持 Flow-M8 submit interaction 和本地状态机", () => {
    const draft = createFlowPlanDraft();
    const parsed = parseFlowPlanDraft({
      ...draft,
      interactions: [
        {
          id: "submit-review",
          source: "figma",
          uiNodeId: "submit-button",
          trigger: "submit",
          intent: "submit",
          fromPageId: "home",
          stateKey: "status",
          value: "review",
          stateMachineTransitionId: "transition-review",
          postconditions: [
            {
              kind: "expect_visible",
              nodeId: "review-text",
            },
          ],
          confirmed: true,
          confidence: "high",
          reason: "fixture",
        },
      ],
      confirmationQuestions: [],
      confirmations: [],
      stateMachines: [
        {
          id: "login-flow",
          initialState: "idle",
          states: [
            { id: "idle", pageId: "home" },
            { id: "review", pageId: "home", visibleNodeIds: ["review-text"] },
          ],
          transitions: [
            {
              id: "transition-review",
              from: "idle",
              to: "review",
              triggerInteractionId: "submit-review",
              postconditions: [
                {
                  kind: "expect_visible",
                  nodeId: "review-text",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.interactions[0]).toMatchObject({
      intent: "submit",
      postconditions: [{ kind: "expect_visible", nodeId: "review-text" }],
    });
    expect(parsed.stateMachines).toHaveLength(1);
  });

  it("拒绝缺少 postcondition 的 Flow-M8 submit interaction", () => {
    const draft = createFlowPlanDraft();

    expect(() =>
      parseFlowPlanDraft({
        ...draft,
        interactions: [
          {
            id: "submit-review",
            source: "figma",
            uiNodeId: "submit-button",
            trigger: "submit",
            intent: "submit",
            fromPageId: "home",
            confirmed: true,
            confidence: "high",
            reason: "fixture",
          },
        ],
        confirmationQuestions: [],
        confirmations: [],
      }),
    ).toThrow("submit interaction 必须包含可观察 postcondition");
  });
});
