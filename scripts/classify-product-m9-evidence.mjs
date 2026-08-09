#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildProductM9EvidenceReport,
  productM9EvidenceReportSchema,
  redactionCheckProductM9EvidenceReport,
} from "../src/runtime/product-m9-evidence-classifier.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  console.log(`Usage: node scripts/classify-product-m9-evidence.mjs [options]

Classify already-redacted Product-M9 summary artifacts into delivery evidence:
CHANGE_TO / variant positive sample, confirmed submit positive sample,
submit-like needs-confirmation sample, or non-evidence gaps.

Options:
  --matrix <path>        Product-M9 matrix summary.json with a samples[] array
  --summary <path>       Product-M9 per-run summary.json; repeatable
  --runId <id>           Output run id
  --reportRoot <path>    Output directory root (default: reports/product-m9)
  --json                 Print report JSON
  --help                 Show help

The command does not call Figma or OpenAI and rejects reports containing raw
Figma URLs, file keys, tokens, raw responses, or absolute local paths.
`);
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const parsed = {
    summaries: [],
    reportRoot: "reports/product-m9",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--help":
      case "-h":
        return { ...parsed, help: true };
      case "--matrix":
        parsed.matrix = readValue(argv, index, flag);
        index += 1;
        break;
      case "--summary":
        parsed.summaries.push(readValue(argv, index, flag));
        index += 1;
        break;
      case "--runId":
      case "--run-id":
        parsed.runId = readValue(argv, index, flag);
        index += 1;
        break;
      case "--reportRoot":
      case "--report-root":
        parsed.reportRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`unknown_argument:${flag}`);
    }
  }
  if (!parsed.matrix && parsed.summaries.length === 0) {
    throw new Error("product_m9_evidence_input_missing");
  }
  if (parsed.matrix && parsed.summaries.length > 0) {
    throw new Error("product_m9_evidence_input_ambiguous");
  }
  return parsed;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

function relativeArtifact(path) {
  return relative(projectRoot, resolve(projectRoot, path)) || ".";
}

async function loadSamples(args) {
  if (args.matrix) {
    const matrix = await readJson(args.matrix);
    if (!Array.isArray(matrix.samples)) {
      throw new Error("product_m9_matrix_samples_missing");
    }
    return {
      samples: matrix.samples,
      sourceRef: relativeArtifact(args.matrix),
    };
  }
  const samples = [];
  for (const summary of args.summaries) {
    samples.push(await readJson(summary));
  }
  return {
    samples,
    sourceRef: args.summaries.map(relativeArtifact).join(","),
  };
}

function markdownFor(report) {
  const lines = [
    "# Product-M9 evidence classification 报告",
    "",
    `- runId：${report.runId}`,
    `- status：${report.status}`,
    report.sourceRef ? `- sourceRef：${report.sourceRef}` : undefined,
    "",
    "## 结论",
    "",
    report.decision,
    "",
    "## 汇总",
    "",
    `- sampleCount：${report.totals.sampleCount}`,
    `- changeToVariantPositive：${report.totals.changeToVariantPositive}`,
    `- confirmedSubmitPositive：${report.totals.confirmedSubmitPositive}`,
    `- submitLikeNeedsConfirmation：${report.totals.submitLikeNeedsConfirmation}`,
    `- noExecutableEvidence：${report.totals.noExecutableEvidence}`,
    `- missingEvidence：${report.totals.missingEvidence}`,
    `- unsupported：${report.totals.unsupported}`,
    `- failedFixture：${report.totals.failedFixture}`,
    "",
    "## 样本分类",
    "",
    "| sampleId | status | classifications | recommendedUse |",
    "| --- | --- | --- | --- |",
    ...report.samples.map(
      (sample) =>
        `| ${sample.sampleId} | ${sample.status} | ${sample.classifications.map((item) => item.classification).join(", ")} | ${sample.recommendedUse} |`,
    ),
    "",
    "## 下一步",
    "",
    ...report.nextActions.map((action) => `- ${action}`),
  ].filter((line) => line !== undefined);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const loaded = await loadSamples(args);
  const runId =
    args.runId ?? `product-m9-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const report = productM9EvidenceReportSchema.parse(
    buildProductM9EvidenceReport({
      runId,
      sourceRef: loaded.sourceRef,
      samples: loaded.samples,
    }),
  );
  redactionCheckProductM9EvidenceReport(report);

  const outputDir = resolve(projectRoot, args.reportRoot, runId);
  const summaryJson = resolve(outputDir, "summary.json");
  const summaryMarkdown = resolve(outputDir, "summary.md");
  await mkdir(dirname(summaryJson), { recursive: true });
  await writeFile(summaryJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(summaryMarkdown, markdownFor(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Product-M9 evidence report written to ${relativeArtifact(summaryJson)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
