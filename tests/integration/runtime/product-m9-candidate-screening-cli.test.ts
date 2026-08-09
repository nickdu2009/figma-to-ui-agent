import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("screen-product-m9-candidates CLI", () => {
  it("prints help without requiring network gates", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["scripts/screen-product-m9-candidates.mjs", "--help"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("Screen Figma Community samples");
    expect(stdout).toContain("--allow-figma-network");
    expect(stdout).toContain("PRODUCT_M9_FIGMA_AUTHORIZED=1");
  });

  it("fails closed before reading manifest when the explicit Figma gate is missing", async () => {
    await expect(
      execFileAsync(
        "node",
        [
          "scripts/screen-product-m9-candidates.mjs",
          "--mode",
          "restricted-live",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PRODUCT_M9_FIGMA_AUTHORIZED: "",
            FIGMA_API_KEY: "",
          },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("figma_network_gate_missing"),
    });
  });

  it("rejects manifests with no REST-readable selected samples without calling Figma", async () => {
    const root = "data/test-product-m9-candidate-screening-cli";
    roots.push(root);
    await mkdir(root, { recursive: true });
    const manifestPath = join(root, "manifest.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: "1",
          corpusId: "test-corpus",
          samples: [
            {
              sampleId: "community-login-002",
              category: "login-register",
              title: "Login community page only",
              accessStatus: "community_page_found",
              designUrl: null,
              nodeId: null,
              expectedViewport: "mobile",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      execFileAsync(
        "node",
        [
          "scripts/screen-product-m9-candidates.mjs",
          "--mode",
          "restricted-live",
          "--allow-figma-network",
          "--manifest",
          manifestPath,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PRODUCT_M9_FIGMA_AUTHORIZED: "1",
            FIGMA_API_KEY: "figd_test",
          },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("product_m9_screening_no_samples"),
    });
  });
});
