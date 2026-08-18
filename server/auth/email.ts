/**
 * 账号邮箱规范化（设计 §4.1/§9）：trim + Unicode NFC + 小写。
 * 规范化结果是唯一身份标识；唯一约束列使用 utf8mb4_bin（大小写敏感精确），
 * 规范化负责把等价书写折叠到同一形式。normalizationVersion: 1。
 */
export const EMAIL_NORMALIZATION_VERSION = 1;

export function normalizeEmail(raw: string): string {
 return raw.normalize("NFC").trim().toLowerCase();
}
