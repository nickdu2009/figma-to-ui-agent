/**
 * DesignAsset 提取 worker（设计 §5.4，计划 S7 动作 2/3）：
 * - job 只按 queued→running→succeeded|failed 条件推进（CAS）；
 * - worker 以有界租约 claim queued job；成功在单事务内创建新 immutable
 *   ready Extraction、写 resultExtractionId 并以 Source CAS 切换
 *   readyExtractionId；失败 failJob + markExtractionFailed；
 * - 租约到期由 reconciliation 处理（不在此自动重试）；
 * - 提取器确定性（p0-deterministic-v1）：PNG/SVG 做真实色彩采样，
 *   其余 kind 的 palette/typography 诚实留空，枚举提示由内容哈希位派生；
 * - job 表不保存提取正文；原始 PDF/截图/OCR 不进入日志。
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import {
  DESIGN_ASSET_SCHEMA_VERSION,
  EXTRACTOR_PROFILE_VERSION,
  validateStructuredSummary,
  type DesignAssetStructuredSummaryV1,
} from "./contracts.ts";
import { digestCanonicalJsonSync } from "../bundle/digests.ts";
import type { DesignAssetRepository } from "../repositories/design-asset-repository.ts";
import type { BlobStore } from "./blob-store.ts";
import { designAssetError } from "./contracts.ts";

/** PNG 真实采样：解码 8-bit truecolor/gray（含 RGBA），返回最高频颜色。 */
function extractPngColors(bytes: Uint8Array): Array<{ hex: string; count: number }> {
  if (bytes.length < 8) return [];
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= view.length) {
    const length = view.readUInt32BE(offset);
    const type = view.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = view.readUInt32BE(dataStart);
      height = view.readUInt32BE(dataStart + 4);
      bitDepth = view[dataStart + 8];
      colorType = view[dataStart + 9];
    } else if (type === "IDAT") {
      idat.push(view.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // chunk 数据 + CRC
  }
  if (width === 0 || height === 0 || bitDepth !== 8) return [];
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (channels === 0) return [];
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return [];
  }
  const stride = width * channels;
  if (raw.length < stride * height) return [];
  // 反滤波（Paeth）重建逐行像素。
  const pixels = Buffer.alloc(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const row = raw.subarray(rowStart, rowStart + stride);
    const target = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? target[x - bpp] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= bpp ? prior[x - bpp] : 0;
      let value = row[x];
      switch (filter) {
        case 1: value = (value + a) & 0xff; break;
        case 2: value = (value + b) & 0xff; break;
        case 3: value = (value + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (value + pred) & 0xff;
          break;
        }
        default: break;
      }
      target[x] = value;
    }
  }
  // 均匀采样统计颜色频率（确定性）。
  const counter = new Map<string, number>();
  const sampleStep = Math.max(1, Math.floor((width * height) / 20000));
  let sampled = 0;
  for (let i = 0; i < width * height && sampled < 20000; i += sampleStep, sampled += 1) {
    const base = i * channels;
    const alpha = channels === 4 ? pixels[base + 3] : 255;
    if (alpha < 32) continue; // 透明像素不进入 palette
    const hex = `#${[pixels[base], pixels[base + 1], pixels[base + 2]]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
    counter.set(hex, (counter.get(hex) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((x, y) => (y.count - x.count) || (x.hex < y.hex ? -1 : 1))
    .slice(0, 8);
}

/** SVG 文本色彩：fill/stroke/stop-color 的 #rrggbb 属性（确定性）。 */
function extractSvgColors(bytes: Uint8Array): Array<{ hex: string; count: number }> {
  const text = Buffer.from(bytes).toString("utf8").slice(0, 512 * 1024);
  const counter = new Map<string, number>();
  const pattern = /(?:fill|stroke|stop-color|color)="#([0-9a-fA-F]{6})"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const hex = `#${match[1].toLowerCase()}`;
    counter.set(hex, (counter.get(hex) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort((x, y) => (y.count - x.count) || (x.hex < y.hex ? -1 : 1))
    .slice(0, 8);
}

function extractSvgFontFamilies(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("utf8").slice(0, 512 * 1024);
  const families = new Set<string>();
  const pattern = /font-family="([^"<>]{1,80})"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null && families.size < 4) {
    families.add(match[1].split(",")[0].trim());
  }
  return [...families];
}

function luminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * 确定性提取 strict DesignAssetStructuredSummaryV1。
 * - PNG/SVG：真实色彩采样 → palette（角色按亮度/饱和度确定性分配）；
 * - 枚举提示由内容哈希位确定性派生（无 LLM、无 OCR、无自由文本）；
 * - 哈希派生不产生颜色：PDF/字体等 palette/typography 留空（诚实边界）。
 */
export function extractStructuredSummary(input: {
  kind: "image" | "svg" | "font" | "pdf";
  mimeType: string;
  bytes: Uint8Array;
}): DesignAssetStructuredSummaryV1 {
  const hashHex = createHash("sha256").update(input.bytes).digest("hex");
  const hashBits = (nibbleIndex: number) =>
    Number.parseInt(hashHex[nibbleIndex], 16);

  let colors: Array<{ hex: string; count: number }> = [];
  if (input.kind === "image" && input.mimeType === "image/png") {
    colors = extractPngColors(input.bytes);
  } else if (input.kind === "svg") {
    colors = extractSvgColors(input.bytes);
  }

  const roles: DesignAssetStructuredSummaryV1["palette"] = [];
  const sortedByLum = [...colors].sort((x, y) => luminance(x.hex) - luminance(y.hex));
  const usedHex = new Set<string>();
  const take = (hex: string, role: DesignAssetStructuredSummaryV1["palette"][number]["role"]) => {
    if (usedHex.has(hex) || roles.length >= 8) return;
    usedHex.add(hex);
    roles.push({ role, color: hex });
  };
  if (sortedByLum.length > 0) {
    take(sortedByLum[sortedByLum.length - 1].hex, "background");
    take(sortedByLum[0].hex, "text");
    const mostSaturated = [...colors].sort(
      (x, y) => saturation(y.hex) - saturation(x.hex) || y.count - x.count,
    );
    if (mostSaturated[0]) take(mostSaturated[0].hex, "primary");
    if (mostSaturated[1]) take(mostSaturated[1].hex, "secondary");
    if (mostSaturated[2]) take(mostSaturated[2].hex, "accent");
    for (const entry of colors) {
      if (roles.length >= 6) break;
      take(entry.hex, "surface");
    }
  }

  const typography: DesignAssetStructuredSummaryV1["typography"] = [];
  if (input.kind === "svg") {
    for (const family of extractSvgFontFamilies(input.bytes)) {
      if (typography.length >= 4) break;
      typography.push({
        role: typography.length === 0 ? "display" : "body",
        familyName: family,
        genericFamily: /serif/i.test(family) && !/sans/i.test(family) ? "serif" : "sans-serif",
      });
    }
  }

  const pick = <T,>(values: readonly T[], count: number, seed: number): T[] => {
    const picked: T[] = [];
    for (let index = 0; index < count; index += 1) {
      picked.push(values[(seed + index * 3) % values.length]);
    }
    return picked;
  };

  return {
    palette: roles,
    typography,
    voiceTraits: pick(
      ["clear", "friendly", "calm", "technical", "bold", "playful", "formal", "energetic"] as const,
      1 + hashBits(0) % 3,
      hashBits(1),
    ),
    layoutHints: pick(
      ["spacious", "card-grid", "single-column", "split-layout", "editorial", "rounded", "strong-hierarchy", "dense"] as const,
      1 + hashBits(2) % 3,
      hashBits(3),
    ),
    imageStyleTags: pick(
      ["photographic", "illustrative", "geometric", "natural", "product-focused", "monochrome"] as const,
      1 + hashBits(4) % 2,
      hashBits(5),
    ),
  };
}

