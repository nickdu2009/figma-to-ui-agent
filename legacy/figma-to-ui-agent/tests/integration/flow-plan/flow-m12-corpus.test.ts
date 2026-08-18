import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { flowM12ReportSchema } from "../../../src/flow-plan/m12-corpus.ts";

const execFileAsync = promisify(execFile);
const browserExecutablePath =
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeManifest(root: string): Promise<string> {
  const path = join(root, "manifest.json");
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        corpusId: "flow-m12-integration",
        samples: [
          {
            sampleId: "local-m11-submit-state-machine",
            category: "local-submit-state-machine",
            source: "local_fixture",
            capabilityHints: [
              "navigate",
              "submit",
              "state_machine",
              "select_radio_checkbox",
            ],
            flowPlanPath:
              "tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json",
            uiSpecPath:
              "tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json",
          },
          {
            sampleId: "missing-real-artifact",
            category: "mobile-app",
            source: "restricted_live_artifact",
            capabilityHints: ["set_state"],
            flowPlanPath: "data/missing-flow-m12/flow/current.json",
            uiSpecPath: "data/missing-flow-m12/specs/current.json",
            seedStoreFrom: "data",
          },
          {
            sampleId: "community-mobile-001",
            category: "mobile-app",
            source: "restricted_live_summary",
            capabilityHints: ["set_state", "restricted_live_summary"],
            upstreamReportPath:
              "reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json",
            upstreamSampleId: "community-mobile-001",
          },
          {
            sampleId: "community-design-system-001",
            category: "design-system",
            source: "restricted_live_summary",
            capabilityHints: ["submit", "restricted_live_summary"],
            upstreamReportPath:
              "reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json",
            upstreamSampleId: "community-design-system-001",
          },
          {
            sampleId: "community-login-001",
            category: "login-register",
            source: "restricted_live_summary",
            capabilityHints: ["submit", "restricted_live_summary"],
            upstreamReportPath:
              "reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json",
            upstreamSampleId: "community-login-001",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

describe("Flow-M12 corpus runner", () => {
  it("聚合本地 M11 可执行回归和 restricted-live summary 诊断", async () => {
    const runId = "flow-m12-integration";
    const root = resolve(`data/flow-m12-corpus/${runId}`);
    roots.push(root);
    await mkdir(root, { recursive: true });
    const manifest = await writeManifest(root);

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/run-flow-m12-corpus.mjs",
        "--run-id",
        runId,
        "--manifest",
        manifest,
        "--data-root",
        join(root, "store"),
        "--report-root",
        join(root, "reports"),
        "--browser-executable-path",
        browserExecutablePath,
      ],
      {
        cwd: resolve("."),
        timeout: 90_000,
        maxBuffer: 1024 * 1024 * 8,
      },
    );

    const report = flowM12ReportSchema.parse(JSON.parse(stdout));
    const saved = flowM12ReportSchema.parse(
      JSON.parse(
        await readFile(join(root, "reports", runId, "summary.json"), "utf8"),
      ),
    );

    expect(saved).toEqual(report);
    expect(report.status).toBe("partial");
    expect(report.counts).toMatchObject({
      sampleCount: 5,
      executableSampleCount: 1,
      passedExecutableSampleCount: 1,
      failedExecutableSampleCount: 0,
      notExecutableSampleCount: 4,
      restrictedLiveSummarySampleCount: 3,
    });
    expect(report.coverage).toMatchObject({
      navigate: true,
      setState: true,
      submit: true,
      stateMachine: true,
      selectRadioCheckbox: true,
      restrictedLiveSummary: true,
    });
    expect(report.reasons).toContain(
      "flow_m12_real_flowplan_artifacts_missing",
    );
    expect(
      report.samples.find(
        (sample) => sample.sampleId === "community-mobile-001",
      ),
    ).toMatchObject({
      status: "not_executable",
      reasons: ["flow_plan_artifact_missing"],
    });
  }, 90_000);
});
