import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

import { generateSpecInputSchema } from "../../server/contracts.ts";
import { GenerationCoordinator } from "../../server/generation-coordinator.ts";
import type { GenerationLifecyclePort } from "../../server/generation/lifecycle.ts";
import {
  CoordinatedMastraAgent,
  resolveGenerationIdleTimeoutMs,
} from "../../server/coordinated-mastra-agent.ts";

/**
 * generate_spec 流式协议契约（计划 §6/§7）：
 * - spec.patch.* CUSTOM 事件顺序：start → delta… → finish，且全部早于
 *   TOOL_CALL_RESULT 与 RUN_FINISHED（AG-UI 顺序硬约束）；
 * - run 收尾前由协调器确定性发出 await_apply_result TOOL_CALL，并在
 *   RUN_FINISHED 上携带 interrupt outcome（metadata.generationId）；
 * - 下一 run 的 await_apply_result 结果做 {threadId, generationId,
 *   toolCallId} 关联校验，不匹配时改写为 aborted（fail closed）。
 */

class GenerationScriptedAgent extends AbstractAgent {
  constructor(
    private readonly coordinator: GenerationCoordinator,
    private readonly lines: string[],
  ) {
    super({ agentId: "scripted-gen", description: "", debug: false });
  }
  clone(): GenerationScriptedAgent {
    return new GenerationScriptedAgent(this.coordinator, this.lines);
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    const { threadId, runId } = input;
    const coordinator = this.coordinator;
    const lines = this.lines;
    return new Observable<BaseEvent>((subscriber) => {
      const toolCallId = `${runId}-generate-spec`;
      const generationId = `gen-${runId}`;
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId,
        runId,
      } as BaseEvent);
      subscriber.next({
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: "generate_spec",
      } as BaseEvent);
      subscriber.next({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify({
          request: "创建应用",
          source: { kind: "direct_edit" },
          target: { base: "empty" },
        }),
      } as BaseEvent);
      subscriber.next({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
      // 工具执行期间流式输出 CUSTOM（真实时序：早于 TOOL_CALL_RESULT）。
      coordinator.beginGeneration({ threadId, runId, generationId });
      for (const line of lines) {
        coordinator.emitPatchDelta(threadId, runId, generationId, line);
      }
      coordinator.finishPatchStream(threadId, runId, generationId);
      subscriber.next({
        type: EventType.TOOL_CALL_RESULT,
        messageId: `${runId}-result`,
        toolCallId,
        content: JSON.stringify({ status: "patch_streaming", generationId }),
        role: "tool",
      } as BaseEvent);
      subscriber.next({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
      subscriber.complete();
    });
  }
}

class HangingAgent extends AbstractAgent {
  constructor() {
    super({ agentId: "hanging", description: "", debug: false });
  }
  clone(): HangingAgent {
    return new HangingAgent();
  }
  run(): Observable<BaseEvent> {
    return new Observable<BaseEvent>(() => () => undefined);
  }
}

class ReasoningScriptedAgent extends AbstractAgent {
  constructor() {
    super({ agentId: "reasoning-scripted", description: "", debug: false });
  }
  clone(): ReasoningScriptedAgent {
    return new ReasoningScriptedAgent();
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      for (const messageId of ["empty", "visible"] as const) {
        subscriber.next({
          type: EventType.REASONING_START,
          messageId,
        } as BaseEvent);
        subscriber.next({
          type: EventType.REASONING_MESSAGE_START,
          messageId,
          role: "reasoning",
        } as BaseEvent);
        if (messageId === "visible") {
          subscriber.next({
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId,
            delta: "可展示摘要",
          } as BaseEvent);
        }
        subscriber.next({
          type: EventType.REASONING_MESSAGE_END,
          messageId,
        } as BaseEvent);
        subscriber.next({
          type: EventType.REASONING_END,
          messageId,
        } as BaseEvent);
      }
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      subscriber.complete();
    });
  }
}

