import { expect, test } from "@playwright/test";

test("History navigation, Link, metadata and layout work in Chromium", async ({ page }) => {
  await page.goto("/");
  const initialHistoryLength = await page.evaluate(() => history.length);
  await expect(page.locator("#home-page")).toContainText("Home");
  await expect(page.locator("#shell")).toBeVisible();
  await expect(page).toHaveTitle("Home | Runtime");
  await expect(page.locator('meta[name="host-marker"]')).toHaveAttribute("content", "preserve");
  await expect(page.locator('meta[name="description"][data-owner="next-app-runtime"]'))
    .toHaveAttribute("content", "Global description");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/u);
  await expect(page.locator("#about-page")).toContainText("About");
  await expect(page).toHaveTitle("About | Runtime");
  await expect(page.locator('meta[name="description"][data-owner="next-app-runtime"]'))
    .toHaveAttribute("content", "About description");

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL(/\/$/u);
  expect(await page.evaluate(() => history.length)).toBe(initialHistoryLength + 1);

  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator("#home-page")).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/$/u);
  await page.reload();
  await expect(page.locator("#home-page")).toBeVisible();

  await page.locator("#anchor").evaluate((element) => {
    document.body.style.minHeight = "3000px";
    element.setAttribute("style", "position:absolute;top:2000px;height:1px;width:1px");
  });
  await page.getByRole("link", { name: "Anchor" }).click();
  await expect(page).toHaveURL(/#anchor$/u);
  await expect(page.locator("#home-page")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {
    runtime: { getSnapshot(): { location: { hash: string } } };
  }).runtime.getSnapshot().location.hash)).toBe("#anchor");
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("cross-route hash navigation scrolls after the destination route commits", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-page").waitFor();
  await page.evaluate(async () => {
    const runtime = (window as unknown as {
      runtime: {
        getSnapshot(): { current: unknown };
        applySource(source: { kind: "object"; value: unknown }): Promise<{ status: string }>;
      };
    }).runtime;
    const spec = structuredClone(runtime.getSnapshot().current) as {
      routes: Record<string, { page: { elements: Record<string, { props: Record<string, unknown> }> } }>;
    };
    spec.routes["/"]!.page.elements.next!.props.href = "/about#destination";
    spec.routes["/about"]!.page.elements.anchor!.props.id = "destination";
    const result = await runtime.applySource({ kind: "object", value: spec });
    if (result.status !== "committed") throw new Error("fixture source was rejected");
    const style = document.createElement("style");
    style.textContent = "body{min-height:3000px}#destination{position:absolute;top:2000px;height:1px;width:1px}";
    document.head.append(style);
    window.scrollTo(0, 0);
  });

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about#destination$/u);
  await expect(page.locator("#about-page")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("cross-route hash waits for a loader-backed destination to commit", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-page").waitFor();
  await page.evaluate(async () => {
    const runtime = (window as unknown as {
      runtime: {
        getSnapshot(): { current: unknown };
        applySource(source: { kind: "object"; value: unknown }): Promise<{ status: string }>;
      };
    }).runtime;
    const spec = structuredClone(runtime.getSnapshot().current) as {
      routes: Record<string, {
        loader?: string;
        page: { elements: Record<string, { props: Record<string, unknown> }> };
      }>;
    };
    spec.routes["/"]!.page.elements.next!.props.href = "/about#destination";
    spec.routes["/about"]!.loader = "delayed";
    spec.routes["/about"]!.page.elements.anchor!.props.id = "destination";
    const result = await runtime.applySource({ kind: "object", value: spec });
    if (result.status !== "committed") throw new Error("fixture source was rejected");
    const style = document.createElement("style");
    style.textContent = "body{min-height:3000px}#destination{position:absolute;top:2000px;height:1px;width:1px}";
    document.head.append(style);
    window.scrollTo(0, 0);
  });

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about#destination$/u);
  await expect(page.locator('[data-fallback="loading"]')).toBeAttached();
  expect(await page.evaluate(() => (window as unknown as {
    runtime: { getSnapshot(): { routeStatus: string } };
  }).runtime.getSnapshot().routeStatus)).toBe("loading");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.evaluate(() => (window as unknown as {
    releaseDelayedLoader(): void;
  }).releaseDelayedLoader());
  await expect(page.locator("#about-page")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("malformed percent hash navigation does not throw after committing History", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`));
  await page.goto("/");
  await page.locator("#home-page").waitFor();
  await page.evaluate(async () => {
    const runtime = (window as unknown as {
      runtime: {
        getSnapshot(): { current: unknown };
        applySource(source: { kind: "object"; value: unknown }): Promise<{ status: string }>;
      };
    }).runtime;
    const spec = structuredClone(runtime.getSnapshot().current) as {
      routes: Record<string, { page: { elements: Record<string, { props: Record<string, unknown> }> } }>;
    };
    spec.routes["/"]!.page.elements.next!.props.href = "/about#%";
    const result = await runtime.applySource({ kind: "object", value: spec });
    if (result.status !== "committed") throw new Error("fixture source was rejected");
  });

  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about#%$/u);
  await expect(page.locator("#about-page")).toBeVisible();
  await page.waitForTimeout(50);
  expect(pageErrors).toEqual([]);
});

test("same-page hash honors Link replace without adding a history entry", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-page").waitFor();
  await page.evaluate(async () => {
    const runtime = (window as unknown as {
      runtime: {
        getSnapshot(): { current: unknown };
        applySource(source: { kind: "object"; value: unknown }): Promise<{ status: string }>;
      };
    }).runtime;
    const spec = structuredClone(runtime.getSnapshot().current) as {
      routes: Record<string, { page: { elements: Record<string, { props: Record<string, unknown> }> } }>;
    };
    spec.routes["/"]!.page.elements.sameHash!.props.replace = true;
    const result = await runtime.applySource({ kind: "object", value: spec });
    if (result.status !== "committed") throw new Error("fixture source was rejected");
    document.body.style.minHeight = "3000px";
    const anchor = document.getElementById("anchor");
    if (!anchor) throw new Error("fixture anchor is missing");
    anchor.setAttribute("style", "position:absolute;top:2000px;height:1px;width:1px");
    window.scrollTo(0, 0);
  });
  const before = await page.evaluate(() => history.length);

  await page.getByRole("link", { name: "Anchor" }).click();

  await expect(page).toHaveURL(/#anchor$/u);
  expect(await page.evaluate(() => history.length)).toBe(before);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("Link leaves modified, target, download, external and non-primary clicks native", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "About" });

  async function wasPrevented(
    configure: { href?: string; target?: string; download?: boolean; ctrlKey?: boolean; button?: number },
  ) {
    return link.evaluate((element, options) => {
      const anchor = element as HTMLAnchorElement;
      anchor.href = options.href ?? "/about";
      anchor.target = options.target ?? "";
      if (options.download) anchor.setAttribute("download", "fixture.txt");
      else anchor.removeAttribute("download");
      let prevented = false;
      const observe = (event: MouseEvent) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      };
      window.addEventListener("click", observe, { once: true });
      anchor.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: options.button ?? 0,
        ctrlKey: options.ctrlKey ?? false,
      }));
      return prevented;
    }, configure);
  }

  expect(await wasPrevented({ ctrlKey: true })).toBe(false);
  expect(await wasPrevented({ target: "_blank" })).toBe(false);
  expect(await wasPrevented({ download: true })).toBe(false);
  expect(await wasPrevented({ href: "https://example.invalid/" })).toBe(false);
  expect(await wasPrevented({ href: "mailto:team@example.test" })).toBe(false);
  const blobUrl = await page.evaluate(() => URL.createObjectURL(new Blob(["safe"])));
  expect(await wasPrevented({ href: blobUrl })).toBe(false);
  await page.evaluate((href) => URL.revokeObjectURL(href), blobUrl);
  expect(await wasPrevented({ button: 1 })).toBe(false);
  await expect(page).toHaveURL(/\/$/u);
});

test("navigate action assigns safe non-HTTP targets instead of rewriting History", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const host = window as unknown as {
      runtime: {
        getSnapshot(): { current: unknown };
        applySource(source: { kind: "object"; value: unknown }): Promise<unknown>;
      };
    };
    const blobUrl = URL.createObjectURL(new Blob(["Blob destination"], { type: "text/plain" }));
    const spec = structuredClone(host.runtime.getSnapshot().current) as {
      routes: Record<string, { page: { elements: Record<string, unknown> } }>;
    };
    const elements = spec.routes["/"]!.page.elements;
    (elements.page as { children: string[] }).children.push("blobAction");
    elements.blobAction = {
      type: "ActionButton",
      props: { label: "Blob Action" },
      on: { press: { action: "navigate", params: { href: blobUrl } } },
    };
    await host.runtime.applySource({ kind: "object", value: spec });
  });

  await page.getByRole("button", { name: "Blob Action" }).click();

  await expect.poll(() => page.url().startsWith("blob:")).toBe(true);
  await expect(page.locator("body")).toContainText("Blob destination");
});

test("dangerous Link and navigate action targets are inert after URL normalization", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const host = window as unknown as {
      runtime: {
        getSnapshot(): { current: Record<string, unknown> };
        applySource(source: { kind: "object"; value: unknown }): Promise<unknown>;
      };
    };
    Object.assign(window, {
      __unsafeLinkExecuted: false,
      __unsafeActionExecuted: false,
    });
    const spec = structuredClone(host.runtime.getSnapshot().current) as {
      routes: Record<string, { page: { elements: Record<string, unknown> } }>;
    };
    const elements = spec.routes["/"]!.page.elements;
    (elements.page as { children: string[] }).children.push("unsafeLink", "unsafeAction");
    elements.unsafeLink = {
      type: "Link",
      props: { href: "JaVaScRiPt:window.__unsafeLinkExecuted = true" },
      children: ["unsafeText"],
    };
    elements.unsafeText = { type: "Text", props: { text: "Unsafe Link" } };
    elements.unsafeAction = {
      type: "ActionButton",
      props: { label: "Unsafe Action" },
      on: {
        press: {
          action: "navigate",
          params: { href: "javascript:window.__unsafeActionExecuted = true" },
        },
      },
    };
    await host.runtime.applySource({ kind: "object", value: spec });
  });

  await page.getByRole("link", { name: "Unsafe Link" }).dispatchEvent("click");
  await page.getByRole("button", { name: "Unsafe Action" }).click();

  await expect(page).toHaveURL(/\/$/u);
  expect(await page.evaluate(() => ({
    link: (window as unknown as { __unsafeLinkExecuted: boolean }).__unsafeLinkExecuted,
    action: (window as unknown as { __unsafeActionExecuted: boolean }).__unsafeActionExecuted,
  }))).toEqual({ link: false, action: false });
});

test("runtime observer receives scoped action lifecycle events", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const host = window as unknown as {
      runtime: {
        getSnapshot(): { current: Record<string, unknown> };
        applySource(source: { kind: "object"; value: unknown }): Promise<unknown>;
      };
    };
    const spec = structuredClone(host.runtime.getSnapshot().current) as {
      routes: Record<string, { page: { elements: Record<string, unknown> } }>;
    };
    const elements = spec.routes["/"]!.page.elements;
    (elements.page as { children: string[] }).children.push("observedAction");
    elements.observedAction = {
      type: "ActionButton",
      props: { label: "Observed Action" },
      on: {
        press: {
          action: "setState",
          params: { statePath: "/actionRan", value: true },
        },
      },
    };
    await host.runtime.applySource({ kind: "object", value: spec });
  });

  await page.getByRole("button", { name: "Observed Action" }).click();
  await expect.poll(() => page.evaluate(() => {
    const events = (window as unknown as {
      runtimeEvents: Array<{ name: string }>;
    }).runtimeEvents;
    return events.filter((event) => (
      event.name === "action_dispatched" || event.name === "action_settled"
    )).map((event) => event.name);
  })).toEqual(["action_dispatched", "action_settled"]);
});

test("unmatched and boundary failures use host fallbacks without leaking errors", async ({ page }) => {
  await page.goto("/missing");
  await expect(page.locator('[data-fallback="unmatched"]')).toBeVisible();

  await page.goto("/explode");
  await expect(page.locator('[data-fallback="error"]')).toHaveText("Safe error");
  await expect(page.locator("body")).not.toContainText("secret fallback detail");
  const names = await page.evaluate(() => (
    (window as unknown as { runtimeEvents: Array<{ name: string }> }).runtimeEvents.map((event) => event.name)
  ));
  expect(names).toContain("render_failed");

  await page.goto("/crash");
  await expect(page.locator("body")).not.toContainText("secret render detail");
});

test("applies standard Open Graph and Twitter field names", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const host = window as unknown as {
      runtime: {
        getSnapshot(): { current: Record<string, unknown> };
        applySource(source: { kind: "object"; value: unknown }): Promise<unknown>;
      };
    };
    const spec = structuredClone(host.runtime.getSnapshot().current);
    spec.metadata = {
      openGraph: {
        images: ["https://assets.invalid/open-graph.png"],
        siteName: "Runtime",
      },
      twitter: { images: "https://assets.invalid/twitter.png" },
    };
    await host.runtime.applySource({ kind: "object", value: spec });
  });

  await expect(page.locator('meta[property="og:image"]'))
    .toHaveAttribute("content", "https://assets.invalid/open-graph.png");
  await expect(page.locator('meta[property="og:site_name"]'))
    .toHaveAttribute("content", "Runtime");
  await expect(page.locator('meta[name="twitter:image"]'))
    .toHaveAttribute("content", "https://assets.invalid/twitter.png");
  await expect(page.locator('meta[property="og:images"]')).toHaveCount(0);
});

test("candidate presentation owns metadata and a rejected candidate restores current metadata", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Home | Runtime");

  await page.evaluate(() => {
    const host = window as unknown as {
      runtime: {
        applySource(source: {
          kind: "jsonl-patch";
          base: "empty";
          value: AsyncIterable<string>;
        }): Promise<unknown>;
      };
      releaseCandidate?: () => void;
      pendingCandidate?: Promise<unknown>;
    };
    let releaseCandidate!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseCandidate = resolve; });
    async function* candidateSource() {
      yield '{"op":"add","path":"/routes","value":{"/":{"page":{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Candidate"}}}},"metadata":{"title":"Candidate route"}}}}\n' +
        '{"op":"add","path":"/metadata","value":{"title":{"default":"Candidate","template":"%s | Candidate"}}}\n';
      await blocked;
      yield '{"op":"add","path":"/extra","value":true}\n';
    }
    host.releaseCandidate = releaseCandidate;
    host.pendingCandidate = host.runtime.applySource({
      kind: "jsonl-patch",
      base: "empty",
      value: candidateSource(),
    });
  });

  await expect(page.getByText("Candidate", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Candidate route | Candidate");
  await page.evaluate(async () => {
    const host = window as unknown as {
      releaseCandidate?: () => void;
      pendingCandidate?: Promise<unknown>;
    };
    host.releaseCandidate?.();
    await host.pendingCandidate;
  });
  await expect(page.locator("#home-page")).toContainText("Home");
  await expect(page).toHaveTitle("Home | Runtime");
});

test("rejected base-empty candidate clears metadata when no current spec exists", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const host = window as unknown as {
      runtime: { dispose(): void };
      mountEmptyRuntime(): {
        runtime: {
          applySource(source: {
            kind: "jsonl-patch";
            base: "empty";
            value: AsyncIterable<string>;
          }): Promise<unknown>;
        };
        dispose(): void;
      };
      emptyCandidate?: {
        release(): void;
        pending: Promise<unknown>;
        dispose(): void;
      };
    };
    host.runtime.dispose();
    document.title = "Empty host";
    const mounted = host.mountEmptyRuntime();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    async function* candidateSource() {
      yield '{"op":"add","path":"/routes","value":{"/":{"page":{"root":"root","elements":{"root":{"type":"Text","props":{"text":"Empty candidate"}}}},"metadata":{"title":"Candidate only"}}}}\n';
      await blocked;
      yield '{"op":"add","path":"/extra","value":true}\n';
    }
    host.emptyCandidate = {
      release,
      pending: mounted.runtime.applySource({
        kind: "jsonl-patch",
        base: "empty",
        value: candidateSource(),
      }),
      dispose: mounted.dispose,
    };
  });

  await expect(page.getByText("Empty candidate", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Candidate only");
  await page.evaluate(async () => {
    const candidate = (window as unknown as {
      emptyCandidate?: { release(): void; pending: Promise<unknown> };
    }).emptyCandidate;
    candidate?.release();
    await candidate?.pending;
  });
  await expect(page).toHaveTitle("Empty host");
  await expect(page.locator('[data-owner="next-app-runtime"]')).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { emptyCandidate?: { dispose(): void } })
      .emptyCandidate?.dispose();
  });
});

test("head controllers isolate metadata ownership across runtime instances", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as unknown as { runtime: { dispose(): void } }).runtime.dispose();
    const create = (window as unknown as {
      createHeadController: (document: Document) => {
        apply(metadata: { title?: string; description?: string }): void;
        dispose(): void;
      };
    }).createHeadController;
    const first = create(document);
    const second = create(document);
    first.apply({ title: "First runtime", description: "First description" });
    second.apply({ title: "Second runtime", description: "Second description" });
    Object.assign(window, { firstHead: first, secondHead: second });
  });

  await expect(page.locator('meta[name="description"][data-owner="next-app-runtime"]'))
    .toHaveCount(2);
  await expect(page.locator('meta[name="description"][content="First description"]'))
    .toHaveCount(1);
  await expect(page.locator('meta[name="description"][content="Second description"]'))
    .toHaveCount(1);
  await page.evaluate(() => (
    window as unknown as { firstHead: { dispose(): void } }
  ).firstHead.dispose());
  await expect(page.locator('meta[name="description"][content="First description"]'))
    .toHaveCount(0);
  await expect(page.locator('meta[name="description"][content="Second description"]'))
    .toHaveCount(1);
  await expect(page).toHaveTitle("Second runtime");
  await page.evaluate(() => {
    document.title = "Concurrent host title";
    (window as unknown as { secondHead: { dispose(): void } }).secondHead.dispose();
  });
  await expect(page).toHaveTitle("Concurrent host title");
  await expect(page.locator('meta[name="description"][content="Second description"]'))
    .toHaveCount(0);
});

test("disposing an unrelated head controller does not reclaim an externally overridden title", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    (window as unknown as { runtime: { dispose(): void } }).runtime.dispose();
    document.title = "Three-controller host";
    const create = (window as unknown as {
      createHeadController: (document: Document) => {
        apply(metadata: { title?: string }): void;
        dispose(): void;
      };
    }).createHeadController;
    const first = create(document);
    const second = create(document);
    const unrelated = create(document);
    first.apply({ title: "First runtime" });
    second.apply({ title: "Second runtime" });

    document.title = "First runtime";
    second.dispose();
    const afterActiveDispose = document.title;
    unrelated.dispose();
    first.dispose();
    return { afterActiveDispose, afterAllDispose: document.title };
  });

  expect(result).toEqual({
    afterActiveDispose: "First runtime",
    afterAllDispose: "First runtime",
  });
  await expect(page).toHaveTitle("First runtime");
});

test("a new head owner restores the latest host override instead of an obsolete managed title", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(() => {
    (window as unknown as { runtime: { dispose(): void } }).runtime.dispose();
    document.title = "Original host";
    const create = (window as unknown as {
      createHeadController: (document: Document) => {
        apply(metadata: { title?: string }): void;
        dispose(): void;
      };
    }).createHeadController;
    const first = create(document);
    const next = create(document);
    first.apply({ title: "First runtime" });
    document.title = "Latest host";
    next.apply({ title: "Next runtime" });
    const afterNextApply = document.title;
    next.dispose();
    const afterNextDispose = document.title;
    first.dispose();
    const afterAllDispose = document.title;

    const clearing = create(document);
    clearing.apply({ title: "Cleared runtime" });
    document.title = "Host before clear";
    clearing.apply({});
    const afterActiveClear = document.title;
    clearing.dispose();
    return {
      afterNextApply,
      afterNextDispose,
      afterAllDispose,
      afterActiveClear,
      afterClearDispose: document.title,
    };
  });

  expect(result).toEqual({
    afterNextApply: "Next runtime",
    afterNextDispose: "Latest host",
    afterAllDispose: "Latest host",
    afterActiveClear: "Host before clear",
    afterClearDispose: "Host before clear",
  });
  await expect(page).toHaveTitle("Host before clear");
});

test("runtime dispose releases mounted metadata ownership", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Home | Runtime");
  await page.evaluate(() => (
    window as unknown as { runtime: { dispose(): void } }
  ).runtime.dispose());

  await expect(page).toHaveTitle("Host title");
  await expect(page.locator('[data-owner="next-app-runtime"]')).toHaveCount(0);
});

test("StrictMode replay and runtime switching keep metadata controllers live", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const host = window as unknown as {
      runtime: { dispose(): void; getSnapshot(): { current: unknown } };
      createFixtureRuntime(options?: Record<string, unknown>): {
        applySource(source: { kind: "object"; value: unknown }): Promise<unknown>;
        dispose(): void;
      };
      mountRuntimeView(runtime: unknown, strict?: boolean): {
        render(runtime: unknown, strict?: boolean): void;
        dispose(): void;
      };
    };
    host.runtime.dispose();
    document.title = "Lifecycle host";
    const first = host.createFixtureRuntime();
    const second = host.createFixtureRuntime();
    const firstSpec = structuredClone(host.runtime.getSnapshot().current) as {
      metadata?: unknown;
      routes: Record<string, { metadata?: unknown }>;
    };
    const secondSpec = structuredClone(host.runtime.getSnapshot().current) as {
      metadata?: unknown;
      routes: Record<string, { metadata?: unknown }>;
    };
    firstSpec.metadata = { title: "Strict first" };
    secondSpec.metadata = { title: "Strict second" };
    firstSpec.routes["/"]!.metadata = { title: "Strict first" };
    secondSpec.routes["/"]!.metadata = { title: "Strict second" };
    await first.applySource({ kind: "object", value: firstSpec });
    await second.applySource({ kind: "object", value: secondSpec });
    const view = host.mountRuntimeView(first, true);
    Object.assign(window, { lifecycleFirst: first, lifecycleSecond: second, lifecycleView: view });
  });

  await expect(page).toHaveTitle("Strict first");
  await page.evaluate(() => {
    const host = window as unknown as {
      lifecycleSecond: unknown;
      lifecycleView: { render(runtime: unknown, strict?: boolean): void };
    };
    host.lifecycleView.render(host.lifecycleSecond, true);
  });
  await expect(page).toHaveTitle("Strict second");
  await page.evaluate(() => {
    const host = window as unknown as {
      lifecycleFirst: { dispose(): void };
      lifecycleSecond: { dispose(): void };
      lifecycleView: { dispose(): void };
    };
    host.lifecycleView.dispose();
    host.lifecycleFirst.dispose();
    host.lifecycleSecond.dispose();
  });
});

test("error boundary resets when the provider switches equal-revision runtimes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const host = window as unknown as {
      runtime: { dispose(): void; getSnapshot(): { current: unknown } };
      createFixtureRuntime(options?: Record<string, unknown>): {
        applySource(source: { kind: "object"; value: unknown }): Promise<unknown>;
        getSnapshot(): { revision: number };
        dispose(): void;
      };
      mountRuntimeView(runtime: unknown): {
        render(runtime: unknown): void;
        dispose(): void;
      };
    };
    host.runtime.dispose();
    const first = host.createFixtureRuntime({
      fallbacks: {
        loading: () => null,
        error: () => "First error",
        notFound: () => null,
        unmatched: () => { throw new Error("first crash"); },
      },
    });
    const second = host.createFixtureRuntime({
      fallbacks: {
        loading: () => null,
        error: () => "Second error",
        notFound: () => null,
        unmatched: () => "Second unmatched",
      },
    });
    const base = structuredClone(host.runtime.getSnapshot().current) as {
      routes: Record<string, unknown>;
    };
    base.routes = { "/known": Object.values(base.routes)[0]! };
    await first.applySource({ kind: "object", value: base });
    await second.applySource({ kind: "object", value: base });
    if (first.getSnapshot().revision !== second.getSnapshot().revision) {
      throw new Error("fixture revisions differ");
    }
    const view = host.mountRuntimeView(first);
    Object.assign(window, { boundaryFirst: first, boundarySecond: second, boundaryView: view });
  });

  await expect(page.getByText("First error", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const host = window as unknown as {
      boundarySecond: unknown;
      boundaryView: { render(runtime: unknown): void };
    };
    host.boundaryView.render(host.boundarySecond);
  });
  await expect(page.getByText("Second unmatched", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const host = window as unknown as {
      boundaryFirst: { dispose(): void };
      boundarySecond: { dispose(): void };
      boundaryView: { dispose(): void };
    };
    host.boundaryView.dispose();
    host.boundaryFirst.dispose();
    host.boundarySecond.dispose();
  });
});

test("mounted Link cannot navigate after its runtime is disposed", async ({ page }) => {
  await page.goto("/");
  await page.locator("#home-page").waitFor();
  await page.evaluate(() => (
    window as unknown as { runtime: { dispose(): void } }
  ).runtime.dispose());

  await page.getByRole("link", { name: "About" }).click();

  await expect(page).toHaveURL(/\/$/u);
  await expect(page.locator("#home-page")).toBeVisible();
});

test("compatibility components preserve the official 0.19.0 defaults", async ({ page }) => {
  await page.goto("/?compat=1");

  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByText("Something went wrong")).toBeVisible();
  await expect(page.getByText("official error detail")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  expect(await page.evaluate(() => (
    window as unknown as { compatibilityReset?: boolean }
  ).compatibilityReset)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector("#compat-root style")?.textContent,
      ),
    )
    .toContain("@keyframes jr-spin");
});
