import {
  isPlainJsonArray,
  isPlainJsonObject,
  normalizeJsonValueGraph,
} from "../contract/json-value.js";
import { RuntimeError, isRuntimeErrorInstance } from "../contract/types.js";
import { readPointer, resolveParent } from "./json-pointer.js";

export type JsonPatchOperation =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: unknown };

const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_SPLICE = Array.prototype.splice;
const MAX_ARRAY_LENGTH = 0xffff_ffff;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_HAS_OWN = Object.prototype.hasOwnProperty;
const OBJECT_KEYS = Object.keys;
const REFLECT_APPLY = Reflect.apply;

function clone<T>(value: T): T {
  return normalizeJsonValueGraph(value) as T;
}

function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function patchInvalid(): RuntimeError {
  return new RuntimeError("patch_invalid", "Value is not an RFC 6902 operation");
}

function normalizePatchJsonValue(value: unknown): unknown {
  try {
    return normalizeJsonValueGraph(value);
  } catch {
    throw patchInvalid();
  }
}

function requiredDataMember(
  operation: object,
  name: "op" | "path" | "from" | "value",
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(operation, name);
  } catch {
    throw patchInvalid();
  }
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw patchInvalid();
  }
  return descriptor.value;
}

function normalizeOperation(value: unknown): JsonPatchOperation {
  let plain = false;
  try {
    plain = Boolean(
      value &&
      typeof value === "object" &&
      !ARRAY_IS_ARRAY(value) &&
      isPlainJsonObject(value as object),
    );
  } catch {
    throw patchInvalid();
  }
  if (!plain) {
    throw patchInvalid();
  }
  const operation = value as object;
  const op = requiredDataMember(operation, "op");
  const path = requiredDataMember(operation, "path");
  if (typeof op !== "string" || typeof path !== "string") throw patchInvalid();
  switch (op) {
    case "add":
    case "replace":
    case "test": {
      const operationValue = requiredDataMember(operation, "value");
      return { op, path, value: normalizePatchJsonValue(operationValue) };
    }
    case "copy":
    case "move": {
      const from = requiredDataMember(operation, "from");
      if (typeof from !== "string") throw patchInvalid();
      return { op, path, from };
    }
    case "remove":
      return { op, path };
    default:
      throw patchInvalid();
  }
}

function normalizeOperations(operations: readonly JsonPatchOperation[]): JsonPatchOperation[] {
  try {
    if (!ARRAY_IS_ARRAY(operations) || !isPlainJsonArray(operations)) throw patchInvalid();
  } catch {
    throw patchInvalid();
  }
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(operations, "length");
  } catch {
    throw patchInvalid();
  }
  if (!lengthDescriptor || !("value" in lengthDescriptor)) throw patchInvalid();
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) {
    throw patchInvalid();
  }
  const normalized: JsonPatchOperation[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(operations, String(index));
    } catch {
      throw patchInvalid();
    }
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw patchInvalid();
    }
    normalized.push(normalizeOperation(descriptor.value));
  }
  return normalized;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (ARRAY_IS_ARRAY(left) && ARRAY_IS_ARRAY(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !ARRAY_IS_ARRAY(left) &&
    !ARRAY_IS_ARRAY(right)
  ) {
    const leftKeys = OBJECT_KEYS(left);
    const rightKeys = OBJECT_KEYS(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (
        !REFLECT_APPLY(OBJECT_HAS_OWN, right, [key]) ||
        !deepEqual(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        )
      ) return false;
    }
    return true;
  }
  return false;
}

function parseIndex(key: string, length: number, allowAppend: boolean): number {
  if (allowAppend && key === "-") return length;
  if (!/^(0|[1-9]\d*)$/u.test(key)) {
    throw new RuntimeError("patch_invalid", "Array index is invalid");
  }
  const index = Number(key);
  if (index > length || (!allowAppend && index >= length)) {
    throw new RuntimeError("patch_invalid", "Array index is out of bounds");
  }
  return index;
}

function add(document: unknown, path: string, value: unknown): unknown {
  if (path === "") return clone(value);
  const { parent, key } = resolveParent(document, path);
  if (ARRAY_IS_ARRAY(parent)) {
    REFLECT_APPLY(ARRAY_SPLICE, parent, [
      parseIndex(key, parent.length, true),
      0,
      clone(value),
    ]);
  } else {
    defineOwn(parent, key, clone(value));
  }
  return document;
}

function remove(document: unknown, path: string): { document: unknown; value: unknown } {
  if (path === "") return { document: null, value: document };
  const { parent, key } = resolveParent(document, path);
  if (ARRAY_IS_ARRAY(parent)) {
    const index = parseIndex(key, parent.length, false);
    const removed = REFLECT_APPLY(ARRAY_SPLICE, parent, [index, 1]) as unknown[];
    return { document, value: removed[0] };
  }
  if (!REFLECT_APPLY(OBJECT_HAS_OWN, parent, [key])) {
    throw new RuntimeError("patch_invalid", "Remove target does not exist");
  }
  const value = parent[key];
  delete parent[key];
  return { document, value };
}

function replace(document: unknown, path: string, value: unknown): unknown {
  if (path === "") return clone(value);
  const { parent, key } = resolveParent(document, path);
  if (ARRAY_IS_ARRAY(parent)) {
    defineOwn(
      parent as unknown as Record<string, unknown>,
      String(parseIndex(key, parent.length, false)),
      clone(value),
    );
  } else {
    if (!REFLECT_APPLY(OBJECT_HAS_OWN, parent, [key])) {
      throw new RuntimeError("patch_invalid", "Replace target does not exist");
    }
    defineOwn(parent, key, clone(value));
  }
  return document;
}

export function applyJsonPatch(
  input: unknown,
  operations: readonly JsonPatchOperation[],
): unknown {
  try {
    const normalized = normalizeOperations(operations);
    let document = normalizePatchJsonValue(input);
    for (const operation of normalized) {
      switch (operation.op) {
        case "add":
          document = add(document, operation.path, operation.value);
          break;
        case "remove":
          document = remove(document, operation.path).document;
          break;
        case "replace":
          document = replace(document, operation.path, operation.value);
          break;
        case "copy": {
          const value = readPointer(document, operation.from);
          if (value === undefined) {
            throw new RuntimeError("patch_invalid", "Copy source does not exist");
          }
          document = add(document, operation.path, value);
          break;
        }
        case "move": {
          if (operation.path.startsWith(`${operation.from}/`)) {
            throw new RuntimeError("patch_invalid", "Move target cannot be a child of source");
          }
          const removed = remove(document, operation.from);
          document = add(removed.document, operation.path, removed.value);
          break;
        }
        case "test": {
          const actual = readPointer(document, operation.path);
          if (actual === undefined || !deepEqual(actual, operation.value)) {
            throw new RuntimeError("patch_test_failed", "JSON Patch test failed");
          }
          break;
        }
      }
    }
    return document;
  } catch (error) {
    if (
      isRuntimeErrorInstance(error) &&
      (error.code === "patch_invalid" || error.code === "patch_test_failed")
    ) {
      throw error;
    }
    throw patchInvalid();
  }
}

export function isJsonPatchOperation(value: unknown): value is JsonPatchOperation {
  try {
    normalizeOperation(value);
    return true;
  } catch {
    return false;
  }
}
