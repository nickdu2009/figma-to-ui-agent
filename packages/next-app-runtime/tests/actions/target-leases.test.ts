import { describe, expect, it } from "vitest";

import { TargetLeaseTable } from "../../src/actions/target-leases.js";

const READ_TARGETS = {
  loadingStatePath: "/runtime/queries/q1/loading",
  resultStatePath: "/runtime/queries/q1/result",
  errorStatePath: "/runtime/queries/q1/error",
};

const OTHER_TARGETS = {
  loadingStatePath: "/runtime/queries/q2/loading",
  resultStatePath: "/runtime/queries/q2/result",
  errorStatePath: "/runtime/queries/q2/error",
};

const WRITE_TARGETS = {
  loadingStatePath: "/runtime/actions/w1/loading",
  resultStatePath: "/runtime/actions/w1/result",
  errorStatePath: "/runtime/actions/w1/error",
};

describe("Action target lease（S3）", () => {
  it("latest-wins：新 dispatch 抢占同 target，旧 lease 失去写权限且被 abort", () => {
    const table = new TargetLeaseTable();
    const first = table.acquire({
      dispatchId: "d1",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    expect(first.ok).toBe(true);
    const firstLease = first.lease;
    expect(firstLease).toBeDefined();
    expect(first.abortedDispatchIds).toEqual([]);

    const second = table.acquire({
      dispatchId: "d2",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    expect(second.ok).toBe(true);
    expect(second.abortedDispatchIds).toEqual(["d1"]);
    // 旧请求被 abort
    expect(firstLease?.controller.signal.aborted).toBe(true);
    // 旧 lease 失去写权限（迟到结果不能写状态/清 loading）
    expect(table.authority("d1")).toMatchObject({
      authorized: false,
      reason: "unknown_dispatch",
    });
    expect(table.authority("d2").authorized).toBe(true);
    // 新 lease 的 signal 未被 abort
    expect(second.lease?.controller.signal.aborted).toBe(false);
  });

  it("不同 target 可并发", () => {
    const table = new TargetLeaseTable();
    const a = table.acquire({
      dispatchId: "d1",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    const b = table.acquire({
      dispatchId: "d2",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...OTHER_TARGETS,
    });
    expect(a.ok && b.ok).toBe(true);
    expect(b.abortedDispatchIds).toEqual([]);
    expect(table.authority("d1").authorized).toBe(true);
    expect(table.authority("d2").authorized).toBe(true);
  });

  it("exclusive：pending 期间同触发器重复提交被拒绝并返回冲突 dispatchId", () => {
    const table = new TargetLeaseTable();
    const trigger = "createRecord:/runtime/actions/w1/loading";
    const first = table.acquire({
      dispatchId: "w1",
      actionName: "createRecord",
      concurrency: "exclusive",
      writeTriggerKey: trigger,
      ...WRITE_TARGETS,
    });
    expect(first.ok).toBe(true);
    const duplicate = table.acquire({
      dispatchId: "w2",
      actionName: "createRecord",
      concurrency: "exclusive",
      writeTriggerKey: trigger,
      ...WRITE_TARGETS,
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.stableCode).toBe("action_duplicate_submit");
    expect(duplicate.conflictingDispatchId).toBe("w1");

    // 终态释放后同触发器可重新提交
    table.release("w1");
    const retry = table.acquire({
      dispatchId: "w3",
      actionName: "createRecord",
      concurrency: "exclusive",
      writeTriggerKey: trigger,
      ...WRITE_TARGETS,
    });
    expect(retry.ok).toBe(true);
  });

  it("release 后 authority 为 unknown；重复 release 幂等", () => {
    const table = new TargetLeaseTable();
    const acquired = table.acquire({
      dispatchId: "d1",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    expect(acquired.ok).toBe(true);
    table.release("d1");
    table.release("d1");
    expect(table.authority("d1")).toMatchObject({
      authorized: false,
      reason: "unknown_dispatch",
    });
  });

  it("revoke：全部 lease abort、后续 acquire 拒绝、authority 判定为 revoked", () => {
    const table = new TargetLeaseTable();
    const acquired = table.acquire({
      dispatchId: "d1",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    const lease = acquired.lease;
    table.revoke();
    expect(lease?.controller.signal.aborted).toBe(true);
    expect(table.isRevoked()).toBe(true);
    const after = table.acquire({
      dispatchId: "d2",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    expect(after.ok).toBe(false);
    expect(after.stableCode).toBe("runtime_revoked");
    expect(table.authority("d1")).toMatchObject({
      authorized: false,
      reason: "revoked",
    });
  });

  it("同 dispatchId 二次 acquire 拒绝（dispatch_duplicate）", () => {
    const table = new TargetLeaseTable();
    const first = table.acquire({
      dispatchId: "same",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...READ_TARGETS,
    });
    expect(first.ok).toBe(true);
    const again = table.acquire({
      dispatchId: "same",
      actionName: "queryRecords",
      concurrency: "latest-wins",
      writeTriggerKey: null,
      ...OTHER_TARGETS,
    });
    expect(again.ok).toBe(false);
    expect(again.stableCode).toBe("dispatch_duplicate");
  });
});
