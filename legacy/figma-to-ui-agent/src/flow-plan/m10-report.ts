import {
  flowM10ConfirmationReportSchema,
  type FlowM10ApplyResult,
  type FlowM10ConfirmationQuestion,
  type FlowM10ConfirmationReport,
} from "./m10-schema.ts";
import type { FlowPlanDraft } from "./schema.ts";

export function redactionCheckFlowM10Report(value: unknown): void {
  const serialized = JSON.stringify(value);
  const checks: Array<readonly [RegExp, string]> = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/[?&]node-id=/, "figma_node_query"],
    [/"rawResponse"\s*:/, "raw_response"],
    [/"designUrl"\s*:/, "design_url"],
    [/"fileKey"\s*:/, "file_key"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`flow_m10_report_redaction_failed:${reason}`);
    }
  }
}

function statusFor(input: {
  readonly questions: readonly FlowM10ConfirmationQuestion[];
  readonly results: readonly FlowM10ApplyResult[];
}): FlowM10ConfirmationReport["status"] {
  const submitLikeQuestions = input.questions.filter(
    (question) => question.questionKind === "submit_like",
  ).length;
  const rejected = input.results.filter(
    (item) => item.result === "rejected" || item.result === "invalid",
  ).length;
  const appliedSubmitOrTransition = input.results.filter(
    (item) =>
      item.result === "applied" &&
      (item.intent === "submit" || item.intent === "set_state"),
  ).length;
  if (submitLikeQuestions > 0 && rejected > 0 && appliedSubmitOrTransition > 0) {
    return "passed";
  }
  if (input.questions.length > 0 || input.results.length > 0) {
    return "partial";
  }
  return "failed";
}

export function buildFlowM10ConfirmationReport(input: {
  readonly runId: string;
  readonly mode: "local" | "restricted-live-regression";
  readonly flowPlanRef?: string;
  readonly uiSpecRef?: string;
  readonly m9ReportRef?: string;
  readonly answerRef?: string;
  readonly confirmedFlowPlanRef?: string;
  readonly figmaRestCalled?: boolean;
  readonly questions: readonly FlowM10ConfirmationQuestion[];
  readonly results: readonly FlowM10ApplyResult[];
  readonly flowPlan: FlowPlanDraft;
  readonly m8Consumed?: {
    readonly userConfirmedConvertedCount: number;
    readonly trustedSubmitConvertedCount: number;
    readonly stateMachineTransitionCount: number;
  };
}): FlowM10ConfirmationReport {
  const userConfirmedInteractions = input.flowPlan.interactions.filter(
    (interaction) =>
      interaction.source === "user_confirmed" && interaction.confirmed,
  );
  const sampleIds = [
    ...new Set(
      input.questions
        .map((question) => question.sampleId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const counts = {
    generatedQuestions: input.questions.length,
    submitLikeQuestions: input.questions.filter(
      (question) => question.questionKind === "submit_like",
    ).length,
    answersReceived: input.results.length,
    applied: input.results.filter((item) => item.result === "applied").length,
    declined: input.results.filter((item) => item.result === "declined").length,
    rejected: input.results.filter((item) => item.result === "rejected").length,
    invalid: input.results.filter((item) => item.result === "invalid").length,
    unmatched: input.results.filter((item) => item.result === "unmatched").length,
    summaryOnlyQuestions: input.questions.filter(
      (question) => question.applyCarrier === "summary_only",
    ).length,
    userConfirmedSubmit: userConfirmedInteractions.filter(
      (interaction) => interaction.intent === "submit",
    ).length,
    userConfirmedStateMachineTransitions: userConfirmedInteractions.filter(
      (interaction) => Boolean(interaction.stateMachineTransitionId),
    ).length,
  };
  const report = flowM10ConfirmationReportSchema.parse({
    schemaVersion: "1",
    milestone: "Flow-M10",
    scope: "confirmation_semantics",
    status: statusFor(input),
    input: {
      runId: input.runId,
      mode: input.mode,
      flowPlanRef: input.flowPlanRef,
      uiSpecRef: input.uiSpecRef,
      m9ReportRef: input.m9ReportRef,
      answerRef: input.answerRef,
      networkBoundary: {
        figmaRestCalled: input.figmaRestCalled ?? false,
        openaiCalled: false,
        mode: input.mode,
      },
    },
    counts,
    artifacts: input.confirmedFlowPlanRef
      ? { confirmedFlowPlanRef: input.confirmedFlowPlanRef }
      : undefined,
    samples: sampleIds.map((sampleId) => {
      const questions = input.questions.filter(
        (question) => question.sampleId === sampleId,
      );
      const questionIds = new Set(questions.map((question) => question.id));
      const results = input.results.filter((item) =>
        questionIds.has(item.questionId),
      );
      return {
        sampleId,
        questions: questions.length,
        summaryOnlyQuestions: questions.filter(
          (question) => question.applyCarrier === "summary_only",
        ).length,
        applied: results.filter((item) => item.result === "applied").length,
        rejected: results.filter((item) => item.result === "rejected").length,
        residualUnresolved: questions.length - results.length,
      };
    }),
    appliedInteractions: userConfirmedInteractions.map((interaction) => ({
      interactionId: interaction.id,
      source: "user_confirmed",
      intent: interaction.intent,
      postconditionKinds: interaction.postconditions?.map(
        (postcondition) => postcondition.kind,
      ),
      artifactRefs: [
        input.confirmedFlowPlanRef,
        input.flowPlanRef,
        input.uiSpecRef,
      ].filter((value): value is string => Boolean(value)),
    })),
    rejections: input.results
      .filter((item) => item.result === "rejected" || item.result === "invalid")
      .map((item) => ({
        questionId: item.questionId,
        reasonCode: item.reasonCode,
        evidence: `answer ${item.answerId} ${item.result}`,
      })),
    reasons: [
      ...(input.m8Consumed
        ? [
            `m8_user_confirmed_converted=${input.m8Consumed.userConfirmedConvertedCount}`,
            `m8_trusted_submit_converted=${input.m8Consumed.trustedSubmitConvertedCount}`,
            `m8_state_machine_transitions=${input.m8Consumed.stateMachineTransitionCount}`,
          ]
        : []),
    ],
    residualRisks: [
      input.mode === "restricted-live-regression"
        ? "restricted-live 回归复用 Flow-M9 summary 作为真实 question provenance；apply 证据来自可读取 FlowPlan fixture 或 artifact。"
        : "本地 fixture 证明确认语义链路，不代表真实后端业务成功。",
    ],
  });
  redactionCheckFlowM10Report(report);
  return report;
}
