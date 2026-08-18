import { describe, expect, it } from "vitest";

import { buildFlowM9SampleReport } from "../../../src/flow-plan/m9-extractor.ts";
import { buildFlowPlan } from "../../../src/flow-plan/service.ts";
import {
  createMultipageFlowDesignBundleDraft,
  createMultipageFlowUISpecDraft,
} from "../../fixtures/flow-plan/multipage-flow.ts";

describe("Flow-M9 interaction extractor", () => {
  it("把 NAVIGATE 分类为 trusted.navigate", () => {
    const bundle = {
      ...createMultipageFlowDesignBundleDraft("m9-navigate"),
      revision: 1,
    };
    bundle.pages[0]!.nodes.push({
      id: "figma-nav-source",
      parentId: "figma-root",
      kind: "instance",
      name: "Navigate source",
      visible: true,
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      prototypeInteractions: [
        {
          id: "figma-navigate-to-quote",
          source: "figma_rest",
          trigger: "click",
          actionType: "node",
          navigation: "NAVIGATE",
          transitionNodeId: "figma-quote-root",
        },
      ],
      warningCodes: [],
    });
    const uiSpec = {
      ...createMultipageFlowUISpecDraft("m9-navigate", 1),
      revision: 1,
    };
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("ui-home-figma-nav-source");
    }
    uiSpec.nodes.push({
      id: "ui-home-figma-nav-source",
      kind: "button",
      label: "去报价",
      variant: "secondary",
      designValueRefs: [],
    });

    const report = buildFlowM9SampleReport({
      sample: {
        sampleId: "community-dashboard-001",
        category: "dashboard",
        title: "Dashboard",
        expectedViewport: "desktop",
        accessStatus: "rest_readable_node_selected",
      },
      bundle,
      flowPlan: buildFlowPlan({ bundle, uiSpec }),
    });

    expect(report.counts.trustedNavigate).toBe(1);
    expect(report.classifications).toContainEqual(
      expect.objectContaining({
        classification: "trusted.navigate",
        interactionId: "figma-navigate-to-quote",
      }),
    );
  });

  it("把 CHANGE_TO 分类为 trusted.set_state", () => {
    const bundle = {
      ...createMultipageFlowDesignBundleDraft("m9-state"),
      revision: 1,
    };
    bundle.pages[0]!.nodes.push(
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
        variantProperties: { State: "selected" },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );
    const uiSpec = {
      ...createMultipageFlowUISpecDraft("m9-state", 1),
      revision: 1,
    };
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
        kind: "button",
        label: "切换",
        variant: "secondary",
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

    const report = buildFlowM9SampleReport({
      sample: {
        sampleId: "community-mobile-001",
        category: "mobile-app",
        title: "Fitness",
        expectedViewport: "mobile",
        accessStatus: "rest_readable_node_selected",
      },
      bundle,
      flowPlan: buildFlowPlan({ bundle, uiSpec }),
    });

    expect(report.counts.trustedStateChange).toBe(1);
    expect(report.classifications).toContainEqual(
      expect.objectContaining({
        classification: "trusted.set_state",
        interactionId: "figma-change-to-selected",
      }),
    );
  });

  it("把 login/checkout 缺证据按钮分类为 needs_confirmation.submit_like", () => {
    const bundle = {
      ...createMultipageFlowDesignBundleDraft("m9-submit-like"),
      revision: 1,
    };
    const uiSpec = {
      ...createMultipageFlowUISpecDraft("m9-submit-like", 1),
      revision: 1,
    };
    const root = uiSpec.nodes.find((node) => node.id === "root");
    if (root?.kind === "stack") {
      root.childIds.push("login-button");
    }
    uiSpec.nodes.push({
      id: "login-button",
      kind: "button",
      label: "Login",
      variant: "primary",
      designValueRefs: [],
    });

    const report = buildFlowM9SampleReport({
      sample: {
        sampleId: "community-login-001",
        category: "login-register",
        title: "Login sample",
        expectedViewport: "mobile",
        accessStatus: "rest_readable_node_selected",
      },
      bundle,
      flowPlan: buildFlowPlan({ bundle, uiSpec }),
    });

    expect(report.counts.submitLikeNeedsConfirmation).toBeGreaterThan(0);
    expect(report.classifications).toContainEqual(
      expect.objectContaining({
        classification: "needs_confirmation.submit_like",
      }),
    );
  });

  it("保留不可表达 Figma interaction 的 blocked reason", () => {
    const bundle = {
      ...createMultipageFlowDesignBundleDraft("m9-unsupported"),
      revision: 1,
    };
    bundle.pages[0]!.nodes.push({
      id: "figma-overlay",
      parentId: "figma-root",
      kind: "instance",
      name: "Open overlay",
      visible: true,
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      prototypeInteractions: [
        {
          id: "figma-overlay-action",
          source: "figma_rest",
          trigger: "click",
          actionType: "overlay",
          navigation: "OVERLAY",
        },
      ],
      warningCodes: [],
    });
    const uiSpec = {
      ...createMultipageFlowUISpecDraft("m9-unsupported", 1),
      revision: 1,
    };

    const report = buildFlowM9SampleReport({
      sample: {
        sampleId: "community-dashboard-001",
        category: "dashboard",
        title: "Dashboard",
        expectedViewport: "desktop",
        accessStatus: "rest_readable_node_selected",
      },
      bundle,
      flowPlan: buildFlowPlan({ bundle, uiSpec }),
    });

    expect(report.counts.unsupported).toBeGreaterThan(0);
    expect(report.blockedReasons).toContain("ui_node_not_clickable");
  });
});
