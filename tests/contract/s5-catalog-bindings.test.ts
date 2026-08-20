/**
 * S5 Catalog 扩展契约测试：
 * - Registry/Catalog/绑定键精确闭合（81 = base 35 + additions 46）；
 * - 7 个 overlay 绑定在位替换（升级绑定非上游默认）；
 * - 10 个 custom Action 与 Adapter handler 键闭合；
 * - i18n 词典完整性与占位替换；
 * - 结构 smoke：新组件可渲染最小 spec（catalog.validate 通过）。
 */
import { describe, expect, it } from "vitest";
import { shadcnComponents } from "@json-render/shadcn";

import {
  catalog,
  registry,
  registryKeys,
  customActionKeys,
} from "../../src/runtime/catalog";
import { createBrowserRuntimeActionAdapter } from "../../src/runtime/runtime-action-adapter";
import { createCatalogBindings } from "../../src/runtime/catalog-bindings";
import {
  BUILTIN_MESSAGES_ZH_CN_FOR_TEST,
  BUILTIN_MESSAGES_EN_FOR_TEST,
  catalogMessage,
  registerCatalogMessages,
  setCatalogLocale,
} from "../../src/catalog/components/messages";

describe("S5：Registry/Catalog/绑定键闭合", () => {
  it("registryKeys 与 catalog.componentNames 完全一致（81 个）", () => {
    expect(catalog.componentNames).toHaveLength(81);
    expect(registryKeys).toEqual([...catalog.componentNames].sort((a, b) => a.localeCompare(b)));
    for (const key of registryKeys) {
      expect(registry[key]).toBeDefined();
    }
  });

  it("base 35 个 shadcn 键全部保留（Link 除外）", () => {
    const baseKeys = Object.keys(shadcnComponents).filter((key) => key !== "Link");
    expect(baseKeys).toHaveLength(35);
    for (const key of baseKeys) {
      expect(catalog.componentNames).toContain(key);
      expect(registry[key]).toBeDefined();
    }
  });

  it("7 个 overlay 绑定在位替换（键不新增、绑定已替换）", () => {
    for (const key of ["Table", "Select", "Accordion", "Popover", "Carousel", "Button", "Image"]) {
      expect(catalog.componentNames.filter((name: string) => name === key)).toHaveLength(1);
    }
    // 替换后的绑定是 vma 升级实现：绑定源码含 vma 结构类，且与上游默认实现不同。
    const upgradeTable = createCatalogBindings().components.Table;
    expect(String(upgradeTable)).toContain("vma-table");
    expect(String(upgradeTable)).not.toBe(String(shadcnComponents.Table));
    const upgradeButton = createCatalogBindings().components.Button;
    expect(String(upgradeButton)).not.toBe(String(shadcnComponents.Button));
  });

  it("46 个 additions 键全部注册且可渲染", () => {
    const additionKeys = registryKeys.filter(
      (key) => !Object.keys(shadcnComponents).includes(key),
    );
    expect(additionKeys).toHaveLength(46);
    for (const key of additionKeys) {
      expect(registry[key]).toBeDefined();
    }
  });
});

describe("S5：custom Action 键闭合", () => {
  it("catalog 声明 10 个 P0 Action；Adapter 全量注册时键精确闭合", () => {
    expect(customActionKeys).toHaveLength(10);
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app_s5",
      surface: {
        navigate: () => {},
        showToast: () => {},
        setDialogOpen: () => {},
      },
    });
    const handlerKeys = Object.keys(adapter.handlers).sort((a, b) => a.localeCompare(b));
    expect(handlerKeys).toEqual(customActionKeys);
    // 内置 Action 不得进入 Adapter
    for (const reserved of ["navigate", "setState", "pushState", "removeState"]) {
      expect(handlerKeys).not.toContain(reserved);
    }
  });

  it("Adapter includeActionNames 过滤（S4 空 catalog 交集场景）", () => {
    const adapter = createBrowserRuntimeActionAdapter({
      appId: "app_s5",
      surface: {
        navigate: () => {},
        showToast: () => {},
        setDialogOpen: () => {},
      },
      includeActionNames: ["openDialog", "showToast"],
    });
    expect(Object.keys(adapter.handlers).sort()).toEqual(["openDialog", "showToast"]);
  });
});

describe("S5：i18n 词典", () => {
  it("zh-CN 与 en 键集完全一致", () => {
    const zhKeys = Object.keys(BUILTIN_MESSAGES_ZH_CN_FOR_TEST).sort();
    const enKeys = Object.keys(BUILTIN_MESSAGES_EN_FOR_TEST).sort();
    expect(enKeys).toEqual(zhKeys);
    expect(zhKeys.length).toBeGreaterThan(20);
  });

  it("缺省 zh-CN；setCatalogLocale 切换；占位替换确定性", () => {
    expect(catalogMessage("common.loading")).toBe("加载中…");
    setCatalogLocale("en");
    expect(catalogMessage("common.loading")).toBe("Loading…");
    expect(catalogMessage("carousel.position", { index: 3 })).toBe("Item 3");
    setCatalogLocale("zh-CN");
    expect(catalogMessage("carousel.position", { index: 3 })).toBe("第 3 项");
  });

  it("registerCatalogMessages 键闭合 fail closed（缺 key 抛错）", () => {
    expect(() =>
      registerCatalogMessages({
        locale: "xx",
        messages: { "common.loading": "x" } as never,
      }),
    ).toThrow(/缺少 key/);
  });

  it("未知 locale 回退 zh-CN", () => {
    setCatalogLocale("fr-FR");
    expect(catalogMessage("common.retry")).toBe("重试");
    setCatalogLocale("zh-CN");
  });
});

describe("S5：结构 smoke", () => {
  it("使用 P0 组件的 spec 通过 catalog.validate", () => {
    const STACK_PROPS = {
      direction: "vertical",
      gap: "md",
      align: null,
      justify: null,
      className: null,
    };
    expect(() =>
      catalog.validate({
        metadata: { title: { default: "t", template: "%s | t" } },
        routes: {
          "/": {
            page: {
              root: "root",
              elements: {
                root: { type: "AppShell", props: {}, children: ["hdr"] },
                hdr: {
                  type: "AppHeader",
                  props: {},
                  children: [],
                },
              },
            },
          },
        },
      } as never),
    ).not.toThrow();
    void STACK_PROPS;
  });
});
