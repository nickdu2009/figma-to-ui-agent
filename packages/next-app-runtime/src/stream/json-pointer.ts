import { RuntimeError } from "../contract/types.js";

export function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new RuntimeError("patch_invalid", "JSON Pointer must start with '/'");
  }
  return pointer.slice(1).split("/").map((segment) => {
    if (/~(?![01])/u.test(segment)) {
      throw new RuntimeError("patch_invalid", "JSON Pointer has invalid escape");
    }
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}

export function readPointer(document: unknown, pointer: string): unknown {
  let current = document;
  for (const segment of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(segment)) return undefined;
      const index = Number(segment);
      if (
        !Number.isSafeInteger(index) ||
        index >= current.length ||
        !Object.prototype.hasOwnProperty.call(current, index)
      ) return undefined;
      current = current[index];
    } else if (current && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

export function resolveParent(
  document: unknown,
  pointer: string,
): { parent: Record<string, unknown> | unknown[]; key: string } {
  const segments = parsePointer(pointer);
  if (segments.length === 0) {
    throw new RuntimeError("patch_invalid", "Root pointer has no parent");
  }
  const key = segments.pop()!;
  let current = document;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(segment)) {
        throw new RuntimeError("patch_invalid", "Array index is invalid");
      }
      const index = Number(segment);
      if (index >= current.length) {
        throw new RuntimeError("patch_invalid", "JSON Pointer parent does not exist");
      }
      current = current[index];
    } else if (current && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        throw new RuntimeError("patch_invalid", "JSON Pointer parent does not exist");
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      throw new RuntimeError("patch_invalid", "JSON Pointer parent is not a container");
    }
  }
  if (!current || typeof current !== "object") {
    throw new RuntimeError("patch_invalid", "JSON Pointer parent is not a container");
  }
  return { parent: current as Record<string, unknown> | unknown[], key };
}
