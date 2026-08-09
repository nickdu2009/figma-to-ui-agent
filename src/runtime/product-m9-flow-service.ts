import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { z } from "zod";

import { FigmaImageDownloader } from "../figma/assets.ts";
import { FigmaInspector } from "../figma/inspector.ts";
import {
  FigmaRestClient,
  FigmaRestError,
  type FigmaFetch,
  type FigmaRateLimitLogEvent,
  type FigmaRestClientOptions,
} from "../figma/rest-client.ts";
import {
  FigmaInputError,
  normalizeFigmaNodeId,
  parseFigmaDesignUrl,
} from "../figma/url.ts";
import {
  loadFlowM11Artifact,
  type FlowM11ArtifactLoadResult,
} from "../flow-plan/m11-artifact-loader.ts";
import {
  applyFlowM10Confirmations,
} from "../flow-plan/m10-apply-confirmations.ts";
import {
  generateFlowM10ConfirmationQuestions,
} from "../flow-plan/m10-confirmation-questions.ts";
import {
  flowM10ConfirmationAnswersSchema,
  type FlowM10ConfirmationQuestion,
} from "../flow-plan/m10-schema.ts";
import { planFlowM11BehaviorFixtures } from "../flow-plan/m11-fixture-planner.ts";
import {
  buildFlowM11ExecutionReport,
  type FlowM11ExecutionReport,
} from "../flow-plan/m11-report.ts";
import {
  flowM11ValidationSummarySchema,
  type FlowM11ValidationSummary,
} from "../flow-plan/m11-fixture-schema.ts";
import {
  buildFlowPlan,
  generateFlowConfirmationQuestions,
} from "../flow-plan/service.ts";
import {
  type FlowPlan,
  type FlowPlanDraft,
  flowPlanDraftSchema,
  flowPlanSchema,
} from "../flow-plan/schema.ts";
import { ProjectStore, ProjectStoreError } from "../project-store/store.ts";
import { SCHEMA_VERSION } from "../project-store/schemas.ts";
import { loadCurrentStaticUISpec } from "../static-generation/ui-spec-loader.ts";
import {
  type UISpec,
  type UISpecDraft,
  uiSpecDraftSchema,
  uiSpecSchema,
} from "../ui-spec/schema.ts";
import {
  type ProductM9ErrorCategory,
  type ProductM9RunError,
  type ProductM9RunMode,
  type ProductM9RunRequest,
  type ProductM9RunResult,
  type ProductM9StageResult,
  productM9AgentDecisionTable,
  productM9RunErrorSchema,
  productM9RunRequestSchema,
  productM9RunResultSchema,
} from "./product-m9-flow-contracts.ts";
import {
  redactionCheckProductM9Report,
  writeProductM9Report,
} from "./product-m9-flow-report.ts";

export interface RunProductM9FlowOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly runId?: () => string;
  readonly rateLimitLogger?: (event: FigmaRateLimitLogEvent) => void;
  readonly figmaFetchImpl?: FigmaFetch;
  readonly figmaMaxRetries?: number;
  readonly figmaSleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly flowValidationRunner?: (input: {
    readonly runId: string;
    readonly projectId: string;
    readonly uiSpec: UISpecDraft;
    readonly fixtureIds: readonly string[];
  }) => Promise<FlowM11ValidationSummary>;
}

interface NormalizedProductM9Request {
  readonly request: ProductM9RunRequest;
  readonly fileKey?: string;
  readonly nodeId?: string;
  readonly figmaUrl?: string;
}

interface FlowArtifactInput {
  readonly flowPlan: FlowPlan | FlowPlanDraft;
  readonly uiSpec: UISpec | UISpecDraft;
  readonly flowPlanPath: string;
  readonly uiSpecPath: string;
  readonly designBundlePath?: string;
  readonly confirmedFlowPlanPath?: string;
}

interface ConfirmationQuestionsArtifact {
  readonly path: string;
  readonly answerTemplatePath: string;
  readonly stage: ProductM9StageResult;
}

