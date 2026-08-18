import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("package dependency and provenance boundary", () => {
  it("keeps framework and renderer dependencies as exact peers", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.peerDependencies).toEqual({
      "@json-render/core": "0.19.0",
      "@json-render/react": "0.19.0",
      react: "^19.2.3",
      zod: "^4.0.0",
    });
    expect(Object.keys(manifest.peerDependencies)).not.toEqual(expect.arrayContaining([
      "next",
      "fastify",
      "react-router",
      "@tanstack/router",
      "wouter",
    ]));
  });

  it("emits five public entries and declarations without server or foreign contracts", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./schema",
      "./router",
      "./stream",
      "./testing",
    ]);
    expect(manifest.exports).not.toHaveProperty("./server");
    const files = await readdir(join(process.cwd(), "dist"));
    for (const entry of ["index", "schema", "router", "stream", "testing"]) {
      expect(files).toContain(`${entry}.js`);
      expect(files).toContain(`${entry}.d.ts`);
    }
    expect(files).not.toContain("server.js");
    const declarations = await Promise.all(
      files.filter((name) => name.endsWith(".d.ts")).map((name) => readFile(join(process.cwd(), "dist", name), "utf8")),
    );
    expect(declarations.join("\n")).not.toMatch(/Fastify|UISpec|ui-spec|CreateNextAppOptions|NextAppExports/u);
  });

  it("records the exact upstream version and Apache notice", async () => {
    const notice = await readFile(join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8");
    const license = await readFile(join(process.cwd(), "LICENSES/Apache-2.0.txt"), "utf8");
    expect(notice).toContain("0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7");
    expect(notice).toContain("@json-render/next` 0.19.0");
    expect(license).toContain("Apache License");
    expect(license).toContain("Copyright 2025 Vercel Inc.");
  });
});
