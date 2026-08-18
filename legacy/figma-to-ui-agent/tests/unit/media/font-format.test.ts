import { describe, expect, it } from "vitest";

import {
  FontFormatError,
  inspectFontBytes,
} from "../../../src/media/font-format.ts";

describe("inspectFontBytes", () => {
  it("识别 WOFF2、WOFF、TTF 和 OTF 魔数", () => {
    expect(inspectFontBytes(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))).toEqual({
      mimeType: "font/woff2",
      extension: "woff2",
    });
    expect(inspectFontBytes(new Uint8Array([0x77, 0x4f, 0x46, 0x46]))).toEqual({
      mimeType: "font/woff",
      extension: "woff",
    });
    expect(inspectFontBytes(new Uint8Array([0x00, 0x01, 0x00, 0x00]))).toEqual({
      mimeType: "font/ttf",
      extension: "ttf",
    });
    expect(inspectFontBytes(new Uint8Array([0x4f, 0x54, 0x54, 0x4f]))).toEqual({
      mimeType: "font/otf",
      extension: "otf",
    });
  });

  it("拒绝截断和不支持的字体", () => {
    expect(() => inspectFontBytes(new Uint8Array([0x77]))).toThrow(
      expect.objectContaining<Partial<FontFormatError>>({
        code: "truncated_font",
      }),
    );
    expect(() =>
      inspectFontBytes(new Uint8Array([0x00, 0x00, 0x00, 0x00])),
    ).toThrow(
      expect.objectContaining<Partial<FontFormatError>>({
        code: "unsupported_format",
      }),
    );
  });
});
