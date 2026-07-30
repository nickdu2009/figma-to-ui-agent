import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  DesignBundleDraft,
  DesignBundleWarning,
  LocalImageRef,
  VariablesCapability,
} from "../design-bundle/schema.ts";
import {
  ProjectStore,
  ProjectStoreError,
} from "../project-store/store.ts";
import { SCHEMA_VERSION } from "../project-store/schemas.ts";
import {
  type InspectFigmaOutput,
  inspectFigmaInputSchema,
  inspectFigmaOutputSchema,
} from "../tools/contracts.ts";
import {
  FigmaImageDownloader,
  type FigmaRemoteImage,
} from "./assets.ts";
import {
  type FigmaVisualLayerReference,
  type NormalizedFigmaDocument,
  normalizeFigmaDocument,
} from "./normalize.ts";
import { FigmaRestClient } from "./rest-client.ts";
import {
  parseFigmaDesignUrl,
  resolveFigmaTargetNodes,
} from "./url.ts";
import {
  applyNodeDesignValueRefs,
  classifyVariablesUnavailable,
  extractFigmaVariables,
  inferDesignValuesFromBindings,
  inferRepeatedDesignValues,
  type DesignValueExtraction,
} from "./variables.ts";

const imageRenderResponseSchema = z
  .object({
    images: z.record(z.string(), z.string().url().nullable()),
  })
  .passthrough();

const imageFillResponseSchema = z
  .object({
    meta: z
      .object({
        images: z.record(z.string(), z.string().url().nullable()),
      })
    .passthrough(),
  })
  .passthrough();

const TARGETED_NODES_CANVAS_ID =
  "__figma_to_ui_agent_targeted_nodes_canvas__";
const MAX_VISUAL_LAYER_RENDERS = 160;

export type FigmaInspectionErrorCode =
  | "invalid_response"
  | "missing_core_image";

export class FigmaInspectionError extends Error {
  readonly code: FigmaInspectionErrorCode;

  constructor(code: FigmaInspectionErrorCode, message: string) {
    super(message);
    this.name = "FigmaInspectionError";
    this.code = code;
  }
}

