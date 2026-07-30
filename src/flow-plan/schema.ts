import { z } from "zod";

import { projectIdSchema } from "../project-store/project-id.ts";
import {
  isoTimestampSchema,
  SCHEMA_VERSION,
} from "../project-store/schemas.ts";

const idSchema = z.string().min(1).max(256);
const reasonSchema = z.string().min(1).max(2_000);
const scalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
]);

export const FLOW_PLAN_SCHEMA_VERSION = SCHEMA_VERSION;

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
export const flowConfidenceSchema = z.enum(["high", "medium", "low"]);
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
  "unknown",
]);
export const figmaInteractionSourceSchema = z.enum([
  "present",
  "absent",
  "unavailable",
  "not_authorized",
]);
export const interactionSupplementRawSourceSchema = z.enum([
  "figma_rest_probe",
  "fixture",
  "manual",
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
    confirmationQuestionId: idSchema.optional(),
    confirmed: z.boolean(),
    confidence: flowConfidenceSchema,
    reason: reasonSchema,
    blockedReason: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const flowConfirmationQuestionSchema = z
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

export const flowConfirmationAnswerSchema = z
  .object({
    questionId: idSchema,
    value: z.string().min(1).max(512),
    reason: z.string().min(1).max(2_000).optional(),
    appliedAt: isoTimestampSchema.optional(),
    result: z.enum(["applied", "declined", "invalid", "unmatched"]),
  })
  .strict();

export const flowPlanReportSchema = z
  .object({
    unsupportedCount: z.number().int().nonnegative(),
    unresolvedInteractionCount: z.number().int().nonnegative(),
    convertedActionCount: z.number().int().nonnegative(),
    behaviorFixtureCount: z.number().int().nonnegative(),
    confirmationCount: z.number().int().nonnegative(),
  })
  .strict();

export const interactionSupplementSchema = z
  .object({
    schemaVersion: z.literal(FLOW_PLAN_SCHEMA_VERSION),
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

const flowPlanShape = {
  schemaVersion: z.literal(FLOW_PLAN_SCHEMA_VERSION),
  projectId: projectIdSchema,
  revision: z.number().int().positive(),
  sourceDesignBundleRevision: z.number().int().positive(),
  sourceUISpecRevision: z.number().int().positive().optional(),
  figmaInteractionSource: figmaInteractionSourceSchema,
  pages: z.array(flowPlanPageSchema).max(1_000),
  interactions: z.array(flowPlanInteractionSchema).max(10_000),
  confirmationQuestions: z
    .array(flowConfirmationQuestionSchema)
    .max(10_000),
  confirmations: z.array(flowConfirmationAnswerSchema).max(10_000),
  report: flowPlanReportSchema,
};

function addDuplicateIssues(
  values: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, index],
        message: `重复标识：${value}`,
      });
    }
    seen.add(value);
  });
}

type FlowPlanReferenceValue = Omit<
  z.infer<z.ZodObject<typeof flowPlanShape>>,
  "revision"
>;

function validateFlowPlanReferences(
  value: FlowPlanReferenceValue,
  ctx: z.RefinementCtx,
): void {
  addDuplicateIssues(
    value.pages.map((page) => page.id),
    ["pages"],
    ctx,
  );
  addDuplicateIssues(
    value.interactions.map((interaction) => interaction.id),
    ["interactions"],
    ctx,
  );
  addDuplicateIssues(
    value.confirmationQuestions.map((question) => question.id),
    ["confirmationQuestions"],
    ctx,
  );

  const pageIds = new Set(value.pages.map((page) => page.id));
  const interactionIds = new Set(
    value.interactions.map((interaction) => interaction.id),
  );
  const questionIds = new Set(
    value.confirmationQuestions.map((question) => question.id),
  );

  value.interactions.forEach((interaction, index) => {
    for (const [field, pageId] of [
      ["fromPageId", interaction.fromPageId],
      ["targetPageId", interaction.targetPageId],
    ] as const) {
      if (pageId && !pageIds.has(pageId)) {
        ctx.addIssue({
          code: "custom",
          path: ["interactions", index, field],
          message: `悬空 FlowPlan 页面引用：${pageId}`,
        });
      }
    }
    if (
      interaction.confirmationQuestionId &&
      !questionIds.has(interaction.confirmationQuestionId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["interactions", index, "confirmationQuestionId"],
        message: `悬空确认问题引用：${interaction.confirmationQuestionId}`,
      });
    }
    if (
      (interaction.source === "inferred" ||
        interaction.source === "missing") &&
      interaction.confirmed
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["interactions", index, "confirmed"],
        message: "inferred/missing interaction 不能被标记为已确认",
      });
    }
  });

  value.confirmationQuestions.forEach((question, index) => {
    if (!interactionIds.has(question.interactionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmationQuestions", index, "interactionId"],
        message: `悬空 interaction 引用：${question.interactionId}`,
      });
    }
  });

  value.confirmations.forEach((answer, index) => {
    if (!questionIds.has(answer.questionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmations", index, "questionId"],
        message: `悬空确认问题引用：${answer.questionId}`,
      });
    }
  });
}

