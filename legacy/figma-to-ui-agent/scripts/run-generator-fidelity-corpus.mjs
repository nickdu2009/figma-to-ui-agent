#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const FIXED_PROJECT_IDS = [
  "community-v21-login-001",
  "community-v21-mobile-001",
  "community-v21-dashboard-001",
  "community-v21-ecommerce-001",
  "community-v21-landing-001",
  "community-v21-design-system-001",
];

function parseArgs(argv) {
  const options = {
    dataRoot: "data/community-corpus-v21",
    reportRoot: "reports/community-corpus",
    runLabel: new Date()
      .toISOString()
      .replaceAll(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "z")
      .toLowerCase(),
    threshold: 0.05,
    viewportIds: "desktop",
  };

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const next = args[index + 1];
    switch (flag) {
      case "--dataRoot":
        options.dataRoot = next;
        index += 1;
        break;
      case "--reportRoot":
        options.reportRoot = next;
        index += 1;
        break;
      case "--runLabel":
        options.runLabel = next;
        index += 1;
        break;
      case "--threshold":
        options.threshold = Number.parseFloat(next);
        index += 1;
        break;
      case "--viewportIds":
        options.viewportIds = next;
        index += 1;
        break;
      default:
        break;
    }
  }
  return options;
}

function validateRunLabel(runLabel) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runLabel)) {
    throw new Error(
      `Invalid runLabel: ${runLabel}. Must be 1-64 alphanumeric, hyphen or underscore characters.`,
    );
  }
}

async function assertCachedDesignBundles(dataRoot) {
  for (const projectId of FIXED_PROJECT_IDS) {
    await access(
      join(dataRoot, "projects", projectId, "figma", "current.json"),
    );
  }
}

function runCommand(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FIGMA_API_KEY: "",
        OPENAI_API_KEY: "",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectCommand);
    child.on("close", (code) => {
      resolveCommand({ code, stdout, stderr });
    });
  });
}

function findSummaryPath(stdout) {
  const match = stdout.match(/M5 static report written to (.+summary\.json)/);
  return match?.[1]?.trim();
}

function worstComparedPage(report) {
  return report.pages
    .filter((page) => page.comparison)
    .sort(
      (left, right) =>
        right.comparison.diffPixelRatio -
        left.comparison.diffPixelRatio,
    )[0];
}

