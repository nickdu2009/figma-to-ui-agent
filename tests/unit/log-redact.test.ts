/**
 * S7：日志/事件脱敏单元测试（不依赖数据库）。
 */
import { describe, expect, it } from "vitest";
import {
  redactEventMessage,
  redactForLog,
  redactText,
} from "../../server/log-redact.ts";

describe("log-redact", () => {
  it("截断超长消息", () => {
    const long = "x".repeat(500);
    const out = redactText(long);
    expect(out.length).toBeLessThan(230);
    expect(out).toContain("[truncated]");
  });

  it("脱敏 Bearer 令牌与密钥样式值", () => {
    expect(redactText("Authorization: Bearer abc.def.ghi")).toContain(
      "[redacted]",
    );
    expect(redactText("key = sk-abcdef1234567890")).toContain("[redacted]");
    expect(
      redactText("token abcdefgh12345678abcdefgh12345678 出现在正文"),
    ).toContain("[redacted]");
  });

  it("redactForLog 不输出 stack，只保留 name + 脱敏消息", () => {
    const error = new Error("db password=secret-abcdef123456 failed");
    const out = redactForLog(error);
    expect(out.startsWith("Error: ")).toBe(true);
    expect(out).not.toContain("secret-abcdef123456");
    expect(out).not.toContain("at ");
  });

  it("redactEventMessage 处理字符串/Error/其他", () => {
    expect(redactEventMessage("plain")).toBe("plain");
    expect(redactEventMessage(new Error("boom"))).toBe("boom");
    expect(redactEventMessage(42)).toBe("42");
  });
});
