import { describe, expect, it } from "vitest";

import { assertJsonValueGraph } from "../../src/contract/json-value.js";
import { RuntimeError } from "../../src/contract/types.js";

describe("object source JSON graph", () => {
  it("accepts nested transport-safe JSON", () => {
    expect(() => assertJsonValueGraph({ a: [1, true, null, "x"] })).not.toThrow();
  });

  it.each([
    undefined,
    () => undefined,
    Symbol("x"),
    1n,
    Number.NaN,
    new Date(),
  ])("rejects non-JSON input", (value) => {
    expect(() => assertJsonValueGraph({ value })).toThrowError(RuntimeError);
  });

  it("rejects cycles and accessors", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertJsonValueGraph(cyclic)).toThrowError(RuntimeError);
    expect(() => assertJsonValueGraph({ get value() { return 1; } })).toThrowError(RuntimeError);
  });

  it("rejects object properties that JSON serialization would omit", () => {
    const value = { visible: true };
    Object.defineProperty(value, "hidden", {
      value: "not transported",
      enumerable: false,
    });

    expect(() => assertJsonValueGraph(value)).toThrowError(RuntimeError);
  });

  it("rejects sparse arrays and non-index array properties", () => {
    const sparse = new Array(1);
    const extra = [1] as number[] & { extra?: number };
    extra.extra = 2;
    const nonEnumerable = [1];
    Object.defineProperty(nonEnumerable, "hidden", {
      value: 2,
      enumerable: false,
    });
    const nonCanonical = [1] as number[] & Record<string, unknown>;
    nonCanonical["01"] = 2;

    for (const value of [sparse, extra, nonEnumerable, nonCanonical]) {
      expect(() => assertJsonValueGraph(value)).toThrowError(RuntimeError);
    }
  });

  it("does not disclose object-source property names in error details", () => {
    const secret = "https://user:password@example.test/path?token=secret";
    let error: RuntimeError | undefined;

    try {
      assertJsonValueGraph({ [secret]: undefined });
    } catch (cause) {
      error = cause as RuntimeError;
    }

    expect(error).toBeInstanceOf(RuntimeError);
    expect(error?.details).not.toHaveProperty("path");
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
