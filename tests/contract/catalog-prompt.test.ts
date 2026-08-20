import { describe, expect, it } from "vitest";

import { catalog } from "../../src/runtime/catalog";

/**
 * 计划 §5「Prompt 与校验边界」契约（S5 更新）：
 * - 模型 catalog = base 35（36 个 shadcn 导出减运行时接管的 Link）
 *   + P0 additions 46 = 81 个组件；overlay 在位扩宽不新增键。
 * - catalog.prompt() 携带 P0 组件族与 10 个 custom Action 语义，
 *   保持精简（按族分片）；完整 catalog-aware JSON Schema 只用于程序校验。
 */
describe("model catalog contract", () => {
  it("contains base 35 + P0 additions 46 = 81 components without Link/Slot", () => {
    expect(catalog.componentNames).toHaveLength(81);
    expect(catalog.componentNames).not.toContain("Link");
    expect(catalog.componentNames).not.toContain("Slot");
    // base 组件仍在
    expect(catalog.componentNames).toContain("Card");
    expect(catalog.componentNames).toContain("Button");
    expect(catalog.componentNames).toContain("Text");
    // overlay 升级组件在位（不新增键）
    for (const overlayKey of ["Table", "Select", "Accordion", "Popover", "Carousel", "Image"]) {
      expect(catalog.componentNames).toContain(overlayKey);
    }
    // P0 additions 代表性键
    for (const additionKey of [
      "AppShell",
      "Sidebar",
      "NavMenu",
      "DataTable",
      "Form",
      "Icon",
      "AlertDialog",
      "Sheet",
      "EmptyState",
      "ErrorState",
      "DatePicker",
      "MultiSelect",
    ]) {
      expect(catalog.componentNames).toContain(additionKey);
    }
  });

  it("declares exactly the 10 P0 custom actions", () => {
    expect([...catalog.actionNames].sort()).toEqual([
      "closeDialog",
      "createRecord",
      "deleteRecord",
      "downloadExport",
      "loadRecordForm",
      "openDialog",
      "queryRecords",
      "showToast",
      "submitForm",
      "updateRecord",
    ]);
  });

  it("prompt() embeds the structured-Patch preamble and built-in Link/Slot", () => {
    const prompt = catalog.prompt({ system: "TEST_PREAMBLE_MARKER" });
    expect(prompt).toContain("TEST_PREAMBLE_MARKER");
    // 按族分片仍保持精简（设计 §6.3；S5 实测 ~23.6KB）
    expect(prompt.length).toBeLessThan(64 * 1024);
    expect(prompt.length).toBeGreaterThan(10 * 1024);
    expect(prompt).toContain("Link");
    expect(prompt).toContain("Slot");
    for (const name of catalog.componentNames) {
      expect(prompt).toContain(name);
    }
    // 不携带完整 JSON Schema 标记。
    expect(prompt).not.toContain('"$schema"');
    expect(prompt).not.toContain("additionalProperties");
  });

  it("prompt() documents the P0 custom actions for model visibility", () => {
    const prompt = catalog.prompt({});
    for (const actionName of catalog.actionNames) {
      expect(prompt).toContain(actionName);
    }
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
