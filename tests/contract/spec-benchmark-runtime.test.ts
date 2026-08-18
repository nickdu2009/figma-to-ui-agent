import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createMemoryNavigation,
  createRuntimeWithNavigation,
} from "@next-app-runtime/client/testing";
import { describe, expect, it } from "vitest";

// pi-lens-ignore: ts:5097
import { modelCatalog } from "../../server/model-catalog.ts";
// pi-lens-ignore: ts:5097
import {
  BENCHMARK_FALLBACKS,
  BENCHMARK_RUNTIME_LIMITS,
  modelBenchmarkRegistry,
} from "../../server/benchmark/spec-benchmark-runtime.ts";

describe("spec benchmark runtime", () => {
  it("pairs the model catalog with implementations and commits a valid candidate", async () => {
    expect(Object.keys(modelBenchmarkRegistry).sort()).toEqual(
      [...modelCatalog.componentNames].sort(),
    );
    const candidate = JSON.parse(await readFile(
      resolve("tests/fixtures/spec-benchmark/candidate.json"),
      "utf8",
    )) as unknown;
    const runtime = createRuntimeWithNavigation({
      catalog: modelCatalog,
      registry: modelBenchmarkRegistry,
      limits: BENCHMARK_RUNTIME_LIMITS,
      fallbacks: BENCHMARK_FALLBACKS,
    }, createMemoryNavigation("/"));
    try {
      const result = await runtime.applySource({ kind: "object", value: candidate });
      expect(result.status).toBe("committed");
      expect(runtime.getSnapshot().routeStatus).toBe("ready");
    } finally {
      runtime.dispose();
    }
  });
});
