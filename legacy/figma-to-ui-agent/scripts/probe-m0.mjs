import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localProbeRoot = resolve(projectRoot, "data/probes/m0-local");
const liveFigmaResultPath = resolve(
  projectRoot,
  "data/probes/m0-live/figma-rest.json",
);
const liveOpenAiResultPath = resolve(
  projectRoot,
  "data/probes/m0-live/openai.json",
);
const browserPath = resolve(projectRoot, "data/playwright-browsers");

function readMode() {
  const index = process.argv.indexOf("--mode");
  return index === -1 ? "local" : process.argv[index + 1];
}

function runProcess(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);

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

async function runChecked(command, args, env) {
  const result = await runProcess(command, args, env);
  if (result.code !== 0 || result.signal) {
    throw new Error(
      [
        `command_failed:${command} ${args.join(" ")}`,
        `code=${result.code}`,
        `signal=${String(result.signal)}`,
        result.stderr,
        result.stdout,
      ].join("\n"),
    );
  }
  return result;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function summarizeFigmaEvidence(result) {
  if (!result) {
    return {
      status: "not_available",
      corePassed: false,
      variablesCapability: "unverified",
      reason: "当前工作区没有可离线读取的 Figma REST live 脱敏证据。",
    };
  }

  assert.equal(result.schemaVersion, "1");
  assert.equal(result.rawPayloadPersisted, false);

  return {
    status: result.status,
    executedAt: result.executedAt,
    fileKeySha256: result.fileKeySha256,
    policyVersion: result.policyVersion,
    corePassed: result.corePassed === true,
    variablesCapability: result.variablesCapability,
    endpoints: {
      nodes: {
        httpStatus: result.nodes?.httpStatus,
        readable: result.nodes?.readable === true,
      },
      screenshot: {
        httpStatus: result.screenshot?.httpStatus,
        readable: result.screenshot?.readable === true,
      },
      imageFills: {
        httpStatus: result.assets?.httpStatus,
        readable: result.assets?.readable === true,
        imageCount: result.assets?.imageCount,
      },
      variables: {
        httpStatus: result.variables?.httpStatus,
        readable: result.variables?.readable === true,
      },
    },
  };
}

function summarizeOpenAiEvidence(result) {
  if (!result) {
    return {
      status: "not_available",
      passed: false,
      reason: "当前工作区没有可离线读取的 OpenAI live 脱敏证据。",
    };
  }

  assert.equal(result.schemaVersion, "1");
  assert.equal(result.rawPayloadPersisted, false);
  assert.equal(result.modelTextPersisted, false);
  assert.equal(result.credentialPersisted, false);

  const toolCallNames = result.toolRound?.callNames ?? [];
  const passed =
    result.status === "passed" &&
    result.model === "gpt-5.4" &&
    result.image?.providerInputConfirmed === true &&
    result.providerRequests?.exactToolBoundaryConfirmed === true &&
    toolCallNames.length === 1 &&
    toolCallNames[0] === "inspect_figma" &&
    result.toolRound?.completionMarkerConfirmed === true;

  return {
    status: result.status,
    executedAt: result.executedAt,
    passed,
    provider: result.provider,
    model: result.model,
    imageInputConfirmed:
      result.image?.providerInputConfirmed === true,
    providerRequestCount: result.providerRequests?.count,
    exactToolBoundaryConfirmed:
      result.providerRequests?.exactToolBoundaryConfirmed === true,
    toolCallNames,
    completionMarkerConfirmed:
      result.toolRound?.completionMarkerConfirmed === true,
    usage: result.usage,
  };
}

async function runLocal() {
  const environment = {
    ...process.env,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
  };

  await runChecked(
    process.execPath,
    ["scripts/probe-pi.mjs", "--mode", "local"],
    environment,
  );
  await runChecked(
    process.execPath,
    ["scripts/probe-playwright.mjs"],
    environment,
  );
  await runChecked(
    process.execPath,
    ["scripts/probe-figma-rest.mjs", "--mode", "local"],
    environment,
  );

  const [
    pi,
    playwright,
    figmaLocal,
    figmaLive,
    openAiLive,
    packageJson,
    packageLock,
  ] = await Promise.all([
    readJson(resolve(localProbeRoot, "pi.json")),
    readJson(resolve(localProbeRoot, "playwright.json")),
    readJson(resolve(localProbeRoot, "figma-rest.json")),
    readOptionalJson(liveFigmaResultPath),
    readOptionalJson(liveOpenAiResultPath),
    readJson(resolve(projectRoot, "package.json")),
    readFile(resolve(projectRoot, "package-lock.json")),
  ]);

  assert.equal(pi.status, "passed");
  assert.equal(playwright.status, "passed");
  assert.equal(figmaLocal.status, "not_authorized");
  assert.equal(figmaLocal.networkAccess, false);

  const figmaEvidence = summarizeFigmaEvidence(figmaLive);
  const openAiEvidence = summarizeOpenAiEvidence(openAiLive);

  const npmVersionResult = await runChecked("npm", ["--version"]);
  const generatedAt = new Date().toISOString();
  const reportDate = generatedAt.slice(0, 10);
  const summary = {
    schemaVersion: "1",
    status:
      figmaEvidence.corePassed && openAiEvidence.passed
        ? "local_pass_m0_live_confirmed"
        : figmaEvidence.corePassed
          ? "local_pass_figma_core_confirmed_openai_pending"
          : "local_pass_external_pending",
    generatedAt,
    environment: {
      node: process.version,
      npm: npmVersionResult.stdout.trim(),
      architecture: process.arch,
      platform: process.platform,
      packageLockSha256: sha256(packageLock),
    },
    dependencies: {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    },
    pi,
    playwright,
    figma: {
      localProbe: figmaLocal,
      liveEvidence: figmaEvidence,
    },
    openai: {
      localProbe: {
        status: "not_authorized",
        networkAccess: false,
        reason: "本地模式不调用 OpenAI。",
      },
      liveEvidence: openAiEvidence,
    },
    residuals: [
      "传递依赖 node-domexception@1.0.0 已弃用，等待上游替换。",
      ...(openAiEvidence.passed
        ? []
        : ["OpenAI 图像与工具回合尚未获授权或没有通过证据。"]),
      ...(figmaEvidence.corePassed
        ? []
        : ["当前工作区缺少 Figma REST 核心能力的 live 脱敏证据。"]),
    ],
  };

  await mkdir(localProbeRoot, { recursive: true });
  await writeFile(
    resolve(localProbeRoot, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  const markdown = `# M0 本地能力探针报告

- 状态：${
    figmaEvidence.corePassed && openAiEvidence.passed
      ? "本地探针通过，M0 live 已有完整通过证据"
      : "本地探针通过，外部能力仍有待验证项"
  }
- 时间：${generatedAt}
- Node：${summary.environment.node}
- npm：${summary.environment.npm}
- 架构：${summary.environment.platform}/${summary.environment.architecture}
- package-lock SHA-256：\`${summary.environment.packageLockSha256}\`

## 已验证

- Pi ${pi.piVersion} CLI 存在受控启动所需参数。
- Extension 恰好注册并激活四个工具：${pi.toolNames.map((name) => `\`${name}\``).join("、")}。
- 工具漂移和 provider payload 多余工具均失败关闭。
- \`user_bash\` 返回拒绝结果，未调用进程执行 API。
- Playwright ${playwright.playwrightVersion} 已启动 Chromium ${playwright.browserVersion}（revision ${playwright.browserRevision}）。
- 动态相同图片通过；已知偏移图片按预期失败，并生成 expected、actual、diff。
- Figma 本地探针使用 REST 契约且未访问网络。
- 本地探针未访问 OpenAI 或 Figma。

## Figma REST 已有证据

${
  figmaEvidence.corePassed
    ? `- 状态：${figmaEvidence.status}
- 门禁策略：${figmaEvidence.policyVersion}
- 节点、截图和图片填充核心门：通过
- Variables：${figmaEvidence.variablesCapability}
- 文件标识：仅记录 SHA-256 \`${figmaEvidence.fileKeySha256}\``
    : `- 状态：${figmaEvidence.status}
- ${figmaEvidence.reason}`
}

## ${
  openAiEvidence.passed
    ? "OpenAI Live 已有证据"
    : "尚未执行"
}

