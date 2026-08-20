/**
 * Fatal 恢复协调器（设计 §10.4/§13.2.4，计划 S12 动作 3/4/5）。
 *
 * 核心语义：
 * 1. 每个 recovery_pending 只能被消费一次（repair_candidate / regenerate_quality / keep_current）；
 * 2. repair_candidate 创建新的 successor run（模型 xhigh、且每个候选链最多 1 次 repair）；
 * 3. regenerate_quality 从头重新生成（创建 successor run）；
 * 4. keep_current 丢弃候选并保持当前生效版本（不创建 successor）；
 * 5. 消费成功后原子将原 run 标记为 recovery_consumed；
 * 6. 重复提交相同决定幂等返回既有结果；冲突决定抛出 recovery_decision_already_consumed。
 */
import { randomUUID } from "node:crypto";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type {
  GenerationRecoveryRepository,
  RecoveryDecision,
} from "../repositories/generation-recovery-repository.ts";
import type { GenerationRecoveryRecordRow } from "../db/schema.ts";

export type RecoveryCommandAction =
  | "repair_candidate"
  | "regenerate_quality"
  | "keep_current";

export interface ExecuteRecoveryDecisionInput {
  appId: string;
  failedGenerationId: string;
  failedCandidateDigest: string;
  action: RecoveryCommandAction;
  userId: string;
  membershipId: string;
}

export type ExecuteRecoveryDecisionResult =
  | {
      ok: true;
      decision: RecoveryDecision;
      successorGenerationId?: string;
      record: GenerationRecoveryRecordRow;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

export class RecoveryCoordinator {
  private readonly releaseRepo: ReleaseRepository;
  private readonly recoveryRepo: GenerationRecoveryRepository;

  constructor(deps: {
    releaseRepository: ReleaseRepository;
    recoveryRepository: GenerationRecoveryRepository;
  }) {
    this.releaseRepo = deps.releaseRepository;
    this.recoveryRepo = deps.recoveryRepository;
  }

  /**
   * 执行恢复决定：
   * - 校验原 run 存在性与状态；
   * - repair 时校验链条上限（禁止连续多次 repair）；
   * - 创建 successor run（repair/regenerate）或保持既有（keep_current）；
   * - CAS 消费 RecoveryRecord 并将原 run 推进为 recovery_consumed。
   */
  async executeDecision(
    input: ExecuteRecoveryDecisionInput,
  ): Promise<ExecuteRecoveryDecisionResult> {
    const run =
      (await this.releaseRepo.findRunByCorrelationRef(
        input.failedGenerationId,
      )) ?? (await this.releaseRepo.findRunById(input.failedGenerationId));

    if (!run || run.appId !== input.appId) {
      return {
        ok: false,
        code: "generation_run_not_found",
        message: "GenerationRun 不存在或不属于该应用",
      };
    }

    // 检查原 run 是否已经是 repair 运行（每个候选链最多 repair 1 次）
    if (
      input.action === "repair_candidate" &&
      run.correlationRef &&
      run.correlationRef.startsWith("repair-")
    ) {
      return {
        ok: false,
        code: "repair_chain_limit_exceeded",
        message: "该候选已是修复运行结果，禁止连续再次修复（上限 1 次）",
      };
    }

    const mapActionToDecision = (
      action: RecoveryCommandAction,
    ): RecoveryDecision => {
      switch (action) {
        case "repair_candidate":
          return "repair";
        case "regenerate_quality":
          return "regenerate";
        case "keep_current":
          return "keep_current";
      }
    };
    const targetDecision = mapActionToDecision(input.action);

    // 若已经处于 recovery_consumed，幂等查找已有记录
    if (run.status === "recovery_consumed") {
      const existingRecord = await this.recoveryRepo.findByKey({
        appId: input.appId,
        failedGenerationId: input.failedGenerationId,
        failedCandidateDigest: input.failedCandidateDigest,
      });
      if (existingRecord && existingRecord.decision === targetDecision) {
        return {
          ok: true,
          decision: existingRecord.decision,
          successorGenerationId:
            existingRecord.successorGenerationId ?? undefined,
          record: existingRecord,
        };
      }
      return {
        ok: false,
        code: "recovery_decision_already_consumed",
        message: "恢复决定已被消费为不同决定",
      };
    }

    if (run.status !== "recovery_pending") {
      return {
        ok: false,
        code: "generation_run_status_invalid",
        message: `GenerationRun 状态非 recovery_pending：${run.status}`,
      };
    }

    const successorCorrelationRef =
      input.action === "repair_candidate"
        ? `repair-${randomUUID()}`
        : input.action === "regenerate_quality"
          ? `regen-${randomUUID()}`
          : undefined;
    const result = await this.releaseRepo.consumeRecoveryDecisionAtomically({
      appId: input.appId,
      failedGenerationId: input.failedGenerationId,
      failedCandidateDigest: input.failedCandidateDigest,
      decision: targetDecision,
      decidedBy: input.userId,
      createdByMembershipId: input.membershipId,
      successorCorrelationRef,
      now: new Date(),
    });
    if (!result.ok) {
      return { ok: false, code: result.code, message: result.message };
    }
    return {
      ok: true,
      decision: targetDecision,
      successorGenerationId: result.successorGenerationId ?? undefined,
      record: result.record,
    };
  }
}
