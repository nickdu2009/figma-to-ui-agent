import { describe, expect, it } from "vitest";
import { resolveDynamicValue } from "@json-render/core";

import {
  createPrototypeSafeStateStore,
  reconcileInitialState,
} from "../../src/react/prototype-safe-state-store.js";

describe("runtime StateStore write boundary", () => {
  it.each([
    "/__proto__/isAdmin",
    "/constructor/prototype/isAdmin",
    "/safe/__proto__/isAdmin",
    "prototype/isAdmin",
  ])("writes %s as own data without mutating prototypes", (path) => {
    const store = createPrototypeSafeStateStore({ safe: {} });

    store.set(path, true);

    expect(store.get(path)).toBe(true);
    expect(Object.getPrototypeOf(store.getSnapshot())).toBe(null);
    expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });

  it("applies update paths as own data without prototype injection", () => {
    const store = createPrototypeSafeStateStore({ count: 0 });
    const updates = JSON.parse(`{
      "/count": 1,
      "/__proto__/isAdmin": true
    }`) as Record<string, unknown>;

    store.update(updates);

    expect(store.get("/count")).toBe(1);
    expect(store.get("/__proto__/isAdmin")).toBe(true);
    expect(Object.hasOwn(store.getSnapshot(), "__proto__")).toBe(true);
    expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });

  it("preserves ordinary StateStore writes and own __proto__ initial state", () => {
    const initialState = JSON.parse(`{
      "__proto__": { "label": "literal" },
      "count": 0
    }`) as Record<string, unknown>;
    const store = createPrototypeSafeStateStore(initialState);

    store.set("/count", 1);
    store.update({ "/label": "ready" });

    const snapshot = store.getSnapshot();
    expect(snapshot.count).toBe(1);
    expect(snapshot.label).toBe("ready");
    expect(Object.hasOwn(snapshot, "__proto__")).toBe(true);
    expect(snapshot["__proto__"]).toEqual({ label: "literal" });
  });

  it("uses recursive own-data snapshots for initial and inserted state", () => {
    const inheritedKey = "nextAppRuntimeInheritedState";
    Object.defineProperty(Object.prototype, inheritedKey, {
      configurable: true,
      enumerable: false,
      value: "prototype value",
    });
    try {
      const store = createPrototypeSafeStateStore({ initial: { nested: {} } });
      store.set("/inserted", { nested: {} });
      store.update({ "/updated": { nested: {} } });

      const snapshot = store.getSnapshot();
      expect(Object.getPrototypeOf(snapshot)).toBe(null);
      for (const key of ["initial", "inserted", "updated"]) {
        const entry = snapshot[key] as Record<string, unknown>;
        expect(Object.getPrototypeOf(entry)).toBe(null);
        expect(Object.getPrototypeOf(entry.nested)).toBe(null);
        expect(resolveDynamicValue(
          { $state: `/${key}/nested/${inheritedKey}` },
          snapshot,
        )).toBeUndefined();
      }
    } finally {
      delete (Object.prototype as Record<string, unknown>)[inheritedKey];
    }
  });

  it("hides inherited array indices while preserving array behavior", () => {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      enumerable: false,
      value: "prototype value",
      writable: true,
    });
    Object.defineProperty(Array.prototype, "NaN", {
      configurable: true,
      enumerable: false,
      value: "prototype NaN value",
      writable: true,
    });
    Object.defineProperty(Array.prototype, "1e+21", {
      configurable: true,
      enumerable: false,
      value: "prototype exponential index value",
      writable: true,
    });
    try {
      const store = createPrototypeSafeStateStore({ initial: [] });
      store.set("/inserted", []);
      store.update({ "/updated": [] });

      for (const key of ["initial", "inserted", "updated"]) {
        const array = store.get(`/${key}`) as unknown[];
        expect(Array.isArray(array)).toBe(true);
        expect(array.length).toBe(0);
        expect(Object.keys(array)).toEqual([]);
        expect(array).toBeInstanceOf(Array);
        expect(array.map((value) => value)).toEqual([]);
        expect(array.filter((value) => value)).toEqual([]);
        expect(array.slice()).toEqual([]);
        expect([...array]).toEqual([]);
        expect(structuredClone(array)).toEqual([]);
        expect(resolveDynamicValue({ $state: `/${key}/0` }, store.getSnapshot()))
          .toBeUndefined();
        expect(resolveDynamicValue(
          { $state: `/${key}/not-an-index` },
          store.getSnapshot(),
        )).toBeUndefined();
        expect(resolveDynamicValue(
          { $state: `/${key}/1000000000000000000000` },
          store.getSnapshot(),
        )).toBeUndefined();
      }
    } finally {
      delete Array.prototype[0];
      delete (Array.prototype as unknown as Record<string, unknown>).NaN;
      delete (Array.prototype as unknown as Record<string, unknown>)["1e+21"];
    }
  });

  it.each([
    ["0", "0"],
    ["01", "1"],
    ["1x", "1"],
    ["1e2", "1"],
    ["-1", "-1"],
    ["", "NaN"],
    ["not-a-number", "NaN"],
    ["-", "NaN"],
    ["1000000000000000000000", "1e+21"],
    ["3", "3"],
  ] as const)(
    "canonicalizes an intermediate array segment %s to the own key %s for both read and write",
    (segment, canonical) => {
      const store = createPrototypeSafeStateStore({
        items: [{ value: "zero" }, { value: "one" }],
      });
      const path = `/items/${segment}/value`;

      store.set(path, `updated:${segment}`);

      expect(store.get(path)).toBe(`updated:${segment}`);
      const items = store.get("/items") as unknown[];
      const canonicalEntry = Reflect.get(items, canonical) as { value?: unknown } | undefined;
      expect(canonicalEntry?.value).toBe(`updated:${segment}`);
      expect(Object.hasOwn(items, canonical)).toBe(true);
      if (segment !== canonical) expect(Object.hasOwn(items, segment)).toBe(false);
      expect(items.length).toBe(canonical === "3" ? 4 : 2);
    },
  );

  it.each([
    ["0", "0", 2],
    ["01", "1", 2],
    ["1x", "1", 2],
    ["1e2", "1", 2],
    ["-1", "-1", 2],
    ["", "NaN", 2],
    ["not-a-number", "NaN", 2],
    ["1000000000000000000000", "1e+21", 2],
    ["3", "3", 4],
  ] as const)(
    "canonicalizes a final array segment %s to %s with length %i",
    (segment, canonical, expectedLength) => {
      const store = createPrototypeSafeStateStore({ items: ["zero", "one"] });
      const path = `/items/${segment}`;

      store.set(path, `updated:${segment}`);

      expect(store.get(path)).toBe(`updated:${segment}`);
      const items = store.get("/items") as unknown[];
      expect(Reflect.get(items, canonical)).toBe(`updated:${segment}`);
      expect(Object.hasOwn(items, canonical)).toBe(true);
      if (segment !== canonical) expect(Object.hasOwn(items, segment)).toBe(false);
      expect(items.length).toBe(expectedLength);
    },
  );

  it("writes non-index canonical array keys as own data without touching prototypes", () => {
    const keys = ["NaN", "-1", "1e+21"] as const;
    for (const key of keys) {
      Object.defineProperty(Array.prototype, key, {
        configurable: true,
        value: `prototype:${key}`,
        writable: true,
      });
    }
    try {
      const store = createPrototypeSafeStateStore({ items: [] });
      store.set("/items/not-a-number/value", "nan own value");
      store.set("/items/-1/value", "negative own value");
      store.set("/items/1000000000000000000000/value", "huge own value");

      expect(store.get("/items/not-a-number/value")).toBe("nan own value");
      expect(store.get("/items/-1/value")).toBe("negative own value");
      expect(store.get("/items/1000000000000000000000/value")).toBe("huge own value");
      const items = store.get("/items") as unknown[];
      for (const key of keys) {
        expect(Object.hasOwn(items, key)).toBe(true);
        expect(Reflect.get(Array.prototype, key)).toBe(`prototype:${key}`);
      }
      expect(items.length).toBe(0);
    } finally {
      for (const key of keys) delete (Array.prototype as unknown as Record<string, unknown>)[key];
    }
  });

  it("treats only a final dash as append and exposes the appended numeric index", () => {
    const store = createPrototypeSafeStateStore({ items: ["zero", "one"] });
    const oldLength = (store.get("/items") as unknown[]).length;

    store.set("/items/-", "appended");

    expect((store.get("/items") as unknown[]).length).toBe(oldLength + 1);
    expect(store.get(`/items/${oldLength}`)).toBe("appended");
  });

  it("syncs changed initial-state paths without resetting user state", () => {
    const previousInitial = { server: { value: "A", stable: true } };
    const nextInitial = { server: { value: "B", stable: true } };
    const store = createPrototypeSafeStateStore(previousInitial);
    store.set("/draft", "user input");
    store.set("/server/stable", "user override");

    reconcileInitialState(store, previousInitial, nextInitial);

    expect(store.get("/server/value")).toBe("B");
    expect(store.get("/server/stable")).toBe("user override");
    expect(store.get("/draft")).toBe("user input");
  });

  it("escapes literal JSON Pointer characters while reconciling initial state", () => {
    const previousInitial = {
      "a/b": 1,
      "~0": "old zero",
      "~1": "old one",
    };
    const nextInitial = {
      "a/b": 2,
      "~0": "new zero",
      "~1": "new one",
    };
    const store = createPrototypeSafeStateStore(previousInitial);

    reconcileInitialState(store, previousInitial, nextInitial);

    expect(store.get("/a~1b")).toBe(2);
    expect(store.get("/~00")).toBe("new zero");
    expect(store.get("/~01")).toBe("new one");
    expect(store.get("/a/b")).toBeUndefined();
  });

  it("adds and removes empty-object initial-state leaves", () => {
    const store = createPrototypeSafeStateStore({});

    reconcileInitialState(store, {}, { empty: {} });
    expect(store.get("/empty")).toEqual({});

    reconcileInitialState(store, { empty: {} }, {});
    expect(store.get("/empty")).toBeUndefined();
  });

  it("does not reset user array edits for structurally equal initial state", () => {
    const previousInitial = { items: [{ value: 1 }, { value: 2 }] };
    const nextInitial = structuredClone(previousInitial);
    const store = createPrototypeSafeStateStore(previousInitial);
    store.set("/items/0/value", 9);

    reconcileInitialState(store, previousInitial, nextInitial);

    expect(store.get("/items/0/value")).toBe(9);
    expect(store.get("/items/1/value")).toBe(2);
  });

  it("syncs genuine array changes and distinguishes holes from own undefined", () => {
    const previousItems = new Array<unknown>(1);
    const nextItems = [undefined];
    const store = createPrototypeSafeStateStore({ items: previousItems });
    store.set("/items/0", "user value");

    reconcileInitialState(
      store,
      { items: previousItems },
      { items: nextItems },
    );

    const items = store.get("/items") as unknown[];
    expect(Object.hasOwn(items, 0)).toBe(true);
    expect(items[0]).toBeUndefined();

    store.set("/items/0", "second user value");
    reconcileInitialState(
      store,
      { items: nextItems },
      { items: [{ value: 2 }] },
    );
    expect(store.get("/items/0/value")).toBe(2);
  });

  it("compares own __proto__ data inside array leaves", () => {
    const previousItem = JSON.parse(`{"__proto__":{"value":1}}`) as Record<string, unknown>;
    const nextItem = JSON.parse(`{"__proto__":{"value":1}}`) as Record<string, unknown>;
    const store = createPrototypeSafeStateStore({ items: [previousItem] });
    store.set("/items/0/user", true);

    reconcileInitialState(
      store,
      { items: [previousItem] },
      { items: [nextItem] },
    );

    expect(store.get("/items/0/user")).toBe(true);
    expect(store.get("/items/0/__proto__/value")).toBe(1);
  });

  it("compares a plain object's own length field inside array leaves", () => {
    const previousInitial = { items: [{ length: 1 }] };
    const nextInitial = { items: [{ length: 2 }] };
    const store = createPrototypeSafeStateStore(previousInitial);
    store.set("/items/0/length", 9);

    reconcileInitialState(store, previousInitial, nextInitial);

    expect(store.get("/items/0/length")).toBe(2);
  });
});
