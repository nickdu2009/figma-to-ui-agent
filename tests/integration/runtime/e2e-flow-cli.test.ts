import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../../src/project-store/store.ts";
import { createM5StaticDesignBundleDraft } from "../../fixtures/static-generation/m5-static-fixture.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function createFixture(input: {
  root: string;
  projectId: string;
}): Promise<number> {
  const store = new ProjectStore(join(input.root, "data"));
  await store.initializeProject(input.projectId);
  const saved = await store.saveDesignBundle({
    projectId: input.projectId,
    baseRevision: 0,
    draft: createM5StaticDesignBundleDraft(input.projectId),
  });
  return saved.revision;
}

describe("run-figma-to-ui CLI", () => {
  it("prints help", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["scripts/run-figma-to-ui.mjs", "--help"],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain("--project-id");
    expect(stdout).toContain("--designBundleRevision");
  });

  it("runs local e2e with JSON output", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-cli-"));
    roots.push(root);
    const projectId = "m7-cli-demo";
    const revision = await createFixture({ root, projectId });

    const { stdout } = await execFileAsync(
      "node",
      [
        "scripts/run-figma-to-ui.mjs",
        "--project-id",
        projectId,
        "--mode",
        "local",
        "--designBundleRevision",
        String(revision),
        "--dataRoot",
        join(root, "data"),
        "--reportRoot",
        join(root, "reports"),
        "--runId",
        "m7-cli-run",
        "--json",
      ],
      { cwd: process.cwd() },
    );

    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    expect(result.input.designBundleRevisionSource).toBe("explicit");
    expect(
      JSON.parse(
        await readFile(
          join(root, "reports", "m7-cli-run", "summary.json"),
          "utf8",
        ),
      ).ok,
    ).toBe(true);
  });
});
