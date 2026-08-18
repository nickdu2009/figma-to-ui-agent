import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFigmaDesignUrl } from "../src/figma/url.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import { frozenRunPolicySchema } from "../src/runtime/frozen-run-policy.ts";
import { validationRecordSchema } from "../src/validation/schema.ts";
import {
  buildPiArgs,
  configuredModel,
  prepareRuntimeEnvironment,
} from "./start-agent.mjs";
import {
  loadAndVerifyPreflight,
  sha256,
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

async function assertEmptyProject(projectId) {
  const projectPath = resolve(
    projectRoot,
    `data/projects/${projectId}`,
  );
  try {
    await readdir(projectPath);
    throw new Error("m3_flow_project_must_start_empty");
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
}

async function validationRecords(projectId) {
  const runsRoot = resolve(
    projectRoot,
    `data/projects/${projectId}/runs`,
  );
  const runNames = await readdir(runsRoot).catch(() => []);
  const records = [];
  for (const runName of runNames) {
    try {
      records.push(
        validationRecordSchema.parse(
          JSON.parse(
            await readFile(
              resolve(runsRoot, runName, "validation.json"),
              "utf8",
            ),
          ),
        ),
      );
    } catch {
      // 不完整 run 保留在项目目录，但不作为有效校准迭代。
    }
  }
  return records.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

async function main() {
  const { preflight } =
    await loadAndVerifyPreflight(projectRoot);
  if (process.env.M3_FLOW_EXTERNAL_AUTHORIZED !== "1") {
    throw new Error("m3_flow_external_execution_not_authorized");
  }
  if (
    !process.env.FIGMA_API_KEY ||
    !process.env.OPENAI_API_KEY
  ) {
    throw new Error("m3_required_credentials_missing");
  }
  const model = configuredModel();
  const projectId = process.env.M3_FLOW_PROJECT_ID?.trim();
  const figmaUrl = process.env.M3_FLOW_FIGMA_URL?.trim();
  if (
    !projectId ||
    !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(projectId) ||
    !figmaUrl
  ) {
    throw new Error("m3_flow_input_missing");
  }
  if (process.env.M3_FLOW_INPUT_CONFIRMED !== "1") {
    throw new Error("m3_flow_input_confirmation_missing");
  }
  const parsedFigmaUrl = parseFigmaDesignUrl(figmaUrl);
  if (
    !preflight.developmentInputHashes.includes(
      sha256(parsedFigmaUrl.fileKey),
    )
  ) {
    throw new Error("m3_flow_input_not_registered_for_development");
  }
  let candidateViewports;
  let candidateComparison;
  try {
    candidateViewports = JSON.parse(
      process.env.M3_FLOW_VIEWPORTS_JSON ?? "",
    );
    candidateComparison = JSON.parse(
      process.env.M3_FLOW_COMPARISON_JSON ?? "",
    );
  } catch {
    throw new Error("m3_flow_candidate_config_invalid");
  }
  const candidatePolicy = frozenRunPolicySchema.parse({
    schemaVersion: "1",
    baselineId: sha256(
      JSON.stringify({
        viewports: candidateViewports,
        comparison: candidateComparison,
      }),
    ),
    viewports: candidateViewports,
    comparison: candidateComparison,
  });
  await assertEmptyProject(projectId);

  const behaviorNotes =
    process.env.M3_FLOW_BEHAVIOR_NOTES?.trim() ||
    "无额外行为说明";
  const prompt = [
    "执行 Flow 校准的完整 Figma-to-UI Agent 循环。",
    `projectId: ${projectId}`,
    `Figma URL: ${figmaUrl}`,
    `行为说明: ${behaviorNotes}`,
    `校准视口: ${JSON.stringify(candidatePolicy.viewports)}`,
    `校准比较参数: ${JSON.stringify(
      candidatePolicy.comparison,
    )}`,
    `render_and_compare 的 viewportIds 必须严格使用: ${JSON.stringify(
      candidatePolicy.viewports.map((viewport) => viewport.id),
    )}`,
    "必须从空项目开始，依次 inspect_figma、load_ui_spec（不存在时按 revision 0 新建）、save_ui_spec、render_and_compare。",
    "只能做通用 Prompt/Catalog/解析/验证可表达的转换，不得引入样本常量。一次通过立即停止；最多三轮；无进展时停止并报告证据。",
  ].join("\n");
  const args = buildM3PiProcessArgs(buildPiArgs(model));
  const runEnvironment = await prepareRuntimeEnvironment({
    ...process.env,
    M3_FROZEN_POLICY_JSON: JSON.stringify(candidatePolicy),
    M3_AGENT_AUDIT_RELATIVE_PATH:
      `data/calibration/m3/${projectId}/tool-events.redacted.jsonl`,
  });
  const run = await runPiProcess({
    projectRoot,
    args,
    env: runEnvironment,
    prompt,
  });
  const records = await validationRecords(projectId);
  const latest = records.at(-1);
  const caseRoot = resolve(
    projectRoot,
    `data/calibration/m3/${projectId}`,
  );
  await mkdir(caseRoot, { recursive: true });
  await writeFile(
    resolve(caseRoot, "pi-output.redacted.log"),
    redactAgentOutput(`${run.stdout}\n${run.stderr}`, [
      figmaUrl,
      parsedFigmaUrl.fileKey,
      process.env.FIGMA_API_KEY,
      process.env.OPENAI_API_KEY,
    ]),
    { encoding: "utf8", mode: 0o600 },
  );

  const store = new ProjectStore(resolve(projectRoot, "data"));
  const bundle = latest
    ? await store
        .loadDesignBundle(
          projectId,
          latest.designBundleRevision,
        )
        .catch(() => undefined)
    : undefined;
  const expectedTargetNodes = [
    ...new Set(
      parsedFigmaUrl.nodeId ? [parsedFigmaUrl.nodeId] : [],
    ),
  ];
  const sourceMatched =
    bundle?.source.fileKeyHash ===
      sha256(parsedFigmaUrl.fileKey) &&
    JSON.stringify(
      [...(bundle?.source.targetNodeIds ?? [])].sort(),
    ) === JSON.stringify([...expectedTargetNodes].sort());
  const result = {
    schemaVersion: "1",
    status:
      run.code === 0 &&
      records.length >= 1 &&
      records.length <= 3 &&
      records.every(
        (record) => record.projectId === projectId,
      ) &&
      latest?.output.passed === true &&
      sourceMatched
        ? "passed"
        : "failed",
    projectId,
    agentExitCode: run.code,
    agentSignal: run.signal,
    terminationReason: run.terminationReason,
    iterationCount: records.length,
    sourceMatched,
    firstPassPassed: records[0]?.output.passed === true,
    finalPassed: latest?.output.passed === true,
    finalValidationRecord: latest
      ? `data/projects/${projectId}/runs/${latest.runId}/validation.json`
      : undefined,
    variablesCapability: bundle?.capabilities.variables,
    manualInputProvided: Boolean(
      process.env.M3_FLOW_BEHAVIOR_NOTES?.trim(),
    ),
    candidatePolicyHash: sha256(
      JSON.stringify(candidatePolicy),
    ),
    completedAt: new Date().toISOString(),
  };
  await writeFile(
    resolve(caseRoot, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
