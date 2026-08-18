import { describe, expect, it } from "vitest";

import { applyJsonPatch } from "../../src/stream/json-patch.js";
import { parsePointer } from "../../src/stream/json-pointer.js";

describe("JSON Pointer security", () => {
  it.each([
    "/__proto__/polluted",
    "/constructor/prototype/polluted",
    "/prototype/value",
  ])("does not traverse inherited parents for %s", (path) => {
    expect(parsePointer(path)).toEqual(path.slice(1).split("/"));
    expect(() => applyJsonPatch({}, [{ op: "add", path, value: true }])).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("treats reserved path segments as own JSON data", () => {
    const result = applyJsonPatch({}, [
      { op: "add", path: "/__proto__", value: {} },
      { op: "add", path: "/__proto__/polluted", value: "literal" },
      { op: "replace", path: "/__proto__/polluted", value: "replaced" },
      { op: "add", path: "/constructor", value: {} },
      { op: "add", path: "/constructor/prototype", value: {} },
      { op: "add", path: "/constructor/prototype/polluted", value: "literal" },
      { op: "add", path: "/prototype", value: {} },
      { op: "add", path: "/prototype/value", value: "literal" },
      { op: "copy", from: "/__proto__/polluted", path: "/constructor/prototype/copied" },
      { op: "move", from: "/prototype/value", path: "/__proto__/moved" },
      { op: "test", path: "/__proto__/moved", value: "literal" },
      { op: "remove", path: "/constructor/prototype/copied" },
    ]) as Record<string, unknown>;

    // Patch documents are detached transport graphs; a null prototype keeps
    // every reserved segment as own JSON data without ambient inheritance.
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.hasOwn(result, "constructor")).toBe(true);
    expect(Object.hasOwn(result, "prototype")).toBe(true);
    expect(result["__proto__"]).toEqual({ polluted: "replaced", moved: "literal" });
    expect(result.constructor).toEqual({ prototype: { polluted: "literal" } });
    expect(result.prototype).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each(["0", "9007199254740992"])(
    "does not copy inherited array data from index %s",
    (index) => {
      Object.defineProperty(Array.prototype, index, {
        configurable: true,
        value: "ambient-secret",
        writable: true,
      });
      try {
        expect(() => applyJsonPatch([], [
          { op: "copy", from: `/${index}`, path: "/-" },
        ])).toThrowError(expect.objectContaining({ code: "patch_invalid" }));
      } finally {
        delete (Array.prototype as unknown as Record<string, unknown>)[index];
      }
    },
  );

  it("rejects malformed escapes", () => {
    expect(() => parsePointer("/a~2b")).toThrow();
  });
});
