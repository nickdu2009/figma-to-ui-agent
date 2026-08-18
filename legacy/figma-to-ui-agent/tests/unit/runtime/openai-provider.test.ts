import { describe, expect, it } from "vitest";

import {
  buildOpenAiModelsConfig,
  normalizeOpenAiBaseUrl,
} from "../../../src/runtime/openai-provider.ts";

describe("normalizeOpenAiBaseUrl", () => {
  it("把 HTTPS 根地址规范化到 /v1", () => {
    expect(normalizeOpenAiBaseUrl("https://gateway.example.com/")).toBe(
      "https://gateway.example.com/v1",
    );
  });

  it("保留已有的兼容 API 路径并移除结尾斜杠", () => {
    expect(
      normalizeOpenAiBaseUrl("https://gateway.example.com/openai/v1/"),
    ).toBe("https://gateway.example.com/openai/v1");
  });

  it.each([
    "http://gateway.example.com",
    "https://user:secret@gateway.example.com",
    "https://gateway.example.com?token=secret",
    "not-a-url",
  ])("拒绝不安全或无效地址：%s", (value) => {
    expect(() => normalizeOpenAiBaseUrl(value)).toThrow();
  });

  it("生成不包含真实凭据的 Pi provider 配置", () => {
    expect(
      buildOpenAiModelsConfig("https://gateway.example.com"),
    ).toEqual({
      providers: {
        openai: {
          baseUrl: "https://gateway.example.com/v1",
          apiKey: "$OPENAI_API_KEY",
        },
      },
    });
  });
});
