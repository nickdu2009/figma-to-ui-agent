import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import { EXACT_TOOL_NAMES } from "../src/runtime/tool-boundary.ts";
import { buildOpenAiModelsConfig } from "../src/runtime/openai-provider.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const piExecutable = resolve(projectRoot, "node_modules/.bin/pi");
const browserPath = resolve(projectRoot, "data/playwright-browsers");
const piConfigDir = resolve(projectRoot, "data/pi-config");
export const REQUIRED_OPENAI_MODEL = "gpt-5.4";

export function buildPiArgs(model) {
  return [
    "--offline",
    "--no-builtin-tools",
    "--no-extensions",
    "-e",
    "./src/extension.ts",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--provider",
    "openai",
    "--model",
    model,
    "--session-dir",
    "./data/pi-sessions",
    "--tools",
    EXACT_TOOL_NAMES.join(","),
  ];
}

export function controlledEnvironment(env = process.env) {
  return {
    ...env,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
  };
}

export async function prepareRuntimeEnvironment(env = process.env) {
  const controlled = controlledEnvironment(env);
  const configuredBaseUrl = env.OPENAI_BASE_URL?.trim();
  if (!configuredBaseUrl) {
    return controlled;
  }

  await mkdir(piConfigDir, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(piConfigDir, "models.json"),
    `${JSON.stringify(
      buildOpenAiModelsConfig(configuredBaseUrl),
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  return {
    ...controlled,
    PI_CODING_AGENT_DIR: piConfigDir,
  };
}

export function configuredModel(env = process.env) {
  const model = env.PI_OPENAI_MODEL ?? env.OPENAI_MODEL;
  if (!model) {
    throw new Error(
      "缺少 PI_OPENAI_MODEL 或 OPENAI_MODEL；请只在本机环境中配置模型 ID。",
    );
  }
  if (model !== REQUIRED_OPENAI_MODEL) {
    throw new Error(
      `模型冻结为 ${REQUIRED_OPENAI_MODEL}，拒绝使用其他模型。`,
    );
  }
  return model;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const configured =
    process.env.PI_OPENAI_MODEL ?? process.env.OPENAI_MODEL;

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          executable: "./node_modules/.bin/pi",
          args: buildPiArgs(
            configured ?? `<required:${REQUIRED_OPENAI_MODEL}>`,
          ),
          environment: {
            PI_OFFLINE: "1",
            PI_SKIP_VERSION_CHECK: "1",
            PLAYWRIGHT_BROWSERS_PATH: "./data/playwright-browsers",
            OPENAI_BASE_URL_CONFIGURED: Boolean(
              process.env.OPENAI_BASE_URL,
            ),
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const model = configuredModel();

  const child = spawn(piExecutable, buildPiArgs(model), {
    cwd: projectRoot,
    env: await prepareRuntimeEnvironment(),
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.once("SIGINT", forwardSignal);
  process.once("SIGTERM", forwardSignal);

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Pi 被信号 ${signal} 终止`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });

  process.exitCode = exitCode;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
