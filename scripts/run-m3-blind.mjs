import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validationRecordSchema } from "../src/validation/schema.ts";
import {
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
} from "../src/figma/url.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import {
  buildPiArgs,
  configuredModel,
  prepareRuntimeEnvironment,
} from "./start-agent.mjs";
import {
  loadAndVerifyFreeze,
  readJson,
  sha256,
  verifyFrozenRuntime,
} from "./m3-freeze-lib.mjs";
import {
  buildM3PiProcessArgs,
  redactAgentOutput,
  runPiProcess,
} from "./m3-agent-process.mjs";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function isFigmaScreenshotPath(value) {
  return (
    typeof value === "string" &&
    value.startsWith("figma/screenshots/")
  );
}

function childIdsForNode(node) {
  return Array.isArray(node?.childIds) ? node.childIds : [];
}

function reachableNodes(uiSpec, rootNodeId) {
  const nodeById = new Map(
    uiSpec.nodes.map((node) => [node.id, node]),
  );
  const seen = new Set();
  const stack = [rootNodeId];
  const nodes = [];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    nodes.push(node);
    for (const childId of [...childIdsForNode(node)].reverse()) {
      stack.push(childId);
    }
  }
  return nodes;
}

function isFullPageScreenshotFallback(uiSpec, page) {
  const nodes = reachableNodes(uiSpec, page.rootNodeId);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const root = nodeById.get(page.rootNodeId);
  const structuredNodeCount = nodes.filter((node) =>
    ["button", "checkbox", "input", "text"].includes(node.kind),
  ).length;
  if (structuredNodeCount > 0 || !root) {
    return false;
  }
  if (
    root.kind === "image" &&
    isFigmaScreenshotPath(root.assetRef)
  ) {
    return true;
  }
  const directChildren = childIdsForNode(root)
    .map((childId) => nodeById.get(childId))
    .filter(Boolean);
  return (
    directChildren.length === 1 &&
    directChildren[0].kind === "image" &&
    isFigmaScreenshotPath(directChildren[0].assetRef)
  );
}

export function collectUISpecStructuralEvidence(uiSpec) {
  const screenshotFallbackNodeCount = uiSpec.nodes.filter(
    (node) =>
      (node.kind === "image" || node.kind === "pixel_overlay") &&
      isFigmaScreenshotPath(node.assetRef),
  ).length;
  const fullPageScreenshotFallback = uiSpec.pages.some((page) =>
    isFullPageScreenshotFallback(uiSpec, page),
  );
  return {
    fullPageScreenshotFallback,
    interactiveNodeCount: uiSpec.nodes.filter((node) =>
      ["button", "checkbox", "input"].includes(node.kind),
    ).length,
    textNodeCount: uiSpec.nodes.filter(
      (node) => node.kind === "text",
    ).length,
    screenshotFallbackKind: fullPageScreenshotFallback
      ? "rejected"
      : screenshotFallbackNodeCount > 0
        ? "allowed-local"
        : "none",
    screenshotFallbackNodeCount,
  };
}

