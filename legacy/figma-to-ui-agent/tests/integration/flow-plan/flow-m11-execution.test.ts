import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { flowM11ExecutionReportSchema } from "../../../src/flow-plan/m11-report.ts";

const execFileAsync = promisify(execFile);
const browserExecutablePath =
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const roots: string[] = [];

async function runFlowM11(runId: string, extraArgs: string[] = []) {
  const dataRoot = `data/flow-m11-execution/${runId}/store`;
  const reportRoot = `data/flow-m11-execution/${runId}/reports`;
  roots.push(resolve(`data/flow-m11-execution/${runId}`));
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "scripts/run-flow-m11-execution.mjs",
      "--run-id",
      runId,
      "--data-root",
      dataRoot,
      "--report-root",
      reportRoot,
      "--browser-executable-path",
      browserExecutablePath,
      ...extraArgs,
    ],
    {
      cwd: resolve("."),
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const report = flowM11ExecutionReportSchema.parse(JSON.parse(stdout));
  const saved = flowM11ExecutionReportSchema.parse(
    JSON.parse(
      await readFile(join(reportRoot, runId, "summary.json"), "utf8"),
    ),
  );
  expect(saved).toEqual(report);
  return report;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Flow-M11 execution runner", () => {
  it("本地执行可信多步骤 submit fixture 并报告负例不可信来源", async () => {
    const report = await runFlowM11("flow-m11-integration-pass");

    expect(report.status).toBe("passed");
    expect(report.input.networkBoundary).toEqual({
      figmaRestCalled: false,
      openaiCalled: false,
      mode: "local",
    });
    expect(report.counts).toMatchObject({
      fixtureCount: 2,
      successfulFixtureCount: 2,
      failedFixtureCount: 0,
      failedCheckCount: 0,
      preSatisfiedExpectationCount: 0,
      untrustedSourceRejectionCount: 1,
    });
    expect(report.fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureId: "flow-figma-submit-review-fixture",
          submit: true,
          inputStepCount: 1,
          selectRadioToggleStepCount: 3,
        }),
      ]),
    );
  }, 30_000);

  it("拒绝 submit 前已经满足的静态 postcondition", async () => {
    const runId = "flow-m11-integration-pre-satisfied";
    const root = resolve(`data/flow-m11-execution/${runId}`);
    roots.push(root);
    const raw = JSON.parse(
      await readFile(
        "tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json",
        "utf8",
      ),
    );
    raw.interactions[0].postconditions = [
      { kind: "expect_visible", nodeId: "title" },
    ];
    await mkdir(root, { recursive: true });
    const flowPlanPath = `data/flow-m11-execution/${runId}/pre-satisfied-flow-plan.json`;
    await writeFile(flowPlanPath, `${JSON.stringify(raw, null, 2)}\n`);

    const report = await runFlowM11(runId, [
      "--flow-plan",
      flowPlanPath,
    ]);

    expect(report.status).toBe("partial");
    expect(report.counts.failedCheckCount).toBeGreaterThanOrEqual(1);
    expect(report.counts.preSatisfiedExpectationCount).toBe(1);
    expect(report.failedFixtureIds).toEqual([
      "flow-figma-submit-review-fixture",
    ]);
    expect(report.successfulFixtureIds).toEqual([
      "flow-user-confirmed-finish-fixture",
    ]);
  }, 30_000);
});
