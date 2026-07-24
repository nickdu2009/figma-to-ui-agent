import { Type, type TSchema } from "typebox";
import { z } from "zod";

import {
  figmaDesignUrlSchema,
  figmaNodeIdSchema,
  parseFigmaDesignUrl,
  resolveFigmaTargetNodes,
} from "../figma/url.ts";
import { projectIdSchema, PROJECT_ID_PATTERN } from "../project-store/project-id.ts";
import {
  safeRelativePathSchema,
  SCHEMA_VERSION,
} from "../project-store/schemas.ts";
import {
  type UISpecDraft,
  uiSpecDraftSchema,
  uiSpecSchema,
} from "../ui-spec/schema.ts";
import { variablesCapabilitySchema } from "../design-bundle/schema.ts";

const idSchema = z.string().min(1).max(256);
const idListSchema = z.array(idSchema).max(1_000);

const inspectViewportSchema = z
  .object({
    name: z.string().min(1).max(64),
    width: z.number().int().min(240).max(8_192),
    height: z.number().int().min(240).max(8_192),
    deviceScaleFactor: z.number().min(1).max(4).optional(),
  })
  .strict();

export const inspectFigmaInputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    figmaUrl: figmaDesignUrlSchema,
    targetNodes: z.array(figmaNodeIdSchema).max(100).optional(),
    viewports: z.array(inspectViewportSchema).max(16).optional(),
    behaviorNotes: z
      .array(z.string().min(1).max(2_000))
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      const parsedUrl = parseFigmaDesignUrl(value.figmaUrl);
      resolveFigmaTargetNodes(parsedUrl, value.targetNodes);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["targetNodes"],
        message: error instanceof Error ? error.message : "节点引用冲突",
      });
    }
  });

const pageSummarySchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(512),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

const toolWarningSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    detail: z.string().min(1).max(2_000),
  })
  .strict();

const unsupportedFeatureCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,127}$/);

export const unsupportedFeatureSchema = z
  .object({
    code: unsupportedFeatureCodeSchema,
    severity: z.enum([
      "must_support",
      "fallback_ok",
      "defer",
      "missing_behavior_notes",
    ]),
    evidenceSource: z.enum([
      "inspect_warning",
      "schema_limit",
      "renderer_limit",
      "validation_artifact",
    ]),
    figmaNodeRefs: z.array(idSchema).max(1_000).optional(),
    uiSpecNodeRefs: z.array(idSchema).max(1_000).optional(),
    impact: z
      .array(
        z.enum([
          "visual",
          "interaction",
          "responsive",
          "accessibility",
          "behavior",
        ]),
      )
      .min(1)
      .max(5),
    recommendedAction: z.enum([
      "extend_schema",
      "extend_renderer",
      "allow_local_fallback",
      "request_behavior_notes",
      "defer",
    ]),
  })
  .strict();

const unsupportedFeaturesSchema = z
  .array(unsupportedFeatureSchema)
  .max(10_000);

export const inspectFigmaOutputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    designBundleRevision: z.number().int().positive(),
    pages: z.array(pageSummarySchema).max(1_000),
    variables: variablesCapabilitySchema,
    warnings: z.array(toolWarningSchema).max(10_000),
  })
  .strict();

export const loadUISpecInputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    revision: z.number().int().positive().optional(),
  })
  .strict();

export const loadUISpecOutputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    revision: z.number().int().positive(),
    uiSpec: uiSpecSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.projectId !== value.uiSpec.projectId ||
      value.revision !== value.uiSpec.revision
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["uiSpec"],
        message: "返回包装与 UISpec 的项目或修订不一致",
      });
    }
  });

export const saveUISpecInputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    uiSpec: uiSpecDraftSchema,
    baseRevision: z.number().int().nonnegative(),
    reason: z.string().min(1).max(1_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.projectId !== value.uiSpec.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["uiSpec", "projectId"],
        message: "工具输入与 UISpec 的 projectId 不一致",
      });
    }
  });

export const saveUISpecOutputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    revision: z.number().int().positive(),
    validation: z
      .object({
        schemaValid: z.literal(true),
        referencesValid: z.literal(true),
        warningCount: z.number().int().nonnegative(),
      })
      .strict(),
    unsupportedFeatures: unsupportedFeaturesSchema.optional(),
  })
  .strict();

const comparisonSchema = z
  .object({
    maxDiffPixelRatio: z.number().min(0).max(1),
    maxDiffPixels: z.number().int().nonnegative(),
    timeoutMs: z.number().int().min(1_000).max(120_000),
  })
  .strict();

export const renderAndCompareInputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    pageIds: idListSchema.optional(),
    viewportIds: idListSchema.optional(),
    behaviorFixtureIds: idListSchema.optional(),
    comparison: comparisonSchema,
  })
  .strict();

const localhostUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "::1")
    );
  }, "Preview URL 必须指向无凭据的 localhost HTTP 地址");

const runArtifactPathSchema = safeRelativePathSchema.refine(
  (value) =>
    /^runs\/[A-Za-z0-9_-]{1,128}\/(?:screenshots|diffs)\/[^/]+$/.test(
      value,
    ),
  "验证产物必须位于当前项目 runs 目录",
);