describe("生成无进度保护配置", () => {
  it("默认给复杂真实生成十分钟，并拒绝无界或非法覆盖", () => {
    expect(resolveGenerationIdleTimeoutMs({})).toBe(600_000);
    expect(
      resolveGenerationIdleTimeoutMs({
        VMA_GENERATION_IDLE_TIMEOUT_MS: "900000",
      }),
    ).toBe(900_000);
    expect(() =>
      resolveGenerationIdleTimeoutMs({ VMA_GENERATION_IDLE_TIMEOUT_MS: "1" }),
    ).toThrow("VMA_GENERATION_IDLE_TIMEOUT_MS");
    expect(() =>
      resolveGenerationIdleTimeoutMs({
        VMA_GENERATION_IDLE_TIMEOUT_MS: "unbounded",
      }),
    ).toThrow("VMA_GENERATION_IDLE_TIMEOUT_MS");
  });
});

class FailIfInvokedAgent extends AbstractAgent {
  calls = 0;
  constructor() {
    super({ agentId: "fail-if-invoked", description: "", debug: false });
  }
  clone(): FailIfInvokedAgent {
    return this;
  }
  run(): Observable<BaseEvent> {
    this.calls += 1;
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.error(new Error("apply receipt must not enter the model"));
    });
  }
}

