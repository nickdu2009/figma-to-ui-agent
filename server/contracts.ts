import { z } from "zod";

/**
 * 四工具的共享 Schema 契约（计划 §5）：
 * get_current_spec / summarize_current_app / ask_question / generate_spec，
 * 以及协议内部的 await_apply_result 收尾结果。
 */

/** 命名的权威计划契约（ask_question 可选携带）。 */
export const appPlanSchema = z.object({
  goal: z.string().min(1),
  pages: z.array(z.string().min(1)).min(1),
  structure: z.array(z.string().min(1)).min(1),
  style: z.string().min(1),
});
export type AppPlan = z.infer<typeof appPlanSchema>;

export const questionOptionSchema = z.object({
  value: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(240).optional(),
  recommended: z.boolean().optional(),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const questionSchema = z.object({
  id: z.string().min(1).max(80),
  header: z.string().min(1).max(80),
  question: z.string().min(1).max(320),
  options: z.array(questionOptionSchema).min(1).max(5),
  allowCustom: z.boolean().optional(),
  allowSkip: z.boolean().optional(),
});
export type AskQuestion = z.infer<typeof questionSchema>;

/**
 * 类似 Codex question 的输入：模型最多向用户提出十二道题。questionSetId 由
 * 服务端签发，模型不得提供；它仅用于后续 approved_plan 的受控关联。
 */
export const askQuestionInputSchema = z.object({
  message: z.string().min(1).max(1_200),
  questionSetId: z.string().min(1),
  questions: z.array(questionSchema).min(1).max(12),
  plan: appPlanSchema.optional(),
});
export type AskQuestionInput = z.infer<typeof askQuestionInputSchema>;

export const askQuestionAnswerSchema = z.object({
  questionId: z.string().min(1).max(80),
  value: z.string().min(1).max(80),
  text: z.string().min(1).max(1_000).optional(),
});
export const askQuestionResultSchema = z.object({
  answers: z.array(askQuestionAnswerSchema).min(1).max(12),
});
export type AskQuestionResult = z.infer<typeof askQuestionResultSchema>;

/** get_current_spec 输出。 */
export const currentSpecResultSchema = z.object({
  hasCurrentSpec: z.boolean(),
  spec: z.unknown().nullable(),
  revision: z.number().nullable(),
});
export type CurrentSpecResult = z.infer<typeof currentSpecResultSchema>;

/** summarize_current_app 输出。 */
export const appSummarySchema = z.object({
  title: z.string().optional(),
  routes: z.array(
    z.object({
      path: z.string(),
      title: z.string().optional(),
      root: z.string(),
      mainElements: z.array(z.string()),
    }),
  ),
  navigation: z.object({
    labels: z.array(z.string()),
    hrefs: z.array(z.string()),
  }),
});
export type AppSummary = z.infer<typeof appSummarySchema>;

/**
 * generate_spec 输入。target 为判别联合：创建只能是 empty；
 * 编辑必须同时携带 currentSpec 与 baseRevision。
 * currentSpec 在此处保持 unknown，由 generate-spec-tool 用运行时 schema 二次校验。
 */
export const generateSpecInputSchema = z.object({
  request: z.string().min(1),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("approved_plan"),
      questionSetId: z.string().min(1),
    }),
    z.object({ kind: z.literal("direct_edit") }),
  ]),
  target: z.discriminatedUnion("base", [
    z.object({ base: z.literal("empty") }),
    z.object({
      base: z.literal("current"),
      baseRevision: z.number().int().nonnegative(),
      currentSpec: z.unknown(),
    }),
  ]),
});
export type GenerateSpecInput = z.infer<typeof generateSpecInputSchema>;

export const generateSpecOutputSchema = z.object({
  status: z.literal("patch_streaming"),
  generationId: z.string().min(1),
});
export type GenerateSpecOutput = z.infer<typeof generateSpecOutputSchema>;

