import { z } from "zod";

import type {
  DesignBundle,
  LocalImageRef,
  NormalizedNode,
  NormalizedPage,
} from "../design-bundle/schema.ts";
import type { StaticPagePlan } from "./page-mapper.ts";
import type { VisualAssetCandidate } from "./visual-asset-priority.ts";
import type { VisualLayerPlan } from "./visual-layer-planner.ts";

function screenshotForSourcePage(
  bundle: DesignBundle,
  sourcePageId: string,
): LocalImageRef | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "page" &&
      entry.entityId === sourcePageId,
  )?.sourceIdHash;
  const path = sourceHash
    ? bundle.provenance.find(
        (entry) =>
          entry.entityKind === "screenshot" &&
          entry.sourceIdHash === sourceHash,
      )?.entityId
    : undefined;
  return bundle.screenshots.find(
    (screenshot) => screenshot.path === path,
  );
}

export const coverageDecisionSchema = z.enum([
  "structured_dom",
  "visual_asset",
  "decorative_layer",
  "layout_container",
  "ignored_safe",
  "unsupported",
]);

export const coverageReasonCodeSchema = z.enum([
  "text_semantic",
  "form_control",
  "button_or_link",
  "layout_only",
  "image_fill",
  "large_visual",
  "named_icon",
  "named_logo",
  "line_or_divider",
  "decorative_shape",
  "structural_visual",
  "background_composite",
  "tiny_safe",
  "hidden",
  "duplicate_visual",
  "covered_by_parent_asset",
  "budget_exceeded",
  "unsupported_missing_asset",
  "visual_layer_no_asset",
  "unsupported_renderer_limit",
]);

export const coverageNodeKindSchema = z.enum([
  "container",
  "text",
  "vector",
  "image",
  "instance",
  "component",
  "unsupported",
]);

export const coverageImpactSchema = z.enum([
  "visual",
  "interaction",
  "layout",
  "text",
  "accessibility",
]);

const coverageBoundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export const coverageRecordSchema = z
  .object({
    sourceNodeId: z.string().min(1).max(256),
    sourcePageId: z.string().min(1).max(256),
    sourceNodeName: z.string().max(2_000).optional(),
    nodeKind: coverageNodeKindSchema,
    decision: coverageDecisionSchema,
    reasonCode: coverageReasonCodeSchema,
    bounds: coverageBoundsSchema.optional(),
    pageRelativeBounds: coverageBoundsSchema.optional(),
    zOrder: z.number().int().nonnegative(),
    area: z.number().finite().nonnegative(),
    areaRatio: z.number().finite().nonnegative(),
    confidence: z.enum(["high", "medium", "low"]),
    uiSpecNodeId: z.string().min(1).max(256).optional(),
    assetRef: z.string().min(1).max(2_048).optional(),
    impact: z.array(coverageImpactSchema).max(5),
  })
  .strict();

const kindCoverageStatsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    structuredDom: z.number().int().nonnegative(),
    visualAsset: z.number().int().nonnegative(),
    decorativeLayer: z.number().int().nonnegative(),
    layoutContainer: z.number().int().nonnegative(),
    ignoredSafe: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
  })
  .strict();

const vectorCoverageStatsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    rendered: z.number().int().nonnegative(),
    ignoredSafe: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    unmapped: z.number().int().nonnegative(),
  })
  .strict();

const imageFillCoverageStatsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    rendered: z.number().int().nonnegative(),
    missingAsset: z.number().int().nonnegative(),
  })
  .strict();

const textCoverageStatsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    rendered: z.number().int().nonnegative(),
    styleComplete: z.number().int().nonnegative(),
  })
  .strict();

export const pageSizeDiagnosticSchema = z
  .object({
    expectedWidth: z.number().finite().nonnegative(),
    expectedHeight: z.number().finite().nonnegative(),
    actualWidth: z.number().finite().nonnegative(),
    actualHeight: z.number().finite().nonnegative(),
    widthMatched: z.boolean(),
    heightMatched: z.boolean(),
    policy: z.enum(["full_page", "viewport_crop", "explicit_region"]),
  })
  .strict();

export const coverageMatrixSchema = z
  .object({
    sourceNodeCount: z.number().int().nonnegative(),
    visibleNodeCount: z.number().int().nonnegative(),
    byKind: z.record(z.string().min(1).max(32), kindCoverageStatsSchema),
    vector: vectorCoverageStatsSchema,
    imageFill: imageFillCoverageStatsSchema,
    text: textCoverageStatsSchema,
  })
  .strict();

