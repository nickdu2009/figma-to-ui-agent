import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applyFlowM8FormSubmitStateMachineToUISpec } from "../../../src/flow-plan/m8-planner.ts";
import { parseFlowM8BehaviorScenario } from "../../../src/flow-plan/m8-scenario.ts";
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
    scenario: parseFlowM8BehaviorScenario(await loadJson("scenario.json")),
  };
}

describe("Flow-M8 planner", () => {
  it("转换可信 submit、用户确认 submit、状态机 transition 和选择控件场景", async () => {
    const { uiSpec, flowPlan, scenario } = await loadBase();
    const result = applyFlowM8FormSubmitStateMachineToUISpec(
      uiSpec,
      flowPlan,
      scenario,
    );

    expect(result.trustedSubmitConvertedCount).toBe(2);
    expect(result.userConfirmedConvertedCount).toBe(1);
    expect(result.stateMachineTransitionCount).toBe(2);
    expect(result.selectRadioAssertionCount).toBe(4);
    expect(result.scenarioOnlyFixtureIds).toEqual([
      "m8-fill-email",
      "m8-select-plan",
      "m8-radio-role",
    ]);
    expect(result.rejectedInteractions.map((item) => item.id)).toEqual([
      "inferred-submit",
    ]);
    expect(
      result.uiSpec.actions.find(
        (action) => action.id === "flow-figma-submit-review",
      ),
    ).toMatchObject({
      kind: "submit",
      effect: {
        kind: "set_state",
        stateKey: "form-status",
        value: "review",
      },
    });
  });

  it("scenario-only 不满足 Flow-M8 passed 的可信 submit 或双 transition 条件", async () => {
    const { uiSpec } = await loadBase();
    const scenario = parseFlowM8BehaviorScenario(
      await loadJson("scenario-only.json"),
    );
    const flowPlan = flowPlanDraftSchema.parse({
      schemaVersion: "1",
      projectId: "demo-project",
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
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
    });

    const result = applyFlowM8FormSubmitStateMachineToUISpec(
      uiSpec,
      flowPlan,
      scenario,
    );

    expect(result.trustedSubmitConvertedCount).toBe(0);
    expect(result.stateMachineTransitionCount).toBe(0);
    expect(result.reasons).toContain(
      "flow_m8_scenario_only_not_sufficient",
    );
  });

  it("拒绝 postcondition 悬空的用户确认 submit", async () => {
    const { uiSpec, flowPlan } = await loadBase();
    const broken = structuredClone(flowPlan);
    broken.interactions[1] = {
      ...broken.interactions[1]!,
      postconditions: [
        {
          kind: "expect_visible",
          nodeId: "missing-node",
        },
      ],
    };

    const result = applyFlowM8FormSubmitStateMachineToUISpec(
      uiSpec,
      broken,
    );

    expect(result.convertedActions.map((action) => action.interactionId)).not.toContain(
      "user-confirmed-finish",
    );
    expect(result.rejectedInteractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "user-confirmed-finish",
          blockedReason: "submit_postcondition_not_verifiable",
        }),
      ]),
    );
  });
});
