import type { DesignBundle } from "../design-bundle/schema.ts";
import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import {
  applyConfirmations as applyLegacyConfirmations,
} from "./apply-confirmations.ts";
import {
  generateConfirmationQuestions as generateLegacyConfirmationQuestions,
} from "./confirmation-questions.ts";
import {
  parseFlowPlanDraft as parseLegacyFlowPlanDraft,
  type FlowPlanDraft as LegacyFlowPlanDraft,
  type InteractionSupplement as LegacyInteractionSupplement,
} from "./draft.ts";
import {
  buildFlowPlanDraft as buildLegacyFlowPlanDraft,
} from "./interaction-candidates.ts";
import {
  FLOW_PLAN_SCHEMA_VERSION,
  type FigmaInteractionSource,
  type FlowConfirmationAnswer,
  flowConfirmationInputsSchema,
  type FlowConfirmationInput,
  type FlowPlan,
  type FlowPlanDraft,
  type FlowPlanInteraction,
  type InteractionSupplement,
  parseFlowPlanDraft,
  recomputeFlowPlanReport,
  summarizeFlowPlan,
} from "./schema.ts";

export interface BuildFlowPlanInput {
  readonly bundle: DesignBundle;
  readonly uiSpec?: UISpec | UISpecDraft;
  readonly interactionSupplement?:
    | InteractionSupplement
    | LegacyInteractionSupplement;
  readonly figmaInteractionSource?: FigmaInteractionSource;
}

export interface FlowPlanServiceSummary {
  readonly flowPlanSummary: ReturnType<typeof summarizeFlowPlan>;
  readonly confirmationQuestions: FlowPlanDraft["confirmationQuestions"];
  readonly unresolvedInteractionCount: number;
}

function toLegacyInteractionSupplement(
  supplement: InteractionSupplement | LegacyInteractionSupplement,
): LegacyInteractionSupplement {
  return {
    schemaVersion: "m4-spike",
    projectId: supplement.projectId,
    sourceDesignBundleRevision: supplement.sourceDesignBundleRevision,
    rawSource: supplement.rawSource,
    interactions: supplement.interactions,
  };
}

function fromLegacyDraft(
  draft: LegacyFlowPlanDraft,
  figmaInteractionSource: FigmaInteractionSource,
): FlowPlanDraft {
  return parseFlowPlanDraft({
    schemaVersion: FLOW_PLAN_SCHEMA_VERSION,
    projectId: draft.projectId,
    sourceDesignBundleRevision: draft.sourceDesignBundleRevision,
    sourceUISpecRevision: draft.sourceUISpecRevision,
    figmaInteractionSource,
    pages: draft.pages,
    interactions: draft.interactions,
    confirmationQuestions: draft.confirmationQuestions,
    confirmations: [],
    report: {
      ...draft.report,
      confirmationCount: 0,
    },
  });
}

function toLegacyDraft(flowPlan: FlowPlanDraft) {
  return parseLegacyFlowPlanDraft({
    schemaVersion: "m4-spike",
    projectId: flowPlan.projectId,
    sourceDesignBundleRevision: flowPlan.sourceDesignBundleRevision,
    sourceUISpecRevision: flowPlan.sourceUISpecRevision,
    pages: flowPlan.pages,
    interactions: flowPlan.interactions,
    confirmationQuestions: flowPlan.confirmationQuestions,
    report: {
      unsupportedCount: flowPlan.report.unsupportedCount,
      unresolvedInteractionCount:
        flowPlan.report.unresolvedInteractionCount,
      convertedActionCount: flowPlan.report.convertedActionCount,
      behaviorFixtureCount: flowPlan.report.behaviorFixtureCount,
    },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function hasFigmaPrototypeInteractions(draft: LegacyFlowPlanDraft): boolean {
  return draft.interactions.some(
    (interaction) => interaction.source === "figma",
  );
}

export function buildFlowPlan({
  bundle,
  uiSpec,
  interactionSupplement,
  figmaInteractionSource,
}: BuildFlowPlanInput): FlowPlanDraft {
  const legacy = buildLegacyFlowPlanDraft({
    bundle,
    uiSpec,
    interactionSupplement: interactionSupplement
      ? toLegacyInteractionSupplement(interactionSupplement)
      : undefined,
  });
  return fromLegacyDraft(
    legacy,
    figmaInteractionSource ??
      (interactionSupplement || hasFigmaPrototypeInteractions(legacy)
        ? "present"
        : "absent"),
  );
}

export function generateFlowConfirmationQuestions(
  flowPlan: FlowPlanDraft,
): FlowPlanDraft {
  const legacy = generateLegacyConfirmationQuestions(
    toLegacyDraft(flowPlan),
  );
  return parseFlowPlanDraft({
    ...flowPlan,
    interactions: legacy.interactions,
    confirmationQuestions: legacy.confirmationQuestions,
    report: recomputeFlowPlanReport({
      ...flowPlan,
      interactions: legacy.interactions,
      report: flowPlan.report,
    }),
  });
}

export function applyFlowConfirmations(
  flowPlan: FlowPlanDraft | FlowPlan,
  rawAnswers: unknown,
  appliedAt = nowIso(),
): FlowPlanDraft {
  const inputs = flowConfirmationInputsSchema.parse(rawAnswers);
  const legacyInputs = inputs.map((answer) => ({
    questionId: answer.questionId,
    value: answer.value,
  }));
  const legacy = applyLegacyConfirmations(
    toLegacyDraft(flowPlan),
    legacyInputs,
  );
  const answerByQuestion = new Map(
    inputs.map((answer) => [answer.questionId, answer]),
  );
  const existingKeys = new Set(
    flowPlan.confirmations.map(
      (answer) => `${answer.questionId}:${answer.value}`,
    ),
  );
  const confirmations: FlowConfirmationAnswer[] = [
    ...flowPlan.confirmations,
  ];

  for (const question of flowPlan.confirmationQuestions) {
    const answer = answerByQuestion.get(question.id);
    if (!answer) {
      continue;
    }
    const legacyInteraction = legacy.interactions.find(
      (interaction) => interaction.confirmationQuestionId === question.id,
    );
    const result =
      answer.value === "static"
        ? "declined"
        : legacyInteraction?.source === "user_confirmed" &&
            legacyInteraction.confirmed
          ? "applied"
          : "invalid";
    const key = `${answer.questionId}:${answer.value}`;
    if (!existingKeys.has(key)) {
      confirmations.push({
        questionId: answer.questionId,
        value: answer.value,
        reason: answer.reason,
        appliedAt,
        result,
      });
      existingKeys.add(key);
    }
  }

  const next = {
    ...flowPlan,
    interactions: legacy.interactions as FlowPlanInteraction[],
    confirmationQuestions: legacy.confirmationQuestions,
    confirmations,
  };
  return parseFlowPlanDraft({
    ...next,
    report: recomputeFlowPlanReport({
      ...next,
      report: flowPlan.report,
    }),
  });
}

export function flowPlanServiceSummary(
  flowPlan: FlowPlanDraft | FlowPlan,
): FlowPlanServiceSummary {
  return {
    flowPlanSummary: summarizeFlowPlan(flowPlan),
    confirmationQuestions: flowPlan.confirmationQuestions,
    unresolvedInteractionCount:
      flowPlan.report.unresolvedInteractionCount,
  };
}
