import { describe, expect, it } from "vitest";

import {
  isSameOriginHttpNavigationTarget,
  resolveBrowserNavigationTarget,
} from "../../src/navigation/target.js";

describe("browser navigation target policy", () => {
  const base = "https://runtime.test/current?old=1";

  it.each([
    ["/about", "https://runtime.test/about"],
    ["#section", "https://runtime.test/current?old=1#section"],
    ["https://example.test/path", "https://example.test/path"],
    ["mailto:team@example.test", "mailto:team@example.test"],
    ["custom:value", "custom:value"],
  ])("keeps non-dangerous target %s", (href, expected) => {
    expect(resolveBrowserNavigationTarget(href, base)?.href).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,unsafe",
    "vbscript:msgbox(1)",
    "http://[",
  ])("rejects dangerous or invalid target %s after URL normalization", (href) => {
    expect(resolveBrowserNavigationTarget(href, base)).toBeNull();
  });

  it.each([
    ["/about", true],
    ["https://runtime.test/about", true],
    ["http://runtime.test/about", false],
    ["https://example.test/about", false],
    ["mailto:team@example.test", false],
    ["blob:https://runtime.test/id", false],
  ])("classifies SPA History target %s", (href, expected) => {
    const target = resolveBrowserNavigationTarget(href, base);
    expect(target).not.toBeNull();
    expect(isSameOriginHttpNavigationTarget(target!, "https://runtime.test")).toBe(expected);
  });
});
