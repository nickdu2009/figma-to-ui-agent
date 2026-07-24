import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

import { EXACT_TOOL_NAMES } from "../src/runtime/tool-boundary.ts";
import { VALIDATION_BASELINE } from "../src/validation/baseline.ts";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputRoot = resolve(projectRoot, "data/probes/m3");
const browserRelativePath =
  "data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const browserPath = resolve(projectRoot, browserRelativePath);
const baselineFiles = [
  "package.json",
  "package-lock.json",
  "src/extension.ts",
  "src/runtime/tool-boundary.ts",
  "src/runtime/inspect-agent-context.ts",
  "src/runtime/frozen-run-policy.ts",
  "src/tools/contracts.ts",
  "src/tools/ui-spec-service.ts",
  "src/design-bundle/schema.ts",
  "src/ui-spec/schema.ts",
  "src/figma/assets.ts",
  "src/figma/capability-policy.ts",
  "src/figma/inspector.ts",
  "src/figma/normalize.ts",
  "src/figma/rest-client.ts",
  "src/figma/url.ts",
  "src/figma/variables.ts",
  "src/media/image-format.ts",
  "src/preview/catalog.ts",
  "src/preview/json-render-adapter.ts",
  "src/preview/project-data-plugin.ts",
  "src/preview/server.ts",
  "src/project-store/path-safety.ts",
  "src/project-store/project-id.ts",
  "src/project-store/schemas.ts",
  "src/project-store/store.ts",
  "src/validation/baseline.ts",
  "src/validation/render-and-compare.ts",
  "src/validation/schema.ts",
  "src/runtime/openai-provider.ts",
  "src/runtime/provider-audit.ts",
  "src/runtime/tool-services.ts",
  "preview/index.html",
  "preview/src/catalog-registry.tsx",
  "preview/src/main.tsx",
  "preview/src/preview-app.tsx",
  "preview/src/styles.css",
  "scripts/start-agent.mjs",
  "scripts/m3-agent-process.mjs",
  "scripts/m3-freeze-lib.mjs",
  "scripts/freeze-m3.mjs",
  "scripts/run-m3-flow.mjs",
  "scripts/m3-source-manifest.mjs",
  "scripts/run-m3-blind.mjs",
  "scripts/finalize-m3.mjs",
  "scripts/probe-m3-local.mjs",
  "scripts/probe-figma-rate-limit.mjs",
  "playwright.e2e.config.ts",
  "tests/e2e/global-setup.ts",
  "tests/e2e/preview.spec.ts",
  "tests/integration/extension/tool-wiring.test.ts",
  "tests/integration/figma/assets.test.ts",
  "tests/integration/figma/inspector.test.ts",
  "tests/integration/figma/rest-client.test.ts",
  "tests/integration/preview/server.test.ts",
  "tests/integration/validation/render-and-compare.test.ts",
  "tests/unit/contracts/design-bundle.test.ts",
  "tests/unit/contracts/ui-spec.test.ts",
  "tests/unit/figma/capability-policy.test.ts",
  "tests/unit/figma/normalize.test.ts",
  "tests/unit/figma/url.test.ts",
  "tests/unit/figma/variables.test.ts",
  "tests/unit/media/image-format.test.ts",
  "tests/unit/preview/json-render-adapter.test.ts",
  "tests/unit/project-store/store.test.ts",
  "tests/unit/runtime/frozen-run-policy.test.ts",
  "tests/unit/runtime/inspect-agent-context.test.ts",
  "tests/unit/runtime/openai-provider.test.ts",
  "tests/unit/runtime/provider-audit.test.ts",
  "tests/unit/tools/contracts.test.ts",
  "tests/unit/tools/ui-spec-service.test.ts",
  "tests/fixtures/contracts.ts",
  "tests/fixtures/figma/capability-cases.ts",
  "tests/fixtures/figma/file-response.ts",
  "tests/fixtures/figma/variables-response.ts",
  "tests/fixtures/images.ts",
];
const productionRoots = [
  "src",
  "preview",
];
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".html",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function extension(path) {
  const index = path.lastIndexOf(".");
  return index < 0 ? "" : path.slice(index);
}

async function sourceFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) {
        return await sourceFiles(child);
      }
      return sourceExtensions.has(extension(entry.name))
        ? [child]
        : [];
    }),
  );
  return nested.flat();
}

async function hashFiles(paths) {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (relativePath) => [
        relativePath,
        sha256(await readFile(resolve(projectRoot, relativePath))),
      ]),
    ),
  );
}

