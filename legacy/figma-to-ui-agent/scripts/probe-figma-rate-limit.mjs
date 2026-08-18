import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FigmaRestClient } from "../src/figma/rest-client.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localOutputPath = resolve(
  projectRoot,
  "data/probes/figma-rate-limit/local.json",
);
const liveOutputPath = resolve(
  projectRoot,
  "data/probes/figma-rate-limit/latest.json",
);

function readMode() {
  const index = process.argv.indexOf("--mode");
  return index === -1 ? "local" : process.argv[index + 1];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(path, result) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function extractRateLimitDiagnostics(error) {
  const message =
    error instanceof Error ? error.message : String(error);
  const diagnostics = {};
  for (const [key, pattern] of [
    ["retryAfterSeconds", /retryAfterSeconds=([A-Za-z0-9_.:-]{1,64})/],
    ["planTier", /planTier=([A-Za-z0-9_.:-]{1,64})/],
    ["rateLimitType", /rateLimitType=([A-Za-z0-9_.:-]{1,64})/],
  ]) {
    const match = message.match(pattern);
    if (match?.[1]) {
      diagnostics[key] = match[1];
    }
  }
  if (message.includes("upgradeLinkPresent=true")) {
    diagnostics.upgradeLinkPresent = true;
  }
  return diagnostics;
}

function sanitizeError(error, secrets) {
  let message =
    error instanceof Error ? error.message : String(error);
  for (const secret of secrets.filter(Boolean)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
}

async function runLocal() {
  await writeJson(localOutputPath, {
    schemaVersion: "1",
    status: "not_authorized",
    generatedAt: new Date().toISOString(),
    networkAccess: false,
    readOnly: true,
    openAICalled: false,
    thirdPartyMcpExecuted: false,
    figmaMutationAttempted: false,
    rawPayloadPersisted: false,
    endpoint: "file",
    requestCount: 0,
    reason: "本地模式不执行 Figma REST 网络请求。",
  });
}

async function runLive() {
  assert.equal(
    process.env.FIGMA_RATE_LIMIT_PROBE_AUTHORIZED,
    "1",
    "缺少 FIGMA_RATE_LIMIT_PROBE_AUTHORIZED=1，拒绝 Figma rate-limit live probe",
  );
  const token = process.env.FIGMA_API_KEY?.trim();
  const fileKey = process.env.FIGMA_FLOW_FILE_KEY?.trim();
  assert.ok(token, "缺少 FIGMA_API_KEY");
  assert.ok(fileKey, "缺少 FIGMA_FLOW_FILE_KEY");

  const client = new FigmaRestClient({
    token,
    maxRetries: 0,
  });

  try {
    await client.getFile(fileKey);
    await writeJson(liveOutputPath, {
      schemaVersion: "1",
      status: "passed",
      generatedAt: new Date().toISOString(),
      networkAccess: true,
      readOnly: true,
      openAICalled: false,
      thirdPartyMcpExecuted: false,
      figmaMutationAttempted: false,
      rawPayloadPersisted: false,
      endpoint: "file",
      requestCount: 1,
      fileKeySha256: sha256(fileKey),
      httpStatus: 200,
      rateLimited: false,
      rateLimitDiagnostics: {},
    });
  } catch (error) {
    const httpStatus =
      typeof error === "object" && error && "status" in error
        ? error.status
        : undefined;
    const rateLimited = httpStatus === 429;
    await writeJson(liveOutputPath, {
      schemaVersion: "1",
      status: rateLimited ? "rate_limited" : "failed",
      generatedAt: new Date().toISOString(),
      networkAccess: true,
      readOnly: true,
      openAICalled: false,
      thirdPartyMcpExecuted: false,
      figmaMutationAttempted: false,
      rawPayloadPersisted: false,
      endpoint: "file",
      requestCount: 1,
      fileKeySha256: sha256(fileKey),
      httpStatus,
      rateLimited,
      rateLimitDiagnostics: rateLimited
        ? extractRateLimitDiagnostics(error)
        : {},
      sanitizedError: sanitizeError(error, [token, fileKey]),
    });
    if (!rateLimited) {
      process.exitCode = 1;
    }
  }
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
      process.env.FIGMA_API_KEY,
      process.env.FIGMA_FLOW_FILE_KEY,
    ])}\n`,
  );
  process.exitCode = 1;
});
