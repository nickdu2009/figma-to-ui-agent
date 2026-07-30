import { z } from "zod";

import { projectIdSchema } from "../project-store/project-id.ts";

const idSchema = z.string().min(1).max(256);
const reasonSchema = z.string().min(1).max(2_000);
const scalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
]);

export const FLOW_PLAN_DRAFT_SCHEMA_VERSION = "m4-spike";

export const flowInteractionSourceSchema = z.enum([
  "figma",
  "inferred",
  "user_confirmed",
  "missing",
]);
export const flowPageRoleSchema = z.enum([
  "entry",
  "screen",
  "state",
  "component",
  "unknown",
]);
export const flowConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
]);
export const flowTriggerSchema = z.enum([
  "click",
  "hover",
  "timeout",
  "submit",
  "unknown",
]);
export const flowIntentSchema = z.enum([
  "navigate",
  "set_state",
  "open_dialog",
  "submit",
  "unknown",
]);
export const interactionSupplementRawSourceSchema = z.enum([
  "figma_rest_probe",
  "fixture",
  "manual",
]);

export const flowPostconditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("expect_page"),
      pageId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_visible"),
      nodeId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_text"),
      nodeId: idSchema,
      text: z.string().max(100_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_value"),
      nodeId: idSchema,
      value: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_checked"),
      nodeId: idSchema,
      checked: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("expect_selected"),
      nodeId: idSchema,
      value: z.string().min(1).max(1_000),
    })
    .strict(),
]);

export const flowPlanPageSchema = z
  .object({
    id: idSchema,
    sourcePageId: idSchema,
    name: z.string().min(1).max(512),
    role: flowPageRoleSchema,
    confidence: flowConfidenceSchema,
    reason: reasonSchema,
  })
  .strict();

