import { describe, expect, it } from "vitest";

import { buildM3PiProcessArgs } from "../../../scripts/m3-agent-process.mjs";

describe("M3 Pi 进程参数", () => {
  it("使用紧凑文本输出且不持久化原始会话", () => {
    const args = buildM3PiProcessArgs([
      "--provider",
      "openai",
      "--model",
      "gpt-5.4",
    ]);

    expect(args).toEqual([
      "--provider",
      "openai",
      "--model",
      "gpt-5.4",
      "--print",
      "--mode",
      "text",
      "--no-session",
    ]);
    expect(args).not.toContain("json");
    expect(args).not.toContain("--name");
  });
});
