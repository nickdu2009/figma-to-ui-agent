/**
 * Action ExecutionGate（设计 §9.2/§13，计划 S3）：
 * - phase 只允许 staging→unsaved→draft 单调推进；published 只能来自
 *   新 Runtime 构造（bootstrap 直接进入 published，禁止就地跃迁）；
 * - Gate 绑定 appId/candidateDigest/bundleRevision 与适用的
 *   generationId/draftId/publishedVersionId；任何标识不匹配、逆向推进、
 *   旧 Adapter 调用或 abort 后调用都 fail closed；
 * - dispatch 与回调执行前重新通过 Gate；revoke 后一切写权限消失。
 */

import {
  decidePhaseAction,
  type RuntimeActionIdentity,
  type RuntimeActionPhase,
  type RuntimeActionPermissionClass,
} from "./contracts.js";

const PHASE_ORDER: readonly RuntimeActionPhase[] = [
  "validation",
  "staging",
  "unsaved",
  "draft",
  "published",
];

/** 生成实例的合法 phase 序列（validation 属 Validation Service，不在其列）。 */
const GENERATION_INSTANCE_ORDER: readonly RuntimeActionPhase[] = [
  "staging",
  "unsaved",
  "draft",
];

export type GateTransitionResult =
  | { ok: true }
  | { ok: false; code: "phase_regression" | "phase_jump" | "identity_mismatch" | "gate_revoked" };

export type GateCheckResult =
  | { ok: true; phase: RuntimeActionPhase; identity: Readonly<RuntimeActionIdentity> }
  | { ok: false; code: "gate_revoked" | "identity_mismatch" | "action_forbidden" | string };

function sameIdentity(
  a: Readonly<RuntimeActionIdentity>,
  b: Readonly<RuntimeActionIdentity>,
): boolean {
  return (
    a.appId === b.appId &&
    a.candidateDigest === b.candidateDigest &&
    a.bundleRevision === b.bundleRevision &&
    (a.generationId ?? null) === (b.generationId ?? null) &&
    (a.draftId ?? null) === (b.draftId ?? null) &&
    (a.publishedVersionId ?? null) === (b.publishedVersionId ?? null)
  );
}

export class ActionExecutionGate {
  private revoked = false;
  private generationInstance: boolean;

  constructor(
    private phase: RuntimeActionPhase,
    private identity: Readonly<RuntimeActionIdentity>,
  ) {
    // published 只能来自新 Runtime 构造（bootstrap）；生成实例从 staging 开始。
    this.generationInstance = phase !== "published";
  }

  getSnapshot(): {
    phase: RuntimeActionPhase;
    identity: Readonly<RuntimeActionIdentity>;
    revoked: boolean;
  } {
    return {
      phase: this.phase,
      identity: this.identity,
      revoked: this.revoked,
    };
  }

  /** 单调推进（Controller 独占）：staging→unsaved→draft；published 禁止就地进入。 */
  transitionPhase(
    next: RuntimeActionPhase,
    identity: Readonly<RuntimeActionIdentity>,
  ): GateTransitionResult {
    if (this.revoked) return { ok: false, code: "gate_revoked" };
    if (!sameIdentity(this.identity, identity)) {
      return { ok: false, code: "identity_mismatch" };
    }
    if (next === "published") {
      // 发布/回滚通过新 published Runtime 原子替换，不允许就地跃迁
      return { ok: false, code: "phase_jump" };
    }
    if (next === "validation") {
      // validation 只能由 Validation Service 创建，预览 Runtime 不可进入
      return { ok: false, code: "phase_regression" };
    }
    if (!this.generationInstance) {
      return { ok: false, code: "phase_regression" };
    }
    const order = this.generationInstance
      ? GENERATION_INSTANCE_ORDER
      : PHASE_ORDER;
    const fromIndex = order.indexOf(this.phase);
    const toIndex = order.indexOf(next);
    if (fromIndex < 0 || toIndex < 0) {
      return { ok: false, code: "phase_jump" };
    }
    if (toIndex < fromIndex) return { ok: false, code: "phase_regression" };
    if (toIndex > fromIndex + 1) return { ok: false, code: "phase_jump" };
    this.phase = next;
    return { ok: true };
  }

  /**
   * dispatch 前判定：身份匹配 + phase×权限允许。
   * identity 不匹配即 fail closed（旧 Adapter 调用归一化为 identity_mismatch）。
   */
  checkDispatch(input: {
    identity: Readonly<RuntimeActionIdentity>;
    permissionClass: RuntimeActionPermissionClass;
  }): GateCheckResult {
    if (this.revoked) return { ok: false, code: "gate_revoked" };
    if (!sameIdentity(this.identity, input.identity)) {
      return { ok: false, code: "identity_mismatch" };
    }
    const decision = decidePhaseAction(this.phase, input.permissionClass);
    if (!decision.allowed) {
      return { ok: false, code: decision.stableCode ?? "action_forbidden" };
    }
    return { ok: true, phase: this.phase, identity: this.identity };
  }

  /**
   * 静态回调前判定（成功/错误回调都必须重新过 Gate）。
   * 回调只能引用纯 UI/导航；权限类别固定为 ui。
   */
  checkStaticCallback(input: {
    identity: Readonly<RuntimeActionIdentity>;
  }): GateCheckResult {
    if (this.revoked) return { ok: false, code: "gate_revoked" };
    if (!sameIdentity(this.identity, input.identity)) {
      return { ok: false, code: "identity_mismatch" };
    }
    const decision = decidePhaseAction(this.phase, "ui");
    if (!decision.allowed) {
      return { ok: false, code: decision.stableCode ?? "action_forbidden" };
    }
    return { ok: true, phase: this.phase, identity: this.identity };
  }

  revoke(): void {
    this.revoked = true;
  }

  isRevoked(): boolean {
    return this.revoked;
  }
}
