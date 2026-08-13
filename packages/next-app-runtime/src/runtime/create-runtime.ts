import {
  RuntimeError,
  isRouteNotFoundInstance,
  isRuntimeErrorInstance,
  type ApplySourceOptions,
  type MatchedRoute,
  type NextAppRuntime,
  type NextAppSpec,
  type NextAppSpecSource,
  type PageData,
  type RouteStatus,
  type RuntimeEvent,
  type RuntimeFallbacks,
  type RuntimeOptions,
  type RuntimeSnapshot,
  type SourceResult,
} from "../contract/types.js";
import type { Catalog } from "@json-render/core";
import { deepFreeze, ownAndDeepFreeze } from "../contract/immutable.js";
import { assertJsonValueGraph } from "../contract/json-value.js";
import { ownJsonEqual } from "../contract/own-json-equal.js";
import { nextAppSpecSchema } from "../contract/zod-schema.js";
import { createBrowserHistoryDriver } from "../navigation/browser-history.js";
import { toRoutePathname, type NavigationDriver } from "../navigation/location.js";
import { matchRoute } from "../router/match-route.js";
import { compileJsonlPatch } from "../stream/jsonl-compiler.js";
import { readSource } from "../stream/source.js";
import { assertCatalogAndRegistry, assertCatalogSpec } from "../validation/catalog-gate.js";
import {
  assertRuntimeInputDepth,
  assertRuntimeLimitConfig,
  assertRuntimeLimits,
} from "../validation/limits.js";
import { assertReferences } from "../validation/reference-gate.js";

interface RuntimeInternals {
  navigation: NavigationDriver;
  fallbacks: RuntimeFallbacks;
  options: RuntimeOptions;
  emitEvent(name: RuntimeEvent["name"], extra?: Partial<RuntimeEvent>): void;
  onDispose(listener: () => void): () => void;
}

interface LoaderState {
  key: string;
  status: Extract<RouteStatus, "loading" | "ready" | "not_found" | "error">;
  data?: Record<string, unknown>;
  error?: RuntimeError;
}

interface ResolveRouteOptions {
  retry?: boolean;
  snapshotPatch?: Partial<RuntimeSnapshot> | (() => Partial<RuntimeSnapshot>);
  preservePresentation?: boolean;
  onPublished?: (snapshot: RuntimeSnapshot) => void;
}

const LOADER_INVOCATION_SKIPPED = Symbol("loader invocation skipped");

const INTERNALS = new WeakMap<NextAppRuntime, RuntimeInternals>();

function handleBestEffortRejection(value: unknown): void {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) return;
  try {
    void Promise.resolve(value).catch(() => undefined);
  } catch {
    // Best-effort hooks cannot alter runtime behavior.
  }
}

function isAbortError(value: unknown): boolean {
  try {
    return value instanceof DOMException && value.name === "AbortError";
  } catch {
    return false;
  }
}

function freezeLocation(location: RuntimeSnapshot["location"]): RuntimeSnapshot["location"] {
  return Object.freeze({ ...location });
}

function freezeMatchedRoute(matched: MatchedRoute): MatchedRoute {
  return Object.freeze({
    ...matched,
    params: Object.freeze({ ...matched.params }),
  });
}

function mergeState(
  ...sources: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: source[key],
        writable: true,
      });
    }
  }
  return Object.keys(result).length > 0 ? deepFreeze(result) : undefined;
}

class RuntimeImplementation implements NextAppRuntime {
  private snapshot: RuntimeSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly disposeListeners = new Set<() => void>();
  private readonly unsubscribeNavigation: () => void;
  private applying = false;
  private disposed = false;
  private loaderRun = 0;
  private sourceError: RuntimeError | null = null;
  private sourceController: AbortController | null = null;
  private loaderState: LoaderState | null = null;
  private loaderTokenSequence = 0;
  private routeTokenSequence = 0;
  private mergedStateCache: {
    app: Record<string, unknown> | undefined;
    page: Record<string, unknown> | undefined;
    loader: Record<string, unknown> | undefined;
    value: Record<string, unknown> | undefined;
  } | null = null;

