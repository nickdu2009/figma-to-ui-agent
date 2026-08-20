/**
 * DesignSystem Token 合同（设计 §5.1 精确类型）：
 * - tokens.primitive: Record<string, PrimitiveToken>（判别联合）；
 * - tokens.semantic: Record<string, TokenRef>；
 * - tokens.component: Record<string, Record<string, TokenRef | PrimitiveToken>>；
 * - applicationCss: 受控全局样式逃逸口（字节上限由 bundle-gates 强制）；
 * - 颜色文字量仅允许 #RRGGBB 或 #RRGGBBAA；TypeScript 模板类型只作开发期提示，
 *   安全校验由 Zod 执行。
 */
import { z } from "zod";

export const COLOR_LITERAL_PATTERN = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export const colorLiteralSchema = z
  .string()
  .regex(COLOR_LITERAL_PATTERN, "颜色仅允许 #RRGGBB 或 #RRGGBBAA");

/** Token 引用：单键对象（键名 $token，值为 token 路径）。 */
export const tokenRefSchema = z
  .object({ $token: z.string().min(1) })
  .strict();

export type TokenRef = z.infer<typeof tokenRefSchema>;

export function isTokenRef(value: unknown): value is TokenRef {
  return tokenRefSchema.safeParse(value).success;
}

const shadowStopSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    blur: z.number(),
    spread: z.number(),
    color: colorLiteralSchema,
  })
  .strict();

const fontFamilyValueSchema = z.union([
  z
    .object({ system: z.enum(["system-ui", "sans-serif", "serif", "monospace"]) })
    .strict(),
  z.object({ assetId: z.string().min(1) }).strict(),
]);

/** PrimitiveToken：判别联合（设计 §5.1）。 */
export const primitiveTokenSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), value: colorLiteralSchema }).strict(),
  z
    .object({
      type: z.literal("length"),
      value: z.number(),
      unit: z.enum(["px", "rem", "em", "%", "vw", "vh"]),
    })
    .strict(),
  z.object({ type: z.literal("number"), value: z.number() }).strict(),
  z
    .object({ type: z.literal("fontFamily"), value: fontFamilyValueSchema })
    .strict(),
  z
    .object({
      type: z.literal("fontWeight"),
      value: z.union([
        z.literal(400),
        z.literal(500),
        z.literal(600),
        z.literal(700),
      ]),
    })
    .strict(),
  z
    .object({ type: z.literal("shadow"), value: z.array(shadowStopSchema) })
    .strict(),
  z.object({ type: z.literal("duration"), valueMs: z.number() }).strict(),
  z
    .object({
      type: z.literal("easing"),
      value: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    })
    .strict(),
]);

export type PrimitiveToken = z.infer<typeof primitiveTokenSchema>;

/** SemanticToken：映射 primitive 的 TokenRef。 */
export const semanticTokenSchema = tokenRefSchema;

export type SemanticToken = z.infer<typeof semanticTokenSchema>;

export const designTokensSchema = z
  .object({
    primitive: z.record(z.string(), primitiveTokenSchema),
    semantic: z.record(z.string(), semanticTokenSchema),
    component: z.record(
      z.string(),
      z.record(z.string(), z.union([tokenRefSchema, primitiveTokenSchema])),
    ),
  })
  .strict();

/** AppDesignSystem：tokens + applicationCss（applicationCss 字节上限见 bundle-gates）。 */
export const designSystemSchema = z
  .object({
    tokens: designTokensSchema,
    applicationCss: z.string(),
  })
  .strict();

export type DesignTokens = z.infer<typeof designTokensSchema>;
export type DesignSystem = z.infer<typeof designSystemSchema>;
export type AppDesignSystem = DesignSystem;
