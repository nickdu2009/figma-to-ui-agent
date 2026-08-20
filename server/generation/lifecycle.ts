import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { WorkspaceRepository } from "../repositories/workspace-repository.ts";
import {
  finalizeParse,
  type ApplicationCandidate,
} from "../application-candidate.ts";
import {
  businessSchemaDigest,
  candidateDigest,
  uiBundleDigest,
  DIGEST_VERSION,
} from "../bundle/digests.ts";

/** ValidationService 的最小端口。生命周期拥有持久化与状态推进，验证实现可替换。 */
export interface GenerationValidationRunner {
  runValidation(runId: string): Promise<{
    status: "awaiting_preview" | "recovery_pending" | "failed" | "stale" | "capacity_exceeded";
  }>;
}

export type ValidatedGenerationCandidate =
  | {
      status: "awaiting_preview";
      bundle: unknown;
      candidateDigest: string;
      uiBundleDigest: string;
      reportDigest: string;
      publishBlocked: boolean;
    }
  | {
      status: "recovery_pending";
      fatalVisualIssues: unknown[];
    };

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
  /**
   * v2 唯一收尾：服务端 finalise Candidate、锁定 migration edge、推进
   * running → validation_running，并等待 ValidationService 把 run 推至
   * awaiting_preview 或 recovery_pending。浏览器 Spec 不参与此过程。
   */
  finalizeAndValidateCandidate?(input: {
    generationId: string;
    candidate: unknown;
  }): Promise<ValidatedGenerationCandidate>;
}

export class MysqlGenerationLifecycle implements GenerationLifecyclePort {
  private readonly releases: ReleaseRepository;
  private readonly workspace: WorkspaceRepository;
  private validationRunner: GenerationValidationRunner | null = null;

  constructor(releases: ReleaseRepository, workspace: WorkspaceRepository) {
    this.releases = releases;
    this.workspace = workspace;
  }

  /** 启动编排完成后注入；在没有验证器时 v2 生成 fail closed。 */
  setValidationRunner(runner: GenerationValidationRunner): void {
    this.validationRunner = runner;
  }

  async finalizeAndValidateCandidate(input: {
    generationId: string;
    candidate: unknown;
  }): Promise<ValidatedGenerationCandidate> {
    if (!this.validationRunner) {
      throw new Error("validation runner is not configured");
    }
    const run = await this.releases.findRunByCorrelationRef(input.generationId);
    if (!run) throw new Error(`GenerationRun 不存在：${input.generationId}`);

    // migrationEdge 是服务端事实：从当前 ReleasePointer 和已发布 Schema 派生，
    // 不信任模型或浏览器在 Candidate 中给出的任何 edge。
    const pointer = await this.releases.getReleasePointer(run.appId);
    const predecessor = pointer
      ? await this.releases.findPublishedVersionById(pointer.publishedVersionId)
      : null;
    if (pointer && !predecessor) {
      throw new Error("当前发布指针无效，不能生成候选");
    }
    const raw = input.candidate as Partial<ApplicationCandidate>;
    const normalized = {
      ...raw,
      migrationEdge: {
        fromPublishedVersionId: predecessor?.id ?? null,
        fromSchemaDigest: businessSchemaDigest(
          predecessor?.businessSchema ?? null,
        ),
        toSchemaDigest: businessSchemaDigest(raw.businessSchema ?? null),
      },
    };
    const parsed = finalizeParse(normalized);
    if (!parsed.ok) {
      await this.releases.markFailedFrom({
        runId: run.id,
        from: "running",
        diagnostics: { code: parsed.code, message: parsed.message },
        now: new Date(),
      });
      throw new Error(parsed.message);
    }

    const candidate = parsed.candidate;
    const cDigest = candidateDigest(candidate);
    const bundleDigest = uiBundleDigest(candidate.uiBundle);
    const marked = await this.releases.markValidationRunning({
      runId: run.id,
      candidateBundle: candidate.uiBundle,
      catalogVersion: candidate.uiBundle.catalogVersion,
      candidateDigest: cDigest,
      uiBundleDigest: bundleDigest,
      digestVersion: DIGEST_VERSION,
      migrationFromPublishedVersionId:
        candidate.migrationEdge.fromPublishedVersionId,
      migrationFromSchemaDigest: candidate.migrationEdge.fromSchemaDigest,
      migrationToSchemaDigest: candidate.migrationEdge.toSchemaDigest,
      candidateMigrationPlan: candidate.migrationPlan,
      candidateReverseMigrationPlan: candidate.reverseMigrationPlan,
      now: new Date(),
    });
    if (!marked) {
      throw new Error("GenerationRun 未能进入 validation_running");
    }

    const outcome = await this.validationRunner.runValidation(run.id);
    if (outcome.status === "capacity_exceeded") {
      // 容量不足没有推进 run；保持明确错误而非把未验证 Candidate 发给浏览器。
      throw new Error("validation_capacity_exceeded");
    }
    const completed = await this.releases.findRunById(run.id);
    if (!completed) throw new Error("Validation 后 GenerationRun 不存在");
    if (outcome.status === "awaiting_preview" && completed.status === "awaiting_preview") {
      if (
        completed.candidateBundle == null ||
        !completed.candidateDigest ||
        !completed.uiBundleDigest ||
        !completed.reportDigest
      ) {
        throw new Error("validated GenerationRun 缺少 Bundle 或 digest");
      }
      return {
        status: "awaiting_preview",
        bundle: completed.candidateBundle,
        candidateDigest: completed.candidateDigest,
        uiBundleDigest: completed.uiBundleDigest,
        reportDigest: completed.reportDigest,
        publishBlocked: Boolean(completed.publishBlocked),
      };
    }
    if (outcome.status === "recovery_pending" && completed.status === "recovery_pending") {
      return {
        status: "recovery_pending",
        fatalVisualIssues: Array.isArray(completed.fatalVisualIssues)
          ? completed.fatalVisualIssues
          : [],
      };
    }
    throw new Error(`validation 未产生可预览候选：${outcome.status}`);
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
