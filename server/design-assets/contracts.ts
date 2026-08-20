/**
 * DesignAsset 领域契约（设计 §5.4，计划 S7）：
 * - strict DesignAssetStructuredSummaryV1（schemaVersion=1 与 Schema 一一对应）；
 * - 边界：per-app source ≤20 项、引用去重 Blob 合计 ≤100 MiB；
 *   单次生成 ≤8 个 ready source；单份摘要 canonical JSON ≤64 KiB、
 *   合计 ≤256 KiB UTF-8；
 * - 目的/状态枚举与 Blob kind 闭合；
 * - MIME 白名单与魔数约束（service 校验时消费）；
 * - 稳定错误码（fail closed，不泄露资源存在性差异）。
 *
 * 原始 PDF/截图/OCR/路径不进入模型、Patch、AG-UI 或日志。
 */
import { z } from "zod";

import { canonicalJsonString } from "../../src/catalog/canonical-json.ts";

/** P0 提取器 profile 版本（摘要 Schema 与提取行为绑定）。 */
export const EXTRACTOR_PROFILE_VERSION = "p0-deterministic-v1";

export const DESIGN_ASSET_SCHEMA_VERSION = 1;

/** per-app 有效/恢复窗口 source 上限（§11 表）。 */
export const PER_APP_SOURCE_LIMIT = 20;
/** per-app 引用去重 Blob 合计字节上限（100 MiB）。 */
export const PER_APP_TOTAL_BLOB_BYTES = 100 * 1024 * 1024;
/** 单次生成品牌资料 ready source 上限。 */
export const PER_GENERATION_SOURCE_REFS = 8;
/** 单份摘要 canonical JSON 上限（64 KiB）。 */
export const SUMMARY_MAX_BYTES = 64 * 1024;
/** 单次生成全部摘要合计 UTF-8 上限（256 KiB）。 */
export const GENERATION_SUMMARIES_MAX_BYTES = 256 * 1024;

/** V1 数组字段上限（§5.4）。 */
export const SUMMARY_ARRAY_LIMITS = {
  palette: 16,
  typography: 8,
  voiceTraits: 5,
  layoutHints: 8,
  imageStyleTags: 8,
} as const;

/** ECMAScript Unicode WhiteSpace（IsWhiteSpace 及类别 Zs）。 */
const ECMASCRIPT_WHITESPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/;

/** 自由字符串禁入：控制字符、双向控制符、CR/LF、://、www.、<、>。 */
const FORBIDDEN_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b-\u200f\u200e]|:\/\/|www\.|[<>]/;

/** NFKC + 首尾 ECMAScript 空白剥离（内部字符顺序与空白保持不变）。 */
function sanitizeFreeText(maxCodePoints: number): (value: string) => string {
  return (value) => {
    const normalized = value.normalize("NFKC");
    let start = 0;
    let end = normalized.length;
    while (start < end && ECMASCRIPT_WHITESPACE.test(normalized[start])) start += 1;
    while (end > start && ECMASCRIPT_WHITESPACE.test(normalized[end - 1])) end -= 1;
    const trimmed = normalized.slice(start, end);
    if ([...trimmed].length > maxCodePoints) {
      throw new Error(`free_text_too_long`);
    }
    if (FORBIDDEN_TEXT_PATTERN.test(trimmed)) {
      throw new Error("free_text_forbidden");
    }
    return trimmed;
  };
}

const paletteRoleSchema = z.enum([
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "success",
  "warning",
  "danger",
  "other",
]);

const typographyRoleSchema = z.enum([
  "display",
  "heading",
  "body",
  "label",
  "caption",
  "other",
]);

const voiceTraitSchema = z.enum([
  "clear",
  "concise",
  "formal",
  "friendly",
  "playful",
  "authoritative",
  "calm",
  "bold",
  "technical",
  "premium",
  "inclusive",
  "energetic",
]);

const layoutHintSchema = z.enum([
  "spacious",
  "dense",
  "editorial",
  "card-grid",
  "split-layout",
  "single-column",
  "strong-hierarchy",
  "rounded",
  "sharp",
  "asymmetric",
  "centered",
]);

const imageStyleTagSchema = z.enum([
  "photographic",
  "illustrative",
  "geometric",
  "abstract",
  "monochrome",
  "duotone",
  "high-contrast",
  "soft-light",
  "natural",
  "product-focused",
  "people-focused",
  "iconographic",
]);

/**
 * strict DesignAssetStructuredSummaryV1：未知字段拒绝、全部数组必填
 * （允许为空）、palette/typography role 唯一、三个枚举数组内部不重复。
 */
