import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { redactEventMessage, redactForLog } from "./log-redact.ts";
import { Observable } from "rxjs";
import type { GenerationCoordinator } from "./generation-coordinator.ts";
// pi-lens-ignore: ts:5097
import { applyResultSchema, askQuestionInputSchema } from "./contracts.ts";

const ASK_QUESTION_TOOL = "ask_question";
const AWAIT_APPLY_TOOL = "await_apply_result";

/**
 * CoordinatedMastraAgent：CopilotKit Runtime 注册的唯一 AG-UI adapter。
 * 包装内层 agent（生产为 @ag-ui/mastra 的 MastraAgent，测试为脚本化 mock）：
 *
 * - 透传内层事件；
 * - 合入 GenerationCoordinator 的 spec.patch.* CUSTOM 事件（保证在
 *   RUN_FINISHED 之前发出，满足 AG-UI 事件顺序硬约束）；
 * - ask_question / await_apply_result 的 TOOL_CALL 完成后，以
 *   RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } } 结束 run；
 * - 下一 run 的工具结果（绑定 toolCallId 的 ToolMessage）交给 Coordinator
 *   做关联校验；不匹配时改写为 aborted 结果（fail closed）。
 */
export class CoordinatedMastraAgent extends AbstractAgent {
  // 注意：不用 TS 参数属性——Node 24 类型剥离（strip-only）不支持该语法。
  private readonly inner: AbstractAgent;
  private readonly coordinator: GenerationCoordinator;

  constructor(
    inner: AbstractAgent,
    coordinator: GenerationCoordinator,
    config?: { agentId?: string; description?: string },
  ) {
    super({
      agentId: config?.agentId ?? inner.agentId ?? "chat",
      description: config?.description ?? inner.description ?? "",
    });
    this.inner = inner;
    this.coordinator = coordinator;
  }

  clone(): CoordinatedMastraAgent {
    return new CoordinatedMastraAgent(this.inner.clone(), this.coordinator, {
      agentId: this.agentId,
      description: this.description,
    });
  }

  /**
   * 用户停止：CopilotKit runner 的 stop() 调用 agent.abortRun()
   *（AbstractAgent 基类是空实现，只有 HttpAgent 会中止 fetch）。
   * 这里终止本实例所有活动 run：退订内层、关闭 Coordinator run 通道并
   * 提前 complete（不发终止事件——runner 会以 stopRequested 语义补
   * RUN_FINISHED 与未决工具的 stopped 结果）。CopilotKit 按请求 clone
   * agent，stop 作用于执行该 run 的同一克隆实例。
   */
  private readonly activeRunTeardowns = new Map<string, () => void>();

  override abortRun(): void {
    this.inner.abortRun();
    for (const teardown of this.activeRunTeardowns.values()) teardown();
    this.activeRunTeardowns.clear();
  }

