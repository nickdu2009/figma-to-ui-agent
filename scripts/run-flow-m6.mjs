import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseFlowM6RouteExecutionReport,
  summarizeFlowM6Validation,
} from "../src/flow-plan/m6-report.ts";
import { applyFlowM6RouteExecutionToUISpec } from "../src/flow-plan/route-execution.ts";
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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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

function reportMarkdown(report) {
  const lines = [
    "# Flow-M6 路由与 Flow 执行验证报告",
    "",
    `- projectId：${report.projectId}`,
    `- runId：${report.runId}`,
    `- status：${report.status}`,
    `- scope：${report.scope}`,
    `- sourceDesignBundleRevision：${report.sourceDesignBundleRevision}`,
    `- sourceUISpecRevision：${report.sourceUISpecRevision ?? "none"}`,
    `- sourceFlowPlanRevision：${report.sourceFlowPlanRevision ?? "none"}`,
    `- savedUISpecRevision：${report.savedUISpecRevision ?? "none"}`,
    `- routeCount：${report.routeCount}`,
    `- navigateActionCount：${report.navigateActionCount}`,
    `- behaviorFixtureCount：${report.behaviorFixtureCount}`,
    "",
    "## Converted Navigate Actions",
    "",
    ...(report.convertedNavigateActionIds.length > 0
      ? report.convertedNavigateActionIds.map((id) => `- ${id}`)
      : ["- 无"]),
    "",
    "## Behavior Fixtures",
    "",
    ...(report.behaviorFixtureIds.length > 0
      ? report.behaviorFixtureIds.map((id) => `- ${id}`)
      : ["- 无"]),
    "",
    "## 未解决交互",
    "",
    ...(report.unresolvedInteractions.length > 0
      ? report.unresolvedInteractions.map(
          (item) =>
            `- ${item.id}：${item.source}/${item.intent}，${item.blockedReason ?? item.reason}`,
        )
      : ["- 无"]),
  ];
  if (report.insufficientReason) {
    lines.push("", "## 条件不足", "", `- ${report.insufficientReason}`);
  }
  if (report.validation) {
    lines.push(
      "",
      "## Playwright 验证",
      "",
      `- passed：${report.validation.passed}`,
      `- runId：${report.validation.runId}`,
      `- resultCount：${report.validation.resultCount}`,
      `- failedCheckCount：${report.validation.failedCheckCount}`,
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

function insufficientReason({
  uiSpec,
  flowPlan,
  convertedNavigateActionCount,
  validation,
  runCompare,
}) {
  if (!flowPlan) {
    return "不满足 Flow-M6 条件：项目没有当前 FlowPlan。";
  }
  if (!uiSpec) {
    return "不满足 Flow-M6 条件：项目没有当前 UISpec。";
  }
  if (uiSpec.pages.length < 2) {
    return "不满足 Flow-M6 条件：UISpec 少于两个页面。";
  }
  if (convertedNavigateActionCount < 1) {
    return "不满足 Flow-M6 条件：没有可信 navigate interaction 被转换。";
  }
  if (runCompare && !validation) {
    return "不满足 Flow-M6 验证条件：没有可执行的 behavior fixture。";
  }
  return undefined;
}

function reportStatus({
  convertedNavigateActionCount,
  validation,
  runCompare,
}) {
  if (validation && !validation.passed) {
    return "failed";
  }
  if (convertedNavigateActionCount > 0 && (!runCompare || validation?.passed)) {
    return "passed";
  }
  return "partial";
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
    args.reportRoot ?? "reports/flow-m6-route-execution",
  );
  const runId =
    args.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputRoot = resolve(reportRoot, runId);
  await mkdir(outputRoot, { recursive: true });

  const store = new ProjectStore(dataRoot);
  const bundle = await store.loadDesignBundle(
    args.projectId,
    revision(args.designBundleRevision),
  );
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

  const canConvert = Boolean(uiSpec && flowPlan && uiSpec.pages.length >= 2);
  const conversion = canConvert
    ? applyFlowM6RouteExecutionToUISpec(uiSpec, flowPlan, {
        viewportId: args.viewportId,
      })
    : {
        uiSpec: undefined,
        convertedNavigateActionIds: [],
        behaviorFixtureIds: [],
        unresolvedInteractions: flowPlan?.interactions ?? [],
      };

  let savedRevision;
  if (
    uiSpec &&
    conversion.uiSpec &&
    args.saveUISpec &&
    conversion.convertedNavigateActionIds.length > 0
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
    uiSpec &&
    conversion.uiSpec &&
    args.runCompare &&
    conversion.behaviorFixtureIds.length > 0
  ) {
    const fixtureIds = new Set(conversion.behaviorFixtureIds);
    const validationPageIds = [
      ...new Set(
        conversion.uiSpec.behaviorFixtures
          .filter((fixture) => fixtureIds.has(fixture.id))
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
        behaviorFixtureIds: conversion.behaviorFixtureIds,
        comparison: defaultComparison(args.comparisonJson),
      });
    } finally {
      await service.close();
    }
  }

  const validationSummary = validation
    ? summarizeFlowM6Validation(validation)
    : undefined;
  const status = reportStatus({
    convertedNavigateActionCount:
      conversion.convertedNavigateActionIds.length,
    validation: validationSummary,
    runCompare: args.runCompare,
  });
  const report = parseFlowM6RouteExecutionReport({
    schemaVersion: "1",
    milestone: "Flow-M6",
    scope: "route_execution_only",
    status,
    projectId: args.projectId,
    runId,
    figmaInteractionSource: flowPlan?.figmaInteractionSource,
    sourceDesignBundleRevision: bundle.revision,
    sourceUISpecRevision: uiSpec?.revision,
    sourceFlowPlanRevision: flowPlan?.revision,
    savedUISpecRevision: savedRevision,
    routeCount: uiSpec?.pages.length ?? 0,
    navigateActionCount: conversion.convertedNavigateActionIds.length,
    behaviorFixtureCount: conversion.behaviorFixtureIds.length,
    convertedNavigateActionIds: conversion.convertedNavigateActionIds,
    behaviorFixtureIds: conversion.behaviorFixtureIds,
    unresolvedInteractions: conversion.unresolvedInteractions,
    insufficientReason:
      status === "partial"
        ? insufficientReason({
            uiSpec,
            flowPlan,
            convertedNavigateActionCount:
              conversion.convertedNavigateActionIds.length,
            validation: validationSummary,
            runCompare: args.runCompare,
          })
        : undefined,
    validation: validationSummary,
    residualRisks: [
      "Flow-M6 只覆盖 route_execution_only；Flow-M7 状态、表单、submit 和业务状态切换仍未覆盖。",
      "当前 runner 为 local-only；restricted-live/live Figma 样本需要单独 gate。",
    ],
  });

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
