import { describe, expect, it } from "vitest";

import { ActionExecutionGate } from "../../src/actions/execution-gate.js";
import { decidePhaseAction } from "../../src/actions/contracts.js";
import type { RuntimeActionIdentity } from "../../src/actions/contracts.js";

const identity: RuntimeActionIdentity = {
  appId: "app-1",
  candidateDigest: "sha256:abc",
  bundleRevision: 1,
};

const staleIdentity: RuntimeActionIdentity = {
  appId: "app-1",
  candidateDigest: "sha256:CHANGED",
  bundleRevision: 1,
};

const PERMISSION_CLASSES = [
  "ui",
  "record-read",
  "record-write",
  "attachment",
  "export",
] as const;

describe("Action ExecutionGate（S3）", () => {
  it("阶段×权限矩阵与设计 §9.2 表格一致", () => {
    // validation：ui/read 允许；写/附件/导出全部拒绝
    expect(decidePhaseAction("validation", "ui")).toEqual({ allowed: true });
    expect(decidePhaseAction("validation", "record-read")).toEqual({ allowed: true });
    expect(decidePhaseAction("validation", "record-write")).toEqual({
      allowed: false,
      stableCode: "validation_action_forbidden",
    });
    expect(decidePhaseAction("validation", "export")).toEqual({
      allowed: false,
      stableCode: "validation_action_forbidden",
    });
    // staging / unsaved：只有 ui
    expect(decidePhaseAction("staging", "ui")).toEqual({ allowed: true });
    expect(decidePhaseAction("staging", "record-read")).toEqual({
      allowed: false,
      stableCode: "preview_staging",
    });
    expect(decidePhaseAction("unsaved", "record-write")).toEqual({
      allowed: false,
      stableCode: "preview_not_saved",
    });
    // draft：ui/read 允许；写/导出拒绝
    expect(decidePhaseAction("draft", "record-read")).toEqual({ allowed: true });
    expect(decidePhaseAction("draft", "record-write")).toEqual({
      allowed: false,
      stableCode: "draft_write_forbidden",
    });
    expect(decidePhaseAction("draft", "export")).toEqual({
      allowed: false,
      stableCode: "draft_write_forbidden",
    });
    // published：全部允许
    for (const cls of PERMISSION_CLASSES) {
      expect(decidePhaseAction("published", cls)).toEqual({ allowed: true });
    }
  });

  it("生成实例 phase 只允许 staging→unsaved→draft 单调推进", () => {
    const gate = new ActionExecutionGate("staging", identity);
    expect(gate.getSnapshot().phase).toBe("staging");
    expect(gate.transitionPhase("unsaved", identity)).toEqual({ ok: true });
    expect(gate.transitionPhase("draft", identity)).toEqual({ ok: true });
    // 逆向推进被拒绝
    expect(gate.transitionPhase("unsaved", identity)).toEqual({
      ok: false,
      code: "phase_regression",
    });
    // published 只能来自新 Runtime 构造：就地跃迁被拒绝
    expect(gate.transitionPhase("published", identity)).toEqual({
      ok: false,
      code: "phase_jump",
    });
  });

  it("跳级推进被拒绝（staging 不能直接到 draft）", () => {
    const gate = new ActionExecutionGate("staging", identity);
    expect(gate.transitionPhase("draft", identity)).toEqual({
      ok: false,
      code: "phase_jump",
    });
  });

  it("published 上下文只能构造时进入，之后不可再推进", () => {
    const gate = new ActionExecutionGate("published", identity);
    expect(gate.getSnapshot().phase).toBe("published");
    expect(gate.transitionPhase("draft", identity)).toEqual({
      ok: false,
      code: "phase_regression",
    });
  });

  it("dispatch 前重新判定：身份不匹配即 fail closed", () => {
    const gate = new ActionExecutionGate("published", identity);
    expect(
      gate.checkDispatch({ identity: staleIdentity, permissionClass: "record-read" }),
    ).toMatchObject({ ok: false, code: "identity_mismatch" });
    // bundleRevision 变化同样视为新身份
    expect(
      gate.checkDispatch({
        identity: { ...identity, bundleRevision: 2 },
        permissionClass: "record-read",
      }),
    ).toMatchObject({ ok: false, code: "identity_mismatch" });
  });

  it("phase 推进时身份不匹配 fail closed", () => {
    const gate = new ActionExecutionGate("staging", identity);
    expect(gate.transitionPhase("unsaved", staleIdentity)).toEqual({
      ok: false,
      code: "identity_mismatch",
    });
    // 未变化
    expect(gate.getSnapshot().phase).toBe("staging");
  });

  it("revoke 后 dispatch/回调/推进全部 fail closed", () => {
    const gate = new ActionExecutionGate("published", identity);
    gate.revoke();
    expect(
      gate.checkDispatch({ identity, permissionClass: "ui" }),
    ).toMatchObject({ ok: false, code: "gate_revoked" });
    expect(gate.checkStaticCallback({ identity })).toMatchObject({
      ok: false,
      code: "gate_revoked",
    });
    expect(gate.transitionPhase("draft", identity)).toEqual({
      ok: false,
      code: "gate_revoked",
    });
    expect(gate.isRevoked()).toBe(true);
  });

  it("静态回调前重新过 Gate（ui 类在全部阶段可用）", () => {
    for (const phase of ["validation", "staging", "unsaved", "draft", "published"] as const) {
      const gate = new ActionExecutionGate(phase, identity);
      expect(gate.checkStaticCallback({ identity })).toMatchObject({ ok: true });
    }
  });
});
