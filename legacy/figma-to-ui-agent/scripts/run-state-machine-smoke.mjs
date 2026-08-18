#!/usr/bin/env node

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseFlowM8FormSubmitStateMachineReport,
  summarizeFlowM8Validation,
} from "../src/flow-plan/m8-report.ts";
import { parseFlowPlanDraft } from "../src/flow-plan/schema.ts";
import { ProjectStore } from "../src/project-store/store.ts";
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
    dataRoot: "data/state-machine-smoke",
    seedDataRoot: "data",
    reportRoot: "reports/project-completion",
    maxTransitions: 2,
    timeoutMs: 10_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--project-id":
      case "--projectId":
        parsed.projectId = readValue(argv, index, flag);
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
      case "--data-root":
      case "--dataRoot":
        parsed.dataRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--seed-data-root":
      case "--seedDataRoot":
        parsed.seedDataRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--report-root":
      case "--reportRoot":
        parsed.reportRoot = readValue(argv, index, flag);
        index += 1;
        break;
      case "--max-transitions":
      case "--maxTransitions":
        parsed.maxTransitions = Number(readValue(argv, index, flag));
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
  if (!parsed.help && !parsed.projectId) {
    throw new Error("state_machine_smoke_project_id_missing");
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/run-state-machine-smoke.mjs --project-id <id> [options]

从真实 restricted-live FlowPlan 的已确认 Figma navigate interactions 派生临时
stateMachine，并通过 Preview/Playwright 验证 transition fixtures。本命令不调用
Figma 或 OpenAI，不修改原始 data/projects。

选项:
  --project-id <id>             输入 ProjectStore project id
  --source-ref <path>           restricted-live 来源 summary/report ref
  --run-id <id>                 输出 run id
  --max-transitions <n>         派生多少个 transition，默认 2
  --json                        输出报告 JSON
`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

function relativeRef(path) {
  const ref = relative(projectRoot, resolve(projectRoot, path));
  if (ref.startsWith("..")) {
    throw new Error("state_machine_smoke_ref_outside_project");
  }
  return ref || ".";
}

function safeId(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "state"
  );
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

function chooseTransitions(flowPlan, maxTransitions) {
  return flowPlan.interactions
    .filter(
      (interaction) =>
        interaction.source === "figma" &&
        interaction.confirmed === true &&
        interaction.intent === "navigate" &&
        interaction.fromPageId &&
        interaction.targetPageId,
    )
    .slice(0, maxTransitions);
}

function stateId(pageId) {
  return `state-${safeId(pageId)}`;
}

function deriveStateMachine(flowPlan, selected) {
  if (selected.length < 2) {
    throw new Error("state_machine_smoke_not_enough_transitions");
  }
  const pageIds = [
    ...new Set(
      selected.flatMap((interaction) => [
        interaction.fromPageId,
        interaction.targetPageId,
      ]),
    ),
  ];
  const transitions = selected.map((interaction) => {
    const id = `transition-${safeId(interaction.id)}`;
    return {
      id,
      from: stateId(interaction.fromPageId),
      to: stateId(interaction.targetPageId),
      triggerInteractionId: interaction.id,
      postconditions: [
        { kind: "expect_page", pageId: interaction.targetPageId },
      ],
    };
  });
  const transitionByInteractionId = new Map(
    selected.map((interaction, index) => [
      interaction.id,
      transitions[index].id,
    ]),
  );
  const draft = structuredClone(flowPlan);
  delete draft.revision;
  draft.interactions = draft.interactions.map((interaction) => {
    const transitionId = transitionByInteractionId.get(interaction.id);
    return transitionId
      ? {
          ...interaction,
          stateMachineTransitionId: transitionId,
          postconditions: [
            { kind: "expect_page", pageId: interaction.targetPageId },
          ],
        }
      : interaction;
  });
  draft.stateMachines = [
    {
      id: "smoke-figma-prototype-navigation",
      initialState: stateId(selected[0].fromPageId),
      states: pageIds.map((pageId) => ({
        id: stateId(pageId),
        pageId,
      })),
      transitions,
    },
  ];
  return parseFlowPlanDraft(draft);
}

async function seedProject({ dataRoot, seedDataRoot, projectId }) {
  const sourceProjectRoot = resolve(projectRoot, seedDataRoot, "projects", projectId);
  const targetProjectRoot = resolve(dataRoot, "projects", projectId);
  await mkdir(dirname(targetProjectRoot), { recursive: true });
  await cp(sourceProjectRoot, targetProjectRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
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
      throw new Error(`state_machine_smoke_redaction_failed:${reason}`);
    }
  }
}

function markdownFor(report) {
  return `${[
    "# StateMachine smoke 验证报告",
    "",
    `- runId：${report.runId}`,
    `- status：${report.status}`,
    `- sourceRef：${report.sourceRef ?? "none"}`,
    `- sourceMode：${report.sourceSummary?.mode ?? "none"}`,
    `- transitionCount：${report.counts.transitionCount}`,
    `- successfulFixtureCount：${report.counts.successfulFixtureCount}`,
    `- failedFixtureCount：${report.counts.failedFixtureCount}`,
    "",
    "## Transitions",
    "",
    ...report.transitions.map(
      (transition) =>
        `- ${transition.transitionId}：${transition.fromPageId} -> ${transition.targetPageId} ${transition.fixtureStatus}`,
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
    args.runId ?? `state-machine-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dataRoot = resolve(projectRoot, args.dataRoot, runId);
  const reportRoot = resolve(projectRoot, args.reportRoot, runId);
  await mkdir(reportRoot, { recursive: true });
  await seedProject({
    dataRoot,
    seedDataRoot: args.seedDataRoot,
    projectId: args.projectId,
  });

  const store = new ProjectStore(dataRoot);
  const [uiSpec, flowPlan] = await Promise.all([
    store.loadUISpec(args.projectId),
    store.loadFlowPlan(args.projectId),
  ]);
  const selected = chooseTransitions(flowPlan, args.maxTransitions);
  const derivedFlowPlan = deriveStateMachine(flowPlan, selected);
  const savedFlowPlan = await store.saveFlowPlan({
    projectId: args.projectId,
    baseRevision: flowPlan.revision,
    draft: derivedFlowPlan,
  });
  const fixtureIds = selected.map(
    (interaction) => `flow-${safeId(interaction.id)}-fixture`,
  );
  const outputs = [];
  for (const [fixtureIndex, fixtureId] of fixtureIds.entries()) {
    const fixture = uiSpec.behaviorFixtures.find(
      (candidate) => candidate.id === fixtureId,
    );
    if (!fixture) {
      throw new Error(`state_machine_smoke_fixture_missing:${fixtureId}`);
    }
    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: resolve(
        projectRoot,
        args.browserExecutablePath ?? defaultBrowserExecutablePath,
      ),
      previewPort: args.previewPort,
      runId: () => `${safeId(runId).slice(0, 118)}-f${fixtureIndex}`,
    });
    try {
      outputs.push(
        await service.render({
          schemaVersion: "1",
          projectId: args.projectId,
          pageIds: [fixture.initialPageId],
          viewportIds: [fixture.viewportId],
          behaviorFixtureIds: [fixtureId],
          comparison: {
            maxDiffPixelRatio: 1,
            maxDiffPixels: Number.MAX_SAFE_INTEGER,
            timeoutMs: args.timeoutMs,
          },
        }),
      );
    } finally {
      await service.close();
    }
  }
  const combinedValidation = {
    schemaVersion: "1",
    runId,
    previewUrl: outputs[0]?.previewUrl ?? "http://127.0.0.1:5173/",
    passed: outputs.every((output) => output.passed),
    results: outputs.flatMap((output) => output.results),
  };
  const validationSummary = summarizeFlowM8Validation(combinedValidation);
  const converted = selected.map((interaction) => ({
    interactionId: interaction.id,
    actionId: `flow-${safeId(interaction.id)}`,
    intent: interaction.intent,
    trusted: true,
    source: interaction.source,
  }));
  const behaviorFixtures = fixtureIds.map((fixtureId) => ({
    fixtureId,
    source: "flow_plan",
    intent: "navigate",
    submit: false,
    stateMachineTransition: true,
    selectRadioAssertionCount: 0,
  }));
  const m8Report = parseFlowM8FormSubmitStateMachineReport(
    {
      schemaVersion: "1",
      milestone: "Flow-M8",
      scope: "form_submit_state_machine",
      status: validationSummary.passed ? "passed" : "failed",
      input: {
        projectId: args.projectId,
        runId,
        flowPlanPath: "state-machine-smoke-derived-flow-plan",
        uiSpecRevision: uiSpec.revision,
        flowPlanRevision: savedFlowPlan.revision,
        savedUISpecRevision: uiSpec.revision,
        figmaInteractionSource: savedFlowPlan.figmaInteractionSource,
      },
      actions: {
        converted,
        rejected: [],
      },
      behaviors: {
        fixtures: behaviorFixtures,
      },
      counts: {
        trustedSubmitConverted: 0,
        userConfirmedConverted: 0,
        stateMachineTransitions: selected.length,
        selectRadioAssertions: 0,
        scenarioOnlyFixtures: 0,
        unresolved: 0,
      },
      validation: validationSummary,
      reasons: validationSummary.passed ? [] : ["state_machine_smoke_validation_failed"],
      residualRisks: [
        "stateMachine smoke 证明 Figma prototype navigation graph 可作为有限状态迁移执行，不表示真实后端业务状态已持久化。",
      ],
    },
  );
  const successful = new Set(validationSummary.successfulFixtureIds);
  const failed = new Set(validationSummary.failedFixtureIds);
  const transitionById = new Map(
    savedFlowPlan.stateMachines[0].transitions.map((transition) => [
      transition.id,
      transition,
    ]),
  );
  const transitions = selected.map((interaction) => {
    const transitionId = interaction.stateMachineTransitionId
      ? interaction.stateMachineTransitionId
      : `transition-${safeId(interaction.id)}`;
    const fixtureId = `flow-${safeId(interaction.id)}-fixture`;
    const transition = transitionById.get(transitionId);
    return {
      interactionId: interaction.id,
      transitionId,
      fixtureId,
      fromPageId: interaction.fromPageId,
      targetPageId: interaction.targetPageId,
      postconditions: transition?.postconditions ?? [],
      fixtureStatus: failed.has(fixtureId)
        ? "failed"
        : successful.has(fixtureId)
          ? "passed"
          : "not_run",
    };
  });
  const passed =
    m8Report.status === "passed" &&
    validationSummary.passed &&
    transitions.every((transition) => transition.fixtureStatus === "passed");
  const report = {
    schemaVersion: "1",
    scope: "state_machine_smoke",
    runId,
    status: passed ? "passed" : "failed",
    sourceRef: args.sourceRef ? relativeRef(args.sourceRef) : undefined,
    sourceSummary: await readSourceSummary(args.sourceRef),
    projectId: args.projectId,
    networkBoundary: {
      figmaRestCalled: false,
      openaiCalled: false,
      mode: "local-validation-of-restricted-live-artifact",
    },
    derivation: {
      source: "figma_prototype_navigation_graph",
      stateMachineId: savedFlowPlan.stateMachines[0].id,
      flowPlanRevision: savedFlowPlan.revision,
      uiSpecRevision: uiSpec.revision,
    },
    counts: {
      transitionCount: transitions.length,
      stateMachineTransitionCount: m8Report.counts.stateMachineTransitions,
      successfulFixtureCount: validationSummary.successfulFixtureIds.length,
      failedFixtureCount: validationSummary.failedFixtureIds.length,
      failedCheckCount: validationSummary.failedCheckCount,
    },
    transitions,
    artifactRefs: {
      generatedFlowPlanPath: `data/state-machine-smoke/${runId}/projects/${args.projectId}/flow/current.json`,
      generatedUISpecPath: `data/state-machine-smoke/${runId}/projects/${args.projectId}/specs/current.json`,
      summaryJson: `${relative(projectRoot, reportRoot)}/summary.json`,
      summaryMarkdown: `${relative(projectRoot, reportRoot)}/summary.md`,
    },
    m8Report,
    decision: passed
      ? "真实 restricted-live Figma prototype navigation graph 已派生为临时 stateMachine，并通过 Preview/Playwright transition fixture 验证。"
      : "stateMachine smoke 未通过，不能作为 restricted-live stateMachine 证据。",
  };
  redactionCheck(report);
  await writeFile(resolve(reportRoot, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(reportRoot, "summary.md"), markdownFor(report));
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`StateMachine smoke report written to ${relative(projectRoot, reportRoot)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
