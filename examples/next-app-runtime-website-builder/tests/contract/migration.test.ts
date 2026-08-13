import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";

import { catalog } from "../../lib/catalog";
import { defaultSpec } from "../../lib/default-spec";
import { registry } from "../../lib/registry";
import { websiteComponentDefinitions } from "../../lib/website-catalog";
import { websiteComponents } from "../../lib/website-components";

interface ProvenanceEntry {
  sourcePath: string;
  sourceSha256: string;
  targetPath: string | null;
  classification: string;
}

interface BundledArtifact {
  sourcePath: string;
  sourceSha256: string;
  targetPath: string;
}

describe("complete upstream migration", () => {
  it("accounts for all 23 upstream files and every non-excluded target exists", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "provenance-manifest.json"), "utf8"));
    expect(manifest.upstream).toMatchObject({
      tag: "v0.19.0",
      commit: "0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7",
    });
    expect(manifest.entries).toHaveLength(23);
    expect(new Set(manifest.entries.map((entry: ProvenanceEntry) => entry.sourcePath)).size).toBe(23);
    for (const entry of manifest.entries as ProvenanceEntry[]) {
      expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(["unchanged", "ported", "replaced", "excluded-server-only"]).toContain(entry.classification);
      if (entry.targetPath) {
        const target = join(process.cwd(), entry.targetPath);
        await expect(access(target)).resolves.toBeUndefined();
        if (entry.classification === "unchanged") {
          const content = await readFile(target);
          expect(createHash("sha256").update(content).digest("hex"), entry.targetPath)
            .toBe(entry.sourceSha256);
        }
      }
    }
  });

  it("keeps defaultSpec byte-equivalent after only changing its type import", async () => {
    const entry = JSON.parse(await readFile(join(process.cwd(), "provenance-manifest.json"), "utf8"))
      .entries.find((item: ProvenanceEntry) => item.sourcePath.endsWith("lib/default-spec.ts"));
    const current = await readFile(join(process.cwd(), "lib/default-spec.ts"), "utf8");
    const reconstructed = current.replace(
      'import type { NextAppSpec } from "@next-app-runtime/client";',
      'import type { NextAppSpec } from "@json-render/next";',
    );
    expect(createHash("sha256").update(reconstructed).digest("hex")).toBe(entry.sourceSha256);
    expect(Object.keys(defaultSpec.routes)).toEqual(["/", "/about", "/contact"]);
    expect(defaultSpec.layouts).toHaveProperty("main");
    expect(defaultSpec.metadata?.title).toEqual({ default: "Acme Inc", template: "%s | Acme Inc" });
  });

  it("pins the exact geist@1.7.0 fonts and license bundled by the example", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "provenance-manifest.json"), "utf8"));
    expect(manifest.bundledArtifacts).toMatchObject({ sourcePackage: "geist@1.7.0" });
    expect(manifest.bundledArtifacts.entries).toEqual([
      {
        sourcePath: "dist/fonts/geist-sans/Geist-Variable.woff2",
        sourceSha256: "e24cec106619c03f0b3519e31b9bc55e0d5e926b6a95b8d798cd8cef215b1505",
        targetPath: "app/assets/Geist-Variable.woff2",
      },
      {
        sourcePath: "dist/fonts/geist-mono/GeistMono-Variable.woff2",
        sourceSha256: "5f687a5dd4c87da13deaff9f6b9503d5e62249ff501265a96b134565f9aa8c87",
        targetPath: "app/assets/GeistMono-Variable.woff2",
      },
      {
        sourcePath: "LICENSE.txt",
        sourceSha256: "930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137",
        targetPath: "LICENSES/OFL-1.1.txt",
      },
    ]);
    for (const entry of manifest.bundledArtifacts.entries as BundledArtifact[]) {
      const content = await readFile(join(process.cwd(), entry.targetPath));
      expect(createHash("sha256").update(content).digest("hex"), entry.targetPath)
        .toBe(entry.sourceSha256);
    }
  });

  it("builds the runtime export targets before running example tests", async () => {
    const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
    expect(manifest.scripts.test)
      .toBe("npm run build --workspace @next-app-runtime/client && vitest run");
  });

  it("contains no API fetch/store or Next.js runtime imports", async () => {
    const editor = await readFile(join(process.cwd(), "components/editor.tsx"), "utf8");
    expect(editor).not.toContain("fetch(");
    expect(editor).not.toContain("/api/spec");
    const manifest = await readFile(join(process.cwd(), "package.json"), "utf8");
    expect(manifest).not.toMatch(/"next"\s*:/u);
  });

  it("preserves the upstream component and action surface", () => {
    const expectedNames = [
      ...Object.keys(shadcnComponentDefinitions).filter((name) => name !== "Link"),
      ...Object.keys(websiteComponentDefinitions),
    ].sort();
    expect([...catalog.componentNames].sort()).toEqual(expectedNames);
    expect(Object.keys(registry).sort()).toEqual(expectedNames);
    expect(catalog.actionNames).toEqual([]);
    expect(shadcnComponentDefinitions).toHaveProperty("Link");
    expect(Object.keys(websiteComponents).sort())
      .toEqual(Object.keys(websiteComponentDefinitions).sort());
  });
});
