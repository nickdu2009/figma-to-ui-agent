import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import figmaToUiExtension from "../src/extension.ts";
import {
  EXACT_TOOL_NAMES,
  TOOL_SCHEMA_VERSION,
} from "../src/runtime/tool-boundary.ts";
import {
  buildPiArgs,
  controlledEnvironment,
} from "./start-agent.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piExecutable = resolve(projectRoot, "node_modules/.bin/pi");
const resultPath = resolve(projectRoot, "data/probes/m0-local/pi.json");
const auditPath = resolve(projectRoot, "data/audit/m0-boundary.jsonl");

function createFakePi() {
  const handlers = new Map();
  const tools = [];
  let activeTools = [];
  let execCalls = 0;

  const api = {
    on(eventName, handler) {
      const current = handlers.get(eventName) ?? [];
      current.push(handler);
      handlers.set(eventName, current);
    },
    registerTool(tool) {
      tools.push(tool);
    },
    setActiveTools(names) {
      activeTools = [...names];
    },
    getActiveTools() {
      return [...activeTools];
    },
    getAllTools() {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        promptGuidelines: tool.promptGuidelines,
        sourceInfo: {
          path: "./src/extension.ts",
          source: "extension",
          scope: "temporary",
          origin: "top-level",
        },
      }));
    },
    async exec() {
      execCalls += 1;
      throw new Error("probe_forbids_exec");
    },
  };

  return {
    api,
    tools,
    forceActive(names) {
      activeTools = [...names];
    },
    get execCalls() {
      return execCalls;
    },
    async emit(eventName, event, context) {
      const results = [];
      for (const handler of handlers.get(eventName) ?? []) {
        results.push(await handler(event, context));
      }
      return results;
    },
  };
}

function createFakeContext() {
  const notifications = [];
  let abortCount = 0;

  return {
    context: {
      cwd: projectRoot,
      hasUI: true,
      ui: {
        notify(message, level) {
          notifications.push({ message, level });
        },
      },
      abort() {
        abortCount += 1;
      },
    },
    notifications,
    get abortCount() {
      return abortCount;
    },
  };
}

function functionToolPayload(names) {
  return {
    tools: names.map((name) => ({
      type: "function",
      function: { name, parameters: { type: "object" } },
    })),
  };
}

async function run() {
  assert.equal(
    process.argv.includes("--mode") &&
      process.argv[process.argv.indexOf("--mode") + 1],
    "local",
    "Pi live probe 尚未授权",
  );

  await rm(auditPath, { force: true });

  const environment = controlledEnvironment();
  const [{ stdout: versionStdout }, { stdout: helpStdout }] =
    await Promise.all([
      execFileAsync(piExecutable, ["--version"], {
        cwd: projectRoot,
        env: environment,
      }),
      execFileAsync(piExecutable, ["--help"], {
        cwd: projectRoot,
        env: environment,
        maxBuffer: 1024 * 1024,
      }),
    ]);

  const version = versionStdout.trim();
  assert.equal(version, "0.81.1");

  for (const flag of [
    "--no-builtin-tools",
    "--no-extensions",
    "--extension",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--tools",
    "--offline",
  ]) {
    assert.match(helpStdout, new RegExp(flag.replaceAll("-", "\\-")));
  }

  const startArgs = buildPiArgs("probe-model");
  assert.deepEqual(
    startArgs.slice(startArgs.indexOf("--tools") + 1),
    [EXACT_TOOL_NAMES.join(",")],
  );
  assert.ok(startArgs.includes("./src/extension.ts"));

  const fake = createFakePi();
  const context = createFakeContext();
  figmaToUiExtension(fake.api);

  assert.deepEqual(fake.api.getActiveTools(), []);
  assert.deepEqual(
    fake.tools.map((tool) => tool.name),
    [...EXACT_TOOL_NAMES],
  );

  for (const tool of fake.tools) {
    assert.equal(
      tool.parameters.properties.schemaVersion.const,
      TOOL_SCHEMA_VERSION,
    );
    assert.equal(typeof tool.execute, "function");
  }

  await fake.emit(
    "session_start",
    { type: "session_start" },
    context.context,
  );
  assert.deepEqual(fake.api.getActiveTools(), [...EXACT_TOOL_NAMES]);

  const beforeAgentResults = await fake.emit(
    "before_agent_start",
    {
      type: "before_agent_start",
      prompt: "probe",
      systemPrompt: "original",
      systemPromptOptions: {
        cwd: projectRoot,
        selectedTools: [...EXACT_TOOL_NAMES],
        contextFiles: [],
        skills: [],
      },
    },
    context.context,
  );
  assert.match(beforeAgentResults[0].systemPrompt, /m2-bounded-loop-v1/);

  await fake.emit(
    "turn_start",
    { type: "turn_start", turnIndex: 0, timestamp: Date.now() },
    context.context,
  );

  await fake.emit(
    "before_provider_request",
    {
      type: "before_provider_request",
      payload: functionToolPayload(EXACT_TOOL_NAMES),
    },
    context.context,
  );

  const bashResults = await fake.emit(
    "user_bash",
    {
      type: "user_bash",
      command: "printf should-not-run",
      excludeFromContext: false,
      cwd: projectRoot,
    },
    context.context,
  );
  assert.equal(bashResults[0].result.exitCode, 126);
  assert.equal(bashResults[0].result.output, "managed_mode_shell_denied");
  assert.equal(fake.execCalls, 0);

  fake.forceActive([...EXACT_TOOL_NAMES, "rogue_tool"]);
  const inputResults = await fake.emit(
    "input",
    { type: "input", text: "probe", source: "interactive" },
    context.context,
  );
  assert.equal(inputResults[0].action, "handled");
  assert.ok(context.abortCount >= 1);

  fake.forceActive([...EXACT_TOOL_NAMES]);
  await assert.rejects(
    fake.emit(
      "before_provider_request",
      {
        type: "before_provider_request",
        payload: functionToolPayload([...EXACT_TOOL_NAMES, "rogue_tool"]),
      },
      context.context,
    ),
    /tool_boundary_violation/,
  );

  const auditLines = (await readFile(auditPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    auditLines.map((line) => line.event),
    ["provider_tool_names", "user_bash_denied"],
  );
  assert.ok(auditLines.every((line) => !("payload" in line)));
  assert.ok(auditLines.every((line) => !("command" in line)));
  assert.ok(auditLines.every((line) => !("input" in line)));

  const result = {
    schemaVersion: "1",
    status: "passed",
    networkAccess: false,
    piVersion: version,
    toolNames: [...EXACT_TOOL_NAMES],
    registeredToolCount: fake.tools.length,
    registeredToolsExecutable: true,
    userBashDeniedWithoutExec: true,
    providerToolAuditContainsNamesOnly: true,
    discoveryFlagsVerified: true,
    driftFailsClosed: true,
  };

  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