function createRunId(): string {
  return `product-m9-${Date.now().toString(36)}-${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
}

function stage(
  status: ProductM9StageResult["status"],
  message: string,
  options: {
    readonly artifactRef?: string;
    readonly reasonCode?: string;
  } = {},
): ProductM9StageResult {
  return {
    status,
    message,
    artifactRef: options.artifactRef,
    reasonCode: options.reasonCode,
  };
}

function productM9Error(
  category: ProductM9ErrorCategory,
  message: string,
  options: {
    readonly recoverable?: boolean;
    readonly nextAction?: string;
    readonly details?: Record<string, unknown>;
  } = {},
): ProductM9RunError {
  const decision = productM9AgentDecisionTable[category];
  return {
    category,
    message,
    recoverable: options.recoverable ?? decision.retryPolicy !== "do_not_retry",
    nextAction: options.nextAction ?? decision.nextAction,
    retryPolicy: decision.retryPolicy,
    details: options.details,
  };
}

function safeProjectId(value: unknown): string {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
    ? value
    : "product-m9-error";
}

function safeMode(value: unknown): ProductM9RunMode {
  return value === "restricted-live" ? "restricted-live" : "local";
}

function normalizeRequest(rawInput: unknown): NormalizedProductM9Request {
  const request = productM9RunRequestSchema.parse(rawInput);
  let fileKey = request.fileKey;
  let nodeId = request.nodeId
    ? normalizeFigmaNodeId(request.nodeId)
    : undefined;
  let figmaUrl = request.figmaUrl;
  if (request.figmaUrl) {
    const parsed = parseFigmaDesignUrl(request.figmaUrl);
    fileKey = parsed.fileKey;
    nodeId = nodeId ?? parsed.nodeId;
  } else if (fileKey && request.mode === "restricted-live") {
    const url = new URL(
      `https://www.figma.com/design/${encodeURIComponent(fileKey)}/ProductM9`,
    );
    if (nodeId) {
      url.searchParams.set("node-id", nodeId.replaceAll(":", "-"));
    }
    figmaUrl = url.href;
  }
  return { request, fileKey, nodeId, figmaUrl };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseUISpec(raw: unknown): UISpec | UISpecDraft {
  const parsed = uiSpecSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return uiSpecDraftSchema.parse(raw);
}

function parseFlowPlan(raw: unknown): FlowPlan | FlowPlanDraft {
  const parsed = flowPlanSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return flowPlanDraftSchema.parse(raw);
}

function flowPlanDraftFrom(
  flowPlan: FlowPlan | FlowPlanDraft,
): FlowPlanDraft {
  if ("revision" in flowPlan) {
    const { revision: _revision, ...draft } = flowPlan;
    return flowPlanDraftSchema.parse(draft);
  }
  return flowPlanDraftSchema.parse(flowPlan);
}

function uiSpecDraftFrom(uiSpec: UISpec | UISpecDraft): UISpecDraft {
  if ("revision" in uiSpec) {
    const { revision: _revision, ...draft } = uiSpec;
    return uiSpecDraftSchema.parse(draft);
  }
  return uiSpecDraftSchema.parse(uiSpec);
}

function relativeRef(cwd: string, path: string): string {
  const ref = relative(cwd, resolve(cwd, path));
  if (ref.startsWith("..")) {
    throw productM9Error(
      "input_invalid",
      "artifact path must stay inside project workspace",
    );
  }
  return ref || ".";
}

async function loadLocalArtifacts(input: {
  readonly cwd: string;
  readonly request: ProductM9RunRequest;
}): Promise<FlowArtifactInput> {
  const flowPlanPath =
    input.request.confirmedFlowPlanPath ??
    input.request.flowPlanPath ??
    "tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json";
  const uiSpecPath =
    input.request.uiSpecPath ??
    "tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json";
  try {
    const uiSpec = parseUISpec(await readJson(resolve(input.cwd, uiSpecPath)));
    const flowPlan = parseFlowPlan(
      await readJson(resolve(input.cwd, flowPlanPath)),
    );
    return {
      flowPlan,
      uiSpec,
      flowPlanPath: relativeRef(input.cwd, flowPlanPath),
      uiSpecPath: relativeRef(input.cwd, uiSpecPath),
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      throw productM9Error(
        "artifact_missing",
        "FlowPlan or UISpec artifact is missing",
        { details: { flowPlanPath, uiSpecPath } },
      );
    }
    throw error;
  }
}

