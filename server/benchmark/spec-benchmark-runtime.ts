import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { schema } from "@next-app-runtime/client/schema";

// pi-lens-ignore: ts:5097
import { catalogContract, derivedModelCatalog } from "../model-catalog.ts";

/**
 * Node 侧 benchmark gate 的渲染投影：单一派生 catalog 的基础组件子集。
 *
 * 派生 catalog（server/model-catalog.ts）是唯一目录来源；benchmark 候选夹具
 * 只使用已有 React 绑定的基础组件，P0 additions 的浏览器绑定由 S5 实现。
 * 这里仅从派生结果读取 base 组件键构造可渲染投影，不重新组装或过滤 Link
 * （Link 已在 CatalogContract 层排除）。
 */
const baseComponentKeys = Object.keys(catalogContract.components.base);

const benchmarkComponentDefinitions = Object.fromEntries(
  baseComponentKeys.map((key) => [
    key,
    derivedModelCatalog.mergedComponentDefinitions[key],
  ]),
) as unknown as typeof catalogContract.components.base;

export const modelBenchmarkCatalog = defineCatalog(schema, {
  components: benchmarkComponentDefinitions,
  actions: {},
});

const benchmarkComponents = Object.fromEntries(
  baseComponentKeys.map((key) => [
    key,
    shadcnComponents[key as keyof typeof shadcnComponents],
  ]),
) as unknown as Record<keyof typeof catalogContract.components.base, never>;

/** Runtime registry paired with modelBenchmarkCatalog for Node-side benchmark gates. */
export const { registry: modelBenchmarkRegistry } = defineRegistry(
  modelBenchmarkCatalog,
  {
    components: benchmarkComponents,
  },
);

export const BENCHMARK_RUNTIME_LIMITS = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};

export const BENCHMARK_FALLBACKS = {
  loading: () => null,
  error: () => null,
  notFound: () => null,
  unmatched: () => null,
};
