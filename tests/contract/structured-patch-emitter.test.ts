import { describe, expect, it } from "vitest";
import type { Agent } from "@mastra/core/agent";
import type { BaseEvent } from "@ag-ui/client";
import { compileJsonlPatch } from "@next-app-runtime/client/stream";

import {
  createGenerateSpecTool,
  serializePatchOperations,
  type SpecGeneratorFactory,
} from "../../server/generate-spec-tool.ts";
import { GenerationCoordinator } from "../../server/generation-coordinator.ts";
import type { GenerationLifecyclePort } from "../../server/generation/lifecycle.ts";

const operationBatches = [
  [
    {
      op: "add" as const,
      path: "/uiBundle/spec/metadata",
      value: { title: "Acme" },
    },
  ],
  [{ op: "add" as const, path: "/uiBundle/spec/routes", value: {} }],
];

function coordinatorRequestContext(threadId: string, runId: string) {
  return {
    get: (name: string) =>
      name === "ag-ui"
        ? {
            context: [
              { description: "coordinator-thread-id", value: threadId },
              { description: "coordinator-run-id", value: runId },
            ],
          }
        : undefined,
  };
}

describe("structured Patch emitter", () => {
  it("uses runtime RFC 6902 validation and adds exactly one newline per operation", async () => {
    const jsonl = serializePatchOperations(operationBatches.flat());
    expect(jsonl).toBe(
      '{"op":"add","path":"/uiBundle/spec/metadata","value":{"title":"Acme"}}\n' +
        '{"op":"add","path":"/uiBundle/spec/routes","value":{}}\n',
    );
    await expect(
      compileJsonlPatch(
        { uiBundle: { spec: {} } },
        jsonl,
        { maxBytes: 10_000, maxOperations: 10 },
      ),
    ).resolves.toMatchObject({
      value: { uiBundle: { spec: { metadata: { title: "Acme" }, routes: {} } } },
      operations: 2,
    });
  });

  it("streams each complete internal-tool batch and never forwards generator text", async () => {
    const coordinator = new GenerationCoordinator({
      finalizeAndValidateCandidate: async () => ({
        status: "awaiting_preview",
        bundle: {
          bundleVersion: 1,
          catalogVersion: "p0-v1",
          specCompatibility: "0.19.0",
          spec: { metadata: {}, routes: {}, state: { ui: {} } },
          designSystem: {
            tokens: { primitive: {}, semantic: {}, component: {} },
            applicationCss: "",
          },
          assets: { entries: [] },
        },
        candidateDigest: `sha256:${"a".repeat(64)}`,
        uiBundleDigest: `sha256:${"b".repeat(64)}`,
        reportDigest: `sha256:${"c".repeat(64)}`,
        publishBlocked: false,
      }),
    } as unknown as GenerationLifecyclePort);
    const events: BaseEvent[] = [];
    coordinator.openRun("thread-1", "run-1").subscribe((event) => events.push(event));

    const generatorFactory: SpecGeneratorFactory = (tools) =>
      ({
        stream: async () => {
          for (const operations of operationBatches) {
            await tools.emit_patch_operations.execute?.(
              { operations },
              {} as never,
            );
          }
          await tools.validate_patch_generation.execute?.({}, {} as never);
          return {
            fullStream: (async function* () {
              yield { type: "text-delta", payload: { text: "not a patch" } };
            })(),
          } as never;
        },
      }) as unknown as Agent;

    const generateSpec = createGenerateSpecTool(coordinator, generatorFactory);
    await generateSpec.execute?.(
      {
        request: "创建应用",
        source: { kind: "direct_edit" },
        target: { base: "empty" },
      },
      { requestContext: coordinatorRequestContext("thread-1", "run-1") } as never,
    );

    const customs = events
      .filter((event) => event.type === "CUSTOM")
      .map((event) =>
        event as unknown as { name: string; value: { text?: string } },
      );
    expect(customs.map((event) => event.name)).toEqual([
      "spec.patch.start",
      "spec.patch.delta",
      "spec.patch.delta",
      "spec.patch.finish",
    ]);
    expect(customs[1]?.value.text).toContain('"/metadata"');
    expect(customs[2]?.value.text).toContain('"/routes"');
    expect(customs.some((event) => event.value.text === "not a patch")).toBe(false);
  });

  it("does not finish when the generator skips final catalog validation", async () => {
    const coordinator = new GenerationCoordinator();
    const generatorFactory: SpecGeneratorFactory = (tools) =>
      ({
        stream: async () => {
          await tools.emit_patch_operations.execute?.(
            { operations: operationBatches[0] },
            {} as never,
          );
          return { fullStream: (async function* () {})() } as never;
        },
      }) as unknown as Agent;
    const generateSpec = createGenerateSpecTool(coordinator, generatorFactory);

    await expect(
      generateSpec.execute?.(
        {
          request: "创建应用",
          source: { kind: "direct_edit" },
          target: { base: "empty" },
        },
        { requestContext: coordinatorRequestContext("thread-2", "run-2") } as never,
      ),
    ).rejects.toThrow("valid validate_patch_generation");
  });

  it("does not finish when catalog validation returns success=false", async () => {
    const coordinator = new GenerationCoordinator();
    const events: BaseEvent[] = [];
    coordinator.openRun("thread-3", "run-3").subscribe((event) => events.push(event));
    let validation: unknown;
    const generatorFactory: SpecGeneratorFactory = (tools) =>
      ({
        stream: async () => {
          await tools.emit_patch_operations.execute?.(
            {
              // routes is required by NextAppSpec, so this intermediate
              // document must be rejected by catalog.validate().
              operations: operationBatches[0],
            },
            {} as never,
          );
          validation = await tools.validate_patch_generation.execute?.({}, {} as never);
          return { fullStream: (async function* () {})() } as never;
        },
      }) as unknown as Agent;
    const generateSpec = createGenerateSpecTool(coordinator, generatorFactory);

    await expect(
      generateSpec.execute?.(
        {
          request: "创建应用",
          source: { kind: "direct_edit" },
          target: { base: "empty" },
        },
        { requestContext: coordinatorRequestContext("thread-3", "run-3") } as never,
      ),
    ).rejects.toThrow("valid validate_patch_generation");
    expect(validation).toMatchObject({ valid: false });
    expect(events.map((event) => (event as { name?: string }).name)).not.toContain(
      "spec.patch.finish",
    );
    expect(events.map((event) => (event as { name?: string }).name)).toContain(
      "spec.patch.error",
    );
  });
});