  /**
   * 把 input.resume 中已解决/已取消的 interrupt 转换为合成工具结果消息。
   * 转换后从输入中剥掉 resume 字段，防止 @ag-ui/mastra 走 Mastra 原生
   * resumeStream（我们的 interrupt 是 AG-UI 协议层，Mastra 无 suspended run）。
   * 合成消息与客户端直发的工具消息走同一条 inspectIncomingToolResults
   * 校验路径；若消息通道已携带同 toolCallId 的结果则不再合成（去重）。
   */
  private prepareResumeInput(input: RunAgentInput): RunAgentInput {
    const withResume = input as RunAgentInput & {
      resume?: Array<{
        status?: string;
        interruptId?: string;
        payload?: unknown;
      }>;
    };
    const resume = withResume.resume;
    if (!Array.isArray(resume) || resume.length === 0) return input;

    console.warn(
      `[coordinator] prepareResumeInput thread=${input.threadId} run=${input.runId} entries=${resume.length} ${resume
        .map(
          (entry) =>
            `${entry?.status ?? "unknown"}:${typeof entry?.interruptId === "string" ? entry.interruptId.slice(-96) : "missing-id"}`,
        )
        .join(", ")
        .slice(0, 800)}`,
    );

    const normalizedMessages = [...input.messages];
    const extraToolMessages: Array<Record<string, unknown>> = [];
    const passthrough: typeof resume = [];
    let normalizedExistingToolResults = 0;

    for (const entry of resume) {
      const resolved =
        entry?.status === "resolved" || entry?.status === "cancelled";
      if (!entry || !resolved || typeof entry.interruptId !== "string") {
        passthrough.push(entry);
        continue;
      }
      const sep = entry.interruptId.indexOf("::");
      const toolCallId =
        sep >= 0 ? entry.interruptId.slice(sep + 2) : entry.interruptId;
      const payload =
        entry.status === "cancelled"
          ? this.synthesizeCancelledPayload(input.threadId, toolCallId)
          : (entry.payload ?? {
              action: "respond",
              response: "[aborted] 空的恢复负载",
            });
      const existingMessageIndex = normalizedMessages.findIndex(
        (m) =>
          (m as { role?: string }).role === "tool" &&
          (m as { toolCallId?: string }).toolCallId === toolCallId,
      );
      if (existingMessageIndex >= 0) {
        // CopilotKit 有时会同时携带 resume 与一个同 toolCallId 的占位
        // ToolMessage。resume.payload 才是 useInterrupt resolve 的权威结果；
        // 覆盖占位内容后仍走同一关联校验路径，不能让它吞掉 resume。
        normalizedMessages[existingMessageIndex] = {
          ...(normalizedMessages[existingMessageIndex] as Record<
            string,
            unknown
          >),
          content: JSON.stringify(payload),
        } as never;
        normalizedExistingToolResults += 1;
        continue;
      }
      extraToolMessages.push({
        id: `${input.runId}-resume-${toolCallId}`,
        role: "tool",
        toolCallId,
        content: JSON.stringify(payload),
      });
    }

    console.warn(
      `[coordinator] prepareResumeInput synthesizedToolResults=${extraToolMessages.length} normalizedExistingToolResults=${normalizedExistingToolResults} passthrough=${passthrough.length}`,
    );

    const copy = {
      ...input,
      messages: [...normalizedMessages, ...extraToolMessages],
    } as RunAgentInput & { resume?: unknown };
    if (passthrough.length > 0) {
      copy.resume = passthrough;
    } else {
      delete copy.resume;
    }
    return copy;
  }

