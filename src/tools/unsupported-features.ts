import type { UISpec, UISpecDraft, UINode } from "../ui-spec/schema.ts";
import type { UnsupportedFeature } from "./contracts.ts";

type UnsupportedFeatureEvidenceSource =
  | "inspect_warning"
  | "schema_limit"
  | "renderer_limit"
  | "validation_artifact";

const STRUCTURED_NODE_KINDS = new Set<UINode["kind"]>([
  "text",
  "button",
  "input",
  "checkbox",
  "link",
  "radio",
  "switch",
  "select",
  "textarea",
  "tabs",
  "card",
  "list",
  "list_item",
  "badge",
  "avatar",
  "icon",
]);

const OVERLAY_COLLISION_NODE_KINDS = new Set<UINode["kind"]>([
  "button",
  "input",
  "checkbox",
  "link",
  "radio",
  "switch",
  "select",
  "textarea",
]);

function isFigmaScreenshotPath(value: string): boolean {
  return /^figma\/screenshots\//.test(value);
}

function childIdsForNode(node: UINode | undefined): string[] {
  if (!node) {
    return [];
  }
  if ("childIds" in node) {
    return node.childIds;
  }
  if (node.kind === "tabs") {
    return node.tabs.flatMap((tab) => tab.childIds);
  }
  return [];
}

function reachableNodes(
  rootNodeId: string,
  nodeById: ReadonlyMap<string, UINode>,
): UINode[] {
  const output: UINode[] = [];
  const queue = [rootNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    output.push(node);
    queue.push(...childIdsForNode(node));
  }
  return output;
}

function structuredNodeCount(nodes: readonly UINode[]): number {
  return nodes.filter((node) => STRUCTURED_NODE_KINDS.has(node.kind)).length;
}

function rootScreenshotImage(
  rootNode: UINode | undefined,
  nodeById: ReadonlyMap<string, UINode>,
): Extract<UINode, { kind: "image" }> | undefined {
  if (
    rootNode?.kind === "image" &&
    isFigmaScreenshotPath(rootNode.assetRef)
  ) {
    return rootNode;
  }
  const childIds = childIdsForNode(rootNode);
  if (childIds.length !== 1) {
    return undefined;
  }
  const onlyChild = nodeById.get(childIds[0]!);
  if (
    onlyChild?.kind === "image" &&
    isFigmaScreenshotPath(onlyChild.assetRef)
  ) {
    return onlyChild;
  }
  return undefined;
}

function fullPageScreenshotFallbackFeatures(
  uiSpec: UISpec | UISpecDraft,
  evidenceSource: UnsupportedFeatureEvidenceSource,
): UnsupportedFeature[] {
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  return uiSpec.pages.flatMap((page) => {
    const reachable = reachableNodes(page.rootNodeId, nodeById);
    const screenshot = rootScreenshotImage(
      nodeById.get(page.rootNodeId),
      nodeById,
    );
    if (screenshot && structuredNodeCount(reachable) === 0) {
      return [
        {
          code: "full_page_screenshot_fallback_rejected",
          severity: "must_support",
          evidenceSource,
          uiSpecNodeRefs: [screenshot.id],
          impact: ["interaction", "accessibility", "behavior"],
          recommendedAction: "extend_renderer",
        },
      ];
    }
    return [];
  });
}

function localScreenshotFallbackFeatures(
  uiSpec: UISpec | UISpecDraft,
  evidenceSource: UnsupportedFeatureEvidenceSource,
): UnsupportedFeature[] {
  return uiSpec.nodes.flatMap((node) => {
    if (
      (node.kind !== "image" && node.kind !== "pixel_overlay") ||
      !isFigmaScreenshotPath(node.assetRef)
    ) {
      return [];
    }
    return [
      {
        code: "screenshot_fallback_used",
        severity: "fallback_ok",
        evidenceSource,
        uiSpecNodeRefs: [node.id],
        impact: ["visual"],
        recommendedAction: "allow_local_fallback",
      },
    ];
  });
}

interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function nodeFrame(node: UINode): OverlayRect | undefined {
  const style = node.style;
  const frame =
    "frame" in node && node.frame ? node.frame : undefined;
  const left = style?.left ?? frame?.x;
  const top = style?.top ?? frame?.y;
  const width =
    style?.width ??
    frame?.width ??
    ("width" in node ? node.width : undefined);
  const height =
    style?.height ??
    frame?.height ??
    ("height" in node ? node.height : undefined);
  const impliedOrigin =
    (style?.position === "relative" || style?.position === "absolute") &&
    typeof width === "number" &&
    typeof height === "number";
  if (
    (!impliedOrigin && typeof left !== "number") ||
    (!impliedOrigin && typeof top !== "number") ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return undefined;
  }
  return { x: left ?? 0, y: top ?? 0, width, height };
}

function globalNodeFrame(
  node: UINode,
  nodeById: ReadonlyMap<string, UINode>,
  parentByChild: ReadonlyMap<string, ParentPosition>,
): OverlayRect | undefined {
  const frame = nodeFrame(node);
  if (!frame) {
    return undefined;
  }
  if (node.style?.position !== "absolute") {
    return frame;
  }

  let x = frame.x;
  let y = frame.y;
  let parent = parentByChild.get(node.id);
  const visited = new Set<string>();
  while (parent && !visited.has(parent.parentId)) {
    visited.add(parent.parentId);
    const parentNode = nodeById.get(parent.parentId);
    if (!parentNode) {
      break;
    }
    const parentFrame = nodeFrame(parentNode);
    if (parentFrame) {
      x += parentFrame.x;
      y += parentFrame.y;
    }
    parent = parentByChild.get(parent.parentId);
  }

  return { ...frame, x, y };
}

function rectsOverlap(a: OverlayRect, b: OverlayRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

interface ParentPosition {
  parentId: string;
  index: number;
}

function parentPositions(
  nodes: readonly UINode[],
): ReadonlyMap<string, ParentPosition> {
  const positions = new Map<string, ParentPosition>();
  for (const node of nodes) {
    childIdsForNode(node).forEach((childId, index) => {
      if (!positions.has(childId)) {
        positions.set(childId, { parentId: node.id, index });
      }
    });
  }
  return positions;
}

function isAncestorOfNode(
  ancestorId: string,
  nodeId: string,
  nodeById: ReadonlyMap<string, UINode>,
): boolean {
  const queue = childIdsForNode(nodeById.get(ancestorId));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === nodeId) {
      return true;
    }
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    queue.push(...childIdsForNode(nodeById.get(currentId)));
  }
  return false;
}

function overlayIsSafelyBehindInteractive(
  overlay: Extract<UINode, { kind: "pixel_overlay" }>,
  interactive: UINode,
  nodeById: ReadonlyMap<string, UINode>,
  parentByChild: ReadonlyMap<string, ParentPosition>,
): boolean {
  if (overlay.style?.pointerEvents !== "auto") {
    return true;
  }

  if (isAncestorOfNode(overlay.id, interactive.id, nodeById)) {
    return true;
  }

  const overlayZ = overlay.style?.zIndex;
  const interactiveZ = interactive.style?.zIndex;
  if (overlayZ !== undefined && interactiveZ !== undefined) {
    return overlayZ < interactiveZ;
  }
  if (overlayZ !== undefined && overlayZ < 0 && interactiveZ === undefined) {
    return true;
  }
  if (interactiveZ !== undefined && interactiveZ > 0 && overlayZ === undefined) {
    return true;
  }

  const overlayParent = parentByChild.get(overlay.id);
  const interactiveParent = parentByChild.get(interactive.id);
  if (
    overlayParent &&
    interactiveParent &&
    overlayParent.parentId === interactiveParent.parentId &&
    overlay.style?.position === "absolute" &&
    interactive.style?.position === "absolute" &&
    (overlayZ ?? 0) === (interactiveZ ?? 0)
  ) {
    return overlayParent.index < interactiveParent.index;
  }

  return false;
}