  constructor(
    private readonly options: RuntimeOptions,
    private readonly navigation: NavigationDriver,
  ) {
    assertCatalogAndRegistry(options.catalog, options.registry, options.handlers);
    this.snapshot = Object.freeze({
      current: null,
      candidate: null,
      specStatus: "empty",
      routeStatus: "idle",
      location: freezeLocation(navigation.getSnapshot()),
      matched: null,
      pageData: null,
      error: null,
      revision: 0,
    });
    this.unsubscribeNavigation = navigation.subscribe(() => {
      const previousPathname = this.snapshot.location.pathname;
      const location = freezeLocation(navigation.getSnapshot());
      if (location.pathname !== previousPathname) {
        const source = this.snapshot.routeSource === "candidate" && this.snapshot.candidate
          ? "candidate"
          : "current";
        this.resolveRoute(
          source === "candidate" ? this.snapshot.candidate : this.snapshot.current,
          source,
          {
            snapshotPatch: () => ({
              location,
              revision: this.snapshot.revision + 1,
            }),
            onPublished: (published) => {
              this.emitEvent("location_changed", { revision: published.revision });
            },
          },
        );
      } else {
        this.publish({
          ...this.snapshot,
          location,
          revision: this.snapshot.revision + 1,
        }, (published) => {
          this.emitEvent("location_changed", { revision: published.revision });
        });
      }
    });
  }

  startInitialSource(): void {
    if (this.options.initialSource) {
      void this.applySource(this.options.initialSource);
    }
  }

  getSnapshot = (): RuntimeSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onDispose = (listener: () => void): (() => void) => {
    if (this.disposed) {
      try {
        listener();
      } catch {
        // Disposal callbacks cannot reopen or corrupt runtime state.
      }
      return () => undefined;
    }
    this.disposeListeners.add(listener);
    return () => this.disposeListeners.delete(listener);
  };

  private publish(
    next: RuntimeSnapshot,
    beforeSubscribers?: (snapshot: RuntimeSnapshot) => void,
  ): RuntimeSnapshot | null {
    if (this.disposed) return null;
    const published = deepFreeze(next);
    this.snapshot = published;
    beforeSubscribers?.(published);
    for (const listener of this.listeners) {
      try {
        const result: unknown = listener();
        handleBestEffortRejection(result);
      } catch {
        // Host subscribers cannot alter runtime transaction semantics.
      }
    }
    return published;
  }

  emitEvent = (name: RuntimeEvent["name"], extra?: Partial<RuntimeEvent>): void => {
    if (this.disposed) return;
    try {
      const result: unknown = this.options.observer?.({
        name,
        at: Date.now(),
        revision: this.snapshot.revision,
        ...extra,
      });
      handleBestEffortRejection(result);
    } catch {
      // Observability is best-effort and cannot alter runtime behavior.
    }
  };

  private loaderToken(): string {
    this.loaderTokenSequence += 1;
    return `loader-${this.loaderTokenSequence}`;
  }

  private routeToken(): string {
    this.routeTokenSequence += 1;
    return `route-${this.routeTokenSequence}`;
  }

  private routeEvent(): Pick<RuntimeEvent, "pattern"> {
    return { pattern: this.routeToken() };
  }

  private loaderEvent(): Pick<RuntimeEvent, "loader" | "pattern"> {
    return {
      loader: this.loaderToken(),
      pattern: this.routeToken(),
    };
  }

  private pageData(
    spec: NextAppSpec,
    matched: MatchedRoute,
    loaderData?: Record<string, unknown>,
  ): PageData {
    const route = matched.route;
    const appState = spec.state;
    const pageState = route.page.state as Record<string, unknown> | undefined;
    const cache = this.mergedStateCache;
    const cacheHit = Boolean(cache &&
      ownJsonEqual(cache.app, appState) &&
      ownJsonEqual(cache.page, pageState) &&
      ownJsonEqual(cache.loader, loaderData));
    const mergedState = cacheHit
      ? cache!.value
      : mergeState(appState, pageState, loaderData);
    const initialState = cache && ownJsonEqual(cache.value, mergedState)
      ? cache.value
      : mergedState;
    this.mergedStateCache = {
      app: appState,
      page: pageState,
      loader: loaderData,
      value: initialState,
    };
    return deepFreeze({
      spec: route.page,
      initialState,
      layoutSpec: route.layout ? (spec.layouts?.[route.layout] ?? null) : null,
    });
  }

