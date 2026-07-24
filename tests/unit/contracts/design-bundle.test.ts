import { describe, expect, it } from "vitest";

import {
  designBundleDraftSchema,
  localImageRefSchema,
  normalizedDesignValueSchema,
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
