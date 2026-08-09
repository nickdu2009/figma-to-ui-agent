#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readFlowM9CommunitySampleManifest } from "../src/flow-plan/m9-samples.ts";
import { FigmaRestClient } from "../src/figma/rest-client.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUBMIT_OR_DIALOG_RE =
  /\b(login|log in|sign in|signin|register|sign up|signup|submit|checkout|check out|pay|payment|save|confirm|continue|next|done|send|book|order|place order|invite|modal|dialog|open|close|cancel)\b|登录|注册|提交|支付|付款|结算|保存|确认|下一步|继续|完成|发送|预约|下单|邀请|弹窗|打开|关闭|取消/i;

function printHelp() {
  console.log(`Usage: node scripts/screen-product-m9-candidates.mjs --mode restricted-live --allow-figma-network [options]

Screen Figma Community samples for Product-M9 submit/dialog candidates. The
script uses Figma REST only, never calls OpenAI, never persists raw Figma
responses, and writes redacted reports.

Options:
  --manifest <path>       Sample manifest (default: tests/fixtures/figma/community-sample-manifest.json)
  --sample-ids <ids>      Comma-separated sample IDs; default: all rest_readable_node_selected samples
  --mode <mode>           restricted-live only
  --allow-figma-network   Required network gate
  --max-depth <n>         Max Figma file depth to try, 1..8 (default: 8)
  --reportRoot <path>     Output root (default: reports/product-m9)
  --runId <id>            Output run id
  --json                  Print JSON report
  --help                  Show help

Environment:
  PRODUCT_M9_FIGMA_AUTHORIZED=1
  FIGMA_API_KEY=<token>
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
    manifest: "tests/fixtures/figma/community-sample-manifest.json",
    mode: "restricted-live",
    maxDepth: 8,
    reportRoot: "reports/product-m9",
    json: false,
    allowFigmaNetwork: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--help":
      case "-h":
        return { ...parsed, help: true };
      case "--manifest":
        parsed.manifest = readValue(argv, index, flag);
        index += 1;
        break;
      case "--sample-ids":
      case "--sampleIds":
        parsed.sampleIds = readValue(argv, index, flag)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        index += 1;
        break;
      case "--mode":
        parsed.mode = readValue(argv, index, flag);
        index += 1;
        break;
      case "--allow-figma-network":
        parsed.allowFigmaNetwork = true;
        break;
      case "--max-depth":
      case "--maxDepth":
        parsed.maxDepth = Number(readValue(argv, index, flag));
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
      default:
        throw new Error(`unknown_argument:${flag}`);
    }
  }
  if (parsed.mode !== "restricted-live") {
    throw new Error("product_m9_screening_only_supports_restricted_live");
  }
  if (!Number.isInteger(parsed.maxDepth) || parsed.maxDepth < 1 || parsed.maxDepth > 8) {
    throw new Error("invalid_max_depth");
  }
  return parsed;
}

function assertGate(args) {
  if (!args.allowFigmaNetwork) {
    throw new Error("figma_network_gate_missing");
  }
  if (process.env.PRODUCT_M9_FIGMA_AUTHORIZED !== "1") {
    throw new Error("product_m9_figma_authorization_missing");
  }
  const token = process.env.FIGMA_API_KEY?.trim();
  if (!token) {
    throw new Error("figma_api_key_missing");
  }
  return token;
}

function relativeArtifact(path) {
  return relative(projectRoot, resolve(projectRoot, path)) || ".";
}

function sanitizeMessage(value) {
  return String(value)
    .replace(/figd_[A-Za-z0-9_-]+/g, "[REDACTED_FIGMA_TOKEN]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_TOKEN]")
    .replace(
      /https:\/\/www\.figma\.com\/design\/[^\s"')]+/g,
      "[REDACTED_FIGMA_DESIGN_URL]",
    )
    .slice(0, 2_000);
}

function actionSummary(interactions) {
  const actions = [];
  for (const interaction of interactions ?? []) {
    for (const action of interaction.actions ?? []) {
      actions.push({
        trigger: interaction.trigger?.type ?? "unknown",
        type: action?.type ?? "unknown",
        navigation: action?.navigation ?? "none",
        hasDestination: Boolean(action?.destinationId),
      });
    }
  }
  return actions;
}

function walk(node, ancestors, output) {
  if (!node || typeof node !== "object") {
    return;
  }
  const interactions = Array.isArray(node.interactions)
    ? node.interactions
    : [];
  if (interactions.length > 0) {
    const actions = actionSummary(interactions);
    const text = [node.name, ...ancestors.slice(-5)].filter(Boolean).join(" / ");
    output.push({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      parentTrail: ancestors.slice(-4).join(" > "),
      submitOrDialogLike: SUBMIT_OR_DIALOG_RE.test(text),
      nonChangeToNodeActionWithDestination: actions.some(
        (action) =>
          action.type === "NODE" &&
          action.hasDestination &&
          action.navigation !== "CHANGE_TO",
      ),
      changeToWithDestination: actions.some(
        (action) => action.navigation === "CHANGE_TO" && action.hasDestination,
      ),
      actionSummary: actions,
    });
  }
  for (const child of node.children ?? []) {
    walk(child, [...ancestors, node.name].filter(Boolean), output);
  }
}

async function screenSample(input) {
  const attempts = [];
  for (let depth = 1; depth <= input.maxDepth; depth += 1) {
    try {
      const file = await input.client.getFile(input.sample.fileKey, undefined, {
        depth,
      });
      const nodes = [];
      walk(file.document, [], nodes);
      const submitDialogCandidates = nodes
        .filter(
          (node) =>
            node.submitOrDialogLike &&
            node.nonChangeToNodeActionWithDestination,
        )
        .slice(0, 20)
        .map((node) => ({
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          nodeType: node.nodeType,
          parentTrail: node.parentTrail,
          actionSummary: node.actionSummary,
        }));
      const changeToCandidates = nodes
        .filter((node) => node.changeToWithDestination)
        .slice(0, 20)
        .map((node) => ({
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          nodeType: node.nodeType,
          parentTrail: node.parentTrail,
          actionSummary: node.actionSummary,
        }));
      attempts.push({
        depth,
        interactionNodes: nodes.length,
        submitDialogCandidateCount: submitDialogCandidates.length,
        changeToCandidateCount: changeToCandidates.length,
      });
      if (submitDialogCandidates.length > 0 || depth === input.maxDepth) {
        return {
          sampleId: input.sample.sampleId,
          category: input.sample.category,
          title: input.sample.title,
          status:
            submitDialogCandidates.length > 0
              ? "submit_dialog_candidate"
              : changeToCandidates.length > 0
                ? "change_to_only"
                : "no_submit_dialog_candidate",
          selectedNodeId: input.sample.nodeId ?? null,
          attempts,
          submitDialogCandidates,
          changeToCandidates,
        };
      }
    } catch (error) {
      const message = sanitizeMessage(
        error instanceof Error ? error.message : String(error),
      );
      attempts.push({ depth, error: message });
      if (/响应超过大小上限|response too large/i.test(message)) {
        break;
      }
    }
  }
  return {
    sampleId: input.sample.sampleId,
    category: input.sample.category,
    title: input.sample.title,
    status: "not_screenable",
    selectedNodeId: input.sample.nodeId ?? null,
    attempts,
    submitDialogCandidates: [],
    changeToCandidates: [],
  };
}

function aggregate(samples) {
  return {
    sampleCount: samples.length,
    submitDialogCandidates: samples.filter(
      (sample) => sample.status === "submit_dialog_candidate",
    ).length,
    changeToOnly: samples.filter((sample) => sample.status === "change_to_only")
      .length,
    noSubmitDialogCandidate: samples.filter(
      (sample) => sample.status === "no_submit_dialog_candidate",
    ).length,
    notScreenable: samples.filter((sample) => sample.status === "not_screenable")
      .length,
  };
}

function redactionCheck(value) {
  const serialized = JSON.stringify(value);
  const checks = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/"fileKey"\s*:/, "file_key"],
    [/"designUrl"\s*:/, "design_url"],
    [/"rawResponse"\s*:/, "raw_response"],
    [/\/Users\/[^"]+/, "absolute_path"],
    [/\/var\/folders\/[^"]+/, "absolute_path"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`product_m9_screening_redaction_failed:${reason}`);
    }
  }
}

function markdown(report) {
  const lines = [
    "# Product-M9 candidate screening 报告",
    "",
    `- runId：${report.runId}`,
    `- status：${report.status}`,
    `- sourceRef：${report.sourceRef}`,
    `- sampleCount：${report.aggregate.sampleCount}`,
    `- submitDialogCandidates：${report.aggregate.submitDialogCandidates}`,
    `- changeToOnly：${report.aggregate.changeToOnly}`,
    `- noSubmitDialogCandidate：${report.aggregate.noSubmitDialogCandidate}`,
    `- notScreenable：${report.aggregate.notScreenable}`,
    "",
    "## Samples",
    "",
    "| sampleId | category | status | submitDialogCandidates | changeToCandidates | attempts |",
    "| --- | --- | --- | ---: | ---: | --- |",
    ...report.samples.map((sample) => {
      const attempts = sample.attempts
        .map((attempt) =>
          attempt.error
            ? `d${attempt.depth}:error`
            : `d${attempt.depth}:i${attempt.interactionNodes}`,
        )
        .join(", ");
      return `| ${sample.sampleId} | ${sample.category} | ${sample.status} | ${sample.submitDialogCandidates.length} | ${sample.changeToCandidates.length} | ${attempts} |`;
    }),
    "",
    "## Next Actions",
    "",
    ...report.nextActions.map((action) => `- ${action}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const token = assertGate(args);
  const manifestPath = resolve(projectRoot, args.manifest);
  const manifest = await readFlowM9CommunitySampleManifest(manifestPath);
  const sampleIds = new Set(args.sampleIds ?? []);
  const samples = manifest.samples.filter(
    (sample) =>
      sample.accessStatus === "rest_readable_node_selected" &&
      sample.fileKey &&
      (!args.sampleIds || sampleIds.has(sample.sampleId)),
  );
  if (samples.length < 1) {
    throw new Error("product_m9_screening_no_samples");
  }
  const client = new FigmaRestClient({
    token,
    rateLimitLogger: (event) =>
      console.error(`[figma-rest] ${JSON.stringify(event)}`),
  });
  const sampleReports = [];
  for (const sample of samples) {
    sampleReports.push(
      await screenSample({
        sample,
        client,
        maxDepth: args.maxDepth,
      }),
    );
  }
  const totals = aggregate(sampleReports);
  const status =
    totals.submitDialogCandidates > 0
      ? "candidate_found"
      : totals.changeToOnly > 0
        ? "change_to_only"
        : "no_candidate_found";
  const report = {
    schemaVersion: "1",
    scope: "product_m9_candidate_screening",
    runId:
      args.runId ??
      `product-m9-candidate-screening-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}`,
    status,
    sourceRef: relativeArtifact(manifestPath),
    networkBoundary: {
      figmaRestCalled: true,
      openaiCalled: false,
      rawResponsesPersisted: false,
    },
    aggregate: totals,
    samples: sampleReports,
    nextActions:
      totals.submitDialogCandidates > 0
        ? [
            "选择 submit_dialog_candidate 样本中的 nodeId 跑 Product-M9 restricted-live。",
            "验收 confirmedSubmit > 0、successfulFixtureIds > 0、failedFixtureIds = 0。",
          ]
        : [
            "不要把本批样本当作 confirmed submit/dialog 正向证据。",
            "继续新增 checkout/payment/booking/contact/form Community 样本后重跑 screening。",
          ],
  };
  redactionCheck(report);

  const outputRoot = resolve(projectRoot, args.reportRoot, report.runId);
  const summaryJson = resolve(outputRoot, "summary.json");
  const summaryMarkdown = resolve(outputRoot, "summary.md");
  await mkdir(dirname(summaryJson), { recursive: true });
  await writeFile(summaryJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(summaryMarkdown, markdown(report));
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Product-M9 candidate screening report written to ${relativeArtifact(summaryJson)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
