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
    uiControlSmoke: [],
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
      case "--uiControlSmoke":
      case "--ui-control-smoke":
        parsed.uiControlSmoke.push(readValue(argv, index, flag));
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

从现有本地 Flow-M12、Flow-M14 和 Product-M9 evidence summary 生成脱敏的项目级
current corpus closure 报告。本命令不调用 Figma 或 OpenAI。

选项:
  --product-m9-evidence <path>  Product-M9 evidence classification summary 路径
  --flow-m12 <path>             Flow-M12 corpus summary 路径
  --flow-m14 <path>             Flow-M14 extraction summary 路径
  --ui-control-smoke <path>     UI control smoke summary 路径，可重复
  --run-id <id>                 输出 run id
  --report-root <path>          输出报告根目录
  --json                        输出报告 JSON
  --help                        显示帮助
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

function passedUiControlSmoke(uiControlSmokes) {
  return uiControlSmokes.filter(
    (report) =>
      report.status === "passed" &&
      report.coverage?.selectRadioCheckbox === true &&
      report.sourceSummary?.mode === "restricted-live" &&
      report.networkBoundary?.mode === "local-validation-of-restricted-live-artifact",
  );
}

function buildReport({ runId, inputs, productM9, flowM12, flowM14, uiControlSmokes }) {
  const productTotals = productM9.totals;
  const flowM12Coverage = flowM12.coverage;
  const flowM14StateChangeSamples = flowM14.samples.filter(
    (sample) => (sample.counts?.trustedStateChange ?? 0) > 0,
  ).length;
  const passedControlSmokes = passedUiControlSmoke(uiControlSmokes);
  const controlSmokeEvidenceRef =
    inputs.uiControlSmoke.find((_, index) =>
      passedControlSmokes.includes(uiControlSmokes[index]),
    ) ?? inputs.flowM12;
  const restrictedLive = {
    navigate: productM9.samples.some((sample) => (sample.metrics.trustedNavigate ?? 0) > 0),
    setState:
      productTotals.changeToVariantPositive > 0 || flowM14StateChangeSamples > 0,
    submit: productTotals.confirmedSubmitPositive > 0,
    stateMachine: false,
    selectRadioCheckbox: passedControlSmokes.length > 0,
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
        "Product-M9 current evidence 包含 Trego trustedNavigate=48，且有成功 fixture。",
      residualRisk: null,
    }),
    capability({
      id: "set_state",
      label: "CHANGE_TO / variant set_state",
      restrictedLive: restrictedLive.setState,
      localOrControlled: localOrControlled.setState,
      evidenceRef: inputs.productM9Evidence,
      evidence:
        "Product-M9 current evidence 包含 community-mobile positive.change_to_variant；Flow-M14 six-sample extraction status=passed。",
      residualRisk: null,
    }),
    capability({
      id: "submit",
      label: "confirmed submit / dialog",
      restrictedLive: restrictedLive.submit,
      localOrControlled: localOrControlled.submit,
      evidenceRef: inputs.productM9Evidence,
      evidence:
        "Product-M9 current evidence 包含 Trego positive.confirmed_submit，confirmedSubmit=1 且有成功 fixture。",
      residualRisk: null,
    }),
    capability({
      id: "state_machine",
      label: "stateMachine transition",
      restrictedLive: restrictedLive.stateMachine,
      localOrControlled: localOrControlled.stateMachine,
      evidenceRef: inputs.flowM12,
      evidence:
        "Flow-M12 corpus r3 通过 local/controlled corpus 报告 stateMachine coverage=true。",
      residualRisk:
        "尚未由当前 Product-M9 evidence set 中的 restricted-live 真实 Figma 样本证明。",
    }),
    capability({
      id: "select_radio_checkbox",
      label: "select/radio/checkbox behavior",
      restrictedLive: restrictedLive.selectRadioCheckbox,
      localOrControlled: localOrControlled.selectRadioCheckbox,
      evidenceRef: controlSmokeEvidenceRef,
      evidence:
        restrictedLive.selectRadioCheckbox
          ? "UI control smoke 在 restricted-live UISpec artifact 上通过 Preview/Playwright 验证了 select/radio/checkbox/switch 类控件行为。"
          : "Flow-M12 corpus r3 通过 local/controlled corpus 报告 selectRadioCheckbox coverage=true。",
      residualRisk:
        restrictedLive.selectRadioCheckbox
          ? "该证据证明真实 UISpec artifact 的 DOM 控件行为，不等同于完整业务 stateMachine 语义。"
          : "尚未由当前 Product-M9 evidence set 中的 restricted-live 真实 Figma 样本证明。",
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
      uiControlSmokeCount: uiControlSmokes.length,
      passedUiControlSmokeCount: passedControlSmokes.length,
      productM9PositiveSampleCount:
        countPositiveProductSamples(productM9, "positive.change_to_variant") +
        countPositiveProductSamples(productM9, "positive.confirmed_submit"),
    },
    capabilities,
    decision:
      status === "passed"
        ? "Current corpus closure 已用 restricted-live evidence 完整证明所需能力。"
        : restrictedLive.selectRadioCheckbox
          ? "Current corpus closure 已用 restricted-live evidence 证明 navigate、CHANGE_TO/set_state、confirmed submit 和 select/radio/checkbox 控件行为；stateMachine 仍只是 local/controlled coverage。"
          : "Current corpus closure 已用 restricted-live evidence 证明 navigate、CHANGE_TO/set_state 和 confirmed submit，但 stateMachine 与 select/radio/checkbox 仍只是 local/controlled coverage。",
    nextActions:
      status === "passed"
        ? ["将此 closure 作为最终项目目标完成审计的输入。"]
        : [
            restrictedLive.selectRadioCheckbox
              ? "补 restricted-live 真实 Figma 样本证明 stateMachine，或明确将 stateMachine 限定为当前交付的 local/controlled coverage。"
              : "补 restricted-live 真实 Figma 样本证明 stateMachine 与 select/radio/checkbox，或明确将它们限定为当前交付的 local/controlled coverage。",
            "完成该裁定后，对完整目标运行最终项目目标完成审计。",
          ],
  };
}

