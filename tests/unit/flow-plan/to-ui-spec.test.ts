import { describe, expect, it } from "vitest";

import { applyConfirmations } from "../../../src/flow-plan/apply-confirmations.ts";
import { generateConfirmationQuestions } from "../../../src/flow-plan/confirmation-questions.ts";
import { buildFlowPlanDraft } from "../../../src/flow-plan/interaction-candidates.ts";
import { applyFlowPlanToUISpec } from "../../../src/flow-plan/to-ui-spec.ts";
import { applyFlowM6RouteExecutionToUISpec } from "../../../src/flow-plan/route-execution.ts";
import type { FlowPlan } from "../../../src/flow-plan/schema.ts";
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

  it("把 set_state interaction 写入 Switch 和 Stack 可点击源", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("source-switch", "source-stack", "target-text");
    }
    uiSpec.state.push(
      {
        key: "enabled",
        valueType: "boolean",
        initialValue: false,
      },
      {
        key: "status",
        valueType: "string",
        initialValue: "idle",
      },
    );
    uiSpec.nodes.push(
      {
        id: "source-switch",
        kind: "switch",
        label: "启用",
        stateKey: "enabled",
        designValueRefs: [],
      },
      {
        id: "source-stack",
        kind: "stack",
        direction: "vertical",
        childIds: [],
        designValueRefs: [],
      },
      {
        id: "target-text",
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
          id: "switch-status",
          source: "figma",
          uiNodeId: "source-switch",
          trigger: "click",
          intent: "set_state",
          fromPageId: "home",
          stateKey: "status",
          value: "switch",
          targetNodeId: "target-text",
          confirmed: true,
          confidence: "high",
          reason: "fixture",
        },
        {
          id: "stack-status",
          source: "figma",
          uiNodeId: "source-stack",
          trigger: "click",
          intent: "set_state",
          fromPageId: "home",
          stateKey: "status",
          value: "stack",
          targetNodeId: "target-text",
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

    const sourceSwitch = result.uiSpec.nodes.find(
      (node) => node.id === "source-switch",
    );
    const sourceStack = result.uiSpec.nodes.find(
      (node) => node.id === "source-stack",
    );
    expect(sourceSwitch).toMatchObject({
      kind: "switch",
      actionId: expect.stringMatching(/^flow-switch-status/),
    });
    expect(sourceStack).toMatchObject({
      kind: "stack",
      actionId: expect.stringMatching(/^flow-stack-status/),
    });
    expect(result.uiSpec.behaviorFixtures.map((fixture) => fixture.steps[0])).toEqual([
      { kind: "click", nodeId: "source-switch" },
      { kind: "click", nodeId: "source-stack" },
    ]);
  });

  it("把跨页面 component variant 目标克隆到源页面并用状态切换显隐", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    const quoteRoot = uiSpec.nodes.find((node) => node.id === "quote-root");
    if (root?.kind === "stack") {
      root.childIds.push("source-variant");
    }
    if (quoteRoot?.kind === "stack") {
      quoteRoot.childIds.push("target-variant");
    }
    uiSpec.nodes.push(
      {
        id: "source-variant",
        kind: "stack",
        direction: "vertical",
        childIds: ["source-button"],
        style: { position: "absolute", left: 10, top: 20, width: 160 },
        designValueRefs: [],
      },
      {
        id: "source-button",
        kind: "button",
        label: "On",
        variant: "primary",
        designValueRefs: [],
      },
      {
        id: "target-variant",
        kind: "stack",
        direction: "vertical",
        childIds: ["target-label"],
        style: { position: "absolute", left: 300, top: 400 },
        designValueRefs: [],
      },
      {
        id: "target-label",
        kind: "text",
        text: "Off",
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
        {
          id: "quote",
          sourcePageId: "page-quote",
          name: "报价",
          role: "component",
          confidence: "medium",
          reason: "fixture",
        },
      ],
      interactions: [
        {
          id: "figma-change-to-off",
          source: "figma",
          uiNodeId: "source-button",
          trigger: "click",
          intent: "set_state",
          fromPageId: "home",
          stateKey: "variant-source-state",
          value: "Off",
          stateInitialValue: "On",
          targetNodeId: "target-variant",
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

    const clonedRootId =
      "variant-figma-change-to-off-target-variant";
    expect(result.uiSpec.state).toContainEqual({
      key: "variant-source-state",
      valueType: "string",
      initialValue: "On",
    });
    expect(result.uiSpec.nodes.find((node) => node.id === "source-variant")).toMatchObject({
      visibleWhen: {
        stateKey: "variant-source-state",
        equals: "On",
      },
    });
    expect(result.uiSpec.nodes.find((node) => node.id === clonedRootId)).toMatchObject({
      kind: "stack",
      childIds: ["variant-figma-change-to-off-target-label"],
      style: { position: "absolute", left: 10, top: 20, width: 160 },
      visibleWhen: {
        stateKey: "variant-source-state",
        equals: "Off",
      },
    });
    expect(result.uiSpec.nodes.find((node) => node.id === "root")).toMatchObject({
      childIds: expect.arrayContaining(["source-variant", clonedRootId]),
    });
    expect(result.uiSpec.behaviorFixtures[0]!.steps).toEqual([
      { kind: "click", nodeId: "source-button" },
      { kind: "expect_visible", nodeId: clonedRootId },
    ]);
  });

  it("actionable Stack 触发 variant 时只替换自身，不隐藏父容器", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    const quoteRoot = uiSpec.nodes.find((node) => node.id === "quote-root");
    if (root?.kind === "stack") {
      root.childIds.push("source-stack");
    }
    if (quoteRoot?.kind === "stack") {
      quoteRoot.childIds.push("target-variant");
    }
    uiSpec.nodes.push(
      {
        id: "source-stack",
        kind: "stack",
        direction: "vertical",
        childIds: ["source-label"],
        style: { position: "absolute", left: 12, top: 34, width: 44 },
        designValueRefs: [],
      },
      {
        id: "source-label",
        kind: "text",
        text: "Off",
        variant: "body",
        designValueRefs: [],
      },
      {
        id: "target-variant",
        kind: "stack",
        direction: "vertical",
        childIds: ["target-label"],
        style: { position: "absolute", left: 300, top: 400 },
        designValueRefs: [],
      },
      {
        id: "target-label",
        kind: "text",
        text: "On",
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
        {
          id: "quote",
          sourcePageId: "page-quote",
          name: "报价",
          role: "component",
          confidence: "medium",
          reason: "fixture",
        },
      ],
      interactions: [
        {
          id: "figma-stack-change-to-on",
          source: "figma",
          uiNodeId: "source-stack",
          trigger: "click",
          intent: "set_state",
          fromPageId: "home",
          stateKey: "variant-source-stack-state",
          value: "On",
          stateInitialValue: "Off",
          targetNodeId: "target-variant",
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

    const clonedRootId =
      "variant-figma-stack-change-to-on-target-variant";
    expect(result.uiSpec.nodes.find((node) => node.id === "root")).not.toHaveProperty(
      "visibleWhen",
    );
    expect(result.uiSpec.nodes.find((node) => node.id === "source-stack")).toMatchObject({
      visibleWhen: {
        stateKey: "variant-source-stack-state",
        equals: "Off",
      },
    });
    expect(result.uiSpec.nodes.find((node) => node.id === clonedRootId)).toMatchObject({
      style: { position: "absolute", left: 12, top: 34, width: 44 },
      visibleWhen: {
        stateKey: "variant-source-stack-state",
        equals: "On",
      },
    });
  });

  it("page root component variant 源节点可包装为容器后切换", () => {
    const uiSpec = createStoredMultipageFlowUISpec();
    uiSpec.pages.push(
      {
        id: "variant-on",
        sourcePageId: "page-variant-on",
        path: "/variant-on",
        title: "Variant On",
        rootNodeId: "variant-on-root",
      },
      {
        id: "variant-off",
        sourcePageId: "page-variant-off",
        path: "/variant-off",
        title: "Variant Off",
        rootNodeId: "variant-off-root",
      },
    );
    uiSpec.nodes.push(
      {
        id: "variant-on-root",
        kind: "stack",
        direction: "vertical",
        childIds: ["variant-on-label"],
        style: { width: 110, height: 36, position: "relative" },
        designValueRefs: [],
      },
      {
        id: "variant-on-label",
        kind: "text",
        text: "On",
        variant: "body",
        designValueRefs: [],
      },
      {
        id: "variant-off-root",
        kind: "stack",
        direction: "vertical",
        childIds: ["variant-off-label"],
        style: { width: 110, height: 36, position: "relative" },
        designValueRefs: [],
      },
      {
        id: "variant-off-label",
        kind: "text",
        text: "Off",
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
          id: "variant-on",
          sourcePageId: "page-variant-on",
          name: "Variant On",
          role: "component",
          confidence: "medium",
          reason: "fixture",
        },
        {
          id: "variant-off",
          sourcePageId: "page-variant-off",
          name: "Variant Off",
          role: "component",
          confidence: "medium",
          reason: "fixture",
        },
      ],
      interactions: [
        {
          id: "figma-root-change-to-off",
          source: "figma",
          uiNodeId: "variant-on-root",
          trigger: "click",
          intent: "set_state",
          fromPageId: "variant-on",
          stateKey: "variant-root-state",
          value: "Off",
          stateInitialValue: "On",
          targetNodeId: "variant-off-root",
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

    const containerId =
      "variant-figma-root-change-to-off-variant-on-root-container";
    const clonedRootId = "variant-figma-root-change-to-off-variant-off-root";
    expect(result.unresolvedInteractions).toEqual([]);
    expect(result.uiSpec.pages.find((page) => page.id === "variant-on")).toMatchObject({
      rootNodeId: containerId,
    });
    expect(result.uiSpec.nodes.find((node) => node.id === containerId)).toMatchObject({
      kind: "stack",
      childIds: ["variant-on-root", clonedRootId],
      style: { width: 110, height: 36, position: "relative" },
    });
    expect(result.uiSpec.nodes.find((node) => node.id === "variant-on-root")).toMatchObject({
      visibleWhen: {
        stateKey: "variant-root-state",
        equals: "On",
      },
    });
    expect(result.uiSpec.nodes.find((node) => node.id === clonedRootId)).toMatchObject({
      visibleWhen: {
        stateKey: "variant-root-state",
        equals: "Off",
      },
    });
    expect(result.uiSpec.behaviorFixtures[0]!.steps).toEqual([
      { kind: "click", nodeId: "variant-on-root" },
      { kind: "expect_visible", nodeId: clonedRootId },
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

  it("Flow-M6 route execution 只转换 navigate interaction", () => {
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

    const flowPlan: FlowPlan = {
      schemaVersion: "1",
      projectId: "demo-project",
      revision: 7,
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
      figmaInteractionSource: "present",
      pages: [
        {
          id: "home",
          sourcePageId: "page-home",
          name: "首页",
          role: "entry",
          confidence: "medium",
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
          id: "continue",
          source: "figma",
          uiNodeId: "continue",
          trigger: "click",
          intent: "navigate",
          fromPageId: "home",
          targetPageId: "quote",
          confirmed: true,
          confidence: "high",
          reason: "fixture",
        },
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
      stateMachines: [],
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

    const result = applyFlowM6RouteExecutionToUISpec(uiSpec, flowPlan);

    expect(result.convertedNavigateActionIds).toHaveLength(1);
    expect(result.uiSpec.actions).toEqual([
      {
        id: result.convertedNavigateActionIds[0],
        kind: "navigate",
        pageId: "quote",
      },
    ]);
    expect(result.unresolvedInteractions).toMatchObject([
      {
        id: "set-status",
        blockedReason: "flow_m6_non_navigate_out_of_scope",
      },
    ]);
  });
});
