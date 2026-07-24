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
import { normalizeFigmaDocument } from "./normalize.ts";
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

async function loadFigmaPayload(
  restClient: FigmaRestClient,
  fileKey: string,
  targetNodeIds: readonly string[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (targetNodeIds.length > 0) {
    return targetedNodesPayload(
      await restClient.getNodes(fileKey, targetNodeIds, signal),
      targetNodeIds,
    );
  }
  return await restClient.getFile(fileKey, signal);
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
  ): Promise<InspectFigmaOutput> {
    const input = inspectFigmaInputSchema.parse(rawInput);
    const parsedUrl = parseFigmaDesignUrl(input.figmaUrl);
    const targetNodeIds = resolveFigmaTargetNodes(
      parsedUrl,
      input.targetNodes,
    );

    const filePayload = await loadFigmaPayload(
      this.restClient,
      parsedUrl.fileKey,
      targetNodeIds,
      signal,
    );
    const initial = normalizeFigmaDocument(filePayload, {
      targetNodeIds,
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
      targetNodeIds,
      imagePathBySourceRef,
    });

    let capability: VariablesCapability;
    let values: DesignValueExtraction;
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
      [...screenshotRequestRefByPage.values()].flatMap(
        (requestRef) => {
          const local = localImages.get(requestRef);
          return local ? [local] : [];
        },
      ),
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
      designValues: values.designValues,
      screenshots,
      assets,
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
