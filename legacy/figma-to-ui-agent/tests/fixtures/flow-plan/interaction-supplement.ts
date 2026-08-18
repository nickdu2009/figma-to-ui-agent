import type { InteractionSupplement } from "../../../src/flow-plan/draft.ts";

export function createInteractionSupplement(
  projectId = "demo-project",
  sourceDesignBundleRevision = 1,
): InteractionSupplement {
  return {
    schemaVersion: "m4-spike",
    projectId,
    sourceDesignBundleRevision,
    rawSource: "fixture",
    interactions: [
      {
        id: "figma-continue-to-quote",
        sourceNodeId: "figma-continue",
        uiNodeId: "continue",
        sourceNodeName: "Continue to quote",
        trigger: "click",
        actionType: "node",
        targetNodeId: "figma-quote-root",
      },
    ],
  };
}
