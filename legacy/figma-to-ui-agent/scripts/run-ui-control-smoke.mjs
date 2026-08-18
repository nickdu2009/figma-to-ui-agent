#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { summarizeFlowM11Validation } from "../src/flow-plan/m11-report.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import { uiSpecDraftSchema, uiSpecSchema } from "../src/ui-spec/schema.ts";
import { RenderAndCompareService } from "../src/validation/render-and-compare.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBrowserExecutablePath = resolve(
  projectRoot,
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const parsed = {
    dataRoot: "data/ui-control-smoke",
    reportRoot: "reports/project-completion",
    maxPerKind: 3,
    timeoutMs: 10_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--ui-spec":
      case "--uiSpec":
        parsed.uiSpec = readValue(argv, index, flag);
        index += 1;
        break;
      case "--source-ref":
      case "--sourceRef":
        parsed.sourceRef = readValue(argv, index, flag);
        index += 1;
        break;
      case "--run-id":
      case "--runId":
        parsed.runId = readValue(argv, index, flag);
        index += 1;
        break;
      case "--project-id":
      case "--projectId":
        parsed.projectId = readValue(argv, index, flag);
        index += 1;
        break;
      case "--seed-data-root":
      case "--seedDataRoot":
        parsed.seedDataRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--data-root":
      case "--dataRoot":
        parsed.dataRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--report-root":
      case "--reportRoot":
        parsed.reportRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--max-per-kind":
      case "--maxPerKind":
        parsed.maxPerKind = Number(readValue(argv, index, flag));
        index += 1;
        break;
      case "--browser-executable-path":
      case "--browserExecutablePath":
        parsed.browserExecutablePath = readValue(argv, index, flag);
        index += 1;
        break;
      case "--preview-port":
      case "--previewPort":
        parsed.previewPort = Number(readValue(argv, index, flag));
        index += 1;
        break;
      case "--timeout-ms":
      case "--timeoutMs":
        parsed.timeoutMs = Number(readValue(argv, index, flag));
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
  if (!parsed.help && !parsed.uiSpec) {
    throw new Error("ui_control_smoke_ui_spec_missing");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/run-ui-control-smoke.mjs --ui-spec <path> [options]

从真实 UISpec artifact 生成 input/select/radio/checkbox/switch 控件 smoke fixture，
并通过 Preview/Playwright 验证真实 DOM 控件行为。本命令不调用 Figma 或 OpenAI。

选项:
  --ui-spec <path>              输入 UISpec artifact
  --source-ref <path>           报告中记录的来源 summary/report ref
  --run-id <id>                 输出 run id
  --project-id <id>             临时 ProjectStore project id
  --seed-data-root <path>       原始 data root，默认使用 data
  --max-per-kind <n>            每类控件最多生成多少个 fixture
  --json                        输出报告 JSON
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function relativeRef(path) {
  const ref = relative(projectRoot, resolve(projectRoot, path));
  if (ref.startsWith("..")) {
    throw new Error("ui_control_smoke_ref_outside_project");
  }
  return ref || ".";
}

function draftFromUISpec(raw) {
  const parsed = uiSpecSchema.safeParse(raw);
  const source = parsed.success ? parsed.data : uiSpecDraftSchema.parse(raw);
  const cloned = structuredClone(source);
  delete cloned.revision;
  return uiSpecDraftSchema.parse(cloned);
}

function childIdsForNode(node) {
  if (!node) {
    return [];
  }
  const direct = "childIds" in node ? node.childIds : [];
  const tabs = node.kind === "tabs" ? node.tabs.flatMap((tab) => tab.childIds) : [];
  return [...direct, ...tabs];
}

function nodePageMap(uiSpec) {
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const result = new Map();
  const visit = (nodeId, pageId) => {
    if (result.has(nodeId)) {
      return;
    }
    result.set(nodeId, pageId);
    for (const childId of childIdsForNode(nodeById.get(nodeId))) {
      visit(childId, pageId);
    }
  };
  for (const page of uiSpec.pages) {
    visit(page.rootNodeId, page.id);
  }
  return result;
}

function stateInitialValue(uiSpec, stateKey) {
  return uiSpec.state.find((state) => state.key === stateKey)?.initialValue;
}

function stepForNode(uiSpec, node) {
  if (node.kind === "input" || node.kind === "textarea") {
    const value =
      node.kind === "textarea"
        ? "UI control smoke note"
        : node.inputType === "email"
          ? "ui-control-smoke@example.com"
          : node.inputType === "password"
            ? "UiControlSmoke1"
            : "UI control smoke";
    return {
      steps: [
        { kind: "fill", nodeId: node.id, value },
        { kind: "expect_value", nodeId: node.id, value },
      ],
      capability: "fill",
    };
  }
  if (node.kind === "select") {
    const initialValue = stateInitialValue(uiSpec, node.stateKey);
    const initialOption =
      typeof initialValue === "string" && initialValue.trim()
        ? initialValue
        : undefined;
    const value = initialOption ?? node.options[0]?.value;
    if (!value) {
      return undefined;
    }
    return {
      steps: [
        { kind: "select_option", nodeId: node.id, value },
        { kind: "expect_selected", nodeId: node.id, value },
      ],
      capability: "select",
    };
  }
  if (node.kind === "radio") {
    return {
      steps: [
        { kind: "choose_radio", nodeId: node.id, value: node.value },
        { kind: "expect_selected", nodeId: node.id, value: node.value },
      ],
      capability: "radio",
    };
  }
  if (node.kind === "checkbox" || node.kind === "switch") {
    const initial = stateInitialValue(uiSpec, node.stateKey);
    const checked = typeof initial === "boolean" ? !initial : true;
    return {
      steps: [
        { kind: "toggle", nodeId: node.id },
        { kind: "expect_checked", nodeId: node.id, checked },
      ],
      capability: node.kind,
    };
  }
  return undefined;
}

function safeId(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "ui-control"
  );
}

function buildFixtures(uiSpec, maxPerKind) {
  const pageByNodeId = nodePageMap(uiSpec);
  const viewport = uiSpec.viewports[0];
  if (!viewport) {
    throw new Error("ui_control_smoke_viewport_missing");
  }
  const perKind = new Map();
  const fixtures = [];
  for (const node of uiSpec.nodes) {
    if (
      !["input", "textarea", "select", "radio", "checkbox", "switch"].includes(
        node.kind,
      ) ||
      node.disabled === true
    ) {
      continue;
    }
    const current = perKind.get(node.kind) ?? 0;
    if (current >= maxPerKind) {
      continue;
    }
    const pageId = pageByNodeId.get(node.id);
    const planned = stepForNode(uiSpec, node);
    if (!pageId || !planned) {
      continue;
    }
    perKind.set(node.kind, current + 1);
    fixtures.push({
      id: `ui-control-${safeId(node.kind)}-${safeId(node.id)}-fixture`,
      name: `UI control smoke ${node.kind}`,
      viewportId: viewport.id,
      initialPageId: pageId,
      steps: planned.steps,
      capability: planned.capability,
      nodeId: node.id,
      nodeKind: node.kind,
    });
  }
  return fixtures;
}

async function createReferencePng(browserExecutablePath, width, height) {
  const browser = await chromium.launch({
    executablePath: browserExecutablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(
      `<body style="margin:0"><main style="width:${width}px;height:${height}px;background:#fff"></main></body>`,
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

function sourceHash(sourceId) {
  return createHash("sha256").update(sourceId).digest("hex");
}

async function createSyntheticDesignBundle({
  store,
  projectId,
  uiSpec,
  browserExecutablePath,
}) {
  const viewport = uiSpec.viewports[0];
  const screenshot = await store.saveLocalImage({
    projectId,
    kind: "screenshots",
    bytes: await createReferencePng(
      browserExecutablePath,
      viewport.width,
      viewport.height,
    ),
  });
  const sourcePageIds = [
    ...new Set(uiSpec.pages.map((page) => page.sourcePageId)),
  ];
  return {
    schemaVersion: "1",
    projectId,
    source: {
      provider: "figma_rest",
      fileKeyHash: "c".repeat(64),
      targetNodeIds: sourcePageIds,
      inspectedAt: "2026-08-10T00:00:00.000Z",
    },
    capabilities: {
      variables: {
        status: "unavailable_optional",
        reasonCode: "unknown",
      },
    },
    pages: sourcePageIds.map((sourcePageId) => ({
      id: sourcePageId,
      name:
        uiSpec.pages.find((page) => page.sourcePageId === sourcePageId)
          ?.title ?? sourcePageId,
      width: viewport.width,
      height: viewport.height,
      rootNodeIds: [`figma-${sourcePageId}-root`],
      nodes: [
        {
          id: `figma-${sourcePageId}-root`,
          kind: "container",
          name: sourcePageId,
          visible: true,
          styleRefs: [],
          imageRefs: [],
          boundVariableRefs: [],
          designValueRefs: [],
          warningCodes: [],
        },
      ],
    })),
    components: [],
    styles: [],
    designValues: [],
    screenshots: [screenshot],
    assets: [],
    fonts: [],
    provenance: sourcePageIds.flatMap((sourcePageId) => {
      const hash = sourceHash(sourcePageId);
      return [
        {
          entityKind: "page",
          entityId: sourcePageId,
          origin: "figma_node",
          sourceIdHash: hash,
        },
        {
          entityKind: "screenshot",
          entityId: screenshot.path,
          origin: "figma_node",
          sourceIdHash: hash,
        },
      ];
    }),
    warnings: [],
  };
}

async function renderFixture({ runId, dataRoot, store, browserExecutablePath, previewPort, projectId, uiSpec, fixtureId, fixtureIndex, timeoutMs }) {
  const service = new RenderAndCompareService({
    dataRoot,
    projectStore: store,
    browserExecutablePath,
    previewPort,
    runId: () => `${safeId(runId).slice(0, 118)}-f${fixtureIndex}`,
  });
  try {
    return await service.render({
      schemaVersion: "1",
      projectId,
      pageIds: [uiSpec.behaviorFixtures.find((fixture) => fixture.id === fixtureId).initialPageId],
      viewportIds: [uiSpec.viewports[0].id],
      behaviorFixtureIds: [fixtureId],
      comparison: {
        maxDiffPixelRatio: 1,
        maxDiffPixels: Number.MAX_SAFE_INTEGER,
        timeoutMs,
      },
    });
  } finally {
    await service.close();
  }
}

async function seedStoreFromSourceProject({
  dataRoot,
  seedDataRoot,
  sourceProjectId,
  projectId,
}) {
  if (projectId !== sourceProjectId) {
    return false;
  }
  const sourceProjectRoot = resolve(projectRoot, seedDataRoot, "projects", sourceProjectId);
  if (!(await pathExists(sourceProjectRoot))) {
    return false;
  }
  const targetProjectRoot = resolve(dataRoot, "projects", projectId);
  await mkdir(dirname(targetProjectRoot), { recursive: true });
  await cp(sourceProjectRoot, targetProjectRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  return true;
}

function countBy(values, key) {
  const result = {};
  for (const value of values) {
    result[value[key]] = (result[value[key]] ?? 0) + 1;
  }
  return result;
}

async function readSourceSummary(sourceRef) {
  if (!sourceRef) {
    return undefined;
  }
  const source = await readJson(sourceRef);
  return {
    status: source.status,
    mode: source.mode,
    projectId: source.projectId,
    ok: source.ok,
  };
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
      throw new Error(`ui_control_smoke_redaction_failed:${reason}`);
    }
  }
}

function markdownFor(report) {
  return `${[
    "# UI control smoke 验证报告",
    "",
    `- runId：${report.runId}`,
    `- status：${report.status}`,
    `- sourceRef：${report.sourceRef ?? "none"}`,
    `- uiSpecRef：${report.uiSpecRef}`,
    `- fixtureCount：${report.counts.fixtureCount}`,
    `- successfulFixtureCount：${report.counts.successfulFixtureCount}`,
    `- failedFixtureCount：${report.counts.failedFixtureCount}`,
    "",
    "## 能力覆盖",
    "",
    ...Object.entries(report.coverage).map(([key, value]) => `- ${key}：${value}`),
    "",
    "## Fixtures",
    "",
    ...report.fixtures.map(
      (fixture) =>
        `- ${fixture.fixtureId}：${fixture.nodeKind}/${fixture.capability} ${fixture.status}`,
    ),
    "",
    "## 结论",
    "",
    report.decision,
  ].join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const runId =
    args.runId ?? `ui-control-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const rawUISpec = await readJson(args.uiSpec);
  const sourceUISpec = draftFromUISpec(rawUISpec);
  const projectId = args.projectId ?? sourceUISpec.projectId;
  const uiSpec = uiSpecDraftSchema.parse({
    ...sourceUISpec,
    projectId,
    behaviorFixtures: [],
  });
  const plannedFixtures = buildFixtures(uiSpec, args.maxPerKind);
  const fixtureIds = plannedFixtures.map((fixture) => fixture.id);
  const fixturesForSpec = plannedFixtures.map(({ capability: _capability, nodeKind: _nodeKind, nodeId: _nodeId, ...fixture }) => fixture);
  const uiSpecWithFixtures = uiSpecDraftSchema.parse({
    ...uiSpec,
    behaviorFixtures: fixturesForSpec,
  });
  const dataRoot = resolve(projectRoot, args.dataRoot, runId);
  const reportRoot = resolve(projectRoot, args.reportRoot, runId);
  const browserExecutablePath = resolve(
    projectRoot,
    args.browserExecutablePath ?? defaultBrowserExecutablePath,
  );
  await mkdir(reportRoot, { recursive: true });

  const store = new ProjectStore(dataRoot);
  const usedSeedStore = await seedStoreFromSourceProject({
    dataRoot,
    seedDataRoot: args.seedDataRoot ?? "data",
    sourceProjectId: sourceUISpec.projectId,
    projectId,
  });
  if (!usedSeedStore) {
    await store.saveDesignBundle({
      projectId,
      baseRevision: 0,
      draft: await createSyntheticDesignBundle({
        store,
        projectId,
        uiSpec: uiSpecWithFixtures,
        browserExecutablePath,
      }),
    });
  }
  const existingSpec = usedSeedStore ? await store.loadUISpec(projectId) : undefined;
  await store.saveUISpec({
    projectId,
    baseRevision: existingSpec?.revision ?? 0,
    draft: uiSpecWithFixtures,
  });

  const outputs = [];
  for (const [fixtureIndex, fixtureId] of fixtureIds.entries()) {
    outputs.push(
      await renderFixture({
        runId,
        dataRoot,
        store,
        browserExecutablePath,
        previewPort: args.previewPort,
        projectId,
        uiSpec: uiSpecWithFixtures,
        fixtureId,
        fixtureIndex,
        timeoutMs: args.timeoutMs,
      }),
    );
  }
  const validation = summarizeFlowM11Validation(
    {
      schemaVersion: "1",
      runId,
      passed: outputs.every((output) => output.passed),
      results: outputs.flatMap((output) => output.results),
    },
    { fixtureIds },
  );
  const fixtureReports = plannedFixtures.map((fixture) => ({
    fixtureId: fixture.id,
    nodeId: fixture.nodeId,
    nodeKind: fixture.nodeKind,
    capability: fixture.capability,
    status: validation.failedFixtureIds.includes(fixture.id)
      ? "failed"
      : validation.successfulFixtureIds.includes(fixture.id)
        ? "passed"
        : "not_run",
  }));
  const coverage = {
    fill: fixtureReports.some((fixture) => fixture.capability === "fill" && fixture.status === "passed"),
    select: fixtureReports.some((fixture) => fixture.capability === "select" && fixture.status === "passed"),
    radio: fixtureReports.some((fixture) => fixture.capability === "radio" && fixture.status === "passed"),
    checkbox: fixtureReports.some((fixture) => fixture.capability === "checkbox" && fixture.status === "passed"),
    switch: fixtureReports.some((fixture) => fixture.capability === "switch" && fixture.status === "passed"),
    selectRadioCheckbox:
      fixtureReports.some(
        (fixture) =>
          ["select", "radio", "checkbox", "switch"].includes(fixture.capability) &&
          fixture.status === "passed",
      ),
  };
  const report = {
    schemaVersion: "1",
    scope: "ui_control_smoke",
    runId,
    status:
      validation.failedFixtureIds.length === 0 && validation.successfulFixtureIds.length > 0
        ? "passed"
        : validation.successfulFixtureIds.length > 0
          ? "partial"
          : "failed",
    sourceRef: args.sourceRef ? relativeRef(args.sourceRef) : undefined,
    sourceSummary: await readSourceSummary(args.sourceRef),
    uiSpecRef: relativeRef(args.uiSpec),
    networkBoundary: {
      figmaRestCalled: false,
      openaiCalled: false,
      mode: "local-validation-of-restricted-live-artifact",
    },
    counts: {
      fixtureCount: fixtureReports.length,
      successfulFixtureCount: validation.successfulFixtureIds.length,
      failedFixtureCount: validation.failedFixtureIds.length,
      failedCheckCount: validation.failedCheckCount,
      preSatisfiedExpectationCount: validation.preSatisfiedExpectationCount,
      byNodeKind: countBy(fixtureReports, "nodeKind"),
    },
    coverage,
    fixtures: fixtureReports,
    artifactRefs: {
      generatedUISpecPath: `data/ui-control-smoke/${runId}/projects/${projectId}/specs/current.json`,
      summaryJson: `${relative(projectRoot, reportRoot)}/summary.json`,
      summaryMarkdown: `${relative(projectRoot, reportRoot)}/summary.md`,
    },
    decision:
      validation.failedFixtureIds.length === 0 && coverage.selectRadioCheckbox
        ? "真实 UISpec artifact 中的控件语义已通过 Preview/Playwright smoke 验证，可作为 select/radio/checkbox 类 UI 控件行为证据。"
        : "UI 控件 smoke 未完整通过，不能作为 select/radio/checkbox 类 UI 控件行为证据。",
  };
  redactionCheck(report);
  await writeFile(
    resolve(reportRoot, "summary.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(resolve(reportRoot, "summary.md"), markdownFor(report));
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`UI control smoke report written to ${relative(projectRoot, reportRoot)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
