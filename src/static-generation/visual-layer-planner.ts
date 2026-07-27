import type {
  DesignBundle,
  NormalizedNode,
} from "../design-bundle/schema.ts";
import type { UINode } from "../ui-spec/schema.ts";
import type {
  M5StaticReport,
  M5StaticVisualLayer,
} from "./report.ts";
import {
  analyzeVisualAssetCandidates,
  planVisualAssetExports,
  screenshotPathForNode,
  type VisualAssetCandidate,
} from "./visual-asset-priority.ts";
import { mapNodeStyle } from "./style-mapper.ts";

type IconSymbol =
  | "chevron-down"
  | "info"
  | "plus"
  | "users"
  | "cursor-arrow"
  | "battery";

export type VisualLayerReason =
  | "large_visual"
  | "structural_visual"
  | "background_composite"
  | "named_visual"
  | "image_visual"
  | "button_icon"
  | "logo"
  | "nav_icon"
  | "line_divider";

export interface VisualLayerPlan {
  readonly sourceNodeId: string;
  readonly sourcePageId: string;
  readonly reason: VisualLayerReason;
  readonly layerRole: string;
  readonly zOrder: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly pageRelativeBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  readonly opacity?: number;
  readonly assetRef?: string;
  readonly uiNodeId?: string;
  readonly uiNode?: UINode;
  readonly rendered: boolean;
  readonly blockedReason?: string;
}

function candidateReasonToLayerReason(
  candidate: VisualAssetCandidate,
): VisualLayerReason {
  switch (candidate.reasonCode) {
    case "image_fill":
      return "image_visual";
    case "button_icon":
      return "button_icon";
    case "named_logo":
      return "logo";
    case "nav_header_icon":
    case "named_icon":
      return "nav_icon";
    case "line_or_divider":
      return "line_divider";
    case "large_visual":
      return "large_visual";
    case "structural_visual":
      return "structural_visual";
    case "named_decorative":
      return "named_visual";
    default:
      return "named_visual";
  }
}

function layerRole(reason: VisualLayerReason): string {
  switch (reason) {
    case "image_visual":
      return "illustration_or_image";
    case "large_visual":
    case "structural_visual":
    case "background_composite":
      return "decorative_background";
    case "named_visual":
      return "decorative_shape";
    case "button_icon":
      return "button_icon";
    case "logo":
      return "logo";
    case "nav_icon":
      return "icon";
    case "line_divider":
      return "line_or_divider";
    default:
      return "decorative_background";
  }
}

