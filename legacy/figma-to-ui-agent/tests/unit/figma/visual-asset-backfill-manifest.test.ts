import { describe, expect, it } from "vitest";

import type { DesignBundle } from "../../../src/design-bundle/schema.ts";
import {
  createVisualAssetBackfillManifest,
} from "../../../src/figma/visual-asset-backfill-manifest.ts";
import { createDesignBundleDraft } from "../../fixtures/contracts.ts";

function bundleWithVisualNodes(): DesignBundle {
  const draft = createDesignBundleDraft("backfill-demo");
  draft.pages = [
    {
      id: "page-dashboard",
      name: "Dashboard",
      width: 1440,
      height: 900,
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "container",
          name: "Dashboard",
          visible: true,
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          styleRefs: [],
          imageRefs: [],
          boundVariableRefs: [],
          designValueRefs: [],
          warningCodes: [],
        },
        {
          id: "combined-parent",
          parentId: "root",
          kind: "container",
          name: "Combined Shape",
          visible: true,
          bounds: { x: 64, y: 72, width: 220, height: 180 },
          visual: {
            fillCount: 1,
            strokeCount: 0,
            effectCount: 1,
            vectorPathCount: 4,
          },
          styleRefs: [],
          imageRefs: [],
          boundVariableRefs: [],
          designValueRefs: [],
          warningCodes: [],
        },
        {
          id: "combined-child",
          parentId: "combined-parent",
          kind: "vector",
          name: "Union",
          visible: true,
          bounds: { x: 80, y: 90, width: 80, height: 80 },
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
          id: "back-icon",
          parentId: "root",
          kind: "vector",
          name: "Back icon",
          visible: true,
          bounds: { x: 20, y: 20, width: 24, height: 24 },
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
  ];
  return { ...draft, revision: 1 };
}

describe("createVisualAssetBackfillManifest", () => {
  it("选择 compound parent 和通用 icon，排除 root 与被 parent 覆盖的 operand", () => {
    const manifest = createVisualAssetBackfillManifest({
      bundle: bundleWithVisualNodes(),
    });

    expect(manifest.entries.map((entry) => entry.sourceNodeId)).toEqual([
      "back-icon",
      "combined-parent",
    ]);
    expect(
      manifest.entries.map((entry) => entry.sourceNodeId),
    ).not.toContain("root");
    expect(
      manifest.entries.map((entry) => entry.sourceNodeId),
    ).not.toContain("combined-child");
    expect(manifest.entries[0]).toMatchObject({
      sourcePageId: "page-dashboard",
      sourceNodeIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("将 report 诊断指向的小型缺失 visual 节点纳入 backfill manifest", () => {
    const bundle = bundleWithVisualNodes();
    bundle.pages[0].nodes.push({
      id: "unnamed-stroke-icon",
      parentId: "root",
      kind: "vector",
      name: "Vector",
      visible: true,
      bounds: { x: 72, y: 20, width: 12, height: 18 },
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
    });

    const manifest = createVisualAssetBackfillManifest({
      bundle,
      report: {
        unsupportedFeatures: [
          {
            code: "visual_stroke_icon_no_asset",
            severity: "fallback_ok",
            evidenceSource: "schema_limit",
            figmaNodeRefs: ["unnamed-stroke-icon"],
            impact: ["visual"],
            recommendedAction: "defer",
          },
        ],
      },
    });

    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        sourceNodeId: "unnamed-stroke-icon",
        reasonCode: "diagnostic_missing_asset",
      }),
    );
  });

  it("排除已被 rendered ancestor visual layer 覆盖的子节点", () => {
    const manifest = createVisualAssetBackfillManifest({
      bundle: bundleWithVisualNodes(),
      report: {
        unsupportedFeatures: [],
        visualLayers: [
          {
            sourceNodeId: "combined-parent",
            sourcePageId: "page-dashboard",
            reason: "structural_visual",
            layerRole: "decorative_background",
            zOrder: 1,
            bounds: { x: 64, y: 72, width: 220, height: 180 },
            pageRelativeBounds: { x: 64, y: 72, width: 220, height: 180 },
            uiSpecNodeId: "vl-dashboard-combined-parent",
            rendered: true,
          },
        ],
      },
    });

    expect(
      manifest.entries.map((entry) => entry.sourceNodeId),
    ).not.toContain("combined-child");
  });

  it("排除自身已经 rendered 的 visual layer", () => {
    const manifest = createVisualAssetBackfillManifest({
      bundle: bundleWithVisualNodes(),
      report: {
        unsupportedFeatures: [],
        visualLayers: [
          {
            sourceNodeId: "combined-parent",
            sourcePageId: "page-dashboard",
            reason: "structural_visual",
            layerRole: "decorative_background",
            zOrder: 1,
            bounds: { x: 64, y: 72, width: 220, height: 180 },
            pageRelativeBounds: { x: 64, y: 72, width: 220, height: 180 },
            uiSpecNodeId: "vl-dashboard-combined-parent",
            rendered: true,
          },
        ],
      },
    });

    expect(
      manifest.entries.map((entry) => entry.sourceNodeId),
    ).not.toContain("combined-parent");
  });
});
