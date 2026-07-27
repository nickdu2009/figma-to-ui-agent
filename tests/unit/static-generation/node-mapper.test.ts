import { describe, expect, it } from "vitest";

import type { DesignBundle } from "../../../src/design-bundle/schema.ts";
import { mapPageNodes } from "../../../src/static-generation/node-mapper.ts";
import type { VisualLayerPlan } from "../../../src/static-generation/visual-layer-planner.ts";
import { createM5StaticDesignBundle } from "../../fixtures/static-generation/m5-static-fixture.ts";

function createVisualLayerFixture(): {
  bundle: DesignBundle;
  layers: VisualLayerPlan[];
} {
  const bundle: DesignBundle = {
    schemaVersion: "1",
    revision: 1,
    projectId: "visual-layer-dup-test",
    source: {
      provider: "figma_rest",
      fileKeyHash: "a".repeat(64),
      targetNodeIds: [],
      inspectedAt: "2026-07-25T08:00:00.000Z",
    },
    capabilities: {
      variables: { status: "unavailable_optional", reasonCode: "plan_limited" },
    },
    pages: [
      {
        id: "page-checkout",
        name: "Checkout",
        width: 1440,
        height: 900,
        rootNodeIds: ["root"],
        nodes: [
          {
            id: "root",
            kind: "container",
            name: "Checkout",
            visible: true,
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            layout: {
              direction: "vertical",
              gap: 0,
              paddingTop: 0,
              paddingRight: 0,
              paddingBottom: 0,
              paddingLeft: 0,
            },
            styleRefs: [],
            imageRefs: [],
            boundVariableRefs: [],
            designValueRefs: [],
            warningCodes: [],
          },
          {
            id: "button-instance",
            parentId: "root",
            kind: "instance",
            name: "Nested visual container",
            visible: true,
            bounds: { x: 100, y: 100, width: 200, height: 50 },
            styleRefs: [],
            imageRefs: [],
            boundVariableRefs: [],
            designValueRefs: [],
            warningCodes: [],
          },
          {
            id: "vector-bg",
            parentId: "button-instance",
            kind: "vector",
            name: "BG",
            visible: true,
            bounds: { x: 100, y: 100, width: 200, height: 50 },
            visual: {
              opacity: 1,
              blendMode: "NORMAL",
              fillCount: 1,
              strokeCount: 0,
              effectCount: 0,
              vectorPathCount: 2,
            },
            styleRefs: [],
            imageRefs: ["figma/assets/bg.png"],
            boundVariableRefs: [],
            designValueRefs: [],
            warningCodes: [],
          },
        ],
      },
    ],
    components: [],
    styles: [],
    designValues: [],
    screenshots: [],
    assets: [],
    fonts: [],
    provenance: [],
    warnings: [],
  };

  const layers: VisualLayerPlan[] = [
    {
      sourceNodeId: "vector-bg",
      sourcePageId: "page-checkout",
      reason: "large_visual",
      layerRole: "decorative_background",
      zOrder: 1,
      bounds: { x: 100, y: 100, width: 200, height: 50 },
      pageRelativeBounds: { x: 100, y: 100, width: 200, height: 50 },
      opacity: 1,
      assetRef: "figma/assets/bg.png",
      uiNodeId: "vl-checkout-vector-bg",
      uiNode: {
        id: "vl-checkout-vector-bg",
        kind: "pixel_overlay",
        assetRef: "figma/assets/bg.png",
        alt: "BG",
        width: 200,
        height: 50,
        designValueRefs: [],
        style: {
          position: "absolute",
          left: 100,
          top: 100,
          width: 200,
          height: 50,
          zIndex: 1,
          opacity: 1,
          pointerEvents: "none",
        },
        childIds: [],
      },
      rendered: true,
    },
  ];

  return { bundle, layers };
}

