import { describe, expect, it } from "vitest";

import { RuntimeError } from "../../src/contract/types.js";
import {
  applyJsonPatch,
  type JsonPatchOperation,
} from "../../src/stream/json-patch.js";

function applyRuntimeOperations(input: unknown, operations: readonly unknown[]): unknown {
  return applyJsonPatch(input, operations as readonly JsonPatchOperation[]);
}

function expectPatchInvalid(input: unknown, operations: readonly unknown[]): void {
  try {
    applyRuntimeOperations(input, operations);
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).code).toBe("patch_invalid");
  }
}

describe("strict RFC 6902 operations", () => {
  it("applies add, remove, replace, move, copy and test in order", () => {
    expect(applyJsonPatch(
      { list: ["a", "b"], object: { old: 1 }, escaped: { "a/b": { "~key": true } } },
      [
        { op: "test", path: "/escaped/a~1b/~0key", value: true },
        { op: "add", path: "/object/new", value: 2 },
        { op: "replace", path: "/object/old", value: 3 },
        { op: "copy", from: "/object/new", path: "/copied" },
        { op: "move", from: "/list/0", path: "/list/1" },
        { op: "remove", path: "/object/new" },
      ],
    )).toEqual({
      list: ["b", "a"],
      object: { old: 3 },
      copied: 2,
      escaped: { "a/b": { "~key": true } },
    });
  });

  it("executes duplicate operations instead of deduplicating", () => {
    expect(applyJsonPatch({ list: [] }, [
      { op: "add", path: "/list/-", value: "x" },
      { op: "add", path: "/list/-", value: "x" },
    ])).toEqual({ list: ["x", "x"] });
  });

  it.each([
    [{}, [{ op: "replace", path: "/missing", value: 1 }]],
    [{}, [{ op: "remove", path: "/missing" }]],
  ] as const)("rejects missing replace/remove targets", (input, operations) => {
    expect(() => applyJsonPatch(input, operations)).toThrowError(RuntimeError);
  });

  it("uses a distinct test failure code", () => {
    try {
      applyJsonPatch({ value: { nested: true } }, [
        { op: "test", path: "/value", value: { nested: false } },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).code).toBe("patch_test_failed");
    }
  });

  it("uses JSON numeric equality for negative zero", () => {
    expect(applyJsonPatch(
      { value: -0, nested: { value: 0 } },
      [
        { op: "test", path: "/value", value: 0 },
        { op: "test", path: "/nested/value", value: -0 },
      ],
    )).toEqual({ value: -0, nested: { value: 0 } });
  });

  it.each([
    ["an unknown op", { op: "merge", path: "/value", value: 1 }],
    ["a missing path", { op: "remove" }],
    ["a missing from", { op: "copy", path: "/copy" }],
    ["a missing value", { op: "add", path: "/value" }],
  ])("rejects %s with patch_invalid", (_label, operation) => {
    expectPatchInvalid({}, [operation]);
  });

  it.each([
    ["undefined", undefined],
    ["a function", () => undefined],
    ["a symbol", Symbol("value")],
    ["a bigint", 1n],
    ["a Date", new Date(0)],
    ["a Map", new Map([["key", "value"]])],
    ["a non-finite number", Number.NaN],
  ])("rejects %s operation value with patch_invalid", (_label, value) => {
    expectPatchInvalid({}, [{ op: "add", path: "/value", value }]);
  });

  it("rejects cyclic, accessor, sparse, non-enumerable and exotic values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    const sparse = new Array(1);
    const nonEnumerable = Object.defineProperty({}, "hidden", {
      value: true,
      enumerable: false,
    });
    const exotic = Object.create({ inherited: true }) as Record<string, unknown>;
    exotic.value = true;

    for (const value of [cyclic, accessor, sparse, nonEnumerable, exotic]) {
      expectPatchInvalid({}, [{ op: "add", path: "/value", value }]);
    }
  });

  it.each([
    ["undefined", undefined],
    ["a function", () => undefined],
    ["a symbol", Symbol("input")],
    ["a bigint", 1n],
    ["a Date", new Date(0)],
    ["a Map", new Map([["key", "value"]])],
  ])("rejects %s input document with patch_invalid", (_label, input) => {
    expectPatchInvalid(input, []);
  });

  it("rejects input accessors without invoking them", () => {
    let getterCalls = 0;
    const input = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });

    expectPatchInvalid(input, []);
    expect(getterCalls).toBe(0);
  });

  it.each(["op", "path", "from", "value"])(
    "rejects an accessor %s without invoking it",
    (field) => {
      let getterCalls = 0;
      const operation: Record<string, unknown> = field === "from"
        ? { op: "copy", path: "/copy" }
        : field === "value"
          ? { op: "add", path: "/value" }
          : { op: "remove", path: "/value" };
      Object.defineProperty(operation, field, {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("must not execute");
        },
      });

      expectPatchInvalid({}, [operation]);
      expect(getterCalls).toBe(0);
    },
  );

  it("ignores unrecognized operation members without reading or validating them", () => {
    let getterCalls = 0;
    const operation = { op: "add", path: "/value", value: 1 } as Record<string, unknown>;
    operation.nonJsonExtension = new Map([["key", Symbol("value")]]);
    Object.defineProperty(operation, "accessorExtension", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("must not execute");
      },
    });

    expect(applyRuntimeOperations({}, [operation])).toEqual({ value: 1 });
    expect(getterCalls).toBe(0);
  });

  it("preserves valid primitive roots and JSON numeric negative-zero equality", () => {
    expect(applyRuntimeOperations("before", [
      { op: "replace", path: "", value: false },
    ])).toBe(false);
    expect(applyRuntimeOperations(-0, [
      { op: "test", path: "", value: 0 },
    ])).toBe(-0);
  });
});
