import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  DesignBundle,
  LocalImageRef,
  NormalizedNode,
} from "../design-bundle/schema.ts";
import { ProjectStore } from "../project-store/store.ts";
import {
  chunkExportIds,
} from "../static-generation/visual-asset-priority.ts";
import { parseFigmaDesignUrl } from "./url.ts";
import type { FigmaImageDownloader } from "./assets.ts";
import type { FigmaRestClient } from "./rest-client.ts";
import {
  visualAssetBackfillManifestSchema,
  type VisualAssetBackfillManifest,
} from "./visual-asset-backfill-manifest.ts";

const imageRenderResponseSchema = z
  .object({
    err: z.null().optional(),
    images: z.record(z.string(), z.string().url().nullable()),
  })
  .strict();

export type VisualAssetBackfillErrorCode =
  | "manifest_invalid"
  | "file_key_mismatch"
  | "node_not_found"
  | "page_or_root_forbidden"
  | "duplicate_node"
  | "missing_render_url";

export class VisualAssetBackfillError extends Error {
  readonly code: VisualAssetBackfillErrorCode;

  constructor(code: VisualAssetBackfillErrorCode, message: string) {
    super(message);
    this.name = "VisualAssetBackfillError";
    this.code = code;
  }
}

export interface VisualAssetBackfillPlan {
  readonly projectId: string;
  readonly designBundleRevision: number;
  readonly nodeCount: number;
  readonly chunkCount: number;
  readonly nodeIds: string[];
}

export interface VisualAssetBackfillApplyResult extends VisualAssetBackfillPlan {
  readonly nextDesignBundleRevision: number;
  readonly registeredImages: LocalImageRef[];
}

export interface VisualAssetBackfillServiceOptions {
  store: ProjectStore;
  restClient: Pick<FigmaRestClient, "getImageRenders">;
  downloader: Pick<FigmaImageDownloader, "downloadAll">;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nodesById(bundle: DesignBundle): Map<string, NormalizedNode> {
  return new Map(
    bundle.pages.flatMap((page) =>
      page.nodes.map((node) => [node.id, node] as const),
    ),
  );
}

function rootIds(bundle: DesignBundle): Set<string> {
  return new Set(bundle.pages.flatMap((page) => page.rootNodeIds));
}

function uniqueByPath<T extends { path: string }>(items: readonly T[]): T[] {
  const output = new Map<string, T>();
  for (const item of items) {
    output.set(item.path, item);
  }
  return [...output.values()];
}

export class VisualAssetBackfillService {
  private readonly store: ProjectStore;
  private readonly restClient: Pick<FigmaRestClient, "getImageRenders">;
  private readonly downloader: Pick<FigmaImageDownloader, "downloadAll">;

  constructor(options: VisualAssetBackfillServiceOptions) {
    this.store = options.store;
    this.restClient = options.restClient;
    this.downloader = options.downloader;
  }

  async plan(input: {
    projectId: string;
    figmaUrl: string;
    manifest: VisualAssetBackfillManifest;
  }): Promise<VisualAssetBackfillPlan> {
    const manifest = visualAssetBackfillManifestSchema.parse(
      input.manifest,
    );
    const bundle = await this.store.loadDesignBundle(input.projectId);
    this.validate(input.figmaUrl, bundle, manifest);
    const nodeIds = manifest.entries.map((entry) => entry.sourceNodeId);
    return {
      projectId: bundle.projectId,
      designBundleRevision: bundle.revision,
      nodeCount: nodeIds.length,
      chunkCount: chunkExportIds(nodeIds).length,
      nodeIds,
    };
  }