describe("mapPageNodes", () => {
  it("maps login form with inputs, buttons and social icons", () => {
    const bundle = createM5StaticDesignBundle();
    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    const nodeById = new Map(
      result.nodes.map((node) => [node.id, node]),
    );

    const inputs = result.nodes.filter((node) => node.kind === "input");
    expect(inputs.length).toBeGreaterThanOrEqual(2);

    const buttons = result.nodes.filter((node) => node.kind === "button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    const texts = result.nodes.filter((node) => node.kind === "text");
    expect(texts.length).toBeGreaterThanOrEqual(3);

    const root = nodeById.get(result.rootNodeId);
    expect(root?.kind).toBe("section");
  });

  it("preserves footer text nowrap strategy", () => {
    const bundle = createM5StaticDesignBundle();
    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    const footer = result.nodes.find(
      (node) => node.kind === "text" && node.text.includes("©"),
    );
    expect(footer).toBeDefined();
    expect(footer?.style?.whiteSpace).toBe("nowrap");
  });

  it("maps button-like and input-like containers to real controls", () => {
    const bundle = createM5StaticDesignBundle();
    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "input",
          label: "Email input",
          inputType: "email",
        }),
        expect.objectContaining({
          kind: "input",
          label: "Password input",
          inputType: "password",
        }),
        expect.objectContaining({
          kind: "button",
          label: "Sign in",
        }),
      ]),
    );
  });

  it("uses descendant text when mapping a button-like container", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages[0]!;
    page.nodes.push({
      id: "figma-signin-button-label",
      parentId: "figma-signin-button",
      kind: "text",
      name: "Button label",
      visible: true,
      bounds: { x: 900, y: 394, width: 80, height: 20 },
      text: {
        characters: "Log In",
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 20,
        textAlign: "center",
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ui-login-figma-signin-button-control",
          kind: "button",
          label: "Log In",
          variant: "ghost",
        }),
      ]),
    );
    expect(result.sourceToUiNodeId.get("figma-signin-button-label")).toBe(
      "ui-login-figma-signin-button-label",
    );
    expect(result.sourceToUiNodeId.get("figma-signin-button")).toBe(
      "ui-login-figma-signin-button-control",
    );
  });

  it("does not render variant icon layers for ordinary CTA buttons", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "figma-signin-button-label",
        parentId: "figma-signin-button",
        kind: "text",
        name: "Button label",
        visible: true,
        bounds: { x: 900, y: 394, width: 80, height: 20 },
        text: {
          characters: "Log In",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 20,
          textAlign: "center",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "figma-signin-plus",
        parentId: "figma-signin-button",
        kind: "instance",
        name: "plus",
        visible: true,
        bounds: { x: 884, y: 395, width: 18, height: 18 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "figma-signin-plus-vector",
        parentId: "figma-signin-plus",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 888, y: 399, width: 10, height: 10 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          effectCount: 0,
          vectorPathCount: 1,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [
        {
          sourceNodeId: "figma-signin-plus-vector",
          sourcePageId: "page-login",
          reason: "button_icon",
          layerRole: "button_icon",
          zOrder: 10,
          bounds: { x: 888, y: 399, width: 10, height: 10 },
          pageRelativeBounds: { x: 888, y: 399, width: 10, height: 10 },
          assetRef: "figma/assets/plus.png",
          uiNodeId: "vl-login-figma-signin-plus-vector",
          uiNode: {
            id: "vl-login-figma-signin-plus-vector",
            kind: "pixel_overlay",
            assetRef: "figma/assets/plus.png",
            alt: "plus",
            width: 10,
            height: 10,
            designValueRefs: [],
            style: {
              position: "absolute",
              left: 888,
              top: 399,
              width: 10,
              height: 10,
              zIndex: 10,
              pointerEvents: "none",
            },
            childIds: [],
          },
          rendered: true,
        },
      ],
    });

    const icon = result.nodes.find(
      (node) => node.id === "vl-login-figma-signin-plus-vector",
    );
    expect(icon).toBeUndefined();
    const button = result.nodes.find(
      (node) => node.id === "ui-login-figma-signin-button-control",
    );
    expect(button?.kind).toBe("button");
    if (button?.kind === "button") {
      expect(button.leadingIconAssetRef).toBeUndefined();
      expect(button.trailingIconAssetRef).toBeUndefined();
    }
  });

  it("keeps branded social button icon layers", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "figma-google-label",
        parentId: "figma-social-google",
        kind: "text",
        name: "Google label",
        visible: true,
        bounds: { x: 830, y: 494, width: 120, height: 20 },
        text: {
          characters: "Continue with Google",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 20,
          textAlign: "center",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "figma-google-vector",
        parentId: "figma-social-google",
        kind: "vector",
        name: "google",
        visible: true,
        bounds: { x: 805, y: 495, width: 18, height: 18 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 1,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [
        {
          sourceNodeId: "figma-google-vector",
          sourcePageId: "page-login",
          reason: "button_icon",
          layerRole: "button_icon",
          zOrder: 10,
          bounds: { x: 805, y: 495, width: 18, height: 18 },
          pageRelativeBounds: { x: 805, y: 495, width: 18, height: 18 },
          assetRef: "figma/assets/google.png",
          uiNodeId: "vl-login-figma-google-vector",
          uiNode: {
            id: "vl-login-figma-google-vector",
            kind: "pixel_overlay",
            assetRef: "figma/assets/google.png",
            alt: "google",
            width: 18,
            height: 18,
            designValueRefs: [],
            style: {
              position: "absolute",
              left: 805,
              top: 495,
              width: 18,
              height: 18,
              zIndex: 10,
              pointerEvents: "none",
            },
            childIds: [],
          },
          rendered: true,
        },
      ],
    });

    const socialButton = result.nodes.find(
      (node) => node.id === "ui-login-figma-social-google",
    );
    expect(socialButton?.kind).toBe("stack");
    if (socialButton?.kind === "stack") {
      expect(socialButton.childIds).toContain("vl-login-figma-google-vector");
    }
  });

  it("skips visible non-root nodes with zero-sized bounds", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "figma-zero-height-line",
        parentId: "figma-login-root",
        kind: "vector",
        name: "Line",
        visible: true,
        bounds: { x: 120, y: 320, width: 180, height: 0 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          strokeWeight: 1,
          effectCount: 0,
          vectorPathCount: 0,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "figma-zero-width-line",
        parentId: "figma-login-root",
        kind: "vector",
        name: "Line",
        visible: true,
        bounds: { x: 220, y: 330, width: 0, height: 48 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          strokeWeight: 1,
          effectCount: 0,
          vectorPathCount: 0,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    expect(
      result.nodes.some((node) =>
        node.id.includes("figma-zero-height-line") ||
        node.id.includes("figma-zero-width-line"),
      ),
    ).toBe(false);
    expect(result.sourceToUiNodeId.has("figma-zero-height-line")).toBe(false);
    expect(result.sourceToUiNodeId.has("figma-zero-width-line")).toBe(false);
  });

  it("does not warn for vector children covered by an ancestor visual symbol layer", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "figma-plus-icon",
        parentId: "figma-login-root",
        kind: "container",
        name: "plus",
        visible: true,
        bounds: { x: 80, y: 80, width: 20, height: 20 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "figma-plus-icon-line",
        parentId: "figma-plus-icon",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 88, y: 84, width: 0, height: 12 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          strokeWeight: 1.5,
          strokeColor: { r: 0.5, g: 0.505, b: 0.573, a: 1 },
          effectCount: 0,
          vectorPathCount: 0,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [
        {
          sourceNodeId: "figma-plus-icon",
          sourcePageId: "page-login",
          reason: "nav_icon",
          layerRole: "icon",
          zOrder: 10,
          bounds: { x: 80, y: 80, width: 20, height: 20 },
          pageRelativeBounds: { x: 80, y: 80, width: 20, height: 20 },
          uiNodeId: "vl-login-figma-plus-icon",
          uiNode: {
            id: "vl-login-figma-plus-icon",
            kind: "icon",
            symbol: "plus",
            alt: "plus",
            decorative: true,
            designValueRefs: [],
            style: {
              position: "absolute",
              left: 80,
              top: 80,
              width: 20,
              height: 20,
              zIndex: 10,
              pointerEvents: "none",
            },
          },
          rendered: true,
        },
      ],
    });

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vl-login-figma-plus-icon",
          kind: "icon",
          symbol: "plus",
        }),
      ]),
    );
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unmapped_node_vector",
          detail: expect.stringContaining("figma-plus-icon-line"),
        }),
      ]),
    );
  });

  it("maps descendant text metrics onto input control overlays", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "figma-email-input-label",
        parentId: "figma-email-input",
        kind: "text",
        name: "Input label",
        visible: true,
        bounds: { x: 784, y: 230, width: 80, height: 18 },
        text: {
          characters: "Email",
          fontFamily: "Inter",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 16,
          letterSpacing: 0,
          textAlign: "left",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "figma-email-input-value",
        parentId: "figma-email-input",
        kind: "text",
        name: "Input value",
        visible: true,
        bounds: { x: 800, y: 242, width: 180, height: 20 },
        text: {
          characters: "madisons@example.com",
          fontFamily: "Poppins",
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 20,
          letterSpacing: -0.1,
          textAlign: "left",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    const input = result.nodes.find(
      (node) => node.id === "ui-login-figma-email-input-control",
    );
    expect(input).toMatchObject({
      kind: "input",
      label: "Email",
      placeholder: "madisons@example.com",
      style: expect.objectContaining({
          fontFamily:
            'Poppins, Avenir, "Avenir Next", "Helvetica Neue", Arial, sans-serif',
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: -0.1,
        textAlign: "left",
      }),
    });
    expect(input?.style?.lineHeight).toBeCloseTo(1.25);
  });

  it("maps input-like fields with trailing chevrons to select controls", () => {
    const bundle: DesignBundle = {
      schemaVersion: "1",
      revision: 1,
      projectId: "select-field-test",
      source: {
        provider: "figma_rest",
        fileKeyHash: "b".repeat(64),
        targetNodeIds: [],
        inspectedAt: "2026-07-26T08:00:00.000Z",
      },
      capabilities: {
        variables: { status: "unavailable_optional", reasonCode: "plan_limited" },
      },
      pages: [
        {
          id: "page-select",
          name: "Select",
          width: 320,
          height: 160,
          rootNodeIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "container",
              name: "Root",
              visible: true,
              bounds: { x: 0, y: 0, width: 320, height: 160 },
              styleRefs: [],
              imageRefs: [],
              boundVariableRefs: [],
              designValueRefs: [],
              warningCodes: [],
            },
            {
              id: "space-field",
              parentId: "root",
              kind: "container",
              name: "Field",
              visible: true,
              bounds: { x: 24, y: 24, width: 220, height: 40 },
              componentRef: "component-select-field",
              componentProperties: [
                { name: "State", type: "VARIANT", value: "Selected" },
                { name: "Size", type: "VARIANT", value: "Medium" },
              ],
              variantProperties: {
                State: "Selected",
                Size: "Medium",
              },
              visual: {
                fillCount: 1,
                strokeCount: 1,
                effectCount: 0,
                vectorPathCount: 0,
                clipsContent: true,
              },
              styleRefs: [],
              imageRefs: [],
              boundVariableRefs: [],
              designValueRefs: [],
              warningCodes: [],
            },
            {
              id: "space-label",
              parentId: "space-field",
              kind: "text",
              name: "Label",
              visible: true,
              bounds: { x: 36, y: 30, width: 48, height: 12 },
              text: {
                characters: "Space",
                fontFamily: "Inter",
                fontSize: 10,
                fontWeight: 500,
                lineHeight: 12,
                textAlign: "left",
              },
              styleRefs: [],
              imageRefs: [],
              boundVariableRefs: [],
              designValueRefs: [],
              warningCodes: [],
            },
            {
              id: "space-value",
              parentId: "space-field",
              kind: "text",
              name: "Value",
              visible: true,
              bounds: { x: 36, y: 42, width: 80, height: 16 },
              text: {
                characters: "Cary RD",
                fontFamily: "Inter",
                fontSize: 14,
                fontWeight: 400,
                lineHeight: 16,
                textAlign: "left",
              },
              styleRefs: [],
              imageRefs: [],
              boundVariableRefs: [],
              designValueRefs: [],
              warningCodes: [],
            },
            {
              id: "space-trailing-icon",
              parentId: "space-field",
              kind: "container",
              name: "Trailing Icon",
              visible: true,
              bounds: { x: 214, y: 42, width: 10, height: 5 },
              styleRefs: [],
              imageRefs: [],
              boundVariableRefs: [],
              designValueRefs: [],
              warningCodes: [],
            },
            {
              id: "space-chevron",
              parentId: "space-trailing-icon",
              kind: "vector",
              name: "Vector",
              visible: true,
              bounds: { x: 214, y: 42, width: 10, height: 5 },
              visual: {
                fillCount: 0,
                strokeCount: 1,
                effectCount: 0,
                vectorPathCount: 1,
              },
              styleRefs: [],
              imageRefs: [],
              boundVariableRefs: [],
              designValueRefs: [],
              warningCodes: [],
            },
          ],
        },
      ],
      components: [
        {
          id: "component-select-field",
          name: "Select field",
          sourceType: "component",
        },
      ],
      styles: [],
      designValues: [],
      screenshots: [],
      assets: [],
      fonts: [],
      provenance: [],
      warnings: [],
    };

    const result = mapPageNodes({
      bundle,
      pagePlanId: "select",
      sourcePageId: "page-select",
      pagePath: "/select",
      visualLayers: [],
    });

    const select = result.nodes.find(
      (node) => node.id === "ui-select-space-field-control",
    );
    expect(select).toMatchObject({
      kind: "select",
      label: "Space",
      placeholder: "Cary RD",
      options: [{ value: "cary-rd", label: "Cary RD" }],
      sourceComponent: {
        componentRef: "component-select-field",
        family: "select",
        state: "selected",
        variantProperties: {
          State: "Selected",
          Size: "Medium",
        },
      },
    });
    expect(result.nodes.some((node) => node.kind === "input")).toBe(false);
  });

  it("maps component variant disabled state onto button controls", () => {
    const { bundle } = createVisualLayerFixture();
    bundle.components.push({
      id: "component-primary-button",
      name: "Button",
      sourceType: "component",
    });
    bundle.pages[0]!.nodes.push(
      {
        id: "disabled-button",
        parentId: "root",
        kind: "instance",
        name: "Button",
        visible: true,
        bounds: { x: 100, y: 220, width: 160, height: 44 },
        componentRef: "component-primary-button",
        componentProperties: [
          { name: "State", type: "VARIANT", value: "Disabled" },
          { name: "Size", type: "VARIANT", value: "Medium" },
        ],
        variantProperties: {
          State: "Disabled",
          Size: "Medium",
        },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "disabled-button-label",
        parentId: "disabled-button",
        kind: "text",
        name: "Label",
        visible: true,
        bounds: { x: 120, y: 234, width: 80, height: 16 },
        text: {
          characters: "Submit",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 16,
          textAlign: "center",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    const button = result.nodes.find(
      (node) => node.id === "ui-checkout-disabled-button-control",
    );
    expect(button).toMatchObject({
      kind: "button",
      label: "Submit",
      disabled: true,
      sourceComponent: {
        componentRef: "component-primary-button",
        family: "button",
        state: "disabled",
        variantProperties: {
          State: "Disabled",
          Size: "Medium",
        },
      },
    });
  });

  it("maps boolean and radio component variants to typed controls and state", () => {
    const { bundle } = createVisualLayerFixture();
    bundle.components.push(
      {
        id: "component-checkbox",
        name: "Checkbox",
        sourceType: "component",
      },
      {
        id: "component-switch",
        name: "Switch",
        sourceType: "component",
      },
      {
        id: "component-radio",
        name: "Radio button",
        sourceType: "component",
      },
    );
    bundle.pages[0]!.nodes.push(
      {
        id: "accept-checkbox",
        parentId: "root",
        kind: "instance",
        name: "Checkbox",
        visible: true,
        bounds: { x: 100, y: 300, width: 180, height: 32 },
        componentRef: "component-checkbox",
        componentProperties: [
          { name: "State", type: "VARIANT", value: "Checked" },
        ],
        variantProperties: {
          State: "Checked",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "accept-checkbox-label",
        parentId: "accept-checkbox",
        kind: "text",
        name: "Label",
        visible: true,
        bounds: { x: 128, y: 306, width: 120, height: 18 },
        text: {
          characters: "Accept terms",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 18,
          textAlign: "left",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "notify-switch",
        parentId: "root",
        kind: "instance",
        name: "Switch",
        visible: true,
        bounds: { x: 100, y: 348, width: 160, height: 36 },
        componentRef: "component-switch",
        componentProperties: [
          { name: "State", type: "VARIANT", value: "Selected" },
        ],
        variantProperties: {
          State: "Selected",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "notify-switch-label",
        parentId: "notify-switch",
        kind: "text",
        name: "Label",
        visible: true,
        bounds: { x: 148, y: 356, width: 80, height: 18 },
        text: {
          characters: "Notify me",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 18,
          textAlign: "left",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "basic-radio",
        parentId: "root",
        kind: "instance",
        name: "Radio button",
        visible: true,
        bounds: { x: 100, y: 400, width: 160, height: 32 },
        componentRef: "component-radio",
        componentProperties: [
          { name: "State", type: "VARIANT", value: "Selected" },
        ],
        variantProperties: {
          State: "Selected",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "basic-radio-label",
        parentId: "basic-radio",
        kind: "text",
        name: "Label",
        visible: true,
        bounds: { x: 128, y: 406, width: 80, height: 18 },
        text: {
          characters: "Basic plan",
          fontFamily: "Inter",
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 18,
          textAlign: "left",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ui-checkout-accept-checkbox-control",
          kind: "checkbox",
          label: "Accept terms",
          sourceComponent: expect.objectContaining({
            family: "checkbox",
            state: "selected",
          }),
        }),
        expect.objectContaining({
          id: "ui-checkout-notify-switch-control",
          kind: "switch",
          label: "Notify me",
          sourceComponent: expect.objectContaining({
            family: "switch",
            state: "selected",
          }),
        }),
        expect.objectContaining({
          id: "ui-checkout-basic-radio-control",
          kind: "radio",
          label: "Basic plan",
          value: "basic-plan",
          sourceComponent: expect.objectContaining({
            family: "radio",
            state: "selected",
          }),
        }),
      ]),
    );
    expect(result.stateEntries).toEqual(
      expect.arrayContaining([
        {
          key: "state-checkout-accept-checkbox-control",
          valueType: "boolean",
          initialValue: true,
        },
        {
          key: "state-checkout-notify-switch-control",
          valueType: "boolean",
          initialValue: true,
        },
        {
          key: "state-checkout-root-radio-group",
          valueType: "string",
          initialValue: "basic-plan",
        },
      ]),
    );
  });

  it("maps root as container even when name matches button keyword", () => {
    const bundle = createM5StaticDesignBundle();
    bundle.pages[0]!.nodes[0]!.name = "Login button container";

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    const root = result.nodes.find((node) => node.id === result.rootNodeId);
    expect(root?.kind).not.toBe("button");
  });

  it("maps Figma bounds to parent-relative frame styles", () => {
    const bundle = createM5StaticDesignBundle();
    const result = mapPageNodes({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pagePath: "/dashboard",
      visualLayers: [],
    });

    const root = result.nodes.find((node) => node.id === result.rootNodeId);
    expect(root?.style).toMatchObject({
      position: "relative",
      width: 1440,
      height: 900,
    });

    const main = result.nodes.find(
      (node) => node.id === "ui-dashboard-figma-main",
    );
    expect(main?.style).toMatchObject({
      position: "absolute",
      left: 240,
      top: 0,
      width: 1200,
      height: 900,
    });

    const image = result.nodes.find(
      (node) => node.id === "ui-dashboard-figma-dashboard-image",
    );
    expect(image?.kind).toBe("image");
    expect(image?.style).toMatchObject({
      position: "absolute",
      left: 32,
      top: 96,
      width: 600,
      height: 340,
    });
  });

  it("does not duplicate visual layer nodes when their parent is a non-root container", () => {
    const { bundle, layers } = createVisualLayerFixture();

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: layers,
    });

    const occurrences = result.nodes.filter(
      (node) => node.id === "vl-checkout-vector-bg",
    );
    expect(occurrences).toHaveLength(1);

    const root = result.nodes.find((node) => node.id === result.rootNodeId);
    expect(root?.kind).toBe("stack");
    if (root?.kind === "stack") {
      expect(root.childIds).not.toContain("vl-checkout-vector-bg");
    }

    const button = result.nodes.find((node) => node.id === "ui-checkout-button-instance");
    expect(button?.kind).toBe("stack");
    if (button?.kind === "stack") {
      expect(button.childIds).toContain("vl-checkout-vector-bg");
    }

    const overlay = result.nodes.find(
      (node) => node.id === "vl-checkout-vector-bg",
    );
    expect(overlay?.style).toMatchObject({
      position: "absolute",
      left: 0,
      top: 0,
      width: 200,
      height: 50,
    });
  });

  it("preserves visual layer outsets when nesting overlays under source parents", () => {
    const { bundle, layers } = createVisualLayerFixture();
    const layer = layers[0]!;
    const uiNode = layer.uiNode;
    if (!uiNode || uiNode.kind !== "pixel_overlay") {
      throw new Error("fixture overlay node not found");
    }
    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [
        {
          ...layer,
          uiNode: {
            ...uiNode,
            width: 240,
            height: 90,
            style: {
              ...uiNode.style,
              left: 80,
              top: 80,
              width: 240,
              height: 90,
            },
          },
        },
      ],
    });

    const overlay = result.nodes.find(
      (node) => node.id === "vl-checkout-vector-bg",
    );
    expect(overlay?.style).toMatchObject({
      position: "absolute",
      left: -20,
      top: -20,
      width: 240,
      height: 90,
    });
  });

  it("falls back rendered child visual layers to root when their visual parent is unrendered", () => {
    const { bundle, layers } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.nodes[2]!.imageRefs = [];
    page.nodes[2]!.visual = {
      fillCount: 1,
      strokeCount: 0,
      effectCount: 1,
      vectorPathCount: 0,
    };
    page.nodes.push({
      id: "bar-child",
      parentId: "vector-bg",
      kind: "vector",
      name: "Rectangle",
      visible: true,
      bounds: { x: 120, y: 110, width: 4, height: 40 },
      visual: {
        fillCount: 1,
        strokeCount: 0,
        effectCount: 0,
        vectorPathCount: 0,
      },
      styleRefs: [],
      imageRefs: ["figma/assets/bg.png"],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [
        {
          ...layers[0]!,
          rendered: false,
          assetRef: undefined,
          uiNodeId: undefined,
          uiNode: undefined,
          blockedReason: "没有可用的局部图片资产",
        },
        {
          sourceNodeId: "bar-child",
          sourcePageId: "page-checkout",
          reason: "line_divider",
          layerRole: "line_or_divider",
          zOrder: 3,
          bounds: { x: 120, y: 110, width: 4, height: 40 },
          pageRelativeBounds: { x: 120, y: 110, width: 4, height: 40 },
          assetRef: "figma/assets/bg.png",
          uiNodeId: "vl-checkout-bar-child",
          uiNode: {
            id: "vl-checkout-bar-child",
            kind: "pixel_overlay",
            assetRef: "figma/assets/bg.png",
            alt: "Rectangle",
            width: 4,
            height: 40,
            designValueRefs: [],
            style: {
              position: "absolute",
              left: 120,
              top: 110,
              width: 4,
              height: 40,
              zIndex: 3,
              pointerEvents: "none",
            },
            childIds: [],
          },
          rendered: true,
        },
      ],
    });

    const container = result.nodes.find(
      (node) => node.id === "ui-checkout-button-instance",
    );
    expect(container?.kind).toBe("stack");
    if (container?.kind === "stack") {
      expect(container.childIds).toContain("vl-checkout-bar-child");
    }
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vl-checkout-bar-child",
          kind: "pixel_overlay",
        }),
      ]),
    );
  });

  it("maps clipped square image frames as circular overflow clips", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.nodes[0]!.designValueRefs = ["root-bg"];
    page.nodes[0]!.visual = {
      fillCount: 1,
      strokeCount: 0,
      effectCount: 0,
      vectorPathCount: 0,
    };
    bundle.designValues = [
      {
        id: "root-bg",
        name: "color.fill.root",
        origin: "inferred",
        kind: "color",
        value: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      },
    ];
    page.nodes.push(
      {
        id: "avatar-frame",
        parentId: "root",
        kind: "container",
        name: "Avatar Frame",
        visible: true,
        bounds: { x: 400, y: 100, width: 100, height: 100 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "avatar-image",
        parentId: "avatar-frame",
        kind: "image",
        name: "Avatar image",
        visible: true,
        bounds: { x: 370, y: 90, width: 160, height: 120 },
        styleRefs: [],
        imageRefs: ["figma/assets/bg.png"],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    const root = result.nodes.find((node) => node.id === result.rootNodeId);
    expect(root?.style?.backgroundColor).toBe("#1A1A1A");

    const avatarFrame = result.nodes.find(
      (node) => node.id === "ui-checkout-avatar-frame",
    );
    expect(avatarFrame?.style).toMatchObject({
      overflow: "hidden",
      borderRadius: 50,
    });
  });

  it("infers circular image clipping from avatar mask siblings", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "avatar-frame",
        parentId: "root",
        kind: "container",
        name: "Avatar",
        visible: true,
        bounds: { x: 400, y: 100, width: 40, height: 40 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: false,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "avatar-mask",
        parentId: "avatar-frame",
        kind: "vector",
        name: "Mask",
        visible: true,
        bounds: { x: 400, y: 100, width: 40, height: 40 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          isMask: true,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "avatar-image",
        parentId: "avatar-frame",
        kind: "image",
        name: "Bitmap",
        visible: true,
        bounds: { x: 397, y: 100, width: 46, height: 40 },
        styleRefs: [],
        imageRefs: ["figma/assets/bg.png"],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    const avatarFrame = result.nodes.find(
      (node) => node.id === "ui-checkout-avatar-frame",
    );
    expect(avatarFrame?.style).toMatchObject({
      overflow: "hidden",
      borderRadius: 20,
    });
  });

  it("maps small clipped root frames with strokes as rounded device canvases", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.width = 393;
    page.height = 852;
    page.nodes[0]!.bounds = { x: 0, y: 0, width: 393, height: 852 };
    page.nodes[0]!.visual = {
      fillCount: 1,
      strokeCount: 1,
      effectCount: 0,
      vectorPathCount: 0,
      clipsContent: true,
    };
    page.nodes[0]!.designValueRefs = ["root-bg"];
    bundle.designValues = [
      {
        id: "root-bg",
        name: "color.fill.root",
        origin: "inferred",
        kind: "color",
        value: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      },
    ];

    const result = mapPageNodes({
      bundle,
      pagePlanId: "device",
      sourcePageId: "page-checkout",
      pagePath: "/device",
      visualLayers: [],
    });

    const root = result.nodes.find((node) => node.id === result.rootNodeId);
    expect(root?.style).toMatchObject({
      overflow: "hidden",
      borderRadius: 24,
    });
  });

  it("does not round small clipped root frames without strokes", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.width = 375;
    page.height = 812;
    page.nodes[0]!.bounds = { x: 0, y: 0, width: 375, height: 812 };
    page.nodes[0]!.visual = {
      fillCount: 1,
      strokeCount: 0,
      effectCount: 0,
      vectorPathCount: 0,
      clipsContent: true,
    };

    const result = mapPageNodes({
      bundle,
      pagePlanId: "mobile",
      sourcePageId: "page-checkout",
      pagePath: "/mobile",
      visualLayers: [],
    });

    const root = result.nodes.find((node) => node.id === result.rootNodeId);
    expect(root?.style?.borderRadius).toBeUndefined();
  });

  it("maps visible Figma component nodes with children as frame-like UI", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "tooltip-component",
        parentId: "root",
        kind: "component",
        name: "tooltip-right",
        visible: true,
        bounds: { x: 300, y: 160, width: 100, height: 40 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: false,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "tooltip-label",
        parentId: "tooltip-component",
        kind: "text",
        name: "Label",
        visible: true,
        bounds: { x: 320, y: 170, width: 50, height: 16 },
        text: {
          characters: "remove",
          fontFamily: "Inter",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 16,
          textAlign: "center",
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    const tooltip = result.nodes.find(
      (node) => node.id === "ui-checkout-tooltip-component",
    );
    expect(tooltip?.kind).toBe("stack");
    if (tooltip?.kind === "stack") {
      expect(tooltip.childIds).toContain("ui-checkout-tooltip-label");
    }
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ui-checkout-tooltip-label",
          kind: "text",
          text: "remove",
        }),
      ]),
    );
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unmapped_node_component" }),
      ]),
    );
  });

  it("clips modal shells to their same-sized rounded background layer", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.nodes.push(
      {
        id: "invite-modal",
        parentId: "root",
        kind: "container",
        name: "multi-form-modal",
        visible: true,
        bounds: { x: 300, y: 140, width: 680, height: 466 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: false,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "invite-modal-bg",
        parentId: "invite-modal",
        kind: "vector",
        name: "bg",
        visible: true,
        bounds: { x: 300, y: 140, width: 680, height: 466 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          cornerRadius: 16,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
      {
        id: "modal-bottom-bar",
        parentId: "invite-modal",
        kind: "container",
        name: "modal-bottom-bar",
        visible: true,
        bounds: { x: 300, y: 534, width: 680, height: 72 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
          clipsContent: false,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: [],
        warningCodes: [],
      },
    );

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    const modal = result.nodes.find(
      (node) => node.id === "ui-checkout-invite-modal",
    );
    expect(modal?.style).toMatchObject({
      borderRadius: 16,
      overflow: "hidden",
    });
  });

  it("positions thick clipped surface strokes as Figma-style outer outsets", () => {
    const { bundle } = createVisualLayerFixture();
    const page = bundle.pages[0]!;
    page.nodes.push({
      id: "app-window",
      parentId: "root",
      kind: "container",
      name: "base-layout",
      visible: true,
      bounds: { x: 192, y: 62, width: 1440, height: 777 },
      visual: {
        fillCount: 1,
        strokeCount: 1,
        strokeWeight: 8,
        strokeColor: { r: 0.4, g: 0.4, b: 0.5, a: 1 },
        effectCount: 1,
        vectorPathCount: 0,
        cornerRadius: 24,
        clipsContent: true,
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });

    const result = mapPageNodes({
      bundle,
      pagePlanId: "checkout",
      sourcePageId: "page-checkout",
      pagePath: "/checkout",
      visualLayers: [],
    });

    const appWindow = result.nodes.find(
      (node) => node.id === "ui-checkout-app-window",
    );
    expect(appWindow?.style).toMatchObject({
      left: 184,
      top: 54,
      borderWidth: 8,
      borderRadius: 24,
    });
    expect(appWindow?.style?.width).toBe(1440);
    expect(appWindow?.style?.height).toBe(777);
  });

  it("uses compact radius for very wide clipped button-like filled frames", () => {
    const bundle = createM5StaticDesignBundle();
    const button = bundle.pages[0]!.nodes.find(
      (node) => node.id === "figma-signin-button",
    );
    if (!button) {
      throw new Error("fixture button not found");
    }
    button.visual = {
      fillCount: 1,
      strokeCount: 0,
      effectCount: 0,
      vectorPathCount: 0,
      clipsContent: true,
    };
    button.designValueRefs = ["button-fill"];
    bundle.designValues = [
      {
        id: "button-fill",
        name: "color.fill.button",
        origin: "inferred",
        kind: "color",
        value: { r: 0, g: 0.4, b: 1, a: 1 },
      },
    ];

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    const buttonFrame = result.nodes.find(
      (node) => node.id === "ui-login-figma-signin-button",
    );
    expect(buttonFrame?.style?.borderRadius).toBe(8);
  });

  it("infers pill radius for short clipped button-like filled frames", () => {
    const bundle = createM5StaticDesignBundle();
    const button = bundle.pages[0]!.nodes.find(
      (node) => node.id === "figma-signin-button",
    );
    if (!button) {
      throw new Error("fixture button not found");
    }
    button.bounds = { x: 784, y: 380, width: 142, height: 36 };
    button.visual = {
      fillCount: 1,
      strokeCount: 0,
      effectCount: 0,
      vectorPathCount: 0,
      clipsContent: true,
    };
    button.designValueRefs = ["button-fill"];
    bundle.designValues = [
      {
        id: "button-fill",
        name: "color.fill.button",
        origin: "inferred",
        kind: "color",
        value: { r: 0, g: 0.4, b: 1, a: 1 },
      },
    ];

    const result = mapPageNodes({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pagePath: "/login",
      visualLayers: [],
    });

    const buttonFrame = result.nodes.find(
      (node) => node.id === "ui-login-figma-signin-button",
    );
    expect(buttonFrame?.style?.borderRadius).toBe(18);
  });

});
