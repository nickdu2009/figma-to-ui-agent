/**
 * 通用 canonical JSON helper（设计 §10.1）：
 * - 数组保持顺序；
 * - 对象键按 UTF-16 字典序递归排序；
 * - `JSON.stringify` 为 UTF-8 后计算 SHA-256，输出 `sha256:` + 64 位小写十六进制。
 *
 * v1 摘要语义与 `server/release/service.ts` 的 canonicalBusinessSchema 完全一致，
 * 服务端与浏览器共享 uiBundleDigest 的 serializer。完整 Candidate serializer
 * 仍为 server-only（见 server/bundle/digests.ts）。
 */

export type Sha256Digest = `sha256:${string}`;

/** 与 canonicalBusinessSchema 一致的 UTF-16 字典序比较。 */
function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 递归复制 value：对象键排序，数组保持顺序。 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => compareUtf16(a, b))
      .map(([k, v]) => [k, canonicalize(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/** canonical JSON 字符串（与 canonicalBusinessSchema 相同的序列化语义）。 */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value ?? null));
}

/** canonical JSON 的 UTF-8 字节数。 */
export function canonicalJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonString(value)).byteLength;
}

const HEX = "0123456789abcdef";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += HEX[(byte >> 4) & 0xf] + HEX[byte & 0xf];
  return out;
}

/**
 * 计算 canonical JSON 的 SHA-256 摘要（`sha256:` + 64 位小写十六进制）。
 * 使用 WebCrypto，浏览器与 Node >= 18 均可用（异步）。
 */
export async function digestCanonicalJson(value: unknown): Promise<Sha256Digest> {
  const bytes = new TextEncoder().encode(canonicalJsonString(value));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto subtle digest is unavailable in this environment");
  }
  const hash = await subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return `sha256:${bytesToHex(new Uint8Array(hash))}`;
}

/** `sha256:` + 64 位小写十六进制的格式校验。 */
export function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
