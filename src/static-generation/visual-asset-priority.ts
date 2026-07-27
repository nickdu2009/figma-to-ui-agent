import type {
  DesignBundle,
  NormalizedNode,
  NormalizedPage,
} from "../design-bundle/schema.ts";

export const MAX_VISUAL_ASSETS_PER_PAGE = 160;
export const MAX_IMAGES_PER_REQUEST = 100;

const MIN_IMAGE_VISUAL_AREA = 4_096;
const MIN_NAMED_VISUAL_AREA = 4_096;
const MIN_PAINTED_VECTOR_AREA = 256;
const MIN_VISUAL_LAYER_AREA = 24_000;
const MIN_PAGE_AREA_RATIO = 0.04;
const ICON_MAX_DIMENSION = 64;
const ICON_MIN_AREA = 64;
const LINE_MAX_THICKNESS = 8;
const LINE_MIN_LENGTH = 16;

const DECORATIVE_NAME_PATTERN =
  /(?:blob|blobs|image|illustration|hero|background|bg|decor|decoration|shape)/i;
const COMPOUND_VISUAL_NAME_PATTERN =
  /(?:combined shape|boolean|union|subtract|intersect|exclude|illustration|artwork|graphic|freepik|asset|picture|image group|decor|decoration)/i;
const ICON_NAME_PATTERN =
  /(?:icon|arrow|back|edit|status|search|cart|google|github|twitter|facebook|apple|chevron|menu|close|check|star|heart)/i;
const BRAND_ICON_NAME_PATTERN =
  /(?:google|github|twitter|facebook|apple|microsoft|linkedin|slack)/i;
const LOGO_NAME_PATTERN = /(?:logo|brand)/i;
const DIVIDER_NAME_PATTERN = /(?:divider|separator)/i;
const NAV_NAME_PATTERN = /(?:nav|header|tab|menu|toolbar|sidebar)/i;

export type VisualAssetBudgetGroup =
  | "image_fill"
  | "button_icon"
  | "logo"
  | "nav_header_icon"
  | "line_divider"
  | "large_visual"
  | "named_decorative"
  | "structural_visual"
  | "other_vector"
  | "ignored";

export type VisualAssetReasonCode =
  | "image_fill"
  | "button_icon"
  | "named_logo"
  | "nav_header_icon"
  | "line_or_divider"
  | "large_visual"
  | "named_icon"
  | "diagnostic_missing_asset"
  | "named_decorative"
  | "structural_visual"
  | "other_vector"
  | "budget_exceeded"
  | "tiny_safe"
  | "hidden"
  | "covered_by_parent_asset";

export interface VisualAssetCandidate {
  readonly sourceNodeId: string;
  readonly sourcePageId: string;
  readonly nodeKind: NormalizedNode["kind"];
  readonly name: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly pageRelativeBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  readonly area: number;
  readonly zOrder: number;
  readonly priorityRank?: number;
  readonly eligible: boolean;
  readonly budgetGroup: VisualAssetBudgetGroup;
  readonly reasonCode: VisualAssetReasonCode;
  readonly coveredByParentAsset: boolean;
  readonly parentId?: string;
}

function isButtonLikeName(name: string | undefined): boolean {
  const lower = name?.toLowerCase() ?? "";
  return (
    lower.includes("button") ||
    lower.includes("btn") ||
    lower.includes("sign in") ||
    lower.includes("sign up") ||
    lower.includes("login") ||
    lower.includes("submit") ||
    lower.includes("continue") ||
    lower.includes("get started")
  );
}

