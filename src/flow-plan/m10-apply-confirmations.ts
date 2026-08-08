import type { UISpecDraft } from "../ui-spec/schema.ts";
import {
  flowPlanDraftSchema,
  recomputeFlowPlanReport,
  type FlowPlan,
  type FlowPlanDraft,
  type FlowPlanInteraction,
  type FlowPostcondition,
} from "./schema.ts";
import {
  flowM10ConfirmationAnswersSchema,
  flowM10ApplyResultSchema,
  type FlowM10ApplyResult,
  type FlowM10ConfirmationAnswer,
  type FlowM10ConfirmationQuestion,
} from "./m10-schema.ts";

export interface ApplyFlowM10ConfirmationsResult {
  readonly flowPlan: FlowPlanDraft;
  readonly results: FlowM10ApplyResult[];
}

function postconditionTargetExists(
  postcondition: FlowPostcondition,
  pageIds: ReadonlySet<string>,
  nodeIds: ReadonlySet<string>,
): boolean {
  if (postcondition.kind === "expect_page") {
    return pageIds.has(postcondition.pageId);
  }
  return nodeIds.has(postcondition.nodeId);
}

function m8EffectFields(
  answer: FlowM10ConfirmationAnswer,
): Pick<
  FlowPlanInteraction,
  "targetPageId" | "stateKey" | "dialogNodeId" | "value"
> {
  if (answer.answerKind === "navigate") {
    return { targetPageId: answer.targetPageId };
  }
  if (answer.answerKind === "set_state") {
    return {
      stateKey: answer.stateKey,
      value: answer.value,
    };
  }
  if (answer.answerKind === "open_dialog") {
    return { dialogNodeId: answer.dialogNodeId };
  }
  if (answer.answerKind === "submit") {
    if (answer.effect.kind === "navigate") {
      return { targetPageId: answer.effect.pageId };
    }
    if (answer.effect.kind === "set_state") {
      return {
        stateKey: answer.effect.stateKey,
        value: answer.effect.value,
      };
    }
    if (answer.effect.kind === "open_dialog") {
      return { dialogNodeId: answer.effect.dialogNodeId };
    }
  }
  return {};
}

function postconditionsFor(
  answer: FlowM10ConfirmationAnswer,
): FlowPostcondition[] | undefined {
  if (
    answer.answerKind === "submit" ||
    answer.answerKind === "set_state" ||
    answer.answerKind === "open_dialog"
  ) {
    return answer.postconditions;
  }
  if (answer.answerKind === "navigate") {
    return [{ kind: "expect_page", pageId: answer.targetPageId }];
  }
  return undefined;
}

function result(input: {
  readonly answer: FlowM10ConfirmationAnswer;
  readonly question?: FlowM10ConfirmationQuestion;
  readonly interaction?: FlowPlanInteraction;
  readonly result: FlowM10ApplyResult["result"];
  readonly reasonCode: string;
  readonly source?: FlowM10ApplyResult["source"];
  readonly intent?: FlowM10ApplyResult["intent"];
}): FlowM10ApplyResult {
  return flowM10ApplyResultSchema.parse({
    answerId: input.answer.id,
    questionId: input.answer.questionId,
    interactionId: input.interaction?.id ?? input.question?.interactionId,
    result: input.result,
    reasonCode: input.reasonCode,
    source: input.source ?? "none",
    intent: input.intent,
  });
}

