/**
 * AppUiBundle / ApplicationCandidate strict 合同测试（S1，设计 §5.1/§10.1）：
 * - strict Zod：未知键、/ui 之外持久 state、catalogVersion/specCompatibility/contentHash 格式；
 * - Token 判别联合与颜色文字量；
 * - businessSchema:null 唯一空表示；migrationEdge 服务端字段 strict；
 * - toLegacySpecProjection 派生旧 spec 投影。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  finalizeParse,
  toLegacySpecProjection,
} from "../../server/application-candidate.js";
import {
  appUiBundleSchema,
  type AppUiBundle,
} from "../../src/catalog/app-ui-bundle.js";
import { validateBundleGates } from "../../src/catalog/bundle-gates.js";

const MINIMAL_BUNDLE_PATH = resolve("tests/fixtures/design-system/minimal-bundle.v1.json");

const minimalBundleRaw = JSON.parse(
  await readFile(MINIMAL_BUNDLE_PATH, "utf8"),
) as Record<string, unknown>;

function withBundle(mutate: (bundle: Record<string, unknown>) => void): Record<string, unknown> {
  const bundle = JSON.parse(JSON.stringify(minimalBundleRaw)) as Record<string, unknown>;
  mutate(bundle);
  return bundle;
}

async function loadMinimalBundle(): Promise<AppUiBundle> {
  const parsed = appUiBundleSchema.safeParse(minimalBundleRaw);
  if (!parsed.success) throw new Error(`夹具无效：${parsed.error.message}`);
  return parsed.data;
}

describe("AppUiBundle strict schema", () => {
  it("最小合法 bundle 通过 schema + gates", async () => {
    const bundle = await loadMinimalBundle();
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.catalogVersion).toBe("1.0.0");
    expect(validateBundleGates(bundle).ok).toBe(true);
  });

  it("未知顶层键被拒绝（strict）", () => {
    const input = withBundle((b) => {
      b.unknownField = true;
    });
    expect(appUiBundleSchema.safeParse(input).success).toBe(false);
  });

  it("持久 state 顶层键只允许 ui", () => {
    const bad = withBundle((b) => {
      (b.spec as Record<string, unknown>).state = { ui: {}, records: { items: [] } };
    });
    const result = appUiBundleSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("/ui");
  });

  it("route page/loading/error/notFound 与 layouts state 同样只允许 ui", () => {
    const badRoute = withBundle((b) => {
      const spec = b.spec as { routes: Record<string, { page: Record<string, unknown> }> };
      spec.routes["/"]!.page.state = { form: { name: "x" } };
    });
    expect(appUiBundleSchema.safeParse(badRoute).success).toBe(false);
    const badLayout = withBundle((b) => {
      (b.spec as Record<string, unknown>).layouts = {
        main: { root: "r", elements: {}, state: { data: {} } },
      };
    });
    expect(appUiBundleSchema.safeParse(badLayout).success).toBe(false);
    const goodLayout = withBundle((b) => {
      (b.spec as Record<string, unknown>).layouts = {
        main: { root: "r", elements: {}, state: { ui: {} } },
      };
    });
    expect(appUiBundleSchema.safeParse(goodLayout).success).toBe(true);
  });

  it("catalogVersion 必须为 1.x.y 且无前导零", () => {
    for (const okVersion of ["1.0.0", "1.2.3", "1.10.20"]) {
      expect(appUiBundleSchema.safeParse(withBundle((b) => { b.catalogVersion = okVersion; })).success).toBe(true);
    }
    for (const badVersion of ["2.0.0", "1.01.0", "1.0", "v1.0.0", "1.0.0-beta"]) {
      expect(appUiBundleSchema.safeParse(withBundle((b) => { b.catalogVersion = badVersion; })).success).toBe(false);
    }
  });

  it("specCompatibility 必须精确为 0.19.0", () => {
    expect(
      appUiBundleSchema.safeParse(withBundle((b) => { b.specCompatibility = "0.20.0"; })).success,
    ).toBe(false);
  });

  it("contentHash 必须为 sha256:<64 位小写十六进制>", () => {
    const withAsset = withBundle((b) => {
      (b.assets as { entries: unknown[] }).entries = [{
        assetId: "a",
        kind: "image",
        contentHash: "sha256:ABCDEF6789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
        mimeType: "image/png",
        byteLength: 1,
      }];
    });
    expect(appUiBundleSchema.safeParse(withAsset).success).toBe(false);
  });

  it("颜色仅允许 #RRGGBB 或 #RRGGBBAA", () => {
    const bad = withBundle((b) => {
      const ds = b.designSystem as { tokens: { primitive: Record<string, unknown> } };
      ds.tokens.primitive["color.bad"] = { type: "color", value: "#abc" };
    });
    expect(appUiBundleSchema.safeParse(bad).success).toBe(false);
    const good = withBundle((b) => {
      const ds = b.designSystem as { tokens: { primitive: Record<string, unknown> } };
      ds.tokens.primitive["color.good"] = { type: "color", value: "#aabbcc80" };
    });
    expect(appUiBundleSchema.safeParse(good).success).toBe(true);
  });

  it("PrimitiveToken 判别联合：未知 type 拒绝、未知键拒绝", () => {
    const badType = withBundle((b) => {
      const ds = b.designSystem as { tokens: { primitive: Record<string, unknown> } };
      ds.tokens.primitive["x"] = { type: "gradient", value: "#aabbcc" };
    });
    expect(appUiBundleSchema.safeParse(badType).success).toBe(false);
    const badKey = withBundle((b) => {
      const ds = b.designSystem as { tokens: { primitive: Record<string, unknown> } };
      ds.tokens.primitive["x"] = { type: "number", value: 1, extra: true };
    });
    expect(appUiBundleSchema.safeParse(badKey).success).toBe(false);
  });

  it("semantic token 只允许 TokenRef 形态", () => {
    const bad = withBundle((b) => {
      const ds = b.designSystem as { tokens: { semantic: Record<string, unknown> } };
      ds.tokens.semantic["color.x"] = { type: "color", value: "#aabbcc" };
    });
    expect(appUiBundleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ApplicationCandidate", () => {
  const baseCandidate = () => ({
    uiBundle: JSON.parse(JSON.stringify(minimalBundleRaw)) as unknown,
    businessSchema: null,
    migrationEdge: {
      fromPublishedVersionId: null,
      fromSchemaDigest: `sha256:${"0".repeat(64)}`,
      toSchemaDigest: `sha256:${"1".repeat(64)}`,
    },
  });

  it("businessSchema:null 合法；{collections:[]} 伪造空 Schema 拒绝", () => {
    expect(finalizeParse(baseCandidate()).ok).toBe(true);
    const fake = { ...baseCandidate(), businessSchema: { collections: [] } };
    const result = finalizeParse(fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("candidate_schema_invalid");
  });

  it("migrationEdge 未知键被拒绝", () => {
    const bad = baseCandidate();
    (bad.migrationEdge as Record<string, unknown>).extra = "x";
    expect(finalizeParse(bad).ok).toBe(false);
  });

  it("candidate 未知顶层键被拒绝", () => {
    const bad = { ...baseCandidate(), dataAccessPolicy: {} };
    expect(finalizeParse(bad).ok).toBe(false);
  });

  it("finalizeParse 同时执行字节门禁", () => {
    const candidate = baseCandidate();
    const bundle = candidate.uiBundle as { designSystem: { applicationCss: string } };
    bundle.designSystem.applicationCss = "a".repeat(129 * 1024);
    const result = finalizeParse(candidate);
    expect(result).toMatchObject({ ok: false, code: "css_too_large" });
  });

  it("toLegacySpecProjection 返回 uiBundle.spec", async () => {
    const bundle = await loadMinimalBundle();
    const projection = toLegacySpecProjection(bundle) as { routes: Record<string, unknown> };
    expect(projection.routes["/"]).toBeDefined();
  });
});
