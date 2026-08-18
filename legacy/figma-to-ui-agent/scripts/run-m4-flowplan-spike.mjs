import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyConfirmations } from "../src/flow-plan/apply-confirmations.ts";
import { generateConfirmationQuestions } from "../src/flow-plan/confirmation-questions.ts";
import {
  confirmationAnswersSchema,
  interactionSupplementSchema,
  summarizeFlowPlanDraft,
} from "../src/flow-plan/draft.ts";
import { buildFlowPlanDraft } from "../src/flow-plan/interaction-candidates.ts";
import { applyFlowPlanToUISpec } from "../src/flow-plan/to-ui-spec.ts";
import { ProjectStore } from "../src/project-store/store.ts";
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

function reportMarkdown(report) {
  const lines = [
    `# M4-spike FlowPlan 报告`,
    "",
    `- projectId：${report.projectId}`,
    `- status：${report.status}`,
    `- figmaInteractionSource：${report.figmaInteractionSource}`,
    `- pages：${report.summary.pageCount}`,
    `- interactions：${report.summary.interactionCount}`,
    `- convertedActionCount：${report.summary.convertedActionCount}`,
    `- behaviorFixtureCount：${report.summary.behaviorFixtureCount}`,
    `- unresolvedInteractionCount：${report.summary.unresolvedInteractionCount}`,
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
    args.reportRoot ?? "reports/m4-flowplan-spike",
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
  const uiSpec = await store.loadUISpec(
    args.projectId,
    revision(args.uiSpecRevision),
  );
  const supplement = args.interactionSupplement
    ? interactionSupplementSchema.parse(
        await readJson(resolve(projectRoot, args.interactionSupplement)),
      )
    : undefined;
  const confirmations = args.confirmations
    ? confirmationAnswersSchema.parse(
        await readJson(resolve(projectRoot, args.confirmations)),
      )
    : args.confirmationsJson
      ? confirmationAnswersSchema.parse(JSON.parse(args.confirmationsJson))
      : [];

  const draft = generateConfirmationQuestions(
    buildFlowPlanDraft({
      bundle,
      uiSpec,
      interactionSupplement: supplement,
    }),
  );
  const confirmed =
    confirmations.length > 0
      ? applyConfirmations(draft, confirmations)
      : draft;
  const conversion = applyFlowPlanToUISpec(uiSpec, confirmed, {
    viewportId: args.viewportId,
  });

  let savedRevision;
  if (args.saveUISpec && conversion.convertedActionIds.length > 0) {
    const saved = await store.saveUISpec({
      projectId: args.projectId,
      baseRevision: uiSpec.revision,
      draft: conversion.uiSpec,
    });
    savedRevision = saved.revision;
  }

  let validation;
  if (args.runCompare && conversion.behaviorFixtureIds.length > 0) {
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
        viewportIds: [args.viewportId ?? conversion.uiSpec.viewports[0].id],
        behaviorFixtureIds: conversion.behaviorFixtureIds,
        comparison: defaultComparison(args.comparisonJson),
      });
    } finally {
      await service.close();
    }
  }

  const summarizedDraft = {
    ...confirmed,
    report: {
      ...confirmed.report,
      convertedActionCount: conversion.convertedActionIds.length,
      behaviorFixtureCount: conversion.behaviorFixtureIds.length,
    },
  };
  const summary = summarizeFlowPlanDraft(summarizedDraft);
  const status =
    validation && !validation.passed
      ? "failed"
      : conversion.convertedActionIds.length > 0
        ? "passed"
        : "partial";
  const report = {
    schemaVersion: "m4-spike",
    projectId: args.projectId,
    runId,
    status,
    figmaInteractionSource: supplement?.rawSource ?? "absent",
    sourceDesignBundleRevision: bundle.revision,
    sourceUISpecRevision: uiSpec.revision,
    savedUISpecRevision: savedRevision,
    satisfiesMultipage: confirmed.pages.length >= 2,
    insufficientReason:
      confirmed.pages.length >= 2
        ? undefined
        : "不满足多页面 Flow 验证条件：DesignBundle 只有一个候选页面。",
    pages: confirmed.pages,
    interactions: confirmed.interactions,
    summary: {
      pageCount: confirmed.pages.length,
      ...summary,
    },
    convertedActionIds: conversion.convertedActionIds,
    behaviorFixtureIds: conversion.behaviorFixtureIds,
    unresolvedInteractions: conversion.unresolvedInteractions,
    confirmationQuestions: confirmed.confirmationQuestions,
    validation,
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
