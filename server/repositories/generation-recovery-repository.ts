import { randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  generationRecoveryRecords,
  generationRuns,
  type GenerationRecoveryRecordRow,
} from "../db/schema.ts";
import { isDuplicateEntry } from "./errors.ts";

/**
 * GenerationRecoveryRecord Repository（设计 §13.2.4/§10.4）：
 * - (appId,failedGenerationId,failedCandidateDigest) 唯一；
 * - pending → consumed|expired 与原 GenerationRun 的
 *   recovery_pending → recovery_consumed 同一事务（调用方组合 UoW）；
 * - 决定竞争与到期任务只能有一个 CAS 获胜：全部条件更新 + 数据库时间；
 * - 相同决定重放返回第一次结果；不同决定竞争返回
 *   recovery_decision_already_consumed；
 * - pending 上限每 app 5 个，30 天 decisionExpiresAt。
 */
export type RecoveryDecision = "repair" | "regenerate" | "keep_current";
export type RecoveryRecordStatus = "pending" | "consumed" | "expired";

export const RECOVERY_PENDING_LIMIT_PER_APP = 5;
export const RECOVERY_DECISION_TTL_DAYS = 30;

export const RECOVERY_DECISION_ALREADY_CONSUMED =
  "recovery_decision_already_consumed" as const;
export const RECOVERY_CAPACITY_EXCEEDED = "recovery_capacity_exceeded" as const;

export class RecoveryDecisionConsumedError extends Error {
  readonly code = RECOVERY_DECISION_ALREADY_CONSUMED;
  constructor() {
    super("恢复决定已被消费或已过期（recovery_decision_already_consumed）");
    this.name = "RecoveryDecisionConsumedError";
  }
}

export class RecoveryCapacityExceededError extends Error {
  readonly code = RECOVERY_CAPACITY_EXCEEDED;
  constructor() {
    super("每应用 pending 恢复记录已达上限（recovery_capacity_exceeded）");
    this.name = "RecoveryCapacityExceededError";
  }
}

export interface GenerationRecoveryRepository {
  /**
   * 创建 pending RecoveryRecord（同事务由调用方推进原 run）。
   * 唯一键冲突（同 app+run+digest 已存在）返回既有行（幂等重放）。
   * 每 app pending 达到 5 个时抛 RecoveryCapacityExceededError。
   */
  createPending(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
  }): Promise<GenerationRecoveryRecordRow>;
  findByKey(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
  }): Promise<GenerationRecoveryRecordRow | null>;
  /**
   * 消费决定（CAS：pending 且未到期 → consumed）：
   * - repair/regenerate 必须绑定 successorGenerationId；
   * - keep_current 不创建 successor；
   * - 重放相同决定返回第一次结果；不同决定/已过期抛
   *   RecoveryDecisionConsumedError。
   */
  consumeDecision(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
    decision: RecoveryDecision;
    decidedBy: string;
    successorGenerationId?: string;
  }): Promise<GenerationRecoveryRecordRow>;
  /**
   * 到期物化（RecoveryExpiryMaintenance）：数据库时间 CAS，
   * pending 且 decisionExpiresAt <= UTC_TIMESTAMP(3) → expired。
   * 返回物化行数（有界批量）。
   */
  expirePending(input: { limit: number }): Promise<number>;
  /** 按 app 统计 pending 数（容量门禁）。 */
  countPending(appId: string): Promise<number>;
}

