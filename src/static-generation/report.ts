import { z } from "zod";

import {
  unsupportedFeatureSchema,
  type UnsupportedFeature,
} from "../tools/contracts.ts";
import {
  coverageReportSchema,
  type CoverageReport,
} from "./coverage.ts";

const idSchema = z.string().min(1).max(256);

const boundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

const regionIdSchema = z.enum([
  "left_visual",
  "form_fields",
  "cta",
  "social_buttons",
  "footer",
  "page",
]);

const pageRegionSchema = z
  .object({
    id: regionIdSchema,
    status: z.enum(["passed", "warning", "failed", "not_applicable"]),
    notes: z.array(z.string().min(1).max(2_000)).max(100),
  })
  .strict();

const contractRegionBucketSchema = z.enum([
  "visual_assets",
  "text_regions",
  "form_controls",
  "button_icon_controls",
]);

const comparisonRegionDiffSchema = z
  .object({
    id: contractRegionBucketSchema,
    label: z.string().min(1).max(128),
    bounds: boundsSchema,
    diffPixelCount: z.number().int().nonnegative(),
    diffPixelRatio: z.number().min(0).max(1),
  })
  .strict();

const canvasMappingSchema = z
  .object({
    sourcePageId: idSchema,
    pageId: idSchema,
    artboard: z
      .object({
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
    viewport: z
      .object({
        id: idSchema,
        width: z.number().int().min(240).max(8_192),
        height: z.number().int().min(240).max(8_192),
        deviceScaleFactor: z.number().min(1).max(4),
      })
      .strict(),
    scale: z.number().positive(),
    origin: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .strict(),
    renderMode: z.enum([
      "native_artboard",
      "scroll_canvas",
      "viewport_crop",
      "fit_artboard",
    ]),
    crop: boundsSchema.optional(),
  })
  .strict();

const regionDiagnosisIdSchema = z.enum([
  "left_visual",
  "form_fields",
  "cta",
  "social_buttons",
  "footer",
  "modal_shell",
  "dense_content",
  "mobile_canvas",
]);

const regionDiagnosisSchema = z
  .object({
    id: regionDiagnosisIdSchema,
    contractBucket: contractRegionBucketSchema.optional(),
    bounds: boundsSchema.optional(),
    diffPixelRatio: z.number().min(0).max(1).optional(),
    diffPixels: z.number().int().nonnegative().optional(),
    sourceNodeIds: z.array(idSchema).max(1_000).optional(),
    uiSpecNodeIds: z.array(idSchema).max(1_000).optional(),
    suspectedCauses: z
      .array(
        z.enum([
          "canvas_mapping",
          "typography",
          "asset_layering",
          "renderer_reset",
          "clip_unsupported",
          "unsupported_feature",
          "unknown",
        ]),
      )
      .min(1)
      .max(20),
  })
  .strict();

const pageComparisonSchema = z
  .object({
    diffPixelRatio: z.number().min(0).max(1),
    diffPixels: z.number().int().nonnegative(),
    screenshotPaths: z.array(z.string().min(1).max(2_048)).max(100),
    regionDiffs: z.array(comparisonRegionDiffSchema).max(20).optional(),
    regionDiagnostics: z.array(regionDiagnosisSchema).max(100).optional(),
    canvasMapping: canvasMappingSchema.optional(),
  })
  .strict();

const pageSummarySchema = z
  .object({
    pageId: idSchema,
    sourcePageId: idSchema,
    sourceRootNodeId: idSchema.optional(),
    path: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          /^\/(?:[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*)?$/.test(
            value,
          ),
        "路由必须是由小写字母、数字、连字符和下划线组成的站内绝对路径",
      ),
    viewportRole: z
      .enum(["desktop", "mobile", "tablet", "unknown"])
      .optional(),
    nodeCounts: z
      .object({
        text: z.number().int().nonnegative(),
        input: z.number().int().nonnegative(),
        select: z.number().int().nonnegative(),
        button: z.number().int().nonnegative(),
        image: z.number().int().nonnegative(),
        pixelOverlay: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    structuredCoverage: z
      .object({
        textNodeCount: z.number().int().nonnegative(),
        interactiveNodeCount: z.number().int().nonnegative(),
        fullPageScreenshotFallback: z.literal(false),
      })
      .strict(),
    componentFidelity: z
      .object({
        sourceComponentNodeCount: z.number().int().nonnegative(),
        byFamily: z.record(
          z.string().min(1).max(128),
          z.number().int().nonnegative(),
        ),
        byState: z.record(
          z.string().min(1).max(128),
          z.number().int().nonnegative(),
        ),
      })
      .strict()
      .optional(),
    visualLayerCoverage: z
      .object({
        candidateCount: z.number().int().nonnegative(),
        renderedCount: z.number().int().nonnegative(),
        unsupportedCount: z.number().int().nonnegative(),
      })
      .strict(),
    regions: z.array(pageRegionSchema).max(100),
    comparison: pageComparisonSchema.optional(),
  })
  .strict();

const visualLayerSchema = z
  .object({
    sourceNodeId: idSchema,
    uiSpecNodeId: idSchema.optional(),
    sourcePageId: idSchema,
    reason: z.enum([
      "large_visual",
      "structural_visual",
      "background_composite",
      "named_visual",
      "image_visual",
      "button_icon",
      "logo",
      "nav_icon",
      "line_divider",
    ]),
    layerRole: z.string().min(1).max(128),
    zOrder: z.number().int().nonnegative(),
    bounds: boundsSchema,
    pageRelativeBounds: boundsSchema,
    opacity: z.number().min(0).max(1).optional(),
    assetRef: z.string().min(1).max(2_048).optional(),
    rendered: z.boolean(),
    blockedReason: z.string().min(1).max(2_000).optional(),
  })
  .strict();

const warningSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    detail: z.string().min(1).max(2_000),
  })
  .strict();

const apiBoundarySchema = z
  .object({
    openai: z.boolean(),
    figmaMe: z.boolean(),
    variables: z.boolean(),
  })
  .strict();

export const m5StaticReportSchema = z
  .object({
    schemaVersion: z.literal("1"),
    runId: z.string().min(1).max(128),
    projectId: z.string().min(1).max(64),
    designBundleRevision: z.number().int().positive(),
    uiSpecRevision: z.number().int().positive().optional(),
    status: z.enum(["passed", "failed", "partial"]),
    scope: z.literal("static_generation_only"),
    behaviorFlowVerified: z.literal(false),
    m4ValidationStatus: z.enum(["pending", "promoted", "not_required"]).optional(),
    coverageVersion: z.literal("1").optional(),
    coverage: coverageReportSchema.optional(),
    apiBoundary: apiBoundarySchema.optional(),
    pages: z.array(pageSummarySchema).max(1_000),
    visualLayers: z.array(visualLayerSchema).max(100_000),
    unsupportedFeatures: z.array(unsupportedFeatureSchema).max(10_000),
    warnings: z.array(warningSchema).max(10_000),
    residualRisks: z.array(z.string().min(1).max(2_000)).max(1_000),
  })
  .strict();

export type M5StaticReport = z.infer<typeof m5StaticReportSchema>;
export type M5StaticPageSummary = z.infer<typeof pageSummarySchema>;
export type M5StaticVisualLayer = z.infer<typeof visualLayerSchema>;
export type M5StaticRegion = z.infer<typeof pageRegionSchema>;
export type M5StaticRegionDiagnosis = z.infer<
  typeof regionDiagnosisSchema
>;
export type { UnsupportedFeature, CoverageReport };

export const m5StaticCoverageReportSchema = m5StaticReportSchema
  .extend({
    coverageVersion: z.literal("1"),
    coverage: coverageReportSchema,
  })
  .strict();

export type M5StaticCoverageReport = z.infer<
  typeof m5StaticCoverageReportSchema
>;
