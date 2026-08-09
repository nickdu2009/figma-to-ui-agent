import { z } from "zod";

import { figmaDesignUrlSchema, figmaNodeIdSchema } from "../figma/url.ts";
import { projectIdSchema } from "../project-store/project-id.ts";
import { SCHEMA_VERSION } from "../project-store/schemas.ts";

export const productM9RunModeSchema = z.enum(["local", "restricted-live"]);

export const productM9StatusSchema = z.enum(["passed", "partial", "failed"]);

export const productM9StageStatusSchema = z.enum([
  "passed",
  "partial",
  "failed",
  "skipped",
]);

export const productM9ErrorCategorySchema = z.enum([
  "input_invalid",
  "auth_missing",
  "figma_rate_limited",
  "figma_permission_denied",
  "figma_not_found",
  "artifact_missing",
  "needs_confirmation",
  "unsupported_figma_action",
  "flow_execution_failed",
  "partial_evidence",
  "internal_error",
]);

export const productM9RetryPolicySchema = z.enum([
  "do_not_retry",
  "retry_after_fix",
  "retry_after_wait",
  "manual_review",
]);

const pathRefSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/.test(value),
    "artifact ref 不能是绝对路径",
  );

export const productM9RunRequestSchema = z
  .object({
    figmaUrl: figmaDesignUrlSchema.optional(),
    fileKey: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
    nodeId: figmaNodeIdSchema.optional(),
    projectId: projectIdSchema,
    mode: productM9RunModeSchema.default("local"),
    flowPlanPath: pathRefSchema.optional(),
    uiSpecPath: pathRefSchema.optional(),
    answersPath: pathRefSchema.optional(),
    confirmedFlowPlanPath: pathRefSchema.optional(),
    dataRoot: z.string().min(1).max(2_048).optional(),
    reportRoot: z.string().min(1).max(2_048).optional(),
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
    runCompare: z.boolean().optional(),
    gates: z
      .object({
        allowFigmaNetwork: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.figmaUrl && value.fileKey) {
      try {
        const url = new URL(value.figmaUrl);
        const urlFileKey = decodeURIComponent(
          url.pathname.split("/")[2] ?? "",
        );
        if (urlFileKey !== value.fileKey) {
          ctx.addIssue({
            code: "custom",
            path: ["fileKey"],
            message: "fileKey 与 figmaUrl 不一致",
          });
        }
      } catch {
        // figmaUrlSchema reports the actual URL error.
      }
    }
    if (value.mode === "restricted-live" && !value.figmaUrl && !value.fileKey) {
      ctx.addIssue({
        code: "custom",
        path: ["figmaUrl"],
        message: "restricted-live 模式必须提供 figmaUrl 或 fileKey",
      });
    }
  });

export const productM9StageResultSchema = z
  .object({
    status: productM9StageStatusSchema,
    message: z.string().min(1).max(2_000),
    artifactRef: pathRefSchema.optional(),
    reasonCode: z.string().min(1).max(256).optional(),
  })
  .strict();

export const productM9ArtifactRefsSchema = z
  .object({
    designBundlePath: pathRefSchema.optional(),
    uiSpecPath: pathRefSchema.optional(),
    flowPlanPath: pathRefSchema.optional(),
    confirmationQuestionsPath: pathRefSchema.optional(),
    confirmedFlowPlanPath: pathRefSchema.optional(),
    validationPath: pathRefSchema.optional(),
    summaryJson: pathRefSchema,
    summaryMarkdown: pathRefSchema,
  })
  .strict();

export const productM9MetricsSchema = z
  .object({
    trustedNavigate: z.number().int().nonnegative().optional(),
    trustedStateChange: z.number().int().nonnegative().optional(),
    submitLikeNeedsConfirmation: z.number().int().nonnegative().optional(),
    unsupported: z.number().int().nonnegative().optional(),
    missingEvidence: z.number().int().nonnegative().optional(),
    successfulFixtureIds: z.array(z.string().min(1).max(256)).optional(),
    failedFixtureIds: z.array(z.string().min(1).max(256)).optional(),
  })
  .strict();

export const productM9RunErrorSchema = z
  .object({
    category: productM9ErrorCategorySchema,
    message: z.string().min(1).max(2_000),
    recoverable: z.boolean(),
    nextAction: z.string().min(1).max(2_000),
    retryPolicy: productM9RetryPolicySchema,
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const productM9RunResultSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    ok: z.boolean(),
    status: productM9StatusSchema,
    mode: productM9RunModeSchema,
    projectId: projectIdSchema,
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    stages: z
      .object({
        inspect: productM9StageResultSchema.optional(),
        staticGeneration: productM9StageResultSchema.optional(),
        flowPlanExtraction: productM9StageResultSchema.optional(),
        confirmation: productM9StageResultSchema.optional(),
        execution: productM9StageResultSchema.optional(),
        report: productM9StageResultSchema.optional(),
      })
      .strict(),
    artifactRefs: productM9ArtifactRefsSchema,
    metrics: productM9MetricsSchema,
    error: productM9RunErrorSchema.optional(),
    nextAction: z.string().min(1).max(2_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ok && value.status !== "passed") {
      ctx.addIssue({
        code: "custom",
        path: ["ok"],
        message: "ok=true 只能用于 passed 状态",
      });
    }
    if (value.ok && value.error) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "成功结果不能包含 error",
      });
    }
    if (!value.ok && !value.error) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "partial/failed 结果必须包含 error",
      });
    }
  });