export interface FigmaInspectorOptions {
  restClient: FigmaRestClient;
  imageDownloader: FigmaImageDownloader;
  projectStore: ProjectStore;
  now?: () => Date;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function uniqueImageRefs(
  refs: readonly LocalImageRef[],
): LocalImageRef[] {
  return [
    ...new Map(refs.map((ref) => [ref.path, ref])).values(),
  ];
}

function boundedWarnings(
  warnings: readonly DesignBundleWarning[],
): DesignBundleWarning[] {
  if (warnings.length <= 10_000) {
    return [...warnings];
  }
  return [
    ...warnings.slice(0, 9_999),
    {
      code: "warnings_truncated",
      detail: `另有 ${warnings.length - 9_999} 条告警未写入`,
    },
  ];
}

function visualLayerReasonPriority(
  reason: FigmaVisualLayerReference["reason"],
): number {
  switch (reason) {
    case "image_fill":
      return 9;
    case "button_icon":
      return 8;
    case "named_logo":
      return 7;
    case "nav_header_icon":
    case "named_icon":
      return 6;
    case "line_or_divider":
      return 5;
    case "large_visual":
      return 4;
    case "structural_visual":
      return 3;
    case "named_decorative":
      return 2;
    default:
      return 1;
  }
}

function visualLayerRenderIds(
  normalized: NormalizedFigmaDocument,
  excludedNodeIds: ReadonlySet<string>,
): string[] {
  const nodes = normalized.pages.flatMap((page) => page.nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const zOrderById = new Map(nodes.map((node, index) => [node.id, index]));
  return [
    ...new Map(
      normalized.visualLayerRefs
        .filter((layer) => !excludedNodeIds.has(layer.nodeId))
        .map((layer) => [layer.nodeId, layer]),
    ).values(),
  ]
    .sort((left, right) => {
      const priorityDelta =
        visualLayerReasonPriority(right.reason) -
        visualLayerReasonPriority(left.reason);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      const leftNode = nodeById.get(left.nodeId);
      const rightNode = nodeById.get(right.nodeId);
      const leftArea = leftNode?.bounds
        ? leftNode.bounds.width * leftNode.bounds.height
        : 0;
      const rightArea = rightNode?.bounds
        ? rightNode.bounds.width * rightNode.bounds.height
        : 0;
      if (leftArea !== rightArea) {
        return rightArea - leftArea;
      }
      return (zOrderById.get(right.nodeId) ?? 0) -
        (zOrderById.get(left.nodeId) ?? 0);
    })
    .slice(0, MAX_VISUAL_LAYER_RENDERS)
    .map((layer) => layer.nodeId);
}

function addUnavailableWarning(
  warnings: DesignBundleWarning[],
  capability: Extract<
    VariablesCapability,
    { status: "unavailable_optional" }
  >,
): void {
  warnings.push({
    code: "variables_unavailable_optional",
    detail: `Variables 可选能力不可用：${capability.reasonCode}`,
  });
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeRecords(
  values: readonly unknown[],
): Record<string, unknown> {
  return Object.assign({}, ...values.map(recordFromUnknown));
}

function targetedNodesPayload(
  nodesPayload: Record<string, unknown>,
  targetNodeIds: readonly string[],
): Record<string, unknown> {
  const nodes = recordFromUnknown(nodesPayload.nodes);
  const entries = targetNodeIds.map((targetNodeId) => {
    const entry = recordFromUnknown(nodes[targetNodeId]);
    const document = entry.document;
    if (!document) {
      throw new FigmaInspectionError(
        "invalid_response",
        `Figma 目标节点响应缺少 document：${targetNodeId}`,
      );
    }
    return entry;
  });
  return {
    name: "Targeted Figma nodes",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        {
          id: TARGETED_NODES_CANVAS_ID,
          name: "Selected nodes",
          type: "CANVAS",
          children: entries.map((entry) => entry.document),
        },
      ],
    },
    components: mergeRecords([
      nodesPayload.components,
      ...entries.map((entry) => entry.components),
    ]),
    componentSets: mergeRecords([
      nodesPayload.componentSets,
      ...entries.map((entry) => entry.componentSets),
    ]),
    styles: mergeRecords([
      nodesPayload.styles,
      ...entries.map((entry) => entry.styles),
    ]),
  };
}

function mergeNodePayloads(
  basePayload: Record<string, unknown>,
  extraPayload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...basePayload,
    nodes: {
      ...recordFromUnknown(basePayload.nodes),
      ...recordFromUnknown(extraPayload.nodes),
    },
    components: mergeRecords([
      basePayload.components,
      extraPayload.components,
    ]),
    componentSets: mergeRecords([
      basePayload.componentSets,
      extraPayload.componentSets,
    ]),
    styles: mergeRecords([basePayload.styles, extraPayload.styles]),
  };
}

function prototypeTargetNodeIds(
  normalized: NormalizedFigmaDocument,
  existingNodeIds: ReadonlySet<string>,
): string[] {
  const output = new Set<string>();
  for (const node of normalized.pages.flatMap((page) => page.nodes)) {
    for (const interaction of node.prototypeInteractions ?? []) {
      const targetId =
        interaction.transitionNodeId ?? interaction.destinationId;
      if (targetId && !existingNodeIds.has(targetId)) {
        output.add(targetId);
      }
    }
  }
  return [...output].slice(0, 100);
}

