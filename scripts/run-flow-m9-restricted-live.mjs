import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFlowM9SampleReport } from "../src/flow-plan/m9-extractor.ts";
import {
  aggregateFlowM9Samples,
  parseFlowM9RestrictedLiveExtractionReport,
  redactionCheckFlowM9Report,
  flowM9SampleReportSchema,
  statusForFlowM9Aggregate,
} from "../src/flow-plan/m9-report.ts";
import {
  readFlowM9CommunitySampleManifest,
  selectFlowM9Samples,
  selectPrimaryFlowM9Samples,
} from "../src/flow-plan/m9-samples.ts";
import {
  buildFlowPlan,
  generateFlowConfirmationQuestions,
} from "../src/flow-plan/service.ts";
import { FigmaImageDownloader } from "../src/figma/assets.ts";
import { FigmaInspector } from "../src/figma/inspector.ts";
import { FigmaRestClient } from "../src/figma/rest-client.ts";
import {
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
} from "../src/figma/url.ts";
import { SCHEMA_VERSION } from "../src/project-store/schemas.ts";
import {
  ProjectStore,
  ProjectStoreError,
} from "../src/project-store/store.ts";
import {
  buildStaticUISpecFromDesignBundle,
} from "../src/static-generation/service.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const parsed = {
    mode: "local",
    allowFigmaNetwork: false,
    sampleProjects: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-figma-network") {
      parsed.allowFigmaNetwork = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) =>
      value.toUpperCase(),
    );
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_argument_value:${arg}`);
    }
    if (key === "sampleProject") {
      parsed.sampleProjects.push(value);
    } else {
      parsed[key] = value;
    }
    index += 1;
  }
  if (parsed.mode !== "local" && parsed.mode !== "restricted-live") {
    throw new Error(`invalid_mode:${parsed.mode}`);
  }
  return parsed;
}

function parseSampleIds(raw) {
  return raw
    ? raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;
}

function projectMap(values) {
  const map = new Map();
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator < 1 || separator === value.length - 1) {
      throw new Error(`invalid_sample_project:${value}`);
    }
    map.set(value.slice(0, separator), value.slice(separator + 1));
  }
  return map;
}

function safeProjectId(prefix, sampleId) {
  return `${prefix}-${sampleId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
}

function relativeArtifact(path) {
  return relative(projectRoot, path) || ".";
}

function sanitizeDiagnostic(value) {
  return String(value)
    .replace(/figd_[A-Za-z0-9_-]+/g, "[REDACTED_FIGMA_TOKEN]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_OPENAI_TOKEN]")
    .replace(
      /https:\/\/www\.figma\.com\/design\/[^\s"')]+/g,
      "[REDACTED_FIGMA_DESIGN_URL]",
    )
    .slice(0, 2_000);
}

async function loadOrGenerateUISpec(store, projectId, bundle) {
  try {
    return await store.loadUISpec(projectId);
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "not_found") {
      throw error;
    }
  }
  const { uiSpecDraft } = buildStaticUISpecFromDesignBundle(bundle, {
    m4ValidationStatus: "not_required",
  });
  return await store.saveUISpec({
    projectId,
    baseRevision: 0,
    draft: uiSpecDraft,
  });
}

async function loadLocalSample(input) {
  const projectId =
    input.sampleProjects.get(input.sample.sampleId) ??
    safeProjectId(input.projectIdPrefix, input.sample.sampleId);
  const bundle = await input.store.loadDesignBundle(projectId);
  const uiSpec = await loadOrGenerateUISpec(input.store, projectId, bundle);
  const flowPlan = generateFlowConfirmationQuestions(
    buildFlowPlan({ bundle, uiSpec }),
  );
  return { projectId, bundle, uiSpec, flowPlan };
}

function assertRestrictedLiveGate(args) {
  if (!args.allowFigmaNetwork) {
    throw new Error("figma_network_gate_missing");
  }
  if (process.env.FLOW_M9_RESTRICTED_LIVE_AUTHORIZED !== "1") {
    throw new Error("flow_m9_restricted_live_authorization_missing");
  }
  const token = process.env.FIGMA_API_KEY?.trim();
  if (!token) {
    throw new Error("figma_api_key_missing");
  }
  return token;
}

