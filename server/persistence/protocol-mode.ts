/**
 * 服务端协议模式状态机与兼容性门禁（设计 §13.2.1/§13.2.3，计划 S13 动作 2/3）。
 *
 * 模式定义：
 * 1. `compat`（默认）：兼容模式；双写 Bundle + Legacy Spec 投影，不隐式升级客户端；
 * 2. `cutover`：切换门禁模式；禁止所有 Generation/Draft/Publish/Rollback/RuntimeAction 变更（返回 423/protocol_mode_cutover_fence_active）；
 * 3. `v2`：全量 v2 模式；只接受 v2 协议变更，拒绝旧协议调用；
 * 4. `readonly_recovery`：独立只读恢复模式；仅允许受权读取与导出，所有写操作拒绝。
 */
import { createHash } from "node:crypto";
import {
  CATALOG_VERSION,
  SPEC_COMPATIBILITY,
} from "../../src/catalog/catalog-contract.ts";

export type ProtocolMode = "compat" | "cutover" | "v2" | "readonly_recovery";

export const PROTOCOL_MODES: readonly ProtocolMode[] = [
  "compat",
  "cutover",
  "v2",
  "readonly_recovery",
] as const;

export const SERVER_PROTOCOL_VERSION = 2 as const;
export const COMPAT_PROTOCOL_VERSION = 1 as const;

export class ProtocolFenceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 423) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 从环境变量解析当前服务端的协议模式（默认 compat，非空非法值直接抛错 fail-closed）。 */
export function resolveProtocolMode(
  env: NodeJS.ProcessEnv = process.env,
): ProtocolMode {
  const raw = env.VMA_PROTOCOL_MODE?.trim().toLowerCase();
  if (!raw || raw === "compat") return "compat";
  if (raw === "cutover") return "cutover";
  if (raw === "v2") return "v2";
  if (raw === "readonly_recovery") return "readonly_recovery";
  throw new Error(
    `未知或非法的 VMA_PROTOCOL_MODE 环境变量值: "${env.VMA_PROTOCOL_MODE}"，允许的值为: ${PROTOCOL_MODES.join(", ")}`,
  );
}

/** 计算兼容性指纹（mode/version/catalog/compatibility）。 */
export function computeCompatibilityDigest(
  mode: ProtocolMode = resolveProtocolMode(),
  serverVersion: number = mode === "v2"
    ? SERVER_PROTOCOL_VERSION
    : COMPAT_PROTOCOL_VERSION,
): string {
  const canonical = JSON.stringify({
    mode,
    serverVersion,
    catalogVersion: CATALOG_VERSION,
    specCompatibility: SPEC_COMPATIBILITY,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export type MutationType =
  | "generation"
  | "preview_commit"
  | "publish"
  | "rollback"
  | "runtime_action"
  | "draft_mutation";

/**
 * 对写入请求做显式版本围栏。v2 下没有 version=2 的请求一律拒绝；这避免
 * 旧客户端把 compat 形状的 body 静默解释成 v2 写入。compat 保留迁移期的
 * v1/v2 双读入口，但不会改变 v2 模式本身的 fail-closed 语义。
 */
export function assertMutationProtocolVersion(
  mode: ProtocolMode,
  mutationType: MutationType,
  protocolVersion: number | undefined,
): void {
  if (
    protocolVersion !== undefined &&
    protocolVersion !== COMPAT_PROTOCOL_VERSION &&
    protocolVersion !== SERVER_PROTOCOL_VERSION
  ) {
    throw new ProtocolFenceError(
      "protocol_version_unknown",
      `不支持 ${mutationType} 的协议版本：${protocolVersion}`,
      400,
    );
  }
  if (mode === "v2" && protocolVersion !== SERVER_PROTOCOL_VERSION) {
    throw new ProtocolFenceError(
      "protocol_version_required",
      `${mutationType} 在 v2 模式必须显式声明 protocolVersion=${SERVER_PROTOCOL_VERSION}`,
      409,
    );
  }
}

/** 校验当前协议模式是否允许指定类型的写入操作；若受阻则抛出 ProtocolFenceError。 */
export function assertMutationAllowed(
  mode: ProtocolMode,
  mutationType: MutationType,
): void {
  if (mode === "readonly_recovery") {
    throw new ProtocolFenceError(
      "protocol_mode_readonly_recovery_active",
      `当前服务处于只读恢复模式（readonly_recovery），禁止执行 ${mutationType} 变更`,
      423,
    );
  }

  if (mode === "cutover") {
    throw new ProtocolFenceError(
      "protocol_mode_cutover_fence_active",
      `当前服务处于单写切换门禁模式（cutover），所有写操作已冻结，禁止执行 ${mutationType}`,
      423,
    );
  }

  // compat 与 v2 均允许 mutation（v2 在路由层校验协议版本）
}
