import { applyFlowM8FormSubmitStateMachineToUISpec } from "./m8-planner.ts";
import { applyFlowM10Confirmations } from "./m10-apply-confirmations.ts";
import { generateFlowM10ConfirmationQuestions } from "./m10-confirmation-questions.ts";
import { buildFlowM10ConfirmationReport } from "./m10-report.ts";
import type { FlowM10ConfirmationReport } from "./m10-schema.ts";
import { parseFlowM9RestrictedLiveExtractionReport } from "./m9-report.ts";
import { parseFlowPlanDraft } from "./schema.ts";
import { uiSpecDraftSchema } from "../ui-spec/schema.ts";

export interface RunFlowM10ConfirmationInput {
  readonly runId: string;
  readonly mode: "local" | "restricted-live-regression";
  readonly flowPlanRef: string;
  readonly uiSpecRef: string;
  readonly answerRef: string;
  readonly flowPlan: unknown;
  readonly uiSpec: unknown;
  readonly answers: unknown;
  readonly m9ReportRef?: string;
  readonly m9Report?: unknown;
  readonly confirmedFlowPlanRef?: string;
}

export interface RunFlowM10ConfirmationResult {
  readonly report: FlowM10ConfirmationReport;
  readonly flowPlan: ReturnType<typeof parseFlowPlanDraft>;
}

export function runFlowM10Confirmation(
  input: RunFlowM10ConfirmationInput,
): RunFlowM10ConfirmationResult {
  const flowPlan = parseFlowPlanDraft(input.flowPlan);
  const uiSpec = uiSpecDraftSchema.parse(input.uiSpec);
  const m9Report = input.m9Report
    ? parseFlowM9RestrictedLiveExtractionReport(input.m9Report)
    : undefined;
  const questions = generateFlowM10ConfirmationQuestions({
    flowPlan,
    m9Report,
  });
  const applied = applyFlowM10Confirmations({
    flowPlan,
    questions,
    rawAnswers: input.answers,
    uiSpec,
  });
  const m8 = applyFlowM8FormSubmitStateMachineToUISpec(
    uiSpec,
    applied.flowPlan,
  );
  const report = buildFlowM10ConfirmationReport({
    runId: input.runId,
    mode: input.mode,
    flowPlanRef: input.flowPlanRef,
    uiSpecRef: input.uiSpecRef,
    m9ReportRef: input.m9ReportRef,
    answerRef: input.answerRef,
    confirmedFlowPlanRef: input.confirmedFlowPlanRef,
    questions,
    results: applied.results,
    flowPlan: applied.flowPlan,
    m8Consumed: {
      userConfirmedConvertedCount: m8.userConfirmedConvertedCount,
      trustedSubmitConvertedCount: m8.trustedSubmitConvertedCount,
      stateMachineTransitionCount: m8.stateMachineTransitionCount,
    },
  });
  return {
    report,
    flowPlan: applied.flowPlan,
  };
}
