import { describe, expect, expectTypeOf, it } from "vitest";

import * as publicApi from "../../src/index.js";
import { schema } from "../../src/schema.js";
import type {
  ApplySourceOptions,
  LoaderFn,
  NextAppRuntime,
  NextAppSpec,
  NextAppSpecSource,
  RouteStatus,
  RuntimeErrorCode,
  RuntimeEvent,
  RuntimeEventName,
  RuntimeFallbacks,
  RuntimeLimits,
  RuntimeOptions,
  RuntimeSnapshot,
  SourceResult,
  SpecStatus,
} from "../../src/index.js";

type ExpectedRuntimeErrorCode =
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

type ExpectedRuntimeEventName =
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

type ExpectedSourceInput =
  | string
  | Uint8Array
  | ReadableStream<string | Uint8Array>
  | AsyncIterable<string | Uint8Array>;

describe("public type contract", () => {
  it("keeps the frozen runtime values and excludes server exports", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "Link",
      "NextAppProvider",
      "NextAppRenderer",
      "NextAppRuntimeProvider",
      "NextErrorBoundary",
      "NextLoading",
      "NextNotFound",
      "PageRenderer",
      "RouteNotFound",
      "RuntimeError",
      "createNextAppRuntime",
      "createStateStore",
      "useNextApp",
      "useNextAppRuntime",
    ]);
    expect(publicApi).not.toHaveProperty("createNextApp");
  });

  it("keeps the frozen unions, options, callbacks and runtime methods", () => {
    expectTypeOf<LoaderFn>().parameter(0).toEqualTypeOf<Record<string, string | string[]>>();
    expectTypeOf<NextAppSpec>().toHaveProperty("routes");
    expectTypeOf<RuntimeErrorCode>().toEqualTypeOf<ExpectedRuntimeErrorCode>();
    expectTypeOf<RuntimeEventName>().toEqualTypeOf<ExpectedRuntimeEventName>();
    expectTypeOf<SpecStatus>().toEqualTypeOf<
      "empty" | "streaming" | "ready" | "invalid" | "cancelled"
    >();
    expectTypeOf<RouteStatus>().toEqualTypeOf<
      "idle" | "unmatched" | "loading" | "ready" | "not_found" | "error"
    >();
    expectTypeOf<NextAppSpecSource>().toEqualTypeOf<
      | { kind: "object"; value: unknown }
      | { kind: "json"; value: ExpectedSourceInput }
      | {
          kind: "jsonl-patch";
          value: ExpectedSourceInput;
          base: "empty" | "current";
        }
    >();
    expectTypeOf<SourceResult>().toEqualTypeOf<
      | { status: "committed"; revision: number; spec: NextAppSpec }
      | { status: "rejected"; revision: number; error: import("../../src/index.js").RuntimeError }
      | { status: "cancelled"; revision: number }
    >();
    expectTypeOf<RuntimeLimits>().toEqualTypeOf<{
      maxBytes: number;
      maxOperations: number;
      maxDepth: number;
      maxRoutes: number;
      maxElementsPerTree: number;
    }>();
    expectTypeOf<RuntimeOptions>().toHaveProperty("initialSource");
    expectTypeOf<RuntimeOptions>().toHaveProperty("catalog");
    expectTypeOf<RuntimeOptions>().toHaveProperty("registry");
    expectTypeOf<RuntimeOptions>().toHaveProperty("handlers");
    expectTypeOf<RuntimeOptions>().toHaveProperty("loaders");
    expectTypeOf<RuntimeOptions>().toHaveProperty("limits");
    expectTypeOf<RuntimeOptions>().toHaveProperty("fallbacks");
    expectTypeOf<RuntimeOptions>().toHaveProperty("observer");
    expectTypeOf<RuntimeFallbacks["loading"]>().parameter(0).toEqualTypeOf<{
      snapshot: RuntimeSnapshot;
      status: RouteStatus;
    }>();
    expectTypeOf<NonNullable<RuntimeOptions["observer"]>>()
      .parameter(0).toEqualTypeOf<RuntimeEvent>();
    expectTypeOf<NextAppRuntime["applySource"]>().parameters.toEqualTypeOf<
      [source: NextAppSpecSource, options?: ApplySourceOptions]
    >();
    expectTypeOf<keyof NextAppRuntime>().toEqualTypeOf<
      "applySource" | "retryLoader" | "getSnapshot" | "subscribe" | "dispose"
    >();
  });

  it("publishes the upstream 0.19.0 built-in action parameter descriptions", () => {
    expect(schema.builtInActions).toEqual([
      {
        name: "setState",
        description:
          "Update a value in the state model at the given statePath. Params: { statePath: string, value: any }",
      },
      {
        name: "pushState",
        description:
          'Append an item to an array in state. Params: { statePath: string, value: any, clearStatePath?: string }. Value can contain {"$state":"/path"} refs and "$id" for auto IDs.',
      },
      {
        name: "removeState",
        description:
          "Remove an item from an array in state by index. Params: { statePath: string, index: number }",
      },
      {
        name: "navigate",
        description:
          "Navigate to a route within the app. Params: { href: string }",
      },
    ]);
  });
});
