import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

describe("classify-product-m9-evidence CLI", () => {
  it("prints help", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["scripts/classify-product-m9-evidence.mjs", "--help"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("Classify already-redacted Product-M9 summary");
    expect(stdout).toContain("--matrix");
    expect(stdout).toContain("--summary");
  });

  it("classifies a matrix summary and writes report artifacts", async () => {
    const root = "data/test-product-m9-evidence-cli";
    roots.push(root);
    await mkdir(root, { recursive: true });
    const matrixPath = join(root, "matrix.json");
    await writeFile(
      matrixPath,
      `${JSON.stringify(
        {
          samples: [
            {
              sampleId: "community-mobile-001",
              category: "mobile-app",
              status: "passed",
              ok: true,
              metrics: {
                trustedStateChange: 1,
                successfulFixtureIds: ["fixture-1"],
                failedFixtureIds: [],
              },
            },
            {
              sampleId: "community-login-001",
              category: "login-register",
              status: "partial",
              ok: false,
              metrics: {
                submitLikeNeedsConfirmation: 2,
                successfulFixtureIds: [],
                failedFixtureIds: [],
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const { stdout } = await execFileAsync(
      "node",
      [
        "scripts/classify-product-m9-evidence.mjs",
        "--matrix",
        matrixPath,
        "--runId",
        "product-m9-evidence-cli",
        "--reportRoot",
        `${root}/reports`,
        "--json",
      ],
      { cwd: process.cwd() },
    );

    const result = JSON.parse(stdout);
    expect(result.status).toBe("partial");
    expect(result.totals.changeToVariantPositive).toBe(1);
    expect(result.totals.confirmedSubmitPositive).toBe(0);
    expect(result.totals.submitLikeNeedsConfirmation).toBe(1);

    const written = JSON.parse(
      await readFile(
        `${root}/reports/product-m9-evidence-cli/summary.json`,
        "utf8",
      ),
    );
    expect(written.scope).toBe("product_m9_evidence_classification");
  });
});