export const flowPlanInteractionSchema = z
  .object({
    id: idSchema,
    source: flowInteractionSourceSchema,
    sourceNodeId: idSchema.optional(),
    uiNodeId: idSchema.optional(),
    sourceNodeName: z.string().min(1).max(512).optional(),
    trigger: flowTriggerSchema.optional(),
    intent: flowIntentSchema,
    fromPageId: idSchema.optional(),
    targetNodeId: idSchema.optional(),
    targetPageId: idSchema.optional(),
    stateKey: idSchema.optional(),
    dialogNodeId: idSchema.optional(),
    value: scalarSchema.optional(),
    stateInitialValue: scalarSchema.optional(),
    postconditions: z.array(flowPostconditionSchema).max(100).optional(),
    stateMachineTransitionId: idSchema.optional(),
    confirmationQuestionId: idSchema.optional(),
    confirmed: z.boolean(),
    confidence: flowConfidenceSchema,
    reason: reasonSchema,
    blockedReason: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const confirmationQuestionSchema = z
  .object({
    id: idSchema,
    interactionId: idSchema,
    question: z.string().min(1).max(2_000),
    options: z
      .array(
        z
          .object({
            label: z.string().min(1).max(512),
            value: z.string().min(1).max(512),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    required: z.boolean(),
  })
  .strict();

const flowPlanReportSchema = z
  .object({
    unsupportedCount: z.number().int().nonnegative(),
    unresolvedInteractionCount: z.number().int().nonnegative(),
    convertedActionCount: z.number().int().nonnegative(),
    behaviorFixtureCount: z.number().int().nonnegative(),
  })
  .strict();

export const flowPlanDraftSchema = z
  .object({
    schemaVersion: z.literal(FLOW_PLAN_DRAFT_SCHEMA_VERSION),
    projectId: projectIdSchema,
    sourceDesignBundleRevision: z.number().int().positive(),
    sourceUISpecRevision: z.number().int().positive().optional(),
    pages: z.array(flowPlanPageSchema).max(1_000),
    interactions: z.array(flowPlanInteractionSchema).max(10_000),
    confirmationQuestions: z
      .array(confirmationQuestionSchema)
      .max(10_000),
    report: flowPlanReportSchema,
  })
  .strict();

export const interactionSupplementSchema = z
  .object({
    schemaVersion: z.literal(FLOW_PLAN_DRAFT_SCHEMA_VERSION),
    projectId: projectIdSchema,
    sourceDesignBundleRevision: z.number().int().positive(),
    rawSource: interactionSupplementRawSourceSchema,
    interactions: z
      .array(
        z
          .object({
            id: idSchema.optional(),
            sourceNodeId: idSchema.optional(),
            uiNodeId: idSchema.optional(),
            sourceNodeName: z.string().min(1).max(512).optional(),
            trigger: flowTriggerSchema.default("unknown"),
            actionType: z
              .enum(["node", "back", "url", "overlay", "unknown"])
              .default("unknown"),
            targetNodeId: idSchema.optional(),
            targetPageId: idSchema.optional(),
            rawSource: interactionSupplementRawSourceSchema.optional(),
            stateKey: idSchema.optional(),
            dialogNodeId: idSchema.optional(),
            value: scalarSchema.optional(),
            stateInitialValue: scalarSchema.optional(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();

export const confirmationAnswerSchema = z
  .union([
    z
      .object({
        questionId: idSchema,
        value: z.string().min(1).max(512),
      })
      .strict(),
    z
      .object({
        questionId: idSchema,
        answer: z.string().min(1).max(512),
      })
      .strict()
      .transform((value) => ({
        questionId: value.questionId,
        value: value.answer,
      })),
  ]);

export const confirmationAnswersSchema = z
  .array(confirmationAnswerSchema)
  .max(10_000);

export type FlowInteractionSource = z.infer<
  typeof flowInteractionSourceSchema
>;
export type FlowPageRole = z.infer<typeof flowPageRoleSchema>;
export type FlowConfidence = z.infer<typeof flowConfidenceSchema>;
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export type FlowIntent = z.infer<typeof flowIntentSchema>;
export type FlowPlanPage = z.infer<typeof flowPlanPageSchema>;
export type FlowPlanInteraction = z.infer<
  typeof flowPlanInteractionSchema
>;
export type FlowPostcondition = z.infer<typeof flowPostconditionSchema>;
export type ConfirmationQuestion = z.infer<
  typeof confirmationQuestionSchema
>;
export type FlowPlanDraft = z.infer<typeof flowPlanDraftSchema>;
export type InteractionSupplement = z.infer<
  typeof interactionSupplementSchema
>;
export type ConfirmationAnswer = z.infer<
  typeof confirmationAnswerSchema
>;

export function parseFlowPlanDraft(raw: unknown): FlowPlanDraft {
  return flowPlanDraftSchema.parse(raw);
}

export function summarizeFlowPlanDraft(
  draft: Pick<
    FlowPlanDraft,
    "interactions" | "confirmationQuestions" | "report"
  >,
) {
  const bySource = {
    figma: 0,
    inferred: 0,
    user_confirmed: 0,
    missing: 0,
  };
  for (const interaction of draft.interactions) {
    bySource[interaction.source] += 1;
  }
  return {
    interactionCount: draft.interactions.length,
    confirmationQuestionCount: draft.confirmationQuestions.length,
    bySource,
    ...draft.report,
  };
}

export function recomputeFlowPlanReport(
  draft: Pick<FlowPlanDraft, "interactions" | "report">,
): FlowPlanDraft["report"] {
  return {
    unsupportedCount: draft.interactions.filter(
      (interaction) => interaction.intent === "unknown",
    ).length,
    unresolvedInteractionCount: draft.interactions.filter(
      (interaction) =>
        interaction.source === "inferred" ||
        interaction.source === "missing",
    ).length,
    convertedActionCount: draft.report.convertedActionCount,
    behaviorFixtureCount: draft.report.behaviorFixtureCount,
  };
}
