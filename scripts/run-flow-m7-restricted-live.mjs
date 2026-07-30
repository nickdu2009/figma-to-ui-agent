import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyFlowM7InteractiveBehaviorToUISpec,
} from "../src/flow-plan/m7-interactions.ts";
import {
  parseFlowM7InteractiveBehaviorReport,
  summarizeFlowM7Validation,
} from "../src/flow-plan/m7-report.ts";
import {
  buildFlowM7InteractiveBehaviorReport,
} from "../src/flow-plan/m7-runner.ts";
import {
  buildFlowPlan,
  generateFlowConfirmationQuestions,
} from "../src/flow-plan/service.ts";
import { FigmaImageDownloader } from "../src/figma/assets.ts";
import { FigmaInspector } from "../src/figma/inspector.ts";
import { FigmaRestClient } from "../src/figma/rest-client.ts";
import {
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
} from "../src/figma/url.ts";
import { SCHEMA_VERSION } from "../src/project-store/schemas.ts";
import {
  ProjectStore,
  ProjectStoreError,
} from "../src/project-store/store.ts";
import {
  buildStaticUISpecFromDesignBundle,
} from "../src/static-generation/service.ts";
import { RenderAndCompareService } from "../src/validation/render-and-compare.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parseArgs(argv) {
  const parsed = {
    saveFlowPlan: false,
    saveUISpec: false,
    runCompare: false,
    allowFigmaNetwork: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--save-flow-plan") {
      parsed.saveFlowPlan = true;
      continue;
    }
    if (arg === "--save-ui-spec") {
      parsed.saveUISpec = true;
      continue;
    }
    if (arg === "--run-compare") {
      parsed.runCompare = true;
      continue;
    }
    if (arg === "--allow-figma-network") {
      parsed.allowFigmaNetwork = true;
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
    "# Flow-M7 restricted-live interaction extraction 报告",
    "",
    `- projectId：${report.input.projectId}`,
    `- runId：${report.input.runId}`,
    `- status：${report.status}`,
    `- figmaInteractionSource：${report.input.figmaInteractionSource ?? "none"}`,
    `- sourceUISpecRevision：${report.input.uiSpecRevision ?? "none"}`,
    `- sourceFlowPlanRevision：${report.input.flowPlanRevision ?? "none"}`,
    `- savedUISpecRevision：${report.input.savedUISpecRevision ?? "none"}`,
    `- trustedNonRouteConverted：${report.counts.trustedNonRouteConverted}`,
    `- scenarioOnlyFixtures：${report.counts.scenarioOnlyFixtures}`,
    `- unresolved：${report.counts.unresolved}`,
    "",
    "## Converted Actions",
    "",
    ...(report.actions.converted.length > 0
      ? report.actions.converted.map(
          (item) => `- ${item.actionId}：${item.intent}`,
        )
      : ["- 无"]),
    "",
    "## Rejected Interactions",
    "",
    ...(report.actions.rejected.length > 0
      ? report.actions.rejected.map(
          (item) =>
            `- ${item.id}：${item.blockedReason ?? item.intent}`,
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

function redactionCheck(value) {
  const serialized = JSON.stringify(value);
  if (/figd_[A-Za-z0-9_-]+/.test(serialized)) {
    throw new Error("report_redaction_failed:figma_token");
  }
  if (/https:\/\/www\.figma\.com\/design\//.test(serialized)) {
    throw new Error("report_redaction_failed:figma_url");
  }
}

async function loadCurrentFlowPlan(store, projectId) {
  try {
    return await store.loadFlowPlan(projectId);
  } catch {
    return undefined;
  }
}

async function loadOrGenerateUISpec(input) {
  const explicitRevision = revision(input.args.uiSpecRevision);
  if (explicitRevision !== undefined) {
    return await input.store.loadUISpec(input.args.projectId, explicitRevision);
  }
  try {
    return await input.store.loadUISpec(input.args.projectId);
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "not_found") {
      throw error;
    }
  }
  const { uiSpecDraft } = buildStaticUISpecFromDesignBundle(input.bundle, {
    m4ValidationStatus: "not_required",
  });
  return await input.store.saveUISpec({
    projectId: input.args.projectId,
    baseRevision: 0,
    draft: uiSpecDraft,
  });
}

function parseTargetNodes(raw) {
  if (!raw) {
    return undefined;
  }
  const nodes = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(normalizeFigmaNodeId);
  return nodes.length > 0 ? [...new Set(nodes)] : undefined;
}

async function acquireDesignBundle(input) {
  if (!input.args.figmaUrl && !input.args.allowFigmaNetwork) {
    return await input.store.loadDesignBundle(
      input.args.projectId,
      revision(input.args.designBundleRevision),
    );
  }
  if (!input.args.figmaUrl) {
    throw new Error("missing_figma_url");
  }
  if (!input.args.allowFigmaNetwork) {
    throw new Error("figma_network_gate_missing");
  }
  if (
    process.env.FLOW_M7_RESTRICTED_LIVE_AUTHORIZED !== "1"
  ) {
    throw new Error("flow_m7_restricted_live_authorization_missing");
  }
  const token = process.env.FIGMA_API_KEY?.trim();
  if (!token) {
    throw new Error("figma_api_key_missing");
  }

  const parsedUrl = parseFigmaDesignUrl(input.args.figmaUrl);
  const cliTargetNodes = parseTargetNodes(input.args.targetNodes);
  const targetNodes = cliTargetNodes ?? (
    parsedUrl.nodeId ? [parsedUrl.nodeId] : undefined
  );
  const restClient = new FigmaRestClient({ token });
  const inspector = new FigmaInspector({
    restClient,
    imageDownloader: new FigmaImageDownloader({
      projectStore: input.store,
    }),
    projectStore: input.store,
  });
  const output = await inspector.inspect(
    {
      schemaVersion: SCHEMA_VERSION,
      projectId: input.args.projectId,
      figmaUrl: input.args.figmaUrl,
      targetNodes,
    },
    undefined,
    { variablesMode: "disabled_restricted_live" },
  );
  return await input.store.loadDesignBundle(
    input.args.projectId,
    output.designBundleRevision,
  );
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
    args.reportRoot ?? "reports/flow-m7-restricted-live-extraction",
  );
  const runId =
    args.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputRoot = resolve(reportRoot, runId);
  await mkdir(outputRoot, { recursive: true });

  const store = new ProjectStore(dataRoot);
  const bundle = await acquireDesignBundle({ args, store });
  const uiSpec = await loadOrGenerateUISpec({ args, bundle, store });
  const flowPlanDraft = generateFlowConfirmationQuestions(
    buildFlowPlan({
      bundle,
      uiSpec,
    }),
  );
  const currentFlowPlan = await loadCurrentFlowPlan(store, args.projectId);
  const storedFlowPlan = args.saveFlowPlan
    ? await store.saveFlowPlan({
        projectId: args.projectId,
        baseRevision: currentFlowPlan?.revision ?? 0,
        draft: flowPlanDraft,
      })
    : {
        ...flowPlanDraft,
        revision: currentFlowPlan?.revision ?? 1,
      };

  const conversion = applyFlowM7InteractiveBehaviorToUISpec(
    uiSpec,
    storedFlowPlan,
    {
      fixtures: [],
      submitLikeExpectations: [],
    },
    {
      viewportId: args.viewportId,
    },
  );

  let savedRevision;
  if (
    args.saveUISpec &&
    conversion.trustedNonRouteConvertedCount > 0
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

  const report = parseFlowM7InteractiveBehaviorReport(
    buildFlowM7InteractiveBehaviorReport({
      projectId: args.projectId,
      runId,
      flowPlanPath: args.saveFlowPlan
        ? "project-store/current-flow-plan"
        : "ephemeral-flow-plan",
      uiSpecRevision: uiSpec.revision,
      flowPlanRevision: args.saveFlowPlan ? storedFlowPlan.revision : undefined,
      savedUISpecRevision: savedRevision,
      figmaInteractionSource: storedFlowPlan.figmaInteractionSource,
      conversion,
      validation: validation
        ? summarizeFlowM7Validation(validation)
        : undefined,
    }),
  );
  redactionCheck(report);

  await writeFile(
    resolve(outputRoot, "flow-plan.json"),
    `${JSON.stringify(flowPlanDraft, null, 2)}\n`,
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
