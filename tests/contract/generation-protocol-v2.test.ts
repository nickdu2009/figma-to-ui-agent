import { describe, expect, it } from "vitest";
import type { BaseEvent } from "@ag-ui/client";
import {
  GenerationCoordinator,
} from "../../server/generation-coordinator.ts";
import type {
  GenerationLifecyclePort,
} from "../../server/generation/lifecycle.ts";
import {
  ProtocolFenceError,
  assertMutationProtocolVersion,
} from "../../server/persistence/protocol-mode.ts";

const BUNDLE = {
  bundleVersion: 1,
  catalogVersion: "1.0.0",
  specCompatibility: "0.19.0",
  spec: { metadata: {}, routes: {}, state: { ui: {} } },
  designSystem: {
    tokens: { primitive: {}, semantic: {}, component: {} },
    applicationCss: "",
  },
  assets: { entries: [] },
};

function lifecycle(): GenerationLifecyclePort {
  return {
    startRun: async () => undefined,
    persistQuestion: async () => undefined,
    recordAnswer: async () => undefined,
    consumeApprovedPlan: async () => null,
    markAwaitingPreview: async () => true,
    applyResult: async () => true,
    markFailed: async () => undefined,
    heartbeat: async () => true,
    abortRun: async () => true,
    sweepOrphanRuns: async () => 0,
    sweepStaleRuns: async () => 0,
    finalizeAndValidateCandidate: async () => ({
      status: "awaiting_preview" as const,
      bundle: BUNDLE,
      candidateDigest: `sha256:${"a".repeat(64)}`,
      uiBundleDigest: `sha256:${"b".repeat(64)}`,
      reportDigest: `sha256:${"c".repeat(64)}`,
      publishBlocked: false,
    }),
  };
}

describe("S11 v2 generation protocol", () => {
  it("v2 写入要求显式声明版本，未知版本 fail closed", () => {
    expect(() =>
      assertMutationProtocolVersion("v2", "preview_commit", undefined),
    ).toThrow(ProtocolFenceError);
    expect(() =>
      assertMutationProtocolVersion("v2", "preview_commit", 2),
    ).not.toThrow();
    expect(() =>
      assertMutationProtocolVersion("compat", "preview_commit", 99),
    ).toThrow(ProtocolFenceError);
  });

  it("只在服务端 Candidate 验证完成后发出 Bundle finish，且不创建 await_apply_result", async () => {
    const coordinator = new GenerationCoordinator(lifecycle());
    const events: BaseEvent[] = [];
    coordinator.openRun("thread", "run").subscribe((event) => events.push(event));
    coordinator.beginGeneration({
      threadId: "thread",
      runId: "run",
      generationId: "generation",
    });

    await coordinator.finishValidatedCandidate(
      "thread",
      "run",
      "generation",
      { uiBundle: BUNDLE, businessSchema: null, migrationEdge: {} },
      { totalOperations: 3 },
    );

    const finish = events.find(
      (event) =>
        event.type === "CUSTOM" &&
        (event as unknown as { name?: string }).name === "spec.patch.finish",
    ) as unknown as { value?: Record<string, unknown> } | undefined;
    expect(finish?.value).toMatchObject({
      generationId: "generation",
      bundle: BUNDLE,
      candidateDigest: `sha256:${"a".repeat(64)}`,
      uiBundleDigest: `sha256:${"b".repeat(64)}`,
      reportDigest: `sha256:${"c".repeat(64)}`,
    });
    expect(coordinator.pendingApplyRequest("thread", "run")).toBeNull();
    expect(coordinator.snapshot().generations[0]?.status).toBe(
      "awaiting_preview",
    );
  });

  it("验证器没有产出可预览候选时 fail closed，不向浏览器发送 finish", async () => {
    const rejecting: GenerationLifecyclePort = {
      ...lifecycle(),
      finalizeAndValidateCandidate: async () => {
        throw new Error("validation_capacity_exceeded");
      },
    };
    const coordinator = new GenerationCoordinator(rejecting);
    const events: BaseEvent[] = [];
    coordinator.openRun("thread", "run").subscribe((event) => events.push(event));
    coordinator.beginGeneration({
      threadId: "thread",
      runId: "run",
      generationId: "generation",
    });

    await expect(
      coordinator.finishValidatedCandidate(
        "thread",
        "run",
        "generation",
        {},
      ),
    ).rejects.toThrow("validation_capacity_exceeded");
    expect(
      events.some(
        (event) =>
          event.type === "CUSTOM" &&
          (event as unknown as { name?: string }).name === "spec.patch.finish",
      ),
    ).toBe(false);
  });
});
