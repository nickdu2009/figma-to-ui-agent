/**
 * S3：RuntimeActionDispatcher 单执行边界与单终态语义（计划 S3 验证）。
 * 故障注入矩阵：abort、迟到、重复 resolve/reject、revoked gate、
 * callback 失败、target 被新 lease 占用、非法终态、写去重、幂等重试。
 */
import { describe, expect, it, vi } from "vitest";

import { createRuntimeActionDispatcher } from "../../src/actions/dispatcher.js";
import { ActionExecutionGate } from "../../src/actions/execution-gate.js";
import type {
  RuntimeActionAdapter,
  RuntimeActionContract,
  RuntimeActionHandler,
  RuntimeActionIdentity,
  RuntimeActionResult,
  RuntimeActionTargets,
  RuntimeHostEffects,
  StateStoreLike,
} from "../../src/actions/contracts.js";
import { createPrototypeSafeStateStore } from "../../src/react/prototype-safe-state-store.js";

const identity: RuntimeActionIdentity = {
  appId: "app-1",
  candidateDigest: "sha256:abc",
  bundleRevision: 1,
};

const READ_TARGETS = {
  loadingStatePath: "/runtime/queries/q1/loading",
  resultStatePath: "/runtime/queries/q1/result",
  errorStatePath: "/runtime/queries/q1/error",
};

const WRITE_TARGETS = {
  loadingStatePath: "/runtime/actions/w1/loading",
  resultStatePath: "/runtime/actions/w1/result",
  errorStatePath: "/runtime/actions/w1/error",
};

function makeContract(input: {
  permissionClass: RuntimeActionContract["permissionClass"];
  concurrency: "latest-wins" | "exclusive";
  resultPathRequired?: boolean;
  onSuccess?: RuntimeActionContract["onSuccess"];
  onError?: RuntimeActionContract["onError"];
}): RuntimeActionContract {
  return {
    validateParams: (params: unknown) => {
      if (typeof params !== "object" || params === null) {
        return { ok: false, code: "action_params_invalid" as const };
      }
      return { ok: true, value: params as Record<string, unknown> };
    },
    validateTargets: (targets: unknown) => {
      if (typeof targets !== "object" || targets === null) {
        return { ok: false, code: "action_targets_invalid" as const };
      }
      const candidate = targets as Record<string, unknown>;
      if (typeof candidate.loadingStatePath !== "string") {
        return { ok: false, code: "action_targets_invalid" as const };
      }
      if (input.resultPathRequired && typeof candidate.resultStatePath !== "string") {
        return { ok: false, code: "action_targets_invalid" as const };
      }
      return { ok: true, value: candidate as unknown as RuntimeActionTargets };
    },
    permissionClass: input.permissionClass,
    concurrency: input.concurrency,
    ...(input.onSuccess ? { onSuccess: input.onSuccess } : {}),
    ...(input.onError ? { onError: input.onError } : {}),
  };
}

function makeHostEffects() {
  return {
    platformUi: {
      navigate: vi.fn(),
      openDialog: vi.fn(),
      closeDialog: vi.fn(),
      showToast: vi.fn(),
    },
  } satisfies RuntimeHostEffects;
}

