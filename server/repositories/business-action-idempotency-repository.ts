import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  businessActionIdempotency,
  type BusinessActionIdempotencyRow,
} from "../db/schema.ts";
import { isDuplicateEntry } from "./errors.ts";

/**
 * BusinessActionIdempotency Repository（设计 §13.2.6）：
 * - (appId,membershipId,canonicalActionName,idempotencyKey) 唯一；
 * - 只保存 mutation 重放结果引用（resultRef/resultDigest/stableResultCode），
 *   不保存 RecordView、CSV、表单输入或业务数据副本；
 * - claim、业务 mutation 与终态必须由同一 BusinessActionUnitOfWork 事务写入：
 *   claimInTransaction 接受调用方事务句柄，事务回滚一并移除 claim；
 * - 终态记录 24 小时后有界清理；重放前仍重新鉴权、核对 execution version。
 */
export type BusinessActionIdempotencyStatus = "pending" | "completed" | "failed";

/** 共享 UoW 事务句柄（drizzle transaction 回调参数）。 */
export type UnitOfWork = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const IDEMPOTENCY_TERMINAL_TTL_HOURS = 24;

export class IdempotencyClaimConflictError extends Error {
  readonly code = "business_action_idempotency_conflict";
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyClaimConflictError";
  }
}

export interface BusinessActionIdempotencyRepository {
  /**
   * 在调用方 UoW 事务内 claim（insert pending）。
   * 唯一键冲突时读取既有行：requestHash 相同返回既有行（重放判定交给调用方），
   * 不同 requestHash 抛 IdempotencyClaimConflictError。
   */
  claimInTransaction(
    tx: UnitOfWork,
    input: {
      appId: string;
      membershipId: string;
      canonicalActionName: string;
      idempotencyKey: string;
      protocolVersion: number;
      publishedVersionId: string | null;
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<{ row: BusinessActionIdempotencyRow; claimed: boolean }>;
  /**
   * 在同一 UoW 事务内写终态（pending → completed/failed）。
   * 只保存结果引用/摘要/稳定码。
   */
  completeInTransaction(
    tx: UnitOfWork,
    input: {
      id: string;
      status: "completed" | "failed";
      resultRef?: string;
      resultDigest?: string;
      stableResultCode: string;
    },
  ): Promise<boolean>;
  /** 重放查找（重新鉴权与 execution version 核对由调用方负责）。 */
  findByKey(input: {
    appId: string;
    membershipId: string;
    canonicalActionName: string;
    idempotencyKey: string;
  }): Promise<BusinessActionIdempotencyRow | null>;
  /** 终态 24 小时后有界清理；返回删除行数。 */
  pruneExpired(input: { limit: number }): Promise<number>;
}

export class MysqlBusinessActionIdempotencyRepository
  implements BusinessActionIdempotencyRepository
{
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  async claimInTransaction(
    tx: UnitOfWork,
    input: {
      appId: string;
      membershipId: string;
      canonicalActionName: string;
      idempotencyKey: string;
      protocolVersion: number;
      publishedVersionId: string | null;
      requestHash: string;
      expiresAt: Date;
    },
  ): Promise<{ row: BusinessActionIdempotencyRow; claimed: boolean }> {
    const row: BusinessActionIdempotencyRow = {
      id: randomUUID(),
      appId: input.appId,
      membershipId: input.membershipId,
      canonicalActionName: input.canonicalActionName,
      idempotencyKey: input.idempotencyKey,
      protocolVersion: input.protocolVersion,
      publishedVersionId: input.publishedVersionId,
      requestHash: input.requestHash,
      status: "pending",
      resultRef: null,
      resultDigest: null,
      stableResultCode: null,
      createdAt: new Date(),
      completedAt: null,
      expiresAt: input.expiresAt,
    };
    try {
      await tx.insert(businessActionIdempotency).values(row);
      return { row, claimed: true };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const existing = await this.findByKey(input);
        if (!existing) throw error;
        if (existing.requestHash !== input.requestHash) {
          throw new IdempotencyClaimConflictError(
            "同一幂等键的 requestHash 不一致（business_action_idempotency_conflict）",
          );
        }
        return { row: existing, claimed: false };
      }
      throw error;
    }
  }

  async completeInTransaction(
    tx: UnitOfWork,
    input: {
      id: string;
      status: "completed" | "failed";
      resultRef?: string;
      resultDigest?: string;
      stableResultCode: string;
    },
  ): Promise<boolean> {
    if (input.stableResultCode.length > 64) {
      throw new Error("stableResultCode 必须有界（≤64 字符）");
    }
    const [result] = await tx
      .update(businessActionIdempotency)
      .set({
        status: input.status,
        resultRef: input.resultRef ?? null,
        resultDigest: input.resultDigest ?? null,
        stableResultCode: input.stableResultCode,
        completedAt: sql`UTC_TIMESTAMP(3)`,
      })
      .where(
        and(
          eq(businessActionIdempotency.id, input.id),
          eq(businessActionIdempotency.status, "pending"),
        ),
      );
    return result.affectedRows === 1;
  }

  async findByKey(input: {
    appId: string;
    membershipId: string;
    canonicalActionName: string;
    idempotencyKey: string;
  }): Promise<BusinessActionIdempotencyRow | null> {
    const rows = await this.db
      .select()
      .from(businessActionIdempotency)
      .where(
        and(
          eq(businessActionIdempotency.appId, input.appId),
          eq(businessActionIdempotency.membershipId, input.membershipId),
          eq(
            businessActionIdempotency.canonicalActionName,
            input.canonicalActionName,
          ),
          eq(businessActionIdempotency.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async pruneExpired(input: { limit: number }): Promise<number> {
    const candidates = await this.db
      .select({ id: businessActionIdempotency.id })
      .from(businessActionIdempotency)
      .where(lt(businessActionIdempotency.expiresAt, sql`UTC_TIMESTAMP(3)`))
      .limit(input.limit);
    let pruned = 0;
    for (const candidate of candidates) {
      const [result] = await this.db
        .delete(businessActionIdempotency)
        .where(
          and(
            eq(businessActionIdempotency.id, candidate.id),
            lt(businessActionIdempotency.expiresAt, sql`UTC_TIMESTAMP(3)`),
          ),
        );
      pruned += result.affectedRows;
    }
    return pruned;
  }
}