  private validate(input: unknown): NextAppSpec {
    assertRuntimeInputDepth(input, this.options.limits);
    const parsed = nextAppSpecSchema.safeParse(input);
    if (!parsed.success) {
      throw new RuntimeError("contract_invalid", "Input is not a NextAppSpec 0.19.0 object");
    }
    assertRuntimeLimits(parsed.data, this.options.limits);
    assertCatalogSpec(this.options.catalog, parsed.data);
    assertReferences(
      parsed.data,
      this.options.catalog.componentNames,
      this.options.catalog.actionNames,
    );
    return deepFreeze(parsed.data);
  }

  private restoreCurrentPresentation(
    specStatus: Extract<RuntimeSnapshot["specStatus"], "invalid" | "cancelled">,
    error: RuntimeError | null,
    onPublished?: (snapshot: RuntimeSnapshot) => void,
  ): number {
    this.sourceError = specStatus === "invalid" ? error : null;
    const candidate = this.snapshot.candidate;
    const current = this.snapshot.current;
    let revision = this.snapshot.revision;
    this.resolveRoute(current, "current", {
      snapshotPatch: () => {
        revision = this.snapshot.revision + 1;
        return {
          candidate,
          specStatus,
          revision,
        };
      },
      onPublished,
    });
    return revision;
  }

  private publishCandidate(input: unknown): void {
    try {
      const candidate = this.validate(input);
      this.resolveRoute(candidate, "candidate", {
        snapshotPatch: () => ({
          candidate,
          specStatus: "streaming",
          error: null,
          revision: this.snapshot.revision + 1,
        }),
      });
    } catch {
      // An intermediate patch is allowed to be incomplete. Final validation is strict.
    }
  }

  async applySource(
    source: NextAppSpecSource,
    applyOptions: ApplySourceOptions = {},
  ): Promise<SourceResult> {
    if (this.disposed) {
      return {
        status: "rejected",
        revision: this.snapshot.revision,
        error: new RuntimeError("source_busy", "Runtime is disposed"),
      };
    }
    if (this.applying) {
      const error = new RuntimeError("source_busy", "A source transaction is already active");
      return { status: "rejected", revision: this.snapshot.revision, error };
    }
    this.applying = true;
    const sourceController = new AbortController();
    this.sourceController = sourceController;
    this.sourceError = null;
    const forwardAbort = () => sourceController.abort();
    if (applyOptions.signal?.aborted) sourceController.abort();
    else applyOptions.signal?.addEventListener("abort", forwardAbort, { once: true });
    const signal = sourceController.signal;
    this.emitEvent("source_received");
    this.publish({ ...this.snapshot, specStatus: "streaming", error: null });
    try {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      let input: unknown;
      if (source.kind === "object") {
        assertRuntimeInputDepth(source.value, this.options.limits);
        assertJsonValueGraph(source.value);
        const text = JSON.stringify(source.value);
        if (new TextEncoder().encode(text).byteLength > this.options.limits.maxBytes) {
          throw new RuntimeError("source_limit_exceeded", "Source exceeds maxBytes");
        }
        input = JSON.parse(text);
      } else if (source.kind === "json") {
        const text = await readSource(source.value, this.options.limits.maxBytes, signal);
        try {
          input = JSON.parse(text);
        } catch {
          throw new RuntimeError("json_parse_failed", "JSON source is invalid");
        }
      } else {
        if (source.base === "current" && !this.snapshot.current) {
          throw new RuntimeError("base_spec_missing", "Patch requires a current spec");
        }
        const base = source.base === "current" ? this.snapshot.current : {};
        input = (
          await compileJsonlPatch(
            base,
            source.value,
            this.options.limits,
            signal,
            (candidate) => this.publishCandidate(candidate),
          )
        ).value;
      }

      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const candidate = this.validate(input);
      this.emitEvent("source_validated");
      if (signal.aborted || this.disposed) {
        throw new DOMException("Aborted", "AbortError");
      }
      let revision: number | undefined;
      const committed = this.resolveRoute(candidate, "current", {
        snapshotPatch: () => {
          revision = this.snapshot.revision + 1;
          return {
            current: candidate,
            candidate: null,
            specStatus: "ready",
            error: null,
            revision,
          };
        },
        onPublished: (published) => {
          this.emitEvent("source_committed", { revision: published.revision });
        },
      });
      if (!committed || revision === undefined) {
        throw new DOMException("Aborted", "AbortError");
      }
      return { status: "committed", revision, spec: candidate };
    } catch (cause) {
      if (isAbortError(cause)) {
        const revision = this.disposed ? this.snapshot.revision : this.restoreCurrentPresentation(
          "cancelled",
          null,
          (published) => {
            this.emitEvent("source_cancelled", { revision: published.revision });
          },
        );
        return { status: "cancelled", revision };
      }
      const error = isRuntimeErrorInstance(cause)
        ? cause
        : new RuntimeError("contract_invalid", "Source validation failed");
      const revision = this.restoreCurrentPresentation(
        "invalid",
        error,
        (published) => {
          this.emitEvent("source_rejected", {
            code: error.code,
            revision: published.revision,
          });
        },
      );
      return { status: "rejected", revision, error };
    } finally {
      applyOptions.signal?.removeEventListener("abort", forwardAbort);
      if (this.sourceController === sourceController) this.sourceController = null;
      this.applying = false;
    }
  }

