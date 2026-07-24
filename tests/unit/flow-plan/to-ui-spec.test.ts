import { describe, expect, it } from "vitest";

import { applyConfirmations } from "../../../src/flow-plan/apply-confirmations.ts";
import { generateConfirmationQuestions } from "../../../src/flow-plan/confirmation-questions.ts";
import { buildFlowPlanDraft } from "../../../src/flow-plan/interaction-candidates.ts";
import { applyFlowPlanToUISpec } from "../../../src/flow-plan/to-ui-spec.ts";
import {
  applyFlowConfirmations,
  buildFlowPlan,
  generateFlowConfirmationQuestions as generateFormalFlowConfirmationQuestions,
} from "../../../src/flow-plan/service.ts";
import {
  createStoredMultipageFlowDesignBundle,
  createStoredMultipageFlowUISpec,
} from "../../fixtures/flow-plan/multipage-flow.ts";
import { createInteractionSupplement } from "../../fixtures/flow-plan/interaction-supplement.ts";

describe("applyFlowPlanToUISpec", () => {
  it("只转换 figma/user_confirmed interaction 为 action 和 behaviorFixture", () => {
    const result = applyFlowPlanToUISpec(
      createStoredMultipageFlowUISpec(),
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
        interactionSupplement: createInteractionSupplement(),
      }),
    );

    expect(result.convertedActionIds).toHaveLength(1);
    expect(result.behaviorFixtureIds).toHaveLength(1);
    expect(result.uiSpec.nodes.find((node) => node.id === "continue")).toMatchObject({
      actionId: result.convertedActionIds[0],
    });
    expect(result.uiSpec.behaviorFixtures[0]!.steps).toEqual([
      { kind: "click", nodeId: "continue" },
      { kind: "expect_page", pageId: "quote" },
    ]);
  });

  it("未确认 inferred interaction 不转换", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const result = applyFlowPlanToUISpec(
      createStoredMultipageFlowUISpec(),
      draft,
    );

    expect(result.convertedActionIds).toEqual([]);
    expect(result.unresolvedInteractions).toHaveLength(2);
  });

  it("用户确认后转换 inferred interaction", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const confirmed = applyConfirmations(draft, [
      {
        questionId: draft.confirmationQuestions[0]!.id,
        value: "target:quote",
      },
    ]);
    const result = applyFlowPlanToUISpec(
      createStoredMultipageFlowUISpec(),
      confirmed,
    );

    expect(result.convertedActionIds).toHaveLength(1);
    expect(result.uiSpec.actions[0]).toMatchObject({
      kind: "navigate",
      pageId: "quote",
    });
  });

  it("转换可验证的 open_dialog interaction", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("open-dialog", "flow-dialog");
    }
    uiSpec.state.push({
      key: "dialog-open",
      valueType: "boolean",
      initialValue: false,
    });
    uiSpec.nodes.push(
      {
        id: "open-dialog",
        kind: "button",
        label: "打开弹窗",
        variant: "secondary",
        designValueRefs: [],
      },
      {
        id: "flow-dialog",
        kind: "dialog",
        title: "确认",
        openStateKey: "dialog-open",
        childIds: ["dialog-title"],
        designValueRefs: [],
      },
      {
        id: "dialog-title",
        kind: "text",
        text: "确认内容",
        variant: "heading",
        designValueRefs: [],
      },
    );

    const result = applyFlowPlanToUISpec(uiSpec, {
      schemaVersion: "m4-spike",
      projectId: "demo-project",
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
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
          id: "open-dialog",
          source: "figma",
          uiNodeId: "open-dialog",
          trigger: "click",
          intent: "open_dialog",
          fromPageId: "home",
          dialogNodeId: "flow-dialog",
          confirmed: true,
          confidence: "high",
          reason: "fixture",
        },
      ],
      confirmationQuestions: [],
      report: {
        unsupportedCount: 0,
        unresolvedInteractionCount: 0,
        convertedActionCount: 0,
        behaviorFixtureCount: 0,
      },
    });

    expect(result.uiSpec.actions[0]).toMatchObject({
      kind: "open_dialog",
      dialogNodeId: "flow-dialog",
    });
    expect(result.uiSpec.behaviorFixtures[0]!.steps).toEqual([
      { kind: "click", nodeId: "open-dialog" },
      { kind: "expect_visible", nodeId: "flow-dialog" },
    ]);
  });

  it("转换可验证的 set_state interaction", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("set-status", "status-text");
    }
    uiSpec.state.push({
      key: "status",
      valueType: "string",
      initialValue: "idle",
    });
    uiSpec.nodes.push(
      {
        id: "set-status",
        kind: "button",
        label: "设置状态",
        variant: "secondary",
        designValueRefs: [],
      },
      {
        id: "status-text",
        kind: "text",
        text: "已选择",
        variant: "body",
        designValueRefs: [],
      },
    );

    const result = applyFlowPlanToUISpec(uiSpec, {
      schemaVersion: "m4-spike",
      projectId: "demo-project",
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
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
          id: "set-status",
          source: "figma",
          uiNodeId: "set-status",
          trigger: "click",
          intent: "set_state",
          fromPageId: "home",
          stateKey: "status",
          value: "selected",
          targetNodeId: "status-text",
          confirmed: true,
          confidence: "high",
          reason: "fixture",
        },
      ],
      confirmationQuestions: [],
      report: {
        unsupportedCount: 0,
        unresolvedInteractionCount: 0,
        convertedActionCount: 0,
        behaviorFixtureCount: 0,
      },
    });

    expect(result.uiSpec.actions[0]).toMatchObject({
      kind: "set_state",
      stateKey: "status",
      value: "selected",
    });
    expect(result.uiSpec.behaviorFixtures[0]!.steps).toEqual([
      { kind: "click", nodeId: "set-status" },
      { kind: "expect_visible", nodeId: "status-text" },
    ]);
  });

  it("正式 FlowPlan 写入 sourceFlowPlanRevision 且只转换已确认 interaction", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const draft = generateFormalFlowConfirmationQuestions(
      buildFlowPlan({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec,
      }),
    );
    const confirmed = applyFlowConfirmations(draft, [
      {
        questionId: draft.confirmationQuestions[0]!.id,
        value: "target:quote",
      },
    ]);
    const result = applyFlowPlanToUISpec(uiSpec, {
      ...confirmed,
      revision: 7,
    });

    expect(result.uiSpec.sourceFlowPlanRevision).toBe(7);
    expect(result.convertedActionIds).toHaveLength(1);
    expect(result.unresolvedInteractions).toHaveLength(1);
    expect(
      result.unresolvedInteractions.every(
        (interaction) =>
          interaction.source === "inferred" ||
          interaction.source === "missing" ||
          Boolean(interaction.blockedReason),
      ),
    ).toBe(true);
  });
});
