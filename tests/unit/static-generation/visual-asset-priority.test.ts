import { describe, expect, it } from "vitest";

import type { NormalizedPage } from "../../../src/design-bundle/schema.ts";
import {
  analyzeVisualAssetCandidates,
  planVisualAssetExports,
} from "../../../src/static-generation/visual-asset-priority.ts";

describe("visual asset priority", () => {
  it("selects named illustration containers as compound visual assets", () => {
    const page: NormalizedPage = {
      id: "page-home",
      name: "Home",
      width: 1440,
      height: 900,
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "container",
          name: "Home",
          visible: true,
          bounds: { x: 0, y: 0, width: 1440, height: 900 },
          styleRefs: [],
          imageRefs: [],
          boundVariableRefs: [],
          designValueRefs: [],
          warningCodes: [],
        },
        {
          id: "illustration",
          parentId: "root",
          kind: "container",
          name: "Illustration",
          visible: true,
          bounds: { x: 900, y: 120, width: 320, height: 260 },
          styleRefs: [],
          imageRefs: [],
          boundVariableRefs: [],
          designValueRefs: [],
          warningCodes: [],
        },
        {
          id: "vector-a",
          parentId: "illustration",
          kind: "vector",
          name: "Vector",
          visible: true,
          bounds: { x: 930, y: 140, width: 160, height: 180 },
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
      ],
    };

    const candidates = analyzeVisualAssetCandidates(
      page,
      { x: 0, y: 0 },
      1440 * 900,
    );

    const illustration = candidates.find(
      (candidate) => candidate.sourceNodeId === "illustration",
    );
    expect(illustration).toMatchObject({
      eligible: true,
      reasonCode: "named_decorative",
      budgetGroup: "named_decorative",
    });

    const child = candidates.find(
      (candidate) => candidate.sourceNodeId === "vector-a",
    );
    expect(child).toMatchObject({
      eligible: false,
      reasonCode: "covered_by_parent_asset",
      coveredByParentAsset: true,
    });

    const plan = planVisualAssetExports(candidates);
    expect(plan.selected.map((candidate) => candidate.sourceNodeId)).toContain(
      "illustration",
    );
  });

  it("promotes painted generic vectors above the tiny-safe threshold", () => {
    const page: NormalizedPage = {
      id: "page-mobile",
      name: "Mobile",
      width: 375,
      height: 812,
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "container",
          name: "Mobile",
          visible: true,
          bounds: { x: 0, y: 0, width: 375, height: 812 },
          styleRefs: [],
          imageRefs: [],
          boundVariableRefs: [],
          designValueRefs: [],
          warningCodes: [],
        },
        {
          id: "rectangle",
          parentId: "root",
          kind: "vector",
          name: "Rectangle 10",
          visible: true,
          bounds: { x: 16, y: 100, width: 320, height: 44 },
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
      ],
    };

    const candidates = analyzeVisualAssetCandidates(
      page,
      { x: 0, y: 0 },
      375 * 812,
    );

    expect(
      candidates.find((candidate) => candidate.sourceNodeId === "rectangle"),
    ).toMatchObject({
      eligible: true,
      reasonCode: "structural_visual",
      budgetGroup: "structural_visual",
    });
  });

});
