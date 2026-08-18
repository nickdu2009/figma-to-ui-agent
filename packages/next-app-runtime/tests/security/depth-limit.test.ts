import { describe, expect, it } from "vitest";

import { createRuntimeWithNavigation } from "../../src/runtime/create-runtime.js";
import { createMemoryNavigation } from "../../src/testing/memory-navigation.js";
import {
  createTestSpec,
  testCatalog,
  testFallbacks,
  testLimits,
  testRegistry,
} from "../../src/testing/fixtures.js";

describe("runtime input depth limit", () => {
  it("rejects an extremely deep object before recursive parsing or serialization", async () => {
    const spec = createTestSpec();
    let nested: Record<string, unknown> = {};
    const payload = nested;
    for (let index = 0; index < 5_000; index += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }
    spec.routes["/"]!.page.elements.root!.props.payload = payload;
    const runtime = createRuntimeWithNavigation({
      catalog: testCatalog,
      registry: testRegistry,
      limits: { ...testLimits, maxDepth: 100 },
      fallbacks: testFallbacks,
    }, createMemoryNavigation());

    await expect(runtime.applySource({ kind: "object", value: spec })).resolves.toMatchObject({
      status: "rejected",
      error: { code: "source_limit_exceeded" },
    });
    runtime.dispose();
  });
});
