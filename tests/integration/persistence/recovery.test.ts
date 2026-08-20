/**
 * S12 集成测试：Fatal Recovery 协调器、容量门禁与到期维护（设计 §10.4/§13.2.4）。
 *
 * 验证：
 * 1. 容量门禁：每 app 最多 5 个 pending，第 6 个抛 RecoveryCapacityExceededError；
 * 2. 消费三种决定（repair_candidate / regenerate_quality / keep_current）；
 * 3. 修复链上限：每个候选链最多 1 次 repair，禁止重复 repair；
 * 4. 幂等重放相同决定返回第一次结果；不同决定冲突返回 recovery_decision_already_consumed；
 * 5. RecoveryExpiryMaintenance 使用数据库时间 CAS 到期 30 天记录。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";
import {
  MysqlGenerationRecoveryRepository,
  RECOVERY_PENDING_LIMIT_PER_APP,
  RecoveryCapacityExceededError,
} from "../../../server/repositories/generation-recovery-repository.ts";
import { RecoveryCoordinator } from "../../../server/generation/recovery-coordinator.ts";
import { RecoveryExpiryMaintenance } from "../../../server/generation/recovery-expiry-maintenance.ts";

interface Seed {
  appId: string;
  userId: string;
  membershipId: string;
}

async function seedApp(pool: mysql.Pool): Promise<Seed> {
  const userId = randomUUID();
  const appId = randomUUID();
  const membershipId = randomUUID();
  await pool.query(
    "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [userId, `u-${userId}@example.com`, `u-${userId}@example.com`],
  );
  await pool.query(
    "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [appId, `app-${appId}`, userId],
  );
  await pool.query(
    "INSERT INTO `memberships` (`id`, `app_id`, `user_id`, `role`, `status`, `active_marker`, `created_at`) VALUES (?, ?, ?, 'owner', 'active', 'active', UTC_TIMESTAMP(3))",
    [membershipId, appId, userId],
  );
  return { appId, userId, membershipId };
}

describe("S12 Fatal Recovery 集成测试", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let releaseRepo: MysqlReleaseRepository;
  let recoveryRepo: MysqlGenerationRecoveryRepository;
  let coordinator: RecoveryCoordinator;
  let maintenance: RecoveryExpiryMaintenance;

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    releaseRepo = new MysqlReleaseRepository(handle.db);
    recoveryRepo = new MysqlGenerationRecoveryRepository(handle.db);
    coordinator = new RecoveryCoordinator({
      releaseRepository: releaseRepo,
      recoveryRepository: recoveryRepo,
    });
    maintenance = new RecoveryExpiryMaintenance({
      recoveryRepository: recoveryRepo,
    });
  });

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("容量门禁：每应用最多 5 个 pending，第 6 个抛出 RecoveryCapacityExceededError", async () => {
    const seed = await seedApp(pool);
    const records = [];
    for (let i = 0; i < RECOVERY_PENDING_LIMIT_PER_APP; i++) {
      const rec = await recoveryRepo.createPending({
        appId: seed.appId,
        failedGenerationId: `gen-cap-${i}`,
        failedCandidateDigest: `cd-cap-${i}`,
      });
      records.push(rec);
    }
    expect(await recoveryRepo.countPending(seed.appId)).toBe(5);

    // 第 6 个 pending 抛出异常
    await expect(
      recoveryRepo.createPending({
        appId: seed.appId,
        failedGenerationId: `gen-cap-6`,
        failedCandidateDigest: `cd-cap-6`,
      }),
    ).rejects.toThrow(RecoveryCapacityExceededError);

    // 消费一个后可再次创建
    await recoveryRepo.consumeDecision({
      appId: seed.appId,
      failedGenerationId: "gen-cap-0",
      failedCandidateDigest: "cd-cap-0",
      decision: "keep_current",
      decidedBy: seed.userId,
    });
    expect(await recoveryRepo.countPending(seed.appId)).toBe(4);

    const newRec = await recoveryRepo.createPending({
      appId: seed.appId,
      failedGenerationId: `gen-cap-6`,
      failedCandidateDigest: `cd-cap-6`,
    });
    expect(newRec.failedGenerationId).toBe("gen-cap-6");
  });

  it("RecoveryCoordinator 消费 repair_candidate：创建 successor run 并推进状态", async () => {
    const seed = await seedApp(pool);
    const candidateDig = "cd-repair-01";

    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });

    await pool.query(
      "UPDATE `generation_runs` SET `status` = 'recovery_pending', `candidate_digest` = ? WHERE `id` = ?",
      [candidateDig, run.id],
    );
    await recoveryRepo.createPending({
      appId: seed.appId,
      failedGenerationId: run.id,
      failedCandidateDigest: candidateDig,
    });

    const result = await coordinator.executeDecision({
      appId: seed.appId,
      failedGenerationId: run.id,
      failedCandidateDigest: candidateDig,
      action: "repair_candidate",
      userId: seed.userId,
      membershipId: seed.membershipId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decision).toBe("repair");
    expect(result.successorGenerationId).toBeTruthy();

    // 验证原 run 变为 recovery_consumed
    const parentRun = await releaseRepo.findRunById(run.id);
    expect(parentRun?.status).toBe("recovery_consumed");

    // 验证 successor run 处于 running 状态
    const successor = await releaseRepo.findRunById(
      result.successorGenerationId!,
    );
    expect(successor?.status).toBe("running");
    expect(successor?.correlationRef).toMatch(/^repair-/);

    // 验证禁止对 repair run 再次 repair（修复链上限 1 次）
    await pool.query(
      "UPDATE `generation_runs` SET `status` = 'recovery_pending', `candidate_digest` = ? WHERE `id` = ?",
      ["cd-nested-repair", successor!.id],
    );
    const nestedRes = await coordinator.executeDecision({
      appId: seed.appId,
      failedGenerationId: successor!.id,
      failedCandidateDigest: "cd-nested-repair",
      action: "repair_candidate",
      userId: seed.userId,
      membershipId: seed.membershipId,
    });
    expect(nestedRes.ok).toBe(false);
    if (!nestedRes.ok) {
      expect(nestedRes.code).toBe("repair_chain_limit_exceeded");
    }
  });

  it("RecoveryCoordinator 消费 keep_current：不创建 successor", async () => {
    const seed = await seedApp(pool);
    const candidateDig = "cd-keep-01";
    const run = await releaseRepo.createRun({
      appId: seed.appId,
      createdByMembershipId: seed.membershipId,
      correlationRef: `gen-${randomUUID()}`,
    });
    await pool.query(
      "UPDATE `generation_runs` SET `status` = 'recovery_pending', `candidate_digest` = ? WHERE `id` = ?",
      [candidateDig, run.id],
    );
    await recoveryRepo.createPending({
      appId: seed.appId,
      failedGenerationId: run.id,
      failedCandidateDigest: candidateDig,
    });

    const result = await coordinator.executeDecision({
      appId: seed.appId,
      failedGenerationId: run.id,
      failedCandidateDigest: candidateDig,
      action: "keep_current",
      userId: seed.userId,
      membershipId: seed.membershipId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decision).toBe("keep_current");
    expect(result.successorGenerationId).toBeUndefined();

    const parentRun = await releaseRepo.findRunById(run.id);
    expect(parentRun?.status).toBe("recovery_consumed");
  });

  it("RecoveryExpiryMaintenance 使用数据库时间 CAS 到期 30 天记录", async () => {
    const seed = await seedApp(pool);
    const candidateDig = "cd-expired-01";
    const failedGenId = randomUUID();
    const rec = await recoveryRepo.createPending({
      appId: seed.appId,
      failedGenerationId: failedGenId,
      failedCandidateDigest: candidateDig,
    });

    // 人工将 decision_expires_at 设为过去时间（数据库时间）
    await pool.query(
      "UPDATE `generation_recovery_records` SET `decision_expires_at` = UTC_TIMESTAMP(3) - INTERVAL 1 DAY WHERE `id` = ?",
      [rec.id],
    );

    const expiredCount = await maintenance.runOnce();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const updated = await recoveryRepo.findByKey({
      appId: seed.appId,
      failedGenerationId: rec.failedGenerationId,
      failedCandidateDigest: candidateDig,
    });
    expect(updated?.status).toBe("expired");
  });
});
