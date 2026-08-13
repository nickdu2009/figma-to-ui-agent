const NATIVE_MAP = Map;
const NATIVE_SET = Set;
const NATIVE_DATE = Date;
const NATIVE_ERROR = Error;
const NATIVE_PROXY = Proxy;
const NATIVE_WEAK_MAP = WeakMap;
const NATIVE_WEAK_SET = WeakSet;
const STRUCTURED_CLONE = structuredClone;
const ARRAY_IS_ARRAY = Array.isArray;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const REFLECT_APPLY = Reflect.apply;
const REFLECT_GET = Reflect.get;
const REFLECT_OWN_KEYS = Reflect.ownKeys;

const READONLY_COLLECTIONS = new NATIVE_WEAK_SET<object>();
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_SET_HAS = WeakSet.prototype.has;
const WEAK_SET_ADD = WeakSet.prototype.add;

const MAP_SIZE = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const MAP_GET = Map.prototype.get;
const MAP_HAS = Map.prototype.has;
const MAP_ENTRIES = Map.prototype.entries;
const MAP_KEYS = Map.prototype.keys;
const MAP_VALUES = Map.prototype.values;
const MAP_FOR_EACH = Map.prototype.forEach;
const MAP_SET = Map.prototype.set;

const SET_SIZE = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;
const SET_HAS = Set.prototype.has;
const SET_ENTRIES = Set.prototype.entries;
const SET_KEYS = Set.prototype.keys;
const SET_VALUES = Set.prototype.values;
const SET_FOR_EACH = Set.prototype.forEach;
const SET_ADD = Set.prototype.add;

const DATE_TO_JSON = Date.prototype.toJSON;
const DATE_TO_PRIMITIVE = Date.prototype[Symbol.toPrimitive];
const DATE_GET_TIME = Date.prototype.getTime;
const DATE_READ_METHODS = new NATIVE_MAP<PropertyKey, (...args: unknown[]) => unknown>();
for (const property of Reflect.ownKeys(Date.prototype)) {
  if (property === "constructor" || (
    typeof property === "string" && property.startsWith("set")
  ) || property === "toJSON" || property === Symbol.toPrimitive) continue;
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(Date.prototype, property);
  if (typeof descriptor?.value === "function") {
    DATE_READ_METHODS.set(property, descriptor.value as (...args: unknown[]) => unknown);
  }
}

function immutableMutation(): never {
  throw new TypeError("Cannot mutate an immutable runtime value");
}

function readonlyMap(
  source: Map<unknown, unknown>,
  seen: WeakMap<object, unknown>,
): Map<unknown, unknown> {
  const target = new NATIVE_MAP<unknown, unknown>();
  let proxy: Map<unknown, unknown>;
  proxy = new NATIVE_PROXY(target, {
    get(map, property, receiver) {
      if (property === "set" || property === "delete" || property === "clear") {
        return immutableMutation;
      }
      if (property === "size") return REFLECT_APPLY(MAP_SIZE, map, []);
      if (property === "get") {
        return (key: unknown) => REFLECT_APPLY(MAP_GET, map, [key]);
      }
      if (property === "has") {
        return (key: unknown) => REFLECT_APPLY(MAP_HAS, map, [key]);
      }
      if (property === "entries" || property === Symbol.iterator) {
        return () => REFLECT_APPLY(MAP_ENTRIES, map, []);
      }
      if (property === "keys") return () => REFLECT_APPLY(MAP_KEYS, map, []);
      if (property === "values") return () => REFLECT_APPLY(MAP_VALUES, map, []);
      if (property === "valueOf") return () => proxy;
      if (property === "forEach") {
        return (
          callback: (value: unknown, key: unknown, map: Map<unknown, unknown>) => void,
          thisArg?: unknown,
        ) => REFLECT_APPLY(MAP_FOR_EACH, map, [
          (value: unknown, key: unknown) => callback.call(thisArg, value, key, proxy),
        ]);
      }
      return REFLECT_GET(map, property, receiver);
    },
    set: immutableMutation,
    defineProperty: immutableMutation,
    deleteProperty: immutableMutation,
    setPrototypeOf: immutableMutation,
  });
  REFLECT_APPLY(WEAK_MAP_SET, seen, [source, proxy]);
  REFLECT_APPLY(WEAK_SET_ADD, READONLY_COLLECTIONS, [proxy]);
  for (const [key, value] of source) {
    REFLECT_APPLY(MAP_SET, target, [freezeValue(key, seen), freezeValue(value, seen)]);
  }
  OBJECT_FREEZE(target);
  return proxy;
}

