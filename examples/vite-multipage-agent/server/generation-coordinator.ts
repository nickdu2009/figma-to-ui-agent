import type { BaseEvent } from "@ag-ui/client";
import { Subject } from "rxjs";
import { redactForLog } from "./log-redact.ts";

// 说明：相对导入使用显式 .ts 扩展名（Node 24 类型剥离直接运行本目录）；
// tsconfig 已启用 allowImportingTsExtensions，tsc --noEmit 通过。
import {
  SPEC_PATCH_EVENT_NAMES,
  type AppPlan,
  type ApplyResult,
  type AskQuestionInput,
  type AskQuestionResult,
  askQuestionInputSchema,
  askQuestionResultSchema,
  // pi-lens-ignore: ts:5097
} from "./contracts.ts";
import type {
  ApplyOutcome,
  GenerationLifecyclePort,
} from "./generation/lifecycle.ts";

/**
 * GenerationCoordinator：唯一的临时协调状态 owner（进程内，不落盘）。
 * 绑定 threadId / runId / toolCallId / questionSetId / generationId；
 * 任何关联不匹配一律 aborted，不恢复、不重放。
 */

export type PendingQuestion = {
  threadId: string;
  questionSetId: string;
  toolCallId: string;
  runId: string;
  input: AskQuestionInput;
  result?: AskQuestionResult;
  consumed: boolean;
};

export type PendingGeneration = {
  threadId: string;
  generationId: string;
  startRunId: string;
  applyToolCallId?: string;
  status:
    | "patch_streaming"
    | "awaiting_apply_result"
    | "committed"
    | "failed"
    | "aborted";
  applyResult?: ApplyResult;
};

type ActiveRun = {
  threadId: string;
  runId: string;
  events: Subject<BaseEvent>;
};

const key = (threadId: string, id: string) => `${threadId}:${id}`;

export class GenerationCoordinator {
  private questions = new Map<string, PendingQuestion>();
  private generations = new Map<string, PendingGeneration>();
  private activeRuns = new Map<string, ActiveRun>();
  /** S3：持久层端口（生产路径必注入；缺省时仅进程内关联，供单元测试）。 */
  private readonly lifecycle?: GenerationLifecyclePort;
  /** 服务端鉴证的应用上下文（由 wrapper 从 forwardedProps.__vma 注入）。 */
  private readonly appContexts = new Map<
    string,
    { appId: string; membershipId: string }
  >();
  private lifecycleChain: Promise<void> = Promise.resolve();

  constructor(lifecycle?: GenerationLifecyclePort) {
    this.lifecycle = lifecycle;
  }

  /** wrapper 在 run 开始时注入服务端鉴证的 { appId, membershipId }。 */
  setAppContext(
    threadId: string,
    context: { appId: string; membershipId: string },
  ): void {
    this.appContexts.set(threadId, context);
  }

  private appContext(
    threadId: string,
  ): { appId: string; membershipId: string } | null {
    return this.appContexts.get(threadId) ?? null;
  }

  /** 持久化任务排队执行；失败记录日志但不中断事件流（DB 为事实 owner）。 */
  private track(task: () => Promise<void>): void {
    this.lifecycleChain = this.lifecycleChain.then(task).catch((error) => {
      console.error("[generation-lifecycle] 持久化失败：", redactForLog(error));
    });
  }

  /** wrapper 在 run 收尾前等待所有持久化任务完成。 */
  drain(): Promise<void> {
    return this.lifecycleChain;
  }

  // ---- run 通道（CoordinatedMastraAgent 与服务器工具之间的事件总线） ----

  openRun(threadId: string, runId: string): Subject<BaseEvent> {
    const subject = new Subject<BaseEvent>();
    this.activeRuns.set(key(threadId, runId), {
      threadId,
      runId,
      events: subject,
    });
    return subject;
  }

  closeRun(threadId: string, runId: string): void {
    const run = this.activeRuns.get(key(threadId, runId));
    if (run) {
      run.events.complete();
      this.activeRuns.delete(key(threadId, runId));
    }
  }

  private emitCustom(
    threadId: string,
    runId: string,
    name: string,
    value: unknown,
  ): void {
    const run = this.activeRuns.get(key(threadId, runId));
    run?.events.next({ type: "CUSTOM", name, value } as BaseEvent);
  }

