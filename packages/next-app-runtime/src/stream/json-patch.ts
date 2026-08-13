import { assertJsonValueGraph } from "../contract/json-value.js";
import { RuntimeError, isRuntimeErrorInstance } from "../contract/types.js";
import { readPointer, resolveParent } from "./json-pointer.js";

export type JsonPatchOperation =
  | { op: "add"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: unknown }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: unknown };

function clone<T>(value: T): T {
  return structuredClone(value);
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

function assertPatchJsonValue(value: unknown): void {
  try {
    assertJsonValueGraph(value);
  } catch {
    throw patchInvalid();
  }
}

function requiredDataMember(
  operation: object,
  name: "op" | "path" | "from" | "value",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(operation, name);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw patchInvalid();
  }
  return descriptor.value;
}

function normalizeOperation(value: unknown): JsonPatchOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw patchInvalid();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw patchInvalid();
  const op = requiredDataMember(value, "op");
  const path = requiredDataMember(value, "path");
  if (typeof op !== "string" || typeof path !== "string") throw patchInvalid();
  switch (op) {
    case "add":
    case "replace":
    case "test": {
      const operationValue = requiredDataMember(value, "value");
      assertPatchJsonValue(operationValue);
      return { op, path, value: operationValue };
    }
    case "copy":
    case "move": {
      const from = requiredDataMember(value, "from");
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
  if (!Array.isArray(operations)) throw patchInvalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(operations, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) throw patchInvalid();
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) throw patchInvalid();
  const normalized: JsonPatchOperation[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(operations, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw patchInvalid();
    }
    normalized.push(normalizeOperation(descriptor.value));
  }
  return normalized;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    );
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
  if (Array.isArray(parent)) {
    parent.splice(parseIndex(key, parent.length, true), 0, clone(value));
  } else {
    defineOwn(parent, key, clone(value));
  }
  return document;
}

function remove(document: unknown, path: string): { document: unknown; value: unknown } {
  if (path === "") return { document: null, value: document };
  const { parent, key } = resolveParent(document, path);
  if (Array.isArray(parent)) {
    const index = parseIndex(key, parent.length, false);
    return { document, value: parent.splice(index, 1)[0] };
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new RuntimeError("patch_invalid", "Remove target does not exist");
  }
  const value = parent[key];
  delete parent[key];
  return { document, value };
}

function replace(document: unknown, path: string, value: unknown): unknown {
  if (path === "") return clone(value);
  const { parent, key } = resolveParent(document, path);
  if (Array.isArray(parent)) {
    parent[parseIndex(key, parent.length, false)] = clone(value);
  } else {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) {
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
    assertPatchJsonValue(input);
    const normalized = normalizeOperations(operations);
    let document = clone(input);
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
