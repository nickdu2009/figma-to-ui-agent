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

  it("把可表示的 Figma CHANGE_TO prototype interaction 转为可信 set_state", () => {
    const bundle = createStoredMultipageFlowDesignBundle();
    const homePage = bundle.pages[0]!;
    homePage.nodes.push(
      {
        id: "figma-state-source",
        parentId: "figma-root",
        kind: "instance",
        name: "Variant source",
        visible: true,
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        prototypeInteractions: [
          {
            id: "figma-change-to-selected",
            source: "figma_rest",
            trigger: "click",
            actionType: "change_to",
            navigation: "CHANGE_TO",
            transitionNodeId: "figma-state-target",
          },
        ],
        warningCodes: [],
      },
      {
        id: "figma-state-target",
        parentId: "figma-root",
        kind: "component",
        name: "Variant target",
        visible: true,
        variantProperties: {
          State: "selected",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push(
        "ui-home-figma-state-source",
        "ui-home-figma-state-target",
      );
    }
    uiSpec.state.push({
      key: "state",
      valueType: "string",
      initialValue: "default",
    });
    uiSpec.nodes.push(
      {
        id: "ui-home-figma-state-source",
        kind: "stack",
        direction: "vertical",
        childIds: ["ui-home-figma-state-source-control"],
        designValueRefs: [],
      },
      {
        id: "ui-home-figma-state-source-control",
        kind: "button",
        label: "切换",
        variant: "ghost",
        designValueRefs: [],
      },
      {
        id: "ui-home-figma-state-target",
        kind: "text",
        text: "已选择",
        variant: "body",
        designValueRefs: [],
      },
    );

    const draft = buildFlowPlanDraft({ bundle, uiSpec });

    expect(draft.interactions).toContainEqual(
      expect.objectContaining({
        id: "figma-change-to-selected",
        source: "figma",
        uiNodeId: "ui-home-figma-state-source-control",
        intent: "set_state",
        targetNodeId: "ui-home-figma-state-target",
        stateKey: "state",
        value: "selected",
        confirmed: true,
      }),
    );
  });

  it("从同一 component 的不同 variant 自动生成 set_state 初始值", () => {
    const bundle = createStoredMultipageFlowDesignBundle();
    const homePage = bundle.pages[0]!;
    homePage.nodes.push(
      {
        id: "figma-variant-source",
        parentId: "figma-root",
        kind: "instance",
        name: "Main Button",
        visible: true,
        componentProperties: [
          { name: "State", type: "VARIANT", value: "On" },
        ],
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        prototypeInteractions: [
          {
            id: "figma-change-to-off",
            source: "figma_rest",
            trigger: "click",
            actionType: "change_to",
            navigation: "CHANGE_TO",
            transitionNodeId: "figma-variant-target",
          },
        ],
        warningCodes: [],
      },
      {
        id: "figma-variant-target",
        parentId: "figma-root",
        kind: "component",
        name: "State=Off",
        visible: true,
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push(
        "ui-home-figma-variant-source",
        "ui-home-figma-variant-target",
      );
    }
    uiSpec.nodes.push(
      {
        id: "ui-home-figma-variant-source",
        kind: "stack",
        direction: "vertical",
        childIds: ["ui-home-figma-variant-source-control"],
        designValueRefs: [],
      },
      {
        id: "ui-home-figma-variant-source-control",
        kind: "button",
        label: "切换",
        variant: "ghost",
        designValueRefs: [],
      },
      {
        id: "ui-home-figma-variant-target",
        kind: "text",
        text: "Off",
        variant: "body",
        designValueRefs: [],
      },
    );

    const draft = buildFlowPlanDraft({ bundle, uiSpec });

    expect(draft.interactions).toContainEqual(
      expect.objectContaining({
        id: "figma-change-to-off",
        source: "figma",
        uiNodeId: "ui-home-figma-variant-source-control",
        intent: "set_state",
        targetNodeId: "ui-home-figma-variant-target",
        stateKey: "variant-figma-variant-source-state",
        value: "Off",
        stateInitialValue: "On",
        confirmed: true,
      }),
    );
  });

  it("保留不可表示的 Figma CHANGE_TO 为 unresolved，不按名称猜测", () => {
    const bundle = createStoredMultipageFlowDesignBundle();
    bundle.pages[0]!.nodes.push({
      id: "figma-plain-source",
      parentId: "figma-root",
      kind: "instance",
      name: "Plain source",
      visible: true,
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      prototypeInteractions: [
        {
          id: "figma-change-to-unknown",
          source: "figma_rest",
          trigger: "click",
          actionType: "change_to",
          navigation: "CHANGE_TO",
          transitionNodeId: "figma-missing-target",
        },
      ],
      warningCodes: [],
    });
    const uiSpec = createStoredMultipageFlowUISpec();
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("ui-home-figma-plain-source");
    }
    uiSpec.nodes.push({
      id: "ui-home-figma-plain-source",
      kind: "button",
      label: "切换",
      variant: "secondary",
      designValueRefs: [],
    });

    const draft = buildFlowPlanDraft({ bundle, uiSpec });

    expect(draft.interactions).toContainEqual(
      expect.objectContaining({
        id: "figma-change-to-unknown",
        source: "figma",
        intent: "unknown",
        confirmed: false,
        blockedReason: "change_to_target_not_representable",
      }),
    );
  });
});
