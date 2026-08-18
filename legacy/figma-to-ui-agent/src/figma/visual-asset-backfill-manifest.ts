import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  DesignBundle,
  NormalizedNode,
} from "../design-bundle/schema.ts";
import type { M5StaticReport } from "../static-generation/report.ts";
import {
  analyzeVisualAssetCandidates,
  planVisualAssetExports,
  screenshotPathForNode,
  type VisualAssetCandidate,
} from "../static-generation/visual-asset-priority.ts";

const idSchema = z.string().min(1).max(256);

const boundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

export const visualAssetBackfillEntrySchema = z
  .object({
    sourcePageId: idSchema,
    sourceNodeId: idSchema,
    sourceNodeIdHash: z.string().regex(/^[a-f0-9]{64}$/),
    reasonCode: z.string().min(1).max(128),
    priorityRank: z.number().int().positive(),
    bounds: boundsSchema,
  })
  .strict();

export const visualAssetBackfillManifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    projectId: z.string().min(1).max(64),
    designBundleRevision: z.number().int().positive(),
    fileKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z.array(visualAssetBackfillEntrySchema).max(10_000),
  })
  .strict();

export type VisualAssetBackfillEntry = z.infer<
  typeof visualAssetBackfillEntrySchema
>;
export type VisualAssetBackfillManifest = z.infer<
  typeof visualAssetBackfillManifestSchema
>;

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pageOrigin(nodes: readonly NormalizedNode[]): {
  x: number;
  y: number;
} {
  const root = nodes.find((node) => !node.parentId && node.bounds);
  return {
    x: root?.bounds?.x ?? 0,
    y: root?.bounds?.y ?? 0,
  };
}

type BackfillManifestReport = Partial<
  Pick<M5StaticReport, "unsupportedFeatures" | "visualLayers">
>;

function unsupportedNodeIds(
  report: BackfillManifestReport | undefined,
): Set<string> {
  const output = new Set<string>();
  for (const feature of report?.unsupportedFeatures ?? []) {
    if (
      feature.code !== "unsupported_missing_asset" &&
      feature.code !== "visual_stroke_icon_no_asset" &&
      feature.code !== "visual_layer_no_asset"
    ) {
      continue;
    }
    for (const nodeId of feature.figmaNodeRefs ?? []) {
      output.add(nodeId);
    }
  }
  return output;
}

function renderedVisualLayerNodeIds(
  report: BackfillManifestReport | undefined,
): Set<string> {
  return new Set(
    (report?.visualLayers ?? [])
      .filter((layer) => layer.rendered && layer.uiSpecNodeId)
      .map((layer) => layer.sourceNodeId),
  );
}

function hasRenderedVisualLayerAncestor(
  node: NormalizedNode,
  nodeById: ReadonlyMap<string, NormalizedNode>,
  renderedLayerIds: ReadonlySet<string>,
): boolean {
  let currentId = node.parentId;
  while (currentId) {
    if (renderedLayerIds.has(currentId)) {
      return true;
    }
    const current = nodeById.get(currentId);
    if (!current) {
      return false;
    }
    currentId = current.parentId;
  }
  return false;
}

function forceDiagnosticCandidate(
  candidate: VisualAssetCandidate,
): VisualAssetCandidate {
  if (
    candidate.eligible ||
    candidate.reasonCode === "hidden" ||
    candidate.reasonCode === "tiny_safe" ||
    candidate.reasonCode === "covered_by_parent_asset" ||
    candidate.bounds.width <= 0 ||
    candidate.bounds.height <= 0
  ) {
    return candidate;
  }

  const maxDim = Math.max(candidate.bounds.width, candidate.bounds.height);
  const budgetGroup =
    maxDim <= 64 && candidate.area >= 64
      ? "nav_header_icon"
      : "structural_visual";
  return {
    ...candidate,
    eligible: true,
    budgetGroup,
    reasonCode: "diagnostic_missing_asset",
  };
}

export function createVisualAssetBackfillManifest(input: {
  bundle: DesignBundle;
  report?: BackfillManifestReport;
  maxPerPage?: number;
}): VisualAssetBackfillManifest {
  const unsupportedIds = unsupportedNodeIds(input.report);
  const renderedLayerIds = renderedVisualLayerNodeIds(input.report);
  const entries: VisualAssetBackfillEntry[] = [];
  for (const page of input.bundle.pages) {
    const roots = new Set(page.rootNodeIds);
    const nodeById = new Map(page.nodes.map((node) => [node.id, node]));
    const origin = pageOrigin(page.nodes);
    const pageArea = page.width * page.height;
    const candidates = analyzeVisualAssetCandidates(
      page,
      origin,
      pageArea,
    );
    const manifestCandidates = candidates.map((candidate) =>
      unsupportedIds.has(candidate.sourceNodeId)
        ? forceDiagnosticCandidate(candidate)
        : candidate,
    );
    const planned = planVisualAssetExports(
      manifestCandidates.filter(
        (candidate) =>
          candidate.eligible ||
          unsupportedIds.has(candidate.sourceNodeId),
      ),
      input.maxPerPage,
    );
    for (const candidate of planned.selected) {
      const node = nodeById.get(candidate.sourceNodeId);
      if (
        roots.has(candidate.sourceNodeId) ||
        screenshotPathForNode(input.bundle, candidate.sourceNodeId)
      ) {
        continue;
      }
      if (
        !unsupportedIds.has(candidate.sourceNodeId) &&
        renderedLayerIds.has(candidate.sourceNodeId)
      ) {
        continue;
      }
      if (
        node &&
        !unsupportedIds.has(candidate.sourceNodeId) &&
        hasRenderedVisualLayerAncestor(node, nodeById, renderedLayerIds)
      ) {
        continue;
      }
      if (candidate.bounds.width <= 0 || candidate.bounds.height <= 0) {
        continue;
      }
      entries.push({
        sourcePageId: page.id,
        sourceNodeId: candidate.sourceNodeId,
        sourceNodeIdHash: stableHash(candidate.sourceNodeId),
        reasonCode: candidate.reasonCode,
        priorityRank: entries.length + 1,
        bounds: candidate.bounds,
      });
    }
  }

  return visualAssetBackfillManifestSchema.parse({
    schemaVersion: "1",
    projectId: input.bundle.projectId,
    designBundleRevision: input.bundle.revision,
    fileKeyHash: input.bundle.source.fileKeyHash,
    entries,
  });
}
