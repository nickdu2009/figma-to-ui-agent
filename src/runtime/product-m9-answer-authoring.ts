import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  flowM10AnswerKindSchema,
  flowM10ConfirmationAnswerSchema,
  flowM10ConfirmationAnswersSchema,
  flowM10ConfirmationQuestionSchema,
  type FlowM10ConfirmationAnswer,
  type FlowM10ConfirmationQuestion,
} from "../flow-plan/m10-schema.ts";
import {
  flowPostconditionSchema,
  type FlowPostcondition,
} from "../flow-plan/schema.ts";

const idSchema = z.string().min(1).max(256);
const scalarSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
]);

const confirmationQuestionsArtifactSchema = z
  .object({
    schemaVersion: z.literal("1"),
    projectId: idSchema,
    runId: idSchema,
    questionCount: z.number().int().nonnegative(),
    questions: z.array(flowM10ConfirmationQuestionSchema).max(10_000),
  })
  .strict()
  .refine((value) => value.questionCount === value.questions.length, {
    message: "questionCount must match questions.length",
    path: ["questionCount"],
  });

export const productM9AnswerAuthoringRequestSchema = z
  .object({
    questionsPath: z.string().min(1).max(2_048),
    outPath: z.string().min(1).max(2_048),
    questionIds: z.array(idSchema).max(10_000).default([]),
    all: z.boolean().default(false),
    answerKind: flowM10AnswerKindSchema,
    reason: z.string().min(1).max(2_000).optional(),
    targetPageId: idSchema.optional(),
    stateKey: idSchema.optional(),
    value: scalarSchema.optional(),
    dialogNodeId: idSchema.optional(),
    effectKind: z.enum(["set_state", "navigate", "open_dialog"]).optional(),
    postconditions: z.array(flowPostconditionSchema).max(100).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.all && value.questionIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Provide --all or at least one --question-id",
        path: ["questionIds"],
      });
    }
    if (value.all && value.questionIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "--all cannot be combined with --question-id",
        path: ["all"],
      });
    }
    if (value.answerKind === "navigate" && !value.targetPageId) {
      context.addIssue({
        code: "custom",
        message: "navigate answers require --target-page-id",
        path: ["targetPageId"],
      });
    }
    if (value.answerKind === "set_state") {
      if (!value.stateKey) {
        context.addIssue({
          code: "custom",
          message: "set_state answers require --state-key",
          path: ["stateKey"],
        });
      }
      if (value.value === undefined) {
        context.addIssue({
          code: "custom",
          message: "set_state answers require --value",
          path: ["value"],
        });
      }
      if (value.postconditions.length === 0) {
        context.addIssue({
          code: "custom",
          message: "set_state answers require at least one --postcondition",
          path: ["postconditions"],
        });
      }
    }
    if (value.answerKind === "open_dialog") {
      if (!value.dialogNodeId) {
        context.addIssue({
          code: "custom",
          message: "open_dialog answers require --dialog-node-id",
          path: ["dialogNodeId"],
        });
      }
      if (value.postconditions.length === 0) {
        context.addIssue({
          code: "custom",
          message: "open_dialog answers require at least one --postcondition",
          path: ["postconditions"],
        });
      }
    }
    if (value.answerKind === "submit") {
      if (!value.effectKind) {
        context.addIssue({
          code: "custom",
          message: "submit answers require --effect",
          path: ["effectKind"],
        });
      }
      if (value.effectKind === "set_state") {
        if (!value.stateKey) {
          context.addIssue({
            code: "custom",
            message: "submit set_state effect requires --state-key",
            path: ["stateKey"],
          });
        }
        if (value.value === undefined) {
          context.addIssue({
            code: "custom",
            message: "submit set_state effect requires --value",
            path: ["value"],
          });
        }
      }
      if (value.effectKind === "navigate" && !value.targetPageId) {
        context.addIssue({
          code: "custom",
          message: "submit navigate effect requires --target-page-id",
          path: ["targetPageId"],
        });
      }
      if (value.effectKind === "open_dialog" && !value.dialogNodeId) {
        context.addIssue({
          code: "custom",
          message: "submit open_dialog effect requires --dialog-node-id",
          path: ["dialogNodeId"],
        });
      }
      if (value.postconditions.length === 0) {
        context.addIssue({
          code: "custom",
          message: "submit answers require at least one --postcondition",
          path: ["postconditions"],
        });
      }
    }
    if (value.answerKind === "decline" && !value.reason) {
      context.addIssue({
        code: "custom",
        message: "decline answers require --reason",
        path: ["reason"],
      });
    }
  });

export type ProductM9AnswerAuthoringRequest = z.infer<
  typeof productM9AnswerAuthoringRequestSchema
>;
export type ProductM9AnswerAuthoringInput = z.input<
  typeof productM9AnswerAuthoringRequestSchema
>;

export interface ProductM9AnswerAuthoringResult {
  readonly schemaVersion: "1";
  readonly projectId: string;
  readonly runId: string;
  readonly outPath: string;
  readonly answerCount: number;
  readonly questionIds: readonly string[];
}

function answerId(index: number, questionId: string): string {
  return `answer-${index + 1}-${questionId}`.slice(0, 256);
}