export const designAssetStructuredSummaryV1Schema = z
  .object({
    palette: z
      .array(
        z
          .object({
            role: paletteRoleSchema,
            color: z.string().regex(/^#[0-9a-f]{6}$/),
            label: z.string().optional(),
          })
          .strict(),
      )
      .max(SUMMARY_ARRAY_LIMITS.palette),
    typography: z
      .array(
        z
          .object({
            role: typographyRoleSchema,
            familyName: z.string().optional(),
            genericFamily: z.enum([
              "sans-serif",
              "serif",
              "monospace",
              "system-ui",
            ]),
            weight: z
              .union([
                z.literal(100),
                z.literal(200),
                z.literal(300),
                z.literal(400),
                z.literal(500),
                z.literal(600),
                z.literal(700),
                z.literal(800),
                z.literal(900),
              ])
              .optional(),
            style: z.enum(["normal", "italic"]).optional(),
          })
          .strict(),
      )
      .max(SUMMARY_ARRAY_LIMITS.typography),
    voiceTraits: z.array(voiceTraitSchema).max(SUMMARY_ARRAY_LIMITS.voiceTraits),
    layoutHints: z.array(layoutHintSchema).max(SUMMARY_ARRAY_LIMITS.layoutHints),
    imageStyleTags: z
      .array(imageStyleTagSchema)
      .max(SUMMARY_ARRAY_LIMITS.imageStyleTags),
  })
  .strict()
  .superRefine((summary, ctx) => {
    const paletteRoles = new Set<string>();
    for (const entry of summary.palette) {
      if (paletteRoles.has(entry.role)) {
        ctx.addIssue({ code: "custom", message: "palette_role_duplicate" });
        return;
      }
      paletteRoles.add(entry.role);
    }
    const typographyRoles = new Set<string>();
    for (const entry of summary.typography) {
      if (typographyRoles.has(entry.role)) {
        ctx.addIssue({ code: "custom", message: "typography_role_duplicate" });
        return;
      }
      typographyRoles.add(entry.role);
    }
    for (const [key, values] of [
      ["voiceTraits", summary.voiceTraits],
      ["layoutHints", summary.layoutHints],
      ["imageStyleTags", summary.imageStyleTags],
    ] as const) {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({ code: "custom", message: `${key}_duplicate` });
        return;
      }
    }
  })
  .transform((summary) => ({
    palette: summary.palette.map((entry) => ({
      ...entry,
      ...(entry.label === undefined
        ? {}
        : { label: sanitizeFreeText(40)(entry.label) }),
    })),
    typography: summary.typography.map((entry) => ({
      ...entry,
      ...(entry.familyName === undefined
        ? {}
        : { familyName: sanitizeFreeText(80)(entry.familyName) }),
    })),
    voiceTraits: [...summary.voiceTraits],
    layoutHints: [...summary.layoutHints],
    imageStyleTags: [...summary.imageStyleTags],
  }));

export type DesignAssetStructuredSummaryV1 = z.output<
  typeof designAssetStructuredSummaryV1Schema
>;

/**
 * 消毒后的 strict 摘要校验 + canonical 大小 Gate：
 * 通过时返回消毒摘要与 canonical JSON 串（供 summaryDigest）。
 */
export function validateStructuredSummary(
  input: unknown,
): { summary: DesignAssetStructuredSummaryV1; canonical: string } {
  const summary = designAssetStructuredSummaryV1Schema.parse(input);
  const canonical = canonicalJsonString(summary);
  if (Buffer.byteLength(canonical, "utf8") > SUMMARY_MAX_BYTES) {
    throw new Error("summary_too_large");
  }
  return { summary, canonical };
}

/** Blob kind ↔ 允许的 MIME（魔数核对在 blob-store）。 */
export const BLOB_MIME_ALLOWLIST: Record<string, readonly string[]> = {
  image: [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ],
  svg: ["image/svg+xml"],
  font: [
    "font/woff",
    "font/woff2",
    "application/font-woff",
    "font/ttf",
    "font/otf",
    "application/octet-stream",
  ],
  pdf: ["application/pdf"],
};

/** 魔数前缀（十六进制）；font/ttf/otf 走 application/octet-stream 兜底后按魔数判别。 */
export const BLOB_MAGIC_NUMBERS: ReadonlyArray<{
  kind: "image" | "svg" | "font" | "pdf";
  prefixHex: string;
  mime: string;
}> = [
  { kind: "image", prefixHex: "89504e470d0a1a0a", mime: "image/png" },
  { kind: "image", prefixHex: "ffd8ff", mime: "image/jpeg" },
  { kind: "image", prefixHex: "52494646", mime: "image/webp" }, // RIFF….WEBP
  { kind: "image", prefixHex: "47494638", mime: "image/gif" },
  { kind: "pdf", prefixHex: "25504446", mime: "application/pdf" },
  { kind: "font", prefixHex: "774f4646", mime: "font/woff" }, // wOFF
  { kind: "font", prefixHex: "774f4632", mime: "font/woff2" }, // wOF2
  { kind: "font", prefixHex: "0001000000", mime: "application/octet-stream" }, // ttf
  { kind: "font", prefixHex: "4f54544f", mime: "application/octet-stream" }, // OTTO
];

/** 上传资源单文件上限（20 MiB）。 */
export const BLOB_MAX_BYTES = 20 * 1024 * 1024;

/** 稳定错误码（响应不区分资产是否存在）。 */
export type DesignAssetErrorCode =
  | "asset_not_found"
  | "asset_forbidden"
  | "asset_invalid"
  | "asset_limit_exceeded"
  | "asset_store_unavailable"
  | "asset_hash_mismatch"
  | "asset_mime_forbidden"
  | "asset_magic_mismatch"
  | "asset_byte_length_mismatch"
  | "extraction_immutable"
  | "extraction_worker_lost"
  | "extraction_invalid_summary";

export function designAssetError(code: DesignAssetErrorCode): Error & {
  readonly code: DesignAssetErrorCode;
} {
  const error = new Error(code) as Error & { code: DesignAssetErrorCode };
  error.code = code;
  return error;
}
