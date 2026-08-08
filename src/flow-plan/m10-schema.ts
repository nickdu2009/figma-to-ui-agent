import { z } from "zod";

import {
  flowIntentSchema,
  flowInteractionSourceSchema,
  flowPostconditionSchema,
} from "./schema.ts";

const idSchema = z.string().min(1).max(256);
const reasonSchema = z.string().min(1).max(2_000);
const artifactPathSchema = z.string().min(1).max(2_048);
const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const scalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
]);

export const flowM10QuestionKindSchema = z.enum([
  "submit_like",
  "navigate",
  "set_state",
  "open_dialog",
  "state_machine_transition",
]);

export const flowM10AnswerKindSchema = z.enum([
  "submit",
  "navigate",
  "set_state",
  "open_dialog",
  "decline",
]);

export const flowM10ClassificationSchema = z.enum([
  "needs_confirmation.submit_like",
  "missing_evidence",
  "unsupported",
]);

export const flowM10ApplyCarrierSchema = z.enum([
  "flow_plan",
  "summary_only",
]);
export const flowM10PostconditionKindSchema = z.enum([
  "expect_page",
  "expect_visible",
  "expect_text",
  "expect_value",
  "expect_checked",
  "expect_selected",
]);

const candidateRefsSchema = z
  .object({
    pageIds: z.array(idSchema).max(100).default([]),
    nodeIds: z.array(idSchema).max(100).default([]),
    stateKeys: z.array(idSchema).max(100).default([]),
    transitionIds: z.array(idSchema).max(100).default([]),
  })
  .strict();

export const flowM10ConfirmationQuestionSchema = z
  .object({
    schemaVersion: z.literal("1"),
    id: idSchema,
    interactionId: idSchema,
    sampleId: idSchema.optional(),
    source: flowInteractionSourceSchema.extract([
      "figma",
      "inferred",
      "missing",
    ]),
    classification: flowM10ClassificationSchema.optional(),
    questionKind: flowM10QuestionKindSchema,
    prompt: z.string().min(1).max(2_000),
    evidenceSummary: z.string().min(1).max(2_000),
    sourceNodeId: idSchema.optional(),
    uiNodeId: idSchema.optional(),
    fromPageId: idSchema.optional(),
    applyCarrier: flowM10ApplyCarrierSchema,
    allowedAnswerKinds: z.array(flowM10AnswerKindSchema).min(1).max(5),
    requiredPostconditions: z.enum([
      "at_least_one_observable",
      "none_allowed_for_decline_only",
    ]),
    candidateRefs: candidateRefsSchema.default(() => ({
      pageIds: [],
      nodeIds: [],
      stateKeys: [],
      transitionIds: [],
    })),
    required: z.boolean(),
  })
  .strict();

const submitEffectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("set_state"),
      stateKey: idSchema,
      value: scalarSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("navigate"),
      pageId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("open_dialog"),
      dialogNodeId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("none"),
    })
    .strict(),
]);

export const flowM10ConfirmationAnswerSchema = z.discriminatedUnion(
  "answerKind",
  [
    z
      .object({
        id: idSchema,
        questionId: idSchema,
        answerKind: z.literal("submit"),
        effect: submitEffectSchema,
        postconditions: z.array(flowPostconditionSchema).min(1).max(100),
        reason: reasonSchema.optional(),
      })
      .strict(),
    z
      .object({
        id: idSchema,
        questionId: idSchema,
        answerKind: z.literal("navigate"),
        targetPageId: idSchema,
        reason: reasonSchema.optional(),
      })
      .strict(),
    z
      .object({
        id: idSchema,
        questionId: idSchema,
        answerKind: z.literal("set_state"),
        stateKey: idSchema,
        value: scalarSchema,
        postconditions: z.array(flowPostconditionSchema).min(1).max(100),
        reason: reasonSchema.optional(),
      })
      .strict(),
    z
      .object({
        id: idSchema,
        questionId: idSchema,
        answerKind: z.literal("open_dialog"),
        dialogNodeId: idSchema,
        postconditions: z.array(flowPostconditionSchema).min(1).max(100),
        reason: reasonSchema.optional(),
      })
      .strict(),
    z
      .object({
        id: idSchema,
        questionId: idSchema,
        answerKind: z.literal("decline"),
        reason: reasonSchema,
      })
      .strict(),
  ],
);

export const flowM10ConfirmationAnswersSchema = z
  .array(flowM10ConfirmationAnswerSchema)
  .max(10_000);

