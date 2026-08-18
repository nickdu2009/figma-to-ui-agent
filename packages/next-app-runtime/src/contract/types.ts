import type { Catalog, Spec } from "@json-render/core";
import type { ComponentRegistry } from "@json-render/react";
import type { ReactNode } from "react";

import { deepFreeze, ownAndDeepFreeze } from "./immutable.js";

const RUNTIME_ERROR_INSTANCES = new WeakSet<object>();
const ROUTE_NOT_FOUND_INSTANCES = new WeakSet<object>();

export interface NextMetadata {
  title?:
    | string
    | {
        default: string;
        template?: string;
        absolute?: string;
      };
  description?: string;
  keywords?: string[];
  openGraph?: {
    title?: string;
    description?: string;
    images?: string | string[];
    type?: string;
    url?: string;
    siteName?: string;
    locale?: string;
  };
  twitter?: {
    card?: "summary" | "summary_large_image" | "app" | "player";
    title?: string;
    description?: string;
    images?: string | string[];
    creator?: string;
    site?: string;
  };
  robots?: string | { index?: boolean; follow?: boolean };
  alternates?: { canonical?: string };
  icons?: string | { icon?: string; apple?: string; shortcut?: string };
}

export interface NextRouteSpec {
  page: Spec;
  metadata?: NextMetadata;
  layout?: string;
  loading?: Spec;
  error?: Spec;
  notFound?: Spec;
  loader?: string;
  staticParams?: Record<string, string>[];
}

export interface NextAppSpec {
  metadata?: NextMetadata;
  routes: Record<string, NextRouteSpec>;
  layouts?: Record<string, Spec>;
  state?: Record<string, unknown>;
}

export interface MatchedRoute {
  route: NextRouteSpec;
  pattern: string;
  params: Record<string, string | string[]>;
}

export type LoaderFn = (
  params: Record<string, string | string[]>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface PageData {
  spec: Spec;
  initialState?: Record<string, unknown>;
  layoutSpec?: Spec | null;
}

export interface RuntimeLimits {
  maxBytes: number;
  maxOperations: number;
  maxDepth: number;
  maxRoutes: number;
  maxElementsPerTree: number;
}

export type RuntimeErrorCode =
  | "contract_invalid"
  | "catalog_invalid"
  | "references_invalid"
  | "base_spec_missing"
  | "source_busy"
  | "source_limit_exceeded"
  | "json_parse_failed"
  | "patch_invalid"
  | "patch_test_failed"
  | "reserved_name_conflict"
  | "catalog_registry_mismatch"
  | "layout_missing"
  | "slot_missing"
  | "loader_missing"
  | "loader_failed"
  | "route_not_found"
  | "render_failed"
  | "metadata_apply_failed";

export type SpecStatus =
  | "empty"
  | "streaming"
  | "ready"
  | "invalid"
  | "cancelled";

export type RouteStatus =
  | "idle"
  | "unmatched"
  | "loading"
  | "ready"
  | "not_found"
  | "error";

export interface RuntimeLocation {
  pathname: string;
  search: string;
  hash: string;
  href: string;
}

export interface RuntimeSnapshot {
  current: NextAppSpec | null;
  candidate: NextAppSpec | null;
  specStatus: SpecStatus;
  routeStatus: RouteStatus;
  routeSource?: "current" | "candidate";
  location: RuntimeLocation;
  matched: MatchedRoute | null;
  pageData: PageData | null;
  error: RuntimeError | null;
  revision: number;
}

export type RuntimeEventName =
  | "source_received"
  | "source_validated"
  | "source_committed"
  | "source_rejected"
  | "source_cancelled"
  | "location_changed"
  | "route_matched"
  | "route_unmatched"
  | "loader_started"
  | "loader_succeeded"
  | "loader_failed"
  | "loader_stale"
  | "action_dispatched"
  | "action_settled"
  | "metadata_applied"
  | "metadata_apply_failed"
  | "render_failed";

export interface RuntimeEvent {
  name: RuntimeEventName;
  at: number;
  revision: number;
  code?: RuntimeErrorCode;
  pattern?: string;
  loader?: string;
}

export type RuntimeFallback = (input: {
  snapshot: RuntimeSnapshot;
  status: RouteStatus;
}) => ReactNode;

export interface RuntimeFallbacks {
  loading: RuntimeFallback;
  error: RuntimeFallback;
  notFound: RuntimeFallback;
  unmatched: RuntimeFallback;
}

export interface RuntimeCatalog {
  catalog: Catalog;
  registry: ComponentRegistry;
}

export interface RuntimeOptions {
  initialSource?: NextAppSpecSource;
  catalog: Catalog;
  registry: ComponentRegistry;
  handlers?: Record<
    string,
    (params: Record<string, unknown>) => Promise<unknown> | unknown
  >;
  loaders?: Record<string, LoaderFn>;
  limits: RuntimeLimits;
  fallbacks: RuntimeFallbacks;
  observer?: (event: RuntimeEvent) => void;
}

export type SourceInput =
  | string
  | Uint8Array
  | ReadableStream<string | Uint8Array>
  | AsyncIterable<string | Uint8Array>;

export type NextAppSpecSource =
  | { kind: "object"; value: unknown }
  | { kind: "json"; value: SourceInput }
  | {
      kind: "jsonl-patch";
      value: SourceInput;
      base: "empty" | "current";
    };

export type SourceResult =
  | { status: "committed"; revision: number; spec: NextAppSpec }
  | { status: "rejected"; revision: number; error: RuntimeError }
  | { status: "cancelled"; revision: number };

export interface ApplySourceOptions {
  signal?: AbortSignal;
}

export interface NextAppRuntime {
  applySource(
    source: NextAppSpecSource,
    options?: ApplySourceOptions,
  ): Promise<SourceResult>;
  retryLoader(): void;
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.details = details ? ownAndDeepFreeze(details) : undefined;
    RUNTIME_ERROR_INSTANCES.add(this);
    deepFreeze(this);
  }
}

export function isRuntimeErrorInstance(value: unknown): value is RuntimeError {
  return typeof value === "object" && value !== null && RUNTIME_ERROR_INSTANCES.has(value);
}

export class RouteNotFound extends Error {
  constructor(message = "The route loader did not find a resource") {
    super(message);
    this.name = "RouteNotFound";
    ROUTE_NOT_FOUND_INSTANCES.add(this);
  }
}

export function isRouteNotFoundInstance(value: unknown): value is RouteNotFound {
  return typeof value === "object" && value !== null && ROUTE_NOT_FOUND_INSTANCES.has(value);
}
