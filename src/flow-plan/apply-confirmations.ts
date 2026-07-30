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
    const submitStateVisibleMatch =
      /^submit:set_state:([^:]+):(true|false):expect_visible:([^:]+)$/.exec(
        answer,
      );
    if (submitStateVisibleMatch) {
      return {
        ...interaction,
        source: "user_confirmed" as const,
        confirmed: true,
        trigger: "submit" as const,
        intent: "submit" as const,
        stateKey: submitStateVisibleMatch[1],
        value: submitStateVisibleMatch[2] === "true",
        postconditions: [
          {
            kind: "expect_visible" as const,
            nodeId: submitStateVisibleMatch[3]!,
          },
        ],
        blockedReason: undefined,
        reason: "用户确认该控件提交表单并产生本地可见结果。",
      };
    }
    const submitNavigateMatch =
      /^submit:navigate:([^:]+):expect_page:([^:]+)$/.exec(answer);
    if (
      submitNavigateMatch &&
      pageIds.has(submitNavigateMatch[1]!) &&
      submitNavigateMatch[1] === submitNavigateMatch[2]
    ) {
      return {
        ...interaction,
        source: "user_confirmed" as const,
        confirmed: true,
        trigger: "submit" as const,
        intent: "submit" as const,
        targetPageId: submitNavigateMatch[1],
        postconditions: [
          {
            kind: "expect_page" as const,
            pageId: submitNavigateMatch[2]!,
          },
        ],
        blockedReason: undefined,
        reason: "用户确认该控件提交表单并跳转页面。",
      };
    }
    if (answer.startsWith("submit:")) {
      return {
        ...interaction,
        confirmed: false,
        blockedReason: "invalid_submit_confirmation_answer",
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