const flowPlanObjectSchema = z.object(flowPlanShape).strict();
const flowPlanDraftObjectSchema = flowPlanObjectSchema.omit({
  revision: true,
});

export const flowPlanSchema =
  flowPlanObjectSchema.superRefine(validateFlowPlanReferences);

export const flowPlanDraftSchema =
  flowPlanDraftObjectSchema.superRefine(validateFlowPlanReferences);

export const flowConfirmationInputSchema = z
  .union([
    z
      .object({
        questionId: idSchema,
        value: z.string().min(1).max(512),
        reason: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
    z
      .object({
        questionId: idSchema,
        answer: z.string().min(1).max(512),
        reason: z.string().min(1).max(2_000).optional(),
      })
      .strict()
      .transform((value) => ({
        questionId: value.questionId,
        value: value.answer,
        reason: value.reason,
      })),
  ]);

export const flowConfirmationInputsSchema = z
  .array(flowConfirmationInputSchema)
  .max(10_000);

export type FlowInteractionSource = z.infer<
  typeof flowInteractionSourceSchema
>;
export type FlowPageRole = z.infer<typeof flowPageRoleSchema>;
export type FlowConfidence = z.infer<typeof flowConfidenceSchema>;
export type FlowTrigger = z.infer<typeof flowTriggerSchema>;
export type FlowIntent = z.infer<typeof flowIntentSchema>;
export type FigmaInteractionSource = z.infer<
  typeof figmaInteractionSourceSchema
>;
export type FlowPlanPage = z.infer<typeof flowPlanPageSchema>;
export type FlowPlanInteraction = z.infer<
  typeof flowPlanInteractionSchema
>;
export type FlowConfirmationQuestion = z.infer<
  typeof flowConfirmationQuestionSchema
>;
export type FlowConfirmationAnswer = z.infer<
  typeof flowConfirmationAnswerSchema
>;
export type FlowPlanDraft = z.infer<typeof flowPlanDraftSchema>;
export type FlowPlan = z.infer<typeof flowPlanSchema>;
export type InteractionSupplement = z.infer<
  typeof interactionSupplementSchema
>;
export type FlowConfirmationInput = z.infer<
  typeof flowConfirmationInputSchema
>;

export function parseFlowPlan(raw: unknown): FlowPlan {
  return flowPlanSchema.parse(raw);
}

export function parseFlowPlanDraft(raw: unknown): FlowPlanDraft {
  return flowPlanDraftSchema.parse(raw);
}

export function summarizeFlowPlan(
  flowPlan: Pick<
    FlowPlanDraft,
    "interactions" | "confirmationQuestions" | "confirmations" | "report"
  >,
) {
  const bySource = {
    figma: 0,
    inferred: 0,
    user_confirmed: 0,
    missing: 0,
  };
  for (const interaction of flowPlan.interactions) {
    bySource[interaction.source] += 1;
  }
  return {
    interactionCount: flowPlan.interactions.length,
    confirmationQuestionCount: flowPlan.confirmationQuestions.length,
    bySource,
    ...flowPlan.report,
  };
}

export function recomputeFlowPlanReport(
  flowPlan: Pick<
    FlowPlanDraft,
    "interactions" | "confirmations" | "report"
  >,
): FlowPlanDraft["report"] {
  return {
    unsupportedCount: flowPlan.interactions.filter(
      (interaction) => interaction.intent === "unknown",
    ).length,
    unresolvedInteractionCount: flowPlan.interactions.filter(
      (interaction) =>
        interaction.source === "inferred" ||
        interaction.source === "missing" ||
        Boolean(interaction.blockedReason),
    ).length,
    convertedActionCount: flowPlan.report.convertedActionCount,
    behaviorFixtureCount: flowPlan.report.behaviorFixtureCount,
    confirmationCount: flowPlan.confirmations.length,
  };
}
