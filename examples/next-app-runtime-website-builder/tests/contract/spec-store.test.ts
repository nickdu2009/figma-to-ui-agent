import { describe, expect, it, vi } from "vitest";
import {
  createMemoryNavigation,
  createRuntimeWithNavigation,
} from "@next-app-runtime/client/testing";

import { catalog } from "../../lib/catalog";
import { defaultSpec } from "../../lib/default-spec";
import { registry } from "../../lib/registry";
import {
  readSpec,
  SPEC_STORAGE_EVENT,
  SPEC_STORAGE_KEY,
  subscribeSpec,
  validatePreviewSpecCandidate,
  validateSpecCandidate,
  WEBSITE_RUNTIME_LIMITS,
  writeSpec,
} from "../../lib/spec-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("localStorage spec store", () => {
  it("uses an owned default clone when the key is missing", () => {
    const storage = new MemoryStorage();
    const first = readSpec(storage);
    const second = readSpec(storage);
    expect(first).toMatchObject({ ok: true, source: "default", spec: defaultSpec });
    expect(first.ok && second.ok && first.spec).not.toBe(second.ok && second.spec);
  });

  it("round-trips JSON and emits only the dedicated same-tab event", () => {
    const storage = new MemoryStorage();
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(SPEC_STORAGE_EVENT, listener);
    expect(writeSpec(defaultSpec, storage, target)).toEqual({ ok: true });
    expect(storage.getItem(SPEC_STORAGE_KEY)).toBe(JSON.stringify(defaultSpec));
    expect(readSpec(storage)).toEqual({ ok: true, source: "storage", spec: defaultSpec });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports invalid stored JSON without overwriting it", () => {
    const storage = new MemoryStorage();
    storage.setItem(SPEC_STORAGE_KEY, "{invalid");
    expect(readSpec(storage)).toEqual({ ok: false, code: "stored_spec_parse_failed" });
    expect(storage.getItem(SPEC_STORAGE_KEY)).toBe("{invalid");
  });

  it("contracts storage read failures instead of throwing", () => {
    const storage = new MemoryStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(readSpec(storage)).toEqual({ ok: false, code: "stored_spec_read_failed" });
  });

  it("contracts a denied default localStorage getter before any storage method runs", () => {
    const deniedWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    Object.defineProperty(deniedWindow, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    vi.stubGlobal("window", deniedWindow);
    try {
      expect(readSpec()).toEqual({ ok: false, code: "stored_spec_read_failed" });
      expect(writeSpec(defaultSpec)).toEqual({
        ok: false,
        code: "stored_spec_serialize_failed",
      });
      const unsubscribe = subscribeSpec(vi.fn());
      expect(unsubscribe).toBeTypeOf("function");
      expect(() => unsubscribe()).not.toThrow();
      expect(deniedWindow.addEventListener).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns a contract-invalid JSON candidate without repairing or overwriting it", () => {
    const storage = new MemoryStorage();
    const candidate = { routes: null };
    storage.setItem(SPEC_STORAGE_KEY, JSON.stringify(candidate));

    expect(readSpec(storage)).toEqual({
      ok: false,
      code: "stored_spec_contract_invalid",
      candidate,
    });
    expect(storage.getItem(SPEC_STORAGE_KEY)).toBe(JSON.stringify(candidate));
  });

  it("persists editable contract-invalid JSON candidates", () => {
    const storage = new MemoryStorage();
    const candidate = { routes: null };

    expect(validateSpecCandidate(candidate)).toEqual({
      ok: false,
      code: "stored_spec_contract_invalid",
      candidate,
    });
    expect(writeSpec(candidate, storage, new EventTarget())).toEqual({ ok: true });
    expect(storage.getItem(SPEC_STORAGE_KEY)).toBe(JSON.stringify(candidate));
  });

  it("rejects excessive depth before recursive Catalog validation", () => {
    const candidate: Record<string, unknown> = {};
    let cursor = candidate;
    for (let depth = 0; depth < 5_000; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }

    expect(validateSpecCandidate(candidate)).toEqual({
      ok: false,
      code: "source_limit_exceeded",
      candidate,
    });
  });

  it("rejects runtime-invalid candidates without promoting them to preview", async () => {
    const candidate = structuredClone(defaultSpec);
    candidate.routes["/"]!.page.root = "missing";
    const runtime = createRuntimeWithNavigation({
      catalog,
      registry,
      limits: WEBSITE_RUNTIME_LIMITS,
      fallbacks: {
        loading: () => null,
        error: () => null,
        notFound: () => null,
        unmatched: () => null,
      },
    }, createMemoryNavigation("/"));
    try {
      expect(await validatePreviewSpecCandidate(runtime, candidate)).toEqual({
        ok: false,
        code: "references_invalid",
        candidate,
      });
    } finally {
      runtime.dispose();
    }
  });

  it("contracts Catalog validation exceptions during preview validation", async () => {
    const runtime = createRuntimeWithNavigation({
      catalog,
      registry,
      limits: WEBSITE_RUNTIME_LIMITS,
      fallbacks: {
        loading: () => null,
        error: () => null,
        notFound: () => null,
        unmatched: () => null,
      },
    }, createMemoryNavigation("/"));
    const validate = vi.spyOn(catalog, "validate").mockImplementationOnce(() => {
      throw new Error("host Catalog validation failed");
    });
    try {
      expect(await validatePreviewSpecCandidate(runtime, defaultSpec)).toEqual({
        ok: false,
        code: "stored_spec_contract_invalid",
        candidate: defaultSpec,
      });
    } finally {
      validate.mockRestore();
      runtime.dispose();
    }
  });
});
