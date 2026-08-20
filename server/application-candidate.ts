/**
 * ApplicationCandidate 合同与服务（设计 §5.1/§10.1）：
 * - uiBundle + businessSchema(null 唯一空表示) + 服务端拥有的 migrationEdge + 可选迁移计划；
 * - migrationEdge：fromPublishedVersionId(null 表示无 current)/fromSchemaDigest/toSchemaDigest，
 *   由 Generation Service 在创建 GenerationRun 时锁定，模型/Patch/浏览器不可写；
 * - finalizeParse：strict Zod 解析 + Bundle 字节门禁，fail closed；
 * - toLegacySpecProjection：同事务派生旧 spec 投影（兼容持久化读取路径）。
 */
import { z } from "zod";

import {
 type AppUiBundle,
 appUiBundleSchema,
 contentHashSchema,
} from "../src/catalog/app-ui-bundle.ts";
import {
 type BundleGateCode,
 validateBundleGates,
} from "../src/catalog/bundle-gates.ts";
import {
 type BusinessSchema,
 businessSchemaSchema,
} from "./business-data/schema-contract.ts";

/** 迁移计划（既有领域模型，结构上为 JSON 对象；严格校验复用既有迁移校验器）。 */
export const dataMigrationPlanSchema = z.record(z.string(), z.unknown());

export const migrationEdgeSchema = z
 .object({
  fromPublishedVersionId: z.string().nullable(),
  fromSchemaDigest: contentHashSchema,
  toSchemaDigest: contentHashSchema,
 })
 .strict();

export type MigrationEdge = z.infer<typeof migrationEdgeSchema>;

export const applicationCandidateSchema = z
 .object({
  uiBundle: appUiBundleSchema,
  businessSchema: businessSchemaSchema.nullable(),
  migrationEdge: migrationEdgeSchema,
  migrationPlan: dataMigrationPlanSchema.optional(),
  reverseMigrationPlan: dataMigrationPlanSchema.optional(),
 })
 .strict();

export type ApplicationCandidate = z.infer<typeof applicationCandidateSchema>;

export type CandidateParseResult =
 | { ok: true; candidate: ApplicationCandidate }
 | {
    ok: false;
    code: "candidate_schema_invalid" | BundleGateCode;
    message: string;
   };

/**
 * 权威 finalize 解析：strict Zod + Bundle 字节门禁。
 * 任何未知键、/ui 之外的持久 state、超上限一律拒绝。
 */
export function finalizeParse(input: unknown): CandidateParseResult {
 const parsed = applicationCandidateSchema.safeParse(input);
 if (!parsed.success) {
  const first = parsed.error.issues[0];
  const path = first?.path.join(".") ?? "";
  return {
   ok: false,
   code: "candidate_schema_invalid",
   message: `ApplicationCandidate 校验失败${path ? `（${path}）` : ""}：${first?.message ?? "unknown"}`,
  };
 }
 const gates = validateBundleGates(parsed.data.uiBundle);
 if (!gates.ok) {
  return { ok: false, code: gates.code, message: gates.message };
 }
 return { ok: true, candidate: parsed.data };
}

/**
 * 派生旧 spec 投影：从权威 uiBundle.spec 提取 NextAppSpec，
 * 供发布聚合在同一事务中保持既有 spec 读取路径可用。
 */
export function toLegacySpecProjection(bundle: AppUiBundle): unknown {
 return bundle.spec;
}

/**
 * 判断候选业务 Schema 是否为"尚未声明"（null 是唯一空表示；
 * 拒绝 { collections: [] } 伪造空 Schema 由 businessSchemaSchema 非空约束负责）。
 */
export function isUndeclaredBusinessSchema(
 candidate: ApplicationCandidate,
): candidate is ApplicationCandidate & { businessSchema: null } {
 return candidate.businessSchema === null;
}

export type { AppUiBundle, BusinessSchema };
