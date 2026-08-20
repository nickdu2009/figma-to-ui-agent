/**
 * S6 合同测试（计划 §S6 验证清单）：
 * - TokenCompiler：三层编译、悬空/循环引用、非法键/值、limit+1；
 * - CssCompiler：宿主选择器、未知 at-rule、外部/相对 URL、危险属性/值、
 *   自定义属性命名空间、keyframes 命名空间与限额、Rule/Selector 限额、
 *   作用域前缀、资源占位 IR；
 * - AssetUrlResolver：Manifest 闭合（hash/mime/byteLength）、候选/active/dispose
 *   生命周期、资源数上限；
 * - BundlePreviewController 集成：Token/CSS/G0 失败保留旧 Preview（fail closed），
 *   成功提交原子携带 designCss 与作用域 revision 一致性。
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createRuntimeWithNavigation,
  type RuntimeFallbacks,
  type RuntimeLimits,
} from "@next-app-runtime/client";

import {
  TOKEN_CUSTOM_PROPERTY_LIMIT,
  TokenCompilerError,
  compileTokens,
} from "../../src/runtime/token-compiler.js";
import {
  CSS_KEYFRAMES_LIMIT,
  CSS_RULE_LIMIT,
  CssCompilerError,
  compileApplicationCss,
} from "../../src/runtime/css-compiler.js";
import {
  ASSET_REF_LIMIT,
  AssetUrlResolver,
  type AssetManifestLike,
} from "../../src/runtime/asset-url-resolver.js";
import {
  createBundlePreviewController,
  type BundlePreviewController,
} from "../../src/runtime/bundle-preview-controller.js";
import { createBrowserRuntimeActionAdapter } from "../../src/runtime/runtime-action-adapter.js";
import { catalog, registry } from "../../src/runtime/catalog.js";
import {
  appUiBundleSchema,
  type AppUiBundle,
} from "../../src/catalog/app-ui-bundle.js";
import { digestCanonicalJson } from "../../src/catalog/canonical-json.js";

const SCOPE = `[data-vma-preview-root][data-bundle-revision="7"]`;
const PREFIX = "ab12cd34";

function tokens(base: Record<string, unknown> = {}) {
  return {
    primitive: {
      "color.primary": { type: "color", value: "#1a73e8" },
      "color.danger": { type: "color", value: "#d93025ff" },
      "space.md": { type: "length", value: 16, unit: "px" },
      "weight.bold": { type: "fontWeight", value: 700 },
      "shadow.card": {
        type: "shadow",
        value: [{ x: 0, y: 2, blur: 8, spread: 0, color: "#00000010" }],
      },
      "motion.fast": { type: "duration", valueMs: 150 },
      "motion.ease": { type: "easing", value: [0.2, 0, 0, 1] },
      "font.body": { type: "fontFamily", value: { system: "system-ui" } },
      ...(base as object),
    },
    semantic: {
      "color.surface": { $token: "color.primary" },
    },
    component: {
      Button: {
        background: { $token: "color.surface" },
        radius: { type: "length", value: 6, unit: "px" },
        border: { $token: "color.danger" },
      },
    },
  };
}

describe("TokenCompiler（S6）", () => {
  it("三层编译：primitive 值、semantic var 链、component 引用与内联", () => {
    const result = compileTokens({ tokens: tokens(), digestPrefix: PREFIX });
    expect(result.customProperties).toContain(
      "--vma-pt-color-primary: #1a73e8;",
    );
    expect(result.customProperties).toContain(
      "--vma-pt-color-danger: #d93025ff;",
    );
    expect(result.customProperties).toContain(
      "--vma-st-color-surface: var(--vma-pt-color-primary);",
    );
    expect(result.customProperties).toContain(
      "--vma-ct-Button-background: var(--vma-st-color-surface);",
    );
    expect(result.customProperties).toContain("--vma-ct-Button-radius: 6px;");
    expect(result.customProperties).toContain(
      "--vma-ct-Button-border: var(--vma-pt-color-danger);",
    );
    expect(result.customProperties).toContain(
      "--vma-pt-shadow-card: 0px 2px 8px 0px #00000010;",
    );
    expect(result.customProperties).toContain("--vma-pt-motion-fast: 150ms;");
    expect(result.customProperties).toContain(
      "--vma-pt-motion-ease: cubic-bezier(0.2, 0, 0, 1);",
    );
    expect(result.fontAssetRefs).toEqual([]);
  });

  it("fontFamily(assetId) 产出命名空间 family IR", () => {
    const result = compileTokens({
      tokens: {
        primitive: {
          "font.display": {
            type: "fontFamily",
            value: { assetId: "font.hero" },
          },
        },
        semantic: {},
        component: {},
      },
      digestPrefix: PREFIX,
    });
    expect(result.fontAssetRefs).toEqual([
      { assetId: "font.hero", familyName: `vmaf-${PREFIX}-font-hero` },
    ]);
    expect(result.customProperties).toContain(
      `--vma-pt-font-display: vmaf-${PREFIX}-font-hero;`,
    );
  });

  it("悬空 semantic 引用 fail closed", () => {
    expect(() =>
      compileTokens({
        tokens: {
          primitive: {},
          semantic: { "color.x": { $token: "nope" } },
          component: {},
        },
        digestPrefix: PREFIX,
      }),
    ).toThrowError(TokenCompilerError);
  });

  it("semantic 循环引用 fail closed", () => {
    expect(() =>
      compileTokens({
        tokens: {
          primitive: {},
          semantic: {
            a: { $token: "b" },
            b: { $token: "a" },
          },
          component: {},
        },
        digestPrefix: PREFIX,
      }),
    ).toThrowError(TokenCompilerError);
  });

  it("component 悬空引用 fail closed", () => {
    expect(() =>
      compileTokens({
        tokens: {
          primitive: {},
          semantic: {},
          component: { Card: { bg: { $token: "missing" } } },
        },
        digestPrefix: PREFIX,
      }),
    ).toThrowError(TokenCompilerError);
  });

  it("非法 token 键与非法值 fail closed", () => {
    const bad = (t: unknown) =>
      expect(() =>
        compileTokens({ tokens: t as never, digestPrefix: PREFIX }),
      ).toThrowError(TokenCompilerError);
    bad({
      primitive: { "bad key!": { type: "color", value: "#ffffff" } },
      semantic: {},
      component: {},
    });
    bad({
      primitive: { c: { type: "color", value: "javascript:alert(1)" } },
      semantic: {},
      component: {},
    });
    bad({
      primitive: { f: { type: "fontFamily", value: {} } },
      semantic: {},
      component: {},
    });
    bad({
      primitive: {},
      semantic: {},
      component: { X: { y: { type: "unknownType", value: 1 } } },
    });
  });

  it(`自定义属性总量超过 ${TOKEN_CUSTOM_PROPERTY_LIMIT}（limit+1）fail closed`, () => {
    const primitive: Record<string, unknown> = {};
    for (let index = 0; index <= TOKEN_CUSTOM_PROPERTY_LIMIT; index += 1) {
      primitive[`k${index}`] = { type: "color", value: "#112233" };
    }
    expect(() =>
      compileTokens({
        tokens: { primitive, semantic: {}, component: {} } as never,
        digestPrefix: PREFIX,
      }),
    ).toThrowError(/token_limit_exceeded|超过/);
  });
});

describe("CssCompiler（S6）", () => {
  const compile = (css: string, extra: Record<string, unknown> = {}) =>
    compileApplicationCss({
      applicationCss: css,
      scopeAttribute: SCOPE,
      digestPrefix: PREFIX,
      ...extra,
    });

  it("全部选择器绑定带 revision 的 Preview root；空 CSS 短路", () => {
    expect(compile("")).toEqual({
      cssText: "",
      assetRefs: [],
      keyframesRenames: {},
    });
    const out = compile(".card { color: red; } .a, .b { margin: 0; }");
    expect(out.cssText).toContain(`${SCOPE} .card { color: red; }`);
    expect(out.cssText).toContain(`${SCOPE} .a, ${SCOPE} .b { margin: 0; }`);
  });

  it("宿主选择器（html/body/:root/:host/后代/前导组合符）拒绝", () => {
    for (const selector of [
      "html",
      "body",
      ":root",
      ":host",
      "html body",
      ".x body",
      "div :root",
      "+ .chat-panel",
      "~ div",
      "> .foo",
      "a, + b",
    ]) {
      expect(() => compile(`${selector} { color: red; }`)).toThrowError(
        CssCompilerError,
      );
    }
  });

  it("未知/禁止 at-rule 拒绝（@import/@font-face/@page/@media 嵌套）", () => {
    expect(() => compile('@import url("x.css");')).toThrowError(
      CssCompilerError,
    );
    expect(() => compile("@font-face { font-family: x; }")).toThrowError(
      CssCompilerError,
    );
    expect(() => compile("@page { margin: 0; }")).toThrowError(
      CssCompilerError,
    );
    expect(() =>
      compile(
        "@media (min-width: 1px) { @media (max-width: 2px) { .x { color: red; } } }",
      ),
    ).toThrowError(CssCompilerError);
  });

  it("外部与相对 URL 拒绝；asset: URL 产出资源 IR 占位", () => {
    expect(() =>
      compile(".x { background: url(https://evil.com/a.png); }"),
    ).toThrowError(CssCompilerError);
    expect(() =>
      compile(
        '.x { background: url("data:image/svg+xml,<svg onload=alert(1)>"); }',
      ),
    ).toThrowError(CssCompilerError);
    expect(() => compile(".x { background: url(a.png); }")).toThrowError(
      CssCompilerError,
    );
    const out = compile('.x { background: url("asset:img-hero"); }');
    expect(out.assetRefs).toEqual([{ assetId: "img-hero" }]);
    expect(out.cssText).toContain("var(__VMA_ASSET_0__)");
  });

  it("危险属性/值拒绝：position:fixed、越界 z-index、view-transition-name、未知自定义属性", () => {
    expect(() => compile(".x { position: fixed; }")).toThrowError(
      CssCompilerError,
    );
    expect(() => compile(".x { position: fixed; top: 0; }")).toThrowError(
      CssCompilerError,
    );
    expect(() => compile(".x { z-index: -1; }")).toThrowError(CssCompilerError);
    expect(() => compile(".x { z-index: 2147483648; }")).toThrowError(
      CssCompilerError,
    );
    expect(() => compile(".x { view-transition-name: host; }")).toThrowError(
      CssCompilerError,
    );
    expect(() => compile(".x { --vma-pt-color-primary: red; }")).toThrowError(
      CssCompilerError,
    );
    expect(() => compile(".x { --unknown: 1; }")).toThrowError(
      CssCompilerError,
    );
    expect(
      compile(".x { --app-accent: #00ff00; color: var(--app-accent); }")
        .cssText,
    ).toContain("--app-accent: #00ff00;");
  });

  it("keyframes 命名空间化并重写 animation 引用", () => {
    const out = compile(
      "@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .x { animation: spin 1s ease infinite; }",
    );
    expect(out.keyframesRenames).toEqual({ spin: `vma-${PREFIX}-spin` });
    expect(out.cssText).toContain(`@keyframes vma-${PREFIX}-spin {`);
    expect(out.cssText).toContain(
      `animation: vma-${PREFIX}-spin 1s ease infinite;`,
    );
    // 原名不得再出现于编译产物
    expect(out.cssText).not.toMatch(/[^-]spin /);
  });

  it(`@keyframes 超过 ${CSS_KEYFRAMES_LIMIT}（limit+1）拒绝`, () => {
    const parts: string[] = [];
    for (let index = 0; index <= CSS_KEYFRAMES_LIMIT; index += 1) {
      parts.push(
        `@keyframes k${index} { from { opacity: 0; } to { opacity: 1; } }`,
      );
    }
    expect(() => compile(parts.join("\n"))).toThrowError(CssCompilerError);
  });

  it(`Rule 总数超过 ${CSS_RULE_LIMIT}（limit+1）拒绝；声明/规则上限拒绝`, () => {
    const rules: string[] = [];
    for (let index = 0; index <= CSS_RULE_LIMIT; index += 1) {
      rules.push(`.r${index} { color: red; }`);
    }
    expect(() => compile(rules.join("\n"))).toThrowError(CssCompilerError);

    const decls = Array.from({ length: 65 }, (_, i) => `p${i}: ${i}`).join(";");
    expect(() => compile(`.x { ${decls}; }`)).toThrowError(CssCompilerError);
  });

  it("选择器长度/组合符超限拒绝", () => {
    const long = `.${"a".repeat(260)}`;
    expect(() => compile(`${long} { color: red; }`)).toThrowError(
      CssCompilerError,
    );
    expect(() => compile("a b c d e f g { color: red; }")).toThrowError(
      CssCompilerError,
    );
  });

  it("花括号不配对/空规则体/孤立内容拒绝", () => {
    expect(() => compile(".x { color: red;")).toThrowError(CssCompilerError);
    expect(() => compile(".x { }")).toThrowError(CssCompilerError);
    expect(() => compile("garbage")).toThrowError(CssCompilerError);
  });

  it("token 自定义属性注入作用域 root", () => {
    const out = compile(".x { color: red; }", {
      tokenCustomProperties: "--vma-pt-a: #111111;",
    });
    expect(out.cssText.startsWith(`${SCOPE} { --vma-pt-a: #111111; }`)).toBe(
      true,
    );
  });

  it("@media 内规则同样作用域化", () => {
    const out = compile(
      "@media (min-width: 600px) { .card { padding: 8px; } }",
    );
    expect(out.cssText).toContain(
      `@media (min-width: 600px) { ${SCOPE} .card { padding: 8px; } }`,
    );
  });
});

describe("AssetUrlResolver（S6 fixture 字节源）", () => {
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const PNG_HASH = `sha256:${createHash("sha256").update(PNG_BYTES).digest("hex")}`;

  const manifest = (
    entry?: Partial<AssetManifestLike["entries"][number]>,
  ): AssetManifestLike => ({
    entries: [
      {
        assetId: "img-hero",
        kind: "image",
        contentHash: PNG_HASH,
        mimeType: "image/png",
        byteLength: PNG_BYTES.byteLength,
        ...entry,
      },
    ],
  });

  const makeResolver = (
    m: AssetManifestLike = manifest(),
    bytes: Uint8Array = PNG_BYTES,
    mimeType = "image/png",
  ) =>
    new AssetUrlResolver({
      manifest: m,
      fetchBytes: async () => ({
        bytes: bytes.buffer as ArrayBuffer,
        mimeType,
      }),
      digestPrefix: PREFIX,
      skipDecode: true,
    });

  it("字节核对通过：stage → commit → active 句柄（blob: URL）", async () => {
    const resolver = makeResolver();
    await resolver.stageCandidate(["img-hero"]);
    expect(resolver.candidateCount).toBe(1);
    resolver.commitCandidate();
    const handle = resolver.getActiveHandle("img-hero");
    expect(handle).not.toBeNull();
    expect(handle?.objectUrl.startsWith("blob:")).toBe(true);
    expect(handle?.contentHash).toBe(PNG_HASH);
    resolver.dispose();
    expect(resolver.activeCount).toBe(0);
  });

  it("hash/mime/byteLength 错配 fail closed（不产生句柄）", async () => {
    const mismatch = async (
      m: AssetManifestLike,
      bytes?: Uint8Array,
      mime?: string,
    ) => {
      const resolver = makeResolver(m, bytes, mime);
      await expect(resolver.stageCandidate(["img-hero"])).rejects.toThrow();
      resolver.dispose();
    };
    await mismatch(manifest({ contentHash: "sha256:" + "0".repeat(64) }));
    await mismatch(manifest({ mimeType: "image/jpeg" }));
    await mismatch(manifest({ byteLength: 7 }));
  });

  it("Manifest 缺条目 fail closed", async () => {
    const resolver = makeResolver({ entries: [] });
    await expect(resolver.stageCandidate(["img-hero"])).rejects.toThrow(
      /asset_manifest_missing/,
    );
  });

  it("候选撤销不触碰 active；退役代销毁", async () => {
    const resolver = makeResolver();
    await resolver.stageCandidate(["img-hero"]);
    resolver.commitCandidate();
    await resolver.stageCandidate(["img-hero"]);
    resolver.discardCandidate();
    expect(resolver.candidateCount).toBe(0);
    expect(resolver.activeCount).toBe(1);
    resolver.disposeRetired();
    expect(resolver.activeCount).toBe(1);
  });

  it(`资源数超过 ${ASSET_REF_LIMIT}（limit+1）拒绝`, async () => {
    const entries = Array.from({ length: ASSET_REF_LIMIT + 1 }, (_, i) => ({
      ...manifest().entries[0],
      assetId: `a${i}`,
    }));
    const resolver = makeResolver({ entries });
    await expect(
      resolver.stageCandidate(entries.map((entry) => entry.assetId)),
    ).rejects.toThrow(/asset_limit_exceeded/);
    resolver.dispose();
  });
});

/* ---------------- Controller 集成（fail closed + 原子提交） ---------------- */

