import type { StateModel, StateStore } from "@json-render/core";

import { ownJsonEqual } from "../contract/own-json-equal.js";

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function pointerSegments(path: string): string[] {
  const raw = path.startsWith("/") ? path.slice(1).split("/") : path.split("/");
  return raw.map(decodePointerSegment);
}

function defineOwn(
  target: object,
  key: string,
  value: unknown,
  enumerable = true,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable,
    value,
    writable: true,
  });
}

function arrayIndex(segment: string): number | null {
  const index = Number.parseInt(segment, 10);
  return Number.isNaN(index) ? null : index;
}

function arrayProperty(segment: string): number | "NaN" {
  return arrayIndex(segment) ?? "NaN";
}

function ownArrayProperty(array: unknown[], property: number | "NaN"): unknown {
  const key = String(property);
  return Object.prototype.hasOwnProperty.call(array, key)
    ? Reflect.get(array, key)
    : undefined;
}

const SAFE_ARRAY_INHERITED_PROPERTIES = new Set<PropertyKey>([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "at",
  "concat",
  "constructor",
  "copyWithin",
  "entries",
  "every",
  "fill",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "hasOwnProperty",
  "includes",
  "indexOf",
  "isPrototypeOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "pop",
  "propertyIsEnumerable",
  "push",
  "reduce",
  "reduceRight",
  "reverse",
  "shift",
  "slice",
  "some",
  "sort",
  "splice",
  "toLocaleString",
  "toReversed",
  "toSorted",
  "toSpliced",
  "toString",
  "unshift",
  "valueOf",
  "values",
  "with",
  Symbol.iterator,
  Symbol.unscopables,
]);

const SAFE_ARRAY_PROTOTYPE = new Proxy(
  Object.create(Array.prototype) as object,
  {
    get(target, property, receiver) {
      return SAFE_ARRAY_INHERITED_PROPERTIES.has(property)
        ? Reflect.get(target, property, receiver)
        : undefined;
    },
    has(target, property) {
      return SAFE_ARRAY_INHERITED_PROPERTIES.has(property) &&
        Reflect.has(target, property);
    },
  },
);

function prototypeSafeArray(length: number): unknown[] {
  const result = new Array<unknown>(length);
  Object.setPrototypeOf(result, SAFE_ARRAY_PROTOTYPE);
  return result;
}

function cloneRecord(source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source)) defineOwn(result, key, source[key]);
  return result;
}

function normalizeStateValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (Array.isArray(value)) {
    const result = prototypeSafeArray(value.length);
    seen.set(value, result);
    for (const key of Object.keys(value)) {
      defineOwn(
        result,
        key,
        normalizeStateValue(Reflect.get(value, key), seen),
      );
    }
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    defineOwn(
      result,
      key,
      normalizeStateValue((value as Record<string, unknown>)[key], seen),
    );
  }
  return result;
}

function getOwnByPath(root: StateModel, path: string): unknown {
  if (!path || path === "/") return root;
  let current: unknown = root;
  for (const segment of pointerSegments(path)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      current = ownArrayProperty(current, arrayProperty(segment));
    } else if (typeof current === "object") {
      current = Object.prototype.hasOwnProperty.call(current, segment)
        ? (current as Record<string, unknown>)[segment]
        : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

function immutableSetOwn(root: StateModel, path: string, value: unknown): StateModel {
  const segments = pointerSegments(path);
  if (segments.length === 0) return root;

  const result = cloneRecord(root);
  let current: Record<string, unknown> | unknown[] = result;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const child: unknown = Array.isArray(current)
      ? (() => {
          return ownArrayProperty(current, arrayProperty(segment));
        })()
      : Object.prototype.hasOwnProperty.call(current, segment)
        ? current[segment]
        : undefined;
    let next: Record<string, unknown> | unknown[];
    if (Array.isArray(child)) {
      next = normalizeStateValue(child) as unknown[];
    } else if (child !== null && typeof child === "object") {
      next = cloneRecord(child as Record<string, unknown>);
    } else {
      next = /^\d+$/u.test(segments[index + 1]!)
        ? prototypeSafeArray(0)
        : Object.create(null) as Record<string, unknown>;
    }
    const property = Array.isArray(current)
      ? String(arrayProperty(segment))
      : segment;
    defineOwn(current, property, next);
    current = next;
  }

  const finalSegment = segments[segments.length - 1]!;
  const normalizedValue = normalizeStateValue(value);
  if (Array.isArray(current)) {
    if (finalSegment === "-") {
      defineOwn(current, String(current.length), normalizedValue);
    } else {
      defineOwn(current, String(arrayProperty(finalSegment)), normalizedValue);
    }
  } else {
    defineOwn(current, finalSegment, normalizedValue);
  }
  return result;
}

export function createPrototypeSafeStateStore(initialState: StateModel = {}): StateStore {
  let state = normalizeStateValue(initialState) as StateModel;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    get(path) {
      return getOwnByPath(state, path);
    },
    set(path, value) {
      if (getOwnByPath(state, path) === value) return;
      state = immutableSetOwn(state, path, value);
      notify();
    },
    update(updates) {
      let next = state;
      let changed = false;
      for (const [path, value] of Object.entries(updates)) {
        if (getOwnByPath(next, path) === value) continue;
        next = immutableSetOwn(next, path, value);
        changed = true;
      }
      if (!changed) return;
      state = next;
      notify();
    },
    getSnapshot() {
      return state;
    },
    getServerSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function flattenInitialState(initialState: StateModel): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const seen = new Set<object>();
  const visit = (
    record: Record<string, unknown>,
    prefix: string,
    depth: number,
  ): void => {
    for (const key of Object.keys(record)) {
      const pointerKey = key.replace(/~/gu, "~0").replace(/\//gu, "~1");
      const pointer = `${prefix}/${pointerKey}`;
      const value = record[key];
      const isNonEmptyPlainObject = depth < 20 &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype &&
        !seen.has(value) &&
        Object.keys(value).length > 0;
      if (isNonEmptyPlainObject) {
        seen.add(value);
        visit(value as Record<string, unknown>, pointer, depth + 1);
      } else {
        defineOwn(result, pointer, value);
      }
    }
  };
  visit(initialState, "", 0);
  return result;
}

export function reconcileInitialState(
  store: StateStore,
  previous: StateModel,
  next: StateModel,
): void {
  const previousFlat = flattenInitialState(previous);
  const nextFlat = flattenInitialState(next);
  const paths = new Set([...Object.keys(previousFlat), ...Object.keys(nextFlat)]);
  const updates: Record<string, unknown> = {};
  for (const path of paths) {
    if (!ownJsonEqual(previousFlat[path], nextFlat[path])) {
      updates[path] = Object.prototype.hasOwnProperty.call(nextFlat, path)
        ? nextFlat[path]
        : undefined;
    }
  }
  if (Object.keys(updates).length > 0) store.update(updates);
}