export function applyFlowM10Confirmations(input: {
  readonly flowPlan: FlowPlanDraft | FlowPlan;
  readonly questions: readonly FlowM10ConfirmationQuestion[];
  readonly rawAnswers: unknown;
  readonly uiSpec?: UISpecDraft;
}): ApplyFlowM10ConfirmationsResult {
  const answers = flowM10ConfirmationAnswersSchema.parse(input.rawAnswers);
  const questionById = new Map(input.questions.map((item) => [item.id, item]));
  const interactionById = new Map(
    input.flowPlan.interactions.map((item) => [item.id, item]),
  );
  const pageIds = new Set(input.flowPlan.pages.map((page) => page.id));
  const uiNodeIds = new Set(input.uiSpec?.nodes.map((node) => node.id) ?? []);
  const nodeIds = new Set<string>([
    ...uiNodeIds,
    ...input.flowPlan.interactions
      .flatMap((interaction) => [
        interaction.uiNodeId,
        interaction.sourceNodeId,
        interaction.targetNodeId,
        interaction.dialogNodeId,
      ])
      .filter((value): value is string => Boolean(value)),
  ]);
  const results: FlowM10ApplyResult[] = [];
  const interactions = input.flowPlan.interactions.map((interaction) => ({
    ...interaction,
  }));
  const outputById = new Map(interactions.map((item) => [item.id, item]));
  const appliedKeys = new Set<string>();

  for (const answer of answers) {
    const question = questionById.get(answer.questionId);
    if (!question) {
      results.push(
        result({
          answer,
          result: "unmatched",
          reasonCode: "question_not_found",
        }),
      );
      continue;
    }
    const interaction = interactionById.get(question.interactionId);
    if (!interaction) {
      results.push(
        result({
          answer,
          question,
          result:
            question.applyCarrier === "summary_only" ? "rejected" : "unmatched",
          reasonCode:
            question.applyCarrier === "summary_only"
              ? "summary_only_apply_carrier"
              : "interaction_not_found",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    if (!question.allowedAnswerKinds.includes(answer.answerKind)) {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "rejected",
          reasonCode: "answer_kind_not_allowed",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    if (answer.answerKind === "decline") {
      const next = outputById.get(interaction.id)!;
      next.confirmed = false;
      next.blockedReason = "user_declined_interaction";
      next.reason = answer.reason;
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "declined",
          reasonCode: "user_declined_interaction",
          source: question.applyCarrier,
        }),
      );
      continue;
    }

    const postconditions = postconditionsFor(answer);
    if (
      question.requiredPostconditions === "at_least_one_observable" &&
      !postconditions?.length
    ) {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "rejected",
          reasonCode: "postcondition_missing",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    if (
      postconditions?.some(
        (postcondition) =>
          !postconditionTargetExists(postcondition, pageIds, nodeIds),
      )
    ) {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "rejected",
          reasonCode: "postcondition_reference_missing",
          source: question.applyCarrier,
        }),
      );
      continue;
    }

    const fields = m8EffectFields(answer);
    if (fields.targetPageId && !pageIds.has(fields.targetPageId)) {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "rejected",
          reasonCode: "target_page_missing",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    if (fields.dialogNodeId && !nodeIds.has(fields.dialogNodeId)) {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "rejected",
          reasonCode: "dialog_node_missing",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    if (answer.answerKind === "submit" && answer.effect.kind === "none") {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "rejected",
          reasonCode: "submit_none_effect_not_allowed",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    const key = `${answer.questionId}:${answer.id}`;
    if (appliedKeys.has(key)) {
      results.push(
        result({
          answer,
          question,
          interaction,
          result: "invalid",
          reasonCode: "duplicate_answer",
          source: question.applyCarrier,
        }),
      );
      continue;
    }
    appliedKeys.add(key);

    const next = outputById.get(interaction.id)!;
    const intent = answer.answerKind === "submit" ? "submit" : answer.answerKind;
    Object.assign(next, {
      ...fields,
      source: "user_confirmed",
      confirmed: true,
      trigger: intent === "submit" ? "submit" : "click",
      intent,
      postconditions,
      blockedReason: undefined,
      reason: answer.reason ?? "用户通过 Flow-M10 结构化答案确认该交互。",
    });
    results.push(
      result({
        answer,
        question,
        interaction: next,
        result: "applied",
        reasonCode: "user_confirmed_applied",
        source: question.applyCarrier,
        intent,
      }),
    );
  }

  const nextPlan = {
    ...input.flowPlan,
    interactions,
    report: recomputeFlowPlanReport({
      ...input.flowPlan,
      interactions,
    }),
  };
  return {
    flowPlan: flowPlanDraftSchema.parse(nextPlan),
    results,
  };
}