function createMarkdown(summary) {
  const lines = [
    `# Generator Fidelity v1 Corpus Summary`,
    "",
    `- runLabel: ${summary.runLabel}`,
    `- dataRoot: ${summary.dataRoot}`,
    `- threshold: ${summary.threshold}`,
    `- apiBoundary: figma=${summary.apiBoundary.figma}, openai=${summary.apiBoundary.openai}`,
    `- passed5PctCount: ${summary.aggregate.passed5PctCount}/${summary.aggregate.comparableCount}`,
    `- averageDiff: ${summary.aggregate.averageDiff}`,
    `- minDiff: ${summary.aggregate.minDiff}`,
    `- maxDiff: ${summary.aggregate.maxDiff}`,
    "",
    "| projectId | pageId | diff | passed | renderMode | topRegions |",
    "|---|---|---:|---|---|---|",
  ];
  for (const result of summary.results) {
    const topRegions = result.topRegions
      .map(
        (region) =>
          `${region.id}:${((region.diffPixelRatio ?? 0) * 100).toFixed(2)}%`,
      )
      .join(", ");
    lines.push(
      `| ${result.projectId} | ${result.pageId ?? "-"} | ${result.diffPixelRatio ?? "-"} | ${result.passed5Pct} | ${result.canvasMapping?.renderMode ?? "-"} | ${topRegions || "-"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv);
  validateRunLabel(options.runLabel);
  if (!Number.isFinite(options.threshold) || options.threshold < 0) {
    throw new Error("threshold must be a non-negative number");
  }

  const dataRoot = resolve(options.dataRoot);
  const reportRoot = resolve(options.reportRoot);
  await assertCachedDesignBundles(dataRoot);
  await mkdir(reportRoot, { recursive: true });

  const results = [];
  for (const projectId of FIXED_PROJECT_IDS) {
    const runId = `${options.runLabel}-${projectId}`;
    const projectReportRoot = join(
      reportRoot,
      options.runLabel,
      "m5-static",
      projectId,
    );
    const commandResult = await runCommand(process.execPath, [
      "scripts/run-m5-static.mjs",
      "--projectId",
      projectId,
      "--dataRoot",
      dataRoot,
      "--reportRoot",
      projectReportRoot,
      "--runId",
      runId,
      "--save-ui-spec",
      "--run-compare",
      "--viewportIds",
      options.viewportIds,
      "--m4ValidationStatus",
      "not_required",
    ]);
    if (commandResult.code !== 0) {
      results.push({
        projectId,
        status: "failed",
        error: commandResult.stderr.trim() || commandResult.stdout.trim(),
        summaryPath: undefined,
        pageId: undefined,
        diffPixelRatio: undefined,
        diffPixels: undefined,
        passed5Pct: false,
        canvasMapping: undefined,
        topRegions: [],
      });
      continue;
    }

    const summaryPath = findSummaryPath(commandResult.stdout);
    if (!summaryPath) {
      throw new Error(`Unable to locate summary path for ${projectId}`);
    }
    const report = JSON.parse(await readFile(summaryPath, "utf8"));
    const portableSummaryPath = relative(process.cwd(), summaryPath);
    const page = worstComparedPage(report);
    if (!page?.comparison) {
      results.push({
        projectId,
        status: "failed",
        error: "No compared page in M5 static report",
        summaryPath: portableSummaryPath,
        pageId: undefined,
        diffPixelRatio: undefined,
        diffPixels: undefined,
        passed5Pct: false,
        canvasMapping: undefined,
        topRegions: [],
      });
      continue;
    }
    results.push({
      projectId,
      status: "completed",
      summaryPath: portableSummaryPath,
      pageId: page.pageId,
      diffPixelRatio: page.comparison.diffPixelRatio,
      diffPixels: page.comparison.diffPixels,
      passed5Pct: page.comparison.diffPixelRatio < options.threshold,
      canvasMapping: page.comparison.canvasMapping,
      topRegions: page.comparison.regionDiagnostics ?? [],
    });
  }

  const comparable = results.filter(
    (result) => typeof result.diffPixelRatio === "number",
  );
  const diffs = comparable.map((result) => result.diffPixelRatio);
  const aggregate = {
    resultCount: results.length,
    comparableCount: comparable.length,
    threshold: options.threshold,
    passed5PctCount: comparable.filter((result) => result.passed5Pct)
      .length,
    failed5PctCount: comparable.filter((result) => !result.passed5Pct)
      .length,
    averageDiff:
      diffs.length === 0
        ? null
        : diffs.reduce((total, value) => total + value, 0) / diffs.length,
    minDiff: diffs.length === 0 ? null : Math.min(...diffs),
    maxDiff: diffs.length === 0 ? null : Math.max(...diffs),
  };
  const summary = {
    schemaVersion: "1",
    runLabel: options.runLabel,
    generatedAt: new Date().toISOString(),
    dataRoot: options.dataRoot,
    reportRoot: options.reportRoot,
    projectIds: FIXED_PROJECT_IDS,
    baselineSummaryPath:
      "reports/community-corpus/20260726-m5-visual-v21-local-summary.json",
    threshold: options.threshold,
    apiBoundary: {
      figma: false,
      openai: false,
    },
    aggregate,
    results,
  };

  const jsonPath = join(
    reportRoot,
    `${options.runLabel}-generator-fidelity-v1-summary.json`,
  );
  const markdownPath = join(
    reportRoot,
    `${options.runLabel}-generator-fidelity-v1-summary.md`,
  );
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(markdownPath, createMarkdown(summary));

  console.log(`Generator Fidelity corpus summary written to ${jsonPath}`);
  console.log(`Generator Fidelity corpus markdown written to ${markdownPath}`);
  console.log(
    `passed5PctCount: ${aggregate.passed5PctCount}/${aggregate.comparableCount}`,
  );

  if (results.some((result) => result.status !== "completed")) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