export class MysqlGenerationRecoveryRepository
  implements GenerationRecoveryRepository
{
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async createPending(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
  }): Promise<GenerationRecoveryRecordRow> {
    const pending = await this.countPending(input.appId);
    if (pending >= RECOVERY_PENDING_LIMIT_PER_APP) {
      throw new RecoveryCapacityExceededError();
    }
    const row: GenerationRecoveryRecordRow = {
      id: randomUUID(),
      appId: input.appId,
      failedGenerationId: input.failedGenerationId,
      failedCandidateDigest: input.failedCandidateDigest,
      status: "pending",
      decision: null,
      decidedBy: null,
      decidedAt: null,
      decisionExpiresAt: new Date(
        Date.now() + RECOVERY_DECISION_TTL_DAYS * 24 * 60 * 60 * 1000,
      ),
      expiredAt: null,
      successorGenerationId: null,
      stableResultCode: null,
      createdAt: new Date(),
      revision: 1,
    };
    try {
      await this.db.insert(generationRecoveryRecords).values(row);
      return row;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const existing = await this.findByKey(input);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findByKey(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
  }): Promise<GenerationRecoveryRecordRow | null> {
    const rows = await this.db
      .select()
      .from(generationRecoveryRecords)
      .where(
        and(
          eq(generationRecoveryRecords.appId, input.appId),
          eq(
            generationRecoveryRecords.failedGenerationId,
            input.failedGenerationId,
          ),
          eq(
            generationRecoveryRecords.failedCandidateDigest,
            input.failedCandidateDigest,
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async consumeDecision(input: {
    appId: string;
    failedGenerationId: string;
    failedCandidateDigest: string;
    decision: RecoveryDecision;
    decidedBy: string;
    successorGenerationId?: string;
  }): Promise<GenerationRecoveryRecordRow> {
    if (
      (input.decision === "repair" || input.decision === "regenerate") &&
      !input.successorGenerationId
    ) {
      throw new Error("repair/regenerate 必须绑定 successorGenerationId");
    }
    if (input.decision === "keep_current" && input.successorGenerationId) {
      throw new Error("keep_current 不创建 successor");
    }
    // CAS：只有 pending 且未到期（数据库时间）可被消费
    const [result] = await this.db
      .update(generationRecoveryRecords)
      .set({
        status: "consumed",
        decision: input.decision,
        decidedBy: input.decidedBy,
        decidedAt: sql`UTC_TIMESTAMP(3)`,
        successorGenerationId: input.successorGenerationId ?? null,
        revision: sql`revision + 1`,
      })
      .where(
        and(
          eq(generationRecoveryRecords.appId, input.appId),
          eq(
            generationRecoveryRecords.failedGenerationId,
            input.failedGenerationId,
          ),
          eq(
            generationRecoveryRecords.failedCandidateDigest,
            input.failedCandidateDigest,
          ),
          eq(generationRecoveryRecords.status, "pending"),
          sql`${generationRecoveryRecords.decisionExpiresAt} > UTC_TIMESTAMP(3)`,
        ),
      );
    const current = await this.findByKey(input);
    if (result.affectedRows === 1) {
      if (!current) throw new Error("RecoveryRecord 消费后读取失败");
      return current;
    }
    // CAS 未命中：已 consumed/expired 或已到期——相同决定重放返回第一次结果
    if (
      current &&
      current.status === "consumed" &&
      current.decision === input.decision &&
      (current.successorGenerationId ?? null) ===
        (input.successorGenerationId ?? null)
    ) {
      return current;
    }
    throw new RecoveryDecisionConsumedError();
  }

  async expirePending(input: { limit: number }): Promise<number> {
    // 有界批量：先按数据库时间取候选 id，再逐行 CAS（只有一个获胜者）
    const candidates = await this.db
      .select({
        id: generationRecoveryRecords.id,
        failedGenerationId: generationRecoveryRecords.failedGenerationId,
      })
      .from(generationRecoveryRecords)
      .where(
        and(
          eq(generationRecoveryRecords.status, "pending"),
          lte(generationRecoveryRecords.decisionExpiresAt, sql`UTC_TIMESTAMP(3)`),
        ),
      )
      .limit(input.limit);
    let expired = 0;
    for (const candidate of candidates) {
      const didExpire = await this.db.transaction(async (tx) => {
        const [result] = await tx
          .update(generationRecoveryRecords)
          .set({
            status: "expired",
            expiredAt: sql`UTC_TIMESTAMP(3)`,
            revision: sql`revision + 1`,
          })
          .where(
            and(
              eq(generationRecoveryRecords.id, candidate.id),
              eq(generationRecoveryRecords.status, "pending"),
              lte(
                generationRecoveryRecords.decisionExpiresAt,
                sql`UTC_TIMESTAMP(3)`,
              ),
            ),
          );
        if (result.affectedRows !== 1) return false;
        // 同一事务物化原 run 的终态，避免 Record 已 expired 但 run 仍可被
        // 恢复命令消费的双事实窗口。
        await tx
          .update(generationRuns)
          .set({
            status: "failed",
            diagnostics: sql`JSON_OBJECT('code', 'recovery_expired')`,
            updatedAt: sql`UTC_TIMESTAMP(3)`,
          })
          .where(
            and(
              eq(generationRuns.id, candidate.failedGenerationId),
              eq(generationRuns.status, "recovery_pending"),
            ),
          );
        return true;
      });
      expired += didExpire ? 1 : 0;
    }
    return expired;
  }

  async countPending(appId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(generationRecoveryRecords)
      .where(
        and(
          eq(generationRecoveryRecords.appId, appId),
          eq(generationRecoveryRecords.status, "pending"),
        ),
      );
    return rows[0]?.count ?? 0;
  }
}