function markdownFor(report) {
  return [
    "# Current corpus closure 当前总账",
    "",
    `- runId: ${report.runId}`,
    `- status: ${report.status}`,
    "",
    "## 结论",
    "",
    report.decision,
    "",
    "## 证据汇总",
    "",
    `- Product-M9 evidence status：${report.evidenceSummary.productM9EvidenceStatus}`,
    `- Product-M9 positive CHANGE_TO/variant：${report.evidenceSummary.productM9PositiveChangeToVariant}`,
    `- Product-M9 positive confirmed submit：${report.evidenceSummary.productM9PositiveConfirmedSubmit}`,
    `- Product-M9 missing/unsupported/failed：${report.evidenceSummary.productM9MissingEvidence}/${report.evidenceSummary.productM9Unsupported}/${report.evidenceSummary.productM9FailedFixture}`,
    `- Flow-M12 status：${report.evidenceSummary.flowM12Status}`,
    `- Flow-M12 restrictedLiveSummary：${report.evidenceSummary.flowM12RestrictedLiveSummary}`,
    `- Flow-M14 status：${report.evidenceSummary.flowM14Status}`,
    `- UI control smoke passed/total：${report.evidenceSummary.passedUiControlSmokeCount}/${report.evidenceSummary.uiControlSmokeCount}`,
    "",
    "## 能力矩阵",
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
    uiControlSmoke: args.uiControlSmoke.map((path) => relativeArtifact(path)),
  };
  const report = buildReport({
    runId: args.runId,
    inputs,
    productM9: await readJson(args.productM9Evidence),
    flowM12: await readJson(args.flowM12),
    flowM14: await readJson(args.flowM14),
    uiControlSmokes: await Promise.all(
      args.uiControlSmoke.map((path) => readJson(path)),
    ),
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
