import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";

import { createHeadController } from "../metadata/head-controller.js";
import { completeBrowserNavigationScroll } from "../navigation/browser-history.js";
import { resolveMetadata } from "../router/metadata.js";
import { routeIdentity } from "../router/match-route.js";
import { getRuntimeInternals } from "../runtime/create-runtime.js";
import { PageRenderer } from "./page-renderer.js";
import { RuntimeErrorBoundary } from "./error-boundary.js";
import { RuntimeNextAppProvider, useNextAppRuntime } from "./provider.js";
import {
  registerRuntimeActionObserver,
  type RuntimeActionObserverRegistration,
} from "./action-observer-manager.js";
import { RuntimeActionObserverScope } from "./action-observer-scope.js";

const runtimeContentKeys = new WeakMap<object, number>();
let runtimeContentKeySequence = 0;

function runtimeContentKey(runtime: object): number {
  const existing = runtimeContentKeys.get(runtime);
  if (existing !== undefined) return existing;
  runtimeContentKeySequence += 1;
  runtimeContentKeys.set(runtime, runtimeContentKeySequence);
  return runtimeContentKeySequence;
}

function RuntimeContent({
  runtime,
}: {
  runtime: ReturnType<typeof useNextAppRuntime>;
}) {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const internals = getRuntimeInternals(runtime);
  const route = snapshot.matched?.route;
  const fallbackInput = { snapshot, status: snapshot.routeStatus };
  let content: React.ReactNode;
  if (snapshot.routeStatus === "unmatched") {
    content = internals.fallbacks.unmatched(fallbackInput);
  } else if (snapshot.routeStatus === "loading") {
    content = route?.loading
      ? <PageRenderer spec={route.loading} loading />
      : internals.fallbacks.loading(fallbackInput);
  } else if (snapshot.routeStatus === "not_found") {
    content = route?.notFound
      ? <PageRenderer spec={route.notFound} />
      : internals.fallbacks.notFound(fallbackInput);
  } else if (snapshot.routeStatus === "error") {
    content = route?.error
      ? <PageRenderer spec={route.error} />
      : internals.fallbacks.error(fallbackInput);
  } else if (snapshot.routeStatus === "ready" && snapshot.pageData) {
    const key = routeIdentity(
      snapshot.matched?.pattern ?? "",
      snapshot.matched?.params ?? {},
    );
    content = <PageRenderer key={key} {...snapshot.pageData} />;
  } else {
    content = internals.fallbacks.loading(fallbackInput);
  }

  return (
    <RuntimeNextAppProvider
      registry={internals.options.registry}
      handlers={internals.options.handlers}
      actionDispatcher={runtime.getActionDispatcher()}
      navigation={internals.navigation}
    >
      {content}
    </RuntimeNextAppProvider>
  );
}

export function NextAppRenderer() {
  const runtime = useNextAppRuntime();
  const contentKey = runtimeContentKey(runtime);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const internals = getRuntimeInternals(runtime);
  const presentationIdentity = internals.getPresentationIdentity();
  const actionObserverRegistration = useMemo<RuntimeActionObserverRegistration>(() => {
    const actionNames = new Set([
      ...internals.options.catalog.actionNames,
      "navigate",
      "setState",
      "pushState",
      "removeState",
    ]);
    return {
      actionNames,
      onDispatch: (event) => {
        internals.emitEvent("action_dispatched", { at: event.at });
      },
      onSettle: (event) => {
        internals.emitEvent("action_settled", { at: event.at });
      },
    };
  }, [internals]);
  useLayoutEffect(() => {
    completeBrowserNavigationScroll(snapshot.location.href);
  });
  useEffect(() => {
    if (typeof document === "undefined") return;
    const head = createHeadController(document);
    let disposed = false;
    const disposeHead = () => {
      if (disposed) return;
      disposed = true;
      head.dispose();
    };
    const unregister = internals.onDispose(disposeHead);
    const spec = snapshot.routeSource === "candidate"
      ? snapshot.candidate
      : snapshot.current;
    if (!disposed) {
      try {
        head.apply(spec ? resolveMetadata(spec, snapshot.matched?.route ?? null) : {});
        if (spec) internals.emitEvent("metadata_applied");
      } catch {
        internals.emitEvent("metadata_apply_failed", { code: "metadata_apply_failed" });
      }
    }
    return () => {
      unregister();
      disposeHead();
    };
  }, [internals, snapshot.candidate, snapshot.current, snapshot.matched, snapshot.revision, snapshot.routeSource]);
  useEffect(() => {
    if (!internals.options.observer) return;
    const unregisterObserver = registerRuntimeActionObserver(actionObserverRegistration);
    const unregisterDispose = internals.onDispose(unregisterObserver);
    return () => {
      unregisterDispose();
      unregisterObserver();
    };
  }, [actionObserverRegistration, internals]);
  return (
    <RuntimeErrorBoundary
      runtime={runtime}
      presentationIdentity={presentationIdentity}
      fallback={internals.fallbacks.error}
      observer={internals.options.observer
        ? (event) => internals.emitEvent(event.name, event)
        : undefined}
    >
      <RuntimeActionObserverScope
        registration={internals.options.observer ? actionObserverRegistration : null}
      >
        <RuntimeContent key={contentKey} runtime={runtime} />
      </RuntimeActionObserverScope>
    </RuntimeErrorBoundary>
  );
}
