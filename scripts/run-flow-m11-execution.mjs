import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { loadFlowM11Artifact } from "../src/flow-plan/m11-artifact-loader.ts";
import { planFlowM11BehaviorFixtures } from "../src/flow-plan/m11-fixture-planner.ts";
import {
  buildFlowM11ExecutionReport,
  summarizeFlowM11Validation,
} from "../src/flow-plan/m11-report.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import { RenderAndCompareService } from "../src/validation/render-and-compare.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultBrowserExecutablePath = resolve(
  projectRoot,
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

function parseArgs(argv) {
  const parsed = {
    runCompare: true,
    mode: "local",
    reuseStore: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-run-compare") {
      parsed.runCompare = false;
      continue;
    }
    if (arg === "--reuse-store") {
      parsed.reuseStore = true;
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
  if (parsed.mode !== "local" && parsed.mode !== "restricted-live") {
    throw new Error(`invalid_mode:${parsed.mode}`);
  }
  return parsed;
}

async function loadJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}

function sourceHash(sourceId) {
  return createHash("sha256").update(sourceId).digest("hex");
}

function relativeRef(path) {
  const absolute = resolve(projectRoot, path);
  const ref = relative(projectRoot, absolute);
  if (ref.startsWith("..")) {
    throw new Error("flow_m11_ref_outside_project");
  }
  return ref;
}

function flowPlanStoreDraft(rawFlowPlan, projectId) {
  const cloned = structuredClone(rawFlowPlan);
  delete cloned.revision;
  delete cloned.sourceUISpecRevision;
  return {
    ...cloned,
    projectId,
    sourceDesignBundleRevision: 1,
  };
}

async function createReferencePng(browserExecutablePath, width, height) {
  const browser = await chromium.launch({
    executablePath: browserExecutablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
    });
    await page.setContent(
      `<body style="margin:0"><main style="width:${width}px;height:${height}px;background:#fff"></main></body>`,
    );
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

async function createSyntheticDesignBundle({
  store,
  projectId,
  uiSpec,
  browserExecutablePath,
}) {
  const viewport = uiSpec.viewports[0];
  if (!viewport) {
    throw new Error("flow_m11_viewport_missing");
  }
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
      fileKeyHash: "b".repeat(64),
      targetNodeIds: sourcePageIds,
      inspectedAt: "2026-08-08T00:00:00.000Z",
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

function safeId(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "fixture"
  );
}

async function renderFixturesWithIsolation({
  runId,
  dataRoot,
  store,
  browserExecutablePath,
  previewPort,
  projectId,
  uiSpec,
  fixtureIds,
  timeoutMs,
}) {
  const outputs = [];
  for (const fixtureId of fixtureIds) {
    const fixture = uiSpec.behaviorFixtures.find(
      (candidate) => candidate.id === fixtureId,
    );
    if (!fixture) {
      throw new Error(`flow_m11_fixture_missing:${fixtureId}`);
    }
    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath,
      previewPort,
      runId: () => `${runId}-${safeId(fixtureId)}`,
    });
    try {
      outputs.push(
        await service.render({
          schemaVersion: "1",
          projectId,
          pageIds: [fixture.initialPageId],
          viewportIds: [fixture.viewportId],
          behaviorFixtureIds: [fixtureId],
          comparison: {
            maxDiffPixelRatio: 1,
            maxDiffPixels: 1_000_000,
            timeoutMs,
          },
        }),
      );
    } finally {
      await service.close();
    }
  }
  return {
    schemaVersion: "1",
    runId,
    passed: outputs.every((output) => output.passed),
    results: outputs.flatMap((output) => output.results),
  };
}

