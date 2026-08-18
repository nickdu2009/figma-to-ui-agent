#!/usr/bin/env node

import { m7ExitCode } from "../src/runtime/e2e-flow-contracts.ts";
import { runM7E2EFlow } from "../src/runtime/e2e-flow-service.ts";

function printHelp() {
  console.log(`Usage: node scripts/run-figma-to-ui.mjs --project-id <id> [options]

Product-M8 agent-facing usage: run Product-M7 end-to-end flow and return a
stable JSON result with nextAction. Use --json for machine-readable output.
Reports are written to <reportRoot>/<runId>/summary.json and summary.md
(default reportRoot: reports/m7-e2e).

Options:
  --figma-url <url>              Full HTTPS Figma design URL
  --file-key <key>               Figma file key, optional in local mode
  --node-id <id>                 Figma node id
  --project-id <id>              Local project id
  --designBundleRevision <n>     Local DesignBundle revision
  --mode <mode>                  local | restricted-live | live (default: local)
  --run-label <label>            Human-readable run label
  --viewport <id>                Viewport id, repeatable
  --threshold <percent>          Max visual diff percent for render compare
  --run-compare                  Run preview render-and-compare
  --json                         Print full JSON result
  --dataRoot <path>              Data root (default: data)
  --reportRoot <path>            Report root (default: reports/m7-e2e)
  --runId <id>                   Explicit run id
  --allow-figma-network          Gate for restricted-live/live Figma REST
  --allow-openai                 Gate for live OpenAI usage
  --allow-asset-backfill         Gate for optional asset backfill
  --help                         Show this help

Examples:
  # local mode (no Figma, no OpenAI)
  node scripts/run-figma-to-ui.mjs --project-id demo --designBundleRevision 1 --mode local --json

  # restricted-live: Figma REST only, no OpenAI gate required
  node scripts/run-figma-to-ui.mjs \
    --project-id demo \
    --figma-url https://www.figma.com/design/<file-key>/<name>?node-id=<node-id> \
    --mode restricted-live \
    --allow-figma-network \
    --json

  # live: needs both --allow-figma-network and --allow-openai
  node scripts/run-figma-to-ui.mjs \
    --project-id demo \
    --figma-url https://www.figma.com/design/<file-key>/<name>?node-id=<node-id> \
    --mode live \
    --allow-figma-network \
    --allow-openai \
    --json

Gate notes:
  - --allow-openai is only needed for live mode.
  - restricted-live mode only requires --allow-figma-network.
  - local mode requires neither gate.
`);
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a finite number`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const request = {
    mode: "local",
    viewportIds: [],
    gates: {},
  };
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--help":
      case "-h":
        return { help: true, request, json };
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
      case "--project-id":
      case "--projectId":
        request.projectId = readValue(args, index, flag);
        index += 1;
        break;
      case "--designBundleRevision":
      case "--design-bundle-revision":
        request.designBundleRevision = parsePositiveInteger(
          readValue(args, index, flag),
          flag,
        );
        index += 1;
        break;
      case "--mode":
        request.mode = readValue(args, index, flag);
        index += 1;
        break;
      case "--run-label":
      case "--runLabel":
        request.runLabel = readValue(args, index, flag);
        index += 1;
        break;
      case "--viewport":
        request.viewportIds.push(readValue(args, index, flag));
        index += 1;
        break;
      case "--threshold":
        request.threshold = {
          ...(request.threshold ?? {}),
          pixelDiffPercent: parseNumber(readValue(args, index, flag), flag),
        };
        index += 1;
        break;
      case "--run-compare":
      case "--runCompare":
        request.runCompare = true;
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
      case "--allow-openai":
        request.gates.allowOpenAI = true;
        break;
      case "--allow-asset-backfill":
        request.gates.allowAssetBackfill = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (request.viewportIds.length === 0) {
    delete request.viewportIds;
  }
  if (Object.keys(request.gates).length === 0) {
    delete request.gates;
  }
  return { help: false, request, json };
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

  const result = await runM7E2EFlow(parsed.request);
  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`M7 report written to ${result.artifacts.summaryJson}`);
    console.log(`M7 markdown written to ${result.artifacts.summaryMarkdown}`);
    console.log(`status: ${result.ok ? "passed" : "failed"}`);
    console.log(`nextAction: ${result.nextAction ?? "none"}`);
  }
  process.exit(m7ExitCode(result));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
