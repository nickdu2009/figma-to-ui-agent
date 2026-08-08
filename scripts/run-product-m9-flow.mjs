#!/usr/bin/env node

import { productM9ExitCode } from "../src/runtime/product-m9-flow-contracts.ts";
import { runProductM9Flow } from "../src/runtime/product-m9-flow-service.ts";

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
  --answers <path>               Reserved confirmed-answer path
  --confirmed-flow-plan <path>   User-confirmed FlowPlan artifact path
  --run-compare                  Require injected flow validation runner
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

  const result = await runProductM9Flow(parsed.request);
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