  private resolveRoute(
    spec: NextAppSpec | null,
    source: "current" | "candidate",
    options: ResolveRouteOptions = {},
  ): boolean {
    const retry = options.retry ?? false;
    const snapshotPatch = options.preservePresentation
      ? undefined
      : typeof options.snapshotPatch === "function"
        ? options.snapshotPatch()
        : options.snapshotPatch;
    const rawPathname = snapshotPatch?.location?.pathname ?? this.snapshot.location.pathname;
    const pathname = toRoutePathname(rawPathname);
    const publishPresentation = (
      presentation: Partial<RuntimeSnapshot>,
    ): RuntimeSnapshot | null => {
      if (options.preservePresentation) return null;
      return this.publish({
        ...this.snapshot,
        ...snapshotPatch,
        ...presentation,
        error: presentation.error ?? (
          (snapshotPatch?.specStatus ?? this.snapshot.specStatus) === "invalid"
            ? this.sourceError
            : null
        ),
      }, options.onPublished);
    };
    const isMatchedPresentationCurrent = (
      published: RuntimeSnapshot | null,
      matched: MatchedRoute,
    ) => Boolean(
      published &&
      !this.disposed &&
      this.snapshot.routeSource === source &&
      this.snapshot.matched === matched,
    );
    if (!spec) {
      if (source === "current") {
        this.loaderRun += 1;
        this.loaderState = null;
      }
      return Boolean(publishPresentation({
        routeStatus: "idle",
        routeSource: undefined,
        matched: null,
        pageData: null,
      }));
    }
    const match = matchRoute(spec, pathname);
    if (!match) {
      if (source === "current") {
        this.loaderRun += 1;
        this.loaderState = null;
      }
      const published = publishPresentation({
        routeStatus: "unmatched",
        routeSource: source,
        matched: null,
        pageData: null,
        error: null,
      });
      if (
        published &&
        !this.disposed &&
        this.snapshot === published &&
        this.snapshot.location.pathname === rawPathname
      ) {
        this.emitEvent("route_unmatched");
      }
      return Boolean(published);
    }
    const matched = freezeMatchedRoute(match);
    const loaderName = matched.route.loader;
    const loaderKey = JSON.stringify([
      matched.pattern,
      matched.params,
      loaderName ?? null,
    ]);
    const currentRouteHasLoaderKey = () => {
      const current = this.snapshot.current;
      const currentMatched = current
        ? matchRoute(current, toRoutePathname(this.snapshot.location.pathname))
        : null;
      return Boolean(
        currentMatched &&
        JSON.stringify([
          currentMatched.pattern,
          currentMatched.params,
          currentMatched.route.loader ?? null,
        ]) === loaderKey,
      );
    };
    if (!loaderName) {
      const routeEvent = this.routeEvent();
      if (source === "current") {
        this.loaderRun += 1;
        this.loaderState = { key: loaderKey, status: "ready" };
      }
      const published = publishPresentation({
        routeStatus: "ready",
        routeSource: source,
        matched,
        pageData: this.pageData(spec, matched),
        error: null,
      });
      if (isMatchedPresentationCurrent(published, matched)) {
        this.emitEvent("route_matched", routeEvent);
      }
      return Boolean(published);
    }
    const loader = this.options.loaders?.[loaderName];
    if (!loader) {
      const routeEvent = this.routeEvent();
      const loaderToken = this.loaderToken();
      const error = new RuntimeError("loader_missing", "Route loader is not registered", {
        loader: loaderToken,
      });
      if (source === "current") {
        this.loaderRun += 1;
        this.loaderState = { key: loaderKey, status: "error", error };
      }
      const published = publishPresentation({
        routeStatus: "error",
        routeSource: source,
        matched,
        pageData: this.pageData(spec, matched),
        error,
      });
      if (isMatchedPresentationCurrent(published, matched)) {
        this.emitEvent("route_matched", routeEvent);
      }
      return Boolean(published);
    }

    if (!retry && this.loaderState?.key === loaderKey) {
      const routeEvent = this.routeEvent();
      const published = publishPresentation({
        routeStatus: this.loaderState.status,
        routeSource: source,
        matched,
        pageData: this.pageData(spec, matched, this.loaderState.data),
        error: this.loaderState.error ?? null,
      });
      if (isMatchedPresentationCurrent(published, matched)) {
        this.emitEvent("route_matched", routeEvent);
      }
      return Boolean(published);
    }

    if (source === "candidate") {
      const routeEvent = this.routeEvent();
      const published = publishPresentation({
        routeStatus: "loading",
        routeSource: source,
        matched,
        pageData: this.pageData(spec, matched),
        error: null,
      });
      if (isMatchedPresentationCurrent(published, matched)) {
        this.emitEvent("route_matched", routeEvent);
      }
      return Boolean(published);
    }

    const run = ++this.loaderRun;
    const loaderEvent = this.loaderEvent();
    const routeEvent = { pattern: loaderEvent.pattern };
    this.loaderState = { key: loaderKey, status: "loading" };
    const published = publishPresentation({
      routeStatus: "loading",
      routeSource: source,
      matched,
      pageData: this.pageData(spec, matched),
      error: null,
    });
    const mayStartHiddenRetry = options.preservePresentation && !this.disposed;
    if (!mayStartHiddenRetry && !isMatchedPresentationCurrent(published, matched)) {
      return Boolean(published);
    }
    this.emitEvent("route_matched", routeEvent);
    if (this.disposed) return Boolean(published);
    if (
      options.preservePresentation &&
      (run !== this.loaderRun || !currentRouteHasLoaderKey())
    ) {
      return Boolean(published);
    }
    if (
      !options.preservePresentation &&
      (this.snapshot.routeSource !== source || this.snapshot.matched !== matched)
    ) {
      return Boolean(published);
    }
    this.emitEvent("loader_started", loaderEvent);
    void Promise.resolve()
      .then(() => {
        if (run !== this.loaderRun || this.disposed || !currentRouteHasLoaderKey()) {
          this.emitEvent("loader_stale", loaderEvent);
          return LOADER_INVOCATION_SKIPPED;
        }
        return loader(matched.params);
      })
      .then((data) => {
        if (data === LOADER_INVOCATION_SKIPPED) return;
        if (run !== this.loaderRun || this.disposed) {
          this.emitEvent("loader_stale", loaderEvent);
          return;
        }
        const currentSpec = this.snapshot.current;
        const currentMatched = currentSpec
          ? matchRoute(currentSpec, toRoutePathname(this.snapshot.location.pathname))
          : null;
        if (
          !currentSpec ||
          !currentMatched ||
          JSON.stringify([
            currentMatched.pattern,
            currentMatched.params,
            currentMatched.route.loader ?? null,
          ]) !== loaderKey
        ) {
          this.emitEvent("loader_stale", loaderEvent);
          return;
        }
        const ownedData = ownAndDeepFreeze(data);
        const latestCurrentSpec = this.snapshot.current;
        const latestCurrentMatched = latestCurrentSpec
          ? matchRoute(latestCurrentSpec, toRoutePathname(this.snapshot.location.pathname))
          : null;
        if (
          run !== this.loaderRun ||
          this.disposed ||
          !latestCurrentSpec ||
          !latestCurrentMatched ||
          JSON.stringify([
            latestCurrentMatched.pattern,
            latestCurrentMatched.params,
            latestCurrentMatched.route.loader ?? null,
          ]) !== loaderKey
        ) {
          this.emitEvent("loader_stale", loaderEvent);
          return;
        }
        const ownedMatched = freezeMatchedRoute(latestCurrentMatched);
        this.loaderState = { key: loaderKey, status: "ready", data: ownedData };
        if (this.snapshot.routeSource !== "candidate") {
          this.publish({
            ...this.snapshot,
            routeStatus: "ready",
            routeSource: "current",
            matched: ownedMatched,
            pageData: this.pageData(
              latestCurrentSpec,
              ownedMatched,
              ownedData,
            ),
            error: this.snapshot.specStatus === "invalid" ? this.sourceError : null,
          }, () => {
            this.emitEvent("loader_succeeded", loaderEvent);
          });
        } else {
          this.emitEvent("loader_succeeded", loaderEvent);
        }
      })
      .catch((cause: unknown) => {
        if (run !== this.loaderRun || this.disposed || !currentRouteHasLoaderKey()) {
          this.emitEvent("loader_stale", loaderEvent);
          return;
        }
        const notFound = isRouteNotFoundInstance(cause);
        const error = new RuntimeError(
          notFound ? "route_not_found" : "loader_failed",
          notFound ? "Route loader returned not found" : "Route loader failed",
          { loader: loaderEvent.loader, retry },
        );
        const status: RouteStatus = notFound ? "not_found" : "error";
        if (run !== this.loaderRun || this.disposed || !currentRouteHasLoaderKey()) {
          this.emitEvent("loader_stale", loaderEvent);
          return;
        }
        this.loaderState = {
          key: loaderKey,
          status,
          error,
        };
        if (this.snapshot.routeSource !== "candidate") {
          this.publish({ ...this.snapshot, routeStatus: status, error }, () => {
            this.emitEvent("loader_failed", {
              ...loaderEvent,
              code: error.code,
            });
          });
        } else {
          this.emitEvent("loader_failed", {
            ...loaderEvent,
            code: error.code,
          });
        }
      });
    return Boolean(published);
  }

