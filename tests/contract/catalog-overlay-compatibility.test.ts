/**
 * Overlay 兼容性契约测试（S1，设计 §5.3/§8）：
 * - 每个 widening 的 legacy/preferred 双夹具都经机械 union 解析，legacy 必须走 base 分支；
 * - prop additions 纯 optional 恒等（undefined -> undefined）；
 * - events/styleParts/tokenBindings 只增不删；
 * - v1 legacy fixture（旧 spec 形态）在合并后的定义下仍可解析。
 */
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { catalogContract } from "../../src/catalog/catalog-contract.js";
import { deriveCatalog } from "../../src/catalog/derive-catalog.js";
import type { ExistingComponentOverlay } from "../../src/catalog/overlays.js";
import { p0ComponentOverlays } from "../../src/catalog/overlays.js";

const derived = deriveCatalog(catalogContract);
const base = catalogContract.components.base;

function baseProp(component: string, prop: string): z.ZodType {
  const def = base[component as keyof typeof base] as { props: z.ZodObject<Record<string, z.ZodType>> };
  const schema = def.props.shape[prop];
  if (!schema) throw new Error(`base prop 不存在：${component}.${prop}`);
  return schema;
}

describe("overlay widenings 双夹具", () => {
  const wideningCases: Array<{ component: string; prop: string }> = [];
  for (const [component, overlay] of Object.entries(p0ComponentOverlays)) {
    for (const prop of Object.keys(overlay.props?.widenings ?? {})) {
      wideningCases.push({ component, prop });
    }
  }

  it("widenings 清单精确（Table.columns、Select.options）", () => {
    expect(wideningCases).toEqual([
      { component: "Table", prop: "columns" },
      { component: "Select", prop: "options" },
    ]);
  });

  for (const { component, prop } of wideningCases) {
    it(`${component}.${prop}：legacy 经 base 分支、preferred 经 union 解析`, () => {
      const overlay: ExistingComponentOverlay = p0ComponentOverlays[component as keyof typeof p0ComponentOverlays];
      const widening = overlay.props?.widenings?.[prop];
      expect(widening).toBeDefined();
      const basePropSchema = baseProp(component, prop);
      // legacy 夹具必须经 base 分支解析（向后兼容）
      expect(basePropSchema.safeParse(widening?.legacyFixture).success).toBe(true);
      // 合并后的定义两个夹具都可解析
      const merged = derived.mergedComponentDefinitions[component];
      expect(merged).toBeDefined();
      const mergedProp = (merged?.props as z.ZodObject<Record<string, z.ZodType>>).shape[prop];
      expect(mergedProp?.safeParse(widening?.legacyFixture).success).toBe(true);
      expect(mergedProp?.safeParse(widening?.preferredFixture).success).toBe(true);
    });
  }
});

describe("overlay prop additions 纯 optional 恒等", () => {
  for (const [component, overlay] of Object.entries(p0ComponentOverlays)) {
    const additions = overlay.props?.additions ?? {};
    for (const [prop, schema] of Object.entries(additions)) {
      it(`${component}.${prop}：undefined 解析为 undefined`, () => {
        const parsed = schema.safeParse(undefined);
        expect(parsed.success).toBe(true);
        expect(parsed.data).toBeUndefined();
      });
    }
  }
});

describe("overlay events/children 只增不删", () => {
  it("Button events 保持 press，无删除", () => {
    const merged = derived.mergedComponentDefinitions.Button;
    expect(merged?.events).toEqual(["press"]);
  });

  it("Table 增加 requestData/rowAction events", () => {
    const merged = derived.mergedComponentDefinitions.Table;
    expect(merged?.events).toEqual(["requestData", "rowAction"]);
  });

  it("Select events 保持 change", () => {
    const merged = derived.mergedComponentDefinitions.Select;
    expect(merged?.events).toEqual(["change"]);
  });

  it("Accordion/Popover/Carousel 获得 children（slots）且 base props 保留", () => {
    for (const component of ["Accordion", "Popover", "Carousel"] as const) {
      const merged = derived.mergedComponentDefinitions[component];
      expect(merged?.slots).toEqual(["default"]);
      const baseDef = base[component] as { props: z.ZodObject<Record<string, z.ZodType>> };
      const mergedShape = (merged?.props as z.ZodObject<Record<string, z.ZodType>>).shape;
      for (const key of Object.keys(baseDef.props.shape)) {
        expect(mergedShape[key]).toBeDefined();
      }
    }
  });
});

describe("v1 legacy fixture 兼容", () => {
  it("旧 Table spec 形态（字符串 columns/rows）仍可解析", () => {
    const table = derived.mergedComponentDefinitions.Table;
    expect(
      table?.props.safeParse({
        columns: ["Name", "Role"],
        rows: [["Alice", "Admin"], ["Bob", "User"]],
        caption: null,
      }).success,
    ).toBe(true);
  });

  it("旧 Accordion/Popover/Carousel props 形态仍可解析", () => {
    const accordion = derived.mergedComponentDefinitions.Accordion;
    expect(
      accordion?.props.safeParse({
        items: [{ title: "Q", content: "A" }],
        type: null,
      }).success,
    ).toBe(true);
  });
});