function overlayCollisionFeatures(
  uiSpec: UISpec | UISpecDraft,
  evidenceSource: UnsupportedFeatureEvidenceSource,
): UnsupportedFeature[] {
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const parentByChild = parentPositions(uiSpec.nodes);
  const features: UnsupportedFeature[] = [];

  for (const page of uiSpec.pages) {
    const reachable = reachableNodes(page.rootNodeId, nodeById);
    const overlays = reachable.filter(
      (node): node is Extract<UINode, { kind: "pixel_overlay" }> =>
        node.kind === "pixel_overlay",
    );
    const interactive = reachable.filter((node) =>
      OVERLAY_COLLISION_NODE_KINDS.has(node.kind),
    );

    for (const overlay of overlays) {
      const overlayRect = globalNodeFrame(
        overlay,
        nodeById,
        parentByChild,
      );
      if (!overlayRect) {
        features.push({
          code: "residual_assumption_overlay_collision_unknown",
          severity: "defer",
          evidenceSource,
          uiSpecNodeRefs: [overlay.id],
          impact: ["visual", "interaction"],
          recommendedAction: "defer",
        });
        continue;
      }

      let checked = false;
      let collided = false;
      for (const node of interactive) {
        const frame = globalNodeFrame(
          node,
          nodeById,
          parentByChild,
        );
        if (!frame) {
          continue;
        }
        checked = true;
        if (
          rectsOverlap(overlayRect, frame) &&
          !overlayIsSafelyBehindInteractive(
            overlay,
            node,
            nodeById,
            parentByChild,
          )
        ) {
          collided = true;
          break;
        }
      }

      if (collided) {
        features.push({
          code: "renderer_limit_overlay_collision",
          severity: "must_support",
          evidenceSource,
          uiSpecNodeRefs: [overlay.id],
          impact: ["visual", "interaction", "accessibility"],
          recommendedAction: "extend_renderer",
        });
      } else if (!checked) {
        features.push({
          code: "residual_assumption_overlay_collision_unknown",
          severity: "defer",
          evidenceSource,
          uiSpecNodeRefs: [overlay.id],
          impact: ["visual", "interaction"],
          recommendedAction: "defer",
        });
      }
    }
  }

  return features;
}

function missingBehaviorNotesFeature(
  behaviorNotes: string[] | undefined,
  evidenceSource: UnsupportedFeatureEvidenceSource,
): UnsupportedFeature[] {
  if (behaviorNotes === undefined || behaviorNotes.length > 0) {
    return [];
  }
  return [
    {
      code: "missing_behavior_notes",
      severity: "missing_behavior_notes",
      evidenceSource,
      impact: ["behavior"],
      recommendedAction: "request_behavior_notes",
    },
  ];
}

export function collectUnsupportedFeatures(
  uiSpec: UISpec | UISpecDraft,
  evidenceSource: UnsupportedFeatureEvidenceSource,
  options?: { behaviorNotes?: string[] },
): UnsupportedFeature[] {
  return [
    ...fullPageScreenshotFallbackFeatures(uiSpec, evidenceSource),
    ...localScreenshotFallbackFeatures(uiSpec, evidenceSource),
    ...overlayCollisionFeatures(uiSpec, evidenceSource),
    ...missingBehaviorNotesFeature(
      options?.behaviorNotes,
      evidenceSource,
    ),
  ];
}

export function collectScreenshotFallbackFeatures(
  uiSpec: UISpec | UISpecDraft,
  evidenceSource: UnsupportedFeatureEvidenceSource,
): UnsupportedFeature[] {
  return localScreenshotFallbackFeatures(uiSpec, evidenceSource);
}
