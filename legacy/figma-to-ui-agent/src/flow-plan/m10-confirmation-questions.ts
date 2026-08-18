import type { FlowPlanDraft, FlowPlanInteraction } from "./schema.ts";
import type {
  FlowM9RestrictedLiveExtractionReport,
  FlowM9SampleClassification,
} from "./m9-report.ts";
import {
  flowM10ConfirmationQuestionSchema,
  type FlowM10ConfirmationQuestion,
} from "./m10-schema.ts";

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220) || "question";
}

function isSubmitLike(interaction: FlowPlanInteraction): boolean {
  return (
    interaction.trigger === "submit" ||
    interaction.intent === "submit" ||
    interaction.blockedReason === "interaction_target_missing" ||
    interaction.blockedReason === "submit_like_requires_confirmation"
  );
}

function isConfirmableFigmaTargetGap(
  interaction: FlowPlanInteraction,
): boolean {
  return (
    interaction.source === "figma" &&
    (interaction.blockedReason === "prototype_target_missing" ||
      interaction.blockedReason === "prototype_target_page_missing")
  );
}

function questionKindFor(
  interaction: FlowPlanInteraction,
): FlowM10ConfirmationQuestion["questionKind"] {
  if (interaction.blockedReason === "prototype_target_missing") {
    return "set_state";
  }
  if (interaction.blockedReason === "prototype_target_page_missing") {
    return "navigate";
  }
  if (isSubmitLike(interaction)) {
    return "submit_like";
  }
  if (interaction.intent === "navigate") {
    return "navigate";
  }
  if (interaction.intent === "set_state") {
    return "set_state";
  }
  if (interaction.intent === "open_dialog") {
    return "open_dialog";
  }
  return "submit_like";
}

function allowedKindsFor(
  kind: FlowM10ConfirmationQuestion["questionKind"],
): FlowM10ConfirmationQuestion["allowedAnswerKinds"] {
  if (kind === "submit_like") {
    return ["submit", "navigate", "set_state", "open_dialog", "decline"];
  }
  if (kind === "navigate") {
    return ["navigate", "decline"];
  }
  if (kind === "set_state" || kind === "state_machine_transition") {
    return ["set_state", "decline"];
  }
  return ["open_dialog", "decline"];
}

export function generateFlowM10ConfirmationQuestions(input: {
  readonly flowPlan?: FlowPlanDraft;
  readonly m9Report?: FlowM9RestrictedLiveExtractionReport;
}): FlowM10ConfirmationQuestion[] {
  const questions: FlowM10ConfirmationQuestion[] = [];
  const existing = new Set<string>();

  for (const interaction of input.flowPlan?.interactions ?? []) {
    if (
      interaction.source !== "inferred" &&
      interaction.source !== "missing" &&
      !isConfirmableFigmaTargetGap(interaction)
    ) {
      continue;
    }
    const kind = questionKindFor(interaction);
    const questionId = `m10-${safeId(interaction.id)}`;
    existing.add(`${interaction.id}:flow_plan`);
    questions.push(
      flowM10ConfirmationQuestionSchema.parse({
        schemaVersion: "1",
        id: questionId,
        interactionId: interaction.id,
        source: interaction.source,
        classification:
          kind === "submit_like"
            ? "needs_confirmation.submit_like"
            : interaction.blockedReason
              ? "missing_evidence"
              : undefined,
        questionKind: kind,
        prompt: `请确认控件「${interaction.sourceNodeName ?? interaction.uiNodeId ?? interaction.id}」触发后应产生什么本地可观察结果。`,
        evidenceSummary: interaction.reason,
        sourceNodeId: interaction.sourceNodeId,
        uiNodeId: interaction.uiNodeId,
        fromPageId: interaction.fromPageId,
        applyCarrier: "flow_plan",
        allowedAnswerKinds: allowedKindsFor(kind),
        requiredPostconditions:
          kind === "submit_like"
            ? "at_least_one_observable"
            : "none_allowed_for_decline_only",
        candidateRefs: {
          pageIds: [
            interaction.fromPageId,
            interaction.targetPageId,
          ].filter((value): value is string => Boolean(value)),
          nodeIds: [
            interaction.uiNodeId,
            interaction.sourceNodeId,
            interaction.targetNodeId,
            interaction.dialogNodeId,
          ].filter((value): value is string => Boolean(value)),
          stateKeys: interaction.stateKey ? [interaction.stateKey] : [],
          transitionIds: interaction.stateMachineTransitionId
            ? [interaction.stateMachineTransitionId]
            : [],
        },
        required: true,
      }),
    );
  }

  for (const sample of input.m9Report?.samples ?? []) {
    for (const classification of sample.classifications) {
      if (
        classification.classification !== "needs_confirmation.submit_like" ||
        !classification.interactionId ||
        existing.has(`${classification.interactionId}:flow_plan`)
      ) {
        continue;
      }
      questions.push(summaryOnlyQuestion(sample.sampleId, classification));
    }
  }

  return questions;
}

function summaryOnlyQuestion(
  sampleId: string,
  classification: FlowM9SampleClassification,
): FlowM10ConfirmationQuestion {
  const questionId = `m10-${safeId(sampleId)}-${safeId(
    classification.interactionId!,
  )}`;
  return flowM10ConfirmationQuestionSchema.parse({
    schemaVersion: "1",
    id: questionId,
    interactionId: classification.interactionId,
    sampleId,
    source: "missing",
    classification: "needs_confirmation.submit_like",
    questionKind: "submit_like",
    prompt: `真实样本 ${sampleId} 中的 submit-like 候选需要用户确认后置结果。`,
    evidenceSummary: classification.evidence,
    sourceNodeId: classification.sourceNodeId,
    applyCarrier: "summary_only",
    allowedAnswerKinds: ["submit", "navigate", "set_state", "open_dialog", "decline"],
    requiredPostconditions: "at_least_one_observable",
    candidateRefs: {
      pageIds: [],
      nodeIds: classification.sourceNodeId ? [classification.sourceNodeId] : [],
      stateKeys: [],
      transitionIds: [],
    },
    required: true,
  });
}
