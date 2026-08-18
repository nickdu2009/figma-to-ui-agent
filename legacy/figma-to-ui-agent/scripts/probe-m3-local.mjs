import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputPath = resolve(
  projectRoot,
  "data/probes/m3/local-gates.json",
);
const nodeExecutable = process.execPath;

function sanitizedEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("M3_")) {
      delete env[name];
    }
  }
  return env;
}

function runScript(relativePath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(nodeExecutable, [relativePath], {
      cwd: projectRoot,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      resolveRun({
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });
  });
}

function assertRejected(result, acceptedMessages) {
  if (
    result.code === 0 ||
    result.signal !== null ||
    !acceptedMessages.includes(result.stderr)
  ) {
    throw new Error(
      `m3_fail_closed_probe_failed:${JSON.stringify(result)}`,
    );
  }
}

async function main() {
  const preflight = JSON.parse(
    await readFile(
      resolve(projectRoot, "data/probes/m3/preflight.json"),
      "utf8",
    ),
  );
  if (
    preflight.status !== "pending_flow_calibration" ||
    preflight.networkAccess !== false ||
    preflight.sourceScan.sampleMatches.length !== 0 ||
    preflight.sourceScan.secretPatternMatches.length !== 0
  ) {
    throw new Error("m3_local_preflight_not_clean");
  }

  const freeze = await runScript("scripts/freeze-m3.mjs");
  const flow = await runScript("scripts/run-m3-flow.mjs");
  const manifest = await runScript(
    "scripts/m3-source-manifest.mjs",
  );
  const blind = await runScript("scripts/run-m3-blind.mjs");
  const finalize = await runScript("scripts/finalize-m3.mjs");
  assertRejected(freeze, ["m3_freeze_confirmation_missing"]);
  assertRejected(flow, [
    "m3_flow_external_execution_not_authorized",
  ]);
  assertRejected(manifest, [
    "m3_freeze_manifest_missing",
    "m3_source_manifest_confirmation_missing",
  ]);
  assertRejected(blind, [
    "m3_freeze_manifest_missing",
    "m3_external_execution_not_authorized",
  ]);
  assertRejected(finalize, [
    "m3_freeze_manifest_missing",
    "m3_finalization_requires_three_cases",
  ]);

  const result = {
    schemaVersion: "1",
    status: "local_pass_external_gates_closed",
    generatedAt: new Date().toISOString(),
    networkAccess: false,
    preflightStatus: preflight.status,
    checks: {
      freezeRequiresExplicitCalibrationConfirmation: true,
      flowRequiresExplicitExternalAuthorization: true,
      sourceManifestRequiresFreezeAndUnknownInputConfirmation: true,
      blindRunRequiresFreezeAndExternalAuthorization: true,
      finalizationRequiresFreezeAndThreeValidCases: true,
      productionSourceScanClean: true,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
