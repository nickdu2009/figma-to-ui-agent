import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import {
  assertJsonValueGraph,
  normalizeJsonValueGraph,
} from "../../src/contract/json-value.js";
import { RuntimeError } from "../../src/contract/types.js";

describe("object source JSON graph", () => {
  it("accepts nested transport-safe JSON", () => {
    expect(() => assertJsonValueGraph({ a: [1, true, null, "x"] })).not.toThrow();
  });

  it("accepts a transport-safe object graph created in another realm", () => {
    const value = runInNewContext(`({
      routes: {},
      state: { nested: [{ label: "cross-realm" }, null, true, 1] }
    })`) as unknown;

    expect(value).not.toBeInstanceOf(Object);
    expect(() => assertJsonValueGraph(value)).not.toThrow();
    expect(JSON.stringify(value)).toBe(
      '{"routes":{},"state":{"nested":[{"label":"cross-realm"},null,true,1]}}',
    );
  });

  it("accepts cross-realm JSON containers whose constructor property is hardened", () => {
    const objectValue = runInNewContext(`(() => {
      Object.defineProperty(Object.prototype, "constructor", {
        configurable: true,
        value: function HardenedObject() {},
      });
      return { routes: {}, state: { safe: true } };
    })()`);
    const arrayValue = runInNewContext(`(() => {
      Object.defineProperty(Array.prototype, "constructor", {
        configurable: true,
        value: function HardenedArray() {},
      });
      return [{ safe: true }];
    })()`);

    expect(() => assertJsonValueGraph(objectValue)).not.toThrow();
    expect(() => assertJsonValueGraph(arrayValue)).not.toThrow();
  });

  it("normalizes only own JSON data without invoking inherited serialization hooks", () => {
    let toJsonCalls = 0;
    const prototype = Object.create(null) as { toJSON?: () => unknown };
    Object.defineProperty(prototype, "toJSON", {
      value() {
        toJsonCalls += 1;
        return { tampered: true };
      },
    });
    const input = Object.assign(Object.create(prototype) as object, {
      intended: { value: true },
    });

    const normalized = normalizeJsonValueGraph(input);
    expect(toJsonCalls).toBe(0);
    expect(JSON.stringify(normalized)).toBe('{"intended":{"value":true}}');
    expect(toJsonCalls).toBe(0);
    expect(Object.getPrototypeOf(normalized as object)).toBeNull();
  });

  it("ignores inherited array serialization hooks", () => {
    let toJsonCalls = 0;
    const prototype = [] as unknown[] & { toJSON?: () => unknown };
    Object.defineProperty(prototype, "toJSON", {
      value() {
        toJsonCalls += 1;
        return ["tampered"];
      },
    });
    const input = ["intended"];
    Object.setPrototypeOf(input, prototype);

    const normalized = normalizeJsonValueGraph(input);
    expect(JSON.stringify(normalized)).toBe('["intended"]');
    expect(toJsonCalls).toBe(0);
    expect(Object.getPrototypeOf(normalized as object)).toBeNull();
  });

  it("normalizes arrays without reading an overridable length property", () => {
    let lengthReads = 0;
    const source = new Proxy(["value"], {
      get(target, property, receiver) {
        if (property === "length") lengthReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(normalizeJsonValueGraph(source)).toEqual(["value"]);
    expect(lengthReads).toBe(0);
  });

  it("normalizes negative zero, repeated references, and reserved own keys", () => {
    const shared = { value: true };
    const input = JSON.parse('{"__proto__":{"safe":true}}') as Record<string, unknown>;
    input.negativeZero = -0;
    input.first = shared;
    input.second = shared;

    const normalized = normalizeJsonValueGraph(input) as Record<string, unknown>;

    expect(Object.is(normalized.negativeZero, -0)).toBe(false);
    expect(normalized.negativeZero).toBe(0);
    expect(Object.hasOwn(normalized, "__proto__")).toBe(true);
    expect(normalized.first).not.toBe(normalized.second);
    expect(Object.getPrototypeOf(normalized)).toBeNull();
  });

  it("normalizes deep graphs iteratively and enforces maxDepth", () => {
    let input: unknown = true;
    for (let depth = 0; depth < 5_000; depth += 1) input = { child: input };

    expect(() => normalizeJsonValueGraph(input, 64)).toThrowError(
      expect.objectContaining({ code: "source_limit_exceeded" }),
    );
    expect(() => normalizeJsonValueGraph(input, 5_000)).not.toThrow();
  });

  it("rejects descriptor-reported array lengths beyond the JavaScript limit", () => {
    const source = new Proxy([], {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        return property === "length" && descriptor
          ? { ...descriptor, value: 0x1_0000_0000 }
          : descriptor;
      },
    });

    expect(() => normalizeJsonValueGraph(source)).toThrowError(
      expect.objectContaining({
        code: "contract_invalid",
        details: { reason: "invalid_array_length" },
      }),
    );
  });

  it("does not trust or disclose RuntimeError instances thrown by Proxy traps", () => {
    const secret = "https://user:password@example.test/?token=secret";
    const source = new Proxy({}, {
      ownKeys() {
        throw new RuntimeError("source_limit_exceeded", secret);
      },
    });
    let failure: unknown;

    try {
      normalizeJsonValueGraph(source);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "contract_invalid",
      message: "Object source is not transport-safe JSON",
      details: { reason: "uninspectable_object" },
    });
    expect(String(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it("rejects cross-realm exotic, cyclic, sparse, and accessor graphs", () => {
    const invalidValues = [
      runInNewContext("new Date()"),
      runInNewContext("new (class ForeignInstance {})()"),
      runInNewContext("new (class ForeignArray extends Array {})()"),
      runInNewContext("(() => { const value = []; value.length = 1; return value; })()"),
      runInNewContext("(() => { const value = {}; value.self = value; return value; })()"),
    ];
    for (const value of invalidValues) {
      expect(() => assertJsonValueGraph(value)).toThrowError(
        expect.objectContaining({ code: "contract_invalid" }),
      );
    }

    let getterCalls = 0;
    const accessor = runInNewContext("({ safe: true })") as object;
    Object.defineProperty(accessor, "sensitive", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("cross-realm accessor secret");
      },
    });
    let failure: unknown;
    try {
      assertJsonValueGraph(accessor);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "contract_invalid" });
    expect(getterCalls).toBe(0);
    expect(String(failure)).not.toContain("cross-realm accessor secret");
    expect(JSON.stringify(failure)).not.toContain("sensitive");
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
