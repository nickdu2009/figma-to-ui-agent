import {
  type ConfirmationQuestion,
  type FlowPlanDraft,
  recomputeFlowPlanReport,
} from "./draft.ts";

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220) || "question";
}

export function generateConfirmationQuestions(
  draft: FlowPlanDraft,
): FlowPlanDraft {
  const questions: ConfirmationQuestion[] = [];
  const interactions = draft.interactions.map((interaction) => {
    if (
      interaction.source !== "inferred" &&
      interaction.source !== "missing"
    ) {
      return interaction;
    }
    const questionId = `confirm-${safeId(interaction.id)}`;
    const nodeLabel =
      interaction.sourceNodeName ?? interaction.uiNodeId ?? interaction.id;
    const sourcePageName =
      draft.pages.find((page) => page.id === interaction.fromPageId)?.name ??
      interaction.fromPageId ??
      "未知页面";
    const pageOptions = draft.pages.map((page) => ({
      label: `跳转到：${page.name}`,
      value: `target:${page.id}`,
    }));
    questions.push({
      id: questionId,
      interactionId: interaction.id,
      question:
        interaction.source === "inferred" && interaction.targetPageId
          ? `页面「${sourcePageName}」中的控件「${nodeLabel}」是否应该跳转到「${
              draft.pages.find((page) => page.id === interaction.targetPageId)
                ?.name ?? interaction.targetPageId
            }」？原因：${interaction.reason}`
          : `页面「${sourcePageName}」中的控件「${nodeLabel}」触发后应该发生什么？原因：${interaction.reason}`,
      options: [
        ...pageOptions,
        {
          label: "保持静态，不生成交互",
          value: "static",
        },
      ],
      required: true,
    });
    return {
      ...interaction,
      confirmationQuestionId: questionId,
    };
  });
  const nextDraft = {
    ...draft,
    interactions,
    confirmationQuestions: questions,
  };
  return {
    ...nextDraft,
    report: recomputeFlowPlanReport(nextDraft),
  };
}
