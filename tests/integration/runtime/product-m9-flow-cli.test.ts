import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const BASE = "tests/fixtures/flow-plan/m8-form-submit-state-machine";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createCleanFlowPlan(root: string): Promise<string> {
  const dir = join(root, "fixtures");
  await mkdir(dir, { recursive: true });
  const raw = JSON.parse(await readFile(`${BASE}/flow-plan.json`, "utf8"));
  raw.interactions = raw.interactions.filter(
    (interaction: { id: string }) => interaction.id !== "inferred-submit",
  );
  raw.report.unresolvedInteractionCount = 0;
  const path = join(dir, "flow-plan-clean.json");
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`);
  return path;
}

function relative(path: string): string {
  return path.replace(`${process.cwd()}/`, "");
}

describe("run-product-m9-flow CLI", () => {
  it("prints help", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["scripts/run-product-m9-flow.mjs", "--help"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("Product-M9 agent-facing usage");
    expect(stdout).toContain("--flow-plan");
    expect(stdout).toContain("--ui-spec");
    expect(stdout).toContain("--run-compare");
    expect(stdout).toContain("restricted-live: Figma REST only, no OpenAI");
    expect(stdout).toContain("PRODUCT_M9_FIGMA_AUTHORIZED=1");
    expect(stdout).toContain("reports/product-m9");
  });

  it("returns exit code 2 for unknown arguments", async () => {
    await expect(
      execFileAsync(
        "node",
        ["scripts/run-product-m9-flow.mjs", "--unknown-flag"],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({ code: 2 });
  });

  it("runs local Product-M9 smoke with JSON output", async () => {
    const root = "data/test-product-m9-cli-local";
    roots.push(root);
    const flowPlanPath = await createCleanFlowPlan(root);

    const { stdout } = await execFileAsync(
      "node",
      [
        "scripts/run-product-m9-flow.mjs",
        "--project-id",
        "demo-project",
        "--mode",
        "local",
        "--flow-plan",
        relative(flowPlanPath),
        "--ui-spec",
        `${BASE}/ui-spec.json`,
        "--reportRoot",
        `${root}/reports`,
        "--runId",
        "product-m9-cli-local",
        "--json",
      ],
      { cwd: process.cwd() },
    );

    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.artifactRefs.summaryJson).toBe(
      `${root}/reports/product-m9-cli-local/summary.json`,
    );
  });

  it("fails closed when restricted-live gate is missing", async () => {
    const root = "data/test-product-m9-cli-gate";
    roots.push(root);

    await expect(
      execFileAsync(
        "node",
        [
          "scripts/run-product-m9-flow.mjs",
          "--project-id",
          "demo-project",
          "--mode",
          "restricted-live",
          "--file-key",
          "abcdefgh",
          "--reportRoot",
          `${root}/reports`,
          "--runId",
          "product-m9-cli-gate",
          "--json",
        ],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({ code: 3 });
  });
});