  /** 用户取消 interrupt 时的合成负载（按 coordinator 中的待决类型判别）。 */
  private synthesizeCancelledPayload(
    threadId: string,
    toolCallId: string,
  ): unknown {
    const snapshot = this.coordinator.snapshot();
    const question = snapshot.questions.find(
      (d) => d.toolCallId === toolCallId && d.threadId === threadId,
    );
    if (question) {
      return {
        answers: question.input.questions.map((item) => ({
          questionId: item.id,
          value: item.allowSkip ? "skip" : item.options[0]!.value,
        })),
      };
    }
    const generation = snapshot.generations.find(
      (g) => g.applyToolCallId === toolCallId && g.threadId === threadId,
    );
    if (generation) {
      return { generationId: generation.generationId, status: "aborted" };
    }
    return { answers: [] };
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const { threadId, runId } = input;
    // CopilotKit 客户端的 interrupt resolve 走 input.resume 通道；
    // @ag-ui/mastra 看到 resume 会调用 Mastra 原生 resumeStream（我们的
    // interrupt 是 AG-UI 协议层的，Mastra 运行时里没有 suspended run）。
    // 这里把已解决的 resume 项转换为合成工具结果消息（随后走统一的
    // inspectIncomingToolResults 校验），并从传给内层的输入中剥掉 resume。
    const preparedInput = this.prepareResumeInput(input);
    this.inspectIncomingToolResults(preparedInput);

    // S3：服务端鉴证的应用上下文（endpoint 中间件经 Session + Membership
    // 校验后注入 forwardedProps.__vma；缺失时持久化跳过，关联器退化为
    // 仅进程内——生产路径必有该上下文）。
    const vma = (input.forwardedProps as Record<string, unknown> | undefined)
      ?.__vma as { appId?: string; membershipId?: string } | undefined;
    if (vma?.appId && vma.membershipId) {
      this.coordinator.setAppContext(threadId, {
        appId: vma.appId,
        membershipId: vma.membershipId,
      });
    }

    // 把 threadId/runId 透传到 Mastra requestContext（经 input.context），
    // 供服务器工具（generate_spec）定位 Coordinator 的活动 run。
    // 同时注入两个不由客户端注册的工具定义（ask_question 由
    // useInterrupt 渲染、await_apply_result 由协议收尾触发），让模型可见。
    const enrichedInput: RunAgentInput = {
      ...preparedInput,
      context: [
        ...preparedInput.context,
        { description: "coordinator-thread-id", value: threadId },
        { description: "coordinator-run-id", value: runId },
      ],
      tools: injectToolDefinitions(preparedInput.tools),
    };

    return new Observable<BaseEvent>((subscriber) => {
      const channel = this.coordinator.openRun(threadId, runId);
      const pendingInterrupts: Array<{
        id: string;
        reason: string;
        toolCallId?: string;
        metadata?: Record<string, unknown>;
      }> = [];
      let innerFinished: BaseEvent | null = null;
      let innerCompleted = false;
      let innerErrored: unknown = null;

      const toolCallBuffers = new Map<string, { name: string; args: string }>();

      const finalize = () => {
        // 1) Coordinator 确定性收尾：generate_spec 流结束后发出
        //    await_apply_result 前端工具调用。
        const pendingApply = this.coordinator.pendingApplyRequest(
          threadId,
          runId,
        );
        if (pendingApply) {
          const applyToolCallId = `${runId}-await-apply`;
          this.coordinator.armApplyToolCall(
            threadId,
            pendingApply.generationId,
            applyToolCallId,
          );
          subscriber.next({
            type: EventType.TOOL_CALL_START,
            toolCallId: applyToolCallId,
            toolCallName: AWAIT_APPLY_TOOL,
          } as BaseEvent);
          subscriber.next({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: applyToolCallId,
            delta: JSON.stringify({ generationId: pendingApply.generationId }),
          } as BaseEvent);
          subscriber.next({
            type: EventType.TOOL_CALL_END,
            toolCallId: applyToolCallId,
          } as BaseEvent);
          pendingInterrupts.push({
            id: `${runId}::${applyToolCallId}`,
            reason: AWAIT_APPLY_TOOL,
            toolCallId: applyToolCallId,
            metadata: { generationId: pendingApply.generationId },
          });
        }

        // 2) 重写 RUN_FINISHED：有 pending interrupt 时携带 outcome。
        const finished = innerFinished as unknown as {
          result?: unknown;
        } | null;
        if (pendingInterrupts.length > 0) {
          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId,
            runId,
            ...(finished?.result === undefined
              ? {}
              : { result: finished.result }),
            outcome: {
              type: "interrupt",
              interrupts: pendingInterrupts.map((i) => ({
                id: i.id,
                reason: i.reason,
                ...(i.toolCallId ? { toolCallId: i.toolCallId } : {}),
                ...(i.metadata ? { metadata: i.metadata } : {}),
              })),
            },
          } as unknown as BaseEvent);
        } else if (innerFinished) {
          subscriber.next(innerFinished);
        }
        this.coordinator.closeRun(threadId, runId);
        subscriber.complete();
      };

      const handleEvent = (event: BaseEvent) => {
        switch (event.type) {
          case EventType.TOOL_CALL_START: {
            const e = event as unknown as {
              toolCallId: string;
              toolCallName: string;
            };
            toolCallBuffers.set(e.toolCallId, {
              name: e.toolCallName,
              args: "",
            });
            // ask_question 需要等参数校验并格式化为一条普通助手
            // 消息后再重放。这样问题/计划会进入聊天记录，而非只存在于临时
            // interrupt UI 中；交互卡只承担类似 Codex question 的作答职责。
            if (e.toolCallName === ASK_QUESTION_TOOL) return;
            // 纵深防御：模型主动调用 await_apply_result（协议内部收尾工具，
            // 模型不可见但仍可能幻觉调用）——静默丢弃整条调用，
            // 避免悬空调用阻塞后续 run。
            if (e.toolCallName === AWAIT_APPLY_TOOL) return;
            subscriber.next(event);
            return;
          }
          case EventType.TOOL_CALL_ARGS: {
            const e = event as unknown as { toolCallId: string; delta: string };
            const buffer = toolCallBuffers.get(e.toolCallId);
            if (buffer) buffer.args += e.delta;
            // ask_question 的 args 在 END 时统一校验并补服务端
            // questionSetId 后重放（模型不得自创）。
            // await_apply_result 的模型调用整条丢弃。
            if (
              buffer?.name === ASK_QUESTION_TOOL ||
              buffer?.name === AWAIT_APPLY_TOOL
            )
              return;
            subscriber.next(event);
            return;
          }
          case EventType.TOOL_CALL_END: {
            const e = event as unknown as { toolCallId: string };
            const buffer = toolCallBuffers.get(e.toolCallId);
            if (buffer?.name === AWAIT_APPLY_TOOL) {
              console.warn(
                `[coordinator] dropped model-initiated ${AWAIT_APPLY_TOOL} call`,
              );
              toolCallBuffers.delete(e.toolCallId);
              return;
            }
            if (buffer?.name === ASK_QUESTION_TOOL) {
              const rewritten = registerQuestionToolCall(
                this.coordinator,
                threadId,
                runId,
                e.toolCallId,
                buffer.args,
              );
              if (!rewritten) {
                // fail closed：参数不符合 Schema，中止当前 run。
                subscriber.next({
                  type: EventType.RUN_ERROR,
                  threadId,
                  runId,
                  message:
                    "tool protocol error: invalid ask_question arguments",
                } as unknown as BaseEvent);
                this.coordinator.closeRun(threadId, runId);
                subscriber.complete();
                return;
              }
              emitQuestionTranscript(
                subscriber,
                runId,
                e.toolCallId,
                rewritten.input,
              );
              subscriber.next({
                type: EventType.TOOL_CALL_START,
                toolCallId: e.toolCallId,
                toolCallName: ASK_QUESTION_TOOL,
              } as BaseEvent);
              subscriber.next({
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: e.toolCallId,
                delta: rewritten.argsJson,
              } as unknown as BaseEvent);
              subscriber.next(event);
              pendingInterrupts.push({
                id: `${runId}::${e.toolCallId}`,
                reason: ASK_QUESTION_TOOL,
                toolCallId: e.toolCallId,
                metadata: rewritten.metadata,
              });
              return;
            }
            subscriber.next(event);
            return;
          }
          case EventType.RUN_FINISHED: {
            // 拦截：先等 Coordinator 队列与 await_apply_result 注入完成。
            // S3：先 drain 持久化任务（DB 为事实 owner），再收尾事件流。
            innerFinished = event;
            innerCompleted = true;
            void this.coordinator
              .drain()
              .catch((error) => {
                console.error(
                  "[generation-lifecycle] drain 失败：",
                  redactForLog(error),
                );
              })
              .then(finalize);
            return;
          }
          case EventType.RUN_ERROR: {
            innerFinished = event;
            innerCompleted = true;
            this.coordinator.closeRun(threadId, runId);
            // S7：转发给客户端前统一脱敏截断，不泄漏令牌/Spec/记录正文
            const rawMessage = (event as { message?: unknown }).message;
            subscriber.next({
              ...event,
              message: redactEventMessage(rawMessage ?? "运行失败"),
            });
            subscriber.complete();
            return;
          }
          default:
            subscriber.next(event);
        }
      };

      const channelSub = channel.subscribe({
        next: (event) => {
          // CUSTOM 事件必须早于 RUN_FINISHED；finalize 后 channel 已关闭。
          if (!innerCompleted) subscriber.next(event);
        },
      });

      const innerSub = this.inner.run(enrichedInput).subscribe({
        next: handleEvent,
        error: (error: unknown) => {
          innerErrored = error;
          this.coordinator.closeRun(threadId, runId);
          channelSub.unsubscribe();
          subscriber.error(error);
        },
        complete: () => {
          channelSub.unsubscribe();
          // 内层正常结束但没有 RUN_FINISHED（异常形态）：补一个失败收尾。
          if (!innerCompleted && !innerErrored) {
            this.coordinator.closeRun(threadId, runId);
            subscriber.next({
              type: EventType.RUN_ERROR,
              threadId,
              runId,
              message: "inner agent completed without RUN_FINISHED",
            } as BaseEvent);
            subscriber.complete();
          }
        },
      });

      // 注册 abort 钩子：abortRun() 被调用时提前 complete（不发终止事件，
      // 由 runner 以 stopRequested 语义补齐 RUN_FINISHED 与未决工具结果）。
      const runKey = `${threadId}:${runId}`;
      let abortFired = false;
      this.activeRunTeardowns.set(runKey, () => {
        if (abortFired || innerCompleted) return;
        abortFired = true;
        innerSub.unsubscribe();
        channelSub.unsubscribe();
        this.coordinator.closeRun(threadId, runId);
        subscriber.complete();
      });

      return () => {
        this.activeRunTeardowns.delete(runKey);
        innerSub.unsubscribe();
        channelSub.unsubscribe();
        this.coordinator.closeRun(threadId, runId);
      };
    });
  }
  /**
   * 检查下一 run 携带的前端工具结果（ToolMessage）：
   * - ask_question 结果 → Coordinator 关联校验并记录；
   * - await_apply_result 结果 → 校验 { threadId, generationId, applyToolCallId }；
   * 关联不匹配时把内容改写为 aborted（fail closed），模型只能看到失败事实。
   */
  private inspectIncomingToolResults(input: RunAgentInput): void {
    const messages = [...input.messages];
    for (const message of messages) {
      if (message.role !== "tool" || !message.toolCallId) continue;
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content);

      // await_apply_result 结果
      const applyParsed = applyResultSchema.safeParse(safeJson(content));
      if (applyParsed.success && applyParsed.data.generationId) {
        const resolved = this.coordinator.resolveApply(
          input.threadId,
          message.toolCallId,
          applyParsed.data,
        );
        if (!resolved) {
          message.content = JSON.stringify({
            generationId: applyParsed.data.generationId,
            status: "aborted",
            error: "correlation mismatch: threadId/generationId/toolCallId",
          });
        }
        continue;
      }

      // ask_question 结果
      const resolved = this.coordinator.resolveQuestion(
        input.threadId,
        message.toolCallId,
        content,
      );
      if (!resolved && content.includes('"answers"')) {
        message.content = JSON.stringify({
          answers: [],
          error: "[aborted] question correlation mismatch or invalid result",
        });
      }
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * ask_question 参数校验 + 服务端 questionSetId 重写。
 * 返回重放给客户端的 argsJson 与 interrupt metadata；无效返回 null。
 */
function registerQuestionToolCall(
  coordinator: GenerationCoordinator,
  threadId: string,
  runId: string,
  toolCallId: string,
  rawArgs: string,
): {
  argsJson: string;
  input: import("./contracts.ts").AskQuestionInput;
  metadata: Record<string, unknown>;
} | null {
  // 去掉模型自创的 questionSetId，由服务端统一签发。
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    console.warn(
      `[coordinator] question args JSON.parse failed: ${rawArgs.slice(0, 800)}`,
    );
    return null;
  }
  const candidate = { ...parsed };
  delete candidate.questionSetId;
  candidate.questionSetId = `q-${runId}-${toolCallId}`;
  const question = coordinator.registerQuestion({
    threadId,
    runId,
    toolCallId,
    rawArgs: JSON.stringify(candidate),
  });
  if (!question) {
    // 有界诊断：打印截断原文与 Zod issues，便于对照真实模型输出修契约。
    const check = askQuestionInputSchema.safeParse(candidate);
    console.warn(
      `[coordinator] question args rejected: ${JSON.stringify(candidate).slice(0, 800)}`,
      check.success ? "" : JSON.stringify(check.error.issues).slice(0, 800),
    );
    return null;
  }
  const finalInput = question.input;
  const argsJson = JSON.stringify(finalInput);
  const metadata: Record<string, unknown> = {
    message: finalInput.message,
    questionSetId: finalInput.questionSetId,
    questions: finalInput.questions,
    ...(finalInput.plan ? { plan: finalInput.plan } : {}),
  };
  return { argsJson, input: finalInput, metadata };
}

