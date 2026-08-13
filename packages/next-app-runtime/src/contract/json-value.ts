import { RuntimeError } from "./types.js";

function fail(path: string, reason: string): never {
  throw new RuntimeError("contract_invalid", "Object source is not transport-safe JSON", {
    path,
    reason,
  });
}

export function assertJsonValueGraph(value: unknown): void {
  const active = new Set<object>();

  const arrayIndex = (key: string, length: number): number | null => {
    if (!/^(0|[1-9]\d*)$/u.test(key)) return null;
    const index = Number(key);
    return Number.isSafeInteger(index) && index < length && String(index) === key
      ? index
      : null;
  };

  const visit = (input: unknown, path: string): void => {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    ) {
      return;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) fail(path, "non_finite_number");
      return;
    }
    if (typeof input !== "object") fail(path, `unsupported_${typeof input}`);
    if (active.has(input)) fail(path, "cycle");

    const prototype = Object.getPrototypeOf(input);
    if (Array.isArray(input)) {
      if (prototype !== Array.prototype) fail(path, "non_plain_array");
    } else if (prototype !== Object.prototype && prototype !== null) {
      fail(path, "non_plain_object");
    }

    const keys = Reflect.ownKeys(input);
    if (Array.isArray(input)) {
      const indices = keys.filter((key) => typeof key === "string" && key !== "length");
      if (indices.length !== input.length) fail(path, "sparse_array");
      for (const key of indices) {
        if (arrayIndex(key as string, input.length) === null) {
          fail(`${path}/${String(key)}`, "non_index_array_property");
        }
      }
    }

    active.add(input);
    for (const key of keys) {
      if (typeof key === "symbol") fail(path, "symbol_key");
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) fail(`${path}/${key}`, "accessor");
      if (Array.isArray(input) && key === "length") continue;
      if (!descriptor.enumerable) fail(`${path}/${key}`, "non_enumerable_property");
      visit(descriptor.value, `${path}/${key}`);
    }
    active.delete(input);
  };

  visit(value, "");
}
