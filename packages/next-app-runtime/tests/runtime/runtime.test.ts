import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { schema } from "../../src/contract/schema.js";
import {
  RouteNotFound,
  RuntimeError,
  type NextAppSpec,
  type RuntimeEvent,
} from "../../src/contract/types.js";
import {
  createNextAppRuntime,
  createRuntimeWithNavigation,
  getRuntimeInternals,
} from "../../src/runtime/create-runtime.js";
import { createMemoryNavigation } from "../../src/testing/memory-navigation.js";
import {
  createTestSpec,
  testCatalog,
  testFallbacks,
  testLimits,
  testRegistry,
} from "../../src/testing/fixtures.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function runtimeOptions(overrides: Record<string, unknown> = {}) {
  return {
    catalog: testCatalog,
    registry: testRegistry,
    limits: testLimits,
    fallbacks: testFallbacks,
    ...overrides,
  };
}

function withLoader(name: string, text = "Home"): NextAppSpec {
  return createTestSpec({
    routes: {
      "/": {
        loader: name,
        page: {
          root: "root",
          state: { source: "page" },
          elements: { root: { type: "Text", props: { text } } },
        },
      },
    },
    state: { source: "global", global: true },
  });
}

describe("route runtime", () => {
  it("does not expose host catalog or registry identifiers in mismatch errors", () => {
    const declared = "https://catalog-user:catalog-password@private.example/?token=catalog-secret";
    const implemented = "https://registry-user:registry-password@private.example/?token=registry-secret";
    const catalog = schema.createCatalog({
      components: {
        [declared]: { props: z.object({}).strict() },
      },
      actions: {},
    });

    let thrown: unknown;
    try {
      createRuntimeWithNavigation(
        runtimeOptions({
          catalog,
          registry: { [implemented]: () => null },
        }),
        createMemoryNavigation(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "catalog_registry_mismatch",
      message: "Catalog components and registry implementations do not match",
    });
    const serialized = JSON.stringify(thrown);
    expect(serialized).not.toContain(declared);
    expect(serialized).not.toContain(implemented);
  });

  it("does not expose host action or handler identifiers in mismatch errors", () => {
    const declared = "https://action-user:action-password@private.example/?token=action-secret";
    const implemented = "https://handler-user:handler-password@private.example/?token=handler-secret";
    const catalog = schema.createCatalog({
      components: {},
      actions: {
        [declared]: { params: z.object({}).strict() },
      },
    });

    let thrown: unknown;
    try {
      createRuntimeWithNavigation(
        runtimeOptions({
          catalog,
          registry: {},
          handlers: { [implemented]: () => undefined },
        }),
        createMemoryNavigation(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "catalog_registry_mismatch",
      message: "Catalog actions and handler implementations do not match",
    });
    const serialized = JSON.stringify(thrown);
    expect(serialized).not.toContain(declared);
    expect(serialized).not.toContain(implemented);
  });

  it.each(["missing", "failed"] as const)(
    "uses opaque observer and error identifiers for a %s sensitive loader",
    async (outcome) => {
      const pattern = "/route-user:route-password@private.example/route-secret";
      const loaderName = "https://loader-user:loader-password@private.example/?token=loader-secret";
      const events: RuntimeEvent[] = [];
      const runtime = createRuntimeWithNavigation(
        runtimeOptions({
          loaders: outcome === "failed"
            ? { [loaderName]: () => { throw new Error("failed"); } }
            : undefined,
          observer: (event: RuntimeEvent) => events.push(event),
        }),
        createMemoryNavigation(pattern),
      );
      const spec = createTestSpec({
        routes: {
          [pattern]: {
            loader: loaderName,
            page: {
              root: "root",
              elements: { root: { type: "Text", props: { text: "Sensitive" } } },
            },
          },
        },
      });

      await runtime.applySource({ kind: "object", value: spec });
      await tick();

      const serialized = JSON.stringify({
        error: runtime.getSnapshot().error,
        events,
      });
      expect(serialized).not.toContain(pattern);
      expect(serialized).not.toContain(loaderName);
      for (const event of events) {
        if (event.pattern !== undefined) expect(event.pattern).toMatch(/^route-\d+$/u);
        if (event.loader !== undefined) expect(event.loader).toMatch(/^loader-\d+$/u);
      }
      expect(runtime.getSnapshot().error?.details?.loader).toMatch(/^loader-\d+$/u);
      runtime.dispose();
    },
  );

  it("scopes opaque route and loader identifiers to one loader run", async () => {
    const events: RuntimeEvent[] = [];
    const loader = vi.fn().mockRejectedValue(new Error("failed"));
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { sensitive: loader },
        observer: (event: RuntimeEvent) => events.push(event),
      }),
      createMemoryNavigation(),
    );
    const spec = createTestSpec({
      routes: {
        "/": {
          loader: "sensitive",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Sensitive" } } },
          },
        },
      },
    });

    await runtime.applySource({ kind: "object", value: spec });
    await tick();
    const firstMatched = events.find((event) => event.name === "route_matched");
    const firstStarted = events.find((event) => event.name === "loader_started");
    const firstFailed = events.find((event) => event.name === "loader_failed");
    expect(firstMatched?.pattern).toBe(firstStarted?.pattern);
    expect(firstFailed).toMatchObject({
      loader: firstStarted?.loader,
      pattern: firstStarted?.pattern,
    });

    events.length = 0;
    runtime.retryLoader();
    await tick();
    const secondMatched = events.find((event) => event.name === "route_matched");
    const secondStarted = events.find((event) => event.name === "loader_started");
    const secondFailed = events.find((event) => event.name === "loader_failed");
    expect(secondMatched?.pattern).toBe(secondStarted?.pattern);
    expect(secondFailed).toMatchObject({
      loader: secondStarted?.loader,
      pattern: secondStarted?.pattern,
    });
    expect(secondStarted?.loader).not.toBe(firstStarted?.loader);
    expect(secondStarted?.pattern).not.toBe(firstStarted?.pattern);
    runtime.dispose();
  });

  it("matches decoded browser pathnames without changing the public location", async () => {
    const userLoader = vi.fn((params: Record<string, string | string[]>) => ({ params }));
    const navigation = createMemoryNavigation("/caf%C3%A9");
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { user: userLoader } }),
      navigation,
    );
    const page = (text: string) => ({
      root: "root",
      elements: { root: { type: "Text", props: { text } } },
    });
    const spec = createTestSpec({
      routes: {
        "/café": { page: page("Cafe") },
        "/user/[name]": { loader: "user", page: page("User") },
        "/docs/[...parts]": { page: page("Docs") },
        "/item/[id]": { page: page("Item") },
        "/%": { page: page("Malformed") },
      },
    });

    await runtime.applySource({ kind: "object", value: spec });
    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/caf%C3%A9" },
      routeStatus: "ready",
      matched: { pattern: "/café" },
    });

    navigation.push("/user/Alice%20Smith");
    await tick();
    expect(userLoader).toHaveBeenCalledWith({ name: "Alice Smith" });
    expect(runtime.getSnapshot().pageData?.initialState?.params).toEqual({
      name: "Alice Smith",
    });

    navigation.push("/docs/a%20b/c%2Fd");
    expect(runtime.getSnapshot()).toMatchObject({
      routeStatus: "ready",
      matched: { params: { parts: ["a b", "c", "d"] } },
    });

    navigation.push("/item/a%2Fb");
    expect(runtime.getSnapshot().routeStatus).toBe("unmatched");

    navigation.push("/%");
    expect(runtime.getSnapshot()).toMatchObject({
      routeStatus: "ready",
      matched: { pattern: "/%" },
    });
    runtime.dispose();
  });

  it("emits route_unmatched for an encoded unmatched browser pathname", async () => {
    const events: RuntimeEvent[] = [];
    const navigation = createMemoryNavigation("/");
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ observer: (event: RuntimeEvent) => events.push(event) }),
      navigation,
    );
    await runtime.applySource({ kind: "object", value: createTestSpec() });
    events.length = 0;

    navigation.push("/missing%20route");

    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/missing%20route" },
      routeStatus: "unmatched",
    });
    expect(events.map((event) => event.name)).toEqual([
      "location_changed",
      "route_unmatched",
    ]);
    runtime.dispose();
  });

  it("does not rerun a loader for query/hash or page-only source changes", async () => {
    const loader = vi.fn(() => ({ source: "loader", loaded: true }));
    const navigation = createMemoryNavigation("/");
    const runtime = createRuntimeWithNavigation(runtimeOptions({ loaders: { home: loader } }), navigation);

    expect((await runtime.applySource({ kind: "object", value: withLoader("home") })).status)
      .toBe("committed");
    await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().pageData?.initialState).toEqual({
      source: "loader",
      global: true,
      loaded: true,
    });

    navigation.push("/?tab=one#section");
    await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    const stableState = runtime.getSnapshot().pageData?.initialState;
    navigation.replace("/?tab=two#other");
    await tick();
    expect(runtime.getSnapshot().pageData?.initialState).toBe(stableState);

    await runtime.applySource({ kind: "object", value: withLoader("home", "Updated") });
    await tick();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().pageData?.spec.elements.root?.props).toEqual({ text: "Updated" });
    expect(runtime.getSnapshot().pageData?.initialState).toBe(stableState);
    runtime.dispose();
  });

  it("merges own __proto__ state as data without changing the merged prototype", async () => {
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const spec = JSON.parse(`{
      "routes": {
        "/": {
          "page": {
            "root": "root",
            "elements": {
              "root": { "type": "Text", "props": { "text": "Home" } }
            }
          }
        }
      },
      "state": {
        "__proto__": { "role": "literal" },
        "regular": true
      }
    }`) as NextAppSpec;

    const result = await runtime.applySource({ kind: "object", value: spec });

    expect(result.status).toBe("committed");
    const initialState = runtime.getSnapshot().pageData?.initialState;
    expect(initialState?.regular).toBe(true);
    expect(Object.hasOwn(initialState ?? {}, "__proto__")).toBe(true);
    expect(initialState?.["__proto__"]).toEqual({ role: "literal" });
    expect(Object.getPrototypeOf(initialState)).toBe(Object.prototype);

    const updatedSpec = JSON.parse(JSON.stringify(spec)) as NextAppSpec;
    updatedSpec.routes["/"]!.page.elements.root!.props.text = "Updated";
    await runtime.applySource({ kind: "object", value: updatedSpec });
    expect(runtime.getSnapshot().pageData?.initialState).toBe(initialState);
    expect(Object.hasOwn(runtime.getSnapshot().pageData?.initialState ?? {}, "__proto__"))
      .toBe(true);
    runtime.dispose();
  });

  it("reuses initialState when changed sources still produce the same merged state", async () => {
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const makeSpec = (shadowed: string, text: string) => createTestSpec({
      state: { shadowed },
      routes: {
        "/": {
          page: {
            root: "root",
            state: { shadowed: "page" },
            elements: { root: { type: "Text", props: { text } } },
          },
        },
      },
    });
    await runtime.applySource({ kind: "object", value: makeSpec("app-a", "A") });
    const stableState = runtime.getSnapshot().pageData?.initialState;

    await runtime.applySource({ kind: "object", value: makeSpec("app-b", "B") });

    expect(runtime.getSnapshot().pageData?.initialState).toBe(stableState);
    expect(runtime.getSnapshot().pageData?.initialState?.shadowed).toBe("page");
    runtime.dispose();
  });

  it("snapshots loader maps at construction", async () => {
    const initialLoader = vi.fn(() => ({ value: "initial" }));
    const replacementLoader = vi.fn(() => ({ value: "replacement" }));
    const loaders = { home: initialLoader };
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders }),
      createMemoryNavigation(),
    );
    loaders.home = replacementLoader;

    await runtime.applySource({ kind: "object", value: withLoader("home") });
    await tick();
    expect(initialLoader).toHaveBeenCalledOnce();
    expect(replacementLoader).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().pageData?.initialState?.value).toBe("initial");
    runtime.dispose();
  });

  it("snapshots the registry at construction", () => {
    const originalText = testRegistry.Text;
    const registry = { ...testRegistry };
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ registry }),
      createMemoryNavigation(),
    );
    registry.Text = () => null;

    expect(registry.Text).not.toBe(originalText);
    expect(getRuntimeInternals(runtime).options.registry.Text).toBe(originalText);
    runtime.dispose();
  });

  it("reruns when the loader name changes", async () => {
    const first = vi.fn(() => ({ value: 1 }));
    const second = vi.fn(() => ({ value: 2 }));
    const runtime = createRuntimeWithNavigation(runtimeOptions({ loaders: { first, second } }), createMemoryNavigation());
    await runtime.applySource({ kind: "object", value: withLoader("first") });
    await tick();
    await runtime.applySource({ kind: "object", value: withLoader("second") });
    await tick();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().pageData?.initialState?.value).toBe(2);
    runtime.dispose();
  });

  it("discards a late loader result after navigating to another route", async () => {
    let resolveSlow!: (value: Record<string, unknown>) => void;
    const slow = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { resolveSlow = resolve; }));
    const fast = vi.fn(() => ({ route: "b" }));
    const events: RuntimeEvent[] = [];
    const spec = createTestSpec({
      routes: {
        "/a": { loader: "slow", page: { root: "x", elements: { x: { type: "Text", props: { text: "A" } } } } },
        "/b": { loader: "fast", page: { root: "x", elements: { x: { type: "Text", props: { text: "B" } } } } },
      },
    });
    const navigation = createMemoryNavigation("/a");
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { slow, fast }, observer: (event: RuntimeEvent) => events.push(event) }),
      navigation,
    );
    await runtime.applySource({ kind: "object", value: spec });
    await tick();
    navigation.push("/b");
    await tick();
    resolveSlow({ route: "a" });
    await tick();
    expect(runtime.getSnapshot().pageData?.initialState?.route).toBe("b");
    expect(events.some((event) => event.name === "loader_stale")).toBe(true);
    runtime.dispose();
  });

  it.each(["subscriber", "location_changed"] as const)(
    "publishes navigation location and route presentation atomically before %s disposal",
    async (disposeAt) => {
      const navigation = createMemoryNavigation("/a");
      const spec = createTestSpec({
        routes: {
          "/a": {
            page: {
              root: "root",
              elements: { root: { type: "Text", props: { text: "A" } } },
            },
          },
          "/b": {
            page: {
              root: "root",
              elements: { root: { type: "Text", props: { text: "B" } } },
            },
          },
        },
      });
      let disposeOnNavigation = false;
      let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
      runtime = createRuntimeWithNavigation(
        runtimeOptions({
          observer: (event: RuntimeEvent) => {
            if (
              disposeAt === "location_changed" &&
              disposeOnNavigation &&
              event.name === "location_changed"
            ) {
              runtime.dispose();
            }
          },
        }),
        navigation,
      );
      await runtime.applySource({ kind: "object", value: spec });
      if (disposeAt === "subscriber") {
        runtime.subscribe(() => {
          if (disposeOnNavigation) runtime.dispose();
        });
      }

      disposeOnNavigation = true;
      navigation.push("/b");
      expect(runtime.getSnapshot()).toMatchObject({
        location: { pathname: "/b" },
        matched: { pattern: "/b" },
        routeSource: "current",
        routeStatus: "ready",
        pageData: { spec: { elements: { root: { props: { text: "B" } } } } },
      });
    },
  );

  it("binds re-entrant location events to each published navigation revision", async () => {
    const navigation = createMemoryNavigation("/a");
    const observations: Array<{ revision: number; pathname: string }> = [];
    let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
    runtime = createRuntimeWithNavigation(
      runtimeOptions({
        observer: (event: RuntimeEvent) => {
          if (event.name === "location_changed") {
            observations.push({
              revision: event.revision,
              pathname: runtime.getSnapshot().location.pathname,
            });
          }
        },
      }),
      navigation,
    );
    await runtime.applySource({
      kind: "object",
      value: createTestSpec({
        routes: Object.fromEntries(["/a", "/b", "/c"].map((pathname) => [
          pathname,
          {
            page: {
              root: "root",
              elements: {
                root: { type: "Text", props: { text: pathname } },
              },
            },
          },
        ])),
      }),
    });
    let nested = false;
    runtime.subscribe(() => {
      if (runtime.getSnapshot().location.pathname === "/b" && !nested) {
        nested = true;
        navigation.push("/c");
      }
    });

    navigation.push("/b");

    expect(observations).toEqual([
      { revision: 2, pathname: "/b" },
      { revision: 3, pathname: "/c" },
    ]);
    runtime.dispose();
  });

  it.each([
    ["success", { loaded: true }],
    ["failure", new Error("failed")],
  ] as const)(
    "keeps a renderable candidate presented when an older current loader settles with %s",
    async (_outcome, settlement) => {
      let settleLoader!: (value: Record<string, unknown>) => void;
      let rejectLoader!: (error: Error) => void;
      let releaseSource!: () => void;
      const loader = () => new Promise<Record<string, unknown>>((resolve, reject) => {
        settleLoader = resolve;
        rejectLoader = reject;
      });
      async function* candidateSource() {
        yield '{"op":"replace","path":"/routes/~1/page/elements/root/props/text","value":"Candidate"}\n';
        await new Promise<void>((resolve) => { releaseSource = resolve; });
      }
      const runtime = createRuntimeWithNavigation(
        runtimeOptions({ loaders: { slow: loader } }),
        createMemoryNavigation(),
      );
      await runtime.applySource({ kind: "object", value: withLoader("slow") });
      const controller = new AbortController();
      const pending = runtime.applySource(
        { kind: "jsonl-patch", base: "current", value: candidateSource() },
        { signal: controller.signal },
      );
      await tick();
      expect(runtime.getSnapshot()).toMatchObject({
        routeSource: "candidate",
        pageData: { spec: { elements: { root: { props: { text: "Candidate" } } } } },
      });
      const candidateRouteStatus = runtime.getSnapshot().routeStatus;

      if (settlement instanceof Error) rejectLoader(settlement);
      else settleLoader(settlement);
      await tick();

      expect(runtime.getSnapshot()).toMatchObject({
        routeSource: "candidate",
        routeStatus: candidateRouteStatus,
        pageData: { spec: { elements: { root: { props: { text: "Candidate" } } } } },
      });
      controller.abort();
      releaseSource();
      await pending;
      expect(runtime.getSnapshot()).toMatchObject({
        routeSource: "current",
        routeStatus: settlement instanceof Error ? "error" : "ready",
      });
      if (!(settlement instanceof Error)) {
        expect(runtime.getSnapshot().pageData?.initialState?.loaded).toBe(true);
      }
      runtime.dispose();
    },
  );

  it("publishes a committed spec and its current route presentation atomically", async () => {
    let committedSnapshot: ReturnType<typeof runtime.getSnapshot> | undefined;
    let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
    runtime = createRuntimeWithNavigation(
      runtimeOptions({
        observer: (event: RuntimeEvent) => {
          if (event.name === "source_committed") {
            committedSnapshot = runtime.getSnapshot();
          }
        },
      }),
      createMemoryNavigation(),
    );
    const published: Array<ReturnType<typeof runtime.getSnapshot>> = [];
    runtime.subscribe(() => published.push(runtime.getSnapshot()));

    await runtime.applySource({ kind: "object", value: createTestSpec() });
    expect(committedSnapshot).toMatchObject({
      candidate: null,
      routeSource: "current",
      routeStatus: "ready",
      pageData: { spec: { elements: { root: { props: { text: "Home" } } } } },
    });

    published.length = 0;
    await runtime.applySource({
      kind: "jsonl-patch",
      base: "current",
      value: '{"op":"replace","path":"/routes/~1/page/elements/root/props/text","value":"Candidate"}\n',
    });
    expect(committedSnapshot).toMatchObject({
      candidate: null,
      routeSource: "current",
      routeStatus: "ready",
      pageData: { spec: { elements: { root: { props: { text: "Candidate" } } } } },
    });
    expect(published.some((snapshot) =>
      snapshot.routeSource === "candidate" && snapshot.candidate === null
    )).toBe(false);
    runtime.dispose();
  });

  it("cancels when an observer disposes before commit publication", async () => {
    let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
    runtime = createRuntimeWithNavigation(
      runtimeOptions({
        observer: (event: RuntimeEvent) => {
          if (event.name === "source_validated") runtime.dispose();
        },
      }),
      createMemoryNavigation(),
    );

    const result = await runtime.applySource({ kind: "object", value: createTestSpec() });
    expect(result).toEqual({ status: "cancelled", revision: 0 });
    expect(runtime.getSnapshot()).toMatchObject({
      current: null,
      specStatus: "streaming",
      revision: 0,
    });
  });

  it("keeps an atomic commit when route_matched disposes afterward", async () => {
    let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
    runtime = createRuntimeWithNavigation(
      runtimeOptions({
        observer: (event: RuntimeEvent) => {
          if (event.name === "route_matched") runtime.dispose();
        },
      }),
      createMemoryNavigation(),
    );

    const result = await runtime.applySource({ kind: "object", value: createTestSpec() });
    expect(result).toMatchObject({ status: "committed", revision: 1 });
    expect(runtime.getSnapshot()).toMatchObject({
      current: { routes: { "/": {} } },
      specStatus: "ready",
      routeSource: "current",
      routeStatus: "ready",
      revision: 1,
    });
  });

  it("resolves a re-entrant route_matched navigation against the committed spec", async () => {
    const navigation = createMemoryNavigation();
    const spec = createTestSpec({
      routes: {
        "/": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Home" } } },
          },
        },
        "/next": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Next" } } },
          },
        },
      },
    });
    let navigated = false;
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        observer: (event: RuntimeEvent) => {
          if (event.name === "route_matched" && !navigated) {
            navigated = true;
            navigation.push("/next");
          }
        },
      }),
      navigation,
    );

    const result = await runtime.applySource({ kind: "object", value: spec });
    expect(result).toMatchObject({ status: "committed", revision: 1 });
    expect(runtime.getSnapshot()).toMatchObject({
      current: spec,
      location: { pathname: "/next" },
      matched: { pattern: "/next" },
      routeSource: "current",
      pageData: { spec: { elements: { root: { props: { text: "Next" } } } } },
    });
    runtime.dispose();
  });

  it("does not convert a published commit to cancelled after subscriber navigation", async () => {
    const navigation = createMemoryNavigation();
    const spec = createTestSpec({
      routes: {
        "/": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Home" } } },
          },
        },
        "/next": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Next" } } },
          },
        },
      },
    });
    const runtime = createRuntimeWithNavigation(runtimeOptions(), navigation);
    let navigated = false;
    runtime.subscribe(() => {
      if (runtime.getSnapshot().current && !navigated) {
        navigated = true;
        navigation.push("/next");
      }
    });

    const result = await runtime.applySource({ kind: "object", value: spec });
    expect(result).toMatchObject({ status: "committed", revision: 1 });
    expect(runtime.getSnapshot()).toMatchObject({
      current: spec,
      specStatus: "ready",
      location: { pathname: "/next" },
      matched: { pattern: "/next" },
      routeSource: "current",
      pageData: { spec: { elements: { root: { props: { text: "Next" } } } } },
    });
    runtime.dispose();
  });

  it("keeps observer revisions monotonic during subscriber re-entrant navigation", async () => {
    const navigation = createMemoryNavigation();
    const events: RuntimeEvent[] = [];
    const spec = createTestSpec({
      routes: {
        "/": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Home" } } },
          },
        },
        "/next": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Next" } } },
          },
        },
      },
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ observer: (event: RuntimeEvent) => events.push(event) }),
      navigation,
    );
    let navigated = false;
    runtime.subscribe(() => {
      if (runtime.getSnapshot().current && !navigated) {
        navigated = true;
        navigation.push("/next");
      }
    });

    const result = await runtime.applySource({ kind: "object", value: spec });
    const revisions = events.map((event) => event.revision);
    expect(revisions).toEqual([...revisions].sort((left, right) => left - right));
    expect(events.find((event) => event.name === "source_committed")?.revision)
      .toBe(result.revision);
    runtime.dispose();
  });

  it("does not invoke a loader after loader_started disposes the runtime", async () => {
    const loader = vi.fn(() => ({ loaded: true }));
    let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
    runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { home: loader },
        observer: (event: RuntimeEvent) => {
          if (event.name === "loader_started") runtime.dispose();
        },
      }),
      createMemoryNavigation(),
    );

    const result = await runtime.applySource({
      kind: "object",
      value: withLoader("home"),
    });
    await tick();
    expect(result).toMatchObject({ status: "committed", revision: 1 });
    expect(runtime.getSnapshot()).toMatchObject({
      current: { routes: { "/": { loader: "home" } } },
      specStatus: "ready",
      routeStatus: "loading",
      revision: 1,
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("retries the current loader without replacing a live candidate presentation", async () => {
    let releaseSource!: () => void;
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ recovered: true });
    async function* candidateSource() {
      yield '{"op":"replace","path":"/routes/~1/page/elements/root/props/text","value":"Candidate"}\n';
      await new Promise<void>((resolve) => { releaseSource = resolve; });
    }
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { retryable: loader } }),
      createMemoryNavigation(),
    );
    await runtime.applySource({ kind: "object", value: withLoader("retryable") });
    await tick();
    expect(runtime.getSnapshot().routeStatus).toBe("error");

    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "jsonl-patch", base: "current", value: candidateSource() },
      { signal: controller.signal },
    );
    await tick();
    expect(runtime.getSnapshot()).toMatchObject({
      routeSource: "candidate",
      pageData: { spec: { elements: { root: { props: { text: "Candidate" } } } } },
    });

    runtime.retryLoader();
    await tick();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot()).toMatchObject({
      routeSource: "candidate",
      pageData: { spec: { elements: { root: { props: { text: "Candidate" } } } } },
    });

    controller.abort();
    releaseSource();
    await pending;
    expect(runtime.getSnapshot()).toMatchObject({
      routeSource: "current",
      routeStatus: "ready",
      pageData: {
        spec: { elements: { root: { props: { text: "Home" } } } },
        initialState: { recovered: true },
      },
    });
    runtime.dispose();
  });

  it("suppresses a hidden retry when route_matched navigates to another loader key", async () => {
    const retryA = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ retried: "a" });
    const loadB = vi.fn(() => ({ loaded: "b" }));
    let releaseSource!: () => void;
    let navigateOnRetry = false;
    async function* candidateSource() {
      yield '{"op":"replace","path":"/routes/~1a/page/elements/root/props/text","value":"Candidate A"}\n';
      await new Promise<void>((resolve) => { releaseSource = resolve; });
    }
    const spec = createTestSpec({
      routes: {
        "/a": {
          loader: "retryA",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "A" } } },
          },
        },
        "/b": {
          loader: "loadB",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "B" } } },
          },
        },
      },
    });
    const navigation = createMemoryNavigation("/a");
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { retryA, loadB },
        observer: (event: RuntimeEvent) => {
          if (event.name === "route_matched" && navigateOnRetry) {
            navigateOnRetry = false;
            navigation.push("/b");
          }
        },
      }),
      navigation,
    );
    await runtime.applySource({ kind: "object", value: spec });
    await tick();
    expect(retryA).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "jsonl-patch", base: "current", value: candidateSource() },
      { signal: controller.signal },
    );
    await tick();
    navigateOnRetry = true;
    runtime.retryLoader();
    await tick();

    expect(retryA).toHaveBeenCalledOnce();
    expect(loadB).not.toHaveBeenCalled();
    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/b" },
      routeSource: "candidate",
      matched: { pattern: "/b" },
      pageData: { spec: { elements: { root: { props: { text: "B" } } } } },
    });

    controller.abort();
    releaseSource();
    await pending;
    runtime.dispose();
  });

  it.each([
    ["success", "loader_succeeded", "ready"],
    ["failure", "loader_failed", "error"],
  ] as const)(
    "emits loader %s against its terminal snapshot before a subscriber retry",
    async (outcome, eventName, terminalStatus) => {
      const loader = vi.fn()
        .mockImplementationOnce(() => outcome === "success"
          ? Promise.resolve({ attempt: 1 })
          : Promise.reject(new Error("failed")))
        .mockImplementationOnce(() => new Promise<Record<string, unknown>>(() => undefined));
      const observations: Array<{ name: string; routeStatus: string }> = [];
      let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
      runtime = createRuntimeWithNavigation(
        runtimeOptions({
          loaders: { terminal: loader },
          observer: (event: RuntimeEvent) => {
            if (event.name === eventName) {
              observations.push({
                name: event.name,
                routeStatus: runtime.getSnapshot().routeStatus,
              });
            }
          },
        }),
        createMemoryNavigation(),
      );
      let retried = false;
      runtime.subscribe(() => {
        if (!retried && runtime.getSnapshot().routeStatus === terminalStatus) {
          retried = true;
          runtime.retryLoader();
        }
      });

      await runtime.applySource({ kind: "object", value: withLoader("terminal") });
      await tick();

      expect(observations).toEqual([{ name: eventName, routeStatus: terminalStatus }]);
      expect(loader).toHaveBeenCalledTimes(2);
      expect(runtime.getSnapshot().routeStatus).toBe("loading");
      runtime.dispose();
    },
  );

  it("marks an old current loader failure stale after candidate navigation", async () => {
    let rejectLoader!: (cause: unknown) => void;
    let releaseSource!: () => void;
    const slow = vi.fn(() => new Promise<Record<string, unknown>>((_resolve, reject) => {
      rejectLoader = reject;
    }));
    async function* candidateSource() {
      yield '{"op":"replace","path":"/routes/~1a/page/elements/root/props/text","value":"Candidate A"}\n';
      await new Promise<void>((resolve) => { releaseSource = resolve; });
    }
    const events: RuntimeEvent[] = [];
    const spec = createTestSpec({
      routes: {
        "/a": {
          loader: "slow",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "A" } } },
          },
        },
        "/b": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "B" } } },
          },
        },
      },
    });
    const navigation = createMemoryNavigation("/a");
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { slow },
        observer: (event: RuntimeEvent) => events.push(event),
      }),
      navigation,
    );
    await runtime.applySource({ kind: "object", value: spec });
    await tick();
    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "jsonl-patch", base: "current", value: candidateSource() },
      { signal: controller.signal },
    );
    await tick();
    navigation.push("/b");

    rejectLoader(new Error("late failure"));
    await tick();
    expect(events.some((event) => event.name === "loader_stale")).toBe(true);
    expect(events.some((event) => event.name === "loader_failed")).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/b" },
      routeSource: "candidate",
      routeStatus: "ready",
      pageData: { spec: { elements: { root: { props: { text: "B" } } } } },
    });

    controller.abort();
    releaseSource();
    await pending;
    runtime.dispose();
  });

  it("marks loader data stale when ownership cloning re-enters navigation", async () => {
    const navigation = createMemoryNavigation("/a");
    const events: RuntimeEvent[] = [];
    const loader = vi.fn(() => Object.defineProperty({}, "navigated", {
      enumerable: true,
      get() {
        navigation.push("/b");
        return true;
      },
    }));
    const spec = createTestSpec({
      routes: {
        "/a": {
          loader: "reentrant",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "A" } } },
          },
        },
        "/b": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "B" } } },
          },
        },
      },
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { reentrant: loader },
        observer: (event: RuntimeEvent) => events.push(event),
      }),
      navigation,
    );

    await runtime.applySource({ kind: "object", value: spec });
    await tick();

    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/b" },
      matched: { pattern: "/b" },
      routeSource: "current",
      routeStatus: "ready",
      pageData: { spec: { elements: { root: { props: { text: "B" } } } } },
    });
    expect(events.some((event) => event.name === "loader_stale")).toBe(true);
    expect(events.some((event) => event.name === "loader_succeeded")).toBe(false);
    runtime.dispose();
  });

  it("merges loader data into the latest same-key spec after ownership re-entry", async () => {
    const first = withLoader("reentrant", "First");
    const second = withLoader("reentrant", "Second");
    let runtime!: ReturnType<typeof createRuntimeWithNavigation>;
    let reentered = false;
    const loader = vi.fn(() => Object.defineProperty({}, "loaded", {
      enumerable: true,
      get() {
        if (!reentered) {
          reentered = true;
          void runtime.applySource({ kind: "object", value: second });
        }
        return true;
      },
    }));
    runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { reentrant: loader } }),
      createMemoryNavigation(),
    );

    await runtime.applySource({ kind: "object", value: first });
    await tick();

    expect(runtime.getSnapshot()).toMatchObject({
      current: { routes: { "/": { page: { elements: {
        root: { props: { text: "Second" } },
      } } } } },
      matched: { pattern: "/" },
      routeSource: "current",
      routeStatus: "ready",
      pageData: {
        spec: { elements: { root: { props: { text: "Second" } } } },
        initialState: { loaded: true },
      },
    });
    expect(loader).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("does not execute rejected Proxy traps while classifying a loader failure", async () => {
    const navigation = createMemoryNavigation("/a");
    const events: RuntimeEvent[] = [];
    const cause = new Proxy({}, {
      getPrototypeOf() {
        navigation.push("/b");
        return Object.prototype;
      },
    });
    const loader = vi.fn(() => Promise.reject(cause));
    const spec = createTestSpec({
      routes: {
        "/a": {
          loader: "reentrant",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "A" } } },
          },
        },
        "/b": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "B" } } },
          },
        },
      },
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { reentrant: loader },
        observer: (event: RuntimeEvent) => events.push(event),
      }),
      navigation,
    );

    await runtime.applySource({ kind: "object", value: spec });
    await tick();

    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/a" },
      matched: { pattern: "/a" },
      routeSource: "current",
      routeStatus: "error",
      error: { code: "loader_failed" },
      pageData: { spec: { elements: { root: { props: { text: "A" } } } } },
    });
    expect(events.some((event) => event.name === "loader_failed")).toBe(true);
    runtime.dispose();
  });

  it("fails closed when a loader rejects with a revoked Proxy", async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { revoked: () => Promise.reject(proxy) } }),
      createMemoryNavigation(),
    );

    await runtime.applySource({ kind: "object", value: withLoader("revoked") });
    await tick();

    expect(runtime.getSnapshot()).toMatchObject({
      routeStatus: "error",
      error: { code: "loader_failed" },
    });
    runtime.dispose();
  });

  it("publishes an intermediate candidate and its route presentation atomically", async () => {
    let releaseSource!: () => void;
    async function* candidateSource() {
      yield '{"op":"remove","path":"/routes/~1b/loader"}\n';
      await new Promise<void>((resolve) => { releaseSource = resolve; });
    }
    const oldLoader = vi.fn(() => ({ old: true }));
    const navigation = createMemoryNavigation("/a");
    const spec = createTestSpec({
      routes: {
        "/a": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "A" } } },
          },
        },
        "/b": {
          loader: "old",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "B" } } },
          },
        },
      },
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { old: oldLoader } }),
      navigation,
    );
    await runtime.applySource({ kind: "object", value: spec });
    let navigated = false;
    runtime.subscribe(() => {
      if (runtime.getSnapshot().candidate && !navigated) {
        navigated = true;
        navigation.push("/b");
      }
    });
    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "jsonl-patch", base: "current", value: candidateSource() },
      { signal: controller.signal },
    );
    await tick();

    expect(oldLoader).not.toHaveBeenCalled();
    expect(runtime.getSnapshot()).toMatchObject({
      location: { pathname: "/b" },
      routeSource: "candidate",
      routeStatus: "ready",
      candidate: { routes: { "/b": { page: {} } } },
      matched: { pattern: "/b" },
      pageData: { spec: { elements: { root: { props: { text: "B" } } } } },
    });
    expect(runtime.getSnapshot().matched?.route.loader).toBeUndefined();

    controller.abort();
    releaseSource();
    await pending;
    runtime.dispose();
  });

  it("keeps routing against the candidate while a source transaction is active", async () => {
    let releaseSource!: () => void;
    async function* candidateSource() {
      yield '{"op":"replace","path":"/routes/~1next/page/elements/root/props/text","value":"Candidate next"}\n';
      await new Promise<void>((resolve) => { releaseSource = resolve; });
    }
    const spec = createTestSpec({
      routes: {
        "/": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Current home" } } },
          },
        },
        "/next": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "Current next" } } },
          },
        },
      },
    });
    const navigation = createMemoryNavigation();
    const runtime = createRuntimeWithNavigation(runtimeOptions(), navigation);
    await runtime.applySource({ kind: "object", value: spec });
    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "jsonl-patch", base: "current", value: candidateSource() },
      { signal: controller.signal },
    );
    await tick();

    navigation.push("/next");
    expect(runtime.getSnapshot()).toMatchObject({
      routeSource: "candidate",
      pageData: {
        spec: { elements: { root: { props: { text: "Candidate next" } } } },
      },
    });

    controller.abort();
    releaseSource();
    await pending;
    expect(runtime.getSnapshot()).toMatchObject({
      routeSource: "current",
      pageData: {
        spec: { elements: { root: { props: { text: "Current next" } } } },
      },
    });
    runtime.dispose();
  });

  it.each([
    [new Error("failed"), "error", "loader_failed"],
    [new RouteNotFound(), "not_found", "route_not_found"],
  ] as const)("distinguishes loader failure states", async (failure, status, code) => {
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { fail: () => { throw failure; } } }),
      createMemoryNavigation(),
    );
    await runtime.applySource({ kind: "object", value: withLoader("fail") });
    await tick();
    expect(runtime.getSnapshot()).toMatchObject({ routeStatus: status, error: { code } });
    runtime.dispose();
  });

  it("retries the active loader after a failure", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ recovered: true });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { retryable: loader } }),
      createMemoryNavigation(),
    );
    await runtime.applySource({ kind: "object", value: withLoader("retryable") });
    await tick();
    expect(runtime.getSnapshot().routeStatus).toBe("error");

    runtime.retryLoader();
    await tick();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot()).toMatchObject({
      routeStatus: "ready",
      pageData: { initialState: { recovered: true } },
    });
    runtime.dispose();
  });

  it("stops navigation and subscriber notifications after dispose", async () => {
    const navigation = createMemoryNavigation("/");
    const runtime = createRuntimeWithNavigation(runtimeOptions(), navigation);
    await runtime.applySource({ kind: "object", value: createTestSpec() });
    const listener = vi.fn();
    runtime.subscribe(listener);
    const before = runtime.getSnapshot();

    runtime.dispose();
    navigation.push("/missing");

    expect(runtime.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not retry loaders or emit late observer events after dispose", async () => {
    let resolveLoader!: (value: Record<string, unknown>) => void;
    const loader = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => {
      resolveLoader = resolve;
    }));
    const events: RuntimeEvent[] = [];
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: { slow: loader },
        observer: (event: RuntimeEvent) => events.push(event),
      }),
      createMemoryNavigation(),
    );
    await runtime.applySource({ kind: "object", value: withLoader("slow") });
    await tick();

    runtime.dispose();
    const eventCount = events.length;
    runtime.retryLoader();
    resolveLoader({ late: true });
    await tick();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(eventCount);
  });

  it("cancels a pending source without advancing the disposed snapshot", async () => {
    const source = new ReadableStream<string>();
    const runtime = createRuntimeWithNavigation(
      runtimeOptions(),
      createMemoryNavigation(),
    );
    const pending = runtime.applySource({ kind: "json", value: source });
    const revision = runtime.getSnapshot().revision;

    runtime.dispose();

    expect(await pending).toEqual({ status: "cancelled", revision });
    expect(runtime.getSnapshot().revision).toBe(revision);
  });

  it("snapshots Catalog inputs for the runtime lifecycle", async () => {
    const catalog = schema.createCatalog({
      components: {
        Text: {
          props: z.object({ text: z.string() }).strict(),
          slots: [],
          description: "Text",
          example: { text: "Example" },
        },
      },
      actions: {},
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ catalog, registry: { Text: () => null } }),
      createMemoryNavigation(),
    );

    catalog.componentNames.splice(0, catalog.componentNames.length);
    const result = await runtime.applySource({ kind: "object", value: createTestSpec() });

    expect(result.status).toBe("committed");
    runtime.dispose();
  });
});

