import { describe, expect, it } from "vitest";
import type { NextAppSpec } from "@next-app-runtime/client";

import { summarizeCurrentApp } from "../../src/runtime/summarize-spec";
import { minimalBaseSpec } from "../../src/runtime/minimal-base-spec";

const fixtureSpec: NextAppSpec = {
  metadata: { title: { default: "Acme", template: "%s | Acme" } },
  layouts: {
    root: {
      root: "nav",
      elements: {
        nav: {
          type: "Stack",
          props: {},
          children: ["homeLink", "pricingLink"],
        },
        homeLink: {
          type: "Link",
          props: { label: "首页", href: "/" },
          children: ["homeLabel"],
        },
        homeLabel: { type: "Text", props: { text: "首页" }, children: [] },
        pricingLink: {
          type: "Link",
          props: { label: "定价", href: "/pricing" },
          children: [],
        },
      },
    },
  },
  routes: {
    "/": {
      metadata: { title: "首页" },
      page: {
        root: "root1",
        elements: {
          root1: { type: "Stack", props: {}, children: ["h1", "cta"] },
          h1: { type: "Heading", props: { text: "欢迎" }, children: [] },
          cta: { type: "Button", props: {}, children: [] },
        },
      },
    },
    "/pricing": {
      page: {
        root: "root2",
        elements: {
          root2: { type: "Grid", props: {}, children: ["card"] },
          card: { type: "Card", props: {}, children: [] },
        },
      },
    },
  },
};

describe("summarizeCurrentApp", () => {
  it("summarizes title, routes and navigation from the current spec", () => {
    const summary = summarizeCurrentApp(fixtureSpec);
    expect(summary.title).toBe("Acme");
    expect(summary.routes).toHaveLength(2);
    const home = summary.routes.find((r) => r.path === "/");
    expect(home?.title).toBe("首页");
    expect(home?.root).toBe("root1");
    expect(home?.mainElements).toEqual(["Heading", "Button"]);
    const pricing = summary.routes.find((r) => r.path === "/pricing");
    expect(pricing?.mainElements).toEqual(["Card"]);
    expect(summary.navigation.hrefs).toEqual(["/", "/pricing"]);
    expect(summary.navigation.labels).toEqual(["首页", "定价"]);
  });

  it("falls back to minimalBaseSpec when no current spec exists", () => {
    const summary = summarizeCurrentApp(null);
    expect(summary.title).toBe("Untitled App");
    expect(summary.routes).toEqual([]);
    expect(summary.navigation).toEqual({ labels: [], hrefs: [] });
  });

  it("falls back to minimalBaseSpec for undefined as well", () => {
    const summary = summarizeCurrentApp(undefined);
    expect(summary.title).toBe(
      (minimalBaseSpec.metadata?.title as { default: string }).default,
    );
  });
});
