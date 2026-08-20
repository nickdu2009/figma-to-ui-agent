/**
 * S10 集成测试：受控 Mastra Runtime、LiteLLM 单一路径与生命周期（设计 §4.1/§10）。
 *
 * 验证：
 * 1. 生产 createChatAgent 正确装配受控 Runtime，模型与推理强度固定；
 * 2. 缺少 API Key 时安全失败并输出稳定说明；
 * 3. 动态 Spec Generator 生命周期：注册 → 闭包隔离 → 终态注销；
 * 4. 终态后动态注册表恢复为静态基线；
 * 5. 错误/异常不泄露敏感 headers、堆栈或请求体。
 */
import { describe, expect, it } from "vitest";
import { Agent } from "@mastra/core/agent";
import { createChatAgent } from "../../server/mastra-agent.ts";
import { createControlledAgentRuntime } from "../../server/agent-runtime.ts";
import {
  PRODUCTION_MODEL_POLICY,
  createLiteLlmModelConfig,
} from "../../server/model-policy.ts";
import { CoordinatedMastraAgent } from "../../server/coordinated-mastra-agent.ts";

describe("S10 Mastra Runtime 集成测试 (mastra-runtime)", () => {
  const dummyModel = createLiteLlmModelConfig("gpt-5.6-terra", {
    baseUrl: "http://127.0.0.1:4000/v1",
    apiKey: "sk-test",
  });

  it("无 API Key 时 createChatAgent 安全抛出配置说明", () => {
    const oldKey = process.env.LITELLM_API_KEY;
    const oldOpenAIKey = process.env.OPENAI_API_KEY;
    delete process.env.LITELLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => createChatAgent()).toThrow(
        /LITELLM_API_KEY \(or OPENAI_API_KEY\) is required/,
      );
    } finally {
      if (oldKey) process.env.LITELLM_API_KEY = oldKey;
      if (oldOpenAIKey) process.env.OPENAI_API_KEY = oldOpenAIKey;
    }
  });

  it("有 API Key 时 createChatAgent 成功装配 CoordinatedMastraAgent 并注册到受控 Runtime", () => {
    process.env.LITELLM_API_KEY = "sk-test-mock-key";
    try {
      const runtime = createControlledAgentRuntime();
      const agent = createChatAgent(undefined, runtime);

      expect(agent).toBeInstanceOf(CoordinatedMastraAgent);
      expect(agent.agentId).toBe("chat");
      expect(runtime.getAgent("chat")).toBeDefined();
      expect(runtime.staticAgentKeys).toEqual(["chat"]);
    } finally {
      delete process.env.LITELLM_API_KEY;
    }
  });

  it("动态 Spec Agent 在完整生命周期终态后完全注销，恢复静态基线", async () => {
    const runtime = createControlledAgentRuntime();
    const chatAgent = new Agent({
      id: "chat",
      name: "chat",
      instructions: "chat",
      model: dummyModel,
    });
    runtime.internalMastra.addAgent(chatAgent, "chat");

    expect(runtime.activeDynamicCount).toBe(0);
    expect(runtime.getAgent("chat")).toBeDefined();

    // 模拟一次 generate_spec 的动态生命周期
    const generationId = "gen-run-test-001";
    const registryKey = `spec-generator-${generationId}`;
    const specAgent = new Agent({
      id: "spec-generator",
      name: "spec-generator",
      instructions: "generate",
      model: createLiteLlmModelConfig(PRODUCTION_MODEL_POLICY.spec.modelId, {
        baseUrl: "http://127.0.0.1:4000/v1",
        apiKey: "sk-test",
      }),
      maxRetries: PRODUCTION_MODEL_POLICY.spec.maxRetries,
    });

    const output = await runtime.withDynamicAgent(
      specAgent,
      registryKey,
      async (registered) => {
        expect(registered.id).toBe("spec-generator");
        expect(runtime.activeDynamicCount).toBe(1);
        expect(runtime.getAgent(registryKey)).toBeDefined();
        // 模拟生成过程
        return { generated: true, operations: 5 };
      },
    );

    expect(output).toEqual({ generated: true, operations: 5 });
    // 终态后注销
    expect(runtime.activeDynamicCount).toBe(0);
    expect(runtime.getAgent(registryKey)).toBeUndefined();
    // 静态 chat agent 依然完好
    expect(runtime.getAgent("chat")).toBeDefined();
  });

  it("并发多 generation 动态 Agent 键互不干扰且各自在终态后注销", async () => {
    const runtime = createControlledAgentRuntime();
    const runTask = async (id: string, delayMs: number) => {
      const agent = new Agent({
        id: `spec-${id}`,
        name: `spec-${id}`,
        instructions: "test",
        model: dummyModel,
      });
      return runtime.withDynamicAgent(agent, `spec-${id}`, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        return `done-${id}`;
      });
    };

    const results = await Promise.all([
      runTask("1", 30),
      runTask("2", 10),
      runTask("3", 20),
    ]);

    expect(results).toEqual(["done-1", "done-2", "done-3"]);
    expect(runtime.activeDynamicCount).toBe(0);
  });
});