export interface ExtractionWorker {
  /**
   * 处理至多一个 job（调用方轮询）：
   * - claim（租约 TTL）→ markExtracting → 读 Blob 字节（缺失 fail closed）
   *   → 确定性提取 → strict 校验 → 单事务完成 → 返回 "completed"；
   * - 提取/校验失败：failJob(extraction_invalid_summary) + markExtractionFailed；
   * - 无 queued job：返回 "idle"。
   */
  runOnce(): Promise<"completed" | "failed" | "idle">;
}

export function createExtractionWorker(input: {
  repository: DesignAssetRepository;
  blobStore: BlobStore;
  leaseOwner: string;
  leaseTtlMs: number;
}): ExtractionWorker {
  const { repository, blobStore, leaseOwner, leaseTtlMs } = input;
  return {
    async runOnce() {
      const job = await repository.findNextClaimableJob();
      if (!job) return "idle";
      const claimed = await repository.claimJob({
        jobId: job.id,
        leaseOwner,
        leaseTtlMs,
      });
      if (!claimed) return "idle"; // 并发竞争失者直接退出

      const source = await repository.findSourceById(job.sourceId);
      const blob = await repository.findBlob(job.sourceContentHash);
      if (!source || !blob) {
        await repository.failJob({
          jobId: job.id,
          leaseOwner,
          stableErrorCode: "extraction_source_missing",
        });
        return "failed";
      }
      const promoted = await repository.markExtracting({ sourceId: source.id });
      if (!promoted) {
        await repository.failJob({
          jobId: job.id,
          leaseOwner,
          stableErrorCode: "extraction_source_state_conflict",
        });
        return "failed";
      }

      try {
        // DB 行的 kind 为 string；收窄到闭合联合（越界值 fail closed）。
        const kind =
          blob.kind === "image" ||
          blob.kind === "svg" ||
          blob.kind === "font" ||
          blob.kind === "pdf"
            ? blob.kind
            : null;
        if (kind === null) {
          throw designAssetError("asset_invalid");
        }
        const bytes = await blobStore.read(
          // 相对路径由哈希派生（BlobStore 内部二次防御）。
          `sha256/${blob.contentHash.replace(/^sha256:/, "").slice(0, 2)}/${blob.contentHash.replace(/^sha256:/, "")}`,
        );
        if (bytes.byteLength !== blob.byteLength) {
          throw designAssetError("asset_byte_length_mismatch");
        }
        const summary = extractStructuredSummary({
          kind,
          mimeType: blob.mimeType,
          bytes,
        });
        // strict 校验 + canonical 大小 Gate（摘要正文只在内存/事务内存在）。
        const { summary: sanitized, canonical } = validateStructuredSummary(summary);
        const summaryDigest = digestCanonicalJsonSync(sanitized);
        const result = await repository.completeExtractionTransaction({
          jobId: job.id,
          leaseOwner,
          sourceId: source.id,
          extraction: {
            sourceContentHash: blob.contentHash,
            extractorProfileVersion: EXTRACTOR_PROFILE_VERSION,
            schemaVersion: DESIGN_ASSET_SCHEMA_VERSION,
            structuredSummary: sanitized,
            summaryDigest,
            byteLength: Buffer.byteLength(canonical, "utf8"),
          },
        });
        if (!result) {
          // CAS 失败（租约被夺/状态冲突）：不覆盖任何历史 ready 行。
          return "failed";
        }
        return "completed";
      } catch {
        await repository
          .failJob({
            jobId: job.id,
            leaseOwner,
            stableErrorCode: "extraction_invalid_summary",
          })
          .catch(() => undefined);
        await repository
          .markExtractionFailed({ sourceId: source.id })
          .catch(() => undefined);
        return "failed";
      }
    },
  };
}
