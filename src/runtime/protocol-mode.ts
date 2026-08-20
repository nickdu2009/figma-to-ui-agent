/**
 * 客户端协议模式与服务端版本握手（设计 §13.2.1/§13.2.3，计划 S13 动作 3）。
 *
 * 核心语义：
 * 1. 客户端在 bootstrap 时读取 serverProtocolMode、serverProtocolVersion 与 compatibilityDigest；
 * 2. mode/version/digest 错配时 fail closed：显示不可变稳定错误，保持最后有效 Preview，不做猜测降级；
 * 3. readonly_recovery 模式下宿主禁用所有写操作/修改操作。
 */
export type ClientProtocolMode =
  | "v2"
  | "readonly_recovery";

export interface ServerProtocolBootstrap {
  protocolMode: ClientProtocolMode;
  serverProtocolVersion: number;
  compatibilityDigest: string;
}

export type ProtocolVerificationResult =
  | { ok: true; mode: ClientProtocolMode; version: number }
  | {
      ok: false;
      code:
        | "protocol_mode_mismatch"
        | "protocol_version_mismatch"
        | "compatibility_digest_mismatch";
      message: string;
    };

/**
 * 校验服务端协议握手信息。
 * 所有模式均使用协议版本 2；readonly_recovery 只改变写入权限，不改变线协议。
 */
export function verifyServerProtocol(
  bootstrap: ServerProtocolBootstrap,
): ProtocolVerificationResult {
  const { protocolMode, serverProtocolVersion, compatibilityDigest } =
    bootstrap;

  if (
    !["v2", "readonly_recovery"].includes(protocolMode)
  ) {
    return {
      ok: false,
      code: "protocol_mode_mismatch",
      message: `未知的服务端协议模式：${protocolMode}`,
    };
  }

  if (serverProtocolVersion !== 2) {
    return {
      ok: false,
      code: "protocol_version_mismatch",
      message: `客户端要求协议版本 2，服务端返回 ${serverProtocolVersion}`,
    };
  }

  if (!compatibilityDigest || !compatibilityDigest.startsWith("sha256:")) {
    return {
      ok: false,
      code: "compatibility_digest_mismatch",
      message: "服务端缺少有效的 compatibilityDigest 指纹",
    };
  }

  return { ok: true, mode: protocolMode, version: serverProtocolVersion };
}