function stableUINodeId(
  pagePlanId: string,
  sourceNodeId: string,
): string {
  return `vl-${pagePlanId}-${sourceNodeId.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function nodeRelativeBounds(
  bounds: NonNullable<NormalizedNode["bounds"]>,
  pageOrigin: { x: number; y: number },
): VisualLayerPlan["pageRelativeBounds"] {
  return {
    x: bounds.x - pageOrigin.x,
    y: bounds.y - pageOrigin.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function positiveRenderDimension(value: number): number {
  return value > 0 ? value : 1;
}

function buildOverlayUINode(
  candidate: VisualAssetCandidate,
  pagePlanId: string,
  reason: VisualLayerReason,
  assetRef: string,
  opacity: number | undefined,
  assetSize: { width: number; height: number } | undefined,
  hasEffect: boolean,
  topAlignedStrokeEffect: boolean,
): UINode {
  const uiNodeId = stableUINodeId(pagePlanId, candidate.sourceNodeId);
  const pageRelative = candidate.pageRelativeBounds;
  const effectOutset =
    hasEffect &&
    assetSize &&
    (assetSize.width > pageRelative.width ||
      assetSize.height > pageRelative.height)
      ? {
          width: assetSize.width,
          height: assetSize.height,
          left:
            pageRelative.x -
            Math.max(0, assetSize.width - pageRelative.width) / 2,
          top: topAlignedStrokeEffect
            ? pageRelative.y
            : pageRelative.y -
              Math.max(0, assetSize.height - pageRelative.height) / 2,
        }
      : undefined;
  const renderFrame = {
    left: effectOutset?.left ?? pageRelative.x,
    top: effectOutset?.top ?? pageRelative.y,
    width: positiveRenderDimension(effectOutset?.width ?? pageRelative.width),
    height: positiveRenderDimension(effectOutset?.height ?? pageRelative.height),
  };

  if (reason === "image_visual" || reason === "logo") {
    return {
      id: uiNodeId,
      kind: "image",
      assetRef,
      alt: candidate.name || "Visual asset",
      fit: "cover",
      designValueRefs: [],
      style: {
        position: "absolute",
        left: renderFrame.left,
        top: renderFrame.top,
        width: renderFrame.width,
        height: renderFrame.height,
        zIndex: candidate.zOrder,
        opacity,
        pointerEvents: "none",
      },
    };
  }

  return {
    id: uiNodeId,
    kind: "pixel_overlay",
    assetRef,
    alt: candidate.name || "Visual overlay",
    width: renderFrame.width,
    height: renderFrame.height,
    designValueRefs: [],
    style: {
      position: "absolute",
      left: renderFrame.left,
      top: renderFrame.top,
      width: renderFrame.width,
      height: renderFrame.height,
      zIndex: candidate.zOrder,
      opacity,
      pointerEvents: "none",
    },
    childIds: [],
  };
}

function buildCropOverlayUINode(
  sourceNode: NormalizedNode,
  pagePlanId: string,
  assetRef: string,
  frame: VisualLayerPlan["pageRelativeBounds"],
  zOrder: number,
): UINode {
  return {
    id: stableUINodeId(pagePlanId, sourceNode.id),
    kind: "pixel_overlay",
    assetRef,
    alt: sourceNode.name || "Background composite",
    width: frame.width,
    height: frame.height,
    frame,
    designValueRefs: sourceNode.designValueRefs,
    style: {
      position: "absolute",
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      zIndex: zOrder,
      pointerEvents: "none",
    },
    childIds: [],
  };
}

function buildSymbolIconUINode(
  sourceNode: NormalizedNode,
  styleSourceNode: NormalizedNode,
  pagePlanId: string,
  pageRelativeBounds: VisualLayerPlan["pageRelativeBounds"],
  zOrder: number,
  symbol: IconSymbol,
): UINode | undefined {
  if (!sourceNode.bounds) {
    return undefined;
  }
  const mappedStyle = mapNodeStyle(styleSourceNode, [], []);
  const color =
    mappedStyle.borderColor ??
    mappedStyle.textColor ??
    mappedStyle.backgroundColor ??
    "#808192";
  return {
    id: stableUINodeId(pagePlanId, sourceNode.id),
    kind: "icon",
    symbol,
    alt: sourceNode.name || symbol,
    decorative: true,
    designValueRefs: sourceNode.designValueRefs,
    style: {
      position: "absolute",
      left: pageRelativeBounds.x,
      top: pageRelativeBounds.y,
      width: Math.max(1, pageRelativeBounds.width),
      height: Math.max(1, pageRelativeBounds.height),
      zIndex: zOrder,
      textColor: color,
      pointerEvents: "none",
    },
  };
}

function isSimpleShapeFallbackCandidate(
  candidate: VisualAssetCandidate,
  node: NormalizedNode | undefined,
): node is NormalizedNode {
  if (!node?.bounds || node.kind !== "vector") {
    return false;
  }
  if ((node.visual?.fillCount ?? 0) <= 0) {
    return false;
  }
  const name = node.name ?? "";
  const simpleName =
    /(?:bg|background|rect|rectangle|ellipse|oval|circle|line|divider|separator)/i.test(
      name,
    );
  if (!simpleName) {
    return false;
  }
  const { width, height } = candidate.pageRelativeBounds;
  const area = width * height;
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  const isSmallShape = area <= 1_600 && maxDim <= 64;
  const isThinShape = minDim <= 8 && maxDim >= 16;
  return isSmallShape || isThinShape;
}

function buildSimpleShapeUINode(
  candidate: VisualAssetCandidate,
  pagePlanId: string,
  node: NormalizedNode,
  styles: DesignBundle["styles"],
  designValues: DesignBundle["designValues"],
): UINode | undefined {
  const mappedStyle = mapNodeStyle(node, styles, designValues);
  const backgroundColor =
    mappedStyle.backgroundColor ??
    ((node.visual?.strokeCount ?? 0) > 0 ? "#EDF1F3" : undefined);
  if (!backgroundColor) {
    return undefined;
  }
  const uiNodeId = stableUINodeId(pagePlanId, candidate.sourceNodeId);
  const { x, y, width, height } = candidate.pageRelativeBounds;
  const renderedWidth = Math.max(width, width < 1 ? 1 : width);
  const renderedHeight = Math.max(height, height < 1 ? 1 : height);
  const minDim = Math.min(width, height);
  const isSmallSquare = Math.abs(width - height) <= 1 && width <= 64;
  const inferredRadius = isSmallSquare ? width / 2 : minDim <= 8 ? renderedHeight / 2 : undefined;
  return {
    id: uiNodeId,
    kind: "stack",
    direction: "vertical",
    childIds: [],
    designValueRefs: node.designValueRefs,
    style: {
      backgroundColor,
      borderRadius: mappedStyle.borderRadius ?? inferredRadius,
      opacity: mappedStyle.opacity,
      position: "absolute",
      left: x,
      top: y,
      width: renderedWidth,
      height: renderedHeight,
      zIndex: candidate.zOrder,
      pointerEvents: "none",
    },
  };
}

const STROKE_ICON_ANCESTOR_PATTERN =
  /(?:icon|arrow|search|cart|google|github|twitter|facebook|apple|chevron|menu|close|check|star|heart)/i;
const CHEVRON_ICON_ANCESTOR_PATTERN =
  /(?:trailing icon|chevron|caret|select|dropdown|arrow down)/i;
const INFO_ICON_ANCESTOR_PATTERN = /(?:^|\b)(?:info|information)(?:\b|$)/i;
const SYMBOL_ICON_ANCESTOR_MATCHERS: ReadonlyArray<{
  readonly symbol: Exclude<IconSymbol, "chevron-down" | "info">;
  readonly pattern: RegExp;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly minHeight: number;
  readonly maxHeight: number;
}> = [
  {
    symbol: "plus",
    pattern: /(?:^|\b)(?:plus|add)(?:\b|$)/i,
    minWidth: 8,
    maxWidth: 64,
    minHeight: 8,
    maxHeight: 64,
  },
  {
    symbol: "users",
    pattern: /(?:^|\b)(?:users?|people|team)(?:\b|$)/i,
    minWidth: 8,
    maxWidth: 64,
    minHeight: 8,
    maxHeight: 64,
  },
  {
    symbol: "cursor-arrow",
    pattern: /(?:cursor\s*\/?\s*arrow|mouse\s*cursor|pointer\s*arrow)/i,
    minWidth: 12,
    maxWidth: 64,
    minHeight: 12,
    maxHeight: 64,
  },
  {
    symbol: "battery",
    pattern: /(?:^|\b)battery(?:\b|$)/i,
    minWidth: 12,
    maxWidth: 48,
    minHeight: 6,
    maxHeight: 24,
  },
];

function hasStrokeIconAncestor(
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
): boolean {
  let currentId = node.parentId;
  while (currentId) {
    const parent = nodeById.get(currentId);
    if (!parent) {
      return false;
    }
    if (STROKE_ICON_ANCESTOR_PATTERN.test(parent.name ?? "")) {
      return true;
    }
    currentId = parent.parentId;
  }
  return false;
}

function hasChevronIconAncestor(
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
): boolean {
  let currentId = node.parentId;
  while (currentId) {
    const parent = nodeById.get(currentId);
    if (!parent) {
      return false;
    }
    if (CHEVRON_ICON_ANCESTOR_PATTERN.test(parent.name ?? "")) {
      return true;
    }
    currentId = parent.parentId;
  }
  return false;
}

function matchingIconAncestor(
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
  pattern: RegExp,
): NormalizedNode | undefined {
  let currentId = node.parentId;
  while (currentId) {
    const parent = nodeById.get(currentId);
    if (!parent) {
      return undefined;
    }
    if (pattern.test(parent.name ?? "") && parent.bounds) {
      return parent;
    }
    currentId = parent.parentId;
  }
  return undefined;
}

function assetlessSymbolIconFallback(
  bundle: DesignBundle,
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
): {
  readonly sourceNode: NormalizedNode;
  readonly styleSourceNode: NormalizedNode;
  readonly symbol: IconSymbol;
  readonly bounds: NonNullable<NormalizedNode["bounds"]>;
} | undefined {
  if (!node.visible || !node.bounds || node.kind !== "vector") {
    return undefined;
  }
  if (
    (node.visual?.strokeCount ?? 0) <= 0 &&
    (node.visual?.fillCount ?? 0) <= 0
  ) {
    return undefined;
  }
  if (node.imageRefs[0] || screenshotPathForNode(bundle, node.id)) {
    return undefined;
  }
  if (isAssetlessChevronSymbolCandidate(node, nodeById)) {
    return {
      sourceNode: node,
      styleSourceNode: node,
      symbol: "chevron-down",
      bounds: node.bounds,
    };
  }
  const infoAncestor = matchingIconAncestor(
    node,
    nodeById,
    INFO_ICON_ANCESTOR_PATTERN,
  );
  if (
    infoAncestor?.bounds &&
    infoAncestor.bounds.width >= 8 &&
    infoAncestor.bounds.width <= 64 &&
    infoAncestor.bounds.height >= 8 &&
    infoAncestor.bounds.height <= 64
  ) {
    return {
      sourceNode: infoAncestor,
      styleSourceNode: node,
      symbol: "info",
      bounds: infoAncestor.bounds,
    };
  }
  for (const matcher of SYMBOL_ICON_ANCESTOR_MATCHERS) {
    const ancestor = matchingIconAncestor(node, nodeById, matcher.pattern);
    if (
      ancestor?.bounds &&
      ancestor.bounds.width >= matcher.minWidth &&
      ancestor.bounds.width <= matcher.maxWidth &&
      ancestor.bounds.height >= matcher.minHeight &&
      ancestor.bounds.height <= matcher.maxHeight
    ) {
      return {
        sourceNode: ancestor,
        styleSourceNode: node,
        symbol: matcher.symbol,
        bounds: ancestor.bounds,
      };
    }
  }
  return undefined;
}

function isAssetlessChevronSymbolCandidate(
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
): boolean {
  if (!node.visible || !node.bounds || node.kind !== "vector") {
    return false;
  }
  if ((node.visual?.strokeCount ?? 0) <= 0 || (node.visual?.fillCount ?? 0) > 0) {
    return false;
  }
  if (node.imageRefs[0]) {
    return false;
  }
  const { width, height } = node.bounds;
  return (
    width >= 6 &&
    width <= 24 &&
    height >= 3 &&
    height <= 16 &&
    width > height &&
    hasChevronIconAncestor(node, nodeById)
  );
}

function collectAssetlessSymbolIconLayers(
  bundle: DesignBundle,
  sourcePageId: string,
  pagePlanId: string,
  pageOrigin: { x: number; y: number },
  alreadyTrackedNodeIds: ReadonlySet<string>,
): VisualLayerPlan[] {
  const page = bundle.pages.find((candidate) => candidate.id === sourcePageId);
  if (!page) {
    return [];
  }
  const nodeById = new Map(page.nodes.map((node) => [node.id, node]));
  const layers: VisualLayerPlan[] = [];
  const emittedSourceNodeIds = new Set<string>();
  for (const [zOrder, node] of page.nodes.entries()) {
    if (
      alreadyTrackedNodeIds.has(node.id) ||
      hasTrackedAncestor(node, nodeById, alreadyTrackedNodeIds)
    ) {
      continue;
    }
    const fallback = assetlessSymbolIconFallback(bundle, node, nodeById);
    if (!fallback || emittedSourceNodeIds.has(fallback.sourceNode.id)) {
      continue;
    }
    const assetRef = screenshotPathForNode(bundle, fallback.sourceNode.id);
    if (assetRef) {
      continue;
    }
    const pageRelativeBounds = nodeRelativeBounds(fallback.bounds, pageOrigin);
    const uiNode = buildSymbolIconUINode(
      fallback.sourceNode,
      fallback.styleSourceNode,
      pagePlanId,
      pageRelativeBounds,
      zOrder,
      fallback.symbol,
    );
    if (!uiNode) {
      continue;
    }
    emittedSourceNodeIds.add(fallback.sourceNode.id);
    layers.push({
      sourceNodeId: fallback.sourceNode.id,
      sourcePageId,
      reason: "nav_icon",
      layerRole: "icon",
      zOrder,
      bounds: fallback.bounds,
      pageRelativeBounds,
      opacity: node.visual?.opacity,
      uiNodeId: uiNode.id,
      uiNode,
      rendered: true,
    });
  }
  return layers;
}

function screenshotPathForPage(
  bundle: DesignBundle,
  sourcePageId: string,
): string | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "page" &&
      entry.entityId === sourcePageId,
  )?.sourceIdHash;
  return sourceHash
    ? bundle.provenance.find(
        (entry) =>
          entry.entityKind === "screenshot" &&
          entry.sourceIdHash === sourceHash,
      )?.entityId
    : undefined;
}

function isModalLike(node: NormalizedNode): boolean {
  return /(?:modal|dialog|popover|drawer)/i.test(node.name ?? "");
}

function isFrameLikeVisualNode(node: NormalizedNode): boolean {
  return (
    node.kind === "container" ||
    node.kind === "instance" ||
    node.kind === "component"
  );
}

function thickVisualOutset(node: NormalizedNode): number {
  const strokeWeight = node.visual?.strokeWeight;
  if (
    strokeWeight === undefined ||
    strokeWeight < 2 ||
    (node.visual?.strokeCount ?? 0) === 0
  ) {
    return 0;
  }
  return strokeWeight;
}

function collectModalBackgroundCompositeLayers(
  bundle: DesignBundle,
  sourcePageId: string,
  pagePlanId: string,
  pageOrigin: { x: number; y: number },
  pageArea: number,
  alreadyTrackedNodeIds: ReadonlySet<string>,
): VisualLayerPlan[] {
  const page = bundle.pages.find((candidate) => candidate.id === sourcePageId);
  const pageScreenshot = screenshotPathForPage(bundle, sourcePageId);
  if (!page || !pageScreenshot) {
    return [];
  }
  const modalEntries = page.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.visible && node.bounds && isModalLike(node));
  if (modalEntries.length === 0) {
    return [];
  }
  const modalZOrder = Math.min(
    ...modalEntries.map((entry) => entry.index),
  );
  const backgroundEntry = page.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => {
      if (
        alreadyTrackedNodeIds.has(node.id) ||
        !node.visible ||
        !node.bounds ||
        !isFrameLikeVisualNode(node) ||
        isModalLike(node)
      ) {
        return false;
      }
      const area = node.bounds.width * node.bounds.height;
      return (
        area >= pageArea * 0.25 &&
        ((node.visual?.fillCount ?? 0) > 0 ||
          (node.visual?.strokeCount ?? 0) > 0 ||
          (node.visual?.effectCount ?? 0) > 0 ||
          node.visual?.clipsContent === true)
      );
    })
    .sort(
      (left, right) =>
        right.node.bounds!.width * right.node.bounds!.height -
        left.node.bounds!.width * left.node.bounds!.height,
    )[0];
  if (!backgroundEntry) {
    return [];
  }

  const outset = thickVisualOutset(backgroundEntry.node);
  const sourceBounds = {
    x: backgroundEntry.node.bounds!.x - outset,
    y: backgroundEntry.node.bounds!.y - outset,
    width: backgroundEntry.node.bounds!.width + outset * 2,
    height: backgroundEntry.node.bounds!.height + outset * 2,
  };
  const baseBounds = nodeRelativeBounds(sourceBounds, pageOrigin);
  const pageScreenshotRef = bundle.screenshots.find(
    (screenshot) => screenshot.path === pageScreenshot,
  );
  const frame = {
    x: Math.max(0, baseBounds.x),
    y: Math.max(0, baseBounds.y),
    width:
      (backgroundEntry.node.visual?.effectCount ?? 0) > 0 && pageScreenshotRef
        ? Math.max(
            baseBounds.width,
            pageScreenshotRef.width - Math.max(0, baseBounds.x),
          )
        : baseBounds.width,
    height:
      (backgroundEntry.node.visual?.effectCount ?? 0) > 0 && pageScreenshotRef
        ? Math.max(
            baseBounds.height,
            pageScreenshotRef.height - Math.max(0, baseBounds.y),
          )
        : baseBounds.height,
  };
  const zOrder = Math.max(0, modalZOrder - 1);
  const uiNode = buildCropOverlayUINode(
    backgroundEntry.node,
    pagePlanId,
    pageScreenshot,
    frame,
    zOrder,
  );
  return [
    {
      sourceNodeId: backgroundEntry.node.id,
      sourcePageId,
      reason: "background_composite",
      layerRole: layerRole("background_composite"),
      zOrder,
      bounds: sourceBounds,
      pageRelativeBounds: frame,
      opacity: backgroundEntry.node.visual?.opacity,
      assetRef: pageScreenshot,
      uiNodeId: uiNode.id,
      uiNode,
      rendered: true,
    },
  ];
}

function collectAssetlessStrokeIconUnsupportedFeatures(
  bundle: DesignBundle,
  sourcePageId: string,
  alreadyTrackedNodeIds: ReadonlySet<string>,
): M5StaticReport["unsupportedFeatures"] {
  const page = bundle.pages.find((candidate) => candidate.id === sourcePageId);
  if (!page) {
    return [];
  }
  const nodeById = new Map(page.nodes.map((node) => [node.id, node]));
  const output: M5StaticReport["unsupportedFeatures"] = [];
  for (const node of page.nodes) {
    if (
      alreadyTrackedNodeIds.has(node.id) ||
      hasTrackedAncestor(node, nodeById, alreadyTrackedNodeIds)
    ) {
      continue;
    }
    if (!node.visible || !node.bounds || node.kind !== "vector") {
      continue;
    }
    if ((node.visual?.strokeCount ?? 0) <= 0 || (node.visual?.fillCount ?? 0) > 0) {
      continue;
    }
    const maxDim = Math.max(node.bounds.width, node.bounds.height);
    const area = node.bounds.width * node.bounds.height;
    if (maxDim > 64 || area < 64) {
      continue;
    }
    if (!hasStrokeIconAncestor(node, nodeById)) {
      continue;
    }
    if (node.imageRefs[0] || screenshotPathForNode(bundle, node.id)) {
      continue;
    }
    output.push({
      code: "visual_stroke_icon_no_asset",
      severity: "fallback_ok",
      evidenceSource: "schema_limit",
      figmaNodeRefs: [node.id],
      impact: ["visual"],
      recommendedAction: "defer",
    });
  }
  return output;
}

function hasTrackedAncestor(
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
  alreadyTrackedNodeIds: ReadonlySet<string>,
): boolean {
  let currentId = node.parentId;
  while (currentId) {
    if (alreadyTrackedNodeIds.has(currentId)) {
      return true;
    }
    const parent = nodeById.get(currentId);
    if (!parent) {
      return false;
    }
    currentId = parent.parentId;
  }
  return false;
}

export interface PlanVisualLayersInput {
  readonly bundle: DesignBundle;
  readonly pagePlanId: string;
  readonly sourcePageId: string;
  readonly pageOrigin: { x: number; y: number };
  readonly pageArea: number;
}

export interface PlanVisualLayersResult {
  readonly layers: VisualLayerPlan[];
  readonly candidates: VisualAssetCandidate[];
  readonly exceededCandidates: VisualAssetCandidate[];
  readonly unsupportedFeatures: M5StaticReport["unsupportedFeatures"];
  readonly warnings: M5StaticReport["warnings"];
}

export function planVisualLayers(
  input: PlanVisualLayersInput,
): PlanVisualLayersResult {
  const page = input.bundle.pages.find(
    (candidate) => candidate.id === input.sourcePageId,
  );
  if (!page) {
    return {
      layers: [],
      candidates: [],
      exceededCandidates: [],
      unsupportedFeatures: [],
      warnings: [
        {
          code: "visual_layer_page_missing",
          detail: `找不到来源页面 ${input.sourcePageId}`,
        },
      ],
    };
  }

  const candidates = analyzeVisualAssetCandidates(
    page,
    input.pageOrigin,
    input.pageArea,
  );
  const plan = planVisualAssetExports(candidates);
  const nodeById = new Map(page.nodes.map((node) => [node.id, node]));

  const unsupportedFeatures: M5StaticReport["unsupportedFeatures"] = [];
  const warnings: M5StaticReport["warnings"] = [];
  const layers: VisualLayerPlan[] = [];

  for (const candidate of plan.selected) {
    const reason = candidateReasonToLayerReason(candidate);
    const node = page.nodes.find((n) => n.id === candidate.sourceNodeId);

    // 结构化 image 节点已在 UISpec 中作为独立 image 节点输出，避免再生成 overlay 重复
    if (candidate.reasonCode === "image_fill" && node?.kind === "image") {
      continue;
    }

    const assetRef =
      node?.imageRefs[0] ?? screenshotPathForNode(input.bundle, candidate.sourceNodeId);
    const assetSize = assetRef
      ? input.bundle.screenshots.find((screenshot) => screenshot.path === assetRef)
      : undefined;

    if (!assetRef) {
      const symbolFallback = node
        ? assetlessSymbolIconFallback(input.bundle, node, nodeById)
        : undefined;
      if (symbolFallback) {
        const pageRelativeBounds = nodeRelativeBounds(
          symbolFallback.bounds,
          input.pageOrigin,
        );
        const symbolNode = buildSymbolIconUINode(
          symbolFallback.sourceNode,
          symbolFallback.styleSourceNode,
          input.pagePlanId,
          pageRelativeBounds,
          candidate.zOrder,
          symbolFallback.symbol,
        );
        if (symbolNode) {
          layers.push({
            sourceNodeId: symbolFallback.sourceNode.id,
            sourcePageId: input.sourcePageId,
            reason,
            layerRole: "icon",
            zOrder: candidate.zOrder,
            bounds: symbolFallback.bounds,
            pageRelativeBounds,
            opacity: node?.visual?.opacity,
            uiNodeId: symbolNode.id,
            uiNode: symbolNode,
            rendered: true,
          });
          continue;
        }
      }
      const canUseShapeFallback =
        !!node &&
        (candidate.reasonCode === "button_icon" ||
          candidate.reasonCode === "line_or_divider" ||
          isSimpleShapeFallbackCandidate(candidate, node));
      const shapeNode = canUseShapeFallback
        ? buildSimpleShapeUINode(
            candidate,
            input.pagePlanId,
            node,
            input.bundle.styles,
            input.bundle.designValues,
          )
        : undefined;
      if (shapeNode) {
        layers.push({
          sourceNodeId: candidate.sourceNodeId,
          sourcePageId: input.sourcePageId,
          reason,
          layerRole: layerRole(reason),
          zOrder: candidate.zOrder,
          bounds: candidate.bounds,
          pageRelativeBounds: candidate.pageRelativeBounds,
          opacity: node?.visual?.opacity,
          uiNodeId: shapeNode.id,
          uiNode: shapeNode,
          rendered: true,
        });
        continue;
      }
      unsupportedFeatures.push({
        code: "visual_layer_no_asset",
        severity: "fallback_ok",
        evidenceSource: "schema_limit",
        figmaNodeRefs: [candidate.sourceNodeId],
        impact: ["visual"],
        recommendedAction: "defer",
      });
      layers.push({
        sourceNodeId: candidate.sourceNodeId,
        sourcePageId: input.sourcePageId,
        reason,
        layerRole: layerRole(reason),
        zOrder: candidate.zOrder,
        bounds: candidate.bounds,
        pageRelativeBounds: candidate.pageRelativeBounds,
        opacity: node?.visual?.opacity,
        rendered: false,
        blockedReason: "没有可用的局部图片资产",
      });
      continue;
    }

    const uiNodeId = stableUINodeId(input.pagePlanId, candidate.sourceNodeId);
    const uiNode = buildOverlayUINode(
      candidate,
      input.pagePlanId,
      reason,
      assetRef,
      node?.visual?.opacity,
      assetSize,
      (node?.visual?.effectCount ?? 0) > 0,
      (node?.visual?.effectCount ?? 0) > 0 &&
        (node?.visual?.fillCount ?? 0) === 0 &&
        (node?.visual?.strokeCount ?? 0) > 0,
    );

    layers.push({
      sourceNodeId: candidate.sourceNodeId,
      sourcePageId: input.sourcePageId,
      reason,
      layerRole: layerRole(reason),
      zOrder: candidate.zOrder,
      bounds: candidate.bounds,
      pageRelativeBounds: candidate.pageRelativeBounds,
      opacity: node?.visual?.opacity,
      assetRef,
      uiNodeId,
      uiNode,
      rendered: true,
    });
  }

  for (const candidate of plan.exceeded) {
    unsupportedFeatures.push({
      code: "visual_asset_budget_exceeded",
      severity: "fallback_ok",
      evidenceSource: "schema_limit",
      figmaNodeRefs: [candidate.sourceNodeId],
      impact: ["visual"],
      recommendedAction: "defer",
    });
  }

  const trackedNodeIds = new Set([
    ...layers.map((layer) => layer.sourceNodeId),
    ...unsupportedFeatures.flatMap((feature) => feature.figmaNodeRefs ?? []),
  ]);
  const modalBackgroundLayers = collectModalBackgroundCompositeLayers(
    input.bundle,
    input.sourcePageId,
    input.pagePlanId,
    input.pageOrigin,
    input.pageArea,
    trackedNodeIds,
  );
  layers.push(...modalBackgroundLayers);
  for (const layer of modalBackgroundLayers) {
    trackedNodeIds.add(layer.sourceNodeId);
  }
  const symbolIconLayers = collectAssetlessSymbolIconLayers(
    input.bundle,
    input.sourcePageId,
    input.pagePlanId,
    input.pageOrigin,
    trackedNodeIds,
  );
  layers.push(...symbolIconLayers);
  for (const layer of symbolIconLayers) {
    trackedNodeIds.add(layer.sourceNodeId);
  }
  unsupportedFeatures.push(
    ...collectAssetlessStrokeIconUnsupportedFeatures(
      input.bundle,
      input.sourcePageId,
      trackedNodeIds,
    ),
  );

  return {
    layers,
    candidates,
    exceededCandidates: plan.exceeded,
    unsupportedFeatures,
    warnings,
  };
}

export function toReportVisualLayers(
  layers: VisualLayerPlan[],
): M5StaticVisualLayer[] {
  return layers.map((layer) => ({
    sourceNodeId: layer.sourceNodeId,
    uiSpecNodeId: layer.uiNodeId,
    sourcePageId: layer.sourcePageId,
    reason: layer.reason,
    layerRole: layer.layerRole,
    zOrder: layer.zOrder,
    bounds: layer.bounds,
    pageRelativeBounds: layer.pageRelativeBounds,
    opacity: layer.opacity,
    assetRef: layer.assetRef,
    rendered: layer.rendered,
    blockedReason: layer.blockedReason,
  }));
}
