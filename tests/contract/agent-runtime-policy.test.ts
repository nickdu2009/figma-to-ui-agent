/**
 * S10 契约测试：受控模型策略与 Agent Runtime 生命周期（设计 §4.1/§10）。
 *
 * 验证不变式：
 * 1. 生产固定 Chat=gpt-5.6-terra/medium、Spec=gpt-5.6-sol/high、repair=xhigh；
 * 2. 项目侧仅使用 Mastra OpenAI router，经 LiteLLM `/responses`；
 * 3. ControlledAgentRuntime logger: false；
 * 4. 静态 Agent 常驻；动态 Agent 终态后注销且禁止复用键；
 * 5. 动态 Agent 数量超限抛出稳定容量异常；
 * 6. 错误与日志脱敏：归一化为稳定 code，只输出 allowlist 字段。
 */
import { describe, expect, it, vi } from "vitest";
import { Agent } from "@mastra/core/agent";
import { ModelRouterLanguageModel } from "@mastra/core/llm";
import {
  MASTRA_OPENAI_PROVIDER_ID,
  MODEL_ERROR_CODES,
  PRODUCTION_MODEL_POLICY,
  configureMastraOpenAiRouterForLiteLlm,
  createLiteLlmExecutionOptions,
  createLiteLlmModelConfig,
  formatSafeModelLog,
  normalizeModelError,
  resolveLiteLlmConfig,
} from "../../server/model-policy.ts";
import {
  AgentRegistryCapacityError,
  ControlledAgentRuntime,
  createControlledAgentRuntime,
} from "../../server/agent-runtime.ts";