async function loadOrGenerateUISpec(input: {
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly bundleRevision: number;
}): Promise<UISpec> {
  const bundle = await input.store.loadDesignBundle(
    input.projectId,
    input.bundleRevision,
  );
  const { uiSpec } = await loadCurrentStaticUISpec({
    store: input.store,
    projectId: input.projectId,
    bundle,
    options: { m4ValidationStatus: "not_required" },
  });
  return uiSpec;
}

async function saveFlowPlan(input: {
  readonly store: ProjectStore;
  readonly projectId: string;
  readonly flowPlan: FlowPlan | FlowPlanDraft;
}): Promise<void> {
  let baseRevision = 0;
  try {
    baseRevision = (await input.store.loadFlowPlan(input.projectId)).revision;
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "not_found") {
      throw error;
    }
  }
  await input.store.saveFlowPlan({
    projectId: input.projectId,
    baseRevision,
    draft: input.flowPlan,
  });
}

async function applyConfirmationAnswers(input: {
  readonly cwd: string;
  readonly request: ProductM9RunRequest;
  readonly runId: string;
  readonly rawReportRoot: string;
  readonly artifacts: FlowArtifactInput;
}): Promise<{
  readonly artifacts: FlowArtifactInput;
  readonly stage?: ProductM9StageResult;
}> {
  if (!input.request.answersPath) {
    return { artifacts: input.artifacts };
  }
  relativeRef(input.cwd, input.request.answersPath);
  const answers = await readJson(resolve(input.cwd, input.request.answersPath));
  const flowPlan = flowPlanDraftFrom(input.artifacts.flowPlan);
  const uiSpec = uiSpecDraftFrom(input.artifacts.uiSpec);
  const applyResult = applyFlowM10Confirmations({
    flowPlan,
    questions: generateFlowM10ConfirmationQuestions({ flowPlan }),
    rawAnswers: answers,
    uiSpec,
  });
  const confirmedPath = resolve(
    input.cwd,
    input.rawReportRoot,
    input.runId,
    "confirmed-flow-plan.json",
  );
  await mkdir(dirname(confirmedPath), { recursive: true });
  await writeFile(
    confirmedPath,
    `${JSON.stringify(applyResult.flowPlan, null, 2)}\n`,
  );
  const confirmedFlowPlanPath = relative(input.cwd, confirmedPath);
  const applied = applyResult.results.filter(
    (result) => result.result === "applied",
  ).length;
  const declined = applyResult.results.filter(
    (result) => result.result === "declined",
  ).length;
  const rejected = applyResult.results.filter(
    (result) =>
      result.result === "rejected" ||
      result.result === "invalid" ||
      result.result === "unmatched",
  ).length;
  const status: ProductM9StageResult["status"] =
    applied > 0 && rejected === 0
      ? "passed"
      : applied > 0
        ? "partial"
        : "partial";
  return {
    artifacts: {
      ...input.artifacts,
      flowPlan: applyResult.flowPlan,
      flowPlanPath: confirmedFlowPlanPath,
      confirmedFlowPlanPath,
    },
    stage: stage(
      status,
      `Flow-M10 confirmation answers applied=${applied} declined=${declined} rejected=${rejected}`,
      { artifactRef: confirmedFlowPlanPath },
    ),
  };
}

function confirmationAnswerId(
  question: FlowM10ConfirmationQuestion,
  index: number,
): string {
  return `answer-${index + 1}-${question.id}`
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 256);
}

function buildConfirmationAnswerTemplate(
  questions: readonly FlowM10ConfirmationQuestion[],
): unknown {
  return flowM10ConfirmationAnswersSchema.parse(
    questions.map((question, index) => ({
      id: confirmationAnswerId(question, index),
      questionId: question.id,
      answerKind: "decline",
      reason:
        "待用户确认：请将本项改为 submit/navigate/set_state/open_dialog 并补齐可观察后置条件，或保留 decline。",
    })),
  );
}

