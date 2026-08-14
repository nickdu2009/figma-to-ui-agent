import { describe, expect, it } from "vitest";

import type { NextAppSpec } from "../../src/contract/types.js";
import { resolveMetadata } from "../../src/router/metadata.js";
import { matchRoute, routeIdentity, slugToPath } from "../../src/router/match-route.js";
import { collectStaticParams } from "../../src/router/static-params.js";

const page = { root: "x", elements: { x: { type: "Text", props: { text: "x" } } } };

describe("0.19.0 router characterization", () => {
  const spec: NextAppSpec = {
    routes: {
      "/docs/[...path]": { page },
      "/blog/[slug]": { page, staticParams: [{ slug: "first" }] },
      "/settings/[[...path]]": { page, staticParams: [{ path: "a/b" }, {}] },
      "/about": { page },
      "/": { page },
    },
  };

  it.each([
    ["", "/", {}],
    ["/about", "/about", {}],
    ["/blog/post", "/blog/[slug]", { slug: "post" }],
    ["/docs/a/b", "/docs/[...path]", { path: ["a", "b"] }],
    ["/settings", "/settings/[[...path]]", { path: [] }],
  ])("matches %s using upstream ordering", (pathname, pattern, params) => {
    const match = matchRoute(spec, pathname);
    expect(match?.pattern).toBe(pattern);
    expect(match?.params).toEqual(params);
  });

  it("does not repair trailing slashes or strip query/hash", () => {
    expect(matchRoute(spec, "/about/")).toBeNull();
    expect(matchRoute(spec, "/about?x=1")).toBeNull();
    expect(matchRoute(spec, "/about#x")).toBeNull();
  });

  it("keeps stable insertion order for equally specific patterns", () => {
    const ambiguous: NextAppSpec = {
      routes: {
        "/[first]": { page },
        "/[second]": { page },
      },
    };
    expect(matchRoute(ambiguous, "/x")?.pattern).toBe("/[first]");
  });

  it.each([
    ["/item/[__proto__]", "/item/one", "one"],
    ["/docs/[...__proto__]", "/docs/one/two", ["one", "two"]],
    ["/settings/[[...__proto__]]", "/settings", []],
  ])("preserves %s as an own route parameter", (pattern, pathname, expected) => {
    const reserved: NextAppSpec = {
      routes: { [pattern]: { page } },
    };

    const params = matchRoute(reserved, pathname)?.params;
    expect(params).toBeDefined();
    expect(Object.getPrototypeOf(params)).toBeNull();
    expect(Object.hasOwn(params!, "__proto__")).toBe(true);
    expect(params?.["__proto__"]).toEqual(expected);
  });

  it.each([
    ["Object", Object.prototype],
    ["Array", Array.prototype],
  ])("keeps route identities distinct when %s.prototype defines toJSON", (_name, prototype) => {
    const previous = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    Object.defineProperty(prototype, "toJSON", {
      configurable: true,
      value: () => "polluted",
    });
    let first: string;
    let second: string;
    try {
      first = routeIdentity("/item/[id]", { id: "one" }, "first");
      second = routeIdentity("/item/[id]", { id: "two" }, "second");
    } finally {
      if (previous) Object.defineProperty(prototype, "toJSON", previous);
      else delete (prototype as { toJSON?: unknown }).toJSON;
    }
    expect(first).not.toBe(second);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "requires own string static param values for %s",
    (name) => {
      const pattern = `/item/[${name}]`;
      const missing: NextAppSpec = {
        routes: { [pattern]: { page, staticParams: [{}] } },
      };
      const own: Record<string, string> = {};
      Object.defineProperty(own, name, {
        configurable: true,
        enumerable: true,
        value: "value",
        writable: true,
      });
      const present: NextAppSpec = {
        routes: { [pattern]: { page, staticParams: [own] } },
      };

      expect(collectStaticParams(missing)).toEqual([]);
      expect(collectStaticParams(present)).toEqual([{ slug: ["item", "value"] }]);
    },
  );

  it("converts slugs and collects static params exactly like 0.19.0", () => {
    expect(slugToPath(undefined)).toBe("/");
    expect(slugToPath([])).toBe("/");
    expect(slugToPath(["a", "b"])).toBe("/a/b");
    expect(collectStaticParams(spec)).toEqual([
      { slug: ["blog", "first"] },
      { slug: ["settings", "a", "b"] },
      { slug: ["settings"] },
      { slug: ["about"] },
      { slug: [] },
    ]);
  });
});

describe("0.19.0 metadata characterization", () => {
  it("applies root title templates and shallow merges structured metadata", () => {
    const spec: NextAppSpec = {
      metadata: {
        title: { default: "Site", template: "%s | Site" },
        description: "Global",
        openGraph: { title: "Global OG", siteName: "Site" },
      },
      routes: {
        "/": {
          page,
          metadata: {
            title: "Home",
            openGraph: { title: "Home OG" },
          },
        },
      },
    };
    expect(resolveMetadata(spec, spec.routes["/"])).toEqual({
      title: "Home | Site",
      description: "Global",
      openGraph: { title: "Home OG", siteName: "Site" },
    });
  });
});
