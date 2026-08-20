/**
 * 浏览器侧运行时 Catalog 与 Registry（设计 §10.3，计划 S5）：
 * - 模型可见 catalog 由 CatalogContract 派生（base 35 + overlay 7 + additions
 *   46 + customActions 10；任何合同校验失败在模块加载期 throw，fail closed）；
 * - React 绑定经 catalog-bindings.tsx 组装（同一合同键闭合）；
 * - registry actions 是永不定局的包装：custom Action 的唯一执行边界是
 *   RuntimeActionDispatcher（S3 分流；上游 binding onSuccess/onError 不触发）。
 */
import { defineRegistry } from "@json-render/react";

import { catalogContract } from "../catalog/catalog-contract.ts";
import { deriveCatalog } from "../catalog/derive-catalog.ts";
import { createCatalogBindings } from "./catalog-bindings.tsx";

export const derivedCatalog = deriveCatalog(catalogContract);
export const catalog = derivedCatalog.catalog;

const bindings = createCatalogBindings();

/** registry 层的 custom Action 包装：永不定局（执行只属于 Dispatcher）。 */
function neverSettlingAction(): Promise<void> {
  return new Promise(() => {});
}

const registryActions = Object.fromEntries(
  derivedCatalog.customActionKeys.map((name) => [name, neverSettlingAction]),
) as unknown as Parameters<typeof defineRegistry>[1]["actions"];

export const { registry } = defineRegistry(catalog, {
  components: bindings.components as unknown as Parameters<
    typeof defineRegistry
  >[1]["components"],
  actions: registryActions,
});

export const registryKeys = derivedCatalog.registryKeys;
export const customActionKeys = derivedCatalog.customActionKeys;
export const compoundStructure = derivedCatalog.compoundStructure;