export type ProductM9RunMode = z.infer<typeof productM9RunModeSchema>;
export type ProductM9Status = z.infer<typeof productM9StatusSchema>;
export type ProductM9ErrorCategory = z.infer<
  typeof productM9ErrorCategorySchema
>;
export type ProductM9RunError = z.infer<typeof productM9RunErrorSchema>;
export type ProductM9RunRequest = z.infer<typeof productM9RunRequestSchema>;
export type ProductM9StageResult = z.infer<
  typeof productM9StageResultSchema
>;
export type ProductM9RunResult = z.infer<typeof productM9RunResultSchema>;

export const productM9AgentDecisionTable: Record<
  ProductM9ErrorCategory,
  { readonly retryPolicy: z.infer<typeof productM9RetryPolicySchema>; readonly nextAction: string }
> = {
  input_invalid: {
    retryPolicy: "retry_after_fix",
    nextAction: "修正参数、URL、projectId 或 artifact ref 后重试。",
  },
  auth_missing: {
    retryPolicy: "retry_after_fix",
    nextAction: "补齐 Figma gate/token，或改用 local 模式。",
  },
  figma_rate_limited: {
    retryPolicy: "retry_after_wait",
    nextAction: "等待 Retry-After 或降低请求频率后重试。",
  },
  figma_permission_denied: {
    retryPolicy: "manual_review",
    nextAction: "检查 Figma token 权限和文件访问权限。",
  },
  figma_not_found: {
    retryPolicy: "retry_after_fix",
    nextAction: "检查 Figma URL、fileKey 或 nodeId 后重试。",
  },
  artifact_missing: {
    retryPolicy: "retry_after_fix",
    nextAction: "先生成缺失 artifact，或指定正确的 FlowPlan / UISpec 路径。",
  },
  needs_confirmation: {
    retryPolicy: "manual_review",
    nextAction: "向用户展示 confirmation questions，等待结构化答案后重跑。",
  },
  unsupported_figma_action: {
    retryPolicy: "manual_review",
    nextAction: "记录 unsupported Figma action，不猜测业务逻辑。",
  },
  flow_execution_failed: {
    retryPolicy: "manual_review",
    nextAction: "查看 validation artifact，修复行为 fixture 或生成结果后重跑。",
  },
  partial_evidence: {
    retryPolicy: "manual_review",
    nextAction: "查看 partial reasons，补样本、补确认或人工复核。",
  },
  internal_error: {
    retryPolicy: "do_not_retry",
    nextAction: "上报实现缺陷，修复代码后再运行。",
  },
};

export function productM9ExitCode(result: ProductM9RunResult): number {
  if (result.ok) {
    return 0;
  }
  switch (result.error?.category) {
    case "input_invalid":
      return 2;
    case "auth_missing":
    case "figma_permission_denied":
    case "figma_not_found":
    case "artifact_missing":
      return 3;
    case "figma_rate_limited":
      return 4;
    case "flow_execution_failed":
      return 5;
    case "needs_confirmation":
    case "unsupported_figma_action":
    case "partial_evidence":
      return 6;
    default:
      return 1;
  }
}
