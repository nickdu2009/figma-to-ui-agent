import { describe, expect, it } from "vitest";

import { buildFlowPlanDraft } from "../../../src/flow-plan/interaction-candidates.ts";
import {
  createStoredMultipageFlowDesignBundle,
  createStoredMultipageFlowUISpec,
} from "../../fixtures/flow-plan/multipage-flow.ts";
import { createInteractionSupplement } from "../../fixtures/flow-plan/interaction-supplement.ts";

describe("buildFlowPlanDraft", () => {
  it("把 supplement 中的 Figma interaction 归类为已确认 navigate", () => {
    const draft = buildFlowPlanDraft({
      bundle: createStoredMultipageFlowDesignBundle(),
      uiSpec: createStoredMultipageFlowUISpec(),
      interactionSupplement: createInteractionSupplement(),
    });

    expect(draft.interactions).toHaveLength(2);
    expect(draft.interactions.find((item) => item.source === "figma")).toMatchObject({
      source: "figma",
      confirmed: true,
      intent: "navigate",
      fromPageId: "home",
      targetPageId: "quote",
      uiNodeId: "continue",
    });
    expect(draft.interactions.find((item) => item.source === "missing")).toMatchObject({
      uiNodeId: "mystery",
      confirmed: false,
      blockedReason: "interaction_target_missing",
    });
  });

  it("没有 supplement 时只生成 inferred/missing，不直接确认", () => {
    const draft = buildFlowPlanDraft({
      bundle: createStoredMultipageFlowDesignBundle(),
      uiSpec: createStoredMultipageFlowUISpec(),
    });

    expect(draft.interactions.find((item) => item.source === "inferred")).toMatchObject({
      source: "inferred",
      confirmed: false,
      targetPageId: "quote",
    });
    expect(draft.interactions.find((item) => item.source === "missing")).toMatchObject({
      source: "missing",
      confirmed: false,
      uiNodeId: "mystery",
    });
    expect(draft.report.unresolvedInteractionCount).toBe(2);
  });
});
