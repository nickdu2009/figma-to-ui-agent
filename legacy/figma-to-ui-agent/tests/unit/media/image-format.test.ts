import { describe, expect, it } from "vitest";

import {
  ImageFormatError,
  inspectImageBytes,
} from "../../../src/media/image-format.ts";
import {
  createJpegBytes,
  createPngBytes,
  createWebpBytes,
} from "../../fixtures/images.ts";

describe("inspectImageBytes", () => {
  it("识别 PNG、JPEG 和 WebP 尺寸", () => {
    expect(inspectImageBytes(createPngBytes(2, 3))).toEqual({
      mimeType: "image/png",
      extension: "png",
      width: 2,
      height: 3,
    });
    expect(inspectImageBytes(createJpegBytes(4, 5))).toEqual({
      mimeType: "image/jpeg",
      extension: "jpg",
      width: 4,
      height: 5,
    });
    expect(inspectImageBytes(createWebpBytes(6, 7))).toEqual({
      mimeType: "image/webp",
      extension: "webp",
      width: 6,
      height: 7,
    });
  });

  it("拒绝未知、截断和超限图片", () => {
    expect(() => inspectImageBytes(Uint8Array.from([1, 2, 3]))).toThrow(
      ImageFormatError,
    );
    expect(() =>
      inspectImageBytes(
        Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
      ),
    ).toThrow("PNG 文件不完整");
    expect(() =>
      inspectImageBytes(createPngBytes(40_000, 1)),
    ).toThrow("图片尺寸无效或超过上限");
    const invalidPng = createPngBytes(1, 1);
    invalidPng.set([0x42, 0x41, 0x44, 0x21], 12);
    expect(() => inspectImageBytes(invalidPng)).toThrow(
      "PNG 缺少首个 IHDR 块",
    );
  });
});