  // ---- ask_question ----

  /** 由 wrapper 在观察到 ask_question TOOL_CALL_END 时调用。 */
  registerQuestion(params: {
    threadId: string;
    runId: string;
    toolCallId: string;
    rawArgs: string;
  }): PendingQuestion | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params.rawArgs);
    } catch {
      return null;
    }
    const checked = askQuestionInputSchema.safeParse(parsed);
    if (!checked.success) return null;
    const input = checked.data;
    const question: PendingQuestion = {
      threadId: params.threadId,
      questionSetId: input.questionSetId,
      toolCallId: params.toolCallId,
      runId: params.runId,
      input,
      consumed: false,
    };
    this.questions.set(key(params.threadId, input.questionSetId), question);
    const context = this.appContext(params.threadId);
    if (this.lifecycle && context) {
      const lifecycle = this.lifecycle;
      this.track(() =>
        lifecycle.persistQuestion({
          appId: context.appId,
          generationId: null,
          questionSetId: input.questionSetId,
          payload: input,
        }),
      );
    }
    return question;
  }

  /**
   * 下一 run 中工具结果到达时调用。校验 { threadId, toolCallId } 关联；
   * 不匹配时返回 null（调用方按 fail-closed 处理）。
   */
  resolveQuestion(
    threadId: string,
    toolCallId: string,
    rawContent: string,
  ): { question: PendingQuestion; result: AskQuestionResult } | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return null;
    }
    const checked = askQuestionResultSchema.safeParse(parsed);
    if (!checked.success) return null;
    const result = checked.data;
    const question = [...this.questions.values()].find(
      (d) =>
        d.threadId === threadId && d.toolCallId === toolCallId && !d.consumed,
    );
    if (!question) return null;
    if (result.answers.length !== question.input.questions.length) return null;
    const seen = new Set<string>();
    for (const answer of result.answers) {
      if (seen.has(answer.questionId)) return null;
      seen.add(answer.questionId);
      const definition = question.input.questions.find(
        (item) => item.id === answer.questionId,
      );
      if (!definition) return null;
      if (answer.value === "other") {
        if (!definition.allowCustom || !answer.text) return null;
        continue;
      }
      if (answer.value === "skip") {
        if (!definition.allowSkip) return null;
        continue;
      }
      if (!definition.options.some((option) => option.value === answer.value)) {
        return null;
      }
    }
    question.result = result;
    if (this.lifecycle) {
      const lifecycle = this.lifecycle;
      this.track(() =>
        lifecycle.recordAnswer({
          questionSetId: question.questionSetId,
          answerPayload: result,
        }),
      );
    }
    return { question, result };
  }

  /** generate_spec 的 approved_plan 来源取回：仅接受问卷中明确的 approve。
   *  有 lifecycle 时以持久层条件消费为权威（重启安全、原子单次消费）。 */
  async consumeApprovedPlan(
    threadId: string,
    questionSetId: string,
  ): Promise<AppPlan | null> {
    const question = this.questions.get(key(threadId, questionSetId));
    if (!question || question.consumed || !question.input.plan) return null;
    if (
      !question.result?.answers.some((answer) => answer.value === "approve")
    ) {
      return null;
    }
    if (this.lifecycle) {
      const consumed = await this.lifecycle.consumeApprovedPlan(questionSetId);
      if (consumed === null) return null; // 已被消费/状态不符：fail-closed
    }
    question.consumed = true;
    return question.input.plan;
  }

  // ---- generate_spec / spec.patch.* ----

  beginGeneration(params: {
    threadId: string;
    runId: string;
    generationId: string;
  }): PendingGeneration {
    const generation: PendingGeneration = {
      threadId: params.threadId,
      generationId: params.generationId,
      startRunId: params.runId,
      status: "patch_streaming",
    };
    this.generations.set(key(params.threadId, params.generationId), generation);
    const context = this.appContext(params.threadId);
    if (this.lifecycle && context) {
      const lifecycle = this.lifecycle;
      this.track(() =>
        lifecycle.startRun({
          appId: context.appId,
          membershipId: context.membershipId,
          generationId: params.generationId,
        }),
      );
    }
    this.emitCustom(
      params.threadId,
      params.runId,
      SPEC_PATCH_EVENT_NAMES.start,
      {
        generationId: params.generationId,
      },
    );
    return generation;
  }

  emitPatchDelta(
    threadId: string,
    runId: string,
    generationId: string,
    text: string,
  ): void {
    const generation = this.generations.get(key(threadId, generationId));
    if (!generation || generation.status !== "patch_streaming") return;
    this.emitCustom(threadId, runId, SPEC_PATCH_EVENT_NAMES.delta, {
      generationId,
      text,
    });
  }

  finishPatchStream(
    threadId: string,
    runId: string,
    generationId: string,
    candidate?: {
      spec: unknown;
      businessSchema?: unknown;
      diagnostics?: unknown;
    },
  ): void {
    const generation = this.generations.get(key(threadId, generationId));
    if (!generation || generation.status !== "patch_streaming") return;
    generation.status = "awaiting_apply_result";
    if (this.lifecycle && candidate) {
      const lifecycle = this.lifecycle;
      this.track(async () => {
        await lifecycle.markAwaitingPreview({
          generationId,
          candidateSpec: candidate.spec,
          candidateBusinessSchema: candidate.businessSchema ?? null,
          diagnostics: candidate.diagnostics ?? null,
        });
      });
    }
    this.emitCustom(threadId, runId, SPEC_PATCH_EVENT_NAMES.finish, {
      generationId,
    });
  }

  failPatchStream(
    threadId: string,
    runId: string,
    generationId: string,
    error: string,
  ): void {
    const generation = this.generations.get(key(threadId, generationId));
    if (!generation) return;
    generation.status = "failed";
    if (this.lifecycle) {
      const lifecycle = this.lifecycle;
      this.track(() =>
        lifecycle.markFailed({
          generationId,
          diagnostics: { error },
        }),
      );
    }
    this.emitCustom(threadId, runId, SPEC_PATCH_EVENT_NAMES.error, {
      generationId,
      error,
    });
  }

  /** wrapper 在 run 收尾前调用：需要发出 await_apply_result 的 generation。 */
  pendingApplyRequest(
    threadId: string,
    runId: string,
  ): PendingGeneration | null {
    for (const generation of this.generations.values()) {
      if (
        generation.threadId === threadId &&
        generation.startRunId === runId &&
        generation.status === "awaiting_apply_result" &&
        !generation.applyToolCallId
      ) {
        return generation;
      }
    }
    return null;
  }

  armApplyToolCall(
    threadId: string,
    generationId: string,
    applyToolCallId: string,
  ): void {
    const generation = this.generations.get(key(threadId, generationId));
    if (generation) generation.applyToolCallId = applyToolCallId;
  }

  /**
   * 下一 run 中 await_apply_result 工具结果到达时调用。
   * 校验 { threadId, generationId, applyToolCallId }；不匹配一律 aborted。
   */
  resolveApply(
    threadId: string,
    toolCallId: string,
    result: ApplyResult,
  ): PendingGeneration | null {
    const generation = this.generations.get(key(threadId, result.generationId));
    if (!generation || generation.applyToolCallId !== toolCallId) return null;
    generation.applyResult = result;
    generation.status = result.status;
    if (this.lifecycle) {
      const lifecycle = this.lifecycle;
      const outcome = result.status as ApplyOutcome;
      const generationId = result.generationId;
      this.track(async () => {
        const ok = await lifecycle.applyResult({
          generationId,
          outcome,
          diagnostics:
            outcome === "committed"
              ? undefined
              : { error: result.error ?? outcome },
        });
        if (!ok) {
          // 持久层拒绝（迟到/重复/错配）：DB 保持旧状态，不创建草稿
          console.error(
            `[generation-lifecycle] apply 结果被持久层拒绝：${generationId} ${outcome}`,
          );
        }
      });
    }
    return generation;
  }

  /** 供测试与诊断读取（只读快照）。 */
  snapshot(): {
    questions: PendingQuestion[];
    generations: PendingGeneration[];
  } {
    return {
      questions: [...this.questions.values()].map((d) => ({ ...d })),
      generations: [...this.generations.values()].map((g) => ({ ...g })),
    };
  }
}
