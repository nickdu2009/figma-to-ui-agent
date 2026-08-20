/**
 * Action target lease（设计 §9.2，计划 S3）：
 * - 每次按精确 result/loading/error 目标建立租约；读操作 latest-wins：
 *   同一 target 新 dispatch abort 旧请求，迟到结果无写权限；
 * - 不同 target 可并发；loading 由 lease owner 清除；
 * - 写操作 exclusive：pending 期间同一触发器重复提交被拒绝；
 * - 迟到/重复/被抢占的终态归一化为无写权限的稳定判定。
 */

export interface TargetLease {
  readonly dispatchId: string;
  readonly actionName: string;
  readonly loadingStatePath: string;
  readonly resultStatePath: string | null;
  readonly errorStatePath: string | null;
  readonly concurrency: "latest-wins" | "exclusive";
  readonly controller: AbortController;
}

export interface LeaseAcquisition {
  ok: boolean;
  /** ok=false 时的稳定错误码。 */
  stableCode?: string;
  /** exclusive 冲突时返回现有 pending dispatchId（显式重试用）。 */
  conflictingDispatchId?: string;
  /** latest-wins 抢占时被 abort 的旧 dispatchId 集合。 */
  abortedDispatchIds: string[];
  lease?: TargetLease;
}

/** lease 有效性判定（终态提交前唯一判定入口）。 */
export type LeaseAuthority =
  | { authorized: true; lease: TargetLease }
  | { authorized: false; reason: "lease_lost" | "unknown_dispatch" | "revoked" };

const MAX_TRACKED_DISPATCHES = 512;

export class TargetLeaseTable {
  private readonly leasesByDispatch = new Map<string, TargetLease>();
  private readonly dispatchByTarget = new Map<string, string>();
  private readonly pendingWriteTriggers = new Map<string, string>();
  private revoked = false;

  /** 结果/加载/错误三类 target 的并集键（仅对可写目标做唯一性约束）。 */
  private static targetKeys(lease: {
    loadingStatePath: string;
    resultStatePath: string | null;
    errorStatePath: string | null;
  }): string[] {
    const keys = [lease.loadingStatePath];
    if (lease.resultStatePath) keys.push(lease.resultStatePath);
    if (lease.errorStatePath) keys.push(lease.errorStatePath);
    return keys;
  }

  /**
   * 建立租约：
   * - latest-wins：同 target 旧 lease 被 abort 并移除；
   * - exclusive：同 trigger 已 pending → 拒绝并返回冲突信息；
   * - revoked 后一律拒绝。
   */
  acquire(input: {
    dispatchId: string;
    actionName: string;
    concurrency: "latest-wins" | "exclusive";
    /** 写操作去重键（业务动作名 + 触发器 target 集合）。 */
    writeTriggerKey: string | null;
    loadingStatePath: string;
    resultStatePath: string | null;
    errorStatePath: string | null;
  }): LeaseAcquisition {
    if (this.revoked) {
      return { ok: false, stableCode: "runtime_revoked", abortedDispatchIds: [] };
    }
    if (this.leasesByDispatch.has(input.dispatchId)) {
      return { ok: false, stableCode: "dispatch_duplicate", abortedDispatchIds: [] };
    }
    const abortedDispatchIds: string[] = [];
    if (input.concurrency === "latest-wins") {
      for (const key of TargetLeaseTable.targetKeys(input)) {
        const existingId = this.dispatchByTarget.get(key);
        if (!existingId) continue;
        const existing = this.leasesByDispatch.get(existingId);
        if (existing) {
          existing.controller.abort();
          this.remove(existing);
          abortedDispatchIds.push(existingId);
        }
      }
    } else if (input.writeTriggerKey) {
      const existingId = this.pendingWriteTriggers.get(input.writeTriggerKey);
      if (existingId && this.leasesByDispatch.has(existingId)) {
        return {
          ok: false,
          stableCode: "action_duplicate_submit",
          conflictingDispatchId: existingId,
          abortedDispatchIds: [],
        };
      }
    }
    const lease: TargetLease = Object.freeze({
      dispatchId: input.dispatchId,
      actionName: input.actionName,
      loadingStatePath: input.loadingStatePath,
      resultStatePath: input.resultStatePath,
      errorStatePath: input.errorStatePath,
      concurrency: input.concurrency,
      controller: new AbortController(),
    });
    this.leasesByDispatch.set(input.dispatchId, lease);
    for (const key of TargetLeaseTable.targetKeys(lease)) {
      this.dispatchByTarget.set(key, input.dispatchId);
    }
    if (input.concurrency === "exclusive" && input.writeTriggerKey) {
      this.pendingWriteTriggers.set(input.writeTriggerKey, input.dispatchId);
    }
    this.evictOverflow();
    return { ok: true, abortedDispatchIds, lease };
  }

  /** 终态提交前的权限判定：仍持有全部 target 的租约才 authorized。 */
  authority(dispatchId: string): LeaseAuthority {
    if (this.revoked) return { authorized: false, reason: "revoked" };
    const lease = this.leasesByDispatch.get(dispatchId);
    if (!lease) return { authorized: false, reason: "unknown_dispatch" };
    for (const key of TargetLeaseTable.targetKeys(lease)) {
      if (this.dispatchByTarget.get(key) !== dispatchId) {
        return { authorized: false, reason: "lease_lost" };
      }
    }
    return { authorized: true, lease };
  }

  /** 终态后释放租约（幂等）。 */
  release(dispatchId: string): void {
    const lease = this.leasesByDispatch.get(dispatchId);
    if (!lease) return;
    this.remove(lease);
  }

  /** revoke：全部 abort 并清空（dispose/swap 时调用）。 */
  revoke(): void {
    this.revoked = true;
    for (const lease of this.leasesByDispatch.values()) {
      try {
        lease.controller.abort();
      } catch {
        // Continue releasing all leases.
      }
    }
    this.leasesByDispatch.clear();
    this.dispatchByTarget.clear();
    this.pendingWriteTriggers.clear();
  }

  isRevoked(): boolean {
    return this.revoked;
  }

  private remove(lease: TargetLease): void {
    this.leasesByDispatch.delete(lease.dispatchId);
    for (const key of TargetLeaseTable.targetKeys(lease)) {
      if (this.dispatchByTarget.get(key) === lease.dispatchId) {
        this.dispatchByTarget.delete(key);
      }
    }
    for (const [trigger, dispatchId] of this.pendingWriteTriggers) {
      if (dispatchId === lease.dispatchId) {
        this.pendingWriteTriggers.delete(trigger);
      }
    }
  }

  private evictOverflow(): void {
    while (this.leasesByDispatch.size > MAX_TRACKED_DISPATCHES) {
      const oldest = this.leasesByDispatch.keys().next().value;
      if (oldest === undefined) break;
      const lease = this.leasesByDispatch.get(oldest);
      if (lease) {
        lease.controller.abort();
        this.remove(lease);
      }
    }
  }
}
