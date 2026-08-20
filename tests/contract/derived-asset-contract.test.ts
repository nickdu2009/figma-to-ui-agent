/**
 * 派生资源合同测试（S1，设计 §5.1 AssetManifest + 受控 assetRef）：
 * - 版本化夹具驱动：合法清单通过；重复 assetId、kind/mime 不一致、font 缺元数据拒绝；
 * - Image.assetRef 只接受 sha256 contentHash（受控引用，不接受任意 URL）。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { assetManifestSchema } from "../../src/catalog/app-ui-bundle.js";
import { p0ComponentOverlays } from "../../src/catalog/overlays.js";

const CASES_PATH = resolve("tests/fixtures/derived-assets/asset-manifest-cases.v1.json");

interface ManifestCases {
  valid: unknown;
  duplicateAssetId: unknown;
  kindMimeMismatch: unknown;
  fontMissingMeta: unknown;
}

const cases = JSON.parse(await readFile(CASES_PATH, "utf8")) as ManifestCases;

describe("AssetManifest 派生资源合同", () => {
  it("合法清单通过", () => {
    const result = assetManifestSchema.safeParse(cases.valid);
    expect(result.success).toBe(true);
  });

  it("重复 assetId 拒绝", () => {
    const result = assetManifestSchema.safeParse(cases.duplicateAssetId);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("assetId 重复");
  });

  it("kind/mimeType 不一致拒绝", () => {
    const result = assetManifestSchema.safeParse(cases.kindMimeMismatch);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("不允许 mimeType");
  });

  it("font 资源缺 font 元数据拒绝", () => {
    const result = assetManifestSchema.safeParse(cases.fontMissingMeta);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("font 元数据");
  });

  it("非 font 资源携带 font 元数据拒绝", () => {
    const result = assetManifestSchema.safeParse({
      entries: [{
        assetId: "logo",
        kind: "image",
        contentHash: `sha256:${"0".repeat(64)}`,
        mimeType: "image/png",
        byteLength: 1,
        font: { family: "Inter", weight: 400 },
      }],
    });
    expect(result.success).toBe(false);
  });

  it("Image.assetRef 只接受受控 sha256 contentHash", () => {
    const assetRef = p0ComponentOverlays.Image.props?.additions?.assetRef;
    expect(assetRef).toBeDefined();
    expect(
      assetRef?.safeParse({
        assetId: "logo",
        contentHash: `sha256:${"a".repeat(64)}`,
      }).success,
    ).toBe(true);
    expect(
      assetRef?.safeParse({ assetId: "logo", contentHash: "https://example.com/x.png" }).success,
    ).toBe(false);
    expect(
      assetRef?.safeParse({ assetId: "logo", contentHash: `SHA256:${"a".repeat(64)}` }).success,
    ).toBe(false);
  });

  it("图片宽高上限 4096", () => {
    const entry = {
      assetId: "huge",
      kind: "image",
      contentHash: `sha256:${"0".repeat(64)}`,
      mimeType: "image/png",
      byteLength: 1,
      width: 4097,
    };
    expect(assetManifestSchema.safeParse({ entries: [entry] }).success).toBe(false);
  });
});
