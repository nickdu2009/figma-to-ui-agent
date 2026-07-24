import { describe, expect, it } from "vitest";

import { designBundleSchema } from "../../../src/design-bundle/schema.ts";
import { buildInspectAgentContext } from "../../../src/runtime/inspect-agent-context.ts";
import {
  FIXTURE_SCREENSHOT_PATH,
  FIXTURE_SCREENSHOT_SHA,
  createDesignBundleDraft,
} from "../../fixtures/contracts.ts";

describe("inspect Agent 上下文", () => {
  it("提供生成 UISpec 所需的脱敏节点、设计值和截图引用", () => {
    const draft = createDesignBundleDraft();
    const visualNode = draft.pages[0]!.nodes.find(
      (node) => node.id === "figma-image",
    );
    if (visualNode) {
      visualNode.name = "Layer 1";
      visualNode.bounds = { x: 34, y: 68, width: 640, height: 480 };
      visualNode.visual = {
        opacity: 0.92,
        fillCount: 1,
        strokeCount: 0,
        effectCount: 1,
        vectorPathCount: 0,
      };
    }
    const rootNode = draft.pages[0]!.nodes.find(
      (node) => node.id === "figma-root",
    );
    if (rootNode) {
      rootNode.bounds = { x: 10, y: 20, width: 1440, height: 900 };
    }
    draft.pages[0]!.nodes.push({
      id: "figma-title",
      parentId: "figma-root",
      kind: "text",
      name: "Title",
      visible: true,
      bounds: { x: 50, y: 90, width: 160, height: 48 },
      text: {
        characters: "Welcome",
      },
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    });
    draft.screenshots = [
      {
        path: FIXTURE_SCREENSHOT_PATH,
        sha256: FIXTURE_SCREENSHOT_SHA,
        byteCount: 128,
        mimeType: "image/png",
        width: 640,
        height: 480,
      },
    ];
    draft.provenance = [
      {
        entityKind: "page",
        entityId: "page-home",
        origin: "figma_node",
        sourceIdHash: "c".repeat(64),
      },
      {
        entityKind: "node",
        entityId: "figma-image",
        origin: "figma_node",
        sourceIdHash: "d".repeat(64),
      },
      {
        entityKind: "screenshot",
        entityId: FIXTURE_SCREENSHOT_PATH,
        origin: "figma_node",
        sourceIdHash: "d".repeat(64),
      },
    ];
    const bundle = designBundleSchema.parse({
      ...draft,
      revision: 1,
    });
    const context = buildInspectAgentContext(bundle);

    expect(context).toMatchObject({
      kind: "inspect_agent_context",
      projectId: "demo-project",
      designBundleRevision: 1,
      designValues: [
        {
          id: "color.background",
          origin: "inferred",
        },
      ],
    });
    expect(context.pages[0]).toMatchObject({
      id: "page-home",
      nodeCount: 3,
    });
    expect(context.pages[0]?.nodes[0]).toMatchObject({
      id: "figma-root",
      kind: "container",
    });
    expect(context.pages[0]?.visualLayers).toEqual([
      expect.objectContaining({
        id: "figma-image",
        kind: "image",
        reason: "image_visual",
        layerRole: "illustration_or_image",
        pageRelativeBounds: {
          x: 24,
          y: 48,
          width: 640,
          height: 480,
        },
        visual: expect.objectContaining({
          opacity: 0.92,
          fillCount: 1,
          effectCount: 1,
        }),
        siblingContentNodeCount: 1,
        overlapContentNodeCount: 1,
        nearbyContentNodeCount: 0,
        laterContentOverlapCount: 1,
        renderedAssetPath: FIXTURE_SCREENSHOT_PATH,
        exportableAsLocalAsset: true,
        recommendedUISpecUse: "image",
      }),
    ]);
    expect(JSON.stringify(context)).not.toContain(
      bundle.source.fileKeyHash,
    );
  });
});
