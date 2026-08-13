import { describe, expect, it } from "vitest";

import { applyJsonPatch } from "../../src/stream/json-patch.js";
import { parsePointer } from "../../src/stream/json-pointer.js";

describe("JSON Pointer security", () => {
  it.each([
    "/__proto__/polluted",
    "/constructor/prototype/polluted",
    "/safe/prototype/value",
  ])("rejects reserved path segments", (path) => {
    expect(() => parsePointer(path)).toThrow();
    expect(() => applyJsonPatch({}, [{ op: "add", path, value: true }])).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects malformed escapes", () => {
    expect(() => parsePointer("/a~2b")).toThrow();
  });
});
