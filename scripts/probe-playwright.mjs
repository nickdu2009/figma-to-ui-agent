import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwrightExecutable = resolve(
  projectRoot,
  "node_modules/.bin/playwright",
);
const browserPath = resolve(projectRoot, "data/playwright-browsers");
const probeRoot = resolve(projectRoot, "data/probes/playwright");
const resultPath = resolve(
  projectRoot,
  "data/probes/m0-local/playwright.json",
);

function runProcess(command, args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 60_000);

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

async function listFiles(root) {
  const entries = await readdir(root, {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

async function runCase(name) {
  const outputDir = resolve(probeRoot, name, "test-results");
  await rm(resolve(probeRoot, name), { recursive: true, force: true });

  const result = await runProcess(
    playwrightExecutable,
    [
      "test",
      "tests/probes/playwright-diff.spec.ts",
      "--config",
      "playwright.config.ts",
      "--reporter=json",
    ],
    {
      ...process.env,
      M0_PLAYWRIGHT_CASE: name,
      M0_PLAYWRIGHT_OUTPUT_DIR: outputDir,
      PLAYWRIGHT_BROWSERS_PATH: browserPath,
    },
  );

  assert.equal(result.signal, null, `${name} probe 被信号终止`);
  const report = JSON.parse(result.stdout);
  const reportPath = resolve(probeRoot, name, "report.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    ...result,
    report,
    outputDir,
    reportPath,
  };
}

async function run() {
  const same = await runCase("same");
  assert.equal(
    same.code,
    0,
    `相同图片应通过:\n${same.stderr}\n${same.stdout}`,
  );

  const mismatch = await runCase("mismatch");
  assert.notEqual(mismatch.code, 0, "已知偏移图片必须产生失败");

  const mismatchFiles = await listFiles(mismatch.outputDir);
  const pngFiles = mismatchFiles.filter((path) => path.endsWith(".png"));
  const basenames = pngFiles.map((path) => path.split("/").at(-1));

  for (const token of ["expected", "actual", "diff"]) {
    assert.ok(
      basenames.some((name) => name?.includes(token)),
      `缺少 ${token} 图片附件: ${basenames.join(",")}`,
    );
  }

  const packageJson = JSON.parse(
    await readFile(
      resolve(projectRoot, "node_modules/@playwright/test/package.json"),
      "utf8",
    ),
  );

  const result = {
    schemaVersion: "1",
    status: "passed",
    networkAccess: false,
    playwrightVersion: packageJson.version,
    browserVersion: "149.0.7827.55",
    browserRevision: "1228",
    ffmpegRevision: "1011",
    sameImagePassed: true,
    mismatchFailedAsExpected: true,
    artifacts: pngFiles.map((path) => relative(projectRoot, path)),
    publicApi: [
      "testInfo.snapshotPath",
      "expect(Buffer).toMatchSnapshot",
      "json reporter",
      "attachments",
    ],
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
