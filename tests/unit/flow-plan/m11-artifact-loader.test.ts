import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadFlowM11Artifact } from "../../../src/flow-plan/m11-artifact-loader.ts";
import { flowPlanDraftSchema } from "../../../src/flow-plan/schema.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";
import { createStoredMultipageFlowUISpec } from "../../fixtures/flow-plan/multipage-flow.ts";

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function loadBase() {
  const flowPlan = flowPlanDraftSchema.parse(
    await loadJson("tests/fixtures/flow-plan/m10-confirmation-semantics/flow-plan.json"),
  );
  const uiSpec = uiSpecDraftSchema.parse(
    await loadJson("tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json"),
  );
  return { flowPlan, uiSpec };
}

async function trustedSubmitFlowPlan() {
  const { flowPlan, uiSpec } = await loadBase();
  return {
    uiSpec,
    flowPlan: flowPlanDraftSchema.parse({
      ...flowPlan,
      interactions: [
        {
          ...flowPlan.interactions[0]!,
          source: "user_confirmed",
          trigger: "submit",
          intent: "submit",
          stateKey: "form-status",
          value: "review",
          postconditions: [{ kind: "expect_visible", nodeId: "review-text" }],
          confirmed: true,
          confidence: "high",
          blockedReason: undefined,
        },
      ],
      report: {
        ...flowPlan.report,
        unsupportedCount: 0,
        unresolvedInteractionCount: 0,
      },
    }),
  };
}

describe("Flow-M11 artifact loader", () => {
  it("加载可读取、可信且引用闭合的 FlowPlan artifact", async () => {
    const { flowPlan, uiSpec } = await trustedSubmitFlowPlan();

    const result = await loadFlowM11Artifact({
      artifactRef: "fixture-flow-plan.json",
      rawFlowPlan: flowPlan,
      uiSpec,
    });

    expect(result).toMatchObject({
      status: "loaded",
      artifactRef: "fixture-flow-plan.json",
      reasonCodes: [],
      rejections: [],
    });
    expect(result.status === "loaded" && result.flowPlan.interactions[0]).toMatchObject({
      id: "missing-login-submit",
      source: "user_confirmed",
      intent: "submit",
    });
  });

  it("拒绝缺失文件和 schema invalid artifact", async () => {
    await expect(
      loadFlowM11Artifact({
        artifactRef: "missing-flow-plan.json",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCodes: ["flow_plan_artifact_missing"],
    });

    await expect(
      loadFlowM11Artifact({
        artifactRef: "broken-flow-plan.json",
        rawFlowPlan: {
          schemaVersion: "1",
          projectId: "demo-project",
        },
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCodes: ["flow_plan_schema_invalid"],
    });
  });

  it("拒绝 summary-only、ephemeral 和 scenario-only 载体", async () => {
    await expect(
      loadFlowM11Artifact({
        artifactRef: "ephemeral-flow-plan",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCodes: ["flow_plan_summary_only_carrier"],
    });

    await expect(
      loadFlowM11Artifact({
        artifactRef: "m9-summary.json",
        carrier: "summary_only",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCodes: ["flow_plan_summary_only_carrier"],
    });

    await expect(
      loadFlowM11Artifact({
        artifactRef: "scenario.json",
        carrier: "scenario_only",
      }),
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCodes: ["flow_plan_scenario_only_carrier"],
    });
  });

  it("拒绝 UISpec 上不可验证的 postcondition 和 state 引用", async () => {
    const { flowPlan, uiSpec } = await trustedSubmitFlowPlan();
    const broken = flowPlanDraftSchema.parse({
      ...flowPlan,
      interactions: [
        {
          ...flowPlan.interactions[0]!,
          stateKey: "missing-state",
          postconditions: [{ kind: "expect_visible", nodeId: "missing-node" }],
        },
      ],
    });

    const result = await loadFlowM11Artifact({
      artifactRef: "broken-refs.json",
      rawFlowPlan: broken,
      uiSpec,
    });

    expect(result).toMatchObject({
      status: "rejected",
      reasonCodes: ["flow_plan_reference_dangling"],
    });
    expect(result.rejections.map((item) => item.field)).toEqual(
      expect.arrayContaining(["stateKey", "postconditions.nodeId"]),
    );
  });

  it("允许可信 set_state 的 stateKey 交给 UISpec hydration 创建", async () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const flowPlan = flowPlanDraftSchema.parse({
      schemaVersion: "1",
      projectId: "demo-project",
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
      figmaInteractionSource: "present",
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
      interactions: [
        {
          id: "figma-change-to-variant",
          source: "figma",
          uiNodeId: "continue",
          trigger: "click",
          intent: "set_state",
          fromPageId: "home",
          stateKey: "variant-continue-state",
          value: "selected",
          targetNodeId: "quote-title",
          confirmed: true,
          confidence: "high",
          reason: "fixture trusted CHANGE_TO",
        },
      ],
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

    const result = await loadFlowM11Artifact({
      artifactRef: "set-state-hydratable.json",
      rawFlowPlan: flowPlan,
      uiSpec,
    });

    expect(result).toMatchObject({
      status: "loaded",
      reasonCodes: [],
      rejections: [],
    });
  });

  it("对混合可信和不可信 interaction 返回 partial 并保留可信 artifact", async () => {
    const { flowPlan, uiSpec } = await trustedSubmitFlowPlan();
    const mixed = flowPlanDraftSchema.parse({
      ...flowPlan,
      interactions: [
        ...flowPlan.interactions,
        {
          id: "missing-secondary-submit",
          source: "missing",
          uiNodeId: "finish-submit",
          trigger: "submit",
          intent: "unknown",
          fromPageId: "home",
          confirmed: false,
          confidence: "low",
          reason: "summary-only candidate",
          blockedReason: "interaction_target_missing",
        },
      ],
      report: {
        ...flowPlan.report,
        unsupportedCount: 1,
        unresolvedInteractionCount: 1,
      },
    });

    const result = await loadFlowM11Artifact({
      artifactRef: "mixed-flow-plan.json",
      rawFlowPlan: mixed,
      uiSpec,
    });

    expect(result).toMatchObject({
      status: "partial",
      reasonCodes: ["flow_plan_untrusted_source"],
    });
    expect(result.status === "partial" && result.flowPlan.interactions).toHaveLength(2);
    expect(result.rejections).toEqual([
      expect.objectContaining({
        interactionId: "missing-secondary-submit",
        reasonCode: "flow_plan_untrusted_source",
      }),
    ]);
  });
});
