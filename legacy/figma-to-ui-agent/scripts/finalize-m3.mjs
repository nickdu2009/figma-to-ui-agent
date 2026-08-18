import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  loadAndVerifyFreeze,
  readJson,
  sha256,
  verifyFrozenRuntime,
} from "./m3-freeze-lib.mjs";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function caseIds() {
  const values = (process.env.M3_CASE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    values.length !== 3 ||
    new Set(values).size !== 3 ||
    values.some(
      (value) => !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value),
    )
  ) {
    throw new Error("m3_finalization_requires_three_cases");
  }
  return values;
}

async function loadCase(caseId, baselineId) {
  const root = resolve(
    projectRoot,
    `data/blind/m3/${caseId}`,
  );
  const manifestPath = resolve(root, "source-manifest.json");
  const resultPath = resolve(root, "result.json");
  const [manifestBytes, manifest, result] = await Promise.all([
    readFile(manifestPath),
    readJson(manifestPath),
    readJson(resultPath),
  ]);
  if (
    manifest.schemaVersion !== "1" ||
    manifest.caseId !== caseId ||
    manifest.baselineId !== baselineId ||
    manifest.unknownInputAttested !== true ||
    result.schemaVersion !== "1" ||
    result.caseId !== caseId ||
    result.baselineId !== baselineId ||
    result.sourceManifestSha256 !== sha256(manifestBytes) ||
    result.passed !== true ||
    result.agentExitCode !== 0 ||
    result.iterationCount < 1 ||
    result.iterationCount > 3 ||
    !result.variablesCapability ||
    !result.featureEvidence
  ) {
    throw new Error(`m3_case_evidence_invalid:${caseId}`);
  }
  return { manifest, result };
}

export function evaluateM3Coverage(cases, freeze) {
  const hasStructuralEvidence = cases.every(
    ({ result }) =>
      Number.isInteger(
        result.featureEvidence.interactiveNodeCount,
      ) &&
      Number.isInteger(result.featureEvidence.textNodeCount) &&
      typeof result.featureEvidence
        .fullPageScreenshotFallback === "boolean" &&
      typeof result.featureEvidence.screenshotFallbackKind ===
        "string",
  );
  const noVariables = cases.some(
    ({ result }) =>
      result.variablesCapability.status ===
        "unavailable_optional" &&
      result.featureEvidence.boundVariableRefCount === 0,
  );
  const bindingsWithoutFullVariables = cases.some(
    ({ result }) =>
      result.variablesCapability.status ===
        "unavailable_optional" &&
      result.featureEvidence.boundVariableRefCount > 0,
  );
  const fullVariables = cases.some(
    ({ result }) =>
      result.variablesCapability.status === "available",
  );
  const variablesContractFixture =
    freeze.controlledSurface.variablesContractFixture;
  const nonLiveBoundVariablesFallbackCovered =
    variablesContractFixture?.nonLive === true &&
    variablesContractFixture.boundVariablesFallbackCovered === true;
  const coverage = {
    noVariables,
    bindingsWithoutFullVariables:
      bindingsWithoutFullVariables ||
      nonLiveBoundVariablesFallbackCovered,
    fullVariablesOrExplicitNonLiveContractFixture:
      fullVariables ||
      (variablesContractFixture?.nonLive === true &&
        variablesContractFixture.fullVariablesCovered === true &&
        variablesContractFixture
          .boundVariablesFallbackCovered === true),
    multiplePages: cases.some(
      ({ result }) =>
        result.featureEvidence.pageCount >= 2,
    ),
    frozenViewports:
      freeze.controlledSurface.fixedViewports.length >= 1,
    components: cases.some(
      ({ result }) =>
        result.featureEvidence.componentCount > 0,
    ),
    images: cases.some(
      ({ result }) =>
        result.featureEvidence.imageAssetCount > 0,
    ),
    complexAutoLayout: cases.some(
      ({ result }) =>
        result.featureEvidence.autoLayoutNodeCount > 0,
    ),
    structuralEvidence: hasStructuralEvidence,
    structuredText:
      hasStructuralEvidence &&
      cases.every(
        ({ result }) => result.featureEvidence.textNodeCount > 0,
      ),
    noFullPageScreenshotFallback:
      hasStructuralEvidence &&
      cases.every(
        ({ result }) =>
          result.featureEvidence.fullPageScreenshotFallback === false,
      ),
  };
  return coverage;
}

async function main() {
  const { freeze } = await loadAndVerifyFreeze(projectRoot);
  await verifyFrozenRuntime(projectRoot, freeze);
  const cases = await Promise.all(
    caseIds().map((caseId) =>
      loadCase(caseId, freeze.baselineId),
    ),
  );
  if (
    new Set(
      cases.map(
        ({ manifest }) => manifest.sourceFileKeyHash,
      ),
    ).size !== 3
  ) {
    throw new Error("m3_cases_must_use_distinct_figma_files");
  }

  const coverage = evaluateM3Coverage(cases, freeze);
  const unmetCoverage = Object.entries(coverage)
    .filter(([, covered]) => !covered)
    .map(([name]) => name);
  if (unmetCoverage.length > 0) {
    throw new Error(
      `m3_blind_coverage_incomplete:${unmetCoverage.join(",")}`,
    );
  }

  const summary = {
    schemaVersion: "1",
    status: "productization_ready",
    baselineId: freeze.baselineId,
    caseCount: 3,
    allCasesPassed: true,
    sourceFilesDistinct: true,
    coverage,
    cases: cases.map(({ manifest, result }) => ({
      caseId: result.caseId,
      sourceFileKeyHash: manifest.sourceFileKeyHash,
      iterationCount: result.iterationCount,
      manualInputProvided: result.manualInputProvided,
      variablesCapability: result.variablesCapability,
      featureEvidence: result.featureEvidence,
      residualDiff: result.residualDiff,
      validationRunIdHash: result.validationRunIdHash,
    })),
    completedAt: new Date().toISOString(),
  };
  const outputPath = resolve(
    projectRoot,
    "data/blind/m3/final-summary.json",
  );
  await writeFile(
    outputPath,
    `${JSON.stringify(summary, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
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
