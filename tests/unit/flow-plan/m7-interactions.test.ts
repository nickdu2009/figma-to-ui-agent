import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applyFlowM7InteractiveBehaviorToUISpec } from "../../../src/flow-plan/m7-interactions.ts";
import {
  parseFlowM7BehaviorScenario,
} from "../../../src/flow-plan/m7-scenario.ts";
import {
  flowPlanDraftSchema,
  type FlowPlanDraft,
} from "../../../src/flow-plan/schema.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";

async function loadJson(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(resolve("tests/fixtures/flow-plan", name), "utf8"),
  );
}

async function loadBase() {
  return {
    uiSpec: uiSpecDraftSchema.parse(
      await loadJson("m7-interactive-ui-spec.json"),
    ),
    flowPlan: flowPlanDraftSchema.parse(
      await loadJson("m7-interactive-flow.json"),
    ),
    scenario: parseFlowM7BehaviorScenario(
      await loadJson("m7-interactive-scenario.json"),
    ),
  };
}

describe("Flow-M7 interaction executor", () => {
  it("转换可信非 route interaction，附加 scenario fixture，并拒绝 inferred", async () => {
    const { uiSpec, flowPlan, scenario } = await loadBase();
    const result = applyFlowM7InteractiveBehaviorToUISpec(
      uiSpec,
      flowPlan,
      scenario,
    );

    expect(result.trustedNonRouteConvertedCount).toBe(3);
    expect(result.convertedActions.map((item) => item.intent)).toEqual([
      "set_state",
      "open_dialog",
      "set_state",
    ]);
    expect(result.scenarioOnlyFixtureIds).toEqual([
      "m7-form-fill",
      "m7-form-toggle",
      "m7-submit-like",
    ]);
    expect(result.rejectedInteractions.map((item) => item.id)).toEqual([
      "inferred-missing",
    ]);
    expect(
      result.uiSpec.actions.find(
        (action) => action.id === "flow-figma-submit",
      ),
    ).toMatchObject({
      kind: "set_state",
      stateKey: "submitted",
      value: true,
    });
  });

  it("scenario-only 不满足 passed 所需的可信非 route 转换", async () => {
    const { uiSpec } = await loadBase();
    const scenario = parseFlowM7BehaviorScenario(
      await loadJson("m7-scenario-only.json"),
    );
    const flowPlan: FlowPlanDraft = {
      schemaVersion: "1",
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
      ],
      interactions: [],
      confirmationQuestions: [],
      confirmations: [],
      report: {
        unsupportedCount: 0,
        unresolvedInteractionCount: 0,
        convertedActionCount: 0,
        behaviorFixtureCount: 0,
        confirmationCount: 0,
      },
    };

    const result = applyFlowM7InteractiveBehaviorToUISpec(
      uiSpec,
      flowPlan,
      scenario,
    );

    expect(result.trustedNonRouteConvertedCount).toBe(0);
    expect(result.reasons).toContain(
      "flow_m7_scenario_only_not_sufficient",
    );
  });

  it("拒绝 submit-like 静态可见性断言", async () => {
    const { uiSpec, flowPlan } = await loadBase();
    const scenario = parseFlowM7BehaviorScenario(
      await loadJson("m7-invalid-submit-like.json"),
    );

    expect(() =>
      applyFlowM7InteractiveBehaviorToUISpec(uiSpec, flowPlan, scenario),
    ).toThrow(/flow_m7_submit_static_expectation/);
  });
});
