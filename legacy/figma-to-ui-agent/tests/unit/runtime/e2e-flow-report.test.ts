import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  m7RunResultSchema,
} from "../../../src/runtime/e2e-flow-contracts.ts";
import {
  m7ReportMarkdown,
  writeM7Report,
} from "../../../src/runtime/e2e-flow-report.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

function minimalResult() {
  return m7RunResultSchema.parse({
    schemaVersion: "1",
    ok: true,
    runId: "run-1",
    projectId: "m7-demo",
    input: {
      mode: "local",
      designBundleRevision: 1,
      designBundleRevisionSource: "explicit",
    },
    artifacts: {
      designBundleRef: "project:m7-demo:designBundle:1",
      uiSpecRef: "project:m7-demo:uiSpec:1",
      summaryJson: "reports/m7-e2e/run-1/summary.json",
      summaryMarkdown: "reports/m7-e2e/run-1/summary.md",
    },
    metrics: {
      pages: 1,
      passedPages: 1,
      warnings: 0,
      unsupported: 0,
    },
    validation: {
      status: "skipped",
      reason: "render_compare_not_requested",
    },
    steps: [
      {
        id: "validate_input",
        status: "passed",
        message: "ok",
      },
    ],
    nextAction: "done",
  });
}

describe("M7 E2E flow report", () => {
  it("renders a Chinese markdown summary", () => {
    const markdown = m7ReportMarkdown(minimalResult());

    expect(markdown).toContain("M7 端到端产品化主流程报告");
    expect(markdown).toContain("designBundleRevisionSource: explicit");
    expect(markdown).not.toContain("secret");
  });

  it("writes summary.json and summary.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "m7-report-"));
    roots.push(root);

    const result = await writeM7Report({
      result: minimalResult(),
      reportRoot: root,
      runId: "run-1",
    });

    const raw = await readFile(join(root, "run-1", "summary.json"), "utf8");
    expect(m7RunResultSchema.parse(JSON.parse(raw)).runId).toBe("run-1");
    expect(
      await readFile(join(root, "run-1", "summary.md"), "utf8"),
    ).toContain("status: passed");
    expect(result.artifacts.summaryJson).toContain("summary.json");
  });
});