async function loadTargetedFigmaPayload(
  restClient: FigmaRestClient,
  fileKey: string,
  targetNodeIds: readonly string[],
  signal?: AbortSignal,
): Promise<{
  payload: Record<string, unknown>;
  normalizationTargetNodeIds: string[];
}> {
  const nodesPayload = await restClient.getNodes(
    fileKey,
    targetNodeIds,
    signal,
  );
  const initialPayload = targetedNodesPayload(
    nodesPayload,
    targetNodeIds,
  );
  const initial = normalizeFigmaDocument(initialPayload, {
    targetNodeIds,
  });
  const existingNodeIds = new Set(
    initial.pages.flatMap((page) => page.nodes.map((node) => node.id)),
  );
  const extraNodeIds = prototypeTargetNodeIds(initial, existingNodeIds);
  if (extraNodeIds.length < 1) {
    return {
      payload: initialPayload,
      normalizationTargetNodeIds: [...targetNodeIds],
    };
  }
  const extraPayload = await restClient.getNodes(
    fileKey,
    extraNodeIds,
    signal,
  );
  const normalizationTargetNodeIds = [...targetNodeIds, ...extraNodeIds];
  return {
    payload: targetedNodesPayload(
      mergeNodePayloads(nodesPayload, extraPayload),
      normalizationTargetNodeIds,
    ),
    normalizationTargetNodeIds,
  };
}

async function loadFigmaPayload(
  restClient: FigmaRestClient,
  fileKey: string,
  targetNodeIds: readonly string[],
  signal?: AbortSignal,
): Promise<{
  payload: Record<string, unknown>;
  normalizationTargetNodeIds: string[];
}> {
  if (targetNodeIds.length > 0) {
    return await loadTargetedFigmaPayload(
      restClient,
      fileKey,
      targetNodeIds,
      signal,
    );
  }
  return {
    payload: await restClient.getFile(fileKey, signal),
    normalizationTargetNodeIds: [],
  };
}

async function currentDesignBundleRevision(
  store: ProjectStore,
  projectId: string,
): Promise<number> {
  try {
    return (await store.loadDesignBundle(projectId)).revision;
  } catch (error) {
    if (
      error instanceof ProjectStoreError &&
      error.code === "not_found"
    ) {
      return 0;
    }
    throw error;
  }
}

function parseImageFills(
  raw: unknown,
): Record<string, string | null> {
  const parsed = imageFillResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FigmaInspectionError(
      "invalid_response",
      "Figma 图片填充响应结构无效",
    );
  }
  return parsed.data.meta.images;
}

function parseImageRenders(
  raw: unknown,
): Record<string, string | null> {
  const parsed = imageRenderResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FigmaInspectionError(
      "invalid_response",
      "Figma 截图响应结构无效",
    );
  }
  return parsed.data.images;
}

export class FigmaInspector {
  private readonly restClient: FigmaRestClient;
  private readonly imageDownloader: FigmaImageDownloader;
  private readonly projectStore: ProjectStore;
  private readonly now: () => Date;

  constructor(options: FigmaInspectorOptions) {
    this.restClient = options.restClient;
    this.imageDownloader = options.imageDownloader;
    this.projectStore = options.projectStore;
    this.now = options.now ?? (() => new Date());
  }

