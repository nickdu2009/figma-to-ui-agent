import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyFlowM8FormSubmitStateMachineToUISpec } from "../src/flow-plan/m8-planner.ts";
import {
  parseFlowM8BehaviorScenario,
} from "../src/flow-plan/m8-scenario.ts";
import {
  parseFlowM8FormSubmitStateMachineReport,
  summarizeFlowM8Validation,
} from "../src/flow-plan/m8-report.ts";
import {
  buildFlowM8FormSubmitStateMachineReport,
} from "../src/flow-plan/m8-runner.ts";
import {
  ProjectStore,
  ProjectStoreError,
} from "../src/project-store/store.ts";
import { RenderAndCompareService } from "../src/validation/render-and-compare.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const parsed = {
    saveUISpec: false,
    runCompare: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--save-ui-spec") {
      parsed.saveUISpec = true;
      continue;
    }
    if (arg === "--run-compare") {
      parsed.runCompare = true;
      continue;
    }
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

function revision(value) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid_revision:${value}`);
  }
  return parsed;
}

async function loadOptionalUISpec(store, projectId, value) {
  try {
    return await store.loadUISpec(projectId, revision(value));
  } catch (error) {
    if (
      error instanceof ProjectStoreError &&
      error.code === "not_found"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function loadOptionalFlowPlan(store, projectId, value) {
  try {
    return await store.loadFlowPlan(projectId, revision(value));
  } catch (error) {
    if (
      error instanceof ProjectStoreError &&
      error.code === "not_found"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function loadScenario(path, projectId) {
  if (!path) {
    return undefined;
  }
  const scenario = parseFlowM8BehaviorScenario(
    JSON.parse(await readFile(resolve(projectRoot, path), "utf8")),
  );
  if (scenario.projectId !== projectId) {
    throw new Error("flow_m8_scenario_project_mismatch");
  }
  return scenario;
}

function defaultComparison(raw) {
  if (!raw) {
    return {
      maxDiffPixelRatio: 1,
      maxDiffPixels: 1_000_000,
      timeoutMs: 10_000,
    };
  }
  return JSON.parse(raw);
}

function reportMarkdown(report) {
  const lines = [
    "# Flow-M8 表单提交与状态机报告",
    "",
    `- projectId：${report.input.projectId}`,
    `- runId：${report.input.runId}`,
    `- status：${report.status}`,
    `- scope：${report.scope}`,
    `- sourceUISpecRevision：${report.input.uiSpecRevision ?? "none"}`,
    `- sourceFlowPlanRevision：${report.input.flowPlanRevision ?? "none"}`,
    `- savedUISpecRevision：${report.input.savedUISpecRevision ?? "none"}`,
    `- trustedSubmitConverted：${report.counts.trustedSubmitConverted}`,
    `- userConfirmedConverted：${report.counts.userConfirmedConverted}`,
    `- stateMachineTransitions：${report.counts.stateMachineTransitions}`,
    `- selectRadioAssertions：${report.counts.selectRadioAssertions}`,
    `- scenarioOnlyFixtures：${report.counts.scenarioOnlyFixtures}`,
    `- unresolved：${report.counts.unresolved}`,
    "",
    "## Converted Actions",
    "",
    ...(report.actions.converted.length > 0
      ? report.actions.converted.map(
          (item) => `- ${item.actionId}：${item.intent}/${item.source}`,
        )
      : ["- 无"]),
    "",
    "## Behavior Fixtures",
    "",
    ...(report.behaviors.fixtures.length > 0
      ? report.behaviors.fixtures.map(
          (item) =>
            `- ${item.fixtureId}：${item.source}${item.intent ? `/${item.intent}` : ""}${item.submit ? "/submit" : ""}${item.stateMachineTransition ? "/transition" : ""}`,
        )
      : ["- 无"]),
    "",
    "## Reasons",
    "",
    ...(report.reasons.length > 0
      ? report.reasons.map((reason) => `- ${reason}`)
      : ["- 无"]),
  ];
  if (report.validation) {
    lines.push(
      "",
      "## Playwright 验证",
      "",
      `- passed：${report.validation.passed}`,
      `- runId：${report.validation.runId}`,
      `- resultCount：${report.validation.resultCount}`,
      `- failedCheckCount：${report.validation.failedCheckCount}`,
      `- successfulFixtureIds：${report.validation.successfulFixtureIds.join(", ") || "none"}`,
      `- failedFixtureIds：${report.validation.failedFixtureIds.join(", ") || "none"}`,
    );
  }
  lines.push(
    "",
    "## 残留风险",
    "",
    ...report.residualRisks.map((risk) => `- ${risk}`),
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) {
    throw new Error("missing_project_id");
  }
  if (args.runCompare && !args.saveUISpec) {
    throw new Error("run_compare_requires_save_ui_spec");
  }

  const dataRoot = resolve(projectRoot, args.dataRoot ?? "data");
  const reportRoot = resolve(
    projectRoot,
    args.reportRoot ?? "reports/flow-m8-form-submit-state-machine",
  );
  const runId =
    args.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputRoot = resolve(reportRoot, runId);
  await mkdir(outputRoot, { recursive: true });

  const store = new ProjectStore(dataRoot);
  const uiSpec = await loadOptionalUISpec(
    store,
    args.projectId,
    args.uiSpecRevision,
  );
  const flowPlan = await loadOptionalFlowPlan(
    store,
    args.projectId,
    args.flowPlanRevision,
  );
  const scenario = await loadScenario(args.scenario, args.projectId);

  if (!uiSpec) {
    throw new Error("flow_m8_ui_spec_missing");
  }
  if (!flowPlan) {
    throw new Error("flow_m8_flow_plan_missing");
  }

  const conversion = applyFlowM8FormSubmitStateMachineToUISpec(
    uiSpec,
    flowPlan,
    scenario,
    {
      viewportId: args.viewportId,
    },
  );

  let savedRevision;
  if (
    args.saveUISpec &&
    (conversion.trustedSubmitConvertedCount > 0 ||
      conversion.stateMachineTransitionCount >= 2)
  ) {
    const saved = await store.saveUISpec({
      projectId: args.projectId,
      baseRevision: uiSpec.revision,
      draft: conversion.uiSpec,
    });
    savedRevision = saved.revision;
  }

  let validation;
  if (
    args.runCompare &&
    savedRevision &&
    conversion.behaviorFixtures.length > 0
  ) {
    const fixtureIds = conversion.behaviorFixtures.map(
      (fixture) => fixture.fixtureId,
    );
    const validationPageIds = [
      ...new Set(
        conversion.uiSpec.behaviorFixtures
          .filter((fixture) => fixtureIds.includes(fixture.id))
          .map((fixture) => fixture.initialPageId),
      ),
    ];
    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath: args.browserExecutablePath
        ? resolve(projectRoot, args.browserExecutablePath)
        : undefined,
      previewPort: args.previewPort ? Number(args.previewPort) : undefined,
      runId: () => runId,
    });
    try {
      validation = await service.render({
        schemaVersion: "1",
        projectId: args.projectId,
        pageIds: validationPageIds,
        viewportIds: [
          args.viewportId ?? conversion.uiSpec.viewports[0].id,
        ],
        behaviorFixtureIds: fixtureIds,
        comparison: defaultComparison(args.comparisonJson),
      });
    } finally {
      await service.close();
    }
  }

  const validationSummary = validation
    ? summarizeFlowM8Validation(validation)
    : undefined;
  const report = parseFlowM8FormSubmitStateMachineReport(
    buildFlowM8FormSubmitStateMachineReport({
      projectId: args.projectId,
      runId,
      flowPlanPath: args.flowPlanPath ?? "project-store/current-flow-plan",
      uiSpecRevision: uiSpec.revision,
      flowPlanRevision: flowPlan.revision,
      savedUISpecRevision: savedRevision,
      figmaInteractionSource: flowPlan.figmaInteractionSource,
      conversion,
      validation: validationSummary,
    }),
  );

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