function collect(
  agent: CoordinatedMastraAgent,
  input: Partial<RunAgentInput> & { threadId: string; runId: string },
): Promise<BaseEvent[]> {
  const full: RunAgentInput = {
    messages: [],
    tools: [],
    context: [],
    state: {},
    ...input,
  } as RunAgentInput;
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    agent.run(full).subscribe({
      next: (e) => events.push(e),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

function customEvents(events: BaseEvent[]) {
  return events
    .filter((e) => e.type === EventType.CUSTOM)
    .map((e) => (e as unknown as { name: string; value: unknown }));
}

describe("generate_spec stream contract", () => {
  it("丢弃没有可展示 delta 的 reasoning 段，避免空 Thought 卡片", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new ReasoningScriptedAgent(),
      coordinator,
      { agentId: "chat" },
    );
    const events = await collect(agent, {
      threadId: "t-reasoning",
      runId: "r-reasoning",
    });
    const reasoning = events.filter((event) =>
      String(event.type).startsWith("REASONING"),
    ) as Array<BaseEvent & { messageId?: string; delta?: string }>;

    expect(reasoning.map((event) => event.messageId)).toEqual([
      "visible",
      "visible",
      "visible",
      "visible",
      "visible",
    ]);
    expect(reasoning.map((event) => event.type)).toEqual([
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
    ]);
    expect(reasoning[2]?.delta).toBe("可展示摘要");
  });

  it("CUSTOM 顺序：start→delta→finish 早于 TOOL_CALL_RESULT 与 RUN_FINISHED", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new GenerationScriptedAgent(coordinator, ['{"op":"add"}\n', '{"op":"add2"}\n']),
      coordinator,
      { agentId: "chat" },
    );
    const events = await collect(agent, { threadId: "t1", runId: "r1" });

    const customs = customEvents(events);
    expect(customs.map((c) => c.name)).toEqual([
      "spec.patch.start",
      "spec.patch.delta",
      "spec.patch.delta",
      "spec.patch.finish",
    ]);
    expect(
      (customs[0]?.value as { generationId?: string }).generationId,
    ).toBe("gen-r1");

    // 顺序硬约束：最后一个 CUSTOM 在 TOOL_CALL_RESULT 之前；
    // await_apply_result TOOL_CALL_END 与 RUN_FINISHED 在其后。
    const indexOf = (type: EventType, name?: string) =>
      events.findIndex(
        (e) =>
          e.type === type &&
          (name === undefined ||
            (e as unknown as { name?: string }).name === name),
      );
    const lastCustom = events.map((e, i) => (e.type === EventType.CUSTOM ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
    const toolResult = indexOf(EventType.TOOL_CALL_RESULT);
    const runFinished = indexOf(EventType.RUN_FINISHED);
    expect(lastCustom).toBeGreaterThanOrEqual(0);
    expect(toolResult).toBeGreaterThan(lastCustom);
    expect(runFinished).toBeGreaterThan(toolResult);
  });

  it("run 收尾：await_apply_result TOOL_CALL + interrupt outcome（metadata.generationId）", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new GenerationScriptedAgent(coordinator, ['{"op":"add"}\n']),
      coordinator,
      { agentId: "chat" },
    );
    const events = await collect(agent, { threadId: "t2", runId: "r9" });

    const awaitStart = events.find(
      (e) =>
        e.type === EventType.TOOL_CALL_START &&
        (e as unknown as { toolCallName?: string }).toolCallName ===
          "await_apply_result",
    ) as unknown as { toolCallId: string } | undefined;
    expect(awaitStart).toBeDefined();
    expect(awaitStart?.toolCallId).toBe("r9-await-apply");

    const finished = events.find((e) => e.type === EventType.RUN_FINISHED) as
      | (BaseEvent & {
          outcome?: {
            type: string;
            interrupts: Array<{
              reason: string;
              toolCallId?: string;
              metadata?: Record<string, unknown>;
            }>;
          };
        })
      | undefined;
    expect(finished?.outcome?.type).toBe("interrupt");
    const interrupt = finished?.outcome?.interrupts[0];
    expect(interrupt?.reason).toBe("await_apply_result");
    expect(interrupt?.toolCallId).toBe("r9-await-apply");
    expect(interrupt?.metadata?.generationId).toBe("gen-r9");

    // generation 进入 awaiting_apply_result 并绑定 toolCallId。
    const generation = coordinator.snapshot().generations[0];
    expect(generation?.status).toBe("awaiting_apply_result");
    expect(generation?.applyToolCallId).toBe("r9-await-apply");
  });

  it("apply 结果关联：匹配则透传并更新状态；不匹配则改写为 aborted", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new GenerationScriptedAgent(coordinator, ['{"op":"add"}\n']),
      coordinator,
      { agentId: "chat" },
    );
    await collect(agent, { threadId: "t3", runId: "r1" });

    // 匹配结果：透传，generation 状态更新为 committed。
    await collect(agent, {
      threadId: "t3",
      runId: "r2",
      messages: [
        {
          role: "tool",
          toolCallId: "r1-await-apply",
          content: JSON.stringify({
            generationId: "gen-r1",
            status: "committed",
            revision: 1,
          }),
        },
      ] as never,
    });
    expect(coordinator.snapshot().generations[0]?.status).toBe("committed");

    // 不匹配（伪造 generationId）：内容改写为 aborted，generation 不被污染。
    const events = await collect(agent, {
      threadId: "t3",
      runId: "r3",
      messages: [
        {
          role: "tool",
          toolCallId: "r1-await-apply",
          content: JSON.stringify({
            generationId: "forged-gen",
            status: "committed",
            revision: 99,
          }),
        },
      ] as never,
    });
    expect(events.find((e) => e.type === EventType.RUN_STARTED)).toBeDefined();
    const generation = coordinator.snapshot().generations[0];
    expect(generation?.status).toBe("committed"); // 仍是上一次的真实结果
    expect(generation?.applyResult?.revision).toBe(1);
  });

  it("已解决的 await_apply_result 是终结回执，不再进入模型", async () => {
    const coordinator = new GenerationCoordinator();
    const seed = new CoordinatedMastraAgent(
      new GenerationScriptedAgent(coordinator, ['{"op":"add"}\n']),
      coordinator,
      { agentId: "chat" },
    );
    await collect(seed, { threadId: "t-apply-terminal", runId: "r1" });

    const inner = new FailIfInvokedAgent();
    const receiver = new CoordinatedMastraAgent(inner, coordinator, {
      agentId: "chat",
    });
    const events = await collect(receiver, {
      threadId: "t-apply-terminal",
      runId: "r2",
      resume: [
        {
          status: "resolved",
          interruptId: "r1::r1-await-apply",
          payload: {
            generationId: "gen-r1",
            status: "committed",
            revision: 1,
          },
        },
      ],
    } as never);

    expect(inner.calls).toBe(0);
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(coordinator.snapshot().generations[0]?.status).toBe("committed");
  });

  it("持久层拒绝 committed 时改写为 failed，不能保留客户端假成功", async () => {
    const lifecycle: GenerationLifecyclePort = {
      startRun: async () => undefined,
      persistQuestion: async () => undefined,
      recordAnswer: async () => undefined,
      consumeApprovedPlan: async () => null,
      markAwaitingPreview: async () => true,
      applyResult: async () => false,
      markFailed: async () => undefined,
      heartbeat: async () => true,
      abortRun: async () => true,
      sweepOrphanRuns: async () => 0,
      sweepStaleRuns: async () => 0,
    };
    const coordinator = new GenerationCoordinator(lifecycle);
    coordinator.setAppContext("t-persist", {
      appId: "app-persist",
      membershipId: "member-persist",
    });
    coordinator.beginGeneration({
      threadId: "t-persist",
      runId: "r-persist",
      generationId: "gen-persist",
    });
    coordinator.armApplyToolCall(
      "t-persist",
      "gen-persist",
      "r-persist-await-apply",
    );

    const resolved = await coordinator.resolveApply(
      "t-persist",
      "r-persist-await-apply",
      { generationId: "gen-persist", status: "committed", revision: 1 },
    );

    expect(resolved?.status).toBe("failed");
    expect(resolved?.applyResult).toMatchObject({
      status: "failed",
      error: "预览未能保存，请重试。",
    });
  });

  it("resume 无任何模型事件时主动结束，不能无限 Thinking", async () => {
    const coordinator = new GenerationCoordinator();
    const agent = new CoordinatedMastraAgent(
      new HangingAgent(),
      coordinator,
      { agentId: "chat", idleTimeoutMs: 10 },
    );
    const events = await collect(agent, { threadId: "t-timeout", runId: "r-timeout" });
    const failure = events.find((event) => event.type === EventType.RUN_ERROR) as
      | { message?: string }
      | undefined;
    expect(failure?.message).toContain("长时间未返回进展");
  });

  it("停止经任意 clone 调用时结束运行中的 clone", async () => {
    const coordinator = new GenerationCoordinator();
    const root = new CoordinatedMastraAgent(
      new HangingAgent(),
      coordinator,
      { agentId: "chat", idleTimeoutMs: 10_000 },
    );
    const running = root.clone();
    const completed = new Promise<void>((resolve, reject) => {
      running
        .run({
          messages: [],
          tools: [],
          context: [],
          state: {},
          threadId: "t-stop",
          runId: "r-stop",
        } as RunAgentInput)
        .subscribe({ error: reject, complete: resolve });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.abortRun();
    await completed;
  });

  it("generateSpecInputSchema：target 判别联合的硬约束", () => {
    // 创建：base=empty 不需要 currentSpec/baseRevision。
    expect(
      generateSpecInputSchema.safeParse({
        request: "创建",
        source: { kind: "direct_edit" },
        target: { base: "empty" },
      }).success,
    ).toBe(true);

    // 编辑：base=current 必须同时携带 currentSpec 与 baseRevision。
    expect(
      generateSpecInputSchema.safeParse({
        request: "改",
        source: { kind: "direct_edit" },
        target: { base: "current" },
      }).success,
    ).toBe(false);
    expect(
      generateSpecInputSchema.safeParse({
        request: "改",
        source: { kind: "direct_edit" },
        target: { base: "current", baseRevision: 3, currentSpec: {} },
      }).success,
    ).toBe(true);

    // approved_plan 必须携带 questionSetId。
    expect(
      generateSpecInputSchema.safeParse({
        request: "创建",
        source: { kind: "approved_plan" },
        target: { base: "empty" },
      }).success,
    ).toBe(false);
  });
});
