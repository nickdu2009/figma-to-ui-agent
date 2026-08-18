/**
 * S7：日志与 AG-UI 错误的统一截断与脱敏。
 * 不得向日志或客户端事件输出令牌、完整 Spec、完整业务记录或凭据样式值。
 */

const MAX_MESSAGE_LENGTH = 200;

/** 令牌/密钥样式：长连排 base64url/hex（>=24 字符）、Bearer 值、常见密钥前缀。 */
const SENSITIVE_PATTERNS: RegExp[] = [
 /Bearer\s+\S+/gi,
 /\b(?:sk|pk|token|secret|apikey|api_key|password|passwd|otp)[-_]?[A-Za-z0-9+/=_-]{8,}\b/gi,
 /\b[A-Za-z0-9_-]{24,}\b/g,
];

export function redactText(input: string): string {
 // 先截断再脱敏：超长输入必须始终带截断标记
 let out = input;
 if (out.length > MAX_MESSAGE_LENGTH) {
  out = `${out.slice(0, MAX_MESSAGE_LENGTH)}…[truncated]`;
 }
 for (const pattern of SENSITIVE_PATTERNS) {
  out = out.replace(pattern, "[redacted]");
 }
 return out;
}

/** 面向 AG-UI RUN_ERROR 等客户端可见事件的消息脱敏。 */
export function redactEventMessage(input: unknown): string {
 if (typeof input === "string") return redactText(input);
 if (input instanceof Error) return redactText(input.message);
 return redactText(String(input));
}

/** 面向服务端日志的错误脱敏：只保留 name + 脱敏消息，不输出 stack/对象正文。 */
export function redactForLog(error: unknown): string {
 if (error instanceof Error) {
  return `${error.name}: ${redactText(error.message)}`;
 }
 return redactText(String(error));
}
