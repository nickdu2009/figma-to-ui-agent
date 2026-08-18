import { createHash } from "node:crypto";

import type {
  DesignBundle,
  DesignBundleDraft,
  LocalImageRef,
} from "../../../src/design-bundle/schema.ts";
import type {
  UISpec,
  UISpecDraft,
} from "../../../src/ui-spec/schema.ts";
import {
  createDesignBundleDraft,
  createUISpecDraft,
} from "../contracts.ts";

export function sourceHash(sourceId: string): string {
  return createHash("sha256").update(sourceId).digest("hex");
}

export function createMultipageFlowDesignBundleDraft(
  projectId = "demo-project",
): DesignBundleDraft {
  const draft = createDesignBundleDraft(projectId);
  draft.pages[0]!.nodes.push(
    {
      id: "figma-continue",
      parentId: "figma-root",
      kind: "instance",
      name: "Continue to quote",
      visible: true,
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    },
    {
      id: "figma-mystery",
      parentId: "figma-root",
      kind: "instance",
      name: "Mystery action",
      visible: true,
      styleRefs: [],
      imageRefs: [],
      boundVariableRefs: [],
      designValueRefs: [],
      warningCodes: [],
    },
  );
  draft.pages.push({
    id: "page-quote",
    name: "报价",
    width: 1440,
    height: 900,
    rootNodeIds: ["figma-quote-root"],
    nodes: [
      {
        id: "figma-quote-root",
        kind: "container",
        name: "Quote Root",
        visible: true,
        styleRefs: ["style-background"],
        imageRefs: [],
        boundVariableRefs: [],
        designValueRefs: ["color.background"],
        warningCodes: [],
      },
    ],
  });
  return draft;
}

export function withFlowScreenshots(
  draft: DesignBundleDraft,
  homeScreenshot: LocalImageRef,
  quoteScreenshot: LocalImageRef,
): DesignBundleDraft {
  draft.screenshots = [homeScreenshot, quoteScreenshot];
  draft.provenance = [
    {
      entityKind: "page",
      entityId: "page-home",
      origin: "figma_node",
      sourceIdHash: sourceHash("page-home"),
    },
    {
      entityKind: "screenshot",
      entityId: homeScreenshot.path,
      origin: "figma_node",
      sourceIdHash: sourceHash("page-home"),
    },
    {
      entityKind: "page",
      entityId: "page-quote",
      origin: "figma_node",
      sourceIdHash: sourceHash("page-quote"),
    },
    {
      entityKind: "screenshot",
      entityId: quoteScreenshot.path,
      origin: "figma_node",
      sourceIdHash: sourceHash("page-quote"),
    },
  ];
  return draft;
}

export function createStoredMultipageFlowDesignBundle(
  projectId = "demo-project",
): DesignBundle {
  return {
    ...createMultipageFlowDesignBundleDraft(projectId),
    revision: 1,
  };
}

export function createMultipageFlowUISpecDraft(
  projectId = "demo-project",
  sourceDesignBundleRevision = 1,
): UISpecDraft {
  const draft = createUISpecDraft(projectId, sourceDesignBundleRevision);
  const continueNode = draft.nodes.find((node) => node.id === "continue");
  if (continueNode?.kind === "button") {
    delete continueNode.actionId;
    continueNode.label = "继续报价";
  }
  draft.actions = [];
  draft.behaviorFixtures = [];
  const root = draft.nodes.find((node) => node.id === "root");
  if (root?.kind === "stack") {
    root.childIds = [...root.childIds, "mystery"];
  }
  draft.nodes.push({
    id: "mystery",
    kind: "button",
    label: "操作",
    variant: "secondary",
    designValueRefs: [],
  });
  draft.pages.push({
    id: "quote",
    sourcePageId: "page-quote",
    path: "/quote",
    title: "报价",
    rootNodeId: "quote-root",
  });
  draft.nodes.push(
    {
      id: "quote-root",
      kind: "stack",
      direction: "vertical",
      childIds: ["quote-title"],
      designValueRefs: ["color.background"],
    },
    {
      id: "quote-title",
      kind: "text",
      text: "报价页面",
      variant: "heading",
      designValueRefs: [],
    },
  );
  draft.viewports = [
    {
      id: "desktop",
      width: 320,
      height: 240,
      deviceScaleFactor: 1,
    },
  ];
  return draft;
}

export function createStoredMultipageFlowUISpec(
  projectId = "demo-project",
): UISpec {
  return {
    ...createMultipageFlowUISpecDraft(projectId),
    revision: 1,
  };
}
