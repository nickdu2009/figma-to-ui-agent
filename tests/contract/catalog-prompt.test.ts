import { describe, expect, it } from "vitest";

import { catalog } from "../../src/runtime/catalog";

/**
 * 计划 §5「Prompt 与校验边界」契约：
 * - 模型 catalog 精确为 35 个 shadcn 组件（36 个导出减去运行时接管的 Link）。
 * - catalog.prompt() 供内部结构化 Patch 工具使用、约 11KB，携带 Link/Slot 内置用法。
 * - 完整 catalog-aware JSON Schema 约 31.5MB，只用于程序校验。
 */
describe("model catalog contract", () => {
  it("contains exactly 35 shadcn components without Link/Slot/custom entries", () => {
    expect(catalog.componentNames).toHaveLength(35);
    expect(catalog.componentNames).not.toContain("Link");
    expect(catalog.componentNames).not.toContain("Slot");
    expect(catalog.componentNames).toContain("Card");
    expect(catalog.componentNames).toContain("Button");
    expect(catalog.componentNames).toContain("Text");
  });

  it("prompt() embeds the structured-Patch preamble and built-in Link/Slot", () => {
    const prompt = catalog.prompt({ system: "TEST_PREAMBLE_MARKER" });
    expect(prompt).toContain("TEST_PREAMBLE_MARKER");
    expect(prompt.length).toBeLessThan(64 * 1024);
    expect(prompt.length).toBeGreaterThan(5 * 1024);
    expect(prompt).toContain("Link");
    expect(prompt).toContain("Slot");
    for (const name of catalog.componentNames) {
      expect(prompt).toContain(name);
    }
    // 不携带完整 JSON Schema 标记。
    expect(prompt).not.toContain('"$schema"');
    expect(prompt).not.toContain("additionalProperties");
  });

  it("jsonSchema() is the large programmatic-validation artifact, not for model context", {
    timeout: 30_000,
  }, async () => {
    const serialized = JSON.stringify(catalog.jsonSchema());
    expect(serialized.length).toBeGreaterThan(10 * 1024 * 1024);
  });

  it("validate() accepts the empty-routes minimal shell", () => {
    expect(() =>
      catalog.validate({
        metadata: { title: { default: "t", template: "%s | t" } },
        routes: {},
      }),
    ).not.toThrow();
  });
});