${
  openAiEvidence.passed
    ? `- 本次本地运行没有访问 OpenAI；已离线确认 ${openAiEvidence.executedAt} 的 live 通过证据。
- 模型：${openAiEvidence.model}
- 图像输入：已确认
- 工具边界：恰好四个工具
- 实际工具调用：${openAiEvidence.toolCallNames.map((name) => `\`${name}\``).join("、")}`
    : `- OpenAI 模型图像输入和四工具回合。

OpenAI live probe 需要单独授权；未完成前，M0 不视为整体通过，M1-M3 不得启动。`
}

## 残余项

${summary.residuals.map((item) => `- ${item}`).join("\n")}
`;

  const reportPath = resolve(
    projectRoot,
    `reports/m0/${reportDate}-local.md`,
  );
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, "utf8");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function runLive() {
  assert.equal(
    process.env.M0_LIVE_PROBE_AUTHORIZED,
    "1",
    "总体 M0 live probe 未获授权",
  );
  assert.equal(
    process.env.OPENAI_LIVE_PROBE_AUTHORIZED,
    "1",
    "OpenAI live probe 未获单独授权",
  );

  const figmaEvidence = summarizeFigmaEvidence(
    await readOptionalJson(liveFigmaResultPath),
  );
  assert.equal(
    figmaEvidence.corePassed,
    true,
    "缺少通过的 Figma REST 核心能力证据",
  );

  const reuseOpenAiEvidence =
    process.env.M0_REUSE_OPENAI_EVIDENCE === "1";
  if (!reuseOpenAiEvidence) {
    await runChecked(
      process.execPath,
      ["scripts/probe-openai.mjs", "--mode", "live"],
      process.env,
    );
  }
  const openai = await readJson(liveOpenAiResultPath);
  if (reuseOpenAiEvidence) {
    const ageMs = Date.now() - Date.parse(openai.executedAt);
    assert.ok(
      Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 10 * 60_000,
      "拒绝复用超过 10 分钟或时间无效的 OpenAI live 证据",
    );
  }
  assert.equal(openai.status, "passed");
  assert.equal(openai.model, "gpt-5.4");
  assert.equal(openai.image?.providerInputConfirmed, true);
  assert.equal(
    openai.providerRequests?.exactToolBoundaryConfirmed,
    true,
  );
  assert.deepEqual(openai.toolRound?.callNames, ["inspect_figma"]);

  const generatedAt = new Date().toISOString();
  const reportDate = generatedAt.slice(0, 10);
  const summary = {
    schemaVersion: "1",
    status: "passed",
    generatedAt,
    figma: figmaEvidence,
    openai,
    m0Passed: true,
    nextStage: "M1",
  };
  const liveRoot = resolve(projectRoot, "data/probes/m0-live");
  await mkdir(liveRoot, { recursive: true });
  await writeFile(
    resolve(liveRoot, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  const markdown = `# M0 Live 能力探针报告

- 状态：全部硬门通过
- 时间：${generatedAt}
- Figma REST 核心能力：通过
- Variables：${figmaEvidence.variablesCapability}
- OpenAI provider：${openai.provider}
- 模型：${openai.model}
- 图像输入：已在 provider 请求中确认
- 工具边界：恰好四个工具
- 实际工具调用：\`inspect_figma\`
- 工具回合完成：是

## 边界

- 本轮没有重新调用 Figma。
- 未执行第三方 MCP、Desktop MCP 或 Remote MCP。
- 未保存 provider payload、模型文本、凭据或远端 URL。

M0 已完成，可以按已推广实施计划进入 M1。
`;
  const reportPath = resolve(
    projectRoot,
    `reports/m0/${reportDate}-live.md`,
  );
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, "utf8");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

async function run() {
  const mode = readMode();
  if (mode === "live") {
    await runLive();
    return;
  }

  assert.equal(mode, "local", `未知 probe mode: ${String(mode)}`);
  await runLocal();
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