function hasStructuralVisualSignal(
  visual: NormalizedNode["visual"],
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

function hasVisiblePaint(node: NormalizedNode): boolean {
  return (
    (node.visual?.fillCount ?? 0) > 0 ||
    (node.visual?.strokeCount ?? 0) > 0
  );
}

function ancestorNameMatch(
  nodeId: string,
  parentById: ReadonlyMap<string, NormalizedNode | undefined>,
  predicate: (name: string | undefined) => boolean,
): boolean {
  let current = parentById.get(nodeId);
  while (current) {
    if (predicate(current.name)) {
      return true;
    }
    current = parentById.get(current.id);
  }
  return false;
}

function isInsideButton(
  nodeId: string,
  parentById: ReadonlyMap<string, NormalizedNode | undefined>,
): boolean {
  return ancestorNameMatch(nodeId, parentById, isButtonLikeName);
}

function isInsideBrandIcon(
  nodeId: string,
  parentById: ReadonlyMap<string, NormalizedNode | undefined>,
): boolean {
  return ancestorNameMatch(nodeId, parentById, (name) =>
    name ? BRAND_ICON_NAME_PATTERN.test(name) : false,
  );
}

function isInsideNav(
  nodeId: string,
  parentById: ReadonlyMap<string, NormalizedNode | undefined>,
): boolean {
  return ancestorNameMatch(nodeId, parentById, (name) =>
    name ? NAV_NAME_PATTERN.test(name) : false,
  );
}

function isVisualKind(kind: NormalizedNode["kind"]): boolean {
  return kind === "vector" || kind === "image";
}

function isCompoundVisualKind(kind: NormalizedNode["kind"]): boolean {
  return kind === "container" || kind === "instance" || kind === "component";
}

function isLineShape(node: NormalizedNode): boolean {
  if (!node.bounds) {
    return false;
  }
  const { width, height } = node.bounds;
  const thin = Math.min(width, height) <= LINE_MAX_THICKNESS;
  const long = Math.max(width, height) >= LINE_MIN_LENGTH;
  return thin && long;
}

function pageRelativeBounds(
  bounds: NonNullable<NormalizedNode["bounds"]>,
  pageOrigin: { x: number; y: number },
): VisualAssetCandidate["pageRelativeBounds"] {
  return {
    x: bounds.x - pageOrigin.x,
    y: bounds.y - pageOrigin.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function containsBounds(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

function isCompoundAssetCandidate(candidate: VisualAssetCandidate): boolean {
  return (
    candidate.budgetGroup === "named_decorative" &&
    isCompoundVisualKind(candidate.nodeKind)
  );
}

function classifyCandidate(
  node: NormalizedNode,
  pageArea: number,
  parentById: ReadonlyMap<string, NormalizedNode | undefined>,
): {
  budgetGroup: VisualAssetBudgetGroup;
  reasonCode: VisualAssetReasonCode;
  eligible: boolean;
} {
  if (!node.visible) {
    return { budgetGroup: "ignored", reasonCode: "hidden", eligible: false };
  }
  if (
    !node.bounds ||
    (node.bounds.width < 1 && node.bounds.height < 1)
  ) {
    return { budgetGroup: "ignored", reasonCode: "tiny_safe", eligible: false };
  }

  const area = node.bounds.width * node.bounds.height;
  const areaRatio = pageArea > 0 ? area / pageArea : 0;
  const name = node.name ?? "";
  const isVisual = isVisualKind(node.kind);
  const isCompoundVisual = isCompoundVisualKind(node.kind);

  if (node.kind === "image" && node.imageRefs.length > 0) {
    if (area >= MIN_IMAGE_VISUAL_AREA) {
      return {
        budgetGroup: "image_fill",
        reasonCode: "image_fill",
        eligible: true,
      };
    }
    return {
      budgetGroup: "other_vector",
      reasonCode: "other_vector",
      eligible: false,
    };
  }

  const maxDim = Math.max(node.bounds.width, node.bounds.height);
  const lineShape = isLineShape(node);
  if ((node.bounds.width < 1 || node.bounds.height < 1) && !lineShape) {
    return { budgetGroup: "ignored", reasonCode: "tiny_safe", eligible: false };
  }
  const insideButton = isInsideButton(node.id, parentById);
  const insideNav = isInsideNav(node.id, parentById);

  if (
    insideButton &&
    isVisual &&
    maxDim <= ICON_MAX_DIMENSION &&
    area >= (isInsideBrandIcon(node.id, parentById) ? 16 : ICON_MIN_AREA)
  ) {
    return {
      budgetGroup: "button_icon",
      reasonCode: "button_icon",
      eligible: true,
    };
  }

  if (LOGO_NAME_PATTERN.test(name) && isVisual && area >= MIN_NAMED_VISUAL_AREA) {
    return {
      budgetGroup: "logo",
      reasonCode: "named_logo",
      eligible: true,
    };
  }

  if (insideNav && isVisual && maxDim <= ICON_MAX_DIMENSION && area >= ICON_MIN_AREA) {
    return {
      budgetGroup: "nav_header_icon",
      reasonCode: "nav_header_icon",
      eligible: true,
    };
  }

  if (
    (DIVIDER_NAME_PATTERN.test(name) || lineShape) &&
    isVisual
  ) {
    return {
      budgetGroup: "line_divider",
      reasonCode: "line_or_divider",
      eligible: true,
    };
  }

  if (
    ICON_NAME_PATTERN.test(name) &&
    !DECORATIVE_NAME_PATTERN.test(name) &&
    isVisual &&
    maxDim <= ICON_MAX_DIMENSION &&
    area >= ICON_MIN_AREA
  ) {
    return {
      budgetGroup: "nav_header_icon",
      reasonCode: "named_icon",
      eligible: true,
    };
  }

  if (
    isVisual &&
    area >= MIN_VISUAL_LAYER_AREA &&
    (pageArea === 0 || areaRatio >= MIN_PAGE_AREA_RATIO)
  ) {
    return {
      budgetGroup: "large_visual",
      reasonCode: "large_visual",
      eligible: true,
    };
  }

  if (
    DECORATIVE_NAME_PATTERN.test(name) &&
    isVisual &&
    area >= MIN_NAMED_VISUAL_AREA
  ) {
    return {
      budgetGroup: "named_decorative",
      reasonCode: "named_decorative",
      eligible: true,
    };
  }

  if (
    COMPOUND_VISUAL_NAME_PATTERN.test(name) &&
    isCompoundVisual &&
    area >= MIN_NAMED_VISUAL_AREA
  ) {
    return {
      budgetGroup: "named_decorative",
      reasonCode: "named_decorative",
      eligible: true,
    };
  }

  if (
    isVisual &&
    ancestorNameMatch(node.id, parentById, (ancestorName) =>
      ancestorName ? COMPOUND_VISUAL_NAME_PATTERN.test(ancestorName) : false,
    ) &&
    area >= MIN_NAMED_VISUAL_AREA &&
    hasVisiblePaint(node)
  ) {
    return {
      budgetGroup: "named_decorative",
      reasonCode: "named_decorative",
      eligible: true,
    };
  }

  if (
    hasStructuralVisualSignal(node.visual) &&
    isVisual &&
    area >= MIN_NAMED_VISUAL_AREA &&
    hasVisiblePaint(node)
  ) {
    return {
      budgetGroup: "structural_visual",
      reasonCode: "structural_visual",
      eligible: true,
    };
  }

  if (
    DECORATIVE_NAME_PATTERN.test(name) &&
    LOGO_NAME_PATTERN.test(name) &&
    isVisual &&
    area < MIN_NAMED_VISUAL_AREA
  ) {
    return {
      budgetGroup: "other_vector",
      reasonCode: "other_vector",
      eligible: false,
    };
  }

  if (
    isVisual &&
    hasVisiblePaint(node) &&
    area >= MIN_PAINTED_VECTOR_AREA
  ) {
    return {
      budgetGroup: "structural_visual",
      reasonCode: "structural_visual",
      eligible: true,
    };
  }

  if (isVisual) {
    return {
      budgetGroup: "other_vector",
      reasonCode: "other_vector",
      eligible: false,
    };
  }

  if (area < 64) {
    return {
      budgetGroup: "ignored",
      reasonCode: "tiny_safe",
      eligible: false,
    };
  }

  return {
    budgetGroup: "other_vector",
    reasonCode: "other_vector",
    eligible: false,
  };
}

const GROUP_PRIORITY: Record<VisualAssetBudgetGroup, number> = {
  image_fill: 0,
  button_icon: 1,
  logo: 2,
  nav_header_icon: 3,
  line_divider: 4,
  large_visual: 5,
  named_decorative: 6,
  structural_visual: 7,
  other_vector: 8,
  ignored: 9,
};

export interface VisualAssetPlan {
  readonly selected: VisualAssetCandidate[];
  readonly exceeded: VisualAssetCandidate[];
  readonly all: VisualAssetCandidate[];
}

export function analyzeVisualAssetCandidates(
  page: NormalizedPage,
  pageOrigin: { x: number; y: number },
  pageArea: number,
): VisualAssetCandidate[] {
  const parentById = new Map<string, NormalizedNode | undefined>();
  for (const node of page.nodes) {
    parentById.set(node.id, undefined);
  }
  for (const node of page.nodes) {
    if (node.parentId) {
      const parent = page.nodes.find((candidate) => candidate.id === node.parentId);
      parentById.set(node.id, parent);
    }
  }

  const candidates: VisualAssetCandidate[] = [];
  for (const [zOrder, node] of page.nodes.entries()) {
    const classification = classifyCandidate(node, pageArea, parentById);
    const bounds = node.bounds;
    if (!bounds) {
      candidates.push({
        sourceNodeId: node.id,
        sourcePageId: page.id,
        nodeKind: node.kind,
        name: node.name ?? "",
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        pageRelativeBounds: { x: 0, y: 0, width: 0, height: 0 },
        area: 0,
        zOrder,
        eligible: false,
        budgetGroup: classification.budgetGroup,
        reasonCode: classification.reasonCode,
        coveredByParentAsset: false,
        parentId: node.parentId,
      });
      continue;
    }
    const area = bounds.width * bounds.height;
    candidates.push({
      sourceNodeId: node.id,
      sourcePageId: page.id,
      nodeKind: node.kind,
      name: node.name ?? "",
      bounds,
      pageRelativeBounds: pageRelativeBounds(bounds, pageOrigin),
      area,
      zOrder,
      eligible: classification.eligible,
      budgetGroup: classification.budgetGroup,
      reasonCode: classification.reasonCode,
      coveredByParentAsset: false,
      parentId: node.parentId,
    });
  }

  const eligibleById = new Map<string, VisualAssetCandidate>();
  for (const candidate of candidates) {
    if (candidate.eligible) {
      eligibleById.set(candidate.sourceNodeId, candidate);
    }
  }

  const sortedByAreaDesc = [...candidates].sort(
    (left, right) => right.area - left.area,
  );
  const coveredIds = new Set<string>();
  for (const candidate of sortedByAreaDesc) {
    if (!candidate.eligible || coveredIds.has(candidate.sourceNodeId)) {
      continue;
    }
    for (const other of candidates) {
      if (
        other.sourceNodeId === candidate.sourceNodeId ||
        (other.eligible && !isCompoundAssetCandidate(candidate)) ||
        coveredIds.has(other.sourceNodeId)
      ) {
        continue;
      }
      if (
        containsBounds(candidate.bounds, other.bounds) &&
        ancestorOf(candidate.sourceNodeId, other.sourceNodeId, page)
      ) {
        coveredIds.add(other.sourceNodeId);
      }
    }
  }

  return candidates.map((candidate) => {
    if (!coveredIds.has(candidate.sourceNodeId)) {
      return candidate;
    }
    return {
      ...candidate,
      coveredByParentAsset: true,
      eligible: false,
      reasonCode: "covered_by_parent_asset" as const,
      budgetGroup: "ignored" as const,
    };
  });
}

function ancestorOf(
  ancestorId: string,
  nodeId: string,
  page: NormalizedPage,
): boolean {
  const parentById = new Map<string, string | undefined>();
  for (const node of page.nodes) {
    parentById.set(node.id, node.parentId);
  }
  let current = parentById.get(nodeId);
  while (current) {
    if (current === ancestorId) {
      return true;
    }
    current = parentById.get(current);
  }
  return false;
}

export function planVisualAssetExports(
  candidates: readonly VisualAssetCandidate[],
  maxPerPage = MAX_VISUAL_ASSETS_PER_PAGE,
): VisualAssetPlan {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const sorted = [...eligible].sort((left, right) => {
    const priorityDelta = GROUP_PRIORITY[left.budgetGroup] - GROUP_PRIORITY[right.budgetGroup];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    if (right.area !== left.area) {
      return right.area - left.area;
    }
    return left.zOrder - right.zOrder;
  });

  const selected = sorted.slice(0, maxPerPage).map((candidate, index) => ({
    ...candidate,
    priorityRank: index + 1,
  }));
  const selectedIds = new Set(selected.map((candidate) => candidate.sourceNodeId));
  const exceeded = sorted.slice(maxPerPage).map((candidate) => ({
    ...candidate,
    budgetGroup: "other_vector" as const,
    reasonCode: "budget_exceeded" as const,
  }));

  const all = candidates.map((candidate) => {
    const selectedCandidate = selected.find(
      (item) => item.sourceNodeId === candidate.sourceNodeId,
    );
    return selectedCandidate ?? candidate;
  });

  return { selected, exceeded, all };
}

export function chunkExportIds(
  nodeIds: readonly string[],
  chunkSize = MAX_IMAGES_PER_REQUEST,
): string[][] {
  const output: string[][] = [];
  for (let index = 0; index < nodeIds.length; index += chunkSize) {
    output.push(nodeIds.slice(index, index + chunkSize));
  }
  return output;
}

export function screenshotPathForNode(
  bundle: DesignBundle,
  nodeId: string,
): string | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) => entry.entityKind === "node" && entry.entityId === nodeId,
  )?.sourceIdHash;
  if (!sourceHash) {
    return undefined;
  }
  const path = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "screenshot" && entry.sourceIdHash === sourceHash,
  )?.entityId;
  return bundle.screenshots.some((screenshot) => screenshot.path === path)
    ? path
    : undefined;
}
