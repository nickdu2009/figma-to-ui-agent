import type {
  DesignBundle,
  NormalizedNode,
} from "../design-bundle/schema.ts";

const MAX_CONTEXT_NODES = 2_000;
const MAX_NODES_PER_PAGE = 500;
const MAX_CONTEXT_ITEMS = 500;
const MAX_NODE_REFS = 50;
const MAX_TEXT_CHARACTERS = 1_000;
const MAX_VISUAL_LAYERS_PER_PAGE = 80;
const MIN_VISUAL_LAYER_AREA = 24_000;
const MIN_PAGE_AREA_RATIO = 0.04;
const VISUAL_LAYER_NAME_HINT_PATTERN =
  /(?:blob|blobs|image|illustration|logo|hero|background|bg|decor|decoration|shape)/i;
const MIN_IMAGE_VISUAL_AREA = 4_096;
const MIN_NAMED_VISUAL_AREA = 4_096;
const NEARBY_CONTENT_MARGIN = 24;

type Bounds = NonNullable<NormalizedNode["bounds"]>;
type VisualLayerReason =
  | "large_visual"
  | "structural_visual"
  | "named_visual"
  | "image_visual";

function hasStructuralVisualSignal(
  visual: NormalizedNode["visual"] | undefined,
): boolean {
  if (!visual) {
    return false;
  }
  return (
    (visual.opacity !== undefined && visual.opacity < 1) ||
    (visual.blendMode !== undefined &&
      !["NORMAL", "PASS_THROUGH"].includes(visual.blendMode)) ||
    visual.effectCount > 0 ||
    visual.vectorPathCount > 1 ||
    visual.isMask === true ||
    visual.clipsContent === true
  );
}

function boundedRefs(values: readonly string[]): string[] {
  return values.slice(0, MAX_NODE_REFS);
}

function summarizeNode(node: NormalizedNode) {
  return {
    id: node.id,
    parentId: node.parentId,
    kind: node.kind,
    name: node.name,
    visible: node.visible,
    bounds: node.bounds,
    layout: node.layout,
    text: node.text
      ? {
          ...node.text,
          characters: node.text.characters.slice(
            0,
            MAX_TEXT_CHARACTERS,
          ),
          truncated:
            node.text.characters.length > MAX_TEXT_CHARACTERS,
        }
      : undefined,
    componentRef: node.componentRef,
    styleRefs: boundedRefs(node.styleRefs),
    imageRefs: boundedRefs(node.imageRefs),
    visual: node.visual,
    designValueRefs: boundedRefs(node.designValueRefs),
    warningCodes: boundedRefs(node.warningCodes),
  };
}

function screenshotPathForPage(
  bundle: DesignBundle,
  pageId: string,
): string | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "page" &&
      entry.entityId === pageId,
  )?.sourceIdHash;
  if (!sourceHash) {
    return undefined;
  }
  const path = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "screenshot" &&
      entry.sourceIdHash === sourceHash,
  )?.entityId;
  return bundle.screenshots.some(
    (screenshot) => screenshot.path === path,
  )
    ? path
    : undefined;
}

function screenshotPathForNode(
  bundle: DesignBundle,
  nodeId: string,
): string | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "node" &&
      entry.entityId === nodeId,
  )?.sourceIdHash;
  if (!sourceHash) {
    return undefined;
  }
  const path = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "screenshot" &&
      entry.sourceIdHash === sourceHash,
  )?.entityId;
  return bundle.screenshots.some(
    (screenshot) => screenshot.path === path,
  )
    ? path
    : undefined;
}