  async inspect(
    rawInput: unknown,
    signal?: AbortSignal,
    options?: {
      variablesMode?: "default_optional" | "disabled_restricted_live";
    },
  ): Promise<InspectFigmaOutput> {
    const variablesMode = options?.variablesMode ?? "default_optional";
    const input = inspectFigmaInputSchema.parse(rawInput);
    const parsedUrl = parseFigmaDesignUrl(input.figmaUrl);
    const targetNodeIds = resolveFigmaTargetNodes(
      parsedUrl,
      input.targetNodes,
    );

    const loadedPayload = await loadFigmaPayload(
      this.restClient,
      parsedUrl.fileKey,
      targetNodeIds,
      signal,
    );
    const filePayload = loadedPayload.payload;
    const initial = normalizeFigmaDocument(filePayload, {
      targetNodeIds: loadedPayload.normalizationTargetNodeIds,
    });

    const remoteImages: FigmaRemoteImage[] = [];
    const assetRequestRefBySource = new Map<string, string>();
    if (initial.imageSourceRefs.length > 0) {
      const imageFillUrls = parseImageFills(
        await this.restClient.getImageFills(
          parsedUrl.fileKey,
          signal,
        ),
      );
      for (const imageSource of initial.imageSourceRefs) {
        const url = imageFillUrls[imageSource.sourceRef];
        if (!url) {
          throw new FigmaInspectionError(
            "missing_core_image",
            "Figma 图片填充缺少可下载资源",
          );
        }
        const requestRef = `asset.${stableHash(
          imageSource.sourceRef,
        )}`;
        assetRequestRefBySource.set(
          imageSource.sourceRef,
          requestRef,
        );
        remoteImages.push({
          sourceRef: requestRef,
          url,
          kind: "assets",
        });
      }
    }

    const screenshotRequestRefByPage = new Map<string, string>();
    for (const pageIds of chunks(
      initial.pages.map((page) => page.id),
      100,
    )) {
      const renderUrls = parseImageRenders(
        await this.restClient.getImageRenders(
          parsedUrl.fileKey,
          pageIds,
          { format: "png", scale: 1, signal },
        ),
      );
      for (const pageId of pageIds) {
        const url = renderUrls[pageId];
        if (!url) {
          throw new FigmaInspectionError(
            "missing_core_image",
            "Figma 页面缺少可下载截图",
          );
        }
        const requestRef = `screenshot.${stableHash(pageId)}`;
        screenshotRequestRefByPage.set(pageId, requestRef);
        remoteImages.push({
          sourceRef: requestRef,
          url,
          kind: "screenshots",
        });
      }
    }
    const visualLayerIds = visualLayerRenderIds(
      initial,
      new Set(screenshotRequestRefByPage.keys()),
    );
    const screenshotRequestRefByVisualLayer = new Map<string, string>();
    for (const layerIds of chunks(visualLayerIds, 100)) {
      const renderUrls = parseImageRenders(
        await this.restClient.getImageRenders(
          parsedUrl.fileKey,
          layerIds,
          { format: "png", scale: 1, signal },
        ),
      );
      for (const layerId of layerIds) {
        const url = renderUrls[layerId];
        if (!url) {
          continue;
        }
        const requestRef = `visual.${stableHash(layerId)}`;
        screenshotRequestRefByVisualLayer.set(layerId, requestRef);
        remoteImages.push({
          sourceRef: requestRef,
          url,
          kind: "screenshots",
        });
      }
    }

    const localImages = await this.imageDownloader.downloadAll(
      input.projectId,
      remoteImages,
      signal,
    );
    const imagePathBySourceRef = new Map<string, string>();
    for (const [sourceRef, requestRef] of assetRequestRefBySource) {
      const local = localImages.get(requestRef);
      if (!local) {
        throw new FigmaInspectionError(
          "missing_core_image",
          "Figma 图片填充未完成本地保存",
        );
      }
      imagePathBySourceRef.set(sourceRef, local.path);
    }
    const normalized = normalizeFigmaDocument(filePayload, {
      targetNodeIds: loadedPayload.normalizationTargetNodeIds,
      imagePathBySourceRef,
    });

    let capability: VariablesCapability;
    let values: DesignValueExtraction;
    if (variablesMode === "disabled_restricted_live") {
      capability = {
        status: "unavailable_optional",
        reasonCode: "restricted_mode",
      };
      values = inferDesignValuesFromBindings(
        normalized.bindingObservations,
      );
      if (values.designValues.length < 1) {
        values = inferRepeatedDesignValues(
          normalized.pages,
          normalized.styles,
        );
      }
      addUnavailableWarning(values.warnings, capability);
    } else {
      try {
        const variablesPayload =
          await this.restClient.getLocalVariables(
            parsedUrl.fileKey,
            signal,
          );
        const extracted = extractFigmaVariables(
          variablesPayload,
          normalized.bindingObservations,
        );
        capability = extracted.capability;
        values = extracted;
      } catch (error) {
        const unavailable = classifyVariablesUnavailable(error);
        if (!unavailable) {
          throw error;
        }
        capability = unavailable;
        values = inferDesignValuesFromBindings(
          normalized.bindingObservations,
        );
        if (values.designValues.length < 1) {
          values = inferRepeatedDesignValues(
            normalized.pages,
            normalized.styles,
          );
        }
        addUnavailableWarning(values.warnings, unavailable);
      }
    }

    const pages = applyNodeDesignValueRefs(
      normalized.pages,
      values.nodeDesignValueRefs,
    );
    const assets = uniqueImageRefs(
      [...assetRequestRefBySource.values()].flatMap((requestRef) => {
        const local = localImages.get(requestRef);
        return local ? [local] : [];
      }),
    );
    const screenshots = uniqueImageRefs(
      [
        ...screenshotRequestRefByPage.values(),
        ...screenshotRequestRefByVisualLayer.values(),
      ].flatMap((requestRef) => {
        const local = localImages.get(requestRef);
        return local ? [local] : [];
      }),
    );
    const draft: DesignBundleDraft = {
      schemaVersion: SCHEMA_VERSION,
      projectId: input.projectId,
      source: {
        provider: "figma_rest",
        fileKeyHash: stableHash(parsedUrl.fileKey),
        targetNodeIds,
        inspectedAt: this.now().toISOString(),
      },
      capabilities: { variables: capability },
      pages,
      components: normalized.components,
      styles: normalized.styles,
      designValues: [
        ...normalized.designValues,
        ...values.designValues,
      ],
      screenshots,
      assets,
      fonts: [],
      provenance: [
        ...normalized.provenance,
        ...values.provenance,
        ...assets.map((asset) => ({
          entityKind: "asset" as const,
          entityId: asset.path,
          origin: "figma_node" as const,
        })),
        ...screenshots.map((screenshot) => ({
          entityKind: "screenshot" as const,
          entityId: screenshot.path,
          origin: "figma_node" as const,
        })),
        ...[...screenshotRequestRefByPage.entries()].flatMap(
          ([pageId, requestRef]) => {
            const screenshot = localImages.get(requestRef);
            return screenshot
              ? [
                  {
                    entityKind: "screenshot" as const,
                    entityId: screenshot.path,
                    origin: "figma_node" as const,
                    sourceIdHash: stableHash(pageId),
                  },
                ]
              : [];
          },
        ),
        ...[...screenshotRequestRefByVisualLayer.entries()].flatMap(
          ([nodeId, requestRef]) => {
            const screenshot = localImages.get(requestRef);
            return screenshot
              ? [
                  {
                    entityKind: "screenshot" as const,
                    entityId: screenshot.path,
                    origin: "figma_node" as const,
                    sourceIdHash: stableHash(nodeId),
                  },
                ]
              : [];
          },
        ),
      ],
      warnings: boundedWarnings([
        ...normalized.warnings,
        ...values.warnings,
      ]),
    };

    const saved = await this.projectStore.saveDesignBundle({
      projectId: input.projectId,
      baseRevision: await currentDesignBundleRevision(
        this.projectStore,
        input.projectId,
      ),
      draft,
    });
    return inspectFigmaOutputSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      projectId: saved.projectId,
      designBundleRevision: saved.revision,
      pages: saved.pages.map((page) => ({
        id: page.id,
        name: page.name,
        width: page.width,
        height: page.height,
      })),
      variables: saved.capabilities.variables,
      warnings: saved.warnings.map((warning) => ({
        code: warning.code,
        detail: warning.detail,
      })),
    } satisfies InspectFigmaOutput);
  }
}
