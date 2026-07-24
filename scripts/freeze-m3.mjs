import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validationRecordSchema } from "../src/validation/schema.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import {
  loadAndVerifyPreflight,
  sha256,
} from "./m3-freeze-lib.mjs";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataRoot = resolve(projectRoot, "data");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertDataPath(path) {
  const fromData = relative(dataRoot, path);
  if (
    fromData === ".." ||
    fromData.startsWith(`..${sep}`) ||
    fromData.startsWith(sep)
  ) {
    throw new Error("flow_record_must_be_under_data");
  }
}

async function main() {
  if (
    !process.argv.includes("--confirm") ||
    process.env.M3_FLOW_CALIBRATION_CONFIRMED !== "1" ||
    process.env.M3_VISUAL_THRESHOLD_CONFIRMED !== "1"
  ) {
    throw new Error("m3_freeze_confirmation_missing");
  }
  const flowRecordInput = argument("--flow-record");
  if (!flowRecordInput) {
    throw new Error("m3_flow_record_missing");
  }
  const flowRecordPath = resolve(projectRoot, flowRecordInput);
  assertDataPath(flowRecordPath);
  const [recordBytes, { preflight }] = await Promise.all([
    readFile(flowRecordPath),
    loadAndVerifyPreflight(projectRoot),
  ]);
  const record = validationRecordSchema.parse(
    JSON.parse(recordBytes.toString("utf8")),
  );
  if (!record.output.passed) {
    throw new Error("flow_calibration_not_passed");
  }

  const store = new ProjectStore(dataRoot);
  const [bundle, uiSpec] = await Promise.all([
    store.loadDesignBundle(
      record.projectId,
      record.designBundleRevision,
    ),
    store.loadUISpec(record.projectId, record.uiSpecRevision),
  ]);
  if (uiSpec.pages.length < 1) {
    throw new Error("flow_calibration_requires_page");
  }
  const selectedViewportIds =
    record.input.viewportIds?.length
      ? record.input.viewportIds
      : uiSpec.viewports.map((viewport) => viewport.id);
  const fixedViewports = uiSpec.viewports.filter((viewport) =>
    selectedViewportIds.includes(viewport.id),
  );
  if (fixedViewports.length < 1) {
    throw new Error("flow_calibration_requires_viewport");
  }
  if (
    record.runtime.policyVersion !==
      preflight.controlledSurface.validationBaseline.policyVersion ||
    record.runtime.chromiumVersion !==
      preflight.runtime.chromiumVersion
  ) {
    throw new Error("flow_calibration_runtime_drift");
  }

  const controlledSurface = {
    ...preflight.controlledSurface,
    fixedViewports,
    visualThresholds: record.input.comparison,
  };
  const freeze = {
    schemaVersion: "1",
    status: "frozen",
    frozenAt: new Date().toISOString(),
    baselineId: sha256(
      JSON.stringify({
        runtime: preflight.runtime,
        controlledSurface,
        sourceHashes: preflight.sourceHashes,
      }),
    ),
    runtime: preflight.runtime,
    controlledSurface,
    sourceHashes: preflight.sourceHashes,
    developmentInputHashes: [
      ...new Set([
        ...preflight.developmentInputHashes,
        bundle.source.fileKeyHash,
      ]),
    ],
    flowEvidence: {
      projectIdHash: sha256(record.projectId),
      sourceFileKeyHash: bundle.source.fileKeyHash,
      validationRecordSha256: sha256(recordBytes),
      runIdHash: sha256(record.runId),
      passed: true,
    },
  };
  const outputPath = resolve(
    dataRoot,
    "baselines/m3/freeze.json",
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(freeze, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({
      status: "frozen",
      baselineId: freeze.baselineId,
      fixedViewportCount: fixedViewports.length,
      validationRecordSha256:
        freeze.flowEvidence.validationRecordSha256,
    })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