  async apply(input: {
    projectId: string;
    figmaUrl: string;
    manifest: VisualAssetBackfillManifest;
    signal?: AbortSignal;
  }): Promise<VisualAssetBackfillApplyResult> {
    const manifest = visualAssetBackfillManifestSchema.parse(
      input.manifest,
    );
    const bundle = await this.store.loadDesignBundle(input.projectId);
    this.validate(input.figmaUrl, bundle, manifest);
    const parsedUrl = parseFigmaDesignUrl(input.figmaUrl);
    const nodeIds = manifest.entries.map((entry) => entry.sourceNodeId);
    const urls = new Map<string, string>();
    for (const chunk of chunkExportIds(nodeIds)) {
      const raw = await this.restClient.getImageRenders(
        parsedUrl.fileKey,
        chunk,
        { format: "png", scale: 1, signal: input.signal },
      );
      const parsed = imageRenderResponseSchema.parse(raw);
      for (const nodeId of chunk) {
        const url = parsed.images[nodeId];
        if (!url) {
          throw new VisualAssetBackfillError(
            "missing_render_url",
            `Figma 未返回节点图片 URL：${nodeId}`,
          );
        }
        urls.set(nodeId, url);
      }
    }

    const downloaded = await this.downloader.downloadAll(
      input.projectId,
      nodeIds.map((nodeId) => ({
        sourceRef: nodeId,
        url: urls.get(nodeId)!,
        kind: "screenshots",
      })),
      input.signal,
    );
    const registeredImages = nodeIds.map((nodeId) => {
      const image = downloaded.get(nodeId);
      if (!image) {
        throw new VisualAssetBackfillError(
          "missing_render_url",
          `节点图片下载未登记：${nodeId}`,
        );
      }
      return image;
    });

    const { revision: _revision, ...draft } = bundle;
    const existingProvenance = [...bundle.provenance];
    for (const [index, nodeId] of nodeIds.entries()) {
      const sourceIdHash = stableHash(nodeId);
      if (
        !existingProvenance.some(
          (entry) =>
            entry.entityKind === "node" && entry.entityId === nodeId,
        )
      ) {
        existingProvenance.push({
          entityKind: "node",
          entityId: nodeId,
          origin: "figma_node",
          sourceIdHash,
        });
      }
      existingProvenance.push({
        entityKind: "screenshot",
        entityId: registeredImages[index]!.path,
        origin: "figma_node",
        sourceIdHash,
      });
    }
    const saved = await this.store.saveDesignBundle({
      projectId: input.projectId,
      baseRevision: bundle.revision,
      draft: {
        ...draft,
        screenshots: uniqueByPath([
          ...bundle.screenshots,
          ...registeredImages,
        ]),
        provenance: existingProvenance,
      },
    });

    return {
      projectId: saved.projectId,
      designBundleRevision: bundle.revision,
      nextDesignBundleRevision: saved.revision,
      nodeCount: nodeIds.length,
      chunkCount: chunkExportIds(nodeIds).length,
      nodeIds,
      registeredImages,
    };
  }

  private validate(
    figmaUrl: string,
    bundle: DesignBundle,
    manifest: VisualAssetBackfillManifest,
  ): void {
    if (
      manifest.projectId !== bundle.projectId ||
      manifest.designBundleRevision !== bundle.revision
    ) {
      throw new VisualAssetBackfillError(
        "manifest_invalid",
        "manifest 与当前 DesignBundle 修订不一致",
      );
    }
    const parsedUrl = parseFigmaDesignUrl(figmaUrl);
    if (stableHash(parsedUrl.fileKey) !== bundle.source.fileKeyHash) {
      throw new VisualAssetBackfillError(
        "file_key_mismatch",
        "Figma URL fileKey 与 DesignBundle 来源不一致",
      );
    }
    const nodeMap = nodesById(bundle);
    const roots = rootIds(bundle);
    const seen = new Set<string>();
    for (const entry of manifest.entries) {
      if (seen.has(entry.sourceNodeId)) {
        throw new VisualAssetBackfillError(
          "duplicate_node",
          `manifest 节点重复：${entry.sourceNodeId}`,
        );
      }
      seen.add(entry.sourceNodeId);
      if (roots.has(entry.sourceNodeId)) {
        throw new VisualAssetBackfillError(
          "page_or_root_forbidden",
          `manifest 不能包含 root artboard：${entry.sourceNodeId}`,
        );
      }
      if (!nodeMap.has(entry.sourceNodeId)) {
        throw new VisualAssetBackfillError(
          "node_not_found",
          `manifest 节点不存在：${entry.sourceNodeId}`,
        );
      }
      if (entry.sourceNodeIdHash !== stableHash(entry.sourceNodeId)) {
        throw new VisualAssetBackfillError(
          "manifest_invalid",
          `manifest 节点哈希不匹配：${entry.sourceNodeId}`,
        );
      }
    }
  }
}
