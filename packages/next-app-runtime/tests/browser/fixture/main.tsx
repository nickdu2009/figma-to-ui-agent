import React from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import {
  NextAppProvider,
  NextErrorBoundary,
  NextLoading,
  NextNotFound,
  NextAppRenderer,
  NextAppRuntimeProvider,
  createNextAppRuntime,
  type ComponentRenderProps,
  type NextAppSpec,
  type NextAppRuntime,
  type RuntimeEvent,
  type RuntimeFallbacks,
  type RuntimeOptions,
} from "@next-app-runtime/client";
import { schema } from "@next-app-runtime/client/schema";
import { createHeadController } from "../../../src/metadata/head-controller.js";

const catalog = schema.createCatalog({
  components: {
    Box: {
      props: z.object({ id: z.string().optional(), className: z.string().optional() }).strict(),
      slots: ["default"],
      description: "Container",
      example: {},
    },
    Text: {
      props: z.object({ text: z.string(), id: z.string().optional() }).strict(),
      description: "Text",
      example: { text: "Text" },
    },
    Crash: {
      props: z.object({}).strict(),
      description: "Throws during render",
      example: {},
    },
    ActionButton: {
      props: z.object({ label: z.string() }).strict(),
      description: "Emits a press action",
      example: { label: "Action" },
    },
  },
  actions: {},
});

const registry = {
  Box: ({ element, children }: ComponentRenderProps<{ id?: string; className?: string }>) => (
    <div id={element.props.id} className={element.props.className}>{children}</div>
  ),
  Text: ({ element }: ComponentRenderProps<{ text: string; id?: string }>) => (
    <span id={element.props.id}>{element.props.text}</span>
  ),
  Crash: () => { throw new Error("secret render detail"); },
  ActionButton: ({
    element,
    emit,
  }: ComponentRenderProps<{ label: string }>) => (
    <button onClick={() => emit("press")}>{element.props.label}</button>
  ),
};

const page = (name: string, replace = false) => ({
  root: "page",
  elements: {
    page: {
      type: "Box",
      props: { id: `${name.toLowerCase()}-page` },
      children: ["text", "next", "sameHash", "anchor"],
    },
    text: { type: "Text", props: { text: name } },
    next: { type: "Link", props: { href: name === "Home" ? "/about" : "/", replace }, children: ["nextText"] },
    nextText: { type: "Text", props: { text: name === "Home" ? "About" : "Home" } },
    sameHash: { type: "Link", props: { href: "#anchor" }, children: ["hashText"] },
    hashText: { type: "Text", props: { text: "Anchor" } },
    anchor: { type: "Box", props: { id: "anchor" }, children: [] },
  },
});

const spec: NextAppSpec = {
  metadata: {
    title: { default: "Runtime", template: "%s | Runtime" },
    description: "Global description",
  },
  layouts: {
    main: {
      root: "shell",
      elements: {
        shell: { type: "Box", props: { id: "shell" }, children: ["slot"] },
        slot: { type: "Slot", props: {} },
      },
    },
  },
  routes: {
    "/": { page: page("Home"), layout: "main", metadata: { title: "Home" } },
    "/about": { page: page("About", true), layout: "main", metadata: { title: "About", description: "About description" } },
    "/crash": { page: { root: "crash", elements: { crash: { type: "Crash", props: {} } } } },
  },
};

const events: RuntimeEvent[] = [];
const runtimeLimits = {
  maxBytes: 1_000_000,
  maxOperations: 1_000,
  maxDepth: 100,
  maxRoutes: 100,
  maxElementsPerTree: 1_000,
};
const runtimeFallbacks: RuntimeFallbacks = {
  loading: () => <div data-fallback="loading" />,
  error: () => <div data-fallback="error">Safe error</div>,
  notFound: () => <div data-fallback="not-found" />,
  unmatched: ({ snapshot }) => {
    if (snapshot.location.pathname === "/explode") {
      throw new Error("secret fallback detail");
    }
    return <div data-fallback="unmatched">Unmatched</div>;
  },
};
let releaseDelayedLoader: (() => void) | undefined;
const delayedLoader = () => new Promise<Record<string, unknown>>((resolve) => {
  releaseDelayedLoader = () => resolve({ loaded: true });
});
function createFixtureRuntime(
  overrides: Partial<Pick<RuntimeOptions, "initialSource" | "fallbacks" | "observer">> = {},
) {
  return createNextAppRuntime({
    catalog,
    registry,
    loaders: { delayed: delayedLoader },
    limits: runtimeLimits,
    fallbacks: overrides.fallbacks ?? runtimeFallbacks,
    initialSource: overrides.initialSource,
    observer: overrides.observer,
  });
}

const runtime = createFixtureRuntime({
  initialSource: { kind: "object", value: spec },
  observer: (event) => events.push(event),
});

function mountRuntimeView(initialRuntime: NextAppRuntime, strict = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (nextRuntime: NextAppRuntime, nextStrict = strict) => {
    const renderer = (
      <NextAppRuntimeProvider runtime={nextRuntime}>
        <NextAppRenderer />
      </NextAppRuntimeProvider>
    );
    root.render(nextStrict ? <React.StrictMode>{renderer}</React.StrictMode> : renderer);
  };
  render(initialRuntime);
  return {
    host,
    render,
    dispose() {
      root.unmount();
      host.remove();
    },
  };
}

function mountEmptyRuntime() {
  const emptyRuntime = createFixtureRuntime();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <NextAppRuntimeProvider runtime={emptyRuntime}>
      <NextAppRenderer />
    </NextAppRuntimeProvider>,
  );
  return {
    runtime: emptyRuntime,
    dispose() {
      root.unmount();
      emptyRuntime.dispose();
      host.remove();
    },
  };
}

Object.assign(window, {
  runtime,
  runtimeEvents: events,
  releaseDelayedLoader: () => releaseDelayedLoader?.(),
  createHeadController,
  createFixtureRuntime,
  mountRuntimeView,
  mountEmptyRuntime,
});

createRoot(document.getElementById("root")!).render(
  <NextAppRuntimeProvider runtime={runtime}>
    <NextAppRenderer />
  </NextAppRuntimeProvider>,
);

if (new URLSearchParams(window.location.search).has("compat")) {
  createRoot(document.getElementById("compat-root")!).render(
    <NextAppProvider registry={registry}>
      <NextLoading />
      <NextNotFound />
      <NextErrorBoundary
        error={new Error("official error detail")}
        reset={() => Object.assign(window, { compatibilityReset: true })}
      />
    </NextAppProvider>,
  );
}
