/**
 * Bundle 字节/数量门禁契约测试（S1，设计 §11.3 + DS-GATE-00 批准的 2 MiB 上限）：
 * - 2 MiB bundle、128 KiB css、100 条目、总字节 50 MiB；
 * - 单文件 kind 上限；字体 family/weight 上限；
 * - 所有失败返回稳定错误码。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  appUiBundleSchema,
  type AppUiBundle,
} from "../../src/catalog/app-ui-bundle.js";
import {
  ASSET_KIND_MAX_BYTES,
  ASSET_MAX_ENTRIES,
  BUNDLE_MAX_BYTES,
  validateBundleGates,
} from "../../src/catalog/bundle-gates.js";

const MINIMAL_BUNDLE_PATH = resolve("tests/fixtures/design-system/minimal-bundle.v1.json");

async function loadMinimalBundle(): Promise<AppUiBundle> {
  const raw = JSON.parse(await readFile(MINIMAL_BUNDLE_PATH, "utf8")) as unknown;
  const parsed = appUiBundleSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`夹具无效：${parsed.error.message}`);
  return parsed.data;
}

describe("bundle 字节/数量门禁", () => {
  it("bundle canonical JSON 超过 2 MiB 时拒绝", async () => {
    const bundle = await loadMinimalBundle();
    bundle.spec.state = { ui: { blob: "x".repeat(BUNDLE_MAX_BYTES) } };
    const result = validateBundleGates(bundle);
    expect(result).toMatchObject({ ok: false, code: "bundle_too_large" });
  });

  it("applicationCss 超过 128 KiB 时拒绝", async () => {
    const bundle = await loadMinimalBundle();
    bundle.designSystem.applicationCss = "a".repeat(129 * 1024);
    const result = validateBundleGates(bundle);
    expect(result).toMatchObject({ ok: false, code: "css_too_large" });
  });

  it("Asset 条目超过 100 时拒绝", async () => {
    const bundle = await loadMinimalBundle();
    bundle.assets.entries = Array.from({ length: ASSET_MAX_ENTRIES + 1 }, (_, i) => ({
      assetId: `a${i}`,
      kind: "image" as const,
      contentHash: `sha256:${String(i).padStart(64, "0")}`,
      mimeType: "image/png" as const,
      byteLength: 1,
    }));
    const result = validateBundleGates(bundle);
    expect(result).toMatchObject({ ok: false, code: "asset_count_exceeded" });
  });

  it("Asset 总字节超过 50 MiB 时拒绝", async () => {
    const bundle = await loadMinimalBundle();
    bundle.assets.entries = Array.from({ length: 7 }, (_, i) => ({
      assetId: `big-${i}`,
      kind: "image" as const,
      contentHash: `sha256:${String(i).padStart(64, "0")}`,
      mimeType: "image/png" as const,
      byteLength: 8 * 1024 * 1024,
    }));
    const result = validateBundleGates(bundle);
    expect(result).toMatchObject({ ok: false, code: "asset_total_bytes_exceeded" });
  });

  it("单文件超过 kind 上限时拒绝", async () => {
    const bundle = await loadMinimalBundle();
    bundle.assets.entries = [{
      assetId: "big-svg",
      kind: "svg",
      contentHash: `sha256:${"0".repeat(64)}`,
      mimeType: "image/svg+xml",
      byteLength: ASSET_KIND_MAX_BYTES.svg + 1,
    }];
    const result = validateBundleGates(bundle);
    expect(result).toMatchObject({ ok: false, code: "asset_file_too_large" });
  });

  it("字体 family/weight 超限拒绝", async () => {
    const bundle = await loadMinimalBundle();
    const mkFont = (family: string, weight: 400 | 500 | 600 | 700, i: number) => ({
      assetId: `f-${family}-${weight}-${i}`,
      kind: "font" as const,
      contentHash: `sha256:${String(i).padStart(64, "0")}`,
      mimeType: "font/woff2" as const,
      byteLength: 1,
      font: { family, weight },
    });
    bundle.assets.entries = [
      mkFont("A", 400, 1),
      mkFont("B", 400, 2),
      mkFont("C", 400, 3),
    ];
    expect(validateBundleGates(bundle)).toMatchObject({ ok: false, code: "font_family_exceeded" });
    // gate 层防御：schema 枚举之外的第 5 个 weight（经 validateBundleGates 直接调用）
    bundle.assets.entries = ([400, 500, 600, 700, 900] as const).map((weight, i) => ({
      assetId: `f-A-${weight}`,
      kind: "font" as const,
      contentHash: `sha256:${String(i).padStart(64, "0")}`,
      mimeType: "font/woff2" as const,
      byteLength: 1,
      font: { family: "A", weight: weight as 400 },
    }));
    expect(validateBundleGates(bundle)).toMatchObject({ ok: false, code: "font_weight_exceeded" });
  });
});