const validationCheckSchema = z
  .object({
    kind: z.enum(["functional", "keyboard", "console", "visual"]),
    passed: z.boolean(),
    message: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const renderAndCompareOutputSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    projectId: projectIdSchema,
    runId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    previewUrl: localhostUrlSchema,
    passed: z.boolean(),
    results: z
      .array(
        z
          .object({
            pageId: idSchema,
            viewportId: idSchema,
            checks: z.array(validationCheckSchema).min(1).max(1_000),
            expectedImage: runArtifactPathSchema,
            actualImage: runArtifactPathSchema,
            diffImage: runArtifactPathSchema.optional(),
            diffPixelCount: z.number().int().nonnegative(),
            diffPixelRatio: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(10_000),
    unsupportedFeatures: unsupportedFeaturesSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const checksPassed = value.results.every((result) =>
      result.checks.every((check) => check.passed),
    );
    if (value.passed !== checksPassed) {
      ctx.addIssue({
        code: "custom",
        path: ["passed"],
        message: "总体结果必须与所有检查结果一致",
      });
    }
  });

function unsafeTypeboxFromZod<T>(
  schema: z.ZodType<T>,
): TSchema {
  const { $schema: _schemaDeclaration, ...jsonSchema } = z.toJSONSchema(
    schema,
    {
      target: "draft-7",
      unrepresentable: "any",
    },
  );
  return Type.Unsafe<T>(
    jsonSchema,
  );
}

const typeboxProjectId = Type.String({
  pattern: PROJECT_ID_PATTERN,
  minLength: 1,
  maxLength: 64,
});
const typeboxSchemaVersion = Type.Literal(SCHEMA_VERSION);

export const inspectFigmaParameters = Type.Object(
  {
    schemaVersion: typeboxSchemaVersion,
    projectId: typeboxProjectId,
    figmaUrl: Type.String({
      minLength: 1,
      maxLength: 2_048,
      description:
        "完整 HTTPS Figma design URL，必须逐字符复制用户输入，不要缩短、翻译、改写或删除 node-id 查询参数。",
    }),
    targetNodes: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
        maxItems: 100,
        description:
          "可选 Figma 节点 ID 字符串数组，仅当用户明确提供目标节点时填写；接受 123:456 或 123-456。",
      }),
    ),
    viewports: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: Type.String({ minLength: 1, maxLength: 64 }),
            width: Type.Integer({ minimum: 240, maximum: 8_192 }),
            height: Type.Integer({ minimum: 240, maximum: 8_192 }),
            deviceScaleFactor: Type.Optional(
              Type.Number({ minimum: 1, maximum: 4 }),
            ),
          },
          { additionalProperties: false },
        ),
        { maxItems: 16 },
      ),
    ),
    behaviorNotes: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
        maxItems: 100,
      }),
    ),
  },
  { additionalProperties: false },
);

export const loadUISpecParameters = Type.Object(
  {
    schemaVersion: typeboxSchemaVersion,
    projectId: typeboxProjectId,
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const saveUISpecParameters = Type.Object(
  {
    schemaVersion: typeboxSchemaVersion,
    projectId: typeboxProjectId,
    uiSpec: unsafeTypeboxFromZod<UISpecDraft>(uiSpecDraftSchema),
    baseRevision: Type.Integer({ minimum: 0 }),
    reason: Type.String({ minLength: 1, maxLength: 1_000 }),
  },
  { additionalProperties: false },
);

export const renderAndCompareParameters = Type.Object(
  {
    schemaVersion: typeboxSchemaVersion,
    projectId: typeboxProjectId,
    pageIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        maxItems: 1_000,
      }),
    ),
    viewportIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        maxItems: 1_000,
      }),
    ),
    behaviorFixtureIds: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        maxItems: 1_000,
      }),
    ),
    comparison: Type.Object(
      {
        maxDiffPixelRatio: Type.Number({ minimum: 0, maximum: 1 }),
        maxDiffPixels: Type.Integer({ minimum: 0 }),
        timeoutMs: Type.Integer({ minimum: 1_000, maximum: 120_000 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type InspectFigmaInput = z.infer<
  typeof inspectFigmaInputSchema
>;
export type InspectFigmaOutput = z.infer<
  typeof inspectFigmaOutputSchema
>;
export type LoadUISpecInput = z.infer<
  typeof loadUISpecInputSchema
>;
export type LoadUISpecOutput = z.infer<
  typeof loadUISpecOutputSchema
>;
export type SaveUISpecInput = z.infer<
  typeof saveUISpecInputSchema
>;
export type SaveUISpecOutput = z.infer<
  typeof saveUISpecOutputSchema
>;
export type UnsupportedFeature = z.infer<
  typeof unsupportedFeatureSchema
>;
export type RenderAndCompareInput = z.infer<
  typeof renderAndCompareInputSchema
>;
export type RenderAndCompareOutput = z.infer<
  typeof renderAndCompareOutputSchema
>;
