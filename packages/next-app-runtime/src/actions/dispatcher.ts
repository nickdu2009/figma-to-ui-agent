/**
 * RuntimeActionDispatcher（设计 §9.2/§9.3，计划 S3）：
 * custom Action 的唯一执行边界。
 *
 * 单次 dispatch 流程：
 * 1. 冻结 handler/contract map 中按名查找；
 * 2. params/targets 结构校验（不进入模型上下文）；
 * 3. ExecutionGate 重新判定（身份 + phase×权限）；
 * 4. target lease 建立与 loading 批量写入；
 * 5. 调用 handler（携带 abort signal 与宿主生成的 idempotencyKey）；
 * 6. 唯一消费一次匹配 dispatchId 的 ActionResult 终态；
 *    throw/非法 result/错 id 归一化为一次有界 error；
 * 7. 终态提交前重新验证 lease 权限，一个 batch 原子清除 loading
 *    并写 result/error；
 * 8. 至多执行一次静态回调（重新过 Gate，纯 UI/导航）。
 *
 * aborted/迟到/revoked/lease 已丢失的终态：不写状态、不清 loading、
 * 不执行回调。built-in Action 不经过本模块（上游路径专属）。
 */

import type {
  RuntimeActionAdapter,
  RuntimeActionContract,
  RuntimeActionDispatchResult,
  RuntimeActionResult,
  RuntimeActionDispatcher,
  RuntimeActionHandler,
  RuntimeActionIdentity,
  RuntimeStaticCallback,
  StateStoreLike,
  ValidatedCustomActionInvocation,
} from "./contracts.js";
import {
  normalizeActionError,
  assertRuntimeActionAdapter,
} from "./contracts.js";
import type { ActionExecutionGate } from "./execution-gate.js";
import { TargetLeaseTable } from "./target-leases.js";

const WRITE_CLASSES = new Set(["record-write", "attachment", "export"]);
const MAX_IDEMPOTENCY_ENTRIES = 500;