async function loadRestrictedLiveSample(input) {
  if (!input.sample.locator) {
    throw new Error(input.sample.skipReason ?? "sample_locator_missing");
  }
  const projectId = safeProjectId(
    input.projectIdPrefix,
    input.sample.sampleId,
  );
  const parsedUrl = parseFigmaDesignUrl(input.sample.locator.designUrl);
  const targetNodes = [
    normalizeFigmaNodeId(input.sample.locator.nodeId ?? parsedUrl.nodeId),
  ];
  const inspector = new FigmaInspector({
    restClient: new FigmaRestClient({ token: input.token }),
    imageDownloader: new FigmaImageDownloader({
      projectStore: input.store,
    }),
    projectStore: input.store,
  });
  const output = await inspector.inspect(
    {
      schemaVersion: SCHEMA_VERSION,
      projectId,
      figmaUrl: input.sample.locator.designUrl,
      targetNodes,
    },
    undefined,
    { variablesMode: "disabled_restricted_live" },
  );
  const bundle = await input.store.loadDesignBundle(
    projectId,
    output.designBundleRevision,
  );
  const uiSpec = await loadOrGenerateUISpec(input.store, projectId, bundle);
  const flowPlan = generateFlowConfirmationQuestions(
    buildFlowPlan({ bundle, uiSpec }),
  );
  return { projectId, bundle, uiSpec, flowPlan };
}

function skippedSampleReport(sample, reason) {
  return flowM9SampleReportSchema.parse({
    sampleId: sample.sampleId,
    category: sample.category,
    expectedViewport: sample.expectedViewport,
    accessStatus: "skipped",
    interactionSource: "unavailable",
    counts: {
      prototypeInteractionCount: 0,
      flowPlanInteractionCount: 0,
      trustedNavigate: 0,
      trustedStateChange: 0,
      submitLikeNeedsConfirmation: 0,
      unsupported: 0,
      missingEvidence: 0,
    },
    classifications: [
      {
        classification: "not_accessible",
        evidence: reason,
      },
    ],
    blockedReasons: [reason],
    artifactRefs: {},
  });
}

async function buildSampleReport(input) {
  if (input.sample.skipReason) {
    return skippedSampleReport(input.sample, input.sample.skipReason);
  }
  try {
    const loaded =
      input.args.mode === "restricted-live"
        ? await loadRestrictedLiveSample({
            sample: input.sample,
            store: input.store,
            token: input.token,
            projectIdPrefix: input.projectIdPrefix,
          })
        : await loadLocalSample({
            sample: input.sample,
            store: input.store,
            sampleProjects: input.sampleProjects,
            projectIdPrefix: input.projectIdPrefix,
          });
    return buildFlowM9SampleReport({
      sample: input.sample,
      bundle: loaded.bundle,
      flowPlan: loaded.flowPlan,
      artifactRefs: {
        designBundlePath: `data/projects/${loaded.projectId}/figma/current.json`,
        uiSpecPath: `data/projects/${loaded.projectId}/specs/current.json`,
        flowPlanPath: "ephemeral-flow-plan",
      },
    });
  } catch (error) {
    return buildFlowM9SampleReport({
      sample: input.sample,
      accessError: sanitizeDiagnostic(
        error instanceof Error ? error.message : String(error),
      ),
    });
  }
}

function reportReasons(report) {
  const reasons = [];
  if (report.aggregate.readableSamples < 3) {
    reasons.push("flow_m9_less_than_three_readable_samples");
  }
  if (
    report.aggregate.trustedNavigate + report.aggregate.trustedStateChange <
    1
  ) {
    reasons.push("flow_m9_no_trusted_flowplan_candidate");
  }
  if (report.aggregate.submitLikeNeedsConfirmation < 1) {
    reasons.push("flow_m9_no_submit_like_needs_confirmation");
  }
  if (report.aggregate.notAccessible > 0) {
    reasons.push("flow_m9_some_samples_not_accessible");
  }
  return reasons;
}

