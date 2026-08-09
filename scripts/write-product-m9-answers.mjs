#!/usr/bin/env node

import {
  authorProductM9ConfirmationAnswers,
  parseProductM9Postcondition,
  parseProductM9Scalar,
} from "../src/runtime/product-m9-answer-authoring.ts";

function printHelp() {
  console.log(`Usage: node scripts/write-product-m9-answers.mjs --questions <path> --out <path> [options]

Generate schema-valid Flow-M10 answers for Product-M9 confirmation questions.
The command never infers business behavior from Figma text; every behavior field
must be provided explicitly through CLI arguments.

Options:
  --questions <path>             Product-M9 confirmation-questions.json
  --out <path>                   Output answers JSON path
  --all                          Answer every question in the questions file
  --question-id <id>             Answer one question; repeat for multiple ids
  --kind <kind>                  submit | navigate | set_state | open_dialog | decline
  --effect <kind>                submit effect: set_state | navigate | open_dialog
  --target-page-id <id>          Target page for navigate or submit navigate effect
  --state-key <key>              State key for set_state or submit set_state effect
  --value <value>                Boolean, number, or string value
  --dialog-node-id <id>          Dialog node for open_dialog or submit open_dialog effect
  --postcondition <spec>         Repeatable postcondition:
                                 expect_page:<pageId>
                                 expect_visible:<nodeId>
                                 expect_text:<nodeId>:<text>
                                 expect_value:<nodeId>:<value>
                                 expect_checked:<nodeId>:true|false
                                 expect_selected:<nodeId>:<value>
  --reason <text>                Required for decline; optional otherwise
  --json                         Print JSON result
  --help                         Show this help

Examples:
  node scripts/write-product-m9-answers.mjs \\
    --questions reports/product-m9/run/confirmation-questions.json \\
    --out reports/product-m9/run/answers.json \\
    --all \\
    --kind submit \\
    --effect set_state \\
    --state-key follow-status \\
    --value true \\
    --postcondition expect_visible:follow-success \\
    --reason "User confirmed follow shows success"
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
    questionIds: [],
    postconditions: [],
  };
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    switch (flag) {
      case "--help":
      case "-h":
        return { help: true, request, json };
      case "--questions":
        request.questionsPath = readValue(args, index, flag);
        index += 1;
        break;
      case "--out":
        request.outPath = readValue(args, index, flag);
        index += 1;
        break;
      case "--all":
        request.all = true;
        break;
      case "--question-id":
      case "--questionId":
        request.questionIds.push(readValue(args, index, flag));
        index += 1;
        break;
      case "--kind":
        request.answerKind = readValue(args, index, flag);
        index += 1;
        break;
      case "--effect":
        request.effectKind = readValue(args, index, flag);
        index += 1;
        break;
      case "--target-page-id":
      case "--targetPageId":
        request.targetPageId = readValue(args, index, flag);
        index += 1;
        break;
      case "--state-key":
      case "--stateKey":
        request.stateKey = readValue(args, index, flag);
        index += 1;
        break;
      case "--value":
        request.value = parseProductM9Scalar(readValue(args, index, flag));
        index += 1;
        break;
      case "--dialog-node-id":
      case "--dialogNodeId":
        request.dialogNodeId = readValue(args, index, flag);
        index += 1;
        break;
      case "--postcondition":
        request.postconditions.push(
          parseProductM9Postcondition(readValue(args, index, flag)),
        );
        index += 1;
        break;
      case "--reason":
        request.reason = readValue(args, index, flag);
        index += 1;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
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

  try {
    const result = await authorProductM9ConfirmationAnswers(parsed.request);
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Product-M9 answers written to ${result.outPath}`);
      console.log(`answerCount: ${result.answerCount}`);
    }
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