function newOpaqueId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${prefix}_${hex}`;
}

function isValidTerminal(
  result: unknown,
  dispatchId: string,
): result is RuntimeActionResult {
  if (typeof result !== "object" || result === null) return false;
  const candidate = result as Partial<RuntimeActionResult> & {
    status?: unknown;
    dispatchId?: unknown;
    serverRequestId?: unknown;
  };
  if (candidate.dispatchId !== dispatchId) return false;
  if (candidate.status === "success") {
    return (
      typeof candidate.serverRequestId === "string" &&
      candidate.serverRequestId.length > 0 &&
      "data" in candidate
    );
  }
  if (candidate.status === "error") {
    const error = candidate.error as
      | { code?: unknown; message?: unknown }
      | undefined;
    return (
      typeof error === "object" &&
      error !== null &&
      typeof error.code === "string" &&
      typeof error.message === "string"
    );
  }
  return false;
}

export interface CreateRuntimeActionDispatcherInput {
  adapter: RuntimeActionAdapter;
  gate: ActionExecutionGate;
}

export function createRuntimeActionDispatcher(
  input: CreateRuntimeActionDispatcherInput,
): RuntimeActionDispatcher {
  assertRuntimeActionAdapter(input.adapter);
  // Adapter map 在创建时冻结：后续替换 handlers 不影响已创建 Dispatcher
  const handlers: Readonly<Record<string, RuntimeActionHandler>> =
    Object.freeze({
      ...input.adapter.handlers,
    });
  const contracts: Readonly<Record<string, RuntimeActionContract>> =
    Object.freeze({
      ...input.adapter.contracts,
    });
  const hostEffects = input.adapter.hostEffects;
  const gate = input.gate;
  const leases = new TargetLeaseTable();
  /** dispatchId → idempotencyKey（有界；显式重试复用）。 */
  const idempotencyKeys = new Map<string, string>();
  let store: StateStoreLike | null = null;

  const writeError = (
    path: string | null,
    code: string,
    message: string,
  ): void => {
    if (!path || !store) return;
    store.update({ [path]: { code, message } });
  };

  const executeCallback = (callback: RuntimeStaticCallback): void => {
    // 回调前重新通过 Gate（纯 UI 类）
    const allowed = gate.checkStaticCallback({
      identity: gate.getSnapshot().identity,
    });
    if (!allowed.ok) return;
    try {
      switch (callback.kind) {
        case "navigate":
          hostEffects.platformUi.navigate(callback.href, callback.replace);
          break;
        case "showToast":
          hostEffects.platformUi.showToast({
            variant: callback.variant,
            title: callback.title,
            description: callback.description,
          });
          break;
        case "openDialog":
          hostEffects.platformUi.openDialog(callback.targetElementId);
          break;
        case "closeDialog":
          hostEffects.platformUi.closeDialog(callback.targetElementId);
          break;
      }
    } catch {
      // 回调失败不影响已提交终态（至多一次语义已满足）
    }
  };

  const dispatcher: RuntimeActionDispatcher = {
    async dispatchCustomAction(
      invocation: ValidatedCustomActionInvocation,
    ): Promise<RuntimeActionDispatchResult> {
      const contract = contracts[invocation.actionName];
      if (!contract || !handlers[invocation.actionName]) {
        // 未知 Action：不写任何状态（无合同即无目标）
        return { dispatchId: newOpaqueId("dispatch"), idempotencyKey: null };
      }

      const dispatchId = newOpaqueId("dispatch");
      const paramsCheck = contract.validateParams(invocation.params);
      if (!paramsCheck.ok) {
        const targetsCheck = contract.validateTargets(
          (invocation.params as { targets?: unknown }).targets,
        );
        writeError(
          targetsCheck.ok ? targetsCheck.value.errorStatePath : null,
          paramsCheck.code,
          "Action params 不符合合同",
        );
        return { dispatchId, idempotencyKey: null };
      }
      const params = paramsCheck.value;
      const targetsCheck = contract.validateTargets(params.targets);
      if (!targetsCheck.ok) {
        // 目标非法：无处可写，不提交任何状态
        return { dispatchId, idempotencyKey: null };
      }
      const targets = targetsCheck.value;

      // Gate 重新判定（身份 + phase×权限）
      const gateCheck = gate.checkDispatch({
        identity: invocation.identity,
        permissionClass: contract.permissionClass,
      });
      if (!gateCheck.ok) {
        writeError(
          targets.errorStatePath,
          gateCheck.code,
          "当前执行阶段禁止该操作",
        );
        return { dispatchId, idempotencyKey: null };
      }

      // idempotencyKey：写操作宿主生成/重试复用；读操作为 null
      const isWrite = WRITE_CLASSES.has(contract.permissionClass);
      let idempotencyKey: string | null = null;
      if (isWrite) {
        if (invocation.retryOfDispatchId) {
          const existingKey = idempotencyKeys.get(invocation.retryOfDispatchId);
          if (!existingKey) {
            writeError(
              targets.errorStatePath,
              "retry_target_not_found",
              "找不到待重试的 dispatch 记录",
            );
            return { dispatchId, idempotencyKey: null };
          }
          idempotencyKey = existingKey;
        } else {
          idempotencyKey = newOpaqueId("idem");
        }
        if (idempotencyKeys.size >= MAX_IDEMPOTENCY_ENTRIES) {
          const oldest = idempotencyKeys.keys().next().value;
          if (oldest) idempotencyKeys.delete(oldest);
        }
        idempotencyKeys.set(dispatchId, idempotencyKey);
      }

      // lease：latest-wins 抢占旧请求；exclusive 拒绝重复提交
      const writeTriggerKey = isWrite
        ? `${invocation.actionName}:${targets.loadingStatePath}`
        : null;
      const acquisition = leases.acquire({
        dispatchId,
        actionName: invocation.actionName,
        concurrency: contract.concurrency,
        writeTriggerKey,
        loadingStatePath: targets.loadingStatePath,
        resultStatePath: targets.resultStatePath ?? null,
        errorStatePath: targets.errorStatePath,
      });
      if (!acquisition.ok) {
        writeError(
          targets.errorStatePath,
          acquisition.stableCode ?? "action_rejected",
          "Action 被拒绝",
        );
        return { dispatchId, idempotencyKey };
      }
      const lease = acquisition.lease;
      if (!lease) {
        return { dispatchId, idempotencyKey };
      }

      // loading 批量写入（lease owner 独占）
      store?.update({ [targets.loadingStatePath]: true });

      let terminal: RuntimeActionResult | null = null;
      try {
        const raw = await handlers[invocation.actionName]({
          dispatchId,
          idempotencyKey,
          params,
          phase: gate.getSnapshot().phase,
          identity: gate.getSnapshot().identity,
          signal: lease.controller.signal,
        });
        if (isValidTerminal(raw, dispatchId)) {
          terminal = raw;
        } else {
          terminal = {
            status: "error",
            dispatchId,
            error: {
              code: "action_result_invalid",
              message: "handler 返回了非法的 ActionResult",
            },
          };
        }
      } catch (error) {
        if (lease.controller.signal.aborted) {
          // abort 导致的异常：按 aborted 处理（无写权限）
          terminal = null;
        } else {
          const normalized = normalizeActionError(error);
          terminal = {
            status: "error",
            dispatchId,
            error: normalized,
          };
        }
      }

      // 迟到/abort/revoked/lease 已丢失：不提交状态、不清 loading、不回调
      if (!terminal) {
        leases.release(dispatchId);
        return { dispatchId, idempotencyKey };
      }
      const authority = leases.authority(dispatchId);
      if (!authority.authorized || lease.controller.signal.aborted) {
        leases.release(dispatchId);
        return { dispatchId, idempotencyKey };
      }

      // 单个 batch：清除 loading + 写 result/error（原子提交）
      const batch: Record<string, unknown> = {
        [targets.loadingStatePath]: false,
      };
      if (terminal.status === "success") {
        if (targets.resultStatePath) {
          batch[targets.resultStatePath] = terminal.data;
        }
      } else {
        batch[targets.errorStatePath] = {
          code: terminal.error.code,
          message: terminal.error.message,
        };
      }
      store?.update(batch);
      leases.release(dispatchId);

      // 静态回调：至多一次，重新过 Gate
      if (terminal.status === "success" && contract.onSuccess) {
        executeCallback(contract.onSuccess);
      } else if (terminal.status === "error" && contract.onError) {
        executeCallback(contract.onError);
      }
      return { dispatchId, idempotencyKey };
    },

    getIdempotencyKey(dispatchId: string): string | null {
      return idempotencyKeys.get(dispatchId) ?? null;
    },

    getAdapterActionNames(): readonly string[] {
      return Object.keys(handlers);
    },

    getExecutionIdentity(): Readonly<RuntimeActionIdentity> {
      return gate.getSnapshot().identity;
    },

    setActiveStateStore(next: StateStoreLike | null): void {
      store = next;
    },

    transitionPhase(next) {
      const result = gate.transitionPhase(next, gate.getSnapshot().identity);
      if (result.ok) return { ok: true as const };
      return { ok: false as const, code: result.code };
    },

    revoke(): void {
      leases.revoke();
      gate.revoke();
      store = null;
    },
  };
  return dispatcher;
}
