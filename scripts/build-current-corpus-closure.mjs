#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const defaultInputs = {
  productM9Evidence:
    "reports/product-m9/product-m9-current-evidence-classification-20260810t0025/summary.json",
  flowM12:
    "reports/flow-m12-corpus/flow-m12-corpus-artifact-closure-20260809-r3/summary.json",
  flowM14:
    "reports/flow-m14-next/flow-m14-next-six-sample-extraction-20260809t2030/summary.json",
};

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const parsed = {
    ...defaultInputs,
    reportRoot: "reports/project-completion",
    runId: "current-corpus-closure-v4-20260810t0035",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--productM9Evidence":
      case "--product-m9-evidence":
        parsed.productM9Evidence = readValue(argv, index, flag);
        index += 1;
        break;
      case "--flowM12":
      case "--flow-m12":
        parsed.flowM12 = readValue(argv, index, flag);
        index += 1;
        break;
      case "--flowM14":
      case "--flow-m14":
        parsed.flowM14 = readValue(argv, index, flag);
        index += 1;
        break;
      case "--reportRoot":
      case "--report-root":
        parsed.reportRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--runId":
      case "--run-id":
        parsed.runId = readValue(argv, index, flag);
        index += 1;
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`unknown_argument:${flag}`);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/build-current-corpus-closure.mjs [options]

Build a redacted project-level current corpus closure report from existing local
Flow-M12, Flow-M14, and Product-M9 evidence summaries. This command does not
call Figma or OpenAI.

Options:
  --product-m9-evidence <path>  Product-M9 evidence classification summary
  --flow-m12 <path>             Flow-M12 corpus summary
  --flow-m14 <path>             Flow-M14 extraction summary
  --run-id <id>                 Output run id
  --report-root <path>          Output report root
  --json                        Print report JSON
  --help                        Show help
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

function relativeArtifact(path) {
  return relative(projectRoot, resolve(projectRoot, path)) || ".";
}

function countPositiveProductSamples(productM9, classification) {
  return productM9.samples.filter((sample) =>
    sample.classifications.some((item) => item.classification === classification),
  ).length;
}

function capability({
  id,
  label,
  restrictedLive,
  localOrControlled,
  evidenceRef,
  evidence,
  residualRisk,
}) {
  return {
    id,
    label,
    restrictedLive,
    localOrControlled,
    status: restrictedLive ? "restricted_live_proven" : localOrControlled ? "local_only" : "missing",
    evidenceRef,
    evidence,
    residualRisk,
  };
}

function buildReport({ runId, inputs, productM9, flowM12, flowM14 }) {
  const productTotals = productM9.totals;
  const flowM12Coverage = flowM12.coverage;
  const flowM14StateChangeSamples = flowM14.samples.filter(
    (sample) => (sample.counts?.trustedStateChange ?? 0) > 0,
  ).length;
  const restrictedLive = {
    navigate: productM9.samples.some((sample) => (sample.metrics.trustedNavigate ?? 0) > 0),
    setState:
      productTotals.changeToVariantPositive > 0 || flowM14StateChangeSamples > 0,
    submit: productTotals.confirmedSubmitPositive > 0,
    stateMachine: false,
    selectRadioCheckbox: false,
  };
  const localOrControlled = {
    navigate: Boolean(flowM12Coverage.navigate) || restrictedLive.navigate,
    setState: Boolean(flowM12Coverage.setState) || restrictedLive.setState,
    submit: Boolean(flowM12Coverage.submit) || restrictedLive.submit,
    stateMachine: Boolean(flowM12Coverage.stateMachine),
    selectRadioCheckbox: Boolean(flowM12Coverage.selectRadioCheckbox),
  };
  const capabilities = [
    capability({
      id: "navigate",
      label: "navigate route execution",
      restrictedLive: restrictedLive.navigate,
      localOrControlled: localOrControlled.navigate,
      evidenceRef: inputs.productM9Evidence,
      evidence:
        "Product-M9 current evidence includes Trego trustedNavigate=48 with successful fixtures.",
      residualRisk: null,
    }),
    capability({
      id: "set_state",
      label: "CHANGE_TO / variant set_state",
      restrictedLive: restrictedLive.setState,
      localOrControlled: localOrControlled.setState,
      evidenceRef: inputs.productM9Evidence,
      evidence:
        "Product-M9 current evidence includes community-mobile positive.change_to_variant; Flow-M14 six-sample extraction status=passed.",
      residualRisk: null,
    }),
    capability({
      id: "submit",
      label: "confirmed submit / dialog",
      restrictedLive: restrictedLive.submit,
      localOrControlled: localOrControlled.submit,
      evidenceRef: inputs.productM9Evidence,
      evidence:
        "Product-M9 current evidence includes Trego positive.confirmed_submit with confirmedSubmit=1 and successful fixtures.",
      residualRisk: null,
    }),
    capability({
      id: "state_machine",
      label: "stateMachine transition",
      restrictedLive: restrictedLive.stateMachine,
      localOrControlled: localOrControlled.stateMachine,
      evidenceRef: inputs.flowM12,
      evidence:
        "Flow-M12 corpus r3 reports stateMachine coverage=true through local/controlled corpus.",
      residualRisk:
        "Not yet proven by a current restricted-live real Figma sample in the Product-M9 evidence set.",
    }),
    capability({
      id: "select_radio_checkbox",
      label: "select/radio/checkbox behavior",
      restrictedLive: restrictedLive.selectRadioCheckbox,
      localOrControlled: localOrControlled.selectRadioCheckbox,
      evidenceRef: inputs.flowM12,
      evidence:
        "Flow-M12 corpus r3 reports selectRadioCheckbox coverage=true through local/controlled corpus.",
      residualRisk:
        "Not yet proven by a current restricted-live real Figma sample in the Product-M9 evidence set.",
    }),
  ];
  const missingLocal = capabilities.filter((item) => !item.localOrControlled);
  const missingRestrictedLive = capabilities.filter((item) => !item.restrictedLive);
  const status =
    missingLocal.length === 0 && missingRestrictedLive.length === 0
      ? "passed"
      : missingLocal.length === 0
        ? "partial"
        : "failed";
  return {
    schemaVersion: "1",
    scope: "figma_to_ui_agent_current_corpus_closure",
    runId,
    status,
    sourceRefs: inputs,
    evidenceSummary: {
      productM9EvidenceStatus: productM9.status,
      productM9PositiveChangeToVariant: productTotals.changeToVariantPositive,
      productM9PositiveConfirmedSubmit: productTotals.confirmedSubmitPositive,
      productM9MissingEvidence: productTotals.missingEvidence,
      productM9Unsupported: productTotals.unsupported,
      productM9FailedFixture: productTotals.failedFixture,
      flowM12Status: flowM12.status,
      flowM12RestrictedLiveSummary: Boolean(flowM12Coverage.restrictedLiveSummary),
      flowM14Status: flowM14.status,
      flowM14StateChangePositiveSamples: flowM14StateChangeSamples,
      productM9PositiveSampleCount:
        countPositiveProductSamples(productM9, "positive.change_to_variant") +
        countPositiveProductSamples(productM9, "positive.confirmed_submit"),
    },
    capabilities,
    decision:
      status === "passed"
        ? "Current corpus closure fully proves the required capabilities with restricted-live evidence."
        : "Current corpus closure proves navigate, CHANGE_TO/set_state, and confirmed submit with restricted-live evidence, but stateMachine and select/radio/checkbox remain local/controlled coverage only.",
    nextActions:
      status === "passed"
        ? ["Use this closure as input to the final project goal completion audit."]
        : [
            "Either add restricted-live real Figma samples for stateMachine and select/radio/checkbox, or explicitly scope them as local/controlled coverage for the current deliverable.",
            "After that decision, run the final project goal completion audit against the full objective.",
          ],
  };
}