function readonlySet(
  source: Set<unknown>,
  seen: WeakMap<object, unknown>,
): Set<unknown> {
  const target = new NATIVE_SET<unknown>();
  let proxy: Set<unknown>;
  proxy = new NATIVE_PROXY(target, {
    get(set, property, receiver) {
      if (property === "add" || property === "delete" || property === "clear") {
        return immutableMutation;
      }
      if (property === "size") return REFLECT_APPLY(SET_SIZE, set, []);
      if (property === "has") {
        return (value: unknown) => REFLECT_APPLY(SET_HAS, set, [value]);
      }
      if (property === "entries") return () => REFLECT_APPLY(SET_ENTRIES, set, []);
      if (property === "keys") return () => REFLECT_APPLY(SET_KEYS, set, []);
      if (property === "values" || property === Symbol.iterator) {
        return () => REFLECT_APPLY(SET_VALUES, set, []);
      }
      if (property === "valueOf") return () => proxy;
      if (property === "forEach") {
        return (
          callback: (value: unknown, key: unknown, set: Set<unknown>) => void,
          thisArg?: unknown,
        ) => REFLECT_APPLY(SET_FOR_EACH, set, [
          (value: unknown) => callback.call(thisArg, value, value, proxy),
        ]);
      }
      return REFLECT_GET(set, property, receiver);
    },
    set: immutableMutation,
    defineProperty: immutableMutation,
    deleteProperty: immutableMutation,
    setPrototypeOf: immutableMutation,
  });
  REFLECT_APPLY(WEAK_MAP_SET, seen, [source, proxy]);
  REFLECT_APPLY(WEAK_SET_ADD, READONLY_COLLECTIONS, [proxy]);
  for (const value of source) {
    REFLECT_APPLY(SET_ADD, target, [freezeValue(value, seen)]);
  }
  OBJECT_FREEZE(target);
  return proxy;
}

function readonlyDate(source: Date, seen: WeakMap<object, unknown>): Date {
  const target = new NATIVE_DATE(REFLECT_APPLY(DATE_GET_TIME, source, []));
  let proxy: Date;
  proxy = new NATIVE_PROXY(target, {
    get(date, property, receiver) {
      if (typeof property === "string" && property.startsWith("set")) {
        return immutableMutation;
      }
      const method = REFLECT_APPLY(MAP_GET, DATE_READ_METHODS, [property]) as
        | ((...args: unknown[]) => unknown)
        | undefined;
      if (method) {
        return (...args: unknown[]) => REFLECT_APPLY(method, date, args);
      }
      if (property === "toJSON") {
        return (...args: unknown[]) => REFLECT_APPLY(DATE_TO_JSON, proxy, args);
      }
      if (property === Symbol.toPrimitive) {
        return (...args: unknown[]) => REFLECT_APPLY(DATE_TO_PRIMITIVE, proxy, args);
      }
      return REFLECT_GET(date, property, receiver);
    },
    set: immutableMutation,
    defineProperty: immutableMutation,
    deleteProperty: immutableMutation,
    setPrototypeOf: immutableMutation,
  });
  REFLECT_APPLY(WEAK_MAP_SET, seen, [source, proxy]);
  REFLECT_APPLY(WEAK_SET_ADD, READONLY_COLLECTIONS, [proxy]);
  OBJECT_FREEZE(target);
  return proxy;
}

function freezeValue<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== "object") return value;
  if (REFLECT_APPLY(WEAK_SET_HAS, READONLY_COLLECTIONS, [value])) return value;
  const existing = REFLECT_APPLY(WEAK_MAP_GET, seen, [value]);
  if (existing !== undefined) return existing as T;
  if (value instanceof NATIVE_MAP) return readonlyMap(value, seen) as T;
  if (value instanceof NATIVE_SET) return readonlySet(value, seen) as T;
  if (value instanceof NATIVE_DATE) return readonlyDate(value, seen) as T;
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (
    !ARRAY_IS_ARRAY(value) &&
    prototype !== Object.prototype &&
    prototype !== null &&
    !(value instanceof NATIVE_ERROR)
  ) {
    throw new TypeError("Runtime values must use ownership-safe structured data");
  }

  REFLECT_APPLY(WEAK_MAP_SET, seen, [value, value]);
  for (const key of REFLECT_OWN_KEYS(value)) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const frozenChild = freezeValue(descriptor.value, seen);
    if (frozenChild !== descriptor.value) {
      OBJECT_DEFINE_PROPERTY(value, key, { ...descriptor, value: frozenChild });
    }
  }
  return OBJECT_FREEZE(value);
}

export function deepFreeze<T>(value: T): T {
  return freezeValue(value, new NATIVE_WEAK_MAP());
}

export function ownAndDeepFreeze<T>(value: T): T {
  try {
    return deepFreeze(STRUCTURED_CLONE(value));
  } catch (error) {
    throw new TypeError("Runtime values must use ownership-safe structured data", {
      cause: error,
    });
  }
}
