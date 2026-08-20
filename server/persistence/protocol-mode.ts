/**
 * 服务端协议模式状态机与兼容性门禁（设计 §13.2.1/§13.2.3，计划 S13 动作 2/3）。
 *
 * 项目从未上线，没有旧客户端或历史协议需要切换：
 * 1. `v2`（默认）：唯一正常运行模式；所有宿主写入必须显式使用 v2；
 * 2. `readonly_recovery`：独立只读恢复模式；仅允许受权读取与导出，所有写操作拒绝。
 */
import { createHash } from "node:crypto";
import {
  CATALOG_VERSION,
  SPEC_COMPATIBILITY,
} from "../../src/catalog/catalog-contract.ts";

export type ProtocolMode = "v2" | "readonly_recovery";

export const PROTOCOL_MODES: readonly ProtocolMode[] = [
  "v2",
  "readonly_recovery",
] as const;

export const SERVER_PROTOCOL_VERSION = 2 as const;

export class ProtocolFenceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 423) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 从环境变量解析当前服务端的协议模式（默认 v2，非空非法值直接抛错 fail-closed）。 */
export function resolveProtocolMode(
  env: NodeJS.ProcessEnv = process.env,
): ProtocolMode {
  const raw = env.VMA_PROTOCOL_MODE?.trim().toLowerCase();
  if (!raw || raw === "v2") return "v2";
  if (raw === "readonly_recovery") return "readonly_recovery";
  throw new Error(
    `未知或非法的 VMA_PROTOCOL_MODE 环境变量值: "${env.VMA_PROTOCOL_MODE}"，允许的值为: ${PROTOCOL_MODES.join(", ")}`,
  );
}

/** 计算兼容性指纹（mode/version/catalog/compatibility）。 */
export function computeCompatibilityDigest(
  mode: ProtocolMode = resolveProtocolMode(),
  serverVersion: number = SERVER_PROTOCOL_VERSION,
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
 * 旧协议 body 不得静默解释为 v2 写入：所有宿主 mutation 必须声明 v2。
 */
export function assertMutationProtocolVersion(
  _mode: ProtocolMode,
  mutationType: MutationType,
  protocolVersion: number | undefined,
): void {
  if (
    protocolVersion !== undefined &&
    protocolVersion !== SERVER_PROTOCOL_VERSION
  ) {
    throw new ProtocolFenceError(
      "protocol_version_unknown",
      `不支持 ${mutationType} 的协议版本：${protocolVersion}`,
      400,
    );
  }
  if (protocolVersion !== SERVER_PROTOCOL_VERSION) {
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

  // v2 mutation 在 assertMutationProtocolVersion 中已强制版本围栏。
}
