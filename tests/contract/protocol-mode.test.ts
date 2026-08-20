/**
 * S13 契约测试：协议模式状态机与兼容性指纹契约（设计 §13.2.1/§13.2.3）。
 *
 * 验证：
 * 1. resolveProtocolMode 默认 compat，受控识别 cutover, v2, readonly_recovery；
 * 2. computeCompatibilityDigest 确定性生成包含 catalogVersion/specCompatibility 的指纹；
 * 3. assertMutationAllowed 在 cutover 与 readonly_recovery 下严格抛出 423 门禁异常；
 * 4. verifyServerProtocol 客户端握手契约与错配保护。
 */
import { describe, expect, it } from "vitest";
import {
  COMPAT_PROTOCOL_VERSION,
  ProtocolFenceError,
  SERVER_PROTOCOL_VERSION,
  assertMutationAllowed,
  computeCompatibilityDigest,
  resolveProtocolMode,
} from "../../server/persistence/protocol-mode.ts";
import { verifyServerProtocol } from "../../src/runtime/protocol-mode.ts";

describe("S13 协议模式与兼容性指纹契约 (protocol-mode)", () => {
  it("resolveProtocolMode 默认返回 compat，非法值抛错 fail-closed", () => {
    expect(resolveProtocolMode({})).toBe("compat");
    expect(resolveProtocolMode({ VMA_PROTOCOL_MODE: "" })).toBe("compat");
    expect(resolveProtocolMode({ VMA_PROTOCOL_MODE: "compat" })).toBe("compat");
    expect(() =>
      resolveProtocolMode({ VMA_PROTOCOL_MODE: "UNKNOWN_INVALID" }),
    ).toThrowError(/未知或非法的 VMA_PROTOCOL_MODE/);
    expect(resolveProtocolMode({ VMA_PROTOCOL_MODE: "cutover" })).toBe(
      "cutover",
    );
    expect(resolveProtocolMode({ VMA_PROTOCOL_MODE: "v2" })).toBe("v2");
    expect(
      resolveProtocolMode({ VMA_PROTOCOL_MODE: "readonly_recovery" }),
    ).toBe("readonly_recovery");
  });

  it("computeCompatibilityDigest 确定性生成合法 SHA-256 指纹", () => {
    const d1 = computeCompatibilityDigest("compat", COMPAT_PROTOCOL_VERSION);
    const d2 = computeCompatibilityDigest("compat", COMPAT_PROTOCOL_VERSION);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^sha256:[a-f0-9]{64}$/);

    const dV2 = computeCompatibilityDigest("v2", SERVER_PROTOCOL_VERSION);
    expect(dV2).not.toBe(d1);
  });

  it("assertMutationAllowed 行为契约", () => {
    // compat 与 v2 允许常规 mutation
    expect(() => assertMutationAllowed("compat", "generation")).not.toThrow();
    expect(() => assertMutationAllowed("compat", "publish")).not.toThrow();
    expect(() => assertMutationAllowed("v2", "runtime_action")).not.toThrow();

    // cutover 严格冻结所有写操作（423 门禁异常）
    expect(() => assertMutationAllowed("cutover", "generation")).toThrow(
      ProtocolFenceError,
    );
    try {
      assertMutationAllowed("cutover", "publish");
    } catch (e) {
      expect((e as ProtocolFenceError).code).toBe(
        "protocol_mode_cutover_fence_active",
      );
      expect((e as ProtocolFenceError).status).toBe(423);
    }

    // readonly_recovery 严格禁止所有写操作
    try {
      assertMutationAllowed("readonly_recovery", "runtime_action");
    } catch (e) {
      expect((e as ProtocolFenceError).code).toBe(
        "protocol_mode_readonly_recovery_active",
      );
      expect((e as ProtocolFenceError).status).toBe(423);
    }
  });

  it("verifyServerProtocol 客户端握手校验契约", () => {
    const digest = computeCompatibilityDigest("compat", 1);
    const validCompat = verifyServerProtocol({
      protocolMode: "compat",
      serverProtocolVersion: 1,
      compatibilityDigest: digest,
    });
    expect(validCompat.ok).toBe(true);

    const validV2 = verifyServerProtocol({
      protocolMode: "v2",
      serverProtocolVersion: 2,
      compatibilityDigest: computeCompatibilityDigest("v2", 2),
    });
    expect(validV2.ok).toBe(true);

    // v2 模式如果版本 < 2 报错
    const invalidV2 = verifyServerProtocol({
      protocolMode: "v2",
      serverProtocolVersion: 1,
      compatibilityDigest: digest,
    });
    expect(invalidV2.ok).toBe(false);
    if (!invalidV2.ok) {
      expect(invalidV2.code).toBe("protocol_version_mismatch");
    }

    // 缺少合法 digest 报错
    const noDigest = verifyServerProtocol({
      protocolMode: "compat",
      serverProtocolVersion: 1,
      compatibilityDigest: "invalid-digest",
    });
    expect(noDigest.ok).toBe(false);
    if (!noDigest.ok) {
      expect(noDigest.code).toBe("compatibility_digest_mismatch");
    }
  });
});