/**
 * 把问卷的语义内容写进普通 assistant message。Interrupt 只保留“选择/输入
 * 回答”的控件，因此在完成、滚动或重渲染后，用户仍能从聊天记录看到计划及
 * 问题本身。
 */
function emitQuestionTranscript(
  subscriber: { next(event: BaseEvent): void },
  runId: string,
  toolCallId: string,
  input: import("./contracts.ts").AskQuestionInput,
): void {
  const messageId = `${runId}-${toolCallId}-question`;
  const planText = input.plan
    ? `\n\n计划\n- 目标：${input.plan.goal}\n- 页面：${input.plan.pages.join("、")}\n- 结构：${input.plan.structure.join("、")}\n- 视觉方向：${input.plan.style}`
    : "";
  const text = `${input.message}${planText}\n\n请在下方回答 ${input.questions.length} 个问题。`;
  subscriber.next({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: "assistant",
  } as BaseEvent);
  subscriber.next({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: text,
  } as BaseEvent);
  subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
}

/**
 * 模型可见但不由客户端注册的工具定义。
 * 注意：await_apply_result 故意不注入——它由协调器在 run 收尾时确定性
 * 发出，模型不可见（实测：注入后模型会主动调用它，产生悬空调用）。
 */
const INJECTED_TOOL_DEFINITIONS = [
  {
    name: ASK_QUESTION_TOOL,
    description:
      "向用户提出 1 至 12 个需要作答的问题，行为类似 question 工具。服务端会将摘要和可选计划持久化为普通聊天消息；此工具只提供问卷控件并暂停。优先只问高价值问题，避免无必要的长问卷。每题必须提供 id、header、question 与 options；可选 allowCustom、allowSkip 和 plan。questionSetId 由服务端签发，模型不要提供。",
    // 注意：使用扁平 object 而非顶层 oneOf——OpenAI function calling
    // 不支持根级 oneOf/anyOf，模型会因此输出空参数 {}。
    // 严格校验在服务端 registerQuestion 完成（fail closed）。
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "问卷前的简短说明，会作为普通聊天消息保留",
        },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              header: { type: "string" },
              question: { type: "string" },
              options: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: {
                  type: "object",
                  properties: {
                    value: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                    recommended: { type: "boolean" },
                  },
                  required: ["value", "label"],
                },
              },
              allowCustom: { type: "boolean" },
              allowSkip: { type: "boolean" },
            },
            required: ["id", "header", "question", "options"],
          },
        },
        plan: {
          type: "object",
          description: "kind=plan_confirmation 时必填：应用计划",
          properties: {
            goal: { type: "string", description: "应用目标" },
            pages: {
              type: "array",
              items: { type: "string" },
              description: "页面列表（名称数组）",
            },
            structure: {
              type: "array",
              items: { type: "string" },
              description: "主要结构/区块列表",
            },
            style: { type: "string", description: "视觉风格方向" },
          },
          required: ["goal", "pages", "structure", "style"],
        },
      },
      required: ["message", "questions"],
    },
  },
] as const;

function injectToolDefinitions(
  tools: RunAgentInput["tools"],
): RunAgentInput["tools"] {
  const existing = new Set(tools.map((t) => t.name));
  const injected = INJECTED_TOOL_DEFINITIONS.filter(
    (t) => !existing.has(t.name),
  );
  return [...tools, ...injected] as RunAgentInput["tools"];
}
