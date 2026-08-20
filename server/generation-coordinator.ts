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
    | "awaiting_preview"
    | "recovery_pending"
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
  /** 服务端 generation 续租：模型在工具调用之间可长时间无 Patch，不能仅依赖
   * 浏览器计时器（后台标签会节流）来避免 stale sweep。 */
  private readonly generationHeartbeats = new Map<
    string,
    ReturnType<typeof setInterval>
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

  private startGenerationHeartbeat(
    threadId: string,
    generationId: string,
  ): void {
    const context = this.appContext(threadId);
    if (!this.lifecycle || !context) return;
    const heartbeatKey = key(threadId, generationId);
    if (this.generationHeartbeats.has(heartbeatKey)) return;
    const lifecycle = this.lifecycle;
    const timer = setInterval(() => {
      void lifecycle.heartbeat({ generationId }).catch((error) => {
        console.error(
          "[generation-lifecycle] 服务端心跳失败：",
          redactForLog(error),
        );
      });
    }, 10_000);
    timer.unref?.();
    this.generationHeartbeats.set(heartbeatKey, timer);
  }

  private stopGenerationHeartbeat(
    threadId: string,
    generationId: string,
  ): void {
    const heartbeatKey = key(threadId, generationId);
    const timer = this.generationHeartbeats.get(heartbeatKey);
    if (timer !== undefined) clearInterval(timer);
    this.generationHeartbeats.delete(heartbeatKey);
  }

  /** 持久化任务串行化；调用方需要时可等待自身的真实结果。 */
  private track<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.lifecycleChain.then(task);
    this.lifecycleChain = pending.then(
      () => undefined,
      (error) => {
        console.error(
          "[generation-lifecycle] 持久化失败：",
          redactForLog(error),
        );
      },
    );
    return pending;
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

  /**
   * 浏览器已接受补丁、但数据库拒绝其提交时，必须把事实回传到当前
   * resume run；不能只留一条服务端日志而让 UI 显示“已更新”。
   */
  emitPersistenceRejected(
    threadId: string,
    runId: string,
    generationId: string,
  ): void {
    this.emitCustom(threadId, runId, "spec.patch.persistence_rejected", {
      generationId,
    });
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
  async resolveQuestion(
    threadId: string,
    toolCallId: string,
    rawContent: string,
  ): Promise<{ question: PendingQuestion; result: AskQuestionResult } | null> {
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
    if (this.lifecycle) {
      const lifecycle = this.lifecycle;
      try {
        // resume 后的模型可能马上调用 generate_spec(approved_plan)。必须等
        // answered 条件更新完成，才能让 consumeApprovedPlan 看到同一事实，
        // 否则真实 LLM 会在 open 状态被 fail-closed 后失去后续生成路径。
        await this.track(() =>
          lifecycle.recordAnswer({
            questionSetId: question.questionSetId,
            answerPayload: result,
          }),
        );
      } catch (error) {
        console.error(
          "[generation-lifecycle] 问卷答案持久化失败：",
          redactForLog(error),
        );
        return null;
      }
    }
    question.result = result;
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
      this.startGenerationHeartbeat(params.threadId, params.generationId);
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
      bundle?: unknown;
      businessSchema?: unknown;
      diagnostics?: unknown;
      candidateDigest?: string;
      uiBundleDigest?: string;
      reportDigest?: string;
      publishBlocked?: boolean;
      fatalVisualIssues?: unknown[];
    },
  ): void {
    const generation = this.generations.get(key(threadId, generationId));
    if (!generation || generation.status !== "patch_streaming") return;
    generation.status = "awaiting_apply_result";
    if (this.lifecycle && candidate) {
      const lifecycle = this.lifecycle;
      this.track(async () => {
        const marked = await lifecycle.markAwaitingPreview({
          generationId,
          candidateSpec: candidate.spec,
          candidateBusinessSchema: candidate.businessSchema ?? null,
          diagnostics: candidate.diagnostics ?? null,
        });
        if (!marked) {
          throw new Error("GenerationRun 未能进入 awaiting_preview");
        }
      });
    }
    const totalOps =
      (candidate?.diagnostics as { totalOperations?: number } | undefined)
        ?.totalOperations ?? 0;
    this.emitCustom(threadId, runId, SPEC_PATCH_EVENT_NAMES.finish, {
      generationId,
      operationCount: totalOps,
      candidateDigest: candidate?.candidateDigest ?? "",
      uiBundleDigest: candidate?.uiBundleDigest ?? "",
      reportDigest: candidate?.reportDigest ?? "",
      bundle: candidate?.bundle ?? null,
      publishBlocked: candidate?.publishBlocked ?? false,
      fatalVisualIssues: candidate?.fatalVisualIssues ?? [],
    });
  }

  /**
   * v2 生成收尾。完整 Candidate 只在服务端 finalise 并通过验证后才发给
   * 浏览器；浏览器只可用回传的 digest 发起 Preview Commit，不能提交 Spec。
   *
   * 保留 finishPatchStream 仅为 compat/mock 的 await_apply_result 路径，生产
   * generate_spec 必须调用本方法。
   */
  async finishValidatedCandidate(
    threadId: string,
    runId: string,
    generationId: string,
    candidate: unknown,
    diagnostics?: { totalOperations?: number },
  ): Promise<void> {
    const generation = this.generations.get(key(threadId, generationId));
    if (!generation || generation.status !== "patch_streaming") return;
    if (!this.lifecycle?.finalizeAndValidateCandidate) {
      throw new Error("v2 generation lifecycle is not configured");
    }

    const finalized = await this.track(() =>
      this.lifecycle!.finalizeAndValidateCandidate!({ generationId, candidate }),
    );
    this.stopGenerationHeartbeat(threadId, generationId);
    const totalOperations = diagnostics?.totalOperations ?? 0;
    if (finalized.status === "recovery_pending") {
      generation.status = "recovery_pending";
      this.emitCustom(threadId, runId, SPEC_PATCH_EVENT_NAMES.error, {
        generationId,
        error: "候选包含阻塞性视觉问题，等待受控恢复决定。",
        fatalVisualIssues: finalized.fatalVisualIssues,
      });
      return;
    }

    generation.status = "awaiting_preview";
    this.emitCustom(threadId, runId, SPEC_PATCH_EVENT_NAMES.finish, {
      generationId,
      operationCount: totalOperations,
      candidateDigest: finalized.candidateDigest,
      uiBundleDigest: finalized.uiBundleDigest,
      reportDigest: finalized.reportDigest,
      bundle: finalized.bundle,
      publishBlocked: finalized.publishBlocked,
      fatalVisualIssues: [],
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
    this.stopGenerationHeartbeat(threadId, generationId);
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
  async resolveApply(
    threadId: string,
    toolCallId: string,
    result: ApplyResult,
  ): Promise<PendingGeneration | null> {
    const generation = this.generations.get(key(threadId, result.generationId));
    if (!generation || generation.applyToolCallId !== toolCallId) return null;
    this.stopGenerationHeartbeat(threadId, result.generationId);
    let effectiveResult = result;
    if (this.lifecycle) {
      const lifecycle = this.lifecycle;
      const outcome = result.status as ApplyOutcome;
      const generationId = result.generationId;
      let persisted = false;
      try {
        persisted = await this.track(() =>
          lifecycle.applyResult({
            generationId,
            outcome,
            diagnostics:
              outcome === "committed"
                ? undefined
                : { error: result.error ?? outcome },
          }),
        );
      } catch (error) {
        console.error(
          "[generation-lifecycle] apply 结果持久化失败：",
          redactForLog(error),
        );
      }
      if (!persisted) {
        // 持久层拒绝（迟到/重复/错配）：DB 保持旧状态，不创建草稿。绝不能
        // 把浏览器的局部 apply 成功继续当作用户可见的成功结果。
        console.error(
          `[generation-lifecycle] apply 结果被持久层拒绝：${generationId} ${outcome}`,
        );
        effectiveResult = {
          generationId,
          status: "failed",
          revision: result.revision,
          error: "预览未能保存，请重试。",
        };
      }
    }
    generation.applyResult = effectiveResult;
    generation.status = effectiveResult.status;
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
