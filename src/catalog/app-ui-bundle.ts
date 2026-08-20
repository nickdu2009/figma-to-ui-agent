/**
 * AppUiBundle 严格 Zod 合同（设计 §5.1/§10.1）：
 * - bundleVersion: 1；catalogVersion: 1.x.y 且无前导零；specCompatibility: "0.19.0"；
 * - spec: NextAppSpec 结构（metadata?/routes/layouts?/state?），持久 state 只允许 /ui 命名空间
 *   （state 顶层键只能为 "ui"）；
 * - designSystem: tokens + applicationCss；assets: AssetManifest；
 * - 全部对象 strict，不允许未知键；字节/数量上限由 bundle-gates.ts 单独强制。
 */
import { z } from "zod";

import { designSystemSchema } from "./token-contract.ts";

export const CATALOG_VERSION_PATTERN = /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const SPEC_COMPATIBILITY_VALUE = "0.19.0";
export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const catalogVersionSchema = z
  .string()
  .regex(CATALOG_VERSION_PATTERN, "catalogVersion 必须是 1.x.y 且不允许前导零");

export const contentHashSchema = z
  .string()
  .regex(CONTENT_HASH_PATTERN, "contentHash 必须是 sha256:<64 位小写十六进制>");

export const assetKindSchema = z.enum(["image", "svg", "font"]);

export const assetMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "font/woff2",
]);

export const assetFontMetaSchema = z
  .object({
    family: z.string().min(1),
    weight: z.union([
      z.literal(400),
      z.literal(500),
      z.literal(600),
      z.literal(700),
    ]),
  })
  .strict();

export const assetManifestEntrySchema = z
  .object({
    assetId: z.string().min(1),
    kind: assetKindSchema,
    contentHash: contentHashSchema,
    mimeType: assetMimeTypeSchema,
    byteLength: z.number().int().nonnegative(),
    width: z.number().int().positive().max(4096).optional(),
    height: z.number().int().positive().max(4096).optional(),
    font: assetFontMetaSchema.optional(),
  })
  .strict();

const KIND_MIME_TYPES: Record<string, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  svg: ["image/svg+xml"],
  font: ["font/woff2"],
};

export const assetManifestSchema = z
  .object({ entries: z.array(assetManifestEntrySchema) })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of manifest.entries.entries()) {
      if (seen.has(entry.assetId)) {
        ctx.addIssue({
          code: "custom",
          message: `assetId 重复：${entry.assetId}`,
          path: ["entries", index, "assetId"],
        });
      }
      seen.add(entry.assetId);
      const allowedMimes = KIND_MIME_TYPES[entry.kind] ?? [];
      if (!allowedMimes.includes(entry.mimeType)) {
        ctx.addIssue({
          code: "custom",
          message: `kind ${entry.kind} 不允许 mimeType ${entry.mimeType}`,
          path: ["entries", index, "mimeType"],
        });
      }
      if (entry.kind === "font" && !entry.font) {
        ctx.addIssue({
          code: "custom",
          message: "font 资源必须携带 font 元数据",
          path: ["entries", index, "font"],
        });
      }
      if (entry.kind !== "font" && entry.font) {
        ctx.addIssue({
          code: "custom",
          message: "非 font 资源不得携带 font 元数据",
          path: ["entries", index, "font"],
        });
      }
    }
  });

export type AssetManifestEntry = z.infer<typeof assetManifestEntrySchema>;
export type AssetManifest = z.infer<typeof assetManifestSchema>;

/** JSON 值（与 runtime jsonValueSchema 同构）。 */
export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * NextAppSpec 结构级 schema（catalog-aware 校验由派生 catalog 的 validate/zodSchema 负责）。
 * state 顶层键只允许 "ui"（持久 UI 状态只存在 /ui 命名空间）。
 */
const elementTreeSchema = z
  .object({
    root: z.string(),
    elements: z.record(z.string(), jsonValueSchema),
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

const routeSpecSchema = z
  .object({
    page: elementTreeSchema,
    metadata: z.record(z.string(), jsonValueSchema).optional(),
    layout: z.string().optional(),
    loading: elementTreeSchema.optional(),
    error: elementTreeSchema.optional(),
    notFound: elementTreeSchema.optional(),
    loader: z.string().optional(),
    staticParams: z.array(z.record(z.string(), z.string())).optional(),
  })
  .strict();

export const bundleSpecSchema = z
  .object({
    metadata: z.record(z.string(), jsonValueSchema).optional(),
    routes: z.record(z.string(), routeSpecSchema),
    layouts: z.record(z.string(), elementTreeSchema).optional(),
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const checkStateKeys = (state: Record<string, unknown> | undefined, path: (string | number)[]) => {
      if (!state) return;
      for (const key of Object.keys(state)) {
        if (key !== "ui") {
          ctx.addIssue({
            code: "custom",
            message: `持久 state 只允许 /ui 命名空间，非法顶层键：${key}`,
            path: [...path, key],
          });
        }
      }
    };
    checkStateKeys(spec.state, ["state"]);
    for (const [routePath, route] of Object.entries(spec.routes)) {
      checkStateKeys(route.page.state, ["routes", routePath, "page", "state"]);
      checkStateKeys(route.loading?.state, ["routes", routePath, "loading", "state"]);
      checkStateKeys(route.error?.state, ["routes", routePath, "error", "state"]);
      checkStateKeys(route.notFound?.state, ["routes", routePath, "notFound", "state"]);
    }
    for (const [layoutKey, layout] of Object.entries(spec.layouts ?? {})) {
      checkStateKeys(layout.state, ["layouts", layoutKey, "state"]);
    }
  });

export const appUiBundleSchema = z
  .object({
    bundleVersion: z.literal(1),
    catalogVersion: catalogVersionSchema,
    specCompatibility: z.literal(SPEC_COMPATIBILITY_VALUE),
    spec: bundleSpecSchema,
    designSystem: designSystemSchema,
    assets: assetManifestSchema,
  })
  .strict();

export type AppUiBundle = z.infer<typeof appUiBundleSchema>;
export type BundleSpec = z.infer<typeof bundleSpecSchema>;