/**
 * spec-generator 私有工具 emit_patch_operations 的输入。模型绝不直接输出
 * JSONL 文本：每次调用提交一小批结构化 RFC 6902 operation，由服务端验证并
 * 负责 JSONL 序列化，避免漏换行或半截 JSON 流到浏览器。
 */
const patchValueSchema = z.unknown();
export const jsonPatchOperationInputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: z.string(), value: patchValueSchema }),
  z.object({ op: z.literal("remove"), path: z.string() }),
  z.object({
    op: z.literal("replace"),
    path: z.string(),
    value: patchValueSchema,
  }),
  z.object({ op: z.literal("move"), path: z.string(), from: z.string() }),
  z.object({ op: z.literal("copy"), path: z.string(), from: z.string() }),
  z.object({
    op: z.literal("test"),
    path: z.string(),
    value: patchValueSchema,
  }),
]);
export const emitPatchOperationsInputSchema = z.object({
  operations: z.array(jsonPatchOperationInputSchema).min(1).max(12),
});
export type EmitPatchOperationsInput = z.infer<
  typeof emitPatchOperationsInputSchema
>;

export const emitPatchOperationsOutputSchema = z.object({
  acceptedOperations: z.number().int().positive(),
  totalOperations: z.number().int().positive(),
});

/** spec-generator 私有收尾校验工具：不接收客户端数据，只返回有界诊断。 */
export const validatePatchGenerationInputSchema = z.object({});
export const validatePatchGenerationOutputSchema = z.object({
  valid: z.boolean(),
  error: z.string().max(320).optional(),
});

/** await_apply_result：协议内部收尾，非模型可选工具。 */
export const awaitApplyResultInputSchema = z.object({
  generationId: z.string().min(1),
});
export type AwaitApplyResultInput = z.infer<typeof awaitApplyResultInputSchema>;

export const applyResultSchema = z.object({
  generationId: z.string().min(1),
  status: z.enum(["committed", "failed", "aborted"]),
  revision: z.number().optional(),
  error: z.string().optional(),
});
export type ApplyResult = z.infer<typeof applyResultSchema>;

/** spec.patch.* CUSTOM 事件的 value 契约。 */
export const specPatchEventValueSchema = z.object({
  generationId: z.string().min(1),
  text: z.string().optional(),
  error: z.string().optional(),
});
export type SpecPatchEventValue = z.infer<typeof specPatchEventValueSchema>;

export const SPEC_PATCH_EVENT_NAMES = {
  start: "spec.patch.start",
  delta: "spec.patch.delta",
  finish: "spec.patch.finish",
  error: "spec.patch.error",
} as const;

// ---------- S2：认证、应用与成员 API 契约 ----------

export const authStartInputSchema = z.object({
  email: z.string().email().max(320),
  method: z.enum(["otp", "magic_link"]),
});
export type AuthStartInput = z.infer<typeof authStartInputSchema>;

export const authVerifyInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("otp"),
    email: z.string().email().max(320),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({
    method: z.literal("magic_link"),
    token: z.string().min(1).max(512),
  }),
]);
export type AuthVerifyInput = z.infer<typeof authVerifyInputSchema>;

export const sessionUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  isAdmin: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const createAppInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateAppInput = z.infer<typeof createAppInputSchema>;

export const createInvitationInputSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["editor", "viewer"]),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

export const appListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  myRole: z.enum(["owner", "editor", "viewer"]),
  myMembershipId: z.string().min(1),
  revision: z.number().int(),
});
export type AppListItem = z.infer<typeof appListItemSchema>;

export const memberSummarySchema = z.object({
  membershipId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "editor", "viewer"]),
  createdAt: z.string().min(1),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;

export const invitationSummarySchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.enum(["editor", "viewer"]),
  status: z.enum(["open", "accepted", "revoked", "expired"]),
  expiresAt: z.string().min(1),
});
export type InvitationSummary = z.infer<typeof invitationSummarySchema>;
