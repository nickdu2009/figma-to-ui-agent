/**
 * ValidationSession capability（设计 §11.5，计划 S9 动作 2/4）。
 *
 * - 不可猜测、单 job、短时、请求预算受限的持有者令牌；
 * - 绑定 generationId/candidateDigest/profileVersion/mode/assetId allowlist；
 * - 只经 Authorization header 携带；不得进入 URL、日志、报告或 Cookie；
 * - 进程内存存储（HMAC 脱敏）；job 结束/过期/预算耗尽即拒绝；
 * - 服务重启不恢复（相关 run 按 §13.2.1 标记 incomplete，见 S12）。
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const VALIDATION_SESSION_MODE = "p0-validation";

export interface ValidationSessionGrant {
  jobId: string;
  generationId: string;
  candidateDigest: string;
  profileVersion: string;
  mode: string;
  /** 允许读取的 DesignAsset assetId 集合（空数组 = 不允许任何资产）。 */
  assetAllowlist: readonly string[];
  expiresAtMs: number;
  maxRequests: number;
}

interface SessionEntry {
  /** 令牌 HMAC（原值不落存储/日志）。 */
  tokenDigest: Buffer;
  grant: ValidationSessionGrant;
  remainingRequests: number;
  revoked: boolean;
}

export type SessionRejectionCode =
  | "validation_session_expired"
  | "validation_session_request_limit_exceeded"
  | "validation_session_invalid"
  | "validation_session_asset_forbidden";

export class ValidationSessionRejection extends Error {
  readonly code: SessionRejectionCode;
  constructor(code: SessionRejectionCode) {
    super(code);
    this.code = code;
  }
}

export class ValidationSessionIssuer {
  private readonly secret: Buffer;
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(options?: { secret?: Buffer }) {
    // 进程随机密钥：capability 不跨进程/重启验证（worker 只回传同一进程签发的令牌）。
    this.secret = options?.secret ?? randomBytes(32);
  }

  /** 签发单 job capability；返回的原值只经指令文件传给 worker。 */
  issue(grant: ValidationSessionGrant): string {
    const token = `vma_val_${randomBytes(24).toString("base64url")}`;
    this.sessions.set(token, {
      tokenDigest: this.digest(token),
      grant: { ...grant, assetAllowlist: [...grant.assetAllowlist] },
      remainingRequests: grant.maxRequests,
      revoked: false,
    });
    return token;
  }

  /**
   * 核验一次 bootstrap/asset 请求：令牌有效、未过期、预算内。
   * 每次成功核验消耗一次请求预算。过期条目顺便清理。
   */
  verify(
    token: string,
    nowMs: number = Date.now(),
  ): ValidationSessionGrant {
    this.sweepExpired(nowMs);
    const entry = this.sessions.get(token);
    if (!entry || entry.revoked) {
      throw new ValidationSessionRejection("validation_session_invalid");
    }
    const presented = this.digest(token);
    if (
      presented.length !== entry.tokenDigest.length ||
      !timingSafeEqual(presented, entry.tokenDigest)
    ) {
      throw new ValidationSessionRejection("validation_session_invalid");
    }
    if (entry.grant.expiresAtMs <= nowMs) {
      this.sessions.delete(token);
      throw new ValidationSessionRejection("validation_session_expired");
    }
    if (entry.remainingRequests <= 0) {
      throw new ValidationSessionRejection(
        "validation_session_request_limit_exceeded",
      );
    }
    entry.remainingRequests -= 1;
    return entry.grant;
  }

  /** 资产读取的 allowlist 核对（在 verify 成功后调用）。 */
  assertAssetAllowed(grant: ValidationSessionGrant, assetId: string): void {
    if (!grant.assetAllowlist.includes(assetId)) {
      throw new ValidationSessionRejection(
        "validation_session_asset_forbidden",
      );
    }
  }

  /** job 结束（成功/失败/超时）：吊销 capability，后续请求一律拒绝。 */
  revoke(token: string): void {
    const entry = this.sessions.get(token);
    if (entry) entry.revoked = true;
    this.sessions.delete(token);
  }

  /** 清理过期条目（有界：每次 verify 附带执行）。 */
  private sweepExpired(nowMs: number): void {
    if (this.sessions.size < 64) return;
    for (const [token, entry] of this.sessions) {
      if (entry.revoked || entry.grant.expiresAtMs <= nowMs) {
        this.sessions.delete(token);
      }
    }
  }

  private digest(token: string): Buffer {
    return createHmac("sha256", this.secret).update(token).digest();
  }
}
