export type SupportedFontMime =
  | "font/woff2"
  | "font/woff"
  | "font/ttf"
  | "font/otf";

export interface InspectedFont {
  mimeType: SupportedFontMime;
  extension: "woff2" | "woff" | "ttf" | "otf";
}

export class FontFormatError extends Error {
  readonly code: "unsupported_format" | "truncated_font";

  constructor(
    code: "unsupported_format" | "truncated_font",
    message: string,
  ) {
    super(message);
    this.name = "FontFormatError";
    this.code = code;
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

export function inspectFontBytes(bytes: Uint8Array): InspectedFont {
  if (bytes.length < 4) {
    throw new FontFormatError("truncated_font", "字体文件不完整");
  }

  const signature = ascii(bytes, 0, 4);
  if (signature === "wOF2") {
    return { mimeType: "font/woff2", extension: "woff2" };
  }
  if (signature === "wOFF") {
    return { mimeType: "font/woff", extension: "woff" };
  }
  if (signature === "OTTO") {
    return { mimeType: "font/otf", extension: "otf" };
  }
  if (
    (bytes[0] === 0x00 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x00) ||
    signature === "true"
  ) {
    return { mimeType: "font/ttf", extension: "ttf" };
  }

  throw new FontFormatError(
    "unsupported_format",
    "字体魔数不属于受支持格式",
  );
}
