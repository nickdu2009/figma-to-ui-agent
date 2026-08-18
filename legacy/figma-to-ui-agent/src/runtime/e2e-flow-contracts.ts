import { z } from "zod";

import { figmaDesignUrlSchema, figmaNodeIdSchema } from "../figma/url.ts";
import { projectIdSchema } from "../project-store/project-id.ts";
import { SCHEMA_VERSION } from "../project-store/schemas.ts";

export const m7RunModeSchema = z.enum([
  "local",
  "restricted-live",
  "live",
]);

export const m7DesignBundleRevisionSourceSchema = z.enum([
  "explicit",
  "current",
  "generated",
]);

export const m7RunErrorCategorySchema = z.enum([
  "input_invalid",
  "auth_missing",
  "figma_permission_denied",
  "figma_rate_limited",
  "figma_not_found",
  "bundle_generation_failed",
  "static_generation_partial",
  "render_compare_failed",
  "validation_failed",
  "internal_error",
]);

export const m7RunErrorSchema = z
  .object({
    category: m7RunErrorCategorySchema,
    message: z.string().min(1).max(2_000),
    recoverable: z.boolean(),
    nextAction: z.string().min(1).max(2_000),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const m7RunRequestSchema = z
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
    designBundleRevision: z.number().int().positive().optional(),
    mode: m7RunModeSchema.default("local"),
    runLabel: z.string().min(1).max(128).optional(),
    viewportIds: z.array(z.string().min(1).max(256)).max(16).optional(),
    threshold: z
      .object({
        pixelDiffPercent: z.number().finite().min(0).max(100).optional(),
        warningDiffPercent: z.number().finite().min(0).max(100).optional(),
      })
      .strict()
      .optional(),
    gates: z
      .object({
        allowFigmaNetwork: z.boolean().optional(),
        allowOpenAI: z.boolean().optional(),
        allowAssetBackfill: z.boolean().optional(),
      })
      .strict()
      .optional(),
    reportRoot: z.string().min(1).max(2_048).optional(),
    dataRoot: z.string().min(1).max(2_048).optional(),
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
    runCompare: z.boolean().optional(),
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
    if (value.mode !== "local" && !value.figmaUrl && !value.fileKey) {
      ctx.addIssue({
        code: "custom",
        path: ["figmaUrl"],
        message: "restricted-live/live 模式必须提供 figmaUrl 或 fileKey",
      });
    }
  });

export const m7RunStepSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    status: z.enum(["passed", "failed", "skipped"]),
    message: z.string().min(1).max(2_000),
  })
  .strict();

export const m7RunResultSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    ok: z.boolean(),
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    projectId: projectIdSchema.optional(),
    input: z
      .object({
        figmaUrl: figmaDesignUrlSchema.optional(),
        fileKey: z.string().min(8).max(128).optional(),
        nodeId: figmaNodeIdSchema.optional(),
        designBundleRevision: z.number().int().positive().optional(),
        designBundleRevisionSource:
          m7DesignBundleRevisionSourceSchema.optional(),
        mode: m7RunModeSchema.optional(),
      })
      .strict(),
    artifacts: z
      .object({
        designBundleRef: z.string().min(1).max(512).optional(),
        uiSpecRef: z.string().min(1).max(512).optional(),
        generatedAppRef: z.string().min(1).max(512).optional(),
        validationRef: z.string().min(1).max(512).optional(),
        summaryJson: z.string().min(1).max(2_048),
        summaryMarkdown: z.string().min(1).max(2_048),
      })
      .strict(),
    metrics: z
      .object({
        pages: z.number().int().nonnegative(),
        passedPages: z.number().int().nonnegative().optional(),
        maxPixelDiffPercent: z.number().finite().min(0).max(100).optional(),
        averagePixelDiffPercent: z
          .number()
          .finite()
          .min(0)
          .max(100)
          .optional(),
        warnings: z.number().int().nonnegative(),
        unsupported: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    validation: z
      .object({
        status: z.enum(["passed", "failed", "skipped"]),
        reason: z.string().min(1).max(2_000).optional(),
      })
      .strict()
      .optional(),
    steps: z.array(m7RunStepSchema).max(100),
    error: m7RunErrorSchema.optional(),
    nextAction: z.string().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ok && value.error) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "成功结果不能包含错误对象",
      });
    }
    if (!value.ok && !value.error) {
      ctx.addIssue({
        code: "custom",
        path: ["error"],
        message: "失败结果必须包含错误对象",
      });
    }
  });

export type M7RunMode = z.infer<typeof m7RunModeSchema>;
export type M7DesignBundleRevisionSource = z.infer<
  typeof m7DesignBundleRevisionSourceSchema
>;
export type M7RunErrorCategory = z.infer<typeof m7RunErrorCategorySchema>;
export type M7RunError = z.infer<typeof m7RunErrorSchema>;
export type M7RunRequest = z.infer<typeof m7RunRequestSchema>;
export type M7RunStep = z.infer<typeof m7RunStepSchema>;
export type M7RunResult = z.infer<typeof m7RunResultSchema>;

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|password|secret|token|api[_-]?key|figma[_-]?api[_-]?key|openai[_-]?api[_-]?key)/i;
const TOKEN_VALUE_PATTERN =
  /\b(?:figd_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,})\b/g;

export function redactM7Secrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replaceAll(TOKEN_VALUE_PATTERN, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactM7Secrets(entry));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[redacted]"
        : redactM7Secrets(entry);
    }
    return output;
  }
  return value;
}

export function m7ExitCode(result: M7RunResult): number {
  if (result.ok) {
    return 0;
  }
  switch (result.error?.category) {
    case "input_invalid":
      return 2;
    case "auth_missing":
    case "figma_permission_denied":
    case "figma_not_found":
      return 3;
    case "figma_rate_limited":
      return 4;
    case "validation_failed":
    case "render_compare_failed":
      return 5;
    default:
      return 1;
  }
}