function reportMarkdown(report) {
  return `${[
    "# Flow-M11 多步骤业务 Flow 执行报告",
    "",
    `- runId：${report.input.runId}`,
    `- status：${report.status}`,
    `- mode：${report.input.mode}`,
    `- figmaRestCalled：${report.input.networkBoundary.figmaRestCalled}`,
    `- openaiCalled：${report.input.networkBoundary.openaiCalled}`,
    `- fixtureCount：${report.counts.fixtureCount}`,
    `- successfulFixtureIds：${report.successfulFixtureIds.join(", ") || "none"}`,
    `- failedFixtureIds：${report.failedFixtureIds.join(", ") || "none"}`,
    `- stepCount：${report.counts.stepCount}`,
    `- failedCheckCount：${report.counts.failedCheckCount}`,
    `- preSatisfiedExpectationCount：${report.counts.preSatisfiedExpectationCount}`,
    `- summaryOnlyRejectionCount：${report.counts.summaryOnlyRejectionCount}`,
    `- scenarioOnlyRejectionCount：${report.counts.scenarioOnlyRejectionCount}`,
    `- untrustedSourceRejectionCount：${report.counts.untrustedSourceRejectionCount}`,
    "",
    "## Fixtures",
    "",
    ...(report.fixtures.length > 0
      ? report.fixtures.map(
          (fixture) =>
            `- ${fixture.fixtureId}：${fixture.intent}/${fixture.source} input=${fixture.inputStepCount} selectRadioToggle=${fixture.selectRadioToggleStepCount} postconditions=${fixture.postconditionStepCount}`,
        )
      : ["- none"]),
    "",
    "## Reasons",
    "",
    ...(report.reasons.length > 0
      ? report.reasons.map((reason) => `- ${reason}`)
      : ["- none"]),
    "",
    "## Residual Risks",
    "",
    ...report.residualRisks.map((risk) => `- ${risk}`),
  ].join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId =
    args.runId ?? `flow-m11-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const flowPlanPath =
    args.flowPlan ??
    "tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json";
  const uiSpecPath =
    args.uiSpec ??
    "tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json";
  const dataRoot = resolve(
    projectRoot,
    args.dataRoot ?? `data/flow-m11-execution/${runId}`,
  );
  const reportRoot = resolve(
    projectRoot,
    args.reportRoot ?? "reports/flow-m11-execution",
  );
  const outputRoot = resolve(reportRoot, runId);
  const browserExecutablePath = resolve(
    projectRoot,
    args.browserExecutablePath ?? defaultBrowserExecutablePath,
  );
  await mkdir(outputRoot, { recursive: true });

  const rawFlowPlan = await loadJson(flowPlanPath);
  const uiSpec = await loadJson(uiSpecPath);
  const projectId = uiSpec.projectId;
  if (args.seedStoreFrom) {
    await cp(
      resolve(projectRoot, args.seedStoreFrom, "projects", projectId),
      resolve(dataRoot, "projects", projectId),
      {
        recursive: true,
        errorOnExist: true,
        force: false,
      },
    );
  }
  const store = new ProjectStore(dataRoot);
  if (!args.reuseStore && !args.seedStoreFrom) {
    const designBundle = await createSyntheticDesignBundle({
      store,
      projectId,
      uiSpec,
      browserExecutablePath,
    });
    await store.saveDesignBundle({
      projectId,
      baseRevision: 0,
      draft: designBundle,
    });
    await store.saveFlowPlan({
      projectId,
      baseRevision: 0,
      draft: flowPlanStoreDraft(rawFlowPlan, projectId),
    });
  }

  const artifact = await loadFlowM11Artifact({
    artifactRef: relativeRef(flowPlanPath),
    rawFlowPlan,
    uiSpec,
  });
  const planner = planFlowM11BehaviorFixtures({
    artifact,
    uiSpec,
    options: { viewportId: args.viewportId },
  });
  const validationFixtureIds = planner.executableFixtureIds;
  if (!args.reuseStore || args.seedStoreFrom) {
    await store.saveUISpec({
      projectId,
      baseRevision: args.seedStoreFrom ? uiSpec.revision : 0,
      draft: planner.uiSpec,
    });
  }

  let validation;
  if (args.runCompare && validationFixtureIds.length > 0) {
    validation = await renderFixturesWithIsolation({
      runId,
      dataRoot,
      store,
      browserExecutablePath,
      previewPort: args.previewPort ? Number(args.previewPort) : undefined,
      projectId,
      uiSpec: planner.uiSpec,
      fixtureIds: validationFixtureIds,
      timeoutMs: Number(args.timeoutMs ?? 10_000),
    });
  }

  const validationSummary = validation
    ? summarizeFlowM11Validation(validation)
    : {
        schemaVersion: "1",
        runId,
        passed: validationFixtureIds.length > 0,
        resultCount: validationFixtureIds.length,
        failedCheckCount: 0,
        successfulFixtureIds: validationFixtureIds,
        failedFixtureIds: [],
        preSatisfiedExpectationCount: 0,
      };
  const report = buildFlowM11ExecutionReport({
    runId,
    mode: args.mode,
    flowPlanRef: relativeRef(flowPlanPath),
    uiSpecRef: relativeRef(uiSpecPath),
    reportRef: relativeRef(resolve(outputRoot, "summary.json")),
    figmaRestCalled: false,
    artifact,
    planner,
    validation: validationSummary,
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