function visualLayerReason(
  node: NormalizedNode,
  pageArea: number,
): VisualLayerReason | undefined {
  if (
    !node.visible ||
    !node.bounds ||
    node.bounds.width < 8 ||
    node.bounds.height < 8
  ) {
    return undefined;
  }
  const name = node.name ?? "";
  const area = node.bounds.width * node.bounds.height;
  const areaRatio = pageArea === 0 ? 0 : area / pageArea;
  const hasNameHint = VISUAL_LAYER_NAME_HINT_PATTERN.test(name);
  const hasStructuralSignal = hasStructuralVisualSignal(node.visual);
  const hasVisiblePaint =
    (node.visual?.fillCount ?? 0) > 0 ||
    (node.visual?.strokeCount ?? 0) > 0 ||
    node.kind === "image";
  if (node.kind === "image" && area >= MIN_IMAGE_VISUAL_AREA) {
    return "image_visual";
  }
  if (node.kind === "vector" || node.kind === "image") {
    if (
      area >= MIN_VISUAL_LAYER_AREA &&
      (pageArea === 0 || areaRatio >= MIN_PAGE_AREA_RATIO)
    ) {
      return node.kind === "image" ? "image_visual" : "large_visual";
    }
  }
  if (
    hasStructuralSignal &&
    area >= MIN_NAMED_VISUAL_AREA &&
    hasVisiblePaint &&
    (node.kind === "vector" || node.kind === "image")
  ) {
    return "structural_visual";
  }
  if (
    hasNameHint &&
    area >= MIN_NAMED_VISUAL_AREA &&
    areaRatio >= Math.min(MIN_PAGE_AREA_RATIO, 0.01) &&
    (node.kind === "vector" ||
      node.kind === "image")
  ) {
    return "named_visual";
  }
  if (node.kind !== "vector" && node.kind !== "image") {
    return undefined;
  }
  return undefined;
}

function rootBoundsForPage(
  page: DesignBundle["pages"][number],
): Bounds | undefined {
  const rootNode = page.nodes.find(
    (node) => node.id === page.rootNodeIds[0],
  );
  return rootNode?.bounds;
}

