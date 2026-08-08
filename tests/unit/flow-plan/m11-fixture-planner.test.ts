import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadFlowM11Artifact } from "../../../src/flow-plan/m11-artifact-loader.ts";
import { planFlowM11BehaviorFixtures } from "../../../src/flow-plan/m11-fixture-planner.ts";
import { flowPlanDraftSchema } from "../../../src/flow-plan/schema.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";

async function loadJson(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      resolve("tests/fixtures/flow-plan/m8-form-submit-state-machine", name),
      "utf8",
    ),
  );
}

async function loadBase() {
  return {
    uiSpec: uiSpecDraftSchema.parse(await loadJson("ui-spec.json")),
    flowPlan: flowPlanDraftSchema.parse(await loadJson("flow-plan.json")),
  };
}

describe("Flow-M11 fixture planner", () => {
  it("从可信 FlowPlan artifact 生成 fill/select/radio/toggle + submit + postcondition 多步骤 fixture", async () => {
    const { uiSpec, flowPlan } = await loadBase();
    const artifact = await loadFlowM11Artifact({
      artifactRef: "flow-plan.json",
      rawFlowPlan: flowPlan,
      uiSpec,
    });

    const result = planFlowM11BehaviorFixtures({ artifact, uiSpec });

    expect(result.status).toBe("partial");
    expect(result.reasons).toEqual(["flow_plan_untrusted_source"]);
    expect(result.trustedSubmitFixtureCount).toBe(2);
    expect(result.multiStepSubmitFixtureCount).toBe(2);
    expect(result.selectRadioToggleStepCount).toBeGreaterThanOrEqual(3);
    expect(result.artifactRejections).toEqual([
      expect.objectContaining({
        reasonCode: "flow_plan_untrusted_source",
        interactionId: "inferred-submit",
      }),
    ]);

    const submitFixture = result.uiSpec.behaviorFixtures.find(
      (fixture) => fixture.id === "flow-figma-submit-review-fixture",
    );
    expect(submitFixture?.steps).toEqual([
      { kind: "fill", nodeId: "email", value: "flow-m11@example.com" },
      { kind: "expect_value", nodeId: "email", value: "flow-m11@example.com" },
      { kind: "select_option", nodeId: "plan-select", value: "basic" },
      { kind: "expect_selected", nodeId: "plan-select", value: "basic" },
      { kind: "choose_radio", nodeId: "role-admin", value: "admin" },
      { kind: "expect_selected", nodeId: "role-admin", value: "admin" },
      { kind: "toggle", nodeId: "terms" },
      { kind: "expect_checked", nodeId: "terms", checked: true },
      { kind: "click", nodeId: "submit-review" },
      { kind: "expect_visible", nodeId: "review-text" },
    ]);
  });

  it("对无可信可执行 artifact 返回 failed，不生成 passed fixture", async () => {
    const { uiSpec } = await loadBase();
    const artifact = await loadFlowM11Artifact({
      artifactRef: "ephemeral-flow-plan",
      uiSpec,
    });

    const result = planFlowM11BehaviorFixtures({ artifact, uiSpec });

    expect(result.status).toBe("failed");
    expect(result.executableFixtureIds).toEqual([]);
    expect(result.reasons).toEqual(["flow_m11_artifact_rejected"]);
  });

  it("postcondition 悬空时不生成可执行 fixture", async () => {
    const { uiSpec, flowPlan } = await loadBase();
    const broken = flowPlanDraftSchema.parse({
      ...flowPlan,
      interactions: [
        {
          ...flowPlan.interactions[0]!,
          postconditions: [{ kind: "expect_visible", nodeId: "missing-node" }],
        },
        ...flowPlan.interactions.slice(1),
      ],
    });
    const artifact = await loadFlowM11Artifact({
      artifactRef: "broken-flow-plan.json",
      rawFlowPlan: broken,
      uiSpec,
    });

    const result = planFlowM11BehaviorFixtures({ artifact, uiSpec });

    expect(result.status).toBe("failed");
    expect(result.executableFixtureIds).toEqual([]);
    expect(result.artifactRejections).toEqual([
      expect.objectContaining({
        reasonCode: "flow_plan_reference_dangling",
        interactionId: "figma-submit-review",
      }),
    ]);
  });
});
