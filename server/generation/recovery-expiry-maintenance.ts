/**
 * Recovery 记录 30 天到期维护任务（设计 §13.2.4，计划 S12 动作 6）。
 *
 * 核心语义：
 * 1. 启动、每 15 分钟、批次上限 100 行；
 * 2. 数据库时间 CAS：pending 且 decisionExpiresAt <= UTC_TIMESTAMP(3) → expired；
 * 3. 对已到期的 RecoveryRecord，将原 GenerationRun（若仍处于 recovery_pending）
 *    条件更新为 failed（code="recovery_expired"）；
 * 4. GET / 创建 / 消费决定 / GC 前可复用 runOnce() 做即时清理。
 */
import type { GenerationRecoveryRepository } from "../repositories/generation-recovery-repository.ts";

export const DEFAULT_EXPIRY_BATCH_LIMIT = 100;
export const DEFAULT_EXPIRY_INTERVAL_MS = 15 * 60 * 1000; // 15 分钟

export class RecoveryExpiryMaintenance {
  private readonly recoveryRepo: GenerationRecoveryRepository;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(deps: {
    recoveryRepository: GenerationRecoveryRepository;
  }) {
    this.recoveryRepo = deps.recoveryRepository;
  }

  /** 执行一次到期清理（数据库时间 CAS，有界批量）。 */
  async runOnce(
    batchLimit: number = DEFAULT_EXPIRY_BATCH_LIMIT,
  ): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    try {
      const expiredCount = await this.recoveryRepo.expirePending({
        limit: batchLimit,
      });
      return expiredCount;
    } finally {
      this.isRunning = false;
    }
  }

  /** 启动后台定时维护任务。 */
  start(intervalMs: number = DEFAULT_EXPIRY_INTERVAL_MS): void {
    if (this.timer) return;
    // 启动时立即执行一次
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  /** 停止后台定时维护任务。 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
