import { createHash, randomBytes, randomInt } from "node:crypto";

/**
 * 令牌与摘要（设计 §4.1/§6.3）：
 * - 原始令牌只出现在投递邮件与 Cookie 中，库中只存 SHA-256 摘要；
 * - 原始令牌不得进入普通日志、聊天记录或审计正文。
 */

export function generateSessionToken(): string {
 // 256 bit 不透明会话令牌
 return randomBytes(32).toString("base64url");
}

export function generateMagicLinkToken(): string {
 return randomBytes(32).toString("base64url");
}

/** 6 位数字 OTP。 */
export function generateOtpCode(): string {
 return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function sha256Digest(value: string): string {
 return createHash("sha256").update(value, "utf8").digest("hex");
}