function submitEffect(
  request: ProductM9AnswerAuthoringRequest,
): Extract<FlowM10ConfirmationAnswer, { answerKind: "submit" }>["effect"] {
  if (request.effectKind === "navigate") {
    return { kind: "navigate", pageId: request.targetPageId! };
  }
  if (request.effectKind === "open_dialog") {
    return { kind: "open_dialog", dialogNodeId: request.dialogNodeId! };
  }
  return {
    kind: "set_state",
    stateKey: request.stateKey!,
    value: request.value!,
  };
}

function buildAnswer(input: {
  readonly request: ProductM9AnswerAuthoringRequest;
  readonly question: FlowM10ConfirmationQuestion;
  readonly index: number;
}): FlowM10ConfirmationAnswer {
  const base = {
    id: answerId(input.index, input.question.id),
    questionId: input.question.id,
    reason: input.request.reason,
  };
  switch (input.request.answerKind) {
    case "navigate":
      return flowM10ConfirmationAnswerSchema.parse({
        ...base,
        answerKind: "navigate",
        targetPageId: input.request.targetPageId,
      });
    case "set_state":
      return flowM10ConfirmationAnswerSchema.parse({
        ...base,
        answerKind: "set_state",
        stateKey: input.request.stateKey,
        value: input.request.value,
        postconditions: input.request.postconditions,
      });
    case "open_dialog":
      return flowM10ConfirmationAnswerSchema.parse({
        ...base,
        answerKind: "open_dialog",
        dialogNodeId: input.request.dialogNodeId,
        postconditions: input.request.postconditions,
      });
    case "submit":
      return flowM10ConfirmationAnswerSchema.parse({
        ...base,
        answerKind: "submit",
        effect: submitEffect(input.request),
        postconditions: input.request.postconditions,
      });
    case "decline":
      return flowM10ConfirmationAnswerSchema.parse({
        ...base,
        answerKind: "decline",
      });
  }
}

function selectQuestions(
  questions: readonly FlowM10ConfirmationQuestion[],
  request: ProductM9AnswerAuthoringRequest,
): FlowM10ConfirmationQuestion[] {
  if (request.all) {
    return [...questions];
  }
  const byId = new Map(questions.map((question) => [question.id, question]));
  return request.questionIds.map((id) => {
    const question = byId.get(id);
    if (!question) {
      throw new Error(`question_not_found:${id}`);
    }
    return question;
  });
}

export async function authorProductM9ConfirmationAnswers(
  rawRequest: ProductM9AnswerAuthoringInput,
): Promise<ProductM9AnswerAuthoringResult> {
  const request = productM9AnswerAuthoringRequestSchema.parse(rawRequest);
  const artifact = confirmationQuestionsArtifactSchema.parse(
    JSON.parse(await readFile(request.questionsPath, "utf8")),
  );
  const questions = selectQuestions(artifact.questions, request);
  const invalidKind = questions.find(
    (question) => !question.allowedAnswerKinds.includes(request.answerKind),
  );
  if (invalidKind) {
    throw new Error(
      `answer_kind_not_allowed:${invalidKind.id}:${request.answerKind}`,
    );
  }

  const answers = flowM10ConfirmationAnswersSchema.parse(
    questions.map((question, index) =>
      buildAnswer({ request, question, index }),
    ),
  );

  await mkdir(dirname(request.outPath), { recursive: true });
  await writeFile(request.outPath, `${JSON.stringify(answers, null, 2)}\n`);
  return {
    schemaVersion: "1",
    projectId: artifact.projectId,
    runId: artifact.runId,
    outPath: request.outPath,
    answerCount: answers.length,
    questionIds: answers.map((answer) => answer.questionId),
  };
}

export function parseProductM9Scalar(value: string): string | number | boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const numeric = Number(value);
  if (value.trim() !== "" && Number.isFinite(numeric)) {
    return numeric;
  }
  return value;
}

export function parseProductM9Postcondition(value: string): FlowPostcondition {
  const [kind, first, ...rest] = value.split(":");
  if (!kind || !first) {
    throw new Error(`Invalid --postcondition: ${value}`);
  }
  if (kind === "expect_page") {
    return flowPostconditionSchema.parse({ kind, pageId: first });
  }
  if (kind === "expect_visible") {
    return flowPostconditionSchema.parse({ kind, nodeId: first });
  }
  if (kind === "expect_checked") {
    const checked = rest.join(":");
    if (checked !== "true" && checked !== "false") {
      throw new Error(`expect_checked requires true or false: ${value}`);
    }
    return flowPostconditionSchema.parse({
      kind,
      nodeId: first,
      checked: checked === "true",
    });
  }
  if (kind === "expect_text") {
    return flowPostconditionSchema.parse({
      kind,
      nodeId: first,
      text: rest.join(":"),
    });
  }
  if (kind === "expect_value") {
    return flowPostconditionSchema.parse({
      kind,
      nodeId: first,
      value: rest.join(":"),
    });
  }
  if (kind === "expect_selected") {
    return flowPostconditionSchema.parse({
      kind,
      nodeId: first,
      value: rest.join(":"),
    });
  }
  throw new Error(`Unsupported --postcondition kind: ${kind}`);
}