/** 记录每次 update 调用（验证原子 batch：单次通知提交 loading+result）。 */
function makeRecordingStore(): StateStoreLike & {
  updates: Array<Record<string, unknown>>;
  store: ReturnType<typeof createPrototypeSafeStateStore>;
} {
  const store = createPrototypeSafeStateStore({});
  const updates: Array<Record<string, unknown>> = [];
  let notifyCount = 0;
  const listeners = new Set<() => void>();
  return {
    updates,
    store,
    get(path: string) {
      return store.get(path);
    },
    update(updates_: Record<string, unknown>) {
      updates.push(structuredClone(updates_));
      store.update(updates_);
      notifyCount += 1;
      for (const listener of listeners) listener();
    },
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function success(dispatchId: string, data: unknown): RuntimeActionResult {
  return { status: "success", dispatchId, serverRequestId: "srv-1", data };
}

function errorTerminal(dispatchId: string, code: string): RuntimeActionResult {
  return { status: "error", dispatchId, error: { code, message: code } };
}

describe("RuntimeActionDispatcher（S3）", () => {
  it("快乐路径：loading 批量写入 → 单终态原子提交 → 静态回调一次", async () => {
    const effects = makeHostEffects();
    const handler = vi.fn(
      async ({ dispatchId }: { dispatchId: string }) =>
        success(dispatchId, { items: [] }),
    );
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: { queryRecords: handler as unknown as RuntimeActionHandler },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
          resultPathRequired: true,
          onSuccess: { kind: "showToast", variant: "success", title: "OK" },
        }),
      },
      hostEffects: effects,
    };
    const gate = new ActionExecutionGate("published", identity);
    const dispatcher = createRuntimeActionDispatcher({ adapter, gate });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    const result = await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { collectionKey: "customers", targets: READ_TARGETS },
      identity,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    // loading 与终态分别各一次 update；终态 batch 同时清除 loading 并写 result
    expect(recording.updates).toEqual([
      { [READ_TARGETS.loadingStatePath]: true },
      {
        [READ_TARGETS.loadingStatePath]: false,
        [READ_TARGETS.resultStatePath]: { items: [] },
      },
    ]);
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBe(false);
    expect(recording.store.get(READ_TARGETS.resultStatePath)).toEqual({ items: [] });
    // 静态回调执行一次（navigate 类外的 showToast）
    expect(effects.platformUi.showToast).toHaveBeenCalledTimes(1);
    expect(result.idempotencyKey).toBeNull();
    expect(result.dispatchId).toMatch(/^dispatch_/);
  });

  it("handler throw：归一化为有界 error 终态 + onError 一次", async () => {
    const effects = makeHostEffects();
    const handler = vi.fn(async () => {
      throw Object.assign(new Error("secret stack"), { code: "network_error" });
    });
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: { queryRecords: handler as unknown as RuntimeActionHandler },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
          onError: { kind: "showToast", variant: "error", title: "失败" },
        }),
      },
      hostEffects: effects,
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });

    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBe(false);
    expect(recording.store.get(READ_TARGETS.errorStatePath)).toEqual({
      code: "network_error",
      message: "secret stack",
    });
    expect(recording.store.get(READ_TARGETS.resultStatePath)).toBeUndefined();
    expect(effects.platformUi.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", title: "失败" }),
    );
  });

  it("非法终态（错 dispatchId/非法形状）：归一化为 action_result_invalid", async () => {
    for (const terminal of [
      success("wrong-dispatch-id", {}),
      { status: "success", dispatchId: "stub" } as unknown as RuntimeActionResult,
      null as unknown as RuntimeActionResult,
    ]) {
      const adapter: RuntimeActionAdapter = {
        protocolVersion: 1,
        handlers: {
          queryRecords: (async () =>
            terminal as RuntimeActionResult) as unknown as RuntimeActionHandler,
        },
        contracts: {
          queryRecords: makeContract({
            permissionClass: "record-read",
            concurrency: "latest-wins",
          }),
        },
        hostEffects: makeHostEffects(),
      };
      const dispatcher = createRuntimeActionDispatcher({
        adapter,
        gate: new ActionExecutionGate("published", identity),
      });
      const recording = makeRecordingStore();
      dispatcher.setActiveStateStore(recording);
      await dispatcher.dispatchCustomAction({
        actionName: "queryRecords",
        params: { targets: READ_TARGETS },
        identity,
      });
      expect(recording.store.get(READ_TARGETS.errorStatePath)).toMatchObject({
        code: "action_result_invalid",
      });
    }
  });

  it("latest-wins 迟到：旧请求结果不写状态、不清新 loading、不回调", async () => {
    const effects = makeHostEffects();
    const firstTerminal = deferred<RuntimeActionResult>();
    const secondTerminal = deferred<RuntimeActionResult>();
    const gate = new ActionExecutionGate("published", identity);
    const seenSignals: AbortSignal[] = [];
    const seenDispatchIds: string[] = [];
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async (input: { dispatchId: string; signal: AbortSignal }) => {
          seenSignals.push(input.signal);
          seenDispatchIds.push(input.dispatchId);
          return seenDispatchIds.length === 1
            ? firstTerminal.promise
            : secondTerminal.promise;
        }) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
          resultPathRequired: true,
          onSuccess: { kind: "showToast", variant: "success", title: "OK" },
        }),
      },
      hostEffects: effects,
    };
    const dispatcher = createRuntimeActionDispatcher({ adapter, gate });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    const first = dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });
    const second = dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });

    // 新 dispatch 抢占后旧 signal abort
    expect(seenSignals[0]?.aborted).toBe(true);
    expect(seenSignals[1]?.aborted).toBe(false);

    // 迟到旧结果到达：无写权限
    firstTerminal.resolve(success(seenDispatchIds[0] ?? "", { stale: true }));
    await first;
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBe(true);
    expect(recording.store.get(READ_TARGETS.resultStatePath)).toBeUndefined();
    expect(effects.platformUi.showToast).not.toHaveBeenCalled();

    // 新结果正常提交
    secondTerminal.resolve(success(seenDispatchIds[1] ?? "", { fresh: true }));
    await second;
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBe(false);
    expect(recording.store.get(READ_TARGETS.resultStatePath)).toEqual({ fresh: true });
    expect(effects.platformUi.showToast).toHaveBeenCalledTimes(1);
  });

  it("revoked gate：在途终态不提交、新 dispatch 写入 gate_revoked 错误", async () => {
    const effects = makeHostEffects();
    const terminal = deferred<RuntimeActionResult>();
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async (input: { dispatchId: string }) => {
          seenDispatchId = input.dispatchId;
          return terminal.promise;
        }) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
        }),
      },
      hostEffects: effects,
    };
    let seenDispatchId = "";
    const gate = new ActionExecutionGate("published", identity);
    const dispatcher = createRuntimeActionDispatcher({ adapter, gate });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    const pending = dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });
    dispatcher.revoke();
    // revoke 后 resolve 终态：在途终态不提交（先 resolve 再 await）
    terminal.resolve(success(seenDispatchId, {}));
    await pending;
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBe(true);
    expect(recording.store.get(READ_TARGETS.resultStatePath)).toBeUndefined();

    // 新 dispatch：gate_revoked（store 已被 revoke 置空 → 无处可写）
    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });
    expect(recording.updates.length).toBe(1);
  });

  it("phase 门禁拒绝：staging 阶段 record-read 写入 preview_staging，不写 loading", async () => {
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async () => success("", {})) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
        }),
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("staging", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });

    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBeUndefined();
    expect(recording.store.get(READ_TARGETS.errorStatePath)).toEqual({
      code: "preview_staging",
      message: "当前执行阶段禁止该操作",
    });
  });

  it("身份不匹配：identity_mismatch（旧 Adapter 调用 fail closed）", async () => {
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async () => success("", {})) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
        }),
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity: { ...identity, bundleRevision: 99 },
    });
    expect(recording.store.get(READ_TARGETS.errorStatePath)).toEqual({
      code: "identity_mismatch",
      message: "当前执行阶段禁止该操作",
    });
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBeUndefined();
  });

  it("写操作去重：pending 期间重复提交拒绝并返回冲突 idempotencyKey 线索", async () => {
    const terminal = deferred<RuntimeActionResult>();
    let seenDispatchId = "";
    const handler = vi.fn(
      async (input: { dispatchId: string }) => {
        seenDispatchId = input.dispatchId;
        return terminal.promise;
      },
    );
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: { createRecord: handler as unknown as RuntimeActionHandler },
      contracts: {
        createRecord: makeContract({
          permissionClass: "record-write",
          concurrency: "exclusive",
        }),
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    // 第一次提交：pending（终态未决）
    const first = dispatcher.dispatchCustomAction({
      actionName: "createRecord",
      params: { targets: WRITE_TARGETS },
      identity,
    });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    // 重复提交：立即拒绝（不调用 handler）
    await dispatcher.dispatchCustomAction({
      actionName: "createRecord",
      params: { targets: WRITE_TARGETS },
      identity,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(recording.store.get(WRITE_TARGETS.errorStatePath)).toEqual({
      code: "action_duplicate_submit",
      message: "Action 被拒绝",
    });
    // loading 仍由第一次 dispatch 持有
    expect(recording.store.get(WRITE_TARGETS.loadingStatePath)).toBe(true);

    // 第一次终态提交
    terminal.resolve(success(seenDispatchId, { recordId: "r1" }));
    const firstResult = await first;
    expect(recording.store.get(WRITE_TARGETS.loadingStatePath)).toBe(false);
    expect(recording.store.get(WRITE_TARGETS.errorStatePath)).toEqual({
      code: "action_duplicate_submit",
      message: "Action 被拒绝",
    });
    expect(recording.store.get(WRITE_TARGETS.resultStatePath)).toEqual({ recordId: "r1" });
    expect(firstResult.idempotencyKey).toMatch(/^idem_/);
    expect(dispatcher.getIdempotencyKey(firstResult.dispatchId)).toBe(
      firstResult.idempotencyKey,
    );
  });

  it("显式重试：retryOfDispatchId 复用第一次的 idempotencyKey", async () => {
    let fail = true;
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        createRecord: (async ({ dispatchId }: { dispatchId: string }) =>
          fail
            ? errorTerminal(dispatchId, "network_uncertain")
            : success(dispatchId, { recordId: "r1" })) as unknown as RuntimeActionHandler,
      },
      contracts: {
        createRecord: makeContract({
          permissionClass: "record-write",
          concurrency: "exclusive",
        }),
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    const first = await dispatcher.dispatchCustomAction({
      actionName: "createRecord",
      params: { targets: WRITE_TARGETS },
      identity,
    });
    expect(first.idempotencyKey).toMatch(/^idem_/);

    fail = false;
    const retry = await dispatcher.dispatchCustomAction({
      actionName: "createRecord",
      params: { targets: WRITE_TARGETS },
      identity,
      retryOfDispatchId: first.dispatchId,
    });
    // 复用同一 idempotencyKey
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("回调失败不影响已提交终态（至多一次语义已满足）", async () => {
    const effects = makeHostEffects();
    effects.platformUi.showToast = vi.fn(() => {
      throw new Error("callback exploded");
    });
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async ({ dispatchId }: { dispatchId: string }) =>
          success(dispatchId, { ok: true })) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
          resultPathRequired: true,
          onSuccess: { kind: "showToast", variant: "success", title: "OK" },
        }),
      },
      hostEffects: effects,
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await expect(
      dispatcher.dispatchCustomAction({
        actionName: "queryRecords",
        params: { targets: READ_TARGETS },
        identity,
      }),
    ).resolves.toBeTruthy();
    // 终态已提交
    expect(recording.store.get(READ_TARGETS.resultStatePath)).toEqual({ ok: true });
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBe(false);
  });

  it("store 未注册：终态无写权限（页面卸载后不残留写入）", async () => {
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async ({ dispatchId }: { dispatchId: string }) =>
          success(dispatchId, {})) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
        }),
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    // 不注册 store（页面已卸载）
    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });
    // 无异常、无写入
  });

  it("params 非法：错误写入 errorStatePath，不写 loading", async () => {
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: {
        queryRecords: (async () => success("", {})) as unknown as RuntimeActionHandler,
      },
      contracts: {
        queryRecords: {
          ...makeContract({
            permissionClass: "record-read",
            concurrency: "latest-wins",
          }),
          validateParams: () => ({ ok: false, code: "action_params_invalid" as const }),
        },
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: READ_TARGETS },
      identity,
    });
    expect(recording.store.get(READ_TARGETS.loadingStatePath)).toBeUndefined();
    expect(recording.store.get(READ_TARGETS.errorStatePath)).toEqual({
      code: "action_params_invalid",
      message: "Action params 不符合合同",
    });
  });

  it("targets 非法：不写任何状态（无处可写）", async () => {
    const handler = vi.fn(async () => success("", {}));
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: { queryRecords: handler as unknown as RuntimeActionHandler },
      contracts: {
        queryRecords: {
          ...makeContract({
            permissionClass: "record-read",
            concurrency: "latest-wins",
          }),
          validateTargets: () => ({ ok: false, code: "action_targets_invalid" as const }),
        },
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await dispatcher.dispatchCustomAction({
      actionName: "queryRecords",
      params: { targets: { loadingStatePath: 42 } },
      identity,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(recording.updates).toEqual([]);
  });

  it("未知 Action：不写任何状态、不调用 handler", async () => {
    const handler = vi.fn(async () => success("", {}));
    const adapter: RuntimeActionAdapter = {
      protocolVersion: 1,
      handlers: { queryRecords: handler as unknown as RuntimeActionHandler },
      contracts: {
        queryRecords: makeContract({
          permissionClass: "record-read",
          concurrency: "latest-wins",
        }),
      },
      hostEffects: makeHostEffects(),
    };
    const dispatcher = createRuntimeActionDispatcher({
      adapter,
      gate: new ActionExecutionGate("published", identity),
    });
    const recording = makeRecordingStore();
    dispatcher.setActiveStateStore(recording);

    await dispatcher.dispatchCustomAction({
      actionName: "notRegistered",
      params: {},
      identity,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(recording.updates).toEqual([]);
  });

  it("phase 推进：staging→unsaved→draft 单调；published 拒绝就地跃迁", async () => {
    const dispatcher = createRuntimeActionDispatcher({
      adapter: {
        protocolVersion: 1,
        handlers: {},
        contracts: {},
        hostEffects: makeHostEffects(),
      },
      gate: new ActionExecutionGate("staging", identity),
    });
    expect(dispatcher.transitionPhase("unsaved")).toEqual({ ok: true });
    expect(dispatcher.transitionPhase("draft")).toEqual({ ok: true });
    expect(dispatcher.transitionPhase("unsaved")).toEqual({
      ok: false,
      code: "phase_regression",
    });
    expect(dispatcher.transitionPhase("published")).toEqual({
      ok: false,
      code: "phase_jump",
    });
    expect(dispatcher.getExecutionIdentity()).toEqual(identity);
    expect(dispatcher.getAdapterActionNames()).toEqual([]);
  });
});
