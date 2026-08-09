#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const evidence = {
  currentCorpusClosure:
    "reports/project-completion/current-corpus-closure-v7-20260810t0054/summary.json",
  finalGoalAudit:
    "reports/project-completion/final-goal-completion-audit-20260810t0056/summary.json",
  uiControlSmoke:
    "reports/project-completion/ui-control-smoke-community-mobile-switch-20260810t0046/summary.json",
  stateMachineSmoke:
    "reports/project-completion/state-machine-smoke-trego-navigation-20260810t0053/summary.json",
  productM9Usage: "docs/product-m9-agent-usage.md",
  productM9ManualTest: "docs/product-m9-manual-test.md",
};

const alphaDocs = [
  "docs/alpha-launch-plan.md",
  "docs/alpha-user-guide.md",
  "docs/alpha-troubleshooting.md",
  "docs/alpha-sample-matrix.md",
  "docs/alpha-release-notes.md",
];

const sampleMatrix = [
  {
    id: "trego",
    label: "Trego ride hailing",
    category: "multi-page navigation + submit-like + target backfill",
    required: ["multi_page_navigation", "submit_like", "target_backfill"],
    report:
      "reports/product-m9/product-m9-trego-prototype-gap-declined-20260810t0020/summary.json",
    expectedStatus: "passed",
  },
  {
    id: "cake",
    label: "Cake / food app",
    category: "multi-page navigation",
    required: ["multi_page_navigation"],
    report: "reports/product-m9/cake-navigation-only-passed-20260809t2146/summary.json",
    expectedStatus: "passed",
  },
  {
    id: "community-mobile",
    label: "Community mobile controls",
    category: "CHANGE_TO / variant state",
    required: ["change_to", "visual_node_action"],
    report:
      "reports/product-m9/product-m9-rl-community-mobile-001-20260809t2210/summary.json",
    expectedStatus: "passed",
  },
  {
    id: "nexkart",
    label: "Nexkart ecommerce",
    category: "ecommerce / unsupported action boundary",
    required: ["visual_node_action", "missing_partial"],
    report:
      "reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/summary.json",
    expectedStatus: "partial",
  },
  {
    id: "booking",
    label: "Booking / form-like sample",
    category: "form-like state change + missing target",
    required: ["submit_like", "missing_partial"],
    report:
      "reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/summary.json",
    expectedStatus: "partial",
  },
  {
    id: "design-system",
    label: "Design system component variants",
    category: "component variant + needs confirmation",
    required: ["change_to", "missing_partial"],
    report:
      "reports/product-m9/product-m9-rl-community-design-system-001-20260809t2208/summary.json",
    expectedStatus: "partial",
  },
];

const localGateCommands = [
  { id: "typecheck", command: ["npm", "run", "typecheck"] },
  { id: "unit", command: ["npm", "run", "test:unit"] },
  { id: "integration", command: ["npm", "run", "test:integration"] },
  { id: "e2e", command: ["npm", "run", "test:e2e"] },
  { id: "diff-check", command: ["git", "diff", "--check"] },
];

