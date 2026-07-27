import { describe, expect, it } from "vitest";

import { mapStaticPages } from "../../../src/static-generation/page-mapper.ts";
import { createM5StaticDesignBundle } from "../../fixtures/static-generation/m5-static-fixture.ts";

describe("mapStaticPages", () => {
  it("maps multiple pages with stable ids and paths", () => {
    const bundle = createM5StaticDesignBundle();
    const result = mapStaticPages(bundle);

    expect(result.pages).toHaveLength(3);
    expect(result.entryPageId).toBe("login");

    const paths = result.pages.map((page) => page.path);
    expect(new Set(paths).size).toBe(3);

    const login = result.pages.find(
      (page) => page.sourcePageId === "page-login",
    );
    expect(login?.pageId).toBe("login");
    expect(login?.path).toBe("/login");
    expect(login?.viewportRole).toBe("desktop");

    const dashboard = result.pages.find(
      (page) => page.sourcePageId === "page-dashboard",
    );
    expect(dashboard?.pageId).toBe("dashboard");
    expect(dashboard?.path).toBe("/dashboard");

    const mobile = result.pages.find(
      (page) => page.sourcePageId === "page-mobile-onboarding",
    );
    expect(mobile?.pageId).toBe("mobile-onboarding");
    expect(mobile?.path).toBe("/mobile-onboarding");
    expect(mobile?.viewportRole).toBe("mobile");
  });

  it("deduplicates page names with slug suffixes", () => {
    const bundle = createM5StaticDesignBundle();
    bundle.pages[1]!.name = "Login";
    const result = mapStaticPages(bundle);

    expect(result.pages.map((page) => page.path)).toEqual([
      "/login",
      "/login-2",
      "/mobile-onboarding",
    ]);
  });

  it("skips hidden root pages", () => {
    const bundle = createM5StaticDesignBundle();
    const root = bundle.pages[0]!.nodes.find(
      (node) => node.id === "figma-login-root",
    )!;
    root.visible = false;

    const result = mapStaticPages(bundle);
    expect(result.pages).toHaveLength(2);
    expect(
      result.warnings.some(
        (warning) => warning.code === "page_root_hidden",
      ),
    ).toBe(true);
  });

  it("fails closed when no pages exist", () => {
    const bundle = createM5StaticDesignBundle();
    bundle.pages = [];

    const result = mapStaticPages(bundle);
    expect(result.pages).toHaveLength(0);
    expect(result.entryPageId).toBeUndefined();
    expect(
      result.warnings.some(
        (warning) => warning.code === "no_pages_in_bundle",
      ),
    ).toBe(true);
  });

  it("fails closed when root bounds are zero", () => {
    const bundle = createM5StaticDesignBundle();
    const root = bundle.pages[0]!.nodes.find(
      (node) => node.id === "figma-login-root",
    )!;
    root.bounds = { x: 0, y: 0, width: 0, height: 0 };

    const result = mapStaticPages(bundle);
    expect(
      result.warnings.some(
        (warning) => warning.code === "page_bounds_zero",
      ),
    ).toBe(true);
  });
});