  retryLoader = (): void => {
    if (this.disposed) return;
    this.resolveRoute(this.snapshot.current, "current", {
      retry: true,
      preservePresentation: this.snapshot.routeSource === "candidate",
    });
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.sourceController?.abort();
    this.sourceController = null;
    this.loaderRun += 1;
    this.unsubscribeNavigation();
    this.navigation.dispose();
    for (const listener of this.disposeListeners) {
      try {
        listener();
      } catch {
        // Continue releasing all owned resources.
      }
    }
    this.disposeListeners.clear();
    this.listeners.clear();
  };
}

function snapshotCatalog(catalog: Catalog): Catalog {
  const data = catalog.data as {
    components?: Record<string, Record<string, unknown>>;
    actions?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  const snapshotEntries = (entries: Record<string, Record<string, unknown>> | undefined) =>
    Object.freeze(Object.fromEntries(
      Object.entries(entries ?? {}).map(([name, definition]) => [
        name,
        Object.freeze({ ...definition }),
      ]),
    ));
  return Object.freeze({
    schema: catalog.schema,
    data: Object.freeze({
      ...data,
      components: snapshotEntries(data.components),
      actions: snapshotEntries(data.actions),
    }),
    componentNames: Object.freeze([...catalog.componentNames]),
    actionNames: Object.freeze([...catalog.actionNames]),
    prompt: catalog.prompt,
    jsonSchema: catalog.jsonSchema,
    validate: catalog.validate,
    zodSchema: catalog.zodSchema,
  }) as Catalog;
}

export function createRuntimeWithNavigation(
  options: RuntimeOptions,
  navigation: NavigationDriver,
): NextAppRuntime {
  assertRuntimeLimitConfig(options.limits);
  const normalizedOptions = Object.freeze({
    ...options,
    catalog: snapshotCatalog(options.catalog),
    registry: Object.freeze({ ...options.registry }),
    handlers: options.handlers ? Object.freeze({ ...options.handlers }) : undefined,
    loaders: options.loaders ? Object.freeze({ ...options.loaders }) : undefined,
    limits: Object.freeze({ ...options.limits }),
    fallbacks: Object.freeze({ ...options.fallbacks }),
  });
  const runtime = new RuntimeImplementation(normalizedOptions, navigation);
  INTERNALS.set(runtime, {
    navigation,
    fallbacks: normalizedOptions.fallbacks,
    options: normalizedOptions,
    emitEvent: runtime.emitEvent,
    onDispose: runtime.onDispose,
  });
  runtime.startInitialSource();
  return runtime;
}

export function createNextAppRuntime(options: RuntimeOptions): NextAppRuntime {
  const navigation = createBrowserHistoryDriver();
  try {
    return createRuntimeWithNavigation(options, navigation);
  } catch (error) {
    navigation.dispose();
    throw error;
  }
}

export function getRuntimeInternals(runtime: NextAppRuntime): RuntimeInternals {
  const internals = INTERNALS.get(runtime);
  if (!internals) throw new Error("Unknown NextAppRuntime instance");
  return internals;
}