describe("S10 模型策略契约 (model-policy)", () => {
  it("生产模型与推理强度固定且符合设计 §4.1", () => {
    expect(PRODUCTION_MODEL_POLICY.chat.modelId).toBe("gpt-5.6-terra");
    expect(PRODUCTION_MODEL_POLICY.chat.reasoningEffort).toBe("medium");
    expect(PRODUCTION_MODEL_POLICY.chat.maxSteps).toBe(12);
    expect(PRODUCTION_MODEL_POLICY.chat.maxRetries).toBe(1);

    expect(PRODUCTION_MODEL_POLICY.spec.modelId).toBe("gpt-5.6-sol");
    expect(PRODUCTION_MODEL_POLICY.spec.reasoningEffort).toBe("high");
    expect(PRODUCTION_MODEL_POLICY.spec.maxRetries).toBe(1);

    expect(PRODUCTION_MODEL_POLICY.repair.modelId).toBe("gpt-5.6-sol");
    expect(PRODUCTION_MODEL_POLICY.repair.reasoningEffort).toBe("xhigh");
    expect(PRODUCTION_MODEL_POLICY.repair.maxRetries).toBe(1);
  });

  it("createLiteLlmModelConfig 构造 Mastra 内建 OpenAI router 配置", () => {
    const config = createLiteLlmModelConfig("gpt-5.6-terra", {
      baseUrl: "http://127.0.0.1:4000/v1",
      apiKey: "sk-test-key",
    });
    expect(config.providerId).toBe(MASTRA_OPENAI_PROVIDER_ID);
    expect(config.modelId).toBe("gpt-5.6-terra");
    expect(config.apiKey).toBe("sk-test-key");
    expect("url" in config).toBe(false);
  });

  it("createLiteLlmExecutionOptions 显式开启 Responses reasoning summary", () => {
    const chatOpts = createLiteLlmExecutionOptions("medium");
    expect(chatOpts.providerOptions.openai).toEqual({
      reasoningEffort: "medium",
      reasoningSummary: "detailed",
      store: false,
    });

    const specOpts = createLiteLlmExecutionOptions("high");
    expect(specOpts.providerOptions.openai.reasoningEffort).toBe("high");
  });

  it("Mastra router 向 LiteLLM /responses 发送 summary 流请求", async () => {
    const originalBaseUrl = process.env.OPENAI_BASE_URL;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >,
        });
        // 返回稳定上游错误即可结束流；本测试只验证出站契约，
        // 不调用真实 LiteLLM/LLM。
        return new Response(
          JSON.stringify({ error: { message: "stop", type: "test_error" } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }),
    );

    try {
      const serverConfig = {
        baseUrl: "http://proxy.test/v1/",
        apiKey: "sk-test-key",
      };
      configureMastraOpenAiRouterForLiteLlm(serverConfig);
      const model = new ModelRouterLanguageModel(
        createLiteLlmModelConfig("gpt-5.6-terra", serverConfig),
      );
      try {
        const result = await model.doStream({
          prompt: [
            { role: "user", content: [{ type: "text", text: "hello" }] },
          ],
          ...createLiteLlmExecutionOptions("medium"),
        } as never);
        for await (const part of result.stream) {
          if (part.type === "error") break;
        }
      } catch {
        // 上游 500 是测试夹具的预期终态；请求契约在下方断言。
      }

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("http://proxy.test/v1/responses");
      expect(requests[0]?.body).toMatchObject({
        model: "gpt-5.6-terra",
        stream: true,
        store: false,
        reasoning: { effort: "medium", summary: "detailed" },
      });
    } finally {
      vi.unstubAllGlobals();
      if (originalBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = originalBaseUrl;
    }
  });

  it("resolveLiteLlmConfig 从环境读取凭据并支持默认回退", () => {
    const custom = resolveLiteLlmConfig({
      LITELLM_API_KEY: "sk-litellm-secret",
      VMA_LITELLM_BASE_URL: "http://proxy.local:4000/v1",
    });
    expect(custom.apiKey).toBe("sk-litellm-secret");
    expect(custom.baseUrl).toBe("http://proxy.local:4000/v1");

    const empty = resolveLiteLlmConfig({});
    expect(empty.apiKey).toBe("");
    expect(empty.baseUrl).toBe("http://127.0.0.1:4000/v1");

    const env: NodeJS.ProcessEnv = {};
    configureMastraOpenAiRouterForLiteLlm(
      { baseUrl: "http://proxy.local:4000/v1/", apiKey: "not-copied" },
      env,
    );
    expect(env.OPENAI_BASE_URL).toBe("http://proxy.local:4000/v1");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(() =>
      configureMastraOpenAiRouterForLiteLlm(
        { baseUrl: "file:///tmp/not-http", apiKey: "x" },
        env,
      ),
    ).toThrow("HTTP(S) URL");
  });

  it("normalizeModelError 将上游异常归一化为稳定错误码（无泄露）", () => {
    expect(normalizeModelError({ name: "AbortError" }).code).toBe(
      MODEL_ERROR_CODES.ABORTED,
    );
    expect(normalizeModelError({ name: "TimeoutError" }).code).toBe(
      MODEL_ERROR_CODES.TIMEOUT,
    );
    expect(normalizeModelError({ status: 401 }).code).toBe(
      MODEL_ERROR_CODES.AUTH_ERROR,
    );
    expect(normalizeModelError({ status: 429 }).code).toBe(
      MODEL_ERROR_CODES.RATE_LIMIT,
    );
    expect(
      normalizeModelError({ status: 400, message: "context_length_exceeded" })
        .code,
    ).toBe(MODEL_ERROR_CODES.CONTEXT_LENGTH_EXCEEDED);
    expect(normalizeModelError({ status: 502 }).code).toBe(
      MODEL_ERROR_CODES.UPSTREAM_ERROR,
    );
    expect(normalizeModelError({ code: "ECONNREFUSED" }).code).toBe(
      MODEL_ERROR_CODES.NETWORK_ERROR,
    );
    expect(normalizeModelError(null).code).toBe(MODEL_ERROR_CODES.UNKNOWN);
  });

  it("formatSafeModelLog 只格式化白名单字段（无提示词/凭据）", () => {
    const formatted = formatSafeModelLog({
      requestId: "req-123",
      generationId: "gen-456",
      agentId: "spec-generator",
      modelAlias: "gpt-5.6-sol",
      attempt: 1,
      phase: "generation",
      code: "success",
      durationMs: 1200,
    });
    expect(formatted).toContain("agent=spec-generator");
    expect(formatted).toContain("model=gpt-5.6-sol");
    expect(formatted).toContain("requestId=req-123");
    expect(formatted).toContain("generationId=gen-456");
    expect(formatted).toContain("durationMs=1200");
    expect(formatted).not.toContain("sk-");
    expect(formatted).not.toContain("prompt");
  });
});

