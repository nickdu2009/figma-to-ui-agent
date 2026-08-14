import { RuntimeError } from "./types.js";

const ARRAY_CONSTRUCTOR = Array;
const ARRAY_IS_ARRAY = Array.isArray;
const MAX_ARRAY_LENGTH = 0xffff_ffff;
const NUMBER_IS_FINITE = Number.isFinite;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_SET_PROTOTYPE_OF = Object.setPrototypeOf;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const JSON_STRINGIFY = JSON.stringify;
const TEXT_ENCODER = new TextEncoder();

export function isPlainJsonObject(input: object): boolean {
  const prototype = OBJECT_GET_PROTOTYPE_OF(input);
  if (prototype === null) return true;
  return OBJECT_GET_PROTOTYPE_OF(prototype) === null;
}

export function isPlainJsonArray(input: unknown[]): boolean {
  const prototype = OBJECT_GET_PROTOTYPE_OF(input);
  return prototype === null || ARRAY_IS_ARRAY(prototype);
}

function fail(reason: string): never {
  throw new RuntimeError("contract_invalid", "Object source is not transport-safe JSON", {
    reason,
  });
}

function depthLimitExceeded(): never {
  throw new RuntimeError("source_limit_exceeded", "Spec exceeds maxDepth");
}

function dataDescriptor(input: object, key: PropertyKey): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(input, key);
  } catch {
    fail("uninspectable_object");
  }
  if (!descriptor || !("value" in descriptor)) fail("accessor");
  return descriptor;
}

function arrayIndex(key: string, length: number): number | null {
  if (!/^(0|[1-9]\d*)$/u.test(key)) return null;
  const index = Number(key);
  return NUMBER_IS_SAFE_INTEGER(index) && index < length && String(index) === key
    ? index
    : null;
}

interface ContainerInspection {
  array: boolean;
  entries: Array<{ key: string; value: unknown }>;
  length?: number;
}

function inspectContainer(input: object): ContainerInspection {
  let array: boolean;
  let plain: boolean;
  let keys: (string | symbol)[];
  try {
    array = ARRAY_IS_ARRAY(input);
    plain = array
      ? isPlainJsonArray(input as unknown[])
      : isPlainJsonObject(input);
    keys = REFLECT_OWN_KEYS(input);
  } catch {
    fail("uninspectable_object");
  }
  if (!plain) fail(array ? "non_plain_array" : "non_plain_object");

  let length: number | undefined;
  const entries: Array<{ key: string; value: unknown }> = [];
  for (const key of keys) {
    if (typeof key === "symbol") fail("symbol_key");
    const descriptor = dataDescriptor(input, key);
    if (array && key === "length") {
      if (
        descriptor.enumerable ||
        !NUMBER_IS_SAFE_INTEGER(descriptor.value) ||
        descriptor.value < 0 ||
        descriptor.value > MAX_ARRAY_LENGTH
      ) {
        fail("invalid_array_length");
      }
      length = descriptor.value as number;
      continue;
    }
    if (!descriptor.enumerable) fail("non_enumerable_property");
    entries.push({ key, value: descriptor.value });
  }

  if (!array) return { array, entries };
  if (length === undefined) fail("invalid_array_length");
  if (entries.length !== length) fail("sparse_array");
  for (const { key } of entries) {
    if (arrayIndex(key, length) === null) fail("non_index_array_property");
  }
  return { array, entries, length };
}

export function assertJsonValueGraph(value: unknown): void {
  normalizeJsonValueGraph(value);
}

export function normalizeJsonValueGraph(
  value: unknown,
  maxDepth = Number.POSITIVE_INFINITY,
): unknown {
  type Frame =
    | { kind: "exit"; input: object }
    | {
        kind: "visit";
        input: unknown;
        depth: number;
        target: Record<PropertyKey, unknown>;
        key: PropertyKey;
      };

  const active = new Set<object>();
  const root = OBJECT_CREATE(null) as Record<PropertyKey, unknown>;
  const stack: Frame[] = [{
    kind: "visit",
    input: value,
    depth: 0,
    target: root,
    key: "value",
  }];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "exit") {
      active.delete(frame.input);
      continue;
    }

    const { input, depth, target, key } = frame;
    let normalized: unknown;
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    ) {
      normalized = input;
    } else if (typeof input === "number") {
      if (!NUMBER_IS_FINITE(input)) fail("non_finite_number");
      normalized = Object.is(input, -0) ? 0 : input;
    } else {
      if (typeof input !== "object") fail(`unsupported_${typeof input}`);
      if (depth > maxDepth) depthLimitExceeded();
      if (active.has(input)) fail("cycle");

      const inspection = inspectContainer(input);
      normalized = inspection.array
        ? OBJECT_SET_PROTOTYPE_OF(
            new ARRAY_CONSTRUCTOR<unknown>(inspection.length!),
            null,
          ) as unknown[]
        : OBJECT_CREATE(null) as Record<string, unknown>;
      active.add(input);
      stack.push({ kind: "exit", input });
      for (let index = inspection.entries.length - 1; index >= 0; index -= 1) {
        const entry = inspection.entries[index]!;
        stack.push({
          kind: "visit",
          input: entry.value,
          depth: depth + 1,
          target: normalized as Record<PropertyKey, unknown>,
          key: entry.key,
        });
      }
    }

    OBJECT_DEFINE_PROPERTY(target, key, {
      configurable: true,
      enumerable: true,
      value: normalized,
      writable: true,
    });
  }

  return root.value;
}

export function assertNormalizedJsonDocumentWithinMaxBytes(
  value: unknown,
  maxBytes: number,
): string {
  const text = JSON_STRINGIFY(value);
  if (TEXT_ENCODER.encode(text).byteLength > maxBytes) {
    throw new RuntimeError("source_limit_exceeded", "Source exceeds maxBytes");
  }
  return text;
}