const APP_ID = "app_s6_test";
const LIMITS: RuntimeLimits = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};
const FALLBACKS: RuntimeFallbacks = {
  loading: () => null,
  error: () => null,
  notFound: () => null,
  unmatched: () => null,
};
const STACK_PROPS = {
  direction: "vertical",
  gap: "md",
  align: null,
  justify: null,
  className: null,
};
const VALID_SPEC = {
  metadata: { title: { default: "S6", template: "%s | S6" } },
  routes: {
    "/": {
      page: {
        root: "root",
        elements: {
          root: { type: "Stack", props: STACK_PROPS, children: ["t1"] },
          t1: {
            type: "Text",
            props: { text: "S6 内容", variant: null },
            children: [],
          },
        },
      },
    },
  },
};

async function makeBundle(
  designSystem: AppUiBundle["designSystem"],
  assets?: AppUiBundle["assets"],
): Promise<AppUiBundle> {
  const raw = JSON.parse(
    await readFile(
      "tests/fixtures/design-system/minimal-bundle.v1.json",
      "utf8",
    ),
  ) as Record<string, unknown>;
  raw.spec = VALID_SPEC;
  raw.designSystem = designSystem;
  if (assets) raw.assets = assets;
  return appUiBundleSchema.parse(raw);
}

function makeController(): BundlePreviewController {
  const surfaceLog: string[] = [];
  return createBundlePreviewController({
    appId: APP_ID,
    createPreviewRuntime: ({ navigation, executionContext, initialSource }) => {
      const actionAdapter = createBrowserRuntimeActionAdapter({
        appId: APP_ID,
        surface: {
          navigate: (href) => surfaceLog.push(`navigate:${href}`),
          showToast: (input) => surfaceLog.push(`toast:${input.title}`),
          setDialogOpen: (id, open) => surfaceLog.push(`dialog:${id}:${open}`),
        },
        includeActionNames: Object.keys(
          (catalog.data as { actions?: Record<string, unknown> }).actions ?? {},
        ),
      });
      return createRuntimeWithNavigation(
        {
          catalog,
          registry,
          limits: LIMITS,
          fallbacks: FALLBACKS,
          actionAdapter,
          actionExecutionContext: executionContext,
          initialSource,
        },
        navigation,
      );
    },
  });
}

