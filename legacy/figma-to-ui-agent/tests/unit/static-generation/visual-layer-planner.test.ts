import { describe, expect, it } from "vitest";

import {
  planVisualLayers,
  toReportVisualLayers,
} from "../../../src/static-generation/visual-layer-planner.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";
import { createM5StaticDesignBundle } from "../../fixtures/static-generation/m5-static-fixture.ts";

describe("planVisualLayers", () => {
  it("identifies blob vector as pixel overlay candidate", () => {
    const bundle = createM5StaticDesignBundle();
    const result = planVisualLayers({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const blob = result.layers.find(
      (layer) => layer.sourceNodeId === "figma-left-visual",
    );
    expect(blob).toBeDefined();
    expect(blob?.reason).toBe("large_visual");
    expect(blob?.uiNode?.kind).toBe("pixel_overlay");
    if (blob?.uiNode?.kind === "pixel_overlay") {
      expect(blob.uiNode.frame).toBeUndefined();
      expect(blob.uiNode.style).toMatchObject({
        left: 0,
        top: 0,
        width: 720,
        height: 900,
      });
    }
    expect(blob?.rendered).toBe(true);
  });

  it("does not duplicate structured image nodes as visual layers", () => {
    const bundle = createM5StaticDesignBundle();
    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const hero = result.layers.find(
      (layer) => layer.sourceNodeId === "figma-dashboard-image",
    );
    expect(hero).toBeUndefined();
  });

  it("records unrendered visual layers when asset is missing", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    const vector = page.nodes.find((n) => n.id === "figma-dashboard-image")!;
    vector.imageRefs = [];
    vector.kind = "vector";
    vector.name = "decorative blob";
    vector.bounds = { x: 0, y: 0, width: 600, height: 340 };
    vector.visual = {
      fillCount: 1,
      strokeCount: 0,
      effectCount: 0,
      vectorPathCount: 3,
    };

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (l) => l.sourceNodeId === "figma-dashboard-image",
    );
    expect(layer?.rendered).toBe(false);
    expect(layer?.blockedReason).toBeDefined();
  });

  it("renders medium assetless structural vectors as cropped page overlays", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push({
      id: "assetless-card-strip",
      parentId: "figma-dashboard-root",
      kind: "vector",
      name: "Rectangle 23",
      visible: true,
      bounds: { x: 24, y: 280, width: 265, height: 51 },
      visual: {
        fillCount: 1,
        strokeCount: 0,
        effectCount: 0,
        vectorPathCount: 0,
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "assetless-card-strip",
    );
    expect(layer).toMatchObject({
      reason: "structural_visual",
      rendered: true,
      assetRef: expect.stringMatching(/^figma\/screenshots\//),
      pageRelativeBounds: {
        x: 24,
        y: 280,
        width: 265,
        height: 51,
      },
    });
    expect(layer?.uiNode).toMatchObject({
      kind: "pixel_overlay",
      frame: {
        x: 24,
        y: 280,
        width: 265,
        height: 51,
      },
      style: {
        left: 24,
        top: 280,
        width: 265,
        height: 51,
      },
    });
  });

  it("clamps zero-sized stroke screenshot overlays to a renderable pixel", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    const screenshotPath = `figma/screenshots/${"1".repeat(64)}.png`;
    page.nodes.push({
      id: "zero-height-divider",
      parentId: "figma-dashboard-root",
      kind: "vector",
      name: "Divider",
      visible: true,
      bounds: { x: 48, y: 144, width: 240, height: 0 },
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
    });
    bundle.screenshots.push({
      path: screenshotPath,
      sha256: "1".repeat(64),
      byteCount: 128,
      mimeType: "image/png",
      width: 240,
      height: 1,
    });
    bundle.provenance.push(
      {
        entityKind: "node",
        entityId: "zero-height-divider",
        origin: "figma_node",
        sourceIdHash: "zero-height-divider-hash",
      },
      {
        entityKind: "screenshot",
        entityId: screenshotPath,
        origin: "figma_node",
        sourceIdHash: "zero-height-divider-hash",
      },
    );

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "zero-height-divider",
    );
    expect(layer?.rendered).toBe(true);
    expect(layer?.uiNode?.kind).toBe("pixel_overlay");
    if (layer?.uiNode?.kind === "pixel_overlay") {
      expect(layer.uiNode.height).toBe(1);
      expect(layer.uiNode.style?.height).toBe(1);
      expect(layer.uiNode.style?.width).toBe(240);
    }
  });

  it("renders simple assetless filled vectors as decorative shape layers", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push({
      id: "simple-bg-vector",
      parentId: "figma-dashboard-root",
      kind: "vector",
      name: "Bg",
      visible: true,
      bounds: { x: 40, y: 48, width: 30, height: 30 },
      visual: {
        fillCount: 1,
        strokeCount: 0,
        effectCount: 0,
        vectorPathCount: 0,
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: ["simple-bg-fill"],
      warningCodes: [],
    });
    bundle.designValues.push({
      id: "simple-bg-fill",
      name: "color.fill.simple-bg",
      origin: "inferred",
      kind: "color",
      value: { r: 0.95, g: 0.96, b: 0.98, a: 1 },
    });

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "simple-bg-vector",
    );
    expect(layer?.rendered).toBe(true);
    expect(layer?.assetRef).toBeUndefined();
    expect(layer?.uiNode?.kind).toBe("stack");
    expect(layer?.uiNode?.style).toMatchObject({
      backgroundColor: "#F2F5FA",
      borderRadius: 15,
      pointerEvents: "none",
      left: 40,
      top: 48,
      width: 30,
      height: 30,
    });
  });

  it("renders budget-exceeded small painted vectors as CSS shapes", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    bundle.designValues.push({
      id: "white-fill",
      name: "color.fill.white",
      origin: "inferred",
      kind: "color",
      value: { r: 1, g: 1, b: 1, a: 1 },
    });
    for (let index = 0; index < 170; index += 1) {
      page.nodes.push({
        id: `large-shape-${index}`,
        parentId: "figma-dashboard-root",
        kind: "vector",
        name: `Large shape ${index}`,
        visible: true,
        bounds: { x: 20, y: 20 + index, width: 120, height: 120 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
          effectCount: 0,
          vectorPathCount: 0,
        },
        styleRefs: [],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["white-fill"],
        warningCodes: [],
      });
    }
    page.nodes.push({
      id: "legend-ring",
      parentId: "figma-dashboard-root",
      kind: "vector",
      name: "Rectangle 8",
      visible: true,
      bounds: { x: 360, y: 720, width: 20, height: 20 },
      visual: {
        fillCount: 1,
        strokeCount: 1,
        strokeWeight: 4,
        strokeColor: { r: 0.25, g: 0.45, b: 0.93, a: 1 },
        effectCount: 0,
        vectorPathCount: 0,
        cornerRadius: 10,
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: ["white-fill"],
      warningCodes: [],
    });

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "legend-ring",
    );
    expect(layer?.rendered).toBe(true);
    expect(layer?.uiNode?.kind).toBe("stack");
    expect(layer?.uiNode?.style).toMatchObject({
      backgroundColor: "#FFFFFF",
      borderColor: "#4073ED",
      borderWidth: 4,
      borderRadius: 10,
    });
    expect(result.unsupportedFeatures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "visual_asset_budget_exceeded",
          figmaNodeRefs: ["legend-ring"],
        }),
      ]),
    );
  });

  it("renders assetless edit icon groups as controlled symbol icons", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push(
      {
        id: "edit-icon",
        parentId: "figma-dashboard-root",
        kind: "instance",
        name: "Edit / Icon",
        visible: true,
        bounds: { x: 200, y: 120, width: 28, height: 28 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
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
        id: "edit-icon-stroke",
        parentId: "edit-icon",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 208, y: 126, width: 12, height: 16 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
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

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    expect(result.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: "edit-icon",
          uiNode: expect.objectContaining({ kind: "icon", symbol: "edit" }),
        }),
      ]),
    );
    expect(result.unsupportedFeatures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "visual_stroke_icon_no_asset",
          figmaNodeRefs: ["edit-icon-stroke"],
        }),
      ]),
    );
  });

  it("renders assetless trailing chevrons as controlled symbol icons", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push(
      {
        id: "select-trailing",
        parentId: "figma-dashboard-root",
        kind: "instance",
        name: "Trailing Icon",
        visible: true,
        bounds: { x: 220, y: 128, width: 20, height: 20 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
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
        id: "select-chevron",
        parentId: "select-trailing",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 225, y: 135, width: 10, height: 5 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          strokeWeight: 1.5,
          strokeColor: { r: 0.5, g: 0.505, b: 0.573, a: 1 },
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

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "select-chevron",
    );
    expect(layer?.rendered).toBe(true);
    expect(layer?.uiNode).toMatchObject({
      kind: "icon",
      symbol: "chevron-down",
      decorative: true,
      style: {
        left: 225,
        top: 135,
        width: 10,
        height: 5,
        textColor: "#808192",
        pointerEvents: "none",
      },
    });
    expect(result.unsupportedFeatures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          figmaNodeRefs: ["select-chevron"],
        }),
      ]),
    );
  });

  it("renders assetless info stroke icons as one controlled symbol icon", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push(
      {
        id: "info-icon",
        parentId: "figma-dashboard-root",
        kind: "instance",
        name: "info",
        visible: true,
        bounds: { x: 260, y: 128, width: 18, height: 18 },
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
        id: "info-icon-ring",
        parentId: "info-icon",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 260, y: 128, width: 75, height: 75 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          strokeWeight: 2,
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
      {
        id: "info-icon-mark",
        parentId: "info-icon",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 261.5, y: 129.5, width: 15, height: 15 },
        visual: {
          fillCount: 0,
          strokeCount: 1,
          strokeWeight: 1.4,
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

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "info-icon",
    );
    expect(layer?.rendered).toBe(true);
    expect(layer?.uiNode).toMatchObject({
      kind: "icon",
      symbol: "info",
      decorative: true,
      style: {
        left: 260,
        top: 128,
        width: 18,
        height: 18,
        textColor: "#808192",
        pointerEvents: "none",
      },
    });
    expect(
      result.layers.filter((candidate) => candidate.sourceNodeId === "info-icon"),
    ).toHaveLength(1);
    expect(result.unsupportedFeatures).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          figmaNodeRefs: ["info-icon-ring"],
        }),
        expect.objectContaining({
          figmaNodeRefs: ["info-icon-mark"],
        }),
      ]),
    );
  });

  it("renders named assetless icon groups as controlled symbols", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push(
      {
        id: "plus-icon",
        parentId: "figma-dashboard-root",
        kind: "container",
        name: "plus",
        visible: true,
        bounds: { x: 300, y: 128, width: 20, height: 20 },
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
        id: "plus-icon-line",
        parentId: "plus-icon",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 306, y: 132, width: 0, height: 12 },
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
      {
        id: "users-icon",
        parentId: "figma-dashboard-root",
        kind: "instance",
        name: "users",
        visible: true,
        bounds: { x: 340, y: 128, width: 18, height: 18 },
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
        id: "users-icon-path",
        parentId: "users-icon",
        kind: "vector",
        name: "Vector (Stroke)",
        visible: true,
        bounds: { x: 343, y: 132, width: 12, height: 12 },
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
      {
        id: "cursor-icon",
        parentId: "figma-dashboard-root",
        kind: "container",
        name: "Cursor / Arrow",
        visible: true,
        bounds: { x: 380, y: 128, width: 30, height: 30 },
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
        id: "cursor-icon-path",
        parentId: "cursor-icon",
        kind: "vector",
        name: "Vector",
        visible: true,
        bounds: { x: 390, y: 136, width: 12, height: 16 },
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
      {
        id: "battery-icon",
        parentId: "figma-dashboard-root",
        kind: "container",
        name: "Battery",
        visible: true,
        bounds: { x: 430, y: 128, width: 27, height: 13 },
        visual: {
          fillCount: 0,
          strokeCount: 0,
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
        id: "battery-icon-fill",
        parentId: "battery-icon",
        kind: "vector",
        name: "Combined Shape",
        visible: true,
        bounds: { x: 452, y: 132, width: 2, height: 4 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
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
        id: "files-icon",
        parentId: "figma-dashboard-root",
        kind: "container",
        name: "Files",
        visible: true,
        bounds: { x: 470, y: 128, width: 18, height: 18 },
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
        id: "files-icon-path",
        parentId: "files-icon",
        kind: "vector",
        name: "Fill 417",
        visible: true,
        bounds: { x: 474, y: 132, width: 9, height: 10 },
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

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    expect(result.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceNodeId: "plus-icon",
          uiNode: expect.objectContaining({ kind: "icon", symbol: "plus" }),
        }),
        expect.objectContaining({
          sourceNodeId: "users-icon",
          uiNode: expect.objectContaining({ kind: "icon", symbol: "users" }),
        }),
        expect.objectContaining({
          sourceNodeId: "cursor-icon",
          uiNode: expect.objectContaining({
            kind: "icon",
            symbol: "cursor-arrow",
          }),
        }),
        expect.objectContaining({
          sourceNodeId: "battery-icon",
          uiNode: expect.objectContaining({ kind: "icon", symbol: "battery" }),
        }),
        expect.objectContaining({
          sourceNodeId: "files-icon",
          uiNode: expect.objectContaining({ kind: "icon", symbol: "generic" }),
        }),
      ]),
    );
  });

  it("renders modal background frames as cropped page composite overlays", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-dashboard")!;
    page.nodes.push(
      {
        id: "app-shell",
        parentId: "figma-dashboard-root",
        kind: "container",
        name: "base-layout",
        visible: true,
        bounds: { x: 80, y: 60, width: 900, height: 600 },
        visual: {
          fillCount: 1,
          strokeCount: 1,
          strokeWeight: 8,
          effectCount: 1,
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
        id: "invite-modal",
        parentId: "figma-dashboard-root",
        kind: "container",
        name: "Invite modal",
        visible: true,
        bounds: { x: 260, y: 160, width: 480, height: 300 },
        visual: {
          fillCount: 1,
          strokeCount: 0,
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

    const result = planVisualLayers({
      bundle,
      pagePlanId: "dashboard",
      sourcePageId: "page-dashboard",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "app-shell",
    );
    expect(layer).toMatchObject({
      reason: "background_composite",
      layerRole: "decorative_background",
      rendered: true,
      assetRef: expect.stringMatching(/^figma\/screenshots\//),
      pageRelativeBounds: {
        x: 72,
        y: 52,
        width: 1368,
        height: 848,
      },
    });
    expect(layer?.uiNode).toMatchObject({
      kind: "pixel_overlay",
      frame: {
        x: 72,
        y: 52,
        width: 1368,
        height: 848,
      },
      style: {
        left: 72,
        top: 52,
        width: 1368,
        height: 848,
      },
    });
  });

  it("expands effect screenshot overlays to intrinsic image bounds", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-login")!;
    page.nodes.push({
      id: "shadow-panel",
      parentId: "figma-login-root",
      kind: "vector",
      name: "Header shadow",
      visible: true,
      bounds: { x: 100, y: 80, width: 100, height: 40 },
      visual: {
        fillCount: 1,
        strokeCount: 0,
        effectCount: 1,
        vectorPathCount: 0,
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });
    bundle.screenshots.push({
      path: "figma/screenshots/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      sha256: "a".repeat(64),
      byteCount: 128,
      mimeType: "image/png",
      width: 140,
      height: 80,
    });
    bundle.provenance.push(
      {
        entityKind: "node",
        entityId: "shadow-panel",
        origin: "figma_node",
        sourceIdHash: "shadow-panel-hash",
      },
      {
        entityKind: "screenshot",
        entityId: "figma/screenshots/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        origin: "figma_node",
        sourceIdHash: "shadow-panel-hash",
      },
    );

    const result = planVisualLayers({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "shadow-panel",
    );
    expect(layer?.uiNode?.kind).toBe("pixel_overlay");
    expect(layer?.uiNode?.style).toMatchObject({
      left: 80,
      top: 60,
      width: 140,
      height: 80,
    });
    if (layer?.uiNode?.kind === "pixel_overlay") {
      expect(layer.uiNode.width).toBe(140);
      expect(layer.uiNode.height).toBe(80);
    }
  });

  it("top-aligns expanded stroke-only effect screenshots", () => {
    const bundle = createM5StaticDesignBundle();
    const page = bundle.pages.find((p) => p.id === "page-login")!;
    page.nodes.push({
      id: "shadow-line",
      parentId: "figma-login-root",
      kind: "vector",
      name: "Chart line",
      visible: true,
      bounds: { x: 100, y: 80, width: 100, height: 40 },
      visual: {
        fillCount: 0,
        strokeCount: 1,
        effectCount: 1,
        vectorPathCount: 0,
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });
    bundle.screenshots.push({
      path: "figma/screenshots/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
      sha256: "b".repeat(64),
      byteCount: 128,
      mimeType: "image/png",
      width: 140,
      height: 80,
    });
    bundle.provenance.push(
      {
        entityKind: "node",
        entityId: "shadow-line",
        origin: "figma_node",
        sourceIdHash: "shadow-line-hash",
      },
      {
        entityKind: "screenshot",
        entityId: "figma/screenshots/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
        origin: "figma_node",
        sourceIdHash: "shadow-line-hash",
      },
    );

    const result = planVisualLayers({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const layer = result.layers.find(
      (candidate) => candidate.sourceNodeId === "shadow-line",
    );
    expect(layer?.uiNode?.style).toMatchObject({
      left: 80,
      top: 80,
      width: 140,
      height: 80,
    });
  });

  it("produces UISpec nodes that pass strict schema", () => {
    const bundle = createM5StaticDesignBundle();
    const result = planVisualLayers({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const renderedLayers = result.layers.filter(
      (layer) => layer.uiNodeId && layer.uiNode,
    );
    const draft = {
      schemaVersion: "1",
      catalogVersion: "1",
      projectId: bundle.projectId,
      sourceDesignBundleRevision: bundle.revision,
      designValueRefs: [],
      pages: [
        {
          id: "login",
          sourcePageId: "page-login",
          path: "/login",
          title: "Login",
          rootNodeId: "root",
        },
      ],
      nodes: [
        {
          id: "root",
          kind: "stack",
          direction: "vertical",
          childIds: renderedLayers.map((layer) => layer.uiNodeId!),
          designValueRefs: [],
        },
        ...renderedLayers.map((layer) => layer.uiNode!),
      ],
      state: [],
      actions: [],
      viewports: [
        { id: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
      ],
      behaviorFixtures: [],
    };

    const parsed = uiSpecDraftSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
  });
});

describe("toReportVisualLayers", () => {
  it("maps layer plans to report entries", () => {
    const bundle = createM5StaticDesignBundle();
    const result = planVisualLayers({
      bundle,
      pagePlanId: "login",
      sourcePageId: "page-login",
      pageOrigin: { x: 0, y: 0 },
      pageArea: 1440 * 900,
    });

    const reportLayers = toReportVisualLayers(result.layers);
    expect(reportLayers.length).toBe(result.layers.length);
    for (const layer of reportLayers) {
      expect(layer.sourcePageId).toBe("page-login");
      expect(layer.bounds).toBeDefined();
      expect(layer.pageRelativeBounds).toBeDefined();
    }
  });
});
