import { describe, expect, it } from "vitest";

import {
  applyFlowConfirmations,
  buildFlowPlan,
  flowPlanServiceSummary,
  generateFlowConfirmationQuestions,
} from "../../../src/flow-plan/service.ts";
import {
  createStoredMultipageFlowDesignBundle,
  createStoredMultipageFlowUISpec,
} from "../../fixtures/flow-plan/multipage-flow.ts";
import { createInteractionSupplement } from "../../fixtures/flow-plan/interaction-supplement.ts";

describe("正式 FlowPlan service", () => {
  it("无 supplement 时明确记录 absent 并生成待确认问题", () => {
    const flowPlan = generateFlowConfirmationQuestions(
      buildFlowPlan({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );

    expect(flowPlan).toMatchObject({
      schemaVersion: "1",
      projectId: "demo-project",
      figmaInteractionSource: "absent",
    });
    expect(flowPlan.confirmationQuestions).toHaveLength(2);
    expect(
      flowPlan.interactions.every(
        (interaction) =>
          !interaction.confirmed ||
          interaction.source === "figma" ||
          interaction.source === "user_confirmed",
      ),
    ).toBe(true);
  });

  it("有 supplement 时生成可信 figma interaction", () => {
    const flowPlan = buildFlowPlan({
      bundle: createStoredMultipageFlowDesignBundle(),
      uiSpec: createStoredMultipageFlowUISpec(),
      interactionSupplement: createInteractionSupplement(),
    });

    expect(flowPlan.figmaInteractionSource).toBe("present");
    expect(flowPlan.interactions).toContainEqual(
      expect.objectContaining({
        id: "figma-continue-to-quote",
        source: "figma",
        confirmed: true,
        intent: "navigate",
        uiNodeId: "continue",
        targetPageId: "quote",
      }),
    );
  });

  it("应用合法确认后持久化 confirmation 并转为 user_confirmed", () => {
    const flowPlan = generateFlowConfirmationQuestions(
      buildFlowPlan({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const next = applyFlowConfirmations(
      flowPlan,
      [
        {
          questionId: flowPlan.confirmationQuestions[0]!.id,
          value: "target:quote",
          reason: "用户确认",
        },
      ],
      "2026-07-24T10:00:00.000Z",
    );

    expect(next.confirmations).toContainEqual(
      expect.objectContaining({
        questionId: flowPlan.confirmationQuestions[0]!.id,
        value: "target:quote",
        result: "applied",
        appliedAt: "2026-07-24T10:00:00.000Z",
      }),
    );
    expect(next.interactions).toContainEqual(
      expect.objectContaining({
        source: "user_confirmed",
        confirmed: true,
      }),
    );
    expect(flowPlanServiceSummary(next)).toMatchObject({
      flowPlanSummary: {
        confirmationCount: 1,
        bySource: expect.objectContaining({
          user_confirmed: 1,
        }),
      },
      unresolvedInteractionCount: 1,
    });
  });

  it("非法确认会记录 invalid 且不生成 trusted interaction", () => {
    const flowPlan = generateFlowConfirmationQuestions(
      buildFlowPlan({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const next = applyFlowConfirmations(flowPlan, [
      {
        questionId: flowPlan.confirmationQuestions[0]!.id,
        value: "target:missing-page",
      },
    ]);

    expect(next.confirmations).toContainEqual(
      expect.objectContaining({
        questionId: flowPlan.confirmationQuestions[0]!.id,
        value: "target:missing-page",
        result: "invalid",
      }),
    );
    expect(
      next.interactions.some(
        (interaction) =>
          interaction.source === "user_confirmed" &&
          interaction.confirmed,
      ),
    ).toBe(false);
    expect(next.report.unresolvedInteractionCount).toBeGreaterThan(0);
  });
});