export const flowM10ApplyResultSchema = z
  .object({
    answerId: idSchema,
    questionId: idSchema,
    interactionId: idSchema.optional(),
    result: z.enum(["applied", "declined", "rejected", "invalid", "unmatched"]),
    reasonCode: z.string().min(1).max(256),
    source: z.enum(["flow_plan", "summary_only", "none"]),
    intent: flowIntentSchema.optional(),
  })
  .strict();

export const flowM10NetworkBoundarySchema = z
  .object({
    figmaRestCalled: z.boolean(),
    openaiCalled: z.literal(false),
    mode: z.enum(["local", "restricted-live-regression"]),
  })
  .strict();

export const flowM10ConfirmationReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    milestone: z.literal("Flow-M10"),
    scope: z.literal("confirmation_semantics"),
    status: z.enum(["passed", "partial", "failed"]),
    input: z
      .object({
        runId: runIdSchema,
        mode: z.enum(["local", "restricted-live-regression"]),
        flowPlanRef: artifactPathSchema.optional(),
        uiSpecRef: artifactPathSchema.optional(),
        m9ReportRef: artifactPathSchema.optional(),
        answerRef: artifactPathSchema.optional(),
        networkBoundary: flowM10NetworkBoundarySchema,
      })
      .strict(),
    counts: z
      .object({
        generatedQuestions: z.number().int().nonnegative(),
        submitLikeQuestions: z.number().int().nonnegative(),
        answersReceived: z.number().int().nonnegative(),
        applied: z.number().int().nonnegative(),
        declined: z.number().int().nonnegative(),
        rejected: z.number().int().nonnegative(),
        invalid: z.number().int().nonnegative(),
        unmatched: z.number().int().nonnegative(),
        summaryOnlyQuestions: z.number().int().nonnegative(),
        userConfirmedSubmit: z.number().int().nonnegative(),
        userConfirmedStateMachineTransitions: z.number().int().nonnegative(),
      })
      .strict(),
    samples: z
      .array(
        z
          .object({
            sampleId: idSchema,
            questions: z.number().int().nonnegative(),
            summaryOnlyQuestions: z.number().int().nonnegative(),
            applied: z.number().int().nonnegative(),
            rejected: z.number().int().nonnegative(),
            residualUnresolved: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100),
    appliedInteractions: z
      .array(
        z
          .object({
            interactionId: idSchema,
            source: z.literal("user_confirmed"),
            intent: flowIntentSchema.extract([
              "submit",
              "navigate",
              "set_state",
              "open_dialog",
            ]),
            postconditionKinds: z.array(flowM10PostconditionKindSchema).optional(),
            artifactRefs: z.array(artifactPathSchema).max(100),
          })
          .strict(),
      )
      .max(10_000),
    rejections: z
      .array(
        z
          .object({
            questionId: idSchema,
            reasonCode: z.string().min(1).max(256),
            evidence: z.string().min(1).max(2_000),
          })
          .strict(),
      )
      .max(10_000),
    reasons: z.array(reasonSchema).max(1_000),
    residualRisks: z.array(reasonSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status !== "passed") {
      return;
    }
    if (value.counts.submitLikeQuestions < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "submitLikeQuestions"],
        message: "Flow-M10 passed 必须至少包含 1 个 submit-like question",
      });
    }
    if (
      value.counts.userConfirmedSubmit < 1 &&
      value.counts.userConfirmedStateMachineTransitions < 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "userConfirmedSubmit"],
        message: "Flow-M10 passed 必须至少应用 1 个用户确认 submit 或状态机 transition",
      });
    }
    if (value.counts.rejected < 1 && value.counts.invalid < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["counts", "rejected"],
        message: "Flow-M10 passed 必须至少证明 1 个非法答案被拒绝",
      });
    }
  });

export type FlowM10ConfirmationQuestion = z.infer<
  typeof flowM10ConfirmationQuestionSchema
>;
export type FlowM10ConfirmationAnswer = z.infer<
  typeof flowM10ConfirmationAnswerSchema
>;
export type FlowM10ApplyResult = z.infer<typeof flowM10ApplyResultSchema>;
export type FlowM10ConfirmationReport = z.infer<
  typeof flowM10ConfirmationReportSchema
>;

export function parseFlowM10ConfirmationReport(
  raw: unknown,
): FlowM10ConfirmationReport {
  return flowM10ConfirmationReportSchema.parse(raw);
}
