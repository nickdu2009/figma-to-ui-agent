import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadAndVerifyFreeze(projectRoot) {
  const path = resolve(
    projectRoot,
    "data/baselines/m3/freeze.json",
  );
  let freeze;
  try {
    freeze = await readJson(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error("m3_freeze_manifest_missing");
    }
    throw error;
  }
  if (
    freeze.schemaVersion !== "1" ||
    freeze.status !== "frozen" ||
    freeze.runtime?.requiredModel !== "gpt-5.4" ||
    typeof freeze.runtime?.chromiumBinaryPath !== "string" ||
    typeof freeze.runtime?.chromiumBinarySha256 !== "string" ||
    !Array.isArray(freeze.controlledSurface?.fixedViewports) ||
    freeze.controlledSurface.fixedViewports.length < 1 ||
    !freeze.controlledSurface?.visualThresholds ||
    typeof freeze.sourceHashes !== "object" ||
    freeze.sourceHashes === null
  ) {
    throw new Error("m3_freeze_manifest_invalid");
  }
  const drift = [];
  for (const [relativePath, expectedHash] of Object.entries(
    freeze.sourceHashes,
  )) {
    const actualHash = sha256(
      await readFile(resolve(projectRoot, relativePath)),
    );
    if (actualHash !== expectedHash) {
      drift.push(relativePath);
    }
  }
  if (drift.length > 0) {
    throw new Error(
      `m3_freeze_drift:${drift.sort().join(",")}`,
    );
  }
  return { freeze, path };
}

export async function loadAndVerifyPreflight(projectRoot) {
  const path = resolve(
    projectRoot,
    "data/probes/m3/preflight.json",
  );
  let preflight;
  try {
    preflight = await readJson(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error("m3_preflight_missing");
    }
    throw error;
  }
  if (
    preflight.schemaVersion !== "1" ||
    preflight.status !== "pending_flow_calibration" ||
    preflight.networkAccess !== false ||
    preflight.sourceScan?.sampleMatches?.length !== 0 ||
    preflight.sourceScan?.secretPatternMatches?.length !== 0 ||
    typeof preflight.sourceHashes !== "object" ||
    preflight.sourceHashes === null
  ) {
    throw new Error("m3_preflight_not_clean");
  }
  for (const [relativePath, expectedHash] of Object.entries(
    preflight.sourceHashes,
  )) {
    const actualHash = sha256(
      await readFile(resolve(projectRoot, relativePath)),
    );
    if (actualHash !== expectedHash) {
      throw new Error(`m3_preflight_drift:${relativePath}`);
    }
  }
  return { preflight, path };
}

export async function verifyFrozenRuntime(
  projectRoot,
  freeze,
) {
  const browserPath = resolve(
    projectRoot,
    freeze.runtime.chromiumBinaryPath,
  );
  const relativeBrowserPath = relative(projectRoot, browserPath);
  if (
    relativeBrowserPath === ".." ||
    relativeBrowserPath.startsWith(`..${sep}`) ||
    relativeBrowserPath.startsWith(sep)
  ) {
    throw new Error("m3_frozen_runtime_invalid_browser_path");
  }
  const [npmVersion, packageLockBytes, browserBytes] =
    await Promise.all([
      execFileAsync("npm", ["--version"], {
        cwd: projectRoot,
      }).then((result) => result.stdout.trim()),
      readFile(resolve(projectRoot, "package-lock.json")),
      readFile(browserPath),
    ]);
  const mismatches = [];
  if (process.version !== freeze.runtime.node) {
    mismatches.push("node");
  }
  if (npmVersion !== freeze.runtime.npm) {
    mismatches.push("npm");
  }
  if (
    sha256(packageLockBytes) !== freeze.runtime.packageLockSha256
  ) {
    mismatches.push("package-lock");
  }
  if (
    sha256(browserBytes) !== freeze.runtime.chromiumBinarySha256
  ) {
    mismatches.push("chromium-binary");
  }
  if (mismatches.length > 0) {
    throw new Error(
      `m3_frozen_runtime_drift:${mismatches.join(",")}`,
    );
  }
}
