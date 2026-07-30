import { describe, expect, it } from "vitest";

import { generateComponentFixtures } from "../../../catalog/src/fixtures.ts";
import { previewCatalog } from "../../../src/preview/catalog.ts";
import { toPreviewJsonSpec } from "../../../src/preview/json-render-adapter.ts";

describe("generateComponentFixtures", () => {
  it("为每个公开 previewCatalog 组件生成 fixture", () => {
    const fixtures = generateComponentFixtures();
    const catalog = previewCatalog as unknown as {
      data: { components: Record<string, unknown> };
    };
    const expectedKinds = Object.keys(catalog.data.components).filter(
      (name) => name !== "TabPanel" && name !== "Conditional",
    );

    expect(fixtures.map((fixture) => fixture.kind).sort()).toEqual(
      expectedKinds.sort(),
    );
  });

  it("每个 fixture 的 initialSpec 可转换为 Preview JSON", () => {
    const fixtures = generateComponentFixtures();
    for (const fixture of fixtures) {
      const pageId = fixture.initialSpec.pages[0]!.id;
      expect(() =>
        toPreviewJsonSpec(fixture.initialSpec, pageId, {
          imageUrl: (path) => path,
        }),
      ).not.toThrow();
    }
  });

  it("每个 fixture 的示例节点 kind 与 fixture.nodeKind 一致", () => {
    const fixtures = generateComponentFixtures();
    for (const fixture of fixtures) {
      const exampleNode = fixture.initialSpec.nodes.find(
        (node) => node.kind === fixture.nodeKind,
      );
      expect(exampleNode).toBeDefined();
    }
  });
});
