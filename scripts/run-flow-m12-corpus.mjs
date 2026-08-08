import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  buildFlowM12Report,
  coverageFromHints,
  flowM12CorpusManifestSchema,
} from "../src/flow-plan/m12-corpus.ts";
import { flowM11ExecutionReportSchema } from "../src/flow-plan/m11-report.ts";
import { parseFlowM9RestrictedLiveExtractionReport } from "../src/flow-plan/m9-report.ts";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBrowserExecutablePath = resolve(
  projectRoot,
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) =>
      value.toUpperCase(),
    );
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_argument_value:${arg}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

async function loadJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

async function pathExists(path) {
  try {
    await access(resolve(projectRoot, path));
    return true;
  } catch {
    return false;
  }
}

function safeId(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "sample"
  );
}

function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/figd_[A-Za-z0-9_-]+/g, "[REDACTED_FIGMA_TOKEN]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_TOKEN]")
    .replace(
      /https:\/\/www\.figma\.com\/design\/[^\s"')]+/g,
      "[REDACTED_FIGMA_DESIGN_URL]",
    )
    .replace(/\/Users\/[^\s"')]+/g, "[REDACTED_ABSOLUTE_PATH]")
    .replace(/\/var\/folders\/[^\s"')]+/g, "[REDACTED_ABSOLUTE_PATH]")
    .slice(0, 300);
}

function relativeArtifact(path) {
  return relative(projectRoot, resolve(projectRoot, path)) || ".";
}

function mergeCoverage(left, right) {
  return {
    navigate: left.navigate || right.navigate,
    setState: left.setState || right.setState,
    submit: left.submit || right.submit,
    stateMachine: left.stateMachine || right.stateMachine,
    selectRadioCheckbox:
      left.selectRadioCheckbox || right.selectRadioCheckbox,
    restrictedLiveSummary:
      left.restrictedLiveSummary || right.restrictedLiveSummary,
  };
}

function coverageFromM11(report, hints) {
  const hinted = coverageFromHints(hints);
  const observed = {
    navigate: report.fixtures.some((fixture) => fixture.intent === "navigate"),
    setState: report.fixtures.some((fixture) => fixture.intent === "set_state"),
    submit: report.fixtures.some((fixture) => fixture.submit),
    stateMachine: false,
    selectRadioCheckbox: report.fixtures.some(
      (fixture) => fixture.selectRadioToggleStepCount > 0,
    ),
    restrictedLiveSummary: false,
  };
  return mergeCoverage(hinted, observed);
}

function coverageFromM9Sample(sample, hints) {
  const hinted = coverageFromHints(hints);
  const observed = {
    navigate: sample.counts.trustedNavigate > 0,
    setState: sample.counts.trustedStateChange > 0,
    submit: sample.counts.submitLikeNeedsConfirmation > 0,
    stateMachine: false,
    selectRadioCheckbox: false,
    restrictedLiveSummary: true,
  };
  return mergeCoverage(hinted, observed);
}

async function runM11Sample(input) {
  if (
    !input.sample.flowPlanPath ||
    !(await pathExists(input.sample.flowPlanPath))
  ) {
    return {
      sampleId: input.sample.sampleId,
      category: input.sample.category,
      source: input.sample.source,
      status: "not_executable",
      capabilities: coverageFromHints(input.sample.capabilityHints),
      reasons: ["flow_plan_artifact_missing"],
    };
  }
  if (!input.sample.uiSpecPath || !(await pathExists(input.sample.uiSpecPath))) {
    return {
      sampleId: input.sample.sampleId,
      category: input.sample.category,
      source: input.sample.source,
      status: "not_executable",
      capabilities: coverageFromHints(input.sample.capabilityHints),
      reasons: ["ui_spec_artifact_missing"],
    };
  }

  const childRunId = `${input.runId}-${safeId(input.sample.sampleId)}`;
  const childArgs = [
    "scripts/run-flow-m11-execution.mjs",
    "--run-id",
    childRunId,
    "--mode",
    input.sample.source === "restricted_live_artifact"
      ? "restricted-live"
      : "local",
    "--flow-plan",
    input.sample.flowPlanPath,
    "--ui-spec",
    input.sample.uiSpecPath,
    "--data-root",
    resolve(input.dataRoot, safeId(input.sample.sampleId), "store"),
    "--report-root",
    resolve(input.outputRoot, "m11"),
    "--browser-executable-path",
    input.browserExecutablePath,
  ];
  if (input.sample.seedStoreFrom) {
    childArgs.push("--reuse-store", "--seed-store-from", input.sample.seedStoreFrom);
  }
  try {
    const { stdout } = await execFileAsync(process.execPath, childArgs, {
      cwd: projectRoot,
      timeout: input.timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });
    const report = flowM11ExecutionReportSchema.parse(JSON.parse(stdout));
    const status =
      report.status === "failed" && report.counts.fixtureCount === 0
        ? "not_executable"
        : report.status;
    return {
      sampleId: input.sample.sampleId,
      category: input.sample.category,
      source: input.sample.source,
      status,
      capabilities: coverageFromM11(report, input.sample.capabilityHints),
      executionReportRef: relativeArtifact(
        resolve(input.outputRoot, "m11", childRunId, "summary.json"),
      ),
      reasons: report.reasons,
    };
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      sampleId: input.sample.sampleId,
      category: input.sample.category,
      source: input.sample.source,
      status: "failed",
      capabilities: coverageFromHints(input.sample.capabilityHints),
      reasons: [`flow_m11_child_failed:${sanitizeDiagnostic(message)}`],
    };
  }
}

async function summarizeRestrictedLiveSample(sample) {
  if (!sample.upstreamReportPath || !(await pathExists(sample.upstreamReportPath))) {
    return {
      sampleId: sample.sampleId,
      category: sample.category,
      source: sample.source,
      status: "not_executable",
      capabilities: coverageFromHints(sample.capabilityHints),
      reasons: ["upstream_report_missing"],
    };
  }
  const upstream = parseFlowM9RestrictedLiveExtractionReport(
    await loadJson(sample.upstreamReportPath),
  );
  const upstreamSample = upstream.samples.find(
    (candidate) =>
      candidate.sampleId === (sample.upstreamSampleId ?? sample.sampleId),
  );
  if (!upstreamSample) {
    return {
      sampleId: sample.sampleId,
      category: sample.category,
      source: sample.source,
      status: "not_executable",
      capabilities: coverageFromHints(sample.capabilityHints),
      upstreamReportRef: sample.upstreamReportPath,
      reasons: ["upstream_sample_missing"],
    };
  }
  const reasons = [];
  if (
    !upstreamSample.artifactRefs.flowPlanPath ||
    upstreamSample.artifactRefs.flowPlanPath === "ephemeral-flow-plan"
  ) {
    reasons.push("flow_plan_artifact_missing");
  }
  if (!upstreamSample.artifactRefs.uiSpecPath) {
    reasons.push("ui_spec_artifact_missing");
  }
  if (upstreamSample.accessStatus !== "readable") {
    reasons.push(`upstream_access_${upstreamSample.accessStatus}`);
  }
  return {
    sampleId: sample.sampleId,
    category: sample.category,
    source: sample.source,
    status: reasons.length > 0 ? "not_executable" : "partial",
    capabilities: coverageFromM9Sample(
      upstreamSample,
      sample.capabilityHints,
    ),
    upstreamReportRef: sample.upstreamReportPath,
    reasons,
  };
}

async function buildSample(input) {
  if (input.sample.source === "restricted_live_summary") {
    return await summarizeRestrictedLiveSample(input.sample);
  }
  return await runM11Sample(input);
}

function reportMarkdown(report) {
  return `${[
    "# Flow-M12 corpus/regression 报告",
    "",
    `- runId：${report.input.runId}`,
    `- status：${report.status}`,
    `- sampleCount：${report.counts.sampleCount}`,
    `- executableSampleCount：${report.counts.executableSampleCount}`,
    `- passedExecutableSampleCount：${report.counts.passedExecutableSampleCount}`,
    `- partialExecutableSampleCount：${report.counts.partialExecutableSampleCount}`,
    `- failedExecutableSampleCount：${report.counts.failedExecutableSampleCount}`,
    `- notExecutableSampleCount：${report.counts.notExecutableSampleCount}`,
    `- restrictedLiveSummarySampleCount：${report.counts.restrictedLiveSummarySampleCount}`,
    "",
    "## Coverage",
    "",
    ...Object.entries(report.coverage).map(
      ([key, value]) => `- ${key}：${value}`,
    ),
    "",
    "## Samples",
    "",
    ...report.samples.map(
      (sample) =>
        `- ${sample.sampleId}：${sample.status}，source=${sample.source}，reasons=${sample.reasons.join(", ") || "none"}`,
    ),
    "",
    "## Reasons",
    "",
    ...(report.reasons.length > 0
      ? report.reasons.map((reason) => `- ${reason}`)
      : ["- none"]),
    "",
    "## Residual Risks",
    "",
    ...report.residualRisks.map((risk) => `- ${risk}`),
  ].join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId =
    args.runId ?? `flow-m12-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const manifestPath =
    args.manifest ?? "tests/fixtures/flow-plan/m12-corpus/manifest.json";
  const dataRoot = resolve(
    projectRoot,
    args.dataRoot ?? `data/flow-m12-corpus/${runId}`,
  );
  const reportRoot = resolve(
    projectRoot,
    args.reportRoot ?? "reports/flow-m12-corpus",
  );
  const outputRoot = resolve(reportRoot, runId);
  const browserExecutablePath = resolve(
    projectRoot,
    args.browserExecutablePath ?? defaultBrowserExecutablePath,
  );
  const timeoutMs = Number(args.timeoutMs ?? 60_000);

  await mkdir(outputRoot, { recursive: true });
  const manifest = flowM12CorpusManifestSchema.parse(
    await loadJson(manifestPath),
  );
  const sampleReports = [];
  for (const sample of manifest.samples) {
    sampleReports.push(
      await buildSample({
        sample,
        runId,
        dataRoot,
        outputRoot,
        browserExecutablePath,
        timeoutMs,
      }),
    );
  }
  const report = buildFlowM12Report({
    runId,
    manifestRef: relativeArtifact(manifestPath),
    samples: sampleReports,
  });
  await writeFile(
    resolve(outputRoot, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(resolve(outputRoot, "summary.md"), reportMarkdown(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
