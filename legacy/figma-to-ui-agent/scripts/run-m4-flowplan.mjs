import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  interactionSupplementSchema as legacyInteractionSupplementSchema,
} from "../src/flow-plan/draft.ts";
import {
  applyFlowConfirmations,
  buildFlowPlan,
  generateFlowConfirmationQuestions,
} from "../src/flow-plan/service.ts";
import {
  flowConfirmationInputsSchema,
  interactionSupplementSchema,
  recomputeFlowPlanReport,
  summarizeFlowPlan,
} from "../src/flow-plan/schema.ts";
import { applyFlowPlanToUISpec } from "../src/flow-plan/to-ui-spec.ts";
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

function parseSupplement(raw) {
  if (raw?.schemaVersion === "1") {
    return interactionSupplementSchema.parse(raw);
  }
  return legacyInteractionSupplementSchema.parse(raw);
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

async function loadOptionalFlowPlan(store, projectId) {
  try {
    return await store.loadFlowPlan(projectId);
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
    "# M4 正式 FlowPlan 报告",
    "",
    `- projectId：${report.projectId}`,
    `- status：${report.status}`,
    `- flowPlanRevision：${report.flowPlanRevision}`,
    `- figmaInteractionSource：${report.figmaInteractionSource}`,
    `- pages：${report.summary.pageCount}`,
    `- interactions：${report.summary.interactionCount}`,
    `- convertedActionCount：${report.convertedActionIds.length}`,
    `- behaviorFixtureCount：${report.behaviorFixtureIds.length}`,
    `- unresolvedInteractionCount：${report.unresolvedInteractions.length}`,
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
      `- previewUrl：${report.validation.previewUrl}`,
    );
  }
  lines.push(
    "",
    "## 残留风险",
    "",
    "- M4 只证明 FlowPlan 契约、持久化、确认和受控转换；不代表 M5/M6/M7 已完成。",
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
    args.reportRoot ?? "reports/m4-flowplan",
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
  const supplement = args.interactionSupplement
    ? parseSupplement(
        await readJson(resolve(projectRoot, args.interactionSupplement)),
      )
    : undefined;
  const confirmations = args.confirmations
    ? flowConfirmationInputsSchema.parse(
        await readJson(resolve(projectRoot, args.confirmations)),
      )
    : args.confirmationsJson
      ? flowConfirmationInputsSchema.parse(JSON.parse(args.confirmationsJson))
      : [];

  let draft = generateFlowConfirmationQuestions(
    buildFlowPlan({
      bundle,
      uiSpec,
      interactionSupplement: supplement,
      figmaInteractionSource: supplement ? "present" : "absent",
    }),
  );
  if (confirmations.length > 0) {
    draft = applyFlowConfirmations(draft, confirmations);
  }

  const currentFlowPlan = await loadOptionalFlowPlan(store, args.projectId);
  const storedFlowPlan = await store.saveFlowPlan({
    projectId: args.projectId,
    baseRevision: currentFlowPlan?.revision ?? 0,
    draft,
  });

  const conversion = uiSpec
    ? applyFlowPlanToUISpec(uiSpec, storedFlowPlan, {
        viewportId: args.viewportId,
      })
    : {
        uiSpec: undefined,
        convertedActionIds: [],
        behaviorFixtureIds: [],
        unresolvedInteractions: storedFlowPlan.interactions,
      };

  let savedRevision;
  if (
    uiSpec &&
    args.saveUISpec &&
    conversion.convertedActionIds.length > 0
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

  const reportFlowPlan = {
    ...storedFlowPlan,
    report: recomputeFlowPlanReport({
      ...storedFlowPlan,
      report: {
        ...storedFlowPlan.report,
        convertedActionCount: conversion.convertedActionIds.length,
        behaviorFixtureCount: conversion.behaviorFixtureIds.length,
      },
    }),
  };
  const status =
    validation && !validation.passed
      ? "failed"
      : conversion.convertedActionIds.length > 0
        ? "passed"
        : "partial";
  const report = {
    schemaVersion: "1",
    projectId: args.projectId,
    runId,
    status,
    figmaInteractionSource: storedFlowPlan.figmaInteractionSource,
    sourceDesignBundleRevision: bundle.revision,
    sourceUISpecRevision: uiSpec?.revision,
    flowPlanRevision: storedFlowPlan.revision,
    savedUISpecRevision: savedRevision,
    satisfiesMultipage: storedFlowPlan.pages.length >= 2,
    insufficientReason:
      storedFlowPlan.pages.length >= 2
        ? uiSpec
          ? undefined
          : "不满足 Flow 转换条件：项目没有当前 UISpec。"
        : "不满足多页面 Flow 验证条件：DesignBundle 只有一个候选页面。",
    pages: storedFlowPlan.pages,
    interactions: storedFlowPlan.interactions,
    summary: {
      pageCount: storedFlowPlan.pages.length,
      ...summarizeFlowPlan(reportFlowPlan),
    },
    convertedActionIds: conversion.convertedActionIds,
    behaviorFixtureIds: conversion.behaviorFixtureIds,
    unresolvedInteractions: conversion.unresolvedInteractions,
    confirmationQuestions: storedFlowPlan.confirmationQuestions,
    confirmations: storedFlowPlan.confirmations,
    validation,
    residualRisk:
      "M4 只证明 FlowPlan 契约、持久化、确认和受控转换；M5/M6/M7 仍需后续计划验证。",
  };

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
