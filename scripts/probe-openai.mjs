import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXACT_TOOL_NAMES,
} from "../src/runtime/tool-boundary.ts";
import {
  buildOpenAiModelsConfig,
  normalizeOpenAiBaseUrl,
} from "../src/runtime/openai-provider.ts";
import {
  buildPiArgs,
  controlledEnvironment,
} from "./start-agent.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piExecutable = resolve(projectRoot, "node_modules/.bin/pi");
const auditPath = resolve(projectRoot, "data/audit/m0-boundary.jsonl");
const localResultPath = resolve(
  projectRoot,
  "data/probes/m0-local/openai.json",
);
const liveResultPath = resolve(
  projectRoot,
  "data/probes/m0-live/openai.json",
);
const liveAuditEvidencePath = resolve(
  projectRoot,
  "data/probes/m0-live/openai-provider-audit.jsonl",
);
const liveImagePath = resolve(
  projectRoot,
  "data/probes/playwright/same/snapshots/chromium/playwright-diff.spec.ts/dynamic.png",
);

function readMode() {
  const index = process.argv.indexOf("--mode");
  return index === -1 ? "local" : process.argv[index + 1];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runProcess(command, args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

function parseJsonLines(serialized) {
  return serialized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assistantText(message) {
  if (!message || message.role !== "assistant") {
    return "";
  }
  return (Array.isArray(message.content) ? message.content : [])
    .filter(
      (item) =>
        item?.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");
}

function sanitizeError(error, secrets) {
  let message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
}

async function writeJson(path, result) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function assertExactProviderTools(auditRecords) {
  const expected = [...EXACT_TOOL_NAMES].sort();
  assert.ok(auditRecords.length > 0, "缺少 provider 请求审计");

  for (const record of auditRecords) {
    assert.deepEqual(
      [...record.toolNames].sort(),
      expected,
      "provider 请求工具集合发生漂移",
    );
  }
}

async function runLocal() {
  await writeJson(localResultPath, {
    schemaVersion: "1",
    status: "not_authorized",
    networkAccess: false,
    model: process.env.PI_OPENAI_MODEL ?? "gpt-5.4",
    provider: "openai",
    expectedToolNames: [...EXACT_TOOL_NAMES],
    rawPayloadPersisted: false,
    reason: "本地模式不执行 OpenAI 网络请求。",
  });
}

async function runLive() {
  assert.equal(
    process.env.OPENAI_LIVE_PROBE_AUTHORIZED,
    "1",
    "缺少 OPENAI_LIVE_PROBE_AUTHORIZED=1，拒绝 OpenAI live probe",
  );

  const apiKey = process.env.OPENAI_API_KEY;
  const configuredBaseUrl = process.env.OPENAI_BASE_URL;
  const model =
    process.env.PI_OPENAI_MODEL ?? process.env.OPENAI_MODEL;
  assert.ok(apiKey, "缺少 OPENAI_API_KEY");
  assert.ok(configuredBaseUrl, "缺少 OPENAI_BASE_URL");
  assert.equal(model, "gpt-5.4", "M0 live probe 必须使用 gpt-5.4");

  const normalizedBaseUrl = normalizeOpenAiBaseUrl(configuredBaseUrl);
  const image = await readFile(liveImagePath);
  assert.equal(
    image.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "M0 live 图像不是有效 PNG",
  );

  await rm(auditPath, { force: true });

  const prompt = [
    "这是 M0 live 探针。",
    "请观察附带图片，然后调用且仅调用一次 inspect_figma。",
    "参数必须是：schemaVersion 为 1，projectId 为 m0-live-probe，",
    "figmaUrl 为 https://www.figma.com/design/m0-live-probe。",
    "不得调用其他工具。工具返回后只回复 M0_OPENAI_LIVE_OK。",
  ].join("");
  const args = [
    ...buildPiArgs(model),
    "--mode",
    "json",
    "--print",
    "--no-session",
    "--approve",
    `@${relative(projectRoot, liveImagePath)}`,
    prompt,
  ];
  const configDir = await mkdtemp(
    join(tmpdir(), "figma-to-ui-agent-pi-"),
  );
  let execution;
  try {
    await writeFile(
      resolve(configDir, "models.json"),
      `${JSON.stringify(
        buildOpenAiModelsConfig(configuredBaseUrl),
        null,
        2,
      )}\n`,
      "utf8",
    );
    const environment = controlledEnvironment({
      ...process.env,
      PI_CODING_AGENT_DIR: configDir,
      PI_OPENAI_MODEL: model,
      PI_TELEMETRY: "0",
    });
    execution = await runProcess(
      piExecutable,
      args,
      environment,
    );
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }

  assert.equal(execution.signal, null, "Pi live probe 被信号终止");
  const events = parseJsonLines(execution.stdout);
  if (execution.code !== 0) {
    const providerError = events
      .flatMap((event) => [
        event.message?.errorMessage,
        event.error?.errorMessage,
        event.assistantMessageEvent?.error?.errorMessage,
      ])
      .find((message) => typeof message === "string");
    const stderr = sanitizeError(execution.stderr, [
      apiKey,
      configuredBaseUrl,
      normalizedBaseUrl,
    ])
      .trim()
      .slice(0, 4_000);
    throw new Error(
      [
        `pi_live_failed:code=${execution.code}`,
        `provider=${providerError ?? "unknown"}`,
        `stderr=${stderr || "empty"}`,
      ].join("\n"),
    );
  }

  const auditRecords = parseJsonLines(
    await readFile(auditPath, "utf8"),
  ).filter((record) => record.event === "provider_tool_names");
  assertExactProviderTools(auditRecords);
  assert.ok(
    auditRecords.some((record) => record.hasImageInput === true),
    "provider 请求未确认图像输入",
  );
  await mkdir(dirname(liveAuditEvidencePath), { recursive: true });
  await writeFile(
    liveAuditEvidencePath,
    `${auditRecords
      .map((record) =>
        JSON.stringify({
          schemaVersion: record.schemaVersion,
          timestamp: record.timestamp,
          event: record.event,
          toolNames: record.toolNames,
          hasImageInput: record.hasImageInput,
          inputContentTypes: record.inputContentTypes,
        }),
      )
      .join("\n")}\n`,
    "utf8",
  );

  const toolStarts = events.filter(
    (event) => event.type === "tool_execution_start",
  );
  const toolEnds = events.filter(
    (event) => event.type === "tool_execution_end",
  );
  assert.deepEqual(
    toolStarts.map((event) => event.toolName),
    ["inspect_figma"],
    "模型必须且只能调用一次 inspect_figma",
  );
  assert.equal(toolEnds.length, 1, "工具执行结束事件数量不正确");
  assert.equal(toolEnds[0].toolName, "inspect_figma");
  assert.equal(toolEnds[0].isError, false);

  const assistantMessages = events
    .filter((event) => event.type === "message_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
  assert.ok(assistantMessages.length >= 2, "缺少工具前后 assistant 消息");
  assert.ok(
    assistantMessages.every(
      (message) =>
        message.provider === "openai" && message.model === model,
    ),
    "assistant 消息模型或 provider 不匹配",
  );
  assert.ok(
    assistantMessages.some((message) =>
      assistantText(message).includes("M0_OPENAI_LIVE_OK"),
    ),
    "模型未返回 M0_OPENAI_LIVE_OK",
  );

  const usage = assistantMessages.reduce(
    (total, message) => ({
      input: total.input + (message.usage?.input ?? 0),
      output: total.output + (message.usage?.output ?? 0),
      totalTokens:
        total.totalTokens + (message.usage?.totalTokens ?? 0),
    }),
    { input: 0, output: 0, totalTokens: 0 },
  );
  const result = {
    schemaVersion: "1",
    status: "passed",
    executedAt: new Date().toISOString(),
    networkAccess: true,
    provider: "openai",
    model,
    endpointBaseSha256: sha256(normalizedBaseUrl),
    image: {
      sha256: sha256(image),
      byteCount: image.byteLength,
      providerInputConfirmed: true,
    },
    providerRequests: {
      count: auditRecords.length,
      exactToolNames: [...EXACT_TOOL_NAMES],
      exactToolBoundaryConfirmed: true,
      inputContentTypes: [
        ...new Set(
          auditRecords.flatMap(
            (record) => record.inputContentTypes ?? [],
          ),
        ),
      ].sort(),
    },
    toolRound: {
      callNames: toolStarts.map((event) => event.toolName),
      completedWithoutToolError: true,
      completionMarkerConfirmed: true,
    },
    usage,
    rawPayloadPersisted: false,
    sanitizedProviderAuditPersisted: true,
    modelTextPersisted: false,
    credentialPersisted: false,
  };

  await writeJson(liveResultPath, result);
}

async function run() {
  const mode = readMode();
  if (mode === "local") {
    await runLocal();
    return;
  }

  assert.equal(mode, "live", `未知 probe mode: ${String(mode)}`);
  await runLive();
}

run().catch((error) => {
  process.stderr.write(
    `${sanitizeError(error, [
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_BASE_URL,
    ])}\n`,
  );
  process.exitCode = 1;
});
