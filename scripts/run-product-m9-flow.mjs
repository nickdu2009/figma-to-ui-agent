#!/usr/bin/env node

import { resolve } from "node:path";

import { productM9ExitCode } from "../src/runtime/product-m9-flow-contracts.ts";
import { runProductM9Flow } from "../src/runtime/product-m9-flow-service.ts";
import { summarizeFlowM11Validation } from "../src/flow-plan/m11-report.ts";
import { ProjectStore, ProjectStoreError } from "../src/project-store/store.ts";
import { RenderAndCompareService } from "../src/validation/render-and-compare.ts";

const defaultBrowserExecutablePath =
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";

function printHelp() {
  console.log(`Usage: node scripts/run-product-m9-flow.mjs --project-id <id> [options]

Product-M9 agent-facing usage: run the real FlowPlan delivery path and return a
stable JSON result with artifact refs, metrics, error.category, and nextAction.
Reports are written to <reportRoot>/<runId>/summary.json and summary.md
(default reportRoot: reports/product-m9).

Options:
  --project-id <id>              Local project id
  --mode <mode>                  local | restricted-live (default: local)
  --figma-url <url>              Full HTTPS Figma design URL for restricted-live
  --file-key <key>               Figma file key for restricted-live
  --node-id <id>                 Figma node id for restricted-live
  --flow-plan <path>             Local FlowPlan artifact path
  --ui-spec <path>               Local UISpec artifact path
  --answers <path>               Flow-M10 confirmed-answer path, often edited from confirmation-answer-template.json
  --confirmed-flow-plan <path>   User-confirmed FlowPlan artifact path
  --run-compare                  Run generated fixtures through Playwright compare
  --browser-executable-path <p>  Chromium executable for --run-compare
  --preview-port <port>          Optional preview server port for --run-compare
  --compare-timeout-ms <ms>      Per-fixture compare timeout (default: 10000)
  --json                         Print full JSON result
  --dataRoot <path>              Data root (default: data)
  --reportRoot <path>            Report root (default: reports/product-m9)
  --runId <id>                   Explicit run id
  --allow-figma-network          Gate for restricted-live Figma REST
  --help                         Show this help

Examples:
  # local smoke (no Figma, no OpenAI)
  node scripts/run-product-m9-flow.mjs \\
    --project-id demo-project \\
    --mode local \\
    --flow-plan tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json \\
    --ui-spec tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json \\
    --json

  # restricted-live: Figma REST only, no OpenAI
  PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs \\
    --project-id demo-project \\
    --figma-url https://www.figma.com/design/<file-key>/<name>?node-id=<node-id> \\
    --mode restricted-live \\
    --allow-figma-network \\
    --json

Gate notes:
  - restricted-live requires both --allow-figma-network and PRODUCT_M9_FIGMA_AUTHORIZED=1.
  - restricted-live reads FIGMA_API_KEY from the environment.
  - Product-M9 never calls OpenAI.
  - local mode requires no external service.
`);
}

function safeId(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "fixture"
  );
}

async function saveUISpecForCompare(store, projectId, uiSpec) {
  let baseRevision = 0;
  try {
    baseRevision = (await store.loadUISpec(projectId)).revision;
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "not_found") {
      throw error;
    }
  }
  await store.saveUISpec({
    projectId,
    baseRevision,
    draft: uiSpec,
  });
}