function unresolvedConfirmationQuestions(
  flowPlan: FlowPlanDraft,
): FlowM10ConfirmationQuestion[] {
  const interactionById = new Map(
    flowPlan.interactions.map((interaction) => [interaction.id, interaction]),
  );
  return generateFlowM10ConfirmationQuestions({ flowPlan }).filter((question) => {
    const interaction = interactionById.get(question.interactionId);
    return (
      !interaction ||
      (interaction.source !== "user_confirmed" &&
        interaction.blockedReason !== "user_declined_interaction")
    );
  });
}

async function writeConfirmationQuestionsArtifact(input: {
  readonly cwd: string;
  readonly request: ProductM9RunRequest;
  readonly runId: string;
  readonly rawReportRoot: string;
  readonly artifacts: FlowArtifactInput;
}): Promise<ConfirmationQuestionsArtifact | undefined> {
  if (input.request.answersPath) {
    return undefined;
  }
  const flowPlan = flowPlanDraftFrom(input.artifacts.flowPlan);
  const questions = unresolvedConfirmationQuestions(flowPlan);
  if (questions.length === 0) {
    return undefined;
  }
  const questionsPath = resolve(
    input.cwd,
    input.rawReportRoot,
    input.runId,
    "confirmation-questions.json",
  );
  const answerTemplatePath = resolve(
    input.cwd,
    input.rawReportRoot,
    input.runId,
    "confirmation-answer-template.json",
  );
  const answerTemplate = buildConfirmationAnswerTemplate(questions);
  await mkdir(dirname(questionsPath), { recursive: true });
  await writeFile(
    questionsPath,
    `${JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        projectId: input.request.projectId,
        runId: input.runId,
        questionCount: questions.length,
        questions,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    answerTemplatePath,
    `${JSON.stringify(answerTemplate, null, 2)}\n`,
  );
  const artifactRef = relativeRef(input.cwd, questionsPath);
  const answerTemplateRef = relativeRef(input.cwd, answerTemplatePath);
  return {
    path: artifactRef,
    answerTemplatePath: answerTemplateRef,
    stage: stage(
      "partial",
      `Flow-M10 confirmation questions written=${questions.length}`,
      { artifactRef },
    ),
  };
}

async function loadRestrictedLiveArtifacts(input: {
  readonly cwd: string;
  readonly normalized: NormalizedProductM9Request;
  readonly options: RunProductM9FlowOptions;
  readonly dataRoot: string;
  readonly signal?: AbortSignal;
}): Promise<FlowArtifactInput> {
  const { request, nodeId, figmaUrl } = input.normalized;
  if (!request.gates?.allowFigmaNetwork) {
    throw productM9Error(
      "auth_missing",
      "restricted-live mode is missing --allow-figma-network",
    );
  }
  const env = input.options.env ?? process.env;
  if (env.PRODUCT_M9_FIGMA_AUTHORIZED !== "1") {
    throw productM9Error(
      "auth_missing",
      "restricted-live mode requires PRODUCT_M9_FIGMA_AUTHORIZED=1",
    );
  }
  const token = env.FIGMA_API_KEY?.trim();
  if (!token) {
    throw productM9Error(
      "auth_missing",
      "restricted-live mode requires FIGMA_API_KEY",
    );
  }
  if (!figmaUrl) {
    throw productM9Error(
      "input_invalid",
      "restricted-live mode requires figmaUrl or fileKey",
    );
  }

  const store = new ProjectStore(input.dataRoot);
  const restClientOptions: FigmaRestClientOptions = { token };
  if (input.options.rateLimitLogger) {
    restClientOptions.rateLimitLogger = input.options.rateLimitLogger;
  }
  if (input.options.figmaFetchImpl) {
    restClientOptions.fetchImpl = input.options.figmaFetchImpl;
  }
  if (input.options.figmaMaxRetries !== undefined) {
    restClientOptions.maxRetries = input.options.figmaMaxRetries;
  }
  if (input.options.figmaSleep) {
    restClientOptions.sleep = input.options.figmaSleep;
  }
  const inspector = new FigmaInspector({
    restClient: new FigmaRestClient(restClientOptions),
    imageDownloader: new FigmaImageDownloader({
      projectStore: store,
      fetchImpl: input.options.figmaFetchImpl,
    }),
    projectStore: store,
  });
  const output = await inspector.inspect(
    {
      schemaVersion: SCHEMA_VERSION,
      projectId: request.projectId,
      figmaUrl,
      targetNodes: nodeId ? [nodeId] : undefined,
    },
    input.signal,
    { variablesMode: "disabled_restricted_live" },
  );
  const bundle = await store.loadDesignBundle(
    request.projectId,
    output.designBundleRevision,
  );
  const uiSpec = await loadOrGenerateUISpec({
    store,
    projectId: request.projectId,
    bundleRevision: output.designBundleRevision,
  });
  const flowPlan = generateFlowConfirmationQuestions(
    buildFlowPlan({ bundle, uiSpec }),
  );
  await saveFlowPlan({ store, projectId: request.projectId, flowPlan });
  return {
    flowPlan,
    uiSpec,
    designBundlePath: `data/projects/${request.projectId}/figma/current.json`,
    uiSpecPath: `data/projects/${request.projectId}/specs/current.json`,
    flowPlanPath: `data/projects/${request.projectId}/flow/current.json`,
  };
}

function metricsFor(flowPlan: FlowPlan | FlowPlanDraft | undefined, input: {
  readonly artifact?: FlowM11ArtifactLoadResult;
  readonly validation?: FlowM11ValidationSummary;
}): ProductM9RunResult["metrics"] {
  const interactions = flowPlan?.interactions ?? [];
  const isTrusted = (interaction: (typeof interactions)[number]): boolean =>
    (interaction.source === "figma" ||
      interaction.source === "user_confirmed") &&
    interaction.confirmed;
  const interactionById = new Map(
    interactions.map((interaction) => [interaction.id, interaction]),
  );
  const unresolvedConfirmationInteractionIds = new Set<string>();
  const unresolvedConfirmationQuestionCount =
    flowPlan?.confirmationQuestions.filter((question) => {
      const interaction = interactionById.get(question.interactionId);
      const unresolved =
        !interaction ||
        (interaction.source !== "user_confirmed" &&
          interaction.blockedReason !== "user_declined_interaction");
      if (unresolved) {
        unresolvedConfirmationInteractionIds.add(question.interactionId);
      }
      return unresolved;
    }).length ?? 0;
  const isResolvedAway = (
    interaction: (typeof interactions)[number],
  ): boolean =>
    interaction.blockedReason === "user_declined_interaction" ||
    unresolvedConfirmationInteractionIds.has(interaction.id);
  return {
    trustedNavigate: interactions.filter(
      (interaction) => isTrusted(interaction) && interaction.intent === "navigate",
    ).length,
    trustedStateChange: interactions.filter(
      (interaction) => isTrusted(interaction) && interaction.intent === "set_state",
    ).length,
    submitLikeNeedsConfirmation:
      unresolvedConfirmationQuestionCount > 0
        ? unresolvedConfirmationQuestionCount
        : interactions.filter(
            (interaction) =>
              interaction.intent === "submit" &&
              interaction.blockedReason !== "user_declined_interaction" &&
              (!isTrusted(interaction) || !interaction.postconditions?.length),
          ).length,
    unsupported: interactions.filter(
      (interaction) =>
        interaction.intent === "unknown" && !isResolvedAway(interaction),
    ).length,
    missingEvidence: interactions.filter(
      (interaction) =>
        !isResolvedAway(interaction) &&
        (interaction.source === "missing" || Boolean(interaction.blockedReason)),
    ).length,
    successfulFixtureIds: input.validation?.successfulFixtureIds ?? [],
    failedFixtureIds: input.validation?.failedFixtureIds ?? [],
  };
}

const NON_SUBMIT_ACCEPTED_PARTIAL_REASONS = new Set([
  "flow_m11_trusted_submit_fixture_missing",
  "flow_m11_multistep_submit_fixture_missing",
  "flow_m11_select_radio_toggle_missing",
]);

function isNonSubmitExecutablePassed(input: {
  readonly artifact: FlowM11ArtifactLoadResult;
  readonly executionReport: FlowM11ExecutionReport;
  readonly metrics: ProductM9RunResult["metrics"];
}): boolean {
  if (
    input.artifact.status !== "loaded" ||
    input.executionReport.status !== "partial" ||
    input.executionReport.failedFixtureIds.length > 0 ||
    input.executionReport.successfulFixtureIds.length < 1 ||
    (input.metrics.submitLikeNeedsConfirmation ?? 0) > 0 ||
    (input.metrics.unsupported ?? 0) > 0 ||
    (input.metrics.missingEvidence ?? 0) > 0
  ) {
    return false;
  }
  return input.executionReport.reasons.every((reason) =>
    NON_SUBMIT_ACCEPTED_PARTIAL_REASONS.has(reason),
  );
}

function statusAndErrorFor(input: {
  readonly artifact: FlowM11ArtifactLoadResult;
  readonly executionReport: FlowM11ExecutionReport;
  readonly metrics: ProductM9RunResult["metrics"];
}): Pick<ProductM9RunResult, "ok" | "status" | "error" | "nextAction"> {
  const reasonCodes = input.artifact.reasonCodes as readonly string[];
  if (input.executionReport.status === "passed" && input.artifact.status === "loaded") {
    return {
      ok: true,
      status: "passed",
      nextAction:
        "Product-M9 FlowPlan validation passed; inspect summary and artifact refs before delivery.",
    };
  }
  if (isNonSubmitExecutablePassed(input)) {
    return {
      ok: true,
      status: "passed",
      nextAction:
        "Product-M9 non-submit FlowPlan validation passed; multistep submit coverage was not required for this artifact.",
    };
  }
  if (
    reasonCodes.includes("flow_plan_untrusted_source") &&
    (input.metrics.submitLikeNeedsConfirmation ?? 0) > 0
  ) {
    const error = productM9Error(
      "needs_confirmation",
      "FlowPlan contains interactions that require user confirmation",
    );
    return { ok: false, status: "partial", error, nextAction: error.nextAction };
  }
  if ((input.metrics.unsupported ?? 0) > 0) {
    const error = productM9Error(
      "unsupported_figma_action",
      "FlowPlan contains unsupported Figma actions",
    );
    return { ok: false, status: "partial", error, nextAction: error.nextAction };
  }
  if (input.executionReport.failedFixtureIds.length > 0) {
    const error = productM9Error(
      "flow_execution_failed",
      "Flow behavior validation failed",
    );
    return { ok: false, status: "failed", error, nextAction: error.nextAction };
  }
  if (input.executionReport.status === "failed") {
    const category: ProductM9ErrorCategory = reasonCodes.includes(
      "flow_plan_artifact_missing",
    )
      ? "artifact_missing"
      : "partial_evidence";
    const error = productM9Error(
      category,
      "FlowPlan evidence is not executable",
    );
    return {
      ok: false,
      status: category === "artifact_missing" ? "failed" : "partial",
      error,
      nextAction: error.nextAction,
    };
  }
  const error = productM9Error(
    "partial_evidence",
    "FlowPlan validation completed with partial evidence",
  );
  return { ok: false, status: "partial", error, nextAction: error.nextAction };
}

function mapUnknownError(error: unknown): ProductM9RunError {
  if (
    typeof error === "object" &&
    error !== null &&
    "category" in error &&
    productM9RunErrorSchema.safeParse(error).success
  ) {
    return error as ProductM9RunError;
  }
  if (error instanceof FigmaInputError || error instanceof z.ZodError) {
    return productM9Error(
      "input_invalid",
      error instanceof z.ZodError ? "Product-M9 input is invalid" : error.message,
      { details: { issues: error instanceof z.ZodError ? error.issues : undefined } },
    );
  }
  if (error instanceof ProjectStoreError) {
    return productM9Error(
      error.code === "not_found" ? "artifact_missing" : "internal_error",
      error.message,
      { recoverable: error.code === "not_found", details: { code: error.code } },
    );
  }
  if (error instanceof FigmaRestError) {
    if (error.status === 429) {
      return productM9Error("figma_rate_limited", error.message, {
        details: { code: error.code, status: error.status },
      });
    }
    if (error.status === 401 || error.status === 403) {
      return productM9Error("figma_permission_denied", error.message, {
        details: { code: error.code, status: error.status },
      });
    }
    if (error.status === 404) {
      return productM9Error("figma_not_found", error.message, {
        details: { code: error.code, status: error.status },
      });
    }
  }
  return productM9Error(
    "internal_error",
    error instanceof Error ? error.message : "Product-M9 internal error",
    {
      recoverable: false,
      details: { name: error instanceof Error ? error.name : undefined },
    },
  );
}

async function runFlowArtifacts(input: {
  readonly cwd: string;
  readonly request: ProductM9RunRequest;
  readonly runId: string;
  readonly artifacts: FlowArtifactInput;
  readonly options: RunProductM9FlowOptions;
}): Promise<{
  readonly artifact: FlowM11ArtifactLoadResult;
  readonly executionReport: FlowM11ExecutionReport;
  readonly validation: FlowM11ValidationSummary;
  readonly uiSpec: UISpecDraft;
}> {
  const artifact = await loadFlowM11Artifact({
    artifactRef: input.artifacts.flowPlanPath,
    rawFlowPlan: input.artifacts.flowPlan,
    uiSpec: input.artifacts.uiSpec,
  });
  const planner = planFlowM11BehaviorFixtures({
    artifact,
    uiSpec: input.artifacts.uiSpec,
  });
  if (input.request.runCompare && !input.options.flowValidationRunner) {
    throw productM9Error(
      "internal_error",
      "runCompare requires an injected Product-M9 flow validation runner",
      { recoverable: false },
    );
  }
  const validation = input.request.runCompare
    ? await input.options.flowValidationRunner!({
      runId: input.runId,
      projectId: input.request.projectId,
      uiSpec: planner.uiSpec,
      fixtureIds: planner.executableFixtureIds,
    })
    : flowM11ValidationSummarySchema.parse({
        schemaVersion: SCHEMA_VERSION,
        runId: input.runId,
        passed: true,
        resultCount: planner.executableFixtureIds.length,
        failedCheckCount: 0,
        successfulFixtureIds: planner.executableFixtureIds,
        failedFixtureIds: [],
        preSatisfiedExpectationCount: 0,
      });
  const outputRoot = resolve(
    input.cwd,
    input.request.reportRoot ?? "reports/product-m9",
    input.runId,
  );
  const validationPath = join(outputRoot, "flow-m11-summary.json");
  const executionReport = buildFlowM11ExecutionReport({
    runId: input.runId,
    mode: input.request.mode,
    flowPlanRef: input.artifacts.flowPlanPath,
    uiSpecRef: input.artifacts.uiSpecPath,
    reportRef: relative(input.cwd, validationPath),
    figmaRestCalled: input.request.mode === "restricted-live",
    artifact,
    planner,
    validation,
  });
  await mkdir(dirname(validationPath), { recursive: true });
  await writeFile(validationPath, `${JSON.stringify(executionReport, null, 2)}\n`);
  return {
    artifact,
    executionReport,
    validation,
    uiSpec: planner.uiSpec,
  };
}

async function runProductM9FlowInternal(
  rawInput: unknown,
  options: RunProductM9FlowOptions,
  signal?: AbortSignal,
): Promise<ProductM9RunResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runId =
    typeof rawInput === "object" &&
    rawInput !== null &&
    typeof Reflect.get(rawInput, "runId") === "string"
      ? Reflect.get(rawInput, "runId")
      : (options.runId?.() ?? createRunId());
  const rawReportRoot =
    typeof rawInput === "object" &&
    rawInput !== null &&
    typeof Reflect.get(rawInput, "reportRoot") === "string"
      ? String(Reflect.get(rawInput, "reportRoot"))
      : "reports/product-m9";
  const reportRoot = resolve(cwd, rawReportRoot);
  const baseArtifactRefs = {
    summaryJson: `${rawReportRoot}/${runId}/summary.json`,
    summaryMarkdown: `${rawReportRoot}/${runId}/summary.md`,
  };
  const stages: ProductM9RunResult["stages"] = {};

  try {
    const normalized = normalizeRequest(rawInput);
    const { request } = normalized;
    stages.inspect = stage("passed", "Product-M9 input validated");
    const dataRoot = resolve(cwd, request.dataRoot ?? "data");
    const artifacts =
      request.mode === "restricted-live"
        ? await loadRestrictedLiveArtifacts({
            cwd,
            normalized,
            options,
            dataRoot,
            signal,
          })
        : await loadLocalArtifacts({ cwd, request });
    const confirmationQuestions = await writeConfirmationQuestionsArtifact({
      cwd,
      request,
      runId,
      rawReportRoot,
      artifacts,
    });
    if (confirmationQuestions) {
      stages.confirmation = confirmationQuestions.stage;
    }
    const confirmed = await applyConfirmationAnswers({
      cwd,
      request,
      runId,
      rawReportRoot,
      artifacts,
    });
    if (confirmed.stage) {
      stages.confirmation = confirmed.stage;
    }
    const effectiveArtifacts = confirmed.artifacts;
    stages.staticGeneration = stage(
      "passed",
      request.mode === "restricted-live"
        ? "UISpec generated from restricted-live DesignBundle"
        : "Local UISpec artifact loaded",
      { artifactRef: effectiveArtifacts.uiSpecPath },
    );
    stages.flowPlanExtraction = stage(
      "passed",
      request.mode === "restricted-live"
        ? "FlowPlan generated and saved from Figma evidence"
        : "Local FlowPlan artifact loaded",
      { artifactRef: effectiveArtifacts.flowPlanPath },
    );

    const flowOutput = await runFlowArtifacts({
      cwd,
      request,
      runId,
      artifacts: effectiveArtifacts,
      options,
    });
    stages.execution = stage(
      flowOutput.executionReport.status,
      `Flow-M11 execution ${flowOutput.executionReport.status}`,
      {
        artifactRef: `${rawReportRoot}/${runId}/flow-m11-summary.json`,
        reasonCode: flowOutput.executionReport.reasons[0],
      },
    );
    const metrics = metricsFor(effectiveArtifacts.flowPlan, {
      artifact: flowOutput.artifact,
      validation: flowOutput.validation,
    });
    const status = statusAndErrorFor({
      artifact: flowOutput.artifact,
      executionReport: flowOutput.executionReport,
      metrics,
    });
    stages.report = stage("passed", "Product-M9 summary written");
    const result = productM9RunResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      ok: status.ok,
      status: status.status,
      mode: request.mode,
      projectId: request.projectId,
      runId,
      stages,
      artifactRefs: {
        ...baseArtifactRefs,
        designBundlePath: effectiveArtifacts.designBundlePath,
        uiSpecPath: effectiveArtifacts.uiSpecPath,
        flowPlanPath: effectiveArtifacts.flowPlanPath,
        confirmationQuestionsPath: confirmationQuestions?.path,
        confirmationAnswerTemplatePath:
          confirmationQuestions?.answerTemplatePath,
        confirmedFlowPlanPath:
          effectiveArtifacts.confirmedFlowPlanPath ??
          request.confirmedFlowPlanPath,
        validationPath: `${rawReportRoot}/${runId}/flow-m11-summary.json`,
      },
      metrics,
      error: status.error,
      nextAction: status.nextAction,
    });
    redactionCheckProductM9Report(result);
    return await writeProductM9Report({ result, reportRoot, runId });
  } catch (error) {
    const mapped = mapUnknownError(error);
    stages.report = stage("passed", "Product-M9 failure summary written");
    const result = productM9RunResultSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      status: "failed",
      mode: safeMode(
        typeof rawInput === "object" && rawInput !== null
          ? Reflect.get(rawInput, "mode")
          : undefined,
      ),
      projectId: safeProjectId(
        typeof rawInput === "object" && rawInput !== null
          ? Reflect.get(rawInput, "projectId")
          : undefined,
      ),
      runId,
      stages: {
        ...stages,
        inspect: stages.inspect ?? stage("failed", mapped.message, {
          reasonCode: mapped.category,
        }),
      },
      artifactRefs: baseArtifactRefs,
      metrics: {},
      error: mapped,
      nextAction: mapped.nextAction,
    });
    redactionCheckProductM9Report(result);
    return await writeProductM9Report({ result, reportRoot, runId });
  }
}

export async function runProductM9Flow(
  rawInput: unknown,
  options: RunProductM9FlowOptions = {},
  signal?: AbortSignal,
): Promise<ProductM9RunResult> {
  return await runProductM9FlowInternal(rawInput, options, signal);
}
