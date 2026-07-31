import { readFile } from "node:fs/promises";

import { z } from "zod";

const sampleIdSchema = z.string().min(1).max(256);
const expectedViewportSchema = z.enum(["mobile", "desktop"]);

const communitySampleSchema = z
  .object({
    sampleId: sampleIdSchema,
    category: z.string().min(1).max(128),
    title: z.string().min(1).max(512),
    accessStatus: z.string().min(1).max(128),
    designUrl: z.string().url().nullable().optional(),
    nodeId: z.string().min(1).max(256).nullable().optional(),
    expectedViewport: expectedViewportSchema,
  })
  .passthrough();

const communitySampleManifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    corpusId: z.string().min(1).max(256),
    samples: z.array(communitySampleSchema).max(1_000),
  })
  .passthrough();

export interface FlowM9SampleLocator {
  readonly designUrl: string;
  readonly nodeId: string;
}

export interface FlowM9SampleInput {
  readonly sampleId: string;
  readonly category: string;
  readonly title: string;
  readonly expectedViewport: "mobile" | "desktop";
  readonly accessStatus: string;
  readonly locator?: FlowM9SampleLocator;
  readonly skipReason?: string;
}

export type FlowM9CommunitySampleManifest = z.infer<
  typeof communitySampleManifestSchema
>;

export function parseFlowM9CommunitySampleManifest(
  raw: unknown,
): FlowM9CommunitySampleManifest {
  return communitySampleManifestSchema.parse(raw);
}

export async function readFlowM9CommunitySampleManifest(
  path: string,
): Promise<FlowM9CommunitySampleManifest> {
  return parseFlowM9CommunitySampleManifest(
    JSON.parse(await readFile(path, "utf8")),
  );
}

function toSampleInput(
  sample: z.infer<typeof communitySampleSchema>,
): FlowM9SampleInput {
  const hasRestReadableSelectedNode =
    sample.accessStatus === "rest_readable_node_selected";
  const designUrl = sample.designUrl ?? undefined;
  const nodeId = sample.nodeId ?? undefined;
  if (!hasRestReadableSelectedNode) {
    return {
      sampleId: sample.sampleId,
      category: sample.category,
      title: sample.title,
      expectedViewport: sample.expectedViewport,
      accessStatus: sample.accessStatus,
      skipReason: "sample_not_rest_readable_node_selected",
    };
  }
  if (!designUrl || !nodeId) {
    return {
      sampleId: sample.sampleId,
      category: sample.category,
      title: sample.title,
      expectedViewport: sample.expectedViewport,
      accessStatus: sample.accessStatus,
      skipReason: "sample_locator_missing",
    };
  }
  return {
    sampleId: sample.sampleId,
    category: sample.category,
    title: sample.title,
    expectedViewport: sample.expectedViewport,
    accessStatus: sample.accessStatus,
    locator: { designUrl, nodeId },
  };
}

export function selectFlowM9Samples(
  manifest: FlowM9CommunitySampleManifest,
  sampleIds: readonly string[],
): FlowM9SampleInput[] {
  const byId = new Map(
    manifest.samples.map((sample) => [sample.sampleId, sample] as const),
  );
  return sampleIds.map((sampleId) => {
    const sample = byId.get(sampleId);
    if (!sample) {
      throw new Error(`flow_m9_sample_not_found:${sampleId}`);
    }
    return toSampleInput(sample);
  });
}

export function selectPrimaryFlowM9Samples(
  manifest: FlowM9CommunitySampleManifest,
  limit = 5,
): FlowM9SampleInput[] {
  return manifest.samples
    .map(toSampleInput)
    .filter((sample) => sample.locator)
    .slice(0, limit);
}