async function stage(
  controller: BundlePreviewController,
  bundle: AppUiBundle,
  generationId: string,
) {
  return controller.stageBundle({
    generationId,
    bundle,
    expected: {
      candidateDigest: await digestCanonicalJson({ v2: bundle }),
      uiBundleDigest: await digestCanonicalJson(bundle),
    },
  });
}

describe("BundlePreviewController × 设计编译（S6 集成）", () => {
  it("合法 designSystem：提交原子携带 designCss，作用域 revision 与句柄一致", async () => {
    const controller = makeController();
    const bundle = await makeBundle({
      ...{
        tokens: tokens() as never,
      },
      applicationCss: ".card { color: var(--vma-st-color-surface); }",
    } as AppUiBundle["designSystem"]);
    const result = await stage(controller, bundle, "gen_s6_ok");
    expect(result).toMatchObject({ status: "committed", bundleRevision: 1 });
    const active = controller.getSnapshot().active;
    expect(active?.designCss).toContain(
      '[data-vma-preview-root][data-bundle-revision="1"] .card',
    );
    expect(active?.designCss).toContain(
      "--vma-st-color-surface: var(--vma-pt-color-primary);",
    );
    expect(typeof active?.disposeAssets).toBe("object");
    active?.disposeAssets?.();
    controller.dispose();
  });

  it("宿主选择器：failed（css_host_selector），旧 Preview 保留", async () => {
    const controller = makeController();
    const good = await makeBundle({
      tokens: tokens() as never,
      applicationCss: ".card { color: red; }",
    } as AppUiBundle["designSystem"]);
    await stage(controller, good, "gen_s6_good");

    const evil = await makeBundle({
      tokens: tokens() as never,
      applicationCss: "body { background: #000; } .card { color: blue; }",
    } as AppUiBundle["designSystem"]);
    const before = controller.getSnapshot().active;
    const result = await stage(controller, evil, "gen_s6_host");
    expect(result).toMatchObject({
      status: "failed",
      code: "css_host_selector",
    });
    expect(controller.getSnapshot().active).toBe(before);
    expect(before?.designCss).toContain(".card { color: red; }");
    controller.dispose();
  });

  it("悬空 token：failed（design_token_ref_dangling），旧 Preview 保留", async () => {
    const controller = makeController();
    const good = await makeBundle({
      tokens: tokens() as never,
      applicationCss: "",
    } as AppUiBundle["designSystem"]);
    await stage(controller, good, "gen_s6_base");

    const broken = await makeBundle({
      tokens: {
        primitive: {},
        semantic: { "color.x": { $token: "missing" } },
        component: {},
      } as never,
      applicationCss: "",
    } as AppUiBundle["designSystem"]);
    const before = controller.getSnapshot().active;
    const result = await stage(controller, broken, "gen_s6_dangling");
    expect(result).toMatchObject({
      status: "failed",
      code: "design_token_ref_dangling",
    });
    expect(controller.getSnapshot().active).toBe(before);
    controller.dispose();
  });

  it("CSS 引用不在 Manifest 的资源：failed（css_dangling_asset_ref）", async () => {
    const controller = makeController();
    const bundle = await makeBundle({
      tokens: tokens() as never,
      applicationCss: '.x { background: url("asset:img-missing"); }',
    } as AppUiBundle["designSystem"]);
    const result = await stage(controller, bundle, "gen_s6_dangling_asset");
    expect(result).toMatchObject({
      status: "failed",
      code: "css_dangling_asset_ref",
    });
    controller.dispose();
  });

  it("无字节源的合法资源引用：failed（asset_fetch_failed）不污染 active", async () => {
    const controller = makeController();
    const good = await makeBundle({
      tokens: tokens() as never,
      applicationCss: ".card { color: red; }",
    } as AppUiBundle["designSystem"]);
    await stage(controller, good, "gen_s6_base2");

    const withAsset = await makeBundle(
      {
        tokens: tokens() as never,
        applicationCss: '.x { background: url("asset:img-hero"); }',
      } as AppUiBundle["designSystem"],
      {
        entries: [
          {
            assetId: "img-hero",
            kind: "image",
            contentHash: "sha256:" + "0".repeat(64),
            mimeType: "image/png",
            byteLength: 8,
          },
        ],
      },
    );
    const before = controller.getSnapshot().active;
    const result = await stage(controller, withAsset, "gen_s6_nosource");
    expect(result).toMatchObject({
      status: "failed",
      code: "asset_fetch_failed",
    });
    expect(controller.getSnapshot().active).toBe(before);
    controller.dispose();
  });
});