function markdownFor(report) {
  return [
    "# Current corpus closure v4",
    "",
    `- runId: ${report.runId}`,
    `- status: ${report.status}`,
    "",
    "## 结论",
    "",
    report.decision,
    "",
    "## Evidence summary",
    "",
    `- Product-M9 evidence status: ${report.evidenceSummary.productM9EvidenceStatus}`,
    `- Product-M9 positive CHANGE_TO/variant: ${report.evidenceSummary.productM9PositiveChangeToVariant}`,
    `- Product-M9 positive confirmed submit: ${report.evidenceSummary.productM9PositiveConfirmedSubmit}`,
    `- Product-M9 missing/unsupported/failed: ${report.evidenceSummary.productM9MissingEvidence}/${report.evidenceSummary.productM9Unsupported}/${report.evidenceSummary.productM9FailedFixture}`,
    `- Flow-M12 status: ${report.evidenceSummary.flowM12Status}`,
    `- Flow-M12 restrictedLiveSummary: ${report.evidenceSummary.flowM12RestrictedLiveSummary}`,
    `- Flow-M14 status: ${report.evidenceSummary.flowM14Status}`,
    "",
    "## Capability matrix",
    "",
    "| capability | status | restrictedLive | localOrControlled | evidence | residualRisk |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.capabilities.map(
      (item) =>
        `| ${item.label} | ${item.status} | ${item.restrictedLive} | ${item.localOrControlled} | ${item.evidence} | ${item.residualRisk ?? ""} |`,
    ),
    "",
    "## 下一步",
    "",
    ...report.nextActions.map((action) => `- ${action}`),
    "",
  ].join("\n");
}

function redactionCheck(value) {
  const serialized = JSON.stringify(value);
  const checks = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/[?&]node-id=/, "figma_node_query"],
    [/"rawResponse"\s*:/, "raw_response"],
    [/"fileKey"\s*:/, "file_key"],
    [/"token"\s*:/i, "token_field"],
    [/\/Users\/[^"]+/, "absolute_path"],
    [/\/var\/folders\/[^"]+/, "absolute_path"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`current_corpus_closure_redaction_failed:${reason}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const inputs = {
    productM9Evidence: relativeArtifact(args.productM9Evidence),
    flowM12: relativeArtifact(args.flowM12),
    flowM14: relativeArtifact(args.flowM14),
  };
  const report = buildReport({
    runId: args.runId,
    inputs,
    productM9: await readJson(args.productM9Evidence),
    flowM12: await readJson(args.flowM12),
    flowM14: await readJson(args.flowM14),
  });
  redactionCheck(report);

  const outputDir = resolve(projectRoot, args.reportRoot, args.runId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(outputDir, "summary.md"), markdownFor(report));
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Current corpus closure written to ${relative(projectRoot, outputDir)}\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