async function runRenderCompareFixtures(input) {
  const dataRoot = resolve(input.request.dataRoot ?? "data");
  const store = new ProjectStore(dataRoot);
  await saveUISpecForCompare(store, input.projectId, input.uiSpec);
  if (input.fixtureIds.length === 0) {
    return {
      schemaVersion: "1",
      runId: input.runId,
      passed: true,
      resultCount: 0,
      failedCheckCount: 0,
      successfulFixtureIds: [],
      failedFixtureIds: [],
      preSatisfiedExpectationCount: 0,
    };
  }

  const outputs = [];
  for (const fixtureId of input.fixtureIds) {
    const fixture = input.uiSpec.behaviorFixtures.find(
      (candidate) => candidate.id === fixtureId,
    );
    if (!fixture) {
      throw new Error(`product_m9_fixture_missing:${fixtureId}`);
    }
    const service = new RenderAndCompareService({
      dataRoot,
      projectStore: store,
      browserExecutablePath:
        resolve(input.compare.browserExecutablePath ?? defaultBrowserExecutablePath),
      previewPort: input.compare.previewPort,
      runId: () => `${input.runId}-${safeId(fixtureId)}`,
    });
    try {
      outputs.push(
        await service.render({
          schemaVersion: "1",
          projectId: input.projectId,
          pageIds: [fixture.initialPageId],
          viewportIds: [fixture.viewportId],
          behaviorFixtureIds: [fixtureId],
          comparison: {
            maxDiffPixelRatio: 1,
            maxDiffPixels: Number.MAX_SAFE_INTEGER,
            timeoutMs: input.compare.timeoutMs,
          },
        }),
      );
    } finally {
      await service.close();
    }
  }

  return summarizeFlowM11Validation(
    {
      schemaVersion: "1",
      runId: input.runId,
      passed: outputs.every((output) => output.passed),
      results: outputs.flatMap((output) => output.results),
    },
    { fixtureIds: input.fixtureIds },
  );
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const request = {
    mode: "local",
    gates: {},
  };
  const compare = {
    timeoutMs: 10_000,
  };
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--help":
      case "-h":
        return { help: true, request, json };
      case "--project-id":
      case "--projectId":
        request.projectId = readValue(args, index, flag);
        index += 1;
        break;
      case "--mode":
        request.mode = readValue(args, index, flag);
        index += 1;
        break;
      case "--figma-url":
      case "--figmaUrl":
        request.figmaUrl = readValue(args, index, flag);
        index += 1;
        break;
      case "--file-key":
      case "--fileKey":
        request.fileKey = readValue(args, index, flag);
        index += 1;
        break;
      case "--node-id":
      case "--nodeId":
        request.nodeId = readValue(args, index, flag);
        index += 1;
        break;
      case "--flow-plan":
      case "--flowPlan":
        request.flowPlanPath = readValue(args, index, flag);
        index += 1;
        break;
      case "--ui-spec":
      case "--uiSpec":
        request.uiSpecPath = readValue(args, index, flag);
        index += 1;
        break;
      case "--answers":
      case "--answersPath":
        request.answersPath = readValue(args, index, flag);
        index += 1;
        break;
      case "--confirmed-flow-plan":
      case "--confirmedFlowPlan":
        request.confirmedFlowPlanPath = readValue(args, index, flag);
        index += 1;
        break;
      case "--run-compare":
      case "--runCompare":
        request.runCompare = true;
        break;
      case "--browser-executable-path":
      case "--browserExecutablePath":
        compare.browserExecutablePath = readValue(args, index, flag);
        index += 1;
        break;
      case "--preview-port":
      case "--previewPort":
        compare.previewPort = Number(readValue(args, index, flag));
        index += 1;
        break;
      case "--compare-timeout-ms":
      case "--compareTimeoutMs":
        compare.timeoutMs = Number(readValue(args, index, flag));
        index += 1;
        break;
      case "--json":
        json = true;
        break;
      case "--dataRoot":
      case "--data-root":
        request.dataRoot = readValue(args, index, flag);
        index += 1;
        break;
      case "--reportRoot":
      case "--report-root":
        request.reportRoot = readValue(args, index, flag);
        index += 1;
        break;
      case "--runId":
      case "--run-id":
        request.runId = readValue(args, index, flag);
        index += 1;
        break;
      case "--allow-figma-network":
        request.gates.allowFigmaNetwork = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (Object.keys(request.gates).length === 0) {
    delete request.gates;
  }
  if (
    (compare.previewPort !== undefined &&
      (!Number.isInteger(compare.previewPort) || compare.previewPort <= 0)) ||
    !Number.isFinite(compare.timeoutMs) ||
    compare.timeoutMs <= 0
  ) {
    throw new Error("Invalid --run-compare option");
  }
  return { help: false, request, compare, json };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    printHelp();
    process.exit(2);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  const result = await runProductM9Flow(parsed.request, {
    flowValidationRunner: parsed.request.runCompare
      ? (input) =>
          runRenderCompareFixtures({
            ...input,
            request: parsed.request,
            compare: parsed.compare,
          })
      : undefined,
  });
  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Product-M9 report written to ${result.artifactRefs.summaryJson}`);
    console.log(`Product-M9 markdown written to ${result.artifactRefs.summaryMarkdown}`);
    console.log(`status: ${result.status}`);
    console.log(`nextAction: ${result.nextAction}`);
  }
  process.exit(productM9ExitCode(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
