import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";

// pi-lens-ignore: ts:5097
import { modelCatalog } from "../model-catalog.ts";

const { Link: _runtimeOwnedLink, ...modelComponents } = shadcnComponents;

/** Runtime registry paired with modelCatalog for Node-side benchmark gates. */
export const { registry: modelBenchmarkRegistry } = defineRegistry(modelCatalog, {
  components: modelComponents,
});

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
