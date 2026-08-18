import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("built package consumer", () => {
  it("imports all five public subpaths from built artifacts", async () => {
    for (const entry of ["index", "schema", "router", "stream", "testing"]) {
      const module = await import(pathToFileURL(join(process.cwd(), "dist", `${entry}.js`)).href);
      expect(Object.keys(module).length).toBeGreaterThan(0);
    }
  });

  it("bundles a minimal React consumer without the testing entry", async () => {
    const output = await mkdtemp(join(tmpdir(), "next-app-runtime-consumer-"));
    directories.push(output);
    await build({
      root: join(process.cwd(), "tests/consumer/fixture"),
      logLevel: "silent",
      build: { outDir: output, emptyOutDir: true },
    });
    const manifest = await import("node:fs/promises").then(({ readdir }) => readdir(join(output, "assets")));
    const javascript = await Promise.all(
      manifest.filter((name) => name.endsWith(".js")).map((name) => readFile(join(output, "assets", name), "utf8")),
    );
    const bundle = javascript.join("\n");
    expect(bundle).toContain("0.19.0");
    expect(bundle).not.toContain("createMemoryNavigation");
    expect(bundle).not.toContain("runtime.test");
  });
});
