import { describe, expect, it } from "vitest";

import { summarizeProviderInput } from "../../../src/runtime/provider-audit.ts";

describe("summarizeProviderInput", () => {
  it("只提取输入类型并识别图像", () => {
    expect(
      summarizeProviderInput({
        input: [
          {
            type: "message",
            content: [
              { type: "input_text", text: "private prompt" },
              {
                type: "input_image",
                image_url: "data:image/png;base64,private",
              },
            ],
          },
        ],
      }),
    ).toEqual({
      hasImageInput: true,
      inputContentTypes: ["input_image", "input_text", "message"],
    });
  });

  it("没有图像时返回 false", () => {
    expect(
      summarizeProviderInput({
        input: [
          {
            type: "message",
            content: [{ type: "input_text", text: "private prompt" }],
          },
        ],
      }),
    ).toEqual({
      hasImageInput: false,
      inputContentTypes: ["input_text", "message"],
    });
  });
});