function parseArgs(argv) {
  const parsed = {
    runId: `alpha-readiness-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase()}`,
    reportRoot: "reports/alpha",
    runLocalGates: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--run-id":
      case "--runId":
        parsed.runId = readArg(argv, index, flag);
        index += 1;
        break;
      case "--report-root":
      case "--reportRoot":
        parsed.reportRoot = readArg(argv, index, flag);
        index += 1;
        break;
      case "--run-local-gates":
        parsed.runLocalGates = true;
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

function readArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/run-alpha-readiness.mjs [options]

生成 Alpha 可上线收口报告。本命令默认只读取本地已提交或已生成证据，不访问
Figma，不调用 OpenAI。

Options:
  --run-local-gates       运行 typecheck、unit、integration、e2e、git diff --check
  --run-id <id>           输出 run id
  --report-root <path>    输出根目录，默认 reports/alpha
  --json                  打印完整 JSON
  --help                  显示帮助
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

async function readText(path) {
  return await readFile(resolve(projectRoot, path), "utf8");
}

function rel(path) {
  return relative(projectRoot, resolve(projectRoot, path)) || ".";
}

function commandLabel(command) {
  return command.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

function runCommand(command) {
  const startedAt = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    command: commandLabel(command),
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

function tail(value) {
  if (!value) {
    return "";
  }
  return value.trim().split("\n").slice(-12).join("\n");
}

function gitValue(args) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function statusFrom(condition, partialReason) {
  if (condition) {
    return { status: "passed" };
  }
  return { status: "partial", reason: partialReason };
}

function alphaPassed(report) {
  return report.alphaConclusion.status === "passed";
}

function buildSampleEvidence(sample, report) {
  const status = report.status ?? "unknown";
  const metrics = report.metrics ?? {};
  const hasExpectedStatus = status === sample.expectedStatus;
  const isExplainedPartial =
    status === "partial" &&
    ((metrics.unsupported ?? 0) > 0 ||
      (metrics.missingEvidence ?? 0) > 0 ||
      (metrics.submitLikeNeedsConfirmation ?? 0) > 0);
  return {
    ...sample,
    status,
    metrics: {
      trustedNavigate: metrics.trustedNavigate ?? 0,
      trustedStateChange: metrics.trustedStateChange ?? 0,
      confirmedSubmit: metrics.confirmedSubmit ?? 0,
      submitLikeNeedsConfirmation: metrics.submitLikeNeedsConfirmation ?? 0,
      unsupported: metrics.unsupported ?? 0,
      missingEvidence: metrics.missingEvidence ?? 0,
      successfulFixtureCount: Array.isArray(metrics.successfulFixtureIds)
        ? metrics.successfulFixtureIds.length
        : 0,
      failedFixtureCount: Array.isArray(metrics.failedFixtureIds)
        ? metrics.failedFixtureIds.length
        : 0,
    },
    readiness:
      hasExpectedStatus && (status !== "partial" || isExplainedPartial) ? "accepted" : "review_needed",
    report: rel(sample.report),
  };
}

function hasAllRequiredCapabilities(samples) {
  const capabilities = new Set(samples.flatMap((sample) => sample.required));
  return [
    "multi_page_navigation",
    "change_to",
    "submit_like",
    "visual_node_action",
    "target_backfill",
    "missing_partial",
  ].every((capability) => capabilities.has(capability));
}

function scanSecrets(items) {
  const findings = [];
  const secretPattern = /(figd_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,}|https:\/\/www\.figma\.com\/design\/[A-Za-z0-9_-]+)/g;
  for (const item of items) {
    const path = resolve(projectRoot, item);
    if (!existsSync(path)) {
      continue;
    }
    const text = spawnSync("rg", ["-n", secretPattern.source, item], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (text.status === 0) {
      findings.push({ path: item, matches: text.stdout.trim().split("\n").slice(0, 20) });
    }
  }
  return findings;
}

function checklistItem(id, label, result, evidenceRefs = []) {
  return {
    id,
    label,
    status: result.status,
    reason: result.reason ?? null,
    evidenceRefs: evidenceRefs.map(rel),
  };
}

function buildMarkdown(report) {
  const rows = report.checklist
    .map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.label} | ${item.reason ?? ""} | ${item.evidenceRefs.join("<br>")} |`,
    )
    .join("\n");
  const samples = report.sampleMatrix
    .map(
      (sample) =>
        `| ${sample.id} | ${sample.status} | ${sample.readiness} | ${sample.category} | ${sample.metrics.successfulFixtureCount} | ${sample.metrics.unsupported} | ${sample.metrics.missingEvidence} | ${sample.report} |`,
    )
    .join("\n");
  const gates = report.localGates.results
    .map((gate) => `| ${gate.id} | ${gate.status} | ${gate.exitCode ?? ""} | ${gate.durationMs ?? ""} |`)
    .join("\n");

  return `# Alpha 可上线收口报告

- runId: \`${report.runId}\`
- 结论: \`${report.alphaConclusion.status}\`
- 口径: ${report.alphaConclusion.reason}
- Git HEAD: \`${report.git.head ?? "unknown"}\`
- Git 工作区: \`${report.git.statusShort || "clean"}\`

## 清单

| ID | 状态 | 项目 | 原因 | 证据 |
| --- | --- | --- | --- | --- |
${rows}

## 固定样本矩阵

| 样本 | 状态 | Alpha 接受度 | 覆盖类别 | 成功 fixture | unsupported | missing | 报告 |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
${samples}

## 本地门禁

| 门禁 | 状态 | exitCode | durationMs |
| --- | --- | ---: | ---: |
${gates || "| not-run | partial |  |  |"}

## 发布说明

Alpha 对应的最终发布身份以包含本报告的提交或 tag 为准。回滚方式见 \`docs/alpha-release-notes.md\`。
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const packageJson = await readJson("package.json");
  const envExample = await readText(".env.example");
  const productUsage = await readText(evidence.productM9Usage);
  const currentCorpus = await readJson(evidence.currentCorpusClosure);
  const finalAudit = await readJson(evidence.finalGoalAudit);
  const uiControlSmoke = await readJson(evidence.uiControlSmoke);
  const stateMachineSmoke = await readJson(evidence.stateMachineSmoke);
  const sampleReports = await Promise.all(sampleMatrix.map((sample) => readJson(sample.report)));
  const sampleEvidence = sampleMatrix.map((sample, index) =>
    buildSampleEvidence(sample, sampleReports[index]),
  );

  const localGateResults = args.runLocalGates
    ? localGateCommands.map((entry) => ({ id: entry.id, ...runCommand(entry.command) }))
    : [];

  const missingDocs = alphaDocs.filter((path) => !existsSync(resolve(projectRoot, path)));
  let secretFindings = scanSecrets(alphaDocs);
  const alphaScriptsPresent =
    packageJson.scripts?.["alpha:readiness"] === "node scripts/run-alpha-readiness.mjs" &&
    packageJson.scripts?.["alpha:gates"] ===
      "node scripts/run-alpha-readiness.mjs --run-local-gates";
  const localGatesPassed =
    args.runLocalGates && localGateResults.every((result) => result.status === "passed");
  const allSamplesAccepted = sampleEvidence.every((sample) => sample.readiness === "accepted");
  const requiredCapabilityCoverage = hasAllRequiredCapabilities(sampleEvidence);
  const docsPresent = missingDocs.length === 0;
  const diagnosticsDocumented = [
    "figma_rate_limited",
    "figma_permission_denied",
    "figma_not_found",
    "unsupported_figma_action",
    "needs_confirmation",
    "partial_evidence",
  ].every((category) => productUsage.includes(category));
  const envComplete = [
    "FIGMA_API_KEY",
    "PRODUCT_M9_FIGMA_AUTHORIZED",
    "OPENAI_API_KEY",
    "PI_OPENAI_MODEL",
    "ALPHA_READINESS_CONFIRMED",
  ].every((key) => envExample.includes(key));

  const checklist = [
    checklistItem(
      "AC1",
      "Alpha 验收标准定义 passed / partial / failed，禁止假通过",
      statusFrom(docsPresent, `missing docs: ${missingDocs.join(", ")}`),
      ["docs/alpha-launch-plan.md"],
    ),
    checklistItem(
      "AC2",
      "泛化样本证据覆盖至少 4-5 个真实 Community 样本和关键能力类型",
      statusFrom(
        sampleEvidence.length >= 5 && allSamplesAccepted && requiredCapabilityCoverage,
        "sample matrix coverage or accepted partial explanation is incomplete",
      ),
      sampleMatrix.map((sample) => sample.report),
    ),
    checklistItem(
      "AC3",
      "目标级完成审计覆盖 Figma REST、DesignBundle、UISpec、FlowPlan、Preview、Playwright、confirmation、报告、失败口径、Git、Worktrail",
      statusFrom(
        currentCorpus.status === "passed" && finalAudit.status === "passed",
        "project completion audit is not passed",
      ),
      [evidence.currentCorpusClosure, evidence.finalGoalAudit],
    ),
    checklistItem(
      "AC4",
      "稳定运行入口清晰，支持 projectId/runId/Figma URL 输入和稳定报告路径",
      statusFrom(alphaScriptsPresent, "alpha npm scripts missing"),
      ["package.json", "scripts/run-product-m9-flow.mjs", "scripts/run-alpha-readiness.mjs"],
    ),
    checklistItem(
      "AC5",
      "配置和密钥管理完整，凭据只从环境读取，报告脱敏",
      statusFrom(envComplete && secretFindings.length === 0, "env example incomplete or secret scan findings exist"),
      [".env.example", ...alphaDocs],
    ),
    checklistItem(
      "AC6",
      "错误诊断和恢复区分 rate limit、权限、不可访问、node missing、unsupported、missing target、needs confirmation",
      statusFrom(diagnosticsDocumented, "Product-M9 error category docs incomplete"),
      [evidence.productM9Usage, "docs/alpha-troubleshooting.md"],
    ),
    checklistItem(
      "AC7",
      "固定回归样本矩阵包含 Trego、Cake、Nexkart、电商/Booking/Design system/component variant",
      statusFrom(sampleEvidence.length >= 5 && requiredCapabilityCoverage, "sample matrix incomplete"),
      ["docs/alpha-sample-matrix.md"],
    ),
    checklistItem(
      "AC8",
      "每次 run 有 summary.md 和 summary.json，报告可读且脱敏",
      statusFrom(
        sampleMatrix.every(
          (sample) =>
            existsSync(resolve(projectRoot, sample.report)) &&
            existsSync(resolve(projectRoot, sample.report.replace(/summary\.json$/, "summary.md"))),
        ),
        "some sample summary.md/json pair is missing",
      ),
      sampleMatrix.map((sample) => sample.report),
    ),
    checklistItem(
      "AC9",
      "Preview 可启动、可查看、可交互，导航、状态切换、表单基本可验证",
      statusFrom(
        uiControlSmoke.status === "passed" && stateMachineSmoke.status === "passed",
        "preview smoke evidence is not passed",
      ),
      [evidence.uiControlSmoke, evidence.stateMachineSmoke, "docs/alpha-user-guide.md"],
    ),
    checklistItem(
      "AC10",
      "测试和安全门禁覆盖 typecheck、unit、integration、e2e、restricted-live matrix、secret scan、脱敏检查",
      statusFrom(localGatesPassed && secretFindings.length === 0, "run npm run alpha:gates before release"),
      ["scripts/run-alpha-readiness.mjs"],
    ),
    checklistItem(
      "AC11",
      "发布与回滚说明存在，最终 commit/tag 在提交后确认",
      statusFrom(docsPresent, "release notes doc missing"),
      ["docs/alpha-release-notes.md"],
    ),
    checklistItem(
      "AC12",
      "Alpha 使用说明、验收报告、已知限制、故障排查、样本矩阵说明已落文档",
      statusFrom(docsPresent, `missing docs: ${missingDocs.join(", ")}`),
      alphaDocs,
    ),
  ];

  const failedItems = checklist.filter((item) => item.status === "failed");
  const partialItems = checklist.filter((item) => item.status === "partial");
  let report = {
    schemaVersion: "1",
    runId: args.runId,
    generatedAt: new Date().toISOString(),
    mode: args.runLocalGates ? "local-gates" : "readiness",
    networkBoundary: {
      figmaRestCalled: false,
      openaiCalled: false,
    },
    git: {
      head: gitValue(["rev-parse", "--short", "HEAD"]),
      statusShort: gitValue(["status", "--short"]) ?? "unknown",
    },
    alphaConclusion: {
      status: failedItems.length === 0 && partialItems.length === 0 ? "passed" : "partial",
      reason:
        failedItems.length === 0 && partialItems.length === 0
          ? "Alpha 可上线；未知真实 Figma 不保证 100% 成功，但 partial/failed 不伪装为 passed。"
          : `Alpha 尚需收口 ${partialItems.length} 个 partial 项；禁止作为最终上线结论。`,
    },
    checklist,
    sampleMatrix: sampleEvidence,
    localGates: {
      requested: args.runLocalGates,
      results: localGateResults,
    },
    secretScan: {
      status: secretFindings.length === 0 ? "passed" : "failed",
      findings: secretFindings,
    },
    evidence,
  };
  report.alphaConclusion.launchable = alphaPassed(report);

  const outputDir = resolve(projectRoot, args.reportRoot, args.runId);
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(outputDir, "summary.md"), buildMarkdown(report));
  secretFindings = scanSecrets([...alphaDocs, rel(outputDir)]);
  if (secretFindings.length > 0) {
    const nextChecklist = report.checklist.map((item) =>
      item.id === "AC5" || item.id === "AC10"
        ? {
            ...item,
            status: "partial",
            reason: "secret scan findings exist",
          }
        : item,
    );
    const failedItems = nextChecklist.filter((item) => item.status === "failed");
    const partialItems = nextChecklist.filter((item) => item.status === "partial");
    report = {
      ...report,
      checklist: nextChecklist,
      secretScan: {
        status: "failed",
        findings: secretFindings,
      },
      alphaConclusion: {
        status: failedItems.length === 0 && partialItems.length === 0 ? "passed" : "partial",
        reason:
          failedItems.length === 0 && partialItems.length === 0
            ? "Alpha 可上线；未知真实 Figma 不保证 100% 成功，但 partial/failed 不伪装为 passed。"
            : `Alpha 尚需收口 ${partialItems.length} 个 partial 项；禁止作为最终上线结论。`,
      },
    };
    report.alphaConclusion.launchable = alphaPassed(report);
    await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outputDir, "summary.md"), buildMarkdown(report));
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      JSON.stringify({
        status: report.alphaConclusion.status,
        launchable: report.alphaConclusion.launchable,
        summaryJson: rel(resolve(outputDir, "summary.json")),
        summaryMarkdown: rel(resolve(outputDir, "summary.md")),
      }),
    );
  }

  if (!report.alphaConclusion.launchable) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