export const pageCoverageMatrixSchema = coverageMatrixSchema.extend({
  pageId: z.string().min(1).max(256),
  sourcePageId: z.string().min(1).max(256),
  pageSize: pageSizeDiagnosticSchema,
});

export const coverageReportSchema = z
  .object({
    coverageVersion: z.literal("1"),
    pages: z.array(pageCoverageMatrixSchema).max(1_000),
    records: z.array(coverageRecordSchema).max(500_000),
    aggregate: z
      .object({
        sourceNodeCount: z.number().int().nonnegative(),
        visibleNodeCount: z.number().int().nonnegative(),
        unsupportedCount: z.number().int().nonnegative(),
        unmappedCount: z.number().int().nonnegative(),
      })
      .strict(),
    diagnostics: z
      .object({
        unsupportedByReason: z.record(
          z.string().min(1).max(64),
          z.number().int().nonnegative(),
        ),
        unsupportedByKind: z.record(
          z.string().min(1).max(64),
          z.number().int().nonnegative(),
        ),
        topUnsupported: z
          .array(
            z
              .object({
                sourceNodeId: z.string().min(1).max(256),
                sourcePageId: z.string().min(1).max(256),
                sourceNodeName: z.string().max(2_000).optional(),
                nodeKind: coverageNodeKindSchema,
                reasonCode: coverageReasonCodeSchema,
                area: z.number().finite().nonnegative(),
                bounds: coverageBoundsSchema.optional(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CoverageDecision = z.infer<typeof coverageDecisionSchema>;
export type CoverageReasonCode = z.infer<typeof coverageReasonCodeSchema>;
export type CoverageNodeKind = z.infer<typeof coverageNodeKindSchema>;
export type CoverageImpact = z.infer<typeof coverageImpactSchema>;
export type CoverageRecord = z.infer<typeof coverageRecordSchema>;
export type CoverageMatrix = z.infer<typeof coverageMatrixSchema>;
export type PageCoverageMatrix = z.infer<typeof pageCoverageMatrixSchema>;
export type CoverageReport = z.infer<typeof coverageReportSchema>;
export type PageSizeDiagnostic = z.infer<typeof pageSizeDiagnosticSchema>;

export interface PageCoverageResult {
  readonly matrix: PageCoverageMatrix;
  readonly records: CoverageRecord[];
}

export interface ClassifyCoverageInput {
  readonly bundle: DesignBundle;
  readonly pagePlan: StaticPagePlan;
  readonly visualLayers: readonly VisualLayerPlan[];
  readonly sourceToUiNodeId?: ReadonlyMap<string, string>;
  readonly candidates?: readonly VisualAssetCandidate[];
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

function isInputLikeName(name: string | undefined): boolean {
  const lower = name?.toLowerCase() ?? "";
  return (
    lower.includes("input") ||
    lower.includes("email") ||
    lower.includes("password") ||
    lower.includes("search") ||
    lower.includes("field")
  );
}

function hasVisibleChildren(
  node: NormalizedNode,
  childrenByParent: ReadonlyMap<string, NormalizedNode[]>,
): boolean {
  const children = childrenByParent.get(node.id) ?? [];
  return children.some((child) => child.visible);
}

function decisionFromReason(reason: CoverageReasonCode): CoverageDecision {
  switch (reason) {
    case "image_fill":
    case "large_visual":
    case "named_icon":
    case "named_logo":
    case "button_or_link":
      return "visual_asset";
    case "line_or_divider":
    case "decorative_shape":
    case "structural_visual":
    case "background_composite":
      return "decorative_layer";
    case "text_semantic":
      return "structured_dom";
    case "form_control":
      return "structured_dom";
    case "layout_only":
      return "layout_container";
    case "hidden":
    case "tiny_safe":
    case "duplicate_visual":
    case "covered_by_parent_asset":
      return "ignored_safe";
    case "budget_exceeded":
    case "unsupported_missing_asset":
    case "visual_layer_no_asset":
    case "unsupported_renderer_limit":
      return "unsupported";
    default:
      return "unsupported";
  }
}

function structuredDecision(
  node: NormalizedNode,
  childrenByParent: ReadonlyMap<string, NormalizedNode[]>,
): { decision: CoverageDecision; reason: CoverageReasonCode } | undefined {
  if (node.kind === "text") {
    return { decision: "structured_dom", reason: "text_semantic" };
  }
  if (isButtonLikeName(node.name)) {
    return { decision: "structured_dom", reason: "button_or_link" };
  }
  if (isInputLikeName(node.name)) {
    return { decision: "structured_dom", reason: "form_control" };
  }
  if (
    (node.kind === "container" ||
      node.kind === "instance" ||
      node.kind === "component") &&
    hasVisibleChildren(node, childrenByParent)
  ) {
    return { decision: "layout_container", reason: "layout_only" };
  }
  if (node.kind === "image" && node.imageRefs.length > 0) {
    return { decision: "visual_asset", reason: "image_fill" };
  }
  return undefined;
}

function visualLayerDecision(
  node: NormalizedNode,
  visualLayers: ReadonlyMap<string, VisualLayerPlan>,
): { decision: CoverageDecision; reason: CoverageReasonCode; assetRef?: string } | undefined {
  const layer = visualLayers.get(node.id);
  if (!layer) {
    return undefined;
  }
  if (!layer.rendered) {
    return {
      decision: "unsupported",
      reason: layer.assetRef ? "visual_layer_no_asset" : "unsupported_missing_asset",
    };
  }
  const reason = layerReasonToCoverageReason(layer.layerRole, layer.reason);
  return {
    decision:
      reason === "line_or_divider" ||
      reason === "decorative_shape" ||
      reason === "structural_visual" ||
      reason === "background_composite"
        ? "decorative_layer"
        : "visual_asset",
    reason,
    assetRef: layer.assetRef,
  };
}

function layerReasonToCoverageReason(
  layerRole: string,
  reason: VisualLayerPlan["reason"],
): CoverageReasonCode {
  switch (reason) {
    case "image_visual":
      return "image_fill";
    case "large_visual":
      return "large_visual";
    case "structural_visual":
      return "structural_visual";
    case "background_composite":
      return "background_composite";
    case "named_visual":
      if (layerRole === "line_or_divider") {
        return "line_or_divider";
      }
      if (layerRole === "icon") {
        return "named_icon";
      }
      if (layerRole === "logo") {
        return "named_logo";
      }
      return "decorative_shape";
    default:
      return "decorative_shape";
  }
}

function impactForDecision(
  decision: CoverageDecision,
  nodeKind: NormalizedNode["kind"],
): CoverageImpact[] {
  if (decision === "ignored_safe") {
    return [];
  }
  const impacts: CoverageImpact[] = [];
  if (decision === "structured_dom" || decision === "layout_container") {
    impacts.push("layout");
  }
  if (nodeKind === "text") {
    impacts.push("text");
  }
  if (
    decision === "visual_asset" ||
    decision === "decorative_layer" ||
    nodeKind === "image"
  ) {
    impacts.push("visual");
  }
  if (decision === "structured_dom" && nodeKind !== "text") {
    impacts.push("interaction", "accessibility");
  }
  return impacts;
}

function confidenceFor(
  decision: CoverageDecision,
  nodeKind: NormalizedNode["kind"],
): "high" | "medium" | "low" {
  if (decision === "structured_dom") {
    return nodeKind === "text" ? "high" : "high";
  }
  if (decision === "ignored_safe") {
    return "high";
  }
  if (decision === "unsupported") {
    return "medium";
  }
  if (decision === "layout_container") {
    return "high";
  }
  return nodeKind === "image" ? "high" : "medium";
}

function pageRelativeBounds(
  bounds: NonNullable<NormalizedNode["bounds"]>,
  pageOrigin: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: bounds.x - pageOrigin.x,
    y: bounds.y - pageOrigin.y,
    width: bounds.width,
    height: bounds.height,
  };
}

export function classifyPageCoverage(
  input: ClassifyCoverageInput,
): PageCoverageResult {
  const page = input.bundle.pages.find(
    (candidate) => candidate.id === input.pagePlan.sourcePageId,
  );
  if (!page) {
    return {
      matrix: {
        pageId: input.pagePlan.pageId,
        sourcePageId: input.pagePlan.sourcePageId,
        sourceNodeCount: 0,
        visibleNodeCount: 0,
        byKind: {},
        vector: { total: 0, rendered: 0, ignoredSafe: 0, unsupported: 0, unmapped: 0 },
        imageFill: { total: 0, rendered: 0, missingAsset: 0 },
        text: { total: 0, rendered: 0, styleComplete: 0 },
        pageSize: {
          expectedWidth: input.pagePlan.bounds.width,
          expectedHeight: input.pagePlan.bounds.height,
          actualWidth: 0,
          actualHeight: 0,
          widthMatched: false,
          heightMatched: false,
          policy: "full_page",
        },
      },
      records: [],
    };
  }

  const pageArea =
    input.pagePlan.bounds.width * input.pagePlan.bounds.height;
  const pageOrigin = {
    x: input.pagePlan.bounds.x,
    y: input.pagePlan.bounds.y,
  };

  const childrenByParent = new Map<string, NormalizedNode[]>();
  for (const node of page.nodes) {
    if (node.parentId) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentId, siblings);
    }
  }

  const visualLayerByNodeId = new Map<string, VisualLayerPlan>();
  for (const layer of input.visualLayers) {
    if (layer.sourcePageId === page.id) {
      visualLayerByNodeId.set(layer.sourceNodeId, layer);
    }
  }

  const candidateById = new Map<string, VisualAssetCandidate>();
  for (const candidate of input.candidates ?? []) {
    if (candidate.sourcePageId === page.id) {
      candidateById.set(candidate.sourceNodeId, candidate);
    }
  }

  const records: CoverageRecord[] = [];
  const byKind = new Map<CoverageNodeKind, CoverageMatrix["byKind"][string]>();

  function ensureKindStats(kind: CoverageNodeKind) {
    if (!byKind.has(kind)) {
      byKind.set(kind, {
        total: 0,
        structuredDom: 0,
        visualAsset: 0,
        decorativeLayer: 0,
        layoutContainer: 0,
        ignoredSafe: 0,
        unsupported: 0,
      });
    }
    return byKind.get(kind)!;
  }

  let vectorTotal = 0;
  let vectorRendered = 0;
  let vectorIgnored = 0;
  let vectorUnsupported = 0;
  let vectorUnmapped = 0;
  let imageFillTotal = 0;
  let imageFillRendered = 0;
  let imageFillMissing = 0;
  let textTotal = 0;
  let textRendered = 0;
  let textStyleComplete = 0;
  let visibleCount = 0;

  for (const [zOrder, node] of page.nodes.entries()) {
    const area =
      node.bounds && node.bounds.width > 0 && node.bounds.height > 0
        ? node.bounds.width * node.bounds.height
        : 0;
    const areaRatio = pageArea > 0 ? area / pageArea : 0;
    const pageRel = node.bounds
      ? pageRelativeBounds(node.bounds, pageOrigin)
      : undefined;

    let decision: CoverageDecision;
    let reason: CoverageReasonCode;
    let assetRef: string | undefined;

    if (!node.visible) {
      decision = "ignored_safe";
      reason = "hidden";
    } else {
      visibleCount += 1;
      const structured = structuredDecision(node, childrenByParent);
      if (structured) {
        decision = structured.decision;
        reason = structured.reason;
      } else {
        const visual = visualLayerDecision(node, visualLayerByNodeId);
        if (visual) {
          decision = visual.decision;
          reason = visual.reason;
          assetRef = visual.assetRef;
        } else {
          const candidate = candidateById.get(node.id);
          if (candidate?.coveredByParentAsset) {
            decision = "ignored_safe";
            reason = "covered_by_parent_asset";
          } else if (candidate?.reasonCode === "budget_exceeded") {
            decision = "unsupported";
            reason = "budget_exceeded";
          } else if (candidate?.reasonCode === "other_vector") {
            decision = "unsupported";
            reason = "unsupported_renderer_limit";
          } else if (node.kind === "vector" || node.kind === "unsupported") {
            decision = "unsupported";
            reason = "unsupported_renderer_limit";
          } else if (area < 64) {
            decision = "ignored_safe";
            reason = "tiny_safe";
          } else {
            decision = "unsupported";
            reason = "unsupported_renderer_limit";
          }
        }
      }
    }

    const uiSpecNodeId = input.sourceToUiNodeId?.get(node.id);
    const record: CoverageRecord = {
      sourceNodeId: node.id,
      sourcePageId: page.id,
      sourceNodeName: node.name,
      nodeKind: node.kind,
      decision,
      reasonCode: reason,
      bounds: node.bounds,
      pageRelativeBounds: pageRel,
      zOrder,
      area,
      areaRatio,
      confidence: confidenceFor(decision, node.kind),
      uiSpecNodeId,
      assetRef,
      impact: impactForDecision(decision, node.kind),
    };
    records.push(record);

    const stats = ensureKindStats(record.nodeKind);
    stats.total += 1;
    if (decision === "structured_dom") {
      stats.structuredDom += 1;
    } else if (decision === "visual_asset") {
      stats.visualAsset += 1;
    } else if (decision === "decorative_layer") {
      stats.decorativeLayer += 1;
    } else if (decision === "layout_container") {
      stats.layoutContainer += 1;
    } else if (decision === "ignored_safe") {
      stats.ignoredSafe += 1;
    } else if (decision === "unsupported") {
      stats.unsupported += 1;
    }

    if (node.kind === "vector") {
      vectorTotal += 1;
      if (
        decision === "visual_asset" ||
        decision === "decorative_layer" ||
        reason === "covered_by_parent_asset"
      ) {
        vectorRendered += 1;
      } else if (decision === "ignored_safe") {
        vectorIgnored += 1;
      } else if (decision === "unsupported") {
        vectorUnsupported += 1;
      } else {
        vectorUnmapped += 1;
      }
    }

    if (
      node.visible &&
      (node.kind === "image" ||
        reason === "image_fill" ||
        reason === "named_logo")
    ) {
      imageFillTotal += 1;
      if (
        decision === "visual_asset" ||
        decision === "decorative_layer"
      ) {
        imageFillRendered += 1;
      } else if (
        decision === "unsupported" &&
        (reason === "unsupported_missing_asset" ||
          reason === "visual_layer_no_asset")
      ) {
        imageFillMissing += 1;
      }
    }

    if (node.kind === "text") {
      textTotal += 1;
      if (decision === "structured_dom") {
        textRendered += 1;
        if (
          node.text?.fontFamily &&
          node.text.fontSize &&
          node.text.fontWeight !== undefined
        ) {
          textStyleComplete += 1;
        }
      }
    }
  }

  const pageScreenshot = screenshotForSourcePage(
    input.bundle,
    page.id,
  );
  const actualWidth = pageScreenshot?.width ?? 0;
  const actualHeight = pageScreenshot?.height ?? 0;
  const expectedWidth = input.pagePlan.bounds.width;
  const expectedHeight = input.pagePlan.bounds.height;

  const matrix: PageCoverageMatrix = {
    pageId: input.pagePlan.pageId,
    sourcePageId: page.id,
    sourceNodeCount: page.nodes.length,
    visibleNodeCount: visibleCount,
    byKind: Object.fromEntries(byKind.entries()),
    vector: {
      total: vectorTotal,
      rendered: vectorRendered,
      ignoredSafe: vectorIgnored,
      unsupported: vectorUnsupported,
      unmapped: vectorUnmapped,
    },
    imageFill: {
      total: imageFillTotal,
      rendered: imageFillRendered,
      missingAsset: imageFillMissing,
    },
    text: {
      total: textTotal,
      rendered: textRendered,
      styleComplete: textStyleComplete,
    },
    pageSize: {
      expectedWidth,
      expectedHeight,
      actualWidth,
      actualHeight,
      widthMatched: actualWidth === expectedWidth && expectedWidth > 0,
      heightMatched: actualHeight === expectedHeight && expectedHeight > 0,
      policy: "full_page",
    },
  };

  return { matrix, records };
}

export interface BuildCoverageReportInput {
  readonly pages: readonly PageCoverageResult[];
}

export function buildCoverageReport(
  input: BuildCoverageReportInput,
): CoverageReport {
  const allRecords: CoverageRecord[] = [];
  const matrices: PageCoverageMatrix[] = [];
  let sourceNodeCount = 0;
  let visibleNodeCount = 0;
  let unsupportedCount = 0;
  let unmappedCount = 0;

  for (const page of input.pages) {
    matrices.push(page.matrix);
    allRecords.push(...page.records);
    sourceNodeCount += page.matrix.sourceNodeCount;
    visibleNodeCount += page.matrix.visibleNodeCount;
    unsupportedCount += page.records.filter(
      (record) => record.decision === "unsupported",
    ).length;
    unmappedCount += page.matrix.vector.unmapped;
  }

  const unsupportedRecords = allRecords.filter(
    (record) => record.decision === "unsupported",
  );
  const unsupportedByReason: Record<string, number> = {};
  const unsupportedByKind: Record<string, number> = {};
  for (const record of unsupportedRecords) {
    unsupportedByReason[record.reasonCode] =
      (unsupportedByReason[record.reasonCode] ?? 0) + 1;
    unsupportedByKind[record.nodeKind] =
      (unsupportedByKind[record.nodeKind] ?? 0) + 1;
  }

  return {
    coverageVersion: "1",
    pages: matrices,
    records: allRecords,
    aggregate: {
      sourceNodeCount,
      visibleNodeCount,
      unsupportedCount,
      unmappedCount,
    },
    diagnostics: {
      unsupportedByReason,
      unsupportedByKind,
      topUnsupported: [...unsupportedRecords]
        .sort((left, right) => right.area - left.area)
        .slice(0, 50)
        .map((record) => ({
          sourceNodeId: record.sourceNodeId,
          sourcePageId: record.sourcePageId,
          sourceNodeName: record.sourceNodeName,
          nodeKind: record.nodeKind,
          reasonCode: record.reasonCode,
          area: record.area,
          bounds: record.bounds,
        })),
    },
  };
}
