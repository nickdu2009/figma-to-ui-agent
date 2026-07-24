import type { DesignBundleDraft } from "../../src/design-bundle/schema.ts";
import type { UISpecDraft } from "../../src/ui-spec/schema.ts";

export const FIXTURE_ASSET_SHA = "a".repeat(64);
export const FIXTURE_ASSET_PATH =
  `figma/assets/${FIXTURE_ASSET_SHA}.png`;
export const FIXTURE_SCREENSHOT_SHA = "c".repeat(64);
export const FIXTURE_SCREENSHOT_PATH =
  `figma/screenshots/${FIXTURE_SCREENSHOT_SHA}.png`;

export function createDesignBundleDraft(
  projectId = "demo-project",
): DesignBundleDraft {
  return {
    schemaVersion: "1",
    projectId,
    source: {
      provider: "figma_rest",
      fileKeyHash: "b".repeat(64),
      targetNodeIds: ["figma-root"],
      inspectedAt: "2026-07-23T10:00:00.000Z",
    },
    capabilities: {
      variables: {
        status: "unavailable_optional",
        reasonCode: "plan_limited",
      },
    },
    pages: [
      {
        id: "page-home",
        name: "首页",
        width: 1440,
        height: 900,
        rootNodeIds: ["figma-root"],
        nodes: [
          {
            id: "figma-root",
            kind: "container",
            name: "Root",
            visible: true,
            styleRefs: ["style-background"],
            imageRefs: [],
            boundVariableRefs: [],
            designValueRefs: ["color.background"],
            warningCodes: [],
          },
          {
            id: "figma-image",
            parentId: "figma-root",
            kind: "image",
            name: "Product",
            visible: true,
            imageRefs: [FIXTURE_ASSET_PATH],
            styleRefs: [],
            boundVariableRefs: [],
            designValueRefs: [],
            warningCodes: [],
          },
        ],
      },
    ],
    components: [],
    styles: [
      {
        id: "style-background",
        name: "Background",
        kind: "color",
        value: { r: 1, g: 1, b: 1, a: 1 },
      },
    ],
    designValues: [
      {
        id: "color.background",
        name: "color.background",
        origin: "inferred",
        kind: "color",
        value: { r: 1, g: 1, b: 1, a: 1 },
      },
    ],
    screenshots: [],
    assets: [
      {
        path: FIXTURE_ASSET_PATH,
        sha256: FIXTURE_ASSET_SHA,
        byteCount: 128,
        mimeType: "image/png",
        width: 640,
        height: 480,
      },
    ],
    provenance: [],
    warnings: [],
  };
}

export function createUISpecDraft(
  projectId = "demo-project",
  sourceDesignBundleRevision = 1,
): UISpecDraft {
  return {
    schemaVersion: "1",
    catalogVersion: "1",
    projectId,
    sourceDesignBundleRevision,
    designValueRefs: ["color.background"],
    pages: [
      {
        id: "home",
        sourcePageId: "page-home",
        path: "/",
        title: "首页",
        rootNodeId: "root",
      },
    ],
    nodes: [
      {
        id: "root",
        kind: "stack",
        direction: "vertical",
        childIds: ["title", "image", "continue"],
        designValueRefs: ["color.background"],
      },
      {
        id: "title",
        kind: "text",
        text: "设计预览",
        variant: "heading",
        designValueRefs: [],
      },
      {
        id: "image",
        kind: "image",
        assetRef: FIXTURE_ASSET_PATH,
        alt: "产品预览",
        fit: "contain",
        designValueRefs: [],
      },
      {
        id: "continue",
        kind: "button",
        label: "继续",
        actionId: "stay-home",
        variant: "primary",
        designValueRefs: [],
      },
    ],
    state: [],
    actions: [
      {
        id: "stay-home",
        kind: "navigate",
        pageId: "home",
      },
    ],
    viewports: [
      {
        id: "desktop",
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
      },
    ],
    behaviorFixtures: [
      {
        id: "home-basic",
        name: "首页基本行为",
        viewportId: "desktop",
        initialPageId: "home",
        steps: [
          { kind: "expect_visible", nodeId: "image" },
          { kind: "click", nodeId: "continue" },
          { kind: "expect_page", pageId: "home" },
        ],
      },
    ],
  };
}

export function createDesignBundleDraftWithScreenshot(
  projectId = "demo-project",
): DesignBundleDraft {
  const draft = createDesignBundleDraft(projectId);
  draft.screenshots = [
    {
      path: FIXTURE_SCREENSHOT_PATH,
      sha256: FIXTURE_SCREENSHOT_SHA,
      byteCount: 128,
      mimeType: "image/png",
      width: 1440,
      height: 900,
    },
  ];
  return draft;
}

export function createRootScreenshotUISpecDraft(
  projectId = "demo-project",
  sourceDesignBundleRevision = 1,
): UISpecDraft {
  const draft = createUISpecDraft(
    projectId,
    sourceDesignBundleRevision,
  );
  draft.nodes = [
    {
      id: "root",
      kind: "stack",
      direction: "vertical",
      childIds: ["screenshot"],
      designValueRefs: ["color.background"],
    },
    {
      id: "screenshot",
      kind: "image",
      assetRef: FIXTURE_SCREENSHOT_PATH,
      alt: "整页截图",
      fit: "fill",
      designValueRefs: [],
    },
  ];
  draft.actions = [];
  draft.behaviorFixtures = [];
  return draft;
}