describe("S10 ControlledAgentRuntime 契约", () => {
  const dummyModel = createLiteLlmModelConfig("gpt-5.6-terra", {
    baseUrl: "http://127.0.0.1:4000/v1",
    apiKey: "sk-test",
  });

  it("静态 Agent 常驻且不可注销", () => {
    const staticChat = new Agent({
      id: "chat",
      name: "chat",
      instructions: "chat instructions",
      model: dummyModel,
    });
    const runtime = createControlledAgentRuntime({
      staticAgents: { chat: staticChat },
    });

    expect(runtime.staticAgentKeys).toEqual(["chat"]);
    expect(runtime.getAgent("chat")).toBeDefined();
    expect(runtime.removeDynamicAgent("chat")).toBe(false);
    expect(runtime.getAgent("chat")).toBeDefined();
  });

  it("禁止覆盖静态 Agent 键", () => {
    const staticChat = new Agent({
      id: "chat",
      name: "chat",
      instructions: "chat",
      model: dummyModel,
    });
    const runtime = createControlledAgentRuntime({
      staticAgents: { chat: staticChat },
    });

    const dynamicAgent = new Agent({
      id: "other",
      name: "other",
      instructions: "other",
      model: dummyModel,
    });
    expect(() => runtime.addDynamicAgent(dynamicAgent, "chat")).toThrow(
      /无法覆盖静态 Agent 键/,
    );
  });

  it("禁止复用活跃的动态 Agent 键", () => {
    const runtime = createControlledAgentRuntime();
    const agent = new Agent({
      id: "spec-1",
      name: "spec-1",
      instructions: "spec",
      model: dummyModel,
    });
    runtime.addDynamicAgent(agent, "gen-001");
    expect(() => runtime.addDynamicAgent(agent, "gen-001")).toThrow(
      /动态 Agent 键已存在/,
    );
    runtime.removeDynamicAgent("gen-001");
  });

  it("withDynamicAgent 托管执行并在终态后完全注销（即使回调抛出异常）", async () => {
    const runtime = createControlledAgentRuntime();
    const agent = new Agent({
      id: "spec-dyn",
      name: "spec-dyn",
      instructions: "spec",
      model: dummyModel,
    });

    // 成功路径
    const result = await runtime.withDynamicAgent(
      agent,
      "gen-success",
      async (registered) => {
        expect(registered.id).toBe("spec-dyn");
        expect(runtime.activeDynamicCount).toBe(1);
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(runtime.activeDynamicCount).toBe(0);
    expect(runtime.getAgent("gen-success")).toBeUndefined();

    // 异常路径：确保 finally 依然注销
    await expect(
      runtime.withDynamicAgent(agent, "gen-error", async () => {
        expect(runtime.activeDynamicCount).toBe(1);
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    expect(runtime.activeDynamicCount).toBe(0);
    expect(runtime.getAgent("gen-error")).toBeUndefined();
  });

  it("动态 Agent 容量超限抛出 AgentRegistryCapacityError", () => {
    const runtime = new ControlledAgentRuntime({ maxDynamicAgents: 2 });
    const createAgent = (id: string) =>
      new Agent({ id, name: id, instructions: "test", model: dummyModel });

    runtime.addDynamicAgent(createAgent("a1"), "k1");
    runtime.addDynamicAgent(createAgent("a2"), "k2");
    expect(runtime.activeDynamicCount).toBe(2);

    expect(() => runtime.addDynamicAgent(createAgent("a3"), "k3")).toThrow(
      AgentRegistryCapacityError,
    );

    runtime.removeDynamicAgent("k1");
    expect(runtime.activeDynamicCount).toBe(1);
    // 释放后可再次添加
    runtime.addDynamicAgent(createAgent("a3"), "k3");
    expect(runtime.activeDynamicCount).toBe(2);
  });
});
