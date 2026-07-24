import {
  confirmationAnswersSchema,
  type FlowPlanDraft,
  recomputeFlowPlanReport,
} from "./draft.ts";

export function applyConfirmations(
  draft: FlowPlanDraft,
  rawAnswers: unknown,
): FlowPlanDraft {
  const answers = confirmationAnswersSchema.parse(rawAnswers);
  const answerByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer.value]),
  );
  const pageIds = new Set(draft.pages.map((page) => page.id));
  const interactions = draft.interactions.map((interaction) => {
    if (!interaction.confirmationQuestionId) {
      return interaction;
    }
    const answer = answerByQuestion.get(interaction.confirmationQuestionId);
    if (!answer) {
      return interaction;
    }
    if (answer === "static") {
      return {
        ...interaction,
        confirmed: false,
        blockedReason: "user_declined_interaction",
        reason: `${interaction.reason} 用户确认保持静态。`,
      };
    }
    const targetMatch = /^target:(.+)$/.exec(answer);
    if (!targetMatch || !pageIds.has(targetMatch[1]!)) {
      return {
        ...interaction,
        confirmed: false,
        blockedReason: "invalid_confirmation_answer",
      };
    }
    return {
      ...interaction,
      source: "user_confirmed" as const,
      confirmed: true,
      intent: "navigate" as const,
      targetPageId: targetMatch[1],
      blockedReason: undefined,
      reason: "用户确认该控件生成页面跳转。",
    };
  });
  const nextDraft = {
    ...draft,
    interactions,
  };
  return {
    ...nextDraft,
    report: recomputeFlowPlanReport(nextDraft),
  };
}