describe("transaction gates", () => {
  it("normalizes object sources through their JSON representation", async () => {
    const objectRuntime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const jsonRuntime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const spec = createTestSpec({ state: { negativeZero: -0 } });

    await objectRuntime.applySource({ kind: "object", value: spec });
    await jsonRuntime.applySource({ kind: "json", value: JSON.stringify(spec) });

    const objectValue = objectRuntime.getSnapshot().current?.state?.negativeZero;
    const jsonValue = jsonRuntime.getSnapshot().current?.state?.negativeZero;
    expect(Object.is(objectValue, -0)).toBe(false);
    expect(objectValue).toBe(jsonValue);
    objectRuntime.dispose();
    jsonRuntime.dispose();
  });

  it("keeps a disposed memory navigation driver inert", () => {
    const navigation = createMemoryNavigation("/start");
    const listener = vi.fn();
    navigation.subscribe(listener);
    navigation.push("/next");
    expect(listener).toHaveBeenCalledOnce();
    const disposedSnapshot = navigation.getSnapshot();

    navigation.dispose();
    navigation.subscribe(listener);
    navigation.push("/after-push");
    navigation.replace("/after-replace");
    navigation.back();
    navigation.forward();

    expect(navigation.getSnapshot()).toBe(disposedSnapshot);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("releases Browser History listeners when synchronous construction fails", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("window", {
      location: {
        pathname: "/",
        search: "",
        hash: "",
        href: "https://runtime.test/",
        origin: "https://runtime.test",
      },
      addEventListener,
      removeEventListener,
    });

    try {
      expect(() => createNextAppRuntime({
        ...runtimeOptions(),
        limits: { ...testLimits, maxBytes: 0 },
      })).toThrowError(expect.objectContaining({ code: "source_limit_exceeded" }));
      expect(addEventListener.mock.calls.map(([name]) => name)).toEqual([
        "popstate",
        "next-app-runtime:navigate",
      ]);
      expect(removeEventListener.mock.calls.map(([name]) => name)).toEqual([
        "popstate",
        "next-app-runtime:navigate",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("isolates observer and subscriber failures from source transactions", async () => {
    const observer = vi.fn(() => {
      throw new Error("observer failure");
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ observer }),
      createMemoryNavigation(),
    );
    runtime.subscribe(() => {
      throw new Error("subscriber failure");
    });

    await expect(runtime.applySource({ kind: "object", value: createTestSpec() }))
      .resolves.toMatchObject({ status: "committed" });
    await expect(runtime.applySource({ kind: "object", value: createTestSpec() }))
      .resolves.toMatchObject({ status: "committed" });
    expect(observer).toHaveBeenCalled();
    runtime.dispose();
  });

  it("handles async observer and subscriber rejection without altering transactions", async () => {
    const observerFailure = new Error("async observer failure");
    const subscriberFailure = new Error("async subscriber failure");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      if (reason === observerFailure || reason === subscriberFailure) unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({
        observer: async () => {
          throw observerFailure;
        },
      }),
      createMemoryNavigation(),
    );
    runtime.subscribe(async () => {
      throw subscriberFailure;
    });
    try {
      await expect(runtime.applySource({ kind: "object", value: createTestSpec() }))
        .resolves.toMatchObject({ status: "committed" });
      await tick();
      expect(unhandled).toEqual([]);
    } finally {
      runtime.dispose();
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });

  it("deeply owns committed specs and freezes public snapshots", async () => {
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const result = await runtime.applySource({ kind: "object", value: createTestSpec() });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw new Error("Expected committed source");

    expect(() => {
      result.spec.routes["/"]!.page.elements.root!.props.text = "mutated";
    }).toThrow(TypeError);
    expect(() => {
      runtime.getSnapshot().current = null;
    }).toThrow(TypeError);
    expect(runtime.getSnapshot().current?.routes["/"]?.page.elements.root?.props)
      .toEqual({ text: "Home" });
    runtime.dispose();
  });

  it("deeply owns and freezes loader data and RuntimeError details", async () => {
    const loaderData = {
      nested: { value: 1 },
      map: new Map([["entry", { value: 1 }]]),
      set: new Set([{ value: 1 }]),
      date: new Date("2026-01-01T00:00:00.000Z"),
    };
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { owned: () => loaderData } }),
      createMemoryNavigation(),
    );
    await runtime.applySource({ kind: "object", value: withLoader("owned") });
    await tick();
    const snapshot = runtime.getSnapshot();
    const initialState = snapshot.pageData?.initialState as {
      nested: { value: number };
      map: Map<string, { value: number }>;
      set: Set<{ value: number }>;
      date: Date;
    };

    loaderData.nested.value = 2;
    expect(initialState.nested.value).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.pageData)).toBe(true);
    expect(Object.isFrozen(initialState)).toBe(true);
    expect(Object.isFrozen(initialState.nested)).toBe(true);
    expect(() => {
      initialState.nested.value = 3;
    }).toThrow(TypeError);

    const ownedMap = initialState.map as Map<string, { value: number }>;
    const ownedSet = initialState.set as Set<{ value: number }>;
    loaderData.map.get("entry")!.value = 2;
    loaderData.map.set("later", { value: 2 });
    loaderData.set.add({ value: 2 });
    loaderData.date.setUTCFullYear(2030);
    expect(ownedMap.get("entry")?.value).toBe(1);
    expect(ownedMap.has("later")).toBe(false);
    expect(ownedSet.size).toBe(1);
    expect(initialState.date.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(Object.isFrozen(ownedMap)).toBe(true);
    expect(Object.isFrozen(ownedSet)).toBe(true);
    expect(() => ownedMap.set("mutated", { value: 3 })).toThrow(TypeError);
    expect(() => ownedSet.clear()).toThrow(TypeError);
    expect(() => initialState.date.setUTCFullYear(2030)).toThrow(TypeError);
    expect(ownedMap.valueOf()).toBe(ownedMap);
    expect(ownedSet.valueOf()).toBe(ownedSet);
    ownedMap.forEach((_value, _key, map) => {
      expect(map).toBe(ownedMap);
      expect(() => map.clear()).toThrow(TypeError);
    });
    ownedSet.forEach((_value, _key, set) => {
      expect(set).toBe(ownedSet);
      expect(() => set.add({ value: 3 })).toThrow(TypeError);
    });
    const mapLeak = Symbol("map leak");
    const setLeak = Symbol("set leak");
    const dateLeak = Symbol("date leak");
    const originalToISOString = Date.prototype.toISOString;
    const originalValueOf = Date.prototype.valueOf;
    const originalReflectApply = Reflect.apply;
    const originalReflectGet = Reflect.get;
    const originalMapGet = Map.prototype.get;
    const leakedReceivers: unknown[] = [];
    let patchedMapValue: number | undefined;
    let patchedSetHas = false;
    let patchedDateTime: number | undefined;
    let jsonReceiver: unknown;
    let primitiveReceiver: unknown;
    Object.defineProperty(Map.prototype, mapLeak, {
      configurable: true,
      get() { return this; },
    });
    Object.defineProperty(Set.prototype, setLeak, {
      configurable: true,
      get() { return this; },
    });
    Object.defineProperty(Date.prototype, dateLeak, {
      configurable: true,
      get() { return this; },
    });
    try {
      const exposedMap = (ownedMap as Map<string, { value: number }> & {
        [mapLeak]: Map<string, { value: number }>;
      })[mapLeak];
      const exposedSet = (ownedSet as Set<{ value: number }> & {
        [setLeak]: Set<{ value: number }>;
      })[setLeak];
      const exposedDate = (initialState.date as Date & { [dateLeak]: Date })[dateLeak];
      expect(exposedMap).toBe(ownedMap);
      expect(exposedSet).toBe(ownedSet);
      expect(exposedDate).toBe(initialState.date);
      expect(() => exposedMap.set("escaped", { value: 4 })).toThrow(TypeError);
      expect(() => exposedSet.add({ value: 4 })).toThrow(TypeError);
      expect(() => exposedDate.setTime(0)).toThrow(TypeError);
      Date.prototype.toISOString = function () {
        jsonReceiver = this;
        return "2026-01-01T00:00:00.000Z";
      };
      Date.prototype.valueOf = function () {
        primitiveReceiver = this;
        return Date.UTC(2026, 0, 1);
      };
      expect(initialState.date.toJSON()).toBe("2026-01-01T00:00:00.000Z");
      expect(Number(initialState.date)).toBe(Date.UTC(2026, 0, 1));
      expect(jsonReceiver).toBeUndefined();
      expect(primitiveReceiver).toBeUndefined();
      Reflect.apply = (<T, A extends readonly unknown[], R>(
        target: (this: T, ...args: A) => R,
        thisArgument: T,
        argumentsList: A,
      ) => {
        leakedReceivers.push(thisArgument);
        return originalReflectApply(target, thisArgument, argumentsList);
      }) as typeof Reflect.apply;
      Reflect.get = ((target, propertyKey, receiver) => {
        leakedReceivers.push(target);
        return originalReflectGet(target, propertyKey, receiver);
      }) as typeof Reflect.get;
      Map.prototype.get = function (key) {
        leakedReceivers.push(this);
        return originalMapGet.call(this, key);
      };
      patchedMapValue = ownedMap.get("entry")?.value;
      patchedSetHas = ownedSet.has([...ownedSet][0]!);
      patchedDateTime = initialState.date.getTime();
    } finally {
      Date.prototype.toISOString = originalToISOString;
      Date.prototype.valueOf = originalValueOf;
      Reflect.apply = originalReflectApply;
      Reflect.get = originalReflectGet;
      Map.prototype.get = originalMapGet;
      delete (Map.prototype as Map<unknown, unknown> & { [mapLeak]?: unknown })[mapLeak];
      delete (Set.prototype as Set<unknown> & { [setLeak]?: unknown })[setLeak];
      delete (Date.prototype as Date & { [dateLeak]?: unknown })[dateLeak];
    }
    expect(patchedMapValue).toBe(1);
    expect(patchedSetHas).toBe(true);
    expect(patchedDateTime).toBe(Date.UTC(2026, 0, 1));
    expect(leakedReceivers).toEqual([]);
    expect(() => {
      ownedMap.get("entry")!.value = 3;
    }).toThrow(TypeError);

    const details = {
      nested: { value: 1 },
      map: new Map([["entry", { value: 1 }]]),
    };
    const error = new RuntimeError("contract_invalid", "invalid", details);
    details.nested.value = 2;
    details.map.set("later", { value: 2 });
    expect(error.details?.nested).toEqual({ value: 1 });
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen(error.details?.nested)).toBe(true);
    const errorMap = error.details?.map as Map<string, { value: number }>;
    expect(errorMap.has("later")).toBe(false);
    expect(Object.isFrozen(errorMap)).toBe(true);
    expect(() => errorMap.delete("entry")).toThrow(TypeError);
    for (const unsupported of [() => undefined, new ArrayBuffer(8)]) {
      expect(() => new RuntimeError("contract_invalid", "invalid", {
        unsupported,
      })).toThrowError(
        expect.objectContaining({
          name: "TypeError",
          message: "Runtime values must use ownership-safe structured data",
        }),
      );
    }
    const unsupportedRuntime = createRuntimeWithNavigation(
      runtimeOptions({
        loaders: {
          unsupported: () => ({ value: new ArrayBuffer(8) }),
        },
      }),
      createMemoryNavigation(),
    );
    await unsupportedRuntime.applySource({
      kind: "object",
      value: withLoader("unsupported"),
    });
    await tick();
    expect(unsupportedRuntime.getSnapshot()).toMatchObject({
      routeStatus: "error",
      error: { code: "loader_failed" },
    });
    unsupportedRuntime.dispose();
    expect(() => {
      (error as { code: string }).code = "loader_failed";
    }).toThrow(TypeError);
    runtime.dispose();
  });

  it("keeps current when a later source is invalid", async () => {
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const committed = await runtime.applySource({ kind: "object", value: createTestSpec() });
    const current = runtime.getSnapshot().current;
    expect(committed.status).toBe("committed");
    const rejected = await runtime.applySource({ kind: "object", value: { routes: {}, extra: true } });
    expect(rejected).toMatchObject({ status: "rejected", error: { code: "contract_invalid" } });
    expect(runtime.getSnapshot().current).toBe(current);
    expect(runtime.getSnapshot()).toMatchObject({
      specStatus: "invalid",
      error: { code: "contract_invalid" },
      routeSource: "current",
      routeStatus: "ready",
    });
    runtime.dispose();
  });

  it("preserves an invalid source diagnostic across navigation and loader retry", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ recovered: true });
    const navigation = createMemoryNavigation("/a");
    const spec = createTestSpec({
      routes: {
        "/a": {
          loader: "retryable",
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "A" } } },
          },
        },
        "/b": {
          page: {
            root: "root",
            elements: { root: { type: "Text", props: { text: "B" } } },
          },
        },
      },
    });
    const runtime = createRuntimeWithNavigation(
      runtimeOptions({ loaders: { retryable: loader } }),
      navigation,
    );
    await runtime.applySource({ kind: "object", value: spec });
    await tick();
    await runtime.applySource({ kind: "object", value: { ...spec, extra: true } });

    navigation.push("/b");
    expect(runtime.getSnapshot()).toMatchObject({
      specStatus: "invalid",
      routeStatus: "ready",
      matched: { pattern: "/b" },
      error: { code: "contract_invalid" },
    });
    navigation.push("/a");
    runtime.retryLoader();
    expect(runtime.getSnapshot()).toMatchObject({
      specStatus: "invalid",
      routeStatus: "loading",
      error: { code: "contract_invalid" },
    });
    await tick();
    expect(runtime.getSnapshot()).toMatchObject({
      specStatus: "invalid",
      routeStatus: "ready",
      error: { code: "contract_invalid" },
      pageData: { initialState: { recovered: true } },
    });
    runtime.dispose();
  });

  it.each(["rejected", "cancelled"] as const)(
    "emits a %s source terminal event at the SourceResult revision before subscribers",
    async (outcome) => {
      const events: RuntimeEvent[] = [];
      const navigation = createMemoryNavigation();
      const runtime = createRuntimeWithNavigation(
        runtimeOptions({ observer: (event: RuntimeEvent) => events.push(event) }),
        navigation,
      );
      await runtime.applySource({ kind: "object", value: createTestSpec() });
      let retried = false;
      runtime.subscribe(() => {
        if (!retried && ["invalid", "cancelled"].includes(runtime.getSnapshot().specStatus)) {
          retried = true;
          navigation.push("/missing");
        }
      });

      let result: Awaited<ReturnType<typeof runtime.applySource>>;
      if (outcome === "rejected") {
        result = await runtime.applySource({
          kind: "object",
          value: { ...createTestSpec(), extra: true },
        });
      } else {
        const controller = new AbortController();
        controller.abort();
        result = await runtime.applySource(
          { kind: "object", value: createTestSpec() },
          { signal: controller.signal },
        );
      }
      const eventName = outcome === "rejected" ? "source_rejected" : "source_cancelled";
      const terminal = events.find((event) => event.name === eventName);
      expect(result.status).toBe(outcome);
      expect(terminal?.revision).toBe(result.revision);
      const terminalIndex = events.findIndex((event) => event.name === eventName);
      const laterRevisions = events.slice(terminalIndex + 1).map((event) => event.revision);
      expect(laterRevisions.every((revision) => revision >= terminal!.revision)).toBe(true);
      runtime.dispose();
    },
  );

  it("reports catalog and reference failures distinctly", async () => {
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    const catalogFailure = await runtime.applySource({
      kind: "object",
      value: createTestSpec({ routes: { "/": { page: { root: "x", elements: { x: { type: "Text", props: { text: 1 } } } } } } }),
    });
    expect(catalogFailure).toMatchObject({ status: "rejected", error: { code: "catalog_invalid" } });
    const referenceFailure = await runtime.applySource({
      kind: "object",
      value: createTestSpec({ routes: { "/": { page: { root: "missing", elements: {} } } } }),
    });
    expect(referenceFailure).toMatchObject({ status: "rejected", error: { code: "references_invalid" } });
    runtime.dispose();
  });

  it("requires acyclic trees and a reachable Slot only for referenced layouts", async () => {
    const orphanSlot = createTestSpec({
      layouts: {
        main: {
          root: "root",
          elements: {
            root: { type: "Text", props: { text: "Layout" } },
            slot: { type: "Slot", props: {} },
          },
        },
      },
      routes: {
        "/": {
          layout: "main",
          page: { root: "root", elements: { root: { type: "Text", props: { text: "Page" } } } },
        },
      },
    });
    const cycle = createTestSpec({
      routes: {
        "/": {
          page: {
            root: "root",
            elements: {
              root: { type: "Text", props: { text: "Cycle" }, children: ["root"] },
            },
          },
        },
      },
    });
    const unusedLayoutWithoutSlot = createTestSpec({
      layouts: {
        unused: {
          root: "root",
          elements: { root: { type: "Text", props: { text: "Unused" } } },
        },
      },
    });

    const slotRuntime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    await expect(slotRuntime.applySource({ kind: "object", value: orphanSlot }))
      .resolves.toMatchObject({ status: "rejected", error: { code: "slot_missing" } });
    slotRuntime.dispose();
    const cycleRuntime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    await expect(cycleRuntime.applySource({ kind: "object", value: cycle }))
      .resolves.toMatchObject({ status: "rejected", error: { code: "references_invalid" } });
    cycleRuntime.dispose();
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    await expect(runtime.applySource({ kind: "object", value: unusedLayoutWithoutSlot }))
      .resolves.toMatchObject({ status: "committed" });
    runtime.dispose();
  });

  it("exposes the last renderable candidate but never commits a failed transaction", async () => {
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    await runtime.applySource({ kind: "object", value: createTestSpec() });
    const current = runtime.getSnapshot().current;
    const candidates: NextAppSpec[] = [];
    const unsubscribe = runtime.subscribe(() => {
      const candidate = runtime.getSnapshot().candidate;
      if (candidate) candidates.push(candidate);
    });
    const result = await runtime.applySource({
      kind: "jsonl-patch",
      base: "current",
      value:
        '{"op":"replace","path":"/routes/~1/page/elements/root/props/text","value":"Candidate"}\n' +
        '{"op":"add","path":"/extra","value":true}',
    });
    expect(result).toMatchObject({ status: "rejected", error: { code: "contract_invalid" } });
    expect(runtime.getSnapshot().current).toBe(current);
    expect(runtime.getSnapshot().candidate?.routes["/"]?.page.elements.root?.props)
      .toEqual({ text: "Candidate" });
    expect(runtime.getSnapshot()).toMatchObject({
      routeSource: "current",
      pageData: { spec: { elements: { root: { props: { text: "Home" } } } } },
    });
    expect(candidates.length).toBeGreaterThan(0);
    unsubscribe();
    runtime.dispose();
  });

  it("rejects a concurrent source and cancellation preserves current", async () => {
    let release!: () => void;
    async function* delayedSource() {
      await new Promise<void>((resolve) => { release = resolve; });
      yield JSON.stringify(createTestSpec());
    }
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    await runtime.applySource({ kind: "object", value: createTestSpec() });
    const current = runtime.getSnapshot().current;
    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "json", value: delayedSource() },
      { signal: controller.signal },
    );
    const busy = await runtime.applySource({ kind: "object", value: createTestSpec() });
    expect(busy).toMatchObject({ status: "rejected", error: { code: "source_busy" } });
    controller.abort();
    release();
    expect(await pending).toMatchObject({ status: "cancelled" });
    expect(runtime.getSnapshot().current).toBe(current);
    runtime.dispose();
  });

  it("keeps a cancelled candidate for diagnosis but restores current presentation", async () => {
    let release!: () => void;
    async function* candidateSource() {
      yield '{"op":"replace","path":"/routes/~1/page/elements/root/props/text","value":"Candidate"}\n';
      await new Promise<void>((resolve) => { release = resolve; });
    }
    const runtime = createRuntimeWithNavigation(runtimeOptions(), createMemoryNavigation());
    await runtime.applySource({ kind: "object", value: createTestSpec() });
    const controller = new AbortController();
    const pending = runtime.applySource(
      { kind: "jsonl-patch", value: candidateSource(), base: "current" },
      { signal: controller.signal },
    );
    await tick();
    controller.abort();
    release();

    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    expect(runtime.getSnapshot()).toMatchObject({
      specStatus: "cancelled",
      routeSource: "current",
      candidate: { routes: { "/": { page: { elements: { root: { props: { text: "Candidate" } } } } } } },
      pageData: { spec: { elements: { root: { props: { text: "Home" } } } } },
    });
    runtime.dispose();
  });

  it("rejects invalid runtime limits before accepting a source", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
      expect(() => createRuntimeWithNavigation(
        runtimeOptions({ limits: { ...testLimits, maxBytes: value } }),
        createMemoryNavigation(),
      )).toThrowError(expect.objectContaining({ code: "source_limit_exceeded" }));
    }
  });
});