function pageRelativeBounds(
  bounds: Bounds,
  pageOrigin: Pick<Bounds, "x" | "y">,
): Bounds {
  return {
    x: bounds.x - pageOrigin.x,
    y: bounds.y - pageOrigin.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function descendantCountByNodeId(
  nodes: readonly NormalizedNode[],
): Map<string, number> {
  const childrenByParent = new Map<string, NormalizedNode[]>();
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  const counts = new Map<string, number>();
  function count(nodeId: string): number {
    const cached = counts.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    const children = childrenByParent.get(nodeId) ?? [];
    const total = children.reduce(
      (sum, child) => sum + 1 + count(child.id),
      0,
    );
    counts.set(nodeId, total);
    return total;
  }

  for (const node of nodes) {
    count(node.id);
  }
  return counts;
}

function intersects(left: Bounds, right: Bounds): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function isNear(left: Bounds, right: Bounds, margin: number): boolean {
  return intersects(
    {
      x: left.x - margin,
      y: left.y - margin,
      width: left.width + margin * 2,
      height: left.height + margin * 2,
    },
    right,
  );
}

function isContentSignalNode(node: NormalizedNode): boolean {
  return (
    node.kind === "text" ||
    node.kind === "instance" ||
    node.kind === "component"
  );
}

function contentRelationCounts(
  node: NormalizedNode,
  nodes: readonly NormalizedNode[],
  zOrder: number,
): {
  overlapContentNodeCount: number;
  nearbyContentNodeCount: number;
  laterContentOverlapCount: number;
} {
  if (!node.bounds) {
    return {
      overlapContentNodeCount: 0,
      nearbyContentNodeCount: 0,
      laterContentOverlapCount: 0,
    };
  }
  let overlapContentNodeCount = 0;
  let nearbyContentNodeCount = 0;
  let laterContentOverlapCount = 0;
  nodes.forEach((candidate, index) => {
    if (
      candidate.id === node.id ||
      !candidate.visible ||
      !candidate.bounds ||
      !isContentSignalNode(candidate)
    ) {
      return;
    }
    const overlaps = intersects(node.bounds!, candidate.bounds);
    if (overlaps) {
      overlapContentNodeCount += 1;
      if (index > zOrder) {
        laterContentOverlapCount += 1;
      }
      return;
    }
    if (isNear(node.bounds!, candidate.bounds, NEARBY_CONTENT_MARGIN)) {
      nearbyContentNodeCount += 1;
    }
  });
  return {
    overlapContentNodeCount,
    nearbyContentNodeCount,
    laterContentOverlapCount,
  };
}

function siblingContentNodeCount(
  node: NormalizedNode,
  nodes: readonly NormalizedNode[],
  descendantCounts: ReadonlyMap<string, number>,
): number {
  if (!node.parentId) {
    return 0;
  }
  return nodes
    .filter((candidate) => candidate.parentId === node.parentId)
    .filter((candidate) => candidate.id !== node.id)
    .reduce(
      (sum, candidate) =>
        sum + 1 + (descendantCounts.get(candidate.id) ?? 0),
      0,
    );
}

function visualLayerRole(
  node: NormalizedNode,
  reason: NonNullable<ReturnType<typeof visualLayerReason>>,
  siblingContentCount: number,
  laterContentOverlapCount: number,
):
  | "decorative_background"
  | "illustration_or_image"
  | "container_background" {
  if (reason === "image_visual") {
    return "illustration_or_image";
  }
  if (laterContentOverlapCount > 0) {
    return "decorative_background";
  }
  if (
    siblingContentCount > 0 &&
    node.kind === "container"
  ) {
    return "container_background";
  }
  return "decorative_background";
}

function visualLayerSummary(
  bundle: DesignBundle,
  page: DesignBundle["pages"][number],
) {
  const pageArea = page.width > 0 && page.height > 0
    ? page.width * page.height
    : 0;
  const pageOrigin = rootBoundsForPage(page) ?? {
    x: 0,
    y: 0,
  };
  const descendantCounts = descendantCountByNodeId(page.nodes);
  return page.nodes
    .map((node, index) => {
      const reason = visualLayerReason(node, pageArea);
      if (!reason || !node.bounds) {
        return undefined;
      }
      const localImageRefs = boundedRefs(node.imageRefs);
      const renderedAssetPath = screenshotPathForNode(bundle, node.id);
      const contentRelations = contentRelationCounts(
        node,
        page.nodes,
        index,
      );
      const relatedSiblingContentNodeCount = siblingContentNodeCount(
        node,
        page.nodes,
        descendantCounts,
      );
      const layerRole = visualLayerRole(
        node,
        reason,
        relatedSiblingContentNodeCount,
        contentRelations.laterContentOverlapCount,
      );
      return {
        id: node.id,
        parentId: node.parentId,
        kind: node.kind,
        name: node.name,
        reason,
        layerRole,
        zOrder: index,
        bounds: node.bounds,
        pageRelativeBounds: pageRelativeBounds(
          node.bounds,
          pageOrigin,
        ),
        visual: node.visual,
        siblingContentNodeCount: relatedSiblingContentNodeCount,
        ...contentRelations,
        localImageRefs,
        renderedAssetPath,
        exportableAsLocalAsset:
          localImageRefs.length > 0 || Boolean(renderedAssetPath),
        recommendedUISpecUse:
          layerRole === "illustration_or_image"
            ? "image"
            : "pixel_overlay",
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, MAX_VISUAL_LAYERS_PER_PAGE);
}

export function buildInspectAgentContext(bundle: DesignBundle) {
  let remainingNodes = MAX_CONTEXT_NODES;
  const pages = bundle.pages.map((page) => {
    const includedNodes = page.nodes.slice(
      0,
      Math.min(MAX_NODES_PER_PAGE, remainingNodes),
    );
    remainingNodes -= includedNodes.length;
    return {
      id: page.id,
      name: page.name,
      width: page.width,
      height: page.height,
      rootNodeIds: page.rootNodeIds,
      nodeCount: page.nodes.length,
      nodes: includedNodes.map(summarizeNode),
      visualLayers: visualLayerSummary(bundle, page),
      screenshotPath: screenshotPathForPage(bundle, page.id),
      nodesTruncated: includedNodes.length < page.nodes.length,
    };
  });

  return {
    schemaVersion: "1" as const,
    kind: "inspect_agent_context" as const,
    projectId: bundle.projectId,
    designBundleRevision: bundle.revision,
    pages,
    components: bundle.components.slice(0, MAX_CONTEXT_ITEMS),
    styles: bundle.styles.slice(0, MAX_CONTEXT_ITEMS),
    designValues: bundle.designValues.slice(0, MAX_CONTEXT_ITEMS),
    assets: bundle.assets.slice(0, MAX_CONTEXT_ITEMS),
    truncation: {
      nodes: bundle.pages.reduce(
        (total, page) => total + page.nodes.length,
        0,
      ) - pages.reduce(
        (total, page) => total + page.nodes.length,
        0,
      ),
      components: Math.max(
        bundle.components.length - MAX_CONTEXT_ITEMS,
        0,
      ),
      styles: Math.max(
        bundle.styles.length - MAX_CONTEXT_ITEMS,
        0,
      ),
      designValues: Math.max(
        bundle.designValues.length - MAX_CONTEXT_ITEMS,
        0,
      ),
      assets: Math.max(
        bundle.assets.length - MAX_CONTEXT_ITEMS,
        0,
      ),
    },
  };
}

export type InspectAgentContext = ReturnType<
  typeof buildInspectAgentContext
>;
