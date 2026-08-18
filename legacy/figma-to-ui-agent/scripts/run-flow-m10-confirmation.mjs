import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runFlowM10Confirmation } from "../src/flow-plan/m10-runner.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const parsed = {
    mode: "local",
  };
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

function relativeArtifact(path) {
  const ref = relative(projectRoot, resolve(projectRoot, path)) || ".";
  return ref.startsWith("..") ? basename(path) : ref;
}

function reportMarkdown(report) {
  const lines = [
    "# Flow-M10 真实语义补全与用户确认报告",
    "",
    `- runId：${report.input.runId}`,
    `- mode：${report.input.mode}`,
    `- status：${report.status}`,
    `- figmaRestCalled：${report.input.networkBoundary.figmaRestCalled}`,
    `- openaiCalled：${report.input.networkBoundary.openaiCalled}`,
    `- generatedQuestions：${report.counts.generatedQuestions}`,
    `- submitLikeQuestions：${report.counts.submitLikeQuestions}`,
    `- summaryOnlyQuestions：${report.counts.summaryOnlyQuestions}`,
    `- applied：${report.counts.applied}`,
    `- rejected：${report.counts.rejected}`,
    `- invalid：${report.counts.invalid}`,
    `- unmatched：${report.counts.unmatched}`,
    `- userConfirmedSubmit：${report.counts.userConfirmedSubmit}`,
    `- userConfirmedStateMachineTransitions：${report.counts.userConfirmedStateMachineTransitions}`,
    "",
    "## Samples",
    "",
    ...(report.samples.length > 0
      ? report.samples.map(
          (sample) =>
            `- ${sample.sampleId}：questions=${sample.questions} summaryOnly=${sample.summaryOnlyQuestions} applied=${sample.applied} rejected=${sample.rejected}`,
        )
      : ["- 无"]),
    "",
    "## Rejections",
    "",
    ...(report.rejections.length > 0
      ? report.rejections.map(
          (item) => `- ${item.questionId}：${item.reasonCode}`,
        )
      : ["- 无"]),
    "",
    "## Reasons",
    "",
    ...(report.reasons.length > 0
      ? report.reasons.map((reason) => `- ${reason}`)
      : ["- 无"]),
    "",
    "## 残留风险",
    "",
    ...report.residualRisks.map((risk) => `- ${risk}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode !== "local" && args.mode !== "restricted-live-regression") {
    throw new Error(`invalid_mode:${args.mode}`);
  }
  if (!args.flowPlan || !args.uiSpec || !args.answers) {
    throw new Error("missing_required_fixture");
  }
  if (args.allowFigmaNetwork === "true") {
    if (process.env.FLOW_M10_RESTRICTED_LIVE_AUTHORIZED !== "1") {
      throw new Error("flow_m10_figma_network_not_authorized");
    }
    throw new Error("flow_m10_figma_network_refresh_not_implemented");
  }

  const runId =
    args.runId ?? `flow-m10-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const reportRoot = resolve(
    projectRoot,
    args.reportRoot ?? "reports/flow-m10-confirmation",
  );
  const outputRoot = resolve(reportRoot, runId);
  await mkdir(outputRoot, { recursive: true });
  const confirmedFlowPlanPath = resolve(outputRoot, "confirmed-flow-plan.json");
  const confirmedFlowPlanRef = relativeArtifact(confirmedFlowPlanPath);

  const result = runFlowM10Confirmation({
    runId,
    mode: args.mode,
    flowPlanRef: args.flowPlan,
    uiSpecRef: args.uiSpec,
    answerRef: args.answers,
    m9ReportRef: args.m9Report,
    confirmedFlowPlanRef,
    flowPlan: await loadJson(args.flowPlan),
    uiSpec: await loadJson(args.uiSpec),
    answers: await loadJson(args.answers),
    m9Report: args.m9Report ? await loadJson(args.m9Report) : undefined,
  });
  await writeFile(
    confirmedFlowPlanPath,
    `${JSON.stringify(result.flowPlan, null, 2)}\n`,
  );
  await writeFile(
    resolve(outputRoot, "summary.json"),
    `${JSON.stringify(result.report, null, 2)}\n`,
  );
  await writeFile(resolve(outputRoot, "summary.md"), reportMarkdown(result.report));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
