import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { WorkspaceRepository } from "../repositories/workspace-repository.ts";

/**
 * 生成生命周期持久层端口（计划 S3、设计 §4.2）：
 * 持久层是 GenerationRun / 问卷 / 草稿的唯一事实 owner；
 * GenerationCoordinator 仅为按 stream 关联器。
 *
 * 所有状态推进均为条件更新：迟到、重复或错配的结果返回失败，
 * 由调用方 fail-closed（不创建草稿、不推进状态）。
 */

export type ApplyOutcome = "committed" | "failed" | "aborted";

export interface GenerationLifecyclePort {
  /** 生成开始：创建 running 状态的 GenerationRun（correlationRef = generationId）。 */
  startRun(input: {
    appId: string;
    membershipId: string;
    generationId: string;
  }): Promise<void>;
  /** 持久化服务端签发的问卷（重启后可读，AC2）。 */
  persistQuestion(input: {
    appId: string;
    generationId: string | null;
    questionSetId: string;
    payload: unknown;
  }): Promise<void>;
  /** 记录答案并推进问卷 open → answered（条件更新）。 */
  recordAnswer(input: {
    questionSetId: string;
    answerPayload: unknown;
  }): Promise<void>;
  /** 原子消费已回答问卷（answered → consumed）；重复消费返回 null。 */
  consumeApprovedPlan(questionSetId: string): Promise<unknown | null>;
  /** running → awaiting_preview：保存完整候选 Spec 与有界诊断。 */
  markAwaitingPreview(input: {
    generationId: string;
    candidateSpec: unknown;
    candidateBusinessSchema: unknown;
    diagnostics: unknown;
  }): Promise<boolean>;
  /**
   * 浏览器 apply 结果（与 generationId 关联）：
   * - committed：原子创建 DraftVersion 并把 run 转为 succeeded；
   * - failed / aborted：run 转为 failed 并保存有界诊断；
   * - 迟到/重复/错配：返回 false（fail-closed，不产生任何写入）。
   */
  applyResult(input: {
    generationId: string;
    outcome: ApplyOutcome;
    diagnostics?: unknown;
  }): Promise<boolean>;
  /** 生成器流失败：run 转为 failed（有界诊断）。 */
  markFailed(input: {
    generationId: string;
    diagnostics: unknown;
  }): Promise<void>;
  /** 浏览器心跳续约（仅开放状态有效）。 */
  heartbeat(input: { generationId: string }): Promise<boolean>;
  /** 显式中止（断流/页面卸载）：开放状态 → incomplete。 */
  abortRun(input: { generationId: string }): Promise<boolean>;
  /** 启动扫描：所有开放 run 原子标记 incomplete（不恢复、不重放）。 */
  sweepOrphanRuns(): Promise<number>;
  /** 周期扫描：心跳超时的开放 run 标记 incomplete（有界、幂等）。 */
  sweepStaleRuns(staleBefore: Date): Promise<number>;
}

export class MysqlGenerationLifecycle implements GenerationLifecyclePort {
  private readonly releases: ReleaseRepository;
  private readonly workspace: WorkspaceRepository;

  constructor(releases: ReleaseRepository, workspace: WorkspaceRepository) {
    this.releases = releases;
    this.workspace = workspace;
  }

  async startRun(input: {
    appId: string;
    membershipId: string;
    generationId: string;
  }): Promise<void> {
    await this.releases.createRun({
      appId: input.appId,
      createdByMembershipId: input.membershipId,
      correlationRef: input.generationId,
    });
  }

  async persistQuestion(input: {
    appId: string;
    generationId: string | null;
    questionSetId: string;
    payload: unknown;
  }): Promise<void> {
    let generationRunId: string | null = null;
    if (input.generationId) {
      const run = await this.releases.findRunByCorrelationRef(
        input.generationId,
      );
      generationRunId = run?.id ?? null;
    }
    await this.workspace.createQuestionSet({
      appId: input.appId,
      generationRunId,
      correlationRef: input.questionSetId,
      payload: input.payload,
      status: "open",
    });
  }

  async recordAnswer(input: {
    questionSetId: string;
    answerPayload: unknown;
  }): Promise<void> {
    const set = await this.workspace.findQuestionSetByCorrelationRef(
      input.questionSetId,
    );
    if (!set) {
      throw new Error(`问卷不存在：${input.questionSetId}`);
    }
    await this.workspace.recordAnswerAndMarkAnswered({
      questionSetId: set.id,
      answerPayload: input.answerPayload,
    });
  }

  async consumeApprovedPlan(questionSetId: string): Promise<unknown | null> {
    const payload =
      await this.workspace.consumeAnsweredQuestionSet(questionSetId);
    if (payload === null || typeof payload !== "object") return null;
    return (payload as { plan?: unknown }).plan ?? null;
  }

  async markAwaitingPreview(input: {
    generationId: string;
    candidateSpec: unknown;
    candidateBusinessSchema: unknown;
    diagnostics: unknown;
  }): Promise<boolean> {
    const run = await this.releases.findRunByCorrelationRef(input.generationId);
    if (!run) {
      throw new Error(`GenerationRun 不存在：${input.generationId}`);
    }
    return this.releases.markAwaitingPreview({
      runId: run.id,
      candidateSpec: input.candidateSpec,
      candidateBusinessSchema: input.candidateBusinessSchema,
      diagnostics: input.diagnostics,
      now: new Date(),
    });
  }

  async applyResult(input: {
    generationId: string;
    outcome: ApplyOutcome;
    diagnostics?: unknown;
  }): Promise<boolean> {
    const run = await this.releases.findRunByCorrelationRef(input.generationId);
    if (!run) return false;
    const now = new Date();
    if (input.outcome === "committed") {
      const result = await this.releases.createDraftAndMarkSucceeded({
        runId: run.id,
        now,
      });
      return result !== null;
    }
    return this.releases.markFailed({
      runId: run.id,
      diagnostics: input.diagnostics ?? { outcome: input.outcome },
      now,
    });
  }

  async markFailed(input: {
    generationId: string;
    diagnostics: unknown;
  }): Promise<void> {
    const run = await this.releases.findRunByCorrelationRef(input.generationId);
    if (!run) return;
    await this.releases.markFailed({
      runId: run.id,
      diagnostics: input.diagnostics,
      now: new Date(),
    });
  }

  async heartbeat(input: { generationId: string }): Promise<boolean> {
    const run = await this.releases.findRunByCorrelationRef(input.generationId);
    if (!run) return false;
    return this.releases.heartbeatRun({ runId: run.id, now: new Date() });
  }

  async abortRun(input: { generationId: string }): Promise<boolean> {
    const run = await this.releases.findRunByCorrelationRef(input.generationId);
    if (!run) return false;
    return this.releases.markIncomplete({ runId: run.id, now: new Date() });
  }

  async sweepOrphanRuns(): Promise<number> {
    return this.releases.markAllOpenIncomplete({ now: new Date() });
  }

  async sweepStaleRuns(staleBefore: Date): Promise<number> {
    return this.releases.markStaleIncomplete({
      staleBefore,
      now: new Date(),
    });
  }
}