async function scanProductionSources() {
  const files = (
    await Promise.all(
      productionRoots.map((root) =>
        sourceFiles(resolve(projectRoot, root)),
      ),
    )
  ).flat();
  const configuredMarkers = [
    process.env.FIGMA_FLOW_FILE_KEY?.trim(),
    process.env.FIGMA_FLOW_NODE_ID?.trim(),
  ].filter((value) => value);
  const forbiddenMarkers = [
    "m2-preview",
    "page-home",
    "Flow-test",
    ...configuredMarkers,
  ];
  const sampleMatches = [];
  const secretPatternMatches = [];
  for (const path of files) {
    const content = await readFile(path, "utf8");
    const relativePath = relative(projectRoot, path);
    for (const marker of forbiddenMarkers) {
      if (content.includes(marker)) {
        sampleMatches.push({
          path: relativePath,
          markerHash: sha256(marker),
        });
      }
    }
    if (
      /\bfigd_[A-Za-z0-9_-]{12,}\b/.test(content) ||
      /\bsk-[A-Za-z0-9_-]{12,}\b/.test(content)
    ) {
      secretPatternMatches.push(relativePath);
    }
  }
  return {
    scannedFileCount: files.length,
    configuredFlowIdentifiersChecked:
      configuredMarkers.length,
    sampleMatches,
    secretPatternMatches,
  };
}

async function main() {
  const [
    packageJson,
    packageLockBytes,
    m0Summary,
    sourceHashes,
    scan,
    npmVersionResult,
  ] = await Promise.all([
    readFile(resolve(projectRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(projectRoot, "package-lock.json")),
    readFile(
      resolve(projectRoot, "data/probes/m0-local/summary.json"),
      "utf8",
    ).then(JSON.parse),
    hashFiles(baselineFiles),
    scanProductionSources(),
    execFileAsync("npm", ["--version"], {
      cwd: projectRoot,
    }),
  ]);

  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
  });
  let chromiumVersion;
  try {
    chromiumVersion = browser.version();
  } finally {
    await browser.close();
  }

  const developmentInputHashes = [
    m0Summary.figma?.liveEvidence?.fileKeySha256,
    process.env.FIGMA_FLOW_FILE_KEY
      ? sha256(process.env.FIGMA_FLOW_FILE_KEY.trim())
      : undefined,
  ].filter((value, index, values) =>
    value && values.indexOf(value) === index,
  );
  const blockers = [
    "flow_full_agent_loop_not_recorded",
    "visual_thresholds_not_frozen",
    "fixed_viewports_not_frozen",
    "three_unknown_inputs_not_provided",
    "external_blind_runs_not_authorized",
  ];
  if (m0Summary.status !== "local_pass_m0_live_confirmed") {
    blockers.unshift("m0_regression_not_passed");
  }
  if (scan.sampleMatches.length > 0) {
    blockers.unshift("sample_specific_production_code_detected");
  }
  if (scan.secretPatternMatches.length > 0) {
    blockers.unshift("secret_pattern_in_production_source");
  }

  const result = {
    schemaVersion: "1",
    status:
      scan.sampleMatches.length === 0 &&
      scan.secretPatternMatches.length === 0 &&
      m0Summary.status === "local_pass_m0_live_confirmed"
        ? "pending_flow_calibration"
        : "failed",
    generatedAt: new Date().toISOString(),
    networkAccess: false,
    runtime: {
      node: process.version,
      npm: npmVersionResult.stdout.trim(),
      packageLockSha256: sha256(packageLockBytes),
      piVersion:
        packageJson.dependencies["@earendil-works/pi-coding-agent"],
      requiredModel: "gpt-5.4",
      chromiumVersion,
      chromiumRevision: "1228",
      chromiumBinaryPath: browserRelativePath,
      chromiumBinarySha256: sha256(await readFile(browserPath)),
    },
    controlledSurface: {
      exactToolNames: [...EXACT_TOOL_NAMES],
      validationBaseline: VALIDATION_BASELINE,
      promptSourceSha256: sourceHashes["src/extension.ts"],
      toolSchemaSourceSha256:
        sourceHashes["src/tools/contracts.ts"],
      catalogSourceSha256:
        sourceHashes["src/preview/catalog.ts"],
      validatorSourceSha256:
        sourceHashes["src/validation/render-and-compare.ts"],
      fixedViewports: null,
      visualThresholds: null,
      maxAgentIterations: 3,
      noProgressDetection: true,
      variablesContractFixture: {
        nonLive: true,
        fullVariablesCovered: true,
        boundVariablesFallbackCovered: true,
        testSourceSha256:
          sourceHashes["tests/unit/figma/variables.test.ts"],
        fixtureSourceSha256:
          sourceHashes[
            "tests/fixtures/figma/variables-response.ts"
          ],
      },
    },
    sourceHashes,
    sourceScan: scan,
    developmentInputHashes,
    blockers,
    freezeReady: false,
  };

  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    resolve(outputRoot, "preflight.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
