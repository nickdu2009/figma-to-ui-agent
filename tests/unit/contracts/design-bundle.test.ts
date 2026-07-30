import { describe, expect, it } from "vitest";

import {
  designBundleDraftSchema,
  localFontRefSchema,
  localImageRefSchema,
  normalizedDesignValueSchema,
  prototypeInteractionSchema,
} from "../../../src/design-bundle/schema.ts";
import {
  createDesignBundleDraft,
  FIXTURE_ASSET_PATH,
  FIXTURE_ASSET_SHA,
} from "../../fixtures/contracts.ts";

describe("DesignBundle Schema", () => {
  it("接受 Variables 不可用的核心 DesignBundle", () => {
    expect(
      designBundleDraftSchema.parse(createDesignBundleDraft()),
    ).toMatchObject({
      schemaVersion: "1",
      capabilities: {
        variables: { status: "unavailable_optional" },
      },
      fonts: [],
    });
  });

  it("兼容缺少 fonts 的旧 DesignBundle 草稿", () => {
    const legacy = createDesignBundleDraft() as Record<string, unknown>;
    delete legacy.fonts;

    expect(designBundleDraftSchema.parse(legacy)).toMatchObject({
      fonts: [],
    });
  });

  it("拒绝未知字段和不兼容版本", () => {
    expect(() =>
      designBundleDraftSchema.parse({
        ...createDesignBundleDraft(),
        arbitraryField: true,
      }),
    ).toThrow();
    expect(() =>
      designBundleDraftSchema.parse({
        ...createDesignBundleDraft(),
        schemaVersion: "2",
      }),
    ).toThrow();
  });

  it("接受脱敏 prototype interaction 并拒绝 raw payload", () => {
    expect(
      prototypeInteractionSchema.parse({
        id: "figma-interaction",
        source: "figma_rest",
        trigger: "click",
        actionType: "change_to",
        navigation: "CHANGE_TO",
        transitionNodeId: "2:3",
      }),
    ).toMatchObject({
      source: "figma_rest",
      navigation: "CHANGE_TO",
    });

    expect(() =>
      prototypeInteractionSchema.parse({
        source: "figma_rest",
        trigger: "click",
        actionType: "node",
        url: "https://example.invalid/raw",
      }),
    ).toThrow();
  });

  it("拒绝悬空样式、设计值和图片引用", () => {
    const draft = createDesignBundleDraft();
    draft.pages[0]!.nodes[0]!.styleRefs = ["missing-style"];
    draft.pages[0]!.nodes[0]!.designValueRefs = ["missing-value"];
    draft.pages[0]!.nodes[1]!.imageRefs = [
      `figma/assets/${"c".repeat(64)}.png`,
    ];

    const result = designBundleDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain("悬空样式引用：missing-style");
      expect(messages).toContain("悬空设计值引用：missing-value");
      expect(messages).toContain(
        `悬空图片引用：figma/assets/${"c".repeat(64)}.png`,
      );
    }
  });

  it("拒绝逃逸路径以及与哈希、MIME 不一致的图片", () => {
    expect(() =>
      localImageRefSchema.parse({
        path: "../outside.png",
        sha256: FIXTURE_ASSET_SHA,
        byteCount: 1,
        mimeType: "image/png",
        width: 1,
        height: 1,
      }),
    ).toThrow();
    expect(() =>
      localImageRefSchema.parse({
        path: FIXTURE_ASSET_PATH,
        sha256: "c".repeat(64),
        byteCount: 1,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
      }),
    ).toThrow();
  });

  it("接受哈希命名字体并拒绝 MIME 或来源追溯不匹配", () => {
    const fontSha = "d".repeat(64);
    expect(
      localFontRefSchema.parse({
        path: `figma/fonts/${fontSha}.woff2`,
        sha256: fontSha,
        byteCount: 4,
        mimeType: "font/woff2",
        family: "League Spartan",
        weight: 300,
        style: "normal",
        sourceKind: "user_provided",
      }),
    ).toMatchObject({
      path: `figma/fonts/${fontSha}.woff2`,
      weight: 300,
    });

    expect(() =>
      localFontRefSchema.parse({
        path: `figma/fonts/${fontSha}.woff2`,
        sha256: fontSha,
        byteCount: 4,
        mimeType: "font/woff",
        family: "League Spartan",
        weight: 300,
        style: "normal",
        sourceKind: "user_provided",
      }),
    ).toThrow("字体 MIME 与扩展名不一致");

    const draft = createDesignBundleDraft();
    draft.fonts.push({
      path: `figma/fonts/${fontSha}.woff2`,
      sha256: fontSha,
      byteCount: 4,
      mimeType: "font/woff2",
      family: "League Spartan",
      weight: 300,
      style: "normal",
      sourceKind: "user_provided",
    });
    draft.provenance.push({
      entityKind: "font",
      entityId: `figma/fonts/${fontSha}.woff2`,
      origin: "user_provided",
    });
    expect(designBundleDraftSchema.parse(draft).fonts).toHaveLength(1);

    const invalidOrigin = createDesignBundleDraft();
    invalidOrigin.provenance.push({
      entityKind: "asset",
      entityId: FIXTURE_ASSET_PATH,
      origin: "user_provided",
    });
    expect(() => designBundleDraftSchema.parse(invalidOrigin)).toThrow(
      "非 font 来源追溯不能使用字体来源 origin",
    );
  });

  it("拒绝节点父链循环", () => {
    const draft = createDesignBundleDraft();
    draft.pages[0]!.rootNodeIds = [];
    draft.pages[0]!.nodes[0]!.parentId = "figma-image";

    const result = designBundleDraftSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("节点父链存在循环"),
        ),
      ).toBe(true);
    }
  });

  it("拒绝悬空来源追溯引用", () => {
    const draft = createDesignBundleDraft();
    draft.provenance.push({
      entityKind: "node",
      entityId: "missing-node",
      origin: "figma_node",
      sourceIdHash: "d".repeat(64),
    });

    expect(() => designBundleDraftSchema.parse(draft)).toThrow(
      "悬空来源追溯引用：node:missing-node",
    );
  });

  it("区分 Figma Variable 元数据与项目内推导名称", () => {
    expect(() =>
      normalizedDesignValueSchema.parse({
        id: "figma-variable",
        name: "Color / Surface",
        origin: "figma_variable",
        kind: "color",
        value: { r: 1, g: 1, b: 1, a: 1 },
        sourceRefHash: "a".repeat(64),
        collection: {
          sourceRefHash: "b".repeat(64),
          name: "Primitives",
        },
      }),
    ).toThrow("Figma Variable 必须保留来源、集合和模式");

    expect(() =>
      normalizedDesignValueSchema.parse({
        id: "inferred",
        name: "Color / Surface",
        origin: "inferred",
        kind: "color",
        value: { r: 1, g: 1, b: 1, a: 1 },
        collection: {
          sourceRefHash: "b".repeat(64),
          name: "Fake",
        },
      }),
    ).toThrow();
  });
});