function reportMarkdown(report) {
  const lines = [
    "# Flow-M9 restricted-live interaction extraction 报告",
    "",
    `- runId：${report.input.runId}`,
    `- status：${report.status}`,
    `- mode：${report.input.networkBoundary.mode}`,
    `- figmaRestCalled：${report.input.networkBoundary.figmaRestCalled}`,
    `- sampleCount：${report.aggregate.totalSamples}`,
    `- readableSamples：${report.aggregate.readableSamples}`,
    `- trustedNavigate：${report.aggregate.trustedNavigate}`,
    `- trustedStateChange：${report.aggregate.trustedStateChange}`,
    `- submitLikeNeedsConfirmation：${report.aggregate.submitLikeNeedsConfirmation}`,
    `- unsupported：${report.aggregate.unsupported}`,
    `- missingEvidence：${report.aggregate.missingEvidence}`,
    `- notAccessible：${report.aggregate.notAccessible}`,
    "",
    "## Samples",
    "",
    ...report.samples.map(
      (sample) =>
        `- ${sample.sampleId}：${sample.accessStatus}，trusted=${sample.counts.trustedNavigate + sample.counts.trustedStateChange}，needsConfirmation=${sample.counts.submitLikeNeedsConfirmation}，missing=${sample.counts.missingEvidence}`,
    ),
    "",
    "## Reasons",
    "",
    ...(report.reasons.length > 0
      ? report.reasons.map((reason) => `- ${reason}`)
      : ["- 无"]),
    "",
    "## 残留风险",
    "",
    ...report.residualRisks.map((risk) => `- ${risk}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataRoot = resolve(projectRoot, args.dataRoot ?? "data");
  const manifestPath = resolve(
    projectRoot,
    args.sampleManifest ??
      "tests/fixtures/figma/community-sample-manifest.json",
  );
  const reportRoot = resolve(
    projectRoot,
    args.reportRoot ?? "reports/flow-m9-restricted-live-extraction",
  );
  const runId =
    args.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outputRoot = resolve(reportRoot, runId);
  await mkdir(outputRoot, { recursive: true });

  const manifest = await readFlowM9CommunitySampleManifest(manifestPath);
  const sampleIds = parseSampleIds(args.sampleIds);
  const samples = sampleIds
    ? selectFlowM9Samples(manifest, sampleIds)
    : selectPrimaryFlowM9Samples(manifest, 5);
  if (samples.length < 1) {
    throw new Error("flow_m9_no_samples_selected");
  }

  const token =
    args.mode === "restricted-live"
      ? assertRestrictedLiveGate(args)
      : undefined;
  const store = new ProjectStore(dataRoot);
  const sampleProjects = projectMap(args.sampleProjects);
  const projectIdPrefix = args.projectIdPrefix ?? "flow-m9";
  const sampleReports = [];
  for (const sample of samples) {
    sampleReports.push(
      await buildSampleReport({
        args,
        sample,
        store,
        token,
        sampleProjects,
        projectIdPrefix,
      }),
    );
  }

  const aggregate = aggregateFlowM9Samples(sampleReports);
  const report = parseFlowM9RestrictedLiveExtractionReport({
    schemaVersion: "1",
    milestone: "Flow-M9",
    scope: "restricted_live_interaction_extraction",
    status: statusForFlowM9Aggregate(aggregate),
    input: {
      runId,
      sampleManifestRef: relativeArtifact(manifestPath),
      sampleIds: samples.map((sample) => sample.sampleId),
      networkBoundary: {
        figmaRestCalled: args.mode === "restricted-live",
        openaiCalled: false,
        mode: args.mode,
      },
    },
    samples: sampleReports,
    aggregate,
    reasons: [],
    residualRisks: [
      "Flow-M9 只证明 interaction 抽取与分类；submit-like 业务语义仍需 Flow-M10 用户确认。",
      "restricted-live 样本权限和 Community 文件结构可能随时间变化。",
    ],
  });
  const finalReport = parseFlowM9RestrictedLiveExtractionReport({
    ...report,
    reasons: reportReasons(report),
  });
  redactionCheckFlowM9Report(finalReport);

  await writeFile(
    resolve(outputRoot, "summary.json"),
    `${JSON.stringify(finalReport, null, 2)}\n`,
  );
  await writeFile(
    resolve(outputRoot, "summary.md"),
    reportMarkdown(finalReport),
  );
  process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
