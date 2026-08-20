import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ValidationScheduler,
  type ValidationJob,
} from "../../server/validation/scheduler.ts";
import type { ValidationResourceEnvelopeV1 } from "../../server/validation/resource-envelope.ts";

const testDir = mkdtempSync(join(tmpdir(), "vma-scheduler-test-"));
const workerEntry = join(testDir, "worker.mjs");

writeFileSync(
  workerEntry,
  `
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
const caseResult = (item) => ({
  route: item.route,
  ...(item.params ? { params: item.params } : {}),
  viewport: item.viewport,
  metrics: { horizontalOverflowPx: 0, mainWidthRatio: 0.8, verticalCollapseCount: 0, maxOverlapRatio: 0, maxClippedPx: 0, navMainGapPx: 0, maxBlankBandPx: 0 },
  issues: [],
});
const report = {
  status: "completed",
  candidateDigest: input.candidateDigest,
  profileVersion: input.profileVersion,
  fatalVisualProfileVersion: input.fatalVisualProfileVersion,
  plannedCases: input.cases.length,
  cases: input.cases.map(caseResult),
};
if (input.pageUrl === "stderr") process.stderr.write("x".repeat(2048));
if (input.pageUrl === "duplicate") report.cases = [caseResult(input.cases[0]), caseResult(input.cases[0])];
process.stdout.write(JSON.stringify(report) + "\\n");
`,
);

afterAll(() => rmSync(testDir, { recursive: true, force: true }));

const envelope: ValidationResourceEnvelopeV1 = {
  jobTimeoutMs: 2_000,
  workerTerminationGraceMs: 100,
  workerMaxRssBytes: 256 * 1024 * 1024,
  workerStdoutStderrBytes: 512,
  workerTemporaryArtifactBytes: 1024 * 1024,
  ipcReportBytes: 1024 * 1024,
  validationSessionTtlSeconds: 60,
  validationSessionMaxRequests: 1,
};

function job(mode: string): ValidationJob {
  const jobId = randomUUID();
  return {
    jobId,
    capability: "test-capability",
    instructions: {
      jobId,
      bootstrapUrl: "http://example.invalid/bootstrap",
      pageUrl: mode,
      candidateDigest: "candidate-digest",
      profileVersion: "profile-v1",
      fatalVisualProfileVersion: "fatal-v1",
      cases: [
        { route: "/", viewport: { label: "desktop", width: 1440, height: 900 } },
        { route: "/settings", viewport: { label: "mobile", width: 390, height: 844 } },
      ],
      thresholds: {
        contentWidthMinRatio: 0.2,
        verticalCollapseMinCount: 1,
        overlapMinRatio: 0.5,
        overflowMaxPx: 24,
        clippedMinPx: 64,
        navGapMaxPx: 320,
        blankBandMaxPx: 400,
      },
      renderTimeoutMs: 100,
    },
  };
}

describe("ValidationScheduler output and matrix integrity", () => {
  it("将 stderr 一并计入输出资源包络", async () => {
    const scheduler = new ValidationScheduler({ workerEntry, envelope });
    const outcome = await scheduler.enqueue(job("stderr"));
    expect(outcome).toMatchObject({
      status: "failed",
      code: "validation_output_limit_exceeded",
      failureKind: "stdout_exceeded",
    });
  });

  it("拒绝数量相同但 route/viewport 被重复的矩阵报告", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry,
      envelope: { ...envelope, workerStdoutStderrBytes: 8 * 1024 },
    });
    const outcome = await scheduler.enqueue(job("duplicate"));
    expect(outcome).toMatchObject({
      status: "failed",
      code: "validation_failed",
      failureKind: "report_incomplete",
    });
  });
});
