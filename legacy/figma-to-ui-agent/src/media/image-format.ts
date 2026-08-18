export type SupportedImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export interface InspectedImage {
  mimeType: SupportedImageMime;
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

export class ImageFormatError extends Error {
  readonly code:
    | "unsupported_format"
    | "truncated_image"
    | "invalid_dimensions";

  constructor(
    code:
      | "unsupported_format"
      | "truncated_image"
      | "invalid_dimensions",
    message: string,
  ) {
    super(message);
    this.name = "ImageFormatError";
    this.code = code;
  }
}

function assertDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 32_768 ||
    height > 32_768
  ) {
    throw new ImageFormatError(
      "invalid_dimensions",
      "图片尺寸无效或超过上限",
    );
  }
}

function inspectPng(bytes: Uint8Array): InspectedImage | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) {
    return undefined;
  }
  if (bytes.length < 24) {
    throw new ImageFormatError("truncated_image", "PNG 文件不完整");
  }
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    throw new ImageFormatError(
      "unsupported_format",
      "PNG 缺少首个 IHDR 块",
    );
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  assertDimensions(width, height);
  return {
    mimeType: "image/png",
    extension: "png",
    width,
    height,
  };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function inspectJpeg(bytes: Uint8Array): InspectedImage | undefined {
  if (
    bytes.length < 3 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    return undefined;
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (
      marker === 0x01 ||
      (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 1 >= bytes.length) {
      break;
    }
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new ImageFormatError(
        "truncated_image",
        "JPEG 段结构无效",
      );
    }
    if (
      marker !== undefined &&
      JPEG_START_OF_FRAME_MARKERS.has(marker)
    ) {
      if (segmentLength < 7) {
        throw new ImageFormatError(
          "truncated_image",
          "JPEG 尺寸段不完整",
        );
      }
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      assertDimensions(width, height);
      return {
        mimeType: "image/jpeg",
        extension: "jpg",
        width,
        height,
      };
    }
    offset += segmentLength;
  }
  throw new ImageFormatError(
    "truncated_image",
    "JPEG 缺少可识别的尺寸段",
  );
}

function readUint24LittleEndian(
  bytes: Uint8Array,
  offset: number,
): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16)
  );
}

function inspectWebp(bytes: Uint8Array): InspectedImage | undefined {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  if (
    bytes.length < 16 ||
    ascii(0, 4) !== "RIFF" ||
    ascii(8, 4) !== "WEBP"
  ) {
    return undefined;
  }
  const chunk = ascii(12, 4);
  let width: number;
  let height: number;
  if (chunk === "VP8X") {
    if (bytes.length < 30) {
      throw new ImageFormatError("truncated_image", "WebP 文件不完整");
    }
    width = readUint24LittleEndian(bytes, 24) + 1;
    height = readUint24LittleEndian(bytes, 27) + 1;
  } else if (chunk === "VP8 ") {
    if (
      bytes.length < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      throw new ImageFormatError(
        "truncated_image",
        "WebP VP8 帧头无效",
      );
    }
    width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
    height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
  } else if (chunk === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) {
      throw new ImageFormatError(
        "truncated_image",
        "WebP VP8L 帧头无效",
      );
    }
    width = 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8));
    height =
      1 +
      ((bytes[22]! >> 6) |
        (bytes[23]! << 2) |
        ((bytes[24]! & 0x0f) << 10));
  } else {
    throw new ImageFormatError(
      "unsupported_format",
      "WebP 编码类型不受支持",
    );
  }
  assertDimensions(width, height);
  return {
    mimeType: "image/webp",
    extension: "webp",
    width,
    height,
  };
}

export function inspectImageBytes(bytes: Uint8Array): InspectedImage {
  const inspected =
    inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectWebp(bytes);
  if (!inspected) {
    throw new ImageFormatError(
      "unsupported_format",
      "图片魔数不属于受支持格式",
    );
  }
  return inspected;
}
