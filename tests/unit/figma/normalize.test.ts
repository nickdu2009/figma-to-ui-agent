import { describe, expect, it } from "vitest";

import { designBundleDraftSchema } from "../../../src/design-bundle/schema.ts";
import {
  FigmaNormalizationError,
  normalizeFigmaDocument,
} from "../../../src/figma/normalize.ts";
import {
  FIXTURE_ASSET_PATH,
  FIXTURE_ASSET_SHA,
} from "../../fixtures/contracts.ts";
import { createFigmaFileResponseFixture } from "../../fixtures/figma/file-response.ts";

function expectNormalizationCode(
  code: FigmaNormalizationError["code"],
) {
  return expect.objectContaining({
    name: "FigmaNormalizationError",
    code,
  });
}

describe("normalizeFigmaDocument", () => {
  it("发现多页面并标准化布局、文本、实例、Styles、图片和变量绑定", () => {
    const normalized = normalizeFigmaDocument(
      createFigmaFileResponseFixture(),
      {
        imagePathBySourceRef: new Map([
          ["image-source-1", FIXTURE_ASSET_PATH],
        ]),
      },
    );

    expect(normalized.pages.map((page) => page.id)).toEqual([
      "1:1",
      "2:1",
    ]);
    expect(normalized.pages[0]).toMatchObject({
      name: "Home",
      width: 1440,
      height: 900,
      rootNodeIds: ["1:1"],
    });
    expect(normalized.pages[0]!.nodes[0]).toMatchObject({
      id: "1:1",
      kind: "container",
      layout: {
        direction: "vertical",
        gap: 24,
        paddingTop: 32,
        alignItems: "center",
        justifyContent: "start",
      },
      styleRefs: ["style-fill"],
    });
    expect(
      normalized.pages[0]!.nodes.find((node) => node.id === "1:2"),
    ).toMatchObject({
      kind: "text",
      text: {
        characters: "Welcome",
        fontFamily: "Inter",
        fontSize: 32,
        fontWeight: 700,
        lineHeight: 40,
      },
      styleRefs: ["style-text"],
      boundVariableRefs: [expect.stringMatching(/^[a-f0-9]{64}$/)],
    });
    expect(
      normalized.pages[0]!.nodes.find((node) => node.id === "1:3"),
    ).toMatchObject({
      kind: "image",
      imageRefs: [FIXTURE_ASSET_PATH],
    });
    expect(
      normalized.pages[0]!.nodes.find((node) => node.id === "1:4"),
    ).toMatchObject({
      kind: "instance",
      componentRef: "component-main",
      componentProperties: [
        { name: "Label", type: "TEXT", value: "Continue" },
        { name: "Show icon", type: "BOOLEAN", value: true },
        { name: "State", type: "VARIANT", value: "Disabled" },
      ],
      variantProperties: {
        Size: "Medium",
        State: "Disabled",
      },
    });
    expect(
      normalized.pages[0]!.nodes.find((node) => node.id === "1:6"),
    ).toMatchObject({
      visual: {
        fillCount: 1,
        strokeCount: 0,
        effectCount: 0,
        vectorPathCount: 0,
      },
      designValueRefs: [expect.stringMatching(/^inferred\.[a-f0-9]{64}$/)],
    });
    expect(normalized.designValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: normalized.pages[0]!.nodes.find((node) => node.id === "1:6")!
            .designValueRefs[0],
          name: expect.stringMatching(/^color\.fill\.[a-f0-9]{8}$/),
          origin: "inferred",
          kind: "color",
          value: { r: 0.9, g: 0.95, b: 1, a: 0.75 },
        }),
      ]),
    );
    expect(normalized.components).toContainEqual({
      id: "component-main",
      name: "Primary button",
      sourceType: "component",
      description: "Primary action",
    });
    expect(normalized.styles.map((style) => style.kind).sort()).toEqual([
      "color",
      "typography",
    ]);
    expect(normalized.imageSourceRefs).toEqual([
      { nodeId: "1:3", sourceRef: "image-source-1" },
    ]);
    expect(normalized.visualLayerRefs).toEqual([
      { nodeId: "1:3", reason: "image_fill" },
      { nodeId: "1:6", reason: "large_visual" },
    ]);
    expect(normalized.boundVariableSources).toEqual([
      {
        sourceIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceVariableId: "VariableID:font-size",
      },
    ]);
    expect(normalized.bindingObservations).toEqual([
      {
        nodeId: "1:2",
        property: "fontSize",
        sourceIdHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceVariableId: "VariableID:font-size",
        resolvedValue: 32,
      },
    ]);
    expect(normalized.warnings).toContainEqual(
      expect.objectContaining({
        code: "unsupported_node_type",
        entityId: "1:5",
      }),
    );

    expect(() =>
      designBundleDraftSchema.parse({
        schemaVersion: "1",
        projectId: "demo-project",
        source: {
          provider: "figma_rest",
          fileKeyHash: "b".repeat(64),
          targetNodeIds: [],
          inspectedAt: "2026-07-23T10:00:00.000Z",
        },
        capabilities: {
          variables: {
            status: "unavailable_optional",
            reasonCode: "plan_limited",
          },
        },
        pages: normalized.pages,
        components: normalized.components,
        styles: normalized.styles,
        designValues: normalized.designValues,
        screenshots: [],
        assets: [
          {
            path: FIXTURE_ASSET_PATH,
            sha256: FIXTURE_ASSET_SHA,
            byteCount: 128,
            mimeType: "image/png",
            width: 640,
            height: 480,
          },
        ],
        provenance: normalized.provenance,
        warnings: normalized.warnings,
      }),
    ).not.toThrow();
  });

  it("视觉层识别不会只因名称命中而收集小节点", () => {
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{
        children?: Array<{
          children?: unknown[];
        }>;
      }>;
    };
    document.children[0]?.children?.[0]?.children?.push({
      id: "1:7",
      name: "Decorative Logo Background",
      type: "VECTOR",
      absoluteBoundingBox: {
        x: 16,
        y: 16,
        width: 24,
        height: 24,
      },
      fills: [
        {
          type: "SOLID",
          color: { r: 0, g: 0, b: 0 },
        },
      ],
    });

    const normalized = normalizeFigmaDocument(fixture);

    expect(normalized.visualLayerRefs).not.toContainEqual(
      expect.objectContaining({ nodeId: "1:7" }),
    );
  });

  it("视觉层识别会收集非命名的结构视觉信号", () => {
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{
        children?: Array<{
          children?: unknown[];
        }>;
      }>;
    };
    document.children[0]?.children?.[0]?.children?.push({
      id: "1:8",
      name: "Layer 8",
      type: "VECTOR",
      absoluteBoundingBox: {
        x: 240,
        y: 160,
        width: 96,
        height: 96,
      },
      opacity: 0.64,
      blendMode: "MULTIPLY",
      cornerRadius: 12,
      strokeWeight: 2,
      vectorPaths: [{ windingRule: "NONZERO", data: "M0 0L1 1Z" }],
      strokes: [
        {
          type: "SOLID",
          color: { r: 0.8, g: 0.7, b: 0.6 },
          opacity: 0.5,
        },
      ],
      effects: [{ type: "DROP_SHADOW", visible: true }],
      fills: [
        {
          type: "SOLID",
          color: { r: 0.2, g: 0.3, b: 0.4 },
        },
      ],
    });

    const normalized = normalizeFigmaDocument(fixture);

    expect(normalized.visualLayerRefs).toContainEqual({
      nodeId: "1:8",
      reason: "structural_visual",
    });
    expect(
      normalized.pages[0]!.nodes.find((node) => node.id === "1:8"),
    ).toMatchObject({
      visual: {
        opacity: 0.64,
        blendMode: "MULTIPLY",
        fillCount: 1,
        strokeCount: 1,
        strokeWeight: 2,
        strokeColor: { r: 0.8, g: 0.7, b: 0.6, a: 0.5 },
        effectCount: 1,
        vectorPathCount: 1,
        cornerRadius: 12,
      },
    });
  });

  it("显式目标优先，并忽略已包含的后代目标", () => {
    const normalized = normalizeFigmaDocument(
      createFigmaFileResponseFixture(),
      {
        targetNodeIds: ["1:1", "1:2"],
      },
    );

    expect(normalized.pages).toHaveLength(1);
    expect(normalized.pages[0]!.id).toBe("1:1");
    expect(normalized.pages[0]!.nodes.map((node) => node.id)).toContain(
      "1:2",
    );
    expect(normalized.warnings).toContainEqual({
      code: "redundant_target_node",
      entityId: "1:2",
      detail: "目标节点已包含在另一个显式目标内",
    });
  });

  it("显式 CANVAS 目标展开为可见顶层子页面", () => {
    const normalized = normalizeFigmaDocument(
      createFigmaFileResponseFixture(),
      {
        targetNodeIds: ["0:1"],
      },
    );

    expect(normalized.pages).toHaveLength(1);
    expect(normalized.pages[0]).toMatchObject({
      id: "1:1",
      name: "Home",
      rootNodeIds: ["1:1"],
    });
    expect(normalized.warnings).toContainEqual({
      code: "canvas_target_expanded_to_child_pages",
      entityId: "0:1",
      detail:
        "显式 CANVAS 目标已展开为可见顶层子节点，避免把整张 Figma 说明画布当作单页参考图",
    });
  });

  it("显式嵌套节点成为独立页面根且不保留项目外父引用", () => {
    const normalized = normalizeFigmaDocument(
      createFigmaFileResponseFixture(),
      {
        targetNodeIds: ["1:2"],
      },
    );

    expect(normalized.pages).toHaveLength(1);
    expect(normalized.pages[0]).toMatchObject({
      id: "1:2",
      rootNodeIds: ["1:2"],
      nodes: [
        expect.objectContaining({
          id: "1:2",
          parentId: undefined,
        }),
      ],
    });
  });

  it("组件目录不为未选中节点创建悬空 nodeId", () => {
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{
        children: Array<{ children?: Array<Record<string, unknown>> }>;
      }>;
    };
    document.children[1]!.children[0]!.children = [
      {
        id: "component-outside",
        name: "Outside component",
        type: "COMPONENT",
        children: [],
      },
    ];
    (fixture.components as Record<string, unknown>)[
      "component-outside"
    ] = {
      name: "Outside component",
    };

    const normalized = normalizeFigmaDocument(fixture, {
      targetNodeIds: ["1:2"],
    });
    expect(
      normalized.components.find(
        (component) => component.id === "component-outside",
      ),
    ).toEqual({
      id: "component-outside",
      name: "Outside component",
      sourceType: "component",
      description: undefined,
    });
  });

  it("保留空 Canvas 作为可解释空页面", () => {
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{ id: string; children: unknown[] }>;
    };
    document.children = [
      {
        id: "0:9",
        name: "Empty",
        type: "CANVAS",
        children: [],
      } as never,
    ];

    const normalized = normalizeFigmaDocument(fixture);
    expect(normalized.pages).toEqual([
      {
        id: "0:9",
        name: "Empty",
        width: 0,
        height: 0,
        rootNodeIds: [],
        nodes: [],
      },
    ]);
  });

  it("接受 Figma 返回的 null absoluteBoundingBox", () => {
    const fixture = createFigmaFileResponseFixture();
    const document = fixture.document as {
      children: Array<{
        children: Array<{ children?: Array<Record<string, unknown>> }>;
      }>;
    };
    document.children[0]!.children[0]!.children ??= [];
    document.children[0]!.children[0]!.children.push({
      id: "1:99",
      name: "Union",
      type: "BOOLEAN_OPERATION",
      absoluteBoundingBox: null,
      children: [],
    });

    const normalized = normalizeFigmaDocument(fixture);

    expect(
      normalized.pages[0]!.nodes.find((node) => node.id === "1:99"),
    ).toMatchObject({
      id: "1:99",
      bounds: undefined,
    });
  });

  it("缺失目标、重复 ID、节点超限和深度超限失败关闭", () => {
    const fixture = createFigmaFileResponseFixture();
    expect(() =>
      normalizeFigmaDocument(fixture, {
        targetNodeIds: ["99:99"],
      }),
    ).toThrowError(expectNormalizationCode("target_not_found"));
    expect(() =>
      normalizeFigmaDocument(fixture, { maxNodes: 2 }),
    ).toThrowError(expectNormalizationCode("node_limit_exceeded"));
    expect(() =>
      normalizeFigmaDocument(fixture, { maxDepth: 1 }),
    ).toThrowError(expectNormalizationCode("depth_limit_exceeded"));

    const duplicate = createFigmaFileResponseFixture();
    const document = duplicate.document as {
      children: Array<{ children: Array<{ id: string }> }>;
    };
    document.children[1]!.children[0]!.id = "1:1";
    expect(() => normalizeFigmaDocument(duplicate)).toThrowError(
      expectNormalizationCode("duplicate_node_id"),
    );
  });
});
