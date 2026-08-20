import { describe, expect, it, vi } from "vitest";
import { Agent } from "@mastra/core/agent";
import {
  ManagedAgentStreamError,
  createControlledAgentRuntime,
} from "../../server/agent-runtime.ts";
import { createLiteLlmModelConfig } from "../../server/model-policy.ts";

const model = createLiteLlmModelConfig("test-model", {
  baseUrl: "http://127.0.0.1:4000/v1",
  apiKey: "sk-test",
});

function makeAgent(id: string): Agent {
  return new Agent({ id, name: id, instructions: "test", model });
}

describe("ControlledAgentRuntime managed dynamic stream", () => {
  it("把动态 Agent 注册到 Mastra，直到 fullStream 消费终态才注销", async () => {
    const runtime = createControlledAgentRuntime();
    const source = makeAgent("spec-source");
    const sourceStream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "text-delta", payload: "one" };
        yield { type: "finish" };
      },
    };
    vi.spyOn(source, "stream").mockResolvedValue({
      fullStream: sourceStream,
    } as never);

    const managed = runtime.createManagedDynamicStreamAgent(source, "spec-run-1");
    const output = await (managed.stream as (...args: unknown[]) => Promise<{
      fullStream: AsyncIterable<{ type: string }>;
    }>)("generate");

    expect(runtime.activeDynamicCount).toBe(1);
    expect(runtime.getAgent("spec-run-1")).toBeDefined();
    const chunks: Array<{ type: string }> = [];
    for await (const chunk of output.fullStream) chunks.push(chunk);
    expect(chunks).toEqual([{ type: "text-delta", payload: "one" }, { type: "finish" }]);
    expect(runtime.activeDynamicCount).toBe(0);
    expect(runtime.getAgent("spec-run-1")).toBeUndefined();
  });

  it("相同受控 stream 不可重入，不能绕过动态 key 的唯一性", async () => {
    const runtime = createControlledAgentRuntime();
    const source = makeAgent("spec-source");
    vi.spyOn(source, "stream").mockResolvedValue({
      fullStream: {
        async *[Symbol.asyncIterator]() {
          yield { type: "finish" };
        },
      },
    } as never);
    const managed = runtime.createManagedDynamicStreamAgent(source, "spec-run-2");
    const call = managed.stream as (...args: unknown[]) => Promise<unknown>;
    const output = (await call("generate")) as { fullStream: AsyncIterable<unknown> };

    await expect(call("generate")).rejects.toBeInstanceOf(ManagedAgentStreamError);
    for await (const _chunk of output.fullStream) {
      void _chunk;
    }
    expect(runtime.activeDynamicCount).toBe(0);
  });
});