async function main() {
  const { freeze } = await loadAndVerifyFreeze(projectRoot);
  await verifyFrozenRuntime(projectRoot, freeze);
  if (process.env.M3_EXTERNAL_AUTHORIZED !== "1") {
    throw new Error("m3_external_execution_not_authorized");
  }
  const model = configuredModel();
  if (model !== freeze.runtime.requiredModel) {
    throw new Error("m3_model_drift");
  }
  if (
    !process.env.FIGMA_API_KEY ||
    !process.env.OPENAI_API_KEY
  ) {
    throw new Error("m3_required_credentials_missing");
  }
  const caseId = process.env.M3_CASE_ID?.trim();
  const figmaUrl = process.env.M3_FIGMA_URL?.trim();
  if (
    !caseId ||
    !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(caseId) ||
    !figmaUrl
  ) {
    throw new Error("m3_case_input_missing");
  }
  const parsedFigmaUrl = parseFigmaDesignUrl(figmaUrl);
  const sourceManifestPath = resolve(
    projectRoot,
    `data/blind/m3/${caseId}/source-manifest.json`,
  );
  const sourceManifest = await readJson(sourceManifestPath);
  const targetNodes = [
    ...new Set([
      ...(parsedFigmaUrl.nodeId
        ? [parsedFigmaUrl.nodeId]
        : []),
      ...(process.env.M3_TARGET_NODES ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normalizeFigmaNodeId),
    ]),
  ];
  const expectedTargetNodeHashes = targetNodes.map(sha256);
  const providedBehaviorNotes =
    process.env.M3_BEHAVIOR_NOTES?.trim();
  if (
    sourceManifest.schemaVersion !== "1" ||
    sourceManifest.caseId !== caseId ||
    sourceManifest.baselineId !== freeze.baselineId ||
    sourceManifest.sourceUrlHash !== sha256(figmaUrl) ||
    sourceManifest.sourceFileKeyHash !==
      sha256(parsedFigmaUrl.fileKey) ||
    sourceManifest.unknownInputAttested !== true ||
    sourceManifest.targetNodeCount !== targetNodes.length ||
    JSON.stringify(sourceManifest.targetNodeHashes) !==
      JSON.stringify(expectedTargetNodeHashes) ||
    sourceManifest.behaviorNotesHash !==
      (providedBehaviorNotes
        ? sha256(providedBehaviorNotes)
        : undefined) ||
    freeze.developmentInputHashes.includes(
      sourceManifest.sourceFileKeyHash,
    )
  ) {
    throw new Error("m3_source_manifest_mismatch");
  }
  const projectId = `blind-${caseId}`;
  const projectPath = resolve(
    projectRoot,
    `data/projects/${projectId}`,
  );
  try {
    await readdir(projectPath);
    throw new Error("m3_blind_project_must_start_empty");
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }

  const behaviorNotes =
    providedBehaviorNotes || "无额外行为说明";
  const prompt = [
    "执行一次冻结配置的 Figma-to-UI 盲测。",
    `projectId: ${projectId}`,
    `Figma URL: ${figmaUrl}`,
    `目标节点: ${JSON.stringify(targetNodes)}`,
    `行为说明: ${behaviorNotes}`,
    `冻结视口: ${JSON.stringify(
      freeze.controlledSurface.fixedViewports,
    )}`,
    `冻结比较参数: ${JSON.stringify(
      freeze.controlledSurface.visualThresholds,
    )}`,
    "必须从空项目开始，依次 inspect_figma、load_ui_spec（不存在时按 revision 0 新建）、save_ui_spec、render_and_compare。",
    `render_and_compare 的 viewportIds 必须严格使用: ${JSON.stringify(
      freeze.controlledSurface.fixedViewports.map(
        (viewport) => viewport.id,
      ),
    )}`,
    "UISpec 只能使用上述冻结视口，比较参数必须完全相同。Extension 会拒绝任何漂移。一次通过立即停止；最多三轮；无进展时停止并报告结构化原因。",
  ].join("\n");
  const args = buildM3PiProcessArgs(buildPiArgs(model));
  const runEnvironment = await prepareRuntimeEnvironment({
    ...process.env,
    M3_FROZEN_POLICY_JSON: JSON.stringify({
      schemaVersion: "1",
      baselineId: freeze.baselineId,
      viewports: freeze.controlledSurface.fixedViewports,
      comparison: freeze.controlledSurface.visualThresholds,
    }),
    M3_AGENT_AUDIT_RELATIVE_PATH:
      `data/blind/m3/${caseId}/tool-events.redacted.jsonl`,
  });
  const run = await runPiProcess({
    projectRoot,
    args,
    env: runEnvironment,
    prompt,
  });
  const redactedOutput = redactAgentOutput(
    `${run.stdout}\n${run.stderr}`,
    [
      figmaUrl,
      parsedFigmaUrl.fileKey,
      process.env.FIGMA_API_KEY,
      process.env.OPENAI_API_KEY,
    ],
  );
  const caseRoot = dirname(sourceManifestPath);
  await writeFile(
    resolve(caseRoot, "pi-output.redacted.log"),
    redactedOutput,
    { encoding: "utf8", mode: 0o600 },
  );

  const runsRoot = resolve(projectPath, "runs");
  const runNames =
    run.code === 0
      ? await readdir(runsRoot).catch(() => [])
      : [];
  const records = [];
  for (const runName of runNames) {
    const recordPath = resolve(
      runsRoot,
      runName,
      "validation.json",
    );
    try {
      records.push(
        validationRecordSchema.parse(
          JSON.parse(await readFile(recordPath, "utf8")),
        ),
      );
    } catch {
      // 不完整 run 保留为失败证据，但不计入有效迭代。
    }
  }
  records.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const latest = records.at(-1);
  const store = new ProjectStore(resolve(projectRoot, "data"));
  const bundle = latest
    ? await store
        .loadDesignBundle(
          projectId,
          latest.designBundleRevision,
        )
        .catch(() => undefined)
    : undefined;
  const uiSpec = latest
    ? await store
        .loadUISpec(projectId, latest.uiSpecRevision)
        .catch(() => undefined)
    : undefined;
  const structuralEvidence = uiSpec
    ? collectUISpecStructuralEvidence(uiSpec)
    : undefined;
  const nodes =
    bundle?.pages.flatMap((page) => page.nodes) ?? [];
  const diffResults =
    latest?.output.results.map((item) => ({
      diffPixelCount: item.diffPixelCount,
      diffPixelRatio: item.diffPixelRatio,
    })) ?? [];
  const sourceMatched =
    bundle?.source.fileKeyHash ===
      sourceManifest.sourceFileKeyHash &&
    JSON.stringify(
      [...(bundle?.source.targetNodeIds ?? [])].sort(),
    ) === JSON.stringify([...targetNodes].sort());
  const result = {
    schemaVersion: "1",
    caseId,
    baselineId: freeze.baselineId,
    sourceManifestSha256: sha256(
      await readFile(sourceManifestPath),
    ),
    agentExitCode: run.code,
    agentSignal: run.signal,
    terminationReason: run.terminationReason,
    iterationCount: records.length,
    sourceMatched,
    passed:
      run.code === 0 &&
      records.length >= 1 &&
      records.length <= 3 &&
      records.every(
        (record) => record.projectId === projectId,
      ) &&
      latest?.output.passed === true &&
      uiSpec !== undefined &&
      structuralEvidence?.fullPageScreenshotFallback === false &&
      sourceMatched,
    designBundleRevision: latest?.designBundleRevision,
    uiSpecRevision: latest?.uiSpecRevision,
    variablesCapability: bundle?.capabilities.variables,
    featureEvidence: bundle && structuralEvidence
      ? {
          pageCount: bundle.pages.length,
          componentCount: bundle.components.length,
          imageAssetCount: bundle.assets.length,
          ...structuralEvidence,
          autoLayoutNodeCount: nodes.filter(
            (node) =>
              node.layout &&
              node.layout.direction !== "none",
          ).length,
          boundVariableRefCount: nodes.reduce(
            (count, node) =>
              count + node.boundVariableRefs.length,
            0,
          ),
          unsupportedNodeCount: nodes.filter(
            (node) => node.kind === "unsupported",
          ).length,
          warningCodes: [
            ...new Set([
              ...bundle.warnings.map(
                (warning) => warning.code,
              ),
              ...nodes.flatMap(
                (node) => node.warningCodes,
              ),
            ]),
          ].sort(),
        }
      : undefined,
    residualDiff: {
      maxDiffPixelCount: diffResults.reduce(
        (maximum, item) =>
          Math.max(maximum, item.diffPixelCount),
        0,
      ),
      maxDiffPixelRatio: diffResults.reduce(
        (maximum, item) =>
          Math.max(maximum, item.diffPixelRatio),
        0,
      ),
    },
    checks:
      latest?.output.results.flatMap((item) => item.checks) ?? [],
    validationRunIdHash: latest
      ? sha256(latest.runId)
      : undefined,
    manualInputProvided: Boolean(
      process.env.M3_BEHAVIOR_NOTES?.trim(),
    ),
    completedAt: new Date().toISOString(),
  };
  await mkdir(caseRoot, { recursive: true });
  await writeFile(
    resolve(caseRoot, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
