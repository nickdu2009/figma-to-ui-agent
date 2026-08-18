import { z } from "zod";
import {
  findCollection,
  validateBusinessSchema,
  type BusinessCollection,
  type BusinessSchema,
} from "../business-data/schema-contract.ts";
import {
  normalizeUniqueValue,
  validateFieldValues,
  FieldValueError,
} from "../business-data/policy.ts";

/**
 * DataMigrationPlan（S5b，设计 §4.4 破坏性变化门禁）：
 * - 破坏性变化（删集合/删字段/类型收窄/必填新增/唯一新增/enum 收窄）
 *    必须在计划中显式声明，否则拒绝；
 * - 验证在内存中对全部记录的副本执行（批次 500、总量 50,000，GATE-00 L7）；
 * - 迁移与 ReleasePointer 更新必须原子提交；失败保留旧 Schema、旧数据、旧版本；
 * - 没有经验证反向计划的跨 Schema 版本不可回滚。
 */

export const MIGRATION_BATCH_SIZE = 500;
export const MIGRATION_MAX_RECORDS = 50_000;

const keySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

export const dataMigrationPlanSchema = z
  .object({
    /** 显式删除的旧集合 */
    dropCollections: z.array(keySchema).max(32).optional(),
    collections: z
      .array(
        z
          .object({
            key: keySchema,
            /** 显式删除的旧字段 */
            dropFields: z.array(keySchema).max(64).optional(),
            /** 字段重命名：新字段 ← 旧字段 */
            mapFields: z
              .array(z.object({ key: keySchema, from: keySchema }).strict())
              .max(64)
              .optional(),
            /** 新增/必填字段的默认值 */
            defaults: z
              .array(z.object({ key: keySchema, value: z.unknown() }).strict())
              .max(64)
              .optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
  })
  .strict();

export type DataMigrationPlan = z.infer<typeof dataMigrationPlanSchema>;

export class MigrationRejected extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MigrationRejected";
    this.code = code;
  }
}

/** 破坏性差异分析：返回计划中必须覆盖的删除项。 */
export function diffSchemas(
  oldSchema: BusinessSchema,
  newSchema: BusinessSchema,
): {
  removedCollections: string[];
  removedFields: Array<{ collection: string; field: string }>;
  compatible: boolean;
} {
  const removedCollections: string[] = [];
  const removedFields: Array<{ collection: string; field: string }> = [];
  for (const oldCollection of oldSchema.collections) {
    const next = findCollection(newSchema, oldCollection.key);
    if (!next) {
      removedCollections.push(oldCollection.key);
      continue;
    }
    for (const oldField of oldCollection.fields) {
      if (!next.fields.some((f) => f.key === oldField.key)) {
        removedFields.push({
          collection: oldCollection.key,
          field: oldField.key,
        });
      }
    }
  }
  return {
    removedCollections,
    removedFields,
    compatible: removedCollections.length === 0 && removedFields.length === 0,
  };
}

/** 计划完整性：所有破坏性删除必须显式声明。 */
export function assertPlanCoversDestructiveChanges(
  oldSchema: BusinessSchema,
  newSchema: BusinessSchema,
  plan: DataMigrationPlan,
): void {
  const diff = diffSchemas(oldSchema, newSchema);
  const droppedCollections = new Set(plan.dropCollections ?? []);
  for (const key of diff.removedCollections) {
    if (!droppedCollections.has(key)) {
      throw new MigrationRejected(
        "migration_plan_incomplete",
        `删除集合必须在计划中声明：${key}`,
      );
    }
  }
  for (const { collection, field } of diff.removedFields) {
    const entry = (plan.collections ?? []).find((c) => c.key === collection);
    // 覆盖方式：显式 dropFields 声明，或作为 mapFields 的来源（重命名）
    const covered =
      entry &&
      ((entry.dropFields ?? []).includes(field) ||
        (entry.mapFields ?? []).some((m) => m.from === field));
    if (!covered) {
      throw new MigrationRejected(
        "migration_plan_incomplete",
        `删除字段必须在计划中声明：${collection}.${field}`,
      );
    }
  }
}

/** 对单条记录应用计划变换（内存副本；不触碰存储）。 */
export function transformRecord(
  collection: BusinessCollection,
  plan: DataMigrationPlan | null,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const entry = plan?.collections?.find((c) => c.key === collection.key);
  const renames = new Map(
    (entry?.mapFields ?? []).map((m) => [m.key, m.from] as const),
  );
  const defaults = new Map(
    (entry?.defaults ?? []).map((d) => [d.key, d.value] as const),
  );
  const out: Record<string, unknown> = {};
  for (const field of collection.fields) {
    const sourceKey = renames.get(field.key) ?? field.key;
    if (sourceKey in data) {
      out[field.key] = data[sourceKey];
    } else if (defaults.has(field.key)) {
      out[field.key] = defaults.get(field.key);
    }
  }
  return out;
}

/** 对一批记录做完整校验（类型/必填/enum + 唯一性内存模拟）。 */
export function validateTransformedBatch(
  schema: BusinessSchema,
  collectionKey: string,
  records: Array<Record<string, unknown>>,
  uniqueSeen: Map<string, Set<string>>,
): void {
  const collection = findCollection(schema, collectionKey);
  if (!collection) {
    throw new MigrationRejected(
      "migration_plan_invalid",
      `集合不存在于新 Schema：${collectionKey}`,
    );
  }
  for (const data of records) {
    try {
      validateFieldValues(collection, data, false);
    } catch (error) {
      if (error instanceof FieldValueError) {
        throw new MigrationRejected(
          "migration_validation_failed",
          `集合 ${collectionKey} 记录校验失败：${error.message}`,
        );
      }
      throw error;
    }
    for (const field of collection.fields) {
      if (!field.unique) continue;
      const value = data[field.key];
      if (value === undefined || value === null) continue;
      const normalized = normalizeUniqueValue(field, value);
      const seenKey = `${collectionKey}.${field.key}`;
      const seen = uniqueSeen.get(seenKey) ?? new Set<string>();
      if (seen.has(normalized)) {
        throw new MigrationRejected(
          "migration_validation_failed",
          `唯一约束冲突：${seenKey} 值 ${normalized}`,
        );
      }
      seen.add(normalized);
      uniqueSeen.set(seenKey, seen);
    }
  }
}

export function parseBusinessSchema(input: unknown): BusinessSchema {
  return validateBusinessSchema(input);
}
