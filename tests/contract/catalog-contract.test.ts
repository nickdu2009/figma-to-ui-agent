/**
 * CatalogContract 契约测试（S1）：
 * - base 35 键（36 - Link）、Link/Slot 不进入任何派生输出；
 * - overlays 精确 7 个白名单组件；additions/customActions/builtInActions 键闭合；
 * - 派生器合并后的 registryKeys/customActionKeys 与版本化夹具精确一致；
 * - widenings 双分支（legacy/preferred）都按设计解析；
 * - 派生负向门禁：addition 覆盖 base、overlay 指向缺失组件、customAction 重声明内置、
 *   非纯 optional prop addition 一律 throw（fail closed）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { p0CustomActions } from "../../src/catalog/action-contracts.js";
import {
  CATALOG_VERSION,
  catalogContract,
  RUNTIME_OWNED_COMPONENTS,
  SPEC_COMPATIBILITY,
} from "../../src/catalog/catalog-contract.js";
import { p0ComponentAdditions } from "../../src/catalog/component-contracts.js";
import { deriveCatalog } from "../../src/catalog/derive-catalog.js";
import { p0ComponentOverlays } from "../../src/catalog/overlays.js";

const FIXTURE_PATH = resolve("tests/fixtures/catalog/catalog-contract.v1.json");

interface CatalogContractFixture {
  catalogVersion: string;
  specCompatibility: string;
  runtimeOwnedComponents: string[];
  baseComponentKeys: string[];
  overlayComponentKeys: string[];
  additionComponentKeys: string[];
  registryKeys: string[];
  customActionKeys: string[];
  builtInActionNames: string[];
  mergedComponentCount: number;
}

const byName = (a: string, b: string) => a.localeCompare(b);

function computeFixture(): CatalogContractFixture {
  const derived = deriveCatalog(catalogContract);
  return {
    catalogVersion: CATALOG_VERSION,
    specCompatibility: SPEC_COMPATIBILITY,
    runtimeOwnedComponents: [...RUNTIME_OWNED_COMPONENTS],
    baseComponentKeys: Object.keys(catalogContract.components.base).sort(byName),
    overlayComponentKeys: Object.keys(catalogContract.components.overlays).sort(byName),
    additionComponentKeys: Object.keys(catalogContract.components.additions).sort(byName),
    registryKeys: derived.registryKeys,
    customActionKeys: derived.customActionKeys,
    builtInActionNames: (catalogContract.builtInActions ?? [])
      .map((action) => action.name)
      .sort(byName),
    mergedComponentCount: derived.registryKeys.length,
  };
}

describe("catalog contract", () => {
  it("版本化夹具与当前派生精确一致（UPDATE=1 可再生成）", async () => {
    const computed = computeFixture();
    if (process.env.UPDATE === "1") {
      await writeFile(FIXTURE_PATH, `${JSON.stringify(computed, null, 2)}\n`, "utf8");
    }
    const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as CatalogContractFixture;
    expect(computed).toEqual(fixture);
  });

  it("base 为 36 - Link = 35 个定义，Link/Slot 不进入任何派生输出", () => {
    const derived = deriveCatalog(catalogContract);
    expect(derived.registryKeys).toHaveLength(fixtureKeyCount("base") + fixtureKeyCount("additions"));
    expect(derived.registryKeys).not.toContain("Link");
    expect(derived.registryKeys).not.toContain("Slot");
    expect(derived.mergedComponentDefinitions.Link).toBeUndefined();
    expect(derived.mergedComponentDefinitions.Slot).toBeUndefined();
    expect(Object.keys(p0CustomActions)).not.toContain("Link");
    for (const key of derived.registryKeys) {
      expect(RUNTIME_OWNED_COMPONENTS).not.toContain(key);
    }
  });

  it("overlay 精确覆盖 7 个白名单组件", () => {
    expect(Object.keys(p0ComponentOverlays).sort(byName)).toEqual([
      "Accordion",
      "Button",
      "Carousel",
      "Image",
      "Popover",
      "Select",
      "Table",
    ]);
  });

  it("customActions 精确 10 个，与内置动作互斥", () => {
    expect(Object.keys(p0CustomActions).sort(byName)).toEqual([
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
    const builtIns = new Set((catalogContract.builtInActions ?? []).map((a) => a.name));
    expect([...builtIns].sort(byName)).toEqual([
      "navigate",
      "pushState",
      "removeState",
      "setState",
    ]);
    for (const key of Object.keys(p0CustomActions)) {
      expect(builtIns.has(key)).toBe(false);
    }
  });

  it("派生 catalog 的 actionNames 只含 10 个 customActions（内置不进 catalog.data.actions）", () => {
    const derived = deriveCatalog(catalogContract);
    expect([...derived.catalog.actionNames].sort(byName)).toEqual(derived.customActionKeys);
    expect(derived.catalog.actionNames).not.toContain("setState");
    expect(derived.catalog.actionNames).not.toContain("navigate");
  });

  it("Table.columns widening：legacy 字符串列与 typed 列均可解析", () => {
    const derived = deriveCatalog(catalogContract);
    const table = derived.mergedComponentDefinitions.Table;
    expect(table).toBeDefined();
    const props = table?.props;
    expect(props?.safeParse({ columns: ["名称", "状态"], rows: [["a", "b"]], caption: null }).success).toBe(true);
    expect(
      props?.safeParse({
        columns: [{ key: "name", label: "名称", cell: "text" }],
        rows: [["a"]],
        caption: null,
      }).success,
    ).toBe(true);
  });

  it("Select.options widening：字符串与 typed option 均可解析", () => {
    const derived = deriveCatalog(catalogContract);
    const select = derived.mergedComponentDefinitions.Select;
    const props = select?.props;
    const selectBase = {
      label: "优先级",
      name: "priority",
      placeholder: null,
      value: null,
      checks: null,
      validateOn: null,
    };
    expect(
      props?.safeParse({ ...selectBase, options: ["标准", "加急"] }).success,
    ).toBe(true);
    expect(
      props?.safeParse({ ...selectBase, options: [{ label: "标准", value: "standard" }] }).success,
    ).toBe(true);
  });

  it("Button overlay additions 生效且 events 保持 press", () => {
    const derived = deriveCatalog(catalogContract);
    const button = derived.mergedComponentDefinitions.Button;
    expect(button?.events).toEqual(["press"]);
    expect(
      button?.props.safeParse({ label: "保存", variant: null, disabled: null, size: "sm", loading: true, icon: "check" }).success,
    ).toBe(true);
    expect(
      button?.props.safeParse({ label: "保存", variant: null, disabled: null, icon: "not-an-icon" }).success,
    ).toBe(false);
  });

  it("Image overlay 增加 objectFit/assetRef 等受控 props", () => {
    const derived = deriveCatalog(catalogContract);
    const image = derived.mergedComponentDefinitions.Image;
    expect(
      image?.props.safeParse({ src: "asset:logo", alt: "logo", width: null, height: null, objectFit: "cover", loading: "lazy" }).success,
    ).toBe(true);
    expect(
      image?.props.safeParse({
        src: null,
        alt: "logo",
        width: null,
        height: null,
        assetRef: {
          assetId: "logo",
          contentHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      }).success,
    ).toBe(true);
    expect(
      image?.props.safeParse({ src: null, alt: "logo", width: null, height: null, assetRef: { assetId: "logo", contentHash: "md5:bad" } }).success,
    ).toBe(false);
  });

  it("compound 结构元数据：additions children 合同与 overlay childrenExtension", () => {
    const derived = deriveCatalog(catalogContract);
    const { childrenContracts, childrenExtensions } = derived.compoundStructure;
    expect(childrenContracts.AppShell?.required).toEqual(["AppMain"]);
    expect(childrenContracts.Section?.required).toEqual(["SectionContent"]);
    expect(childrenContracts.AlertDialog?.allowed).toEqual([
      "AlertDialogTrigger",
      "AlertDialogContent",
    ]);
    expect(childrenExtensions.Accordion?.additions).toEqual([
      "AccordionItem",
      "AccordionTrigger",
      "AccordionContent",
    ]);
    expect(childrenExtensions.Accordion?.requiredWhenPresent?.AccordionItem).toEqual([
      "AccordionTrigger",
      "AccordionContent",
    ]);
    expect(childrenExtensions.Carousel?.uniqueAdditions).toEqual(["CarouselControls"]);
  });

  it("P0 additions 数量与设计清单一致", () => {
    expect(p0ComponentAdditions).toHaveLength(46);
  });

  describe("派生器负向门禁（fail closed）", () => {
    const baseContract = catalogContract;

    it("addition 覆盖上游组件时 throw", () => {
      expect(() =>
        deriveCatalog({
          ...baseContract,
          components: {
            ...baseContract.components,
            additions: {
              Button: p0ComponentAdditions[0] as never,
            },
          },
        }),
      ).toThrow(/覆盖上游组件/);
    });

    it("overlay 指向不存在的组件时 throw", () => {
      expect(() =>
        deriveCatalog({
          ...baseContract,
          components: {
            ...baseContract.components,
            overlays: {
              ...baseContract.components.overlays,
              NoSuchComponent: { eventAdditions: ["x"] },
            } as never,
          },
        }),
      ).toThrow(/指向不存在的组件/);
    });

    it("customAction 重复声明内置动作时 throw", () => {
      expect(() =>
        deriveCatalog({
          ...baseContract,
          customActions: {
            setState: {
              params: z.object({}).strict(),
              result: z.object({}).strict(),
              permissionClass: "ui",
              description: "非法重声明",
            },
          },
        }),
      ).toThrow(/重复声明内置动作/);
    });

    it("非纯 optional 的 prop addition 在 overlay 中 throw", () => {
      expect(() =>
        deriveCatalog({
          ...baseContract,
          components: {
            ...baseContract.components,
            overlays: {
              Button: {
                props: { additions: { requiredThing: z.string() } },
              },
            },
          },
        }),
      ).toThrow(/纯 optional/);
    });

    it("prop addition 与既有 Prop 冲突时 throw", () => {
      expect(() =>
        deriveCatalog({
          ...baseContract,
          components: {
            ...baseContract.components,
            overlays: {
              Button: {
                props: { additions: { label: z.string().optional() } },
              },
            },
          },
        }),
      ).toThrow(/冲突/);
    });

    it("widening 的 legacyFixture 不能经 base 分支解析时 throw", () => {
      expect(() =>
        deriveCatalog({
          ...baseContract,
          components: {
            ...baseContract.components,
            overlays: {
              Select: {
                props: {
                  widenings: {
                    options: {
                      preferredSchema: z.array(z.number()),
                      legacyFixture: [{ not: "a string array" }],
                      preferredFixture: [1, 2],
                    },
                  },
                },
              },
            },
          },
        }),
      ).toThrow(/legacyFixture/);
    });
  });
});

function fixtureKeyCount(kind: "base" | "additions"): number {
  return kind === "base"
    ? Object.keys(catalogContract.components.base).length
    : Object.keys(catalogContract.components.additions).length;
}
