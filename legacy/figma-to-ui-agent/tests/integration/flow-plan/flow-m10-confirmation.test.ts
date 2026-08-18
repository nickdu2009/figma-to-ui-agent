import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { parseFlowM10ConfirmationReport } from "../../../src/flow-plan/m10-schema.ts";
import { flowPlanDraftSchema } from "../../../src/flow-plan/schema.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

describe("Flow-M10 confirmation runner", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  it("本地 fixture 生成问题、应用答案、拒绝坏答案，并证明 M8 可消费", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flow-m10-"));
    roots.push(tempRoot);
    const reportRoot = join(tempRoot, "reports");
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/run-flow-m10-confirmation.mjs",
        "--mode",
        "local",
        "--run-id",
        "flow-m10-local",
        "--report-root",
        reportRoot,
        "--flow-plan",
        "tests/fixtures/flow-plan/m10-confirmation-semantics/flow-plan.json",
        "--ui-spec",
        "tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json",
        "--answers",
        "tests/fixtures/flow-plan/m10-confirmation-semantics/answers-local.json",
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );

    const report = parseFlowM10ConfirmationReport(JSON.parse(stdout));
    expect(report).toMatchObject({
      status: "passed",
      input: {
        mode: "local",
        networkBoundary: {
          figmaRestCalled: false,
          openaiCalled: false,
        },
      },
      counts: {
        submitLikeQuestions: 1,
        applied: 1,
        rejected: 1,
        unmatched: 0,
        userConfirmedSubmit: 1,
      },
    });
    expect(report.reasons).toEqual(
      expect.arrayContaining(["m8_user_confirmed_converted=1"]),
    );
    expect(report.artifacts?.confirmedFlowPlanRef).toBe(
      "confirmed-flow-plan.json",
    );
    expect(report.appliedInteractions[0]?.artifactRefs).toContain(
      report.artifacts?.confirmedFlowPlanRef,
    );

    const saved = parseFlowM10ConfirmationReport(
      JSON.parse(
        await readFile(
          join(reportRoot, "flow-m10-local", "summary.json"),
          "utf8",
        ),
      ),
    );
    expect(saved.status).toBe("passed");
    const confirmed = flowPlanDraftSchema.parse(
      JSON.parse(
        await readFile(
          join(reportRoot, "flow-m10-local", "confirmed-flow-plan.json"),
          "utf8",
        ),
      ),
    );
    expect(
      confirmed.interactions.some(
        (interaction) =>
          interaction.source === "user_confirmed" &&
          interaction.intent === "submit",
      ),
    ).toBe(true);
  });

  it("restricted-live-regression 复用 Flow-M9 三样本报告且不重新触网", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flow-m10-rl-"));
    roots.push(tempRoot);
    const reportRoot = join(tempRoot, "reports");
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "scripts/run-flow-m10-confirmation.mjs",
        "--mode",
        "restricted-live-regression",
        "--run-id",
        "flow-m10-restricted-live-regression",
        "--report-root",
        reportRoot,
        "--flow-plan",
        "tests/fixtures/flow-plan/m10-confirmation-semantics/flow-plan.json",
        "--ui-spec",
        "tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json",
        "--answers",
        "tests/fixtures/flow-plan/m10-confirmation-semantics/answers.json",
        "--m9-report",
        "reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json",
      ],
      {
        cwd: resolve("."),
        timeout: 30_000,
      },
    );

    const report = parseFlowM10ConfirmationReport(JSON.parse(stdout));
    expect(report.status).toBe("passed");
    expect(report.input.networkBoundary).toMatchObject({
      figmaRestCalled: false,
      openaiCalled: false,
      mode: "restricted-live-regression",
    });
    expect(report.counts.summaryOnlyQuestions).toBeGreaterThanOrEqual(1);
    expect(report.samples.map((sample) => sample.sampleId)).toEqual(
      expect.arrayContaining([
        "community-design-system-001",
        "community-login-001",
      ]),
    );
    expect(report.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "summary_only_apply_carrier",
        }),
      ]),
    );
    expect(report.artifacts?.confirmedFlowPlanRef).toBe(
      "confirmed-flow-plan.json",
    );
  });
});
