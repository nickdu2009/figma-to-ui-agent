/**
 * Bundle 字节/数量门禁（设计 §5.1/§11.3 + DS-GATE-00 批准的 2 MiB 上限）：
 * - uiBundle canonical JSON ≤ 2 MiB UTF-8；
 * - applicationCss ≤ 128 KiB；
 * - Asset 清单条目 ≤ 100，总字节 ≤ 50 MiB；
 * - 单文件上限：image ≤ 8 MiB、svg ≤ 1 MiB、font ≤ 2 MiB；
 * - 字体 ≤ 2 个 family × 每个 family ≤ 4 个 weight；
 * - 图片宽高 ≤ 4096（由 app-ui-bundle schema 同步强制）。
 * 所有失败返回稳定错误码，fail closed。
 */
import type { AppUiBundle } from "./app-ui-bundle.ts";
import { canonicalJsonByteLength } from "./canonical-json.ts";

export const BUNDLE_MAX_BYTES = 2 * 1024 * 1024;
export const APPLICATION_CSS_MAX_BYTES = 128 * 1024;
export const ASSET_MAX_ENTRIES = 100;
export const ASSET_TOTAL_MAX_BYTES = 50 * 1024 * 1024;
export const ASSET_KIND_MAX_BYTES = {
  image: 8 * 1024 * 1024,
  svg: 1 * 1024 * 1024,
  font: 2 * 1024 * 1024,
} as const;
export const FONT_MAX_FAMILIES = 2;
export const FONT_MAX_WEIGHTS_PER_FAMILY = 4;

export type BundleGateCode =
  | "bundle_too_large"
  | "css_too_large"
  | "asset_count_exceeded"
  | "asset_total_bytes_exceeded"
  | "asset_file_too_large"
  | "font_family_exceeded"
  | "font_weight_exceeded";

export type BundleGateResult =
  | { ok: true }
  | { ok: false; code: BundleGateCode; message: string };

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fail(code: BundleGateCode, message: string): BundleGateResult {
  return { ok: false, code, message };
}

/** 对已通过 appUiBundleSchema 的 bundle 做字节/数量门禁。 */
export function validateBundleGates(bundle: AppUiBundle): BundleGateResult {
  if (canonicalJsonByteLength(bundle) > BUNDLE_MAX_BYTES) {
    return fail(
      "bundle_too_large",
      `AppUiBundle canonical JSON 超过 ${BUNDLE_MAX_BYTES} 字节上限`,
    );
  }

  if (utf8ByteLength(bundle.designSystem.applicationCss) > APPLICATION_CSS_MAX_BYTES) {
    return fail(
      "css_too_large",
      `applicationCss 超过 ${APPLICATION_CSS_MAX_BYTES} 字节上限`,
    );
  }

  const entries = bundle.assets.entries;
  if (entries.length > ASSET_MAX_ENTRIES) {
    return fail(
      "asset_count_exceeded",
      `Asset 清单条目 ${entries.length} 超过 ${ASSET_MAX_ENTRIES} 上限`,
    );
  }

  let totalBytes = 0;
  const fontWeightsByFamily = new Map<string, Set<number>>();
  for (const entry of entries) {
    totalBytes += entry.byteLength;
    if (totalBytes > ASSET_TOTAL_MAX_BYTES) {
      return fail(
        "asset_total_bytes_exceeded",
        `Asset 总字节超过 ${ASSET_TOTAL_MAX_BYTES} 上限`,
      );
    }
    const kindMax = ASSET_KIND_MAX_BYTES[entry.kind];
    if (entry.byteLength > kindMax) {
      return fail(
        "asset_file_too_large",
        `Asset ${entry.assetId}（${entry.kind}）字节 ${entry.byteLength} 超过 ${kindMax} 上限`,
      );
    }
    if (entry.font) {
      const weights = fontWeightsByFamily.get(entry.font.family) ?? new Set<number>();
      weights.add(entry.font.weight);
      fontWeightsByFamily.set(entry.font.family, weights);
      if (fontWeightsByFamily.size > FONT_MAX_FAMILIES) {
        return fail(
          "font_family_exceeded",
          `字体 family 超过 ${FONT_MAX_FAMILIES} 个上限`,
        );
      }
      if (weights.size > FONT_MAX_WEIGHTS_PER_FAMILY) {
        return fail(
          "font_weight_exceeded",
          `字体 family ${entry.font.family} 的 weight 超过 ${FONT_MAX_WEIGHTS_PER_FAMILY} 个上限`,
        );
      }
    }
  }

  return { ok: true };
}
