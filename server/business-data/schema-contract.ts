import { z } from "zod";

/**
 * 业务 Schema 契约（S5a，设计 §4.3/§4.4 + GATE-00 资源上限）。
 * 随 PublishedVersion 固定；S5b 之前版本间不得变化（S4 门禁强制）。
 *
 * - 角色能力上限：owner 全部；editor ≤ read/create/update；viewer ≤ read；
 *   delete/restore/export 成员侧仅 owner；策略只能收紧不能扩权；
 * - 记录范围仅 shared/creator_only/subject_only/assignee；
 * - 脱敏模板仅 last4/email/phone；
 * - 资源上限 L1–L6 在此声明常量，写入前校验，失败关闭。
 */

// ---------- GATE-00 资源上限（已确认数值） ----------
export const LIMITS = {
  /** L1：单条业务记录最大字节数（JSON 序列化后） */
  recordMaxBytes: 65_536,
  /** L2：每个集合最大记录数 */
  collectionMaxRecords: 10_000,
  /** L3：每个 Schema 最大 queryable 字段数（全部集合合计） */
  schemaMaxQueryableFields: 16,
  /** L4：每个 Schema 最大 unique 字段数（全部集合合计） */
  schemaMaxUniqueFields: 8,
  /** L5：每条记录最大 principal 数 */
  recordMaxPrincipals: 8,
  /** L6：导出批次与总量 */
  exportBatchSize: 500,
  exportMaxRecords: 10_000,
  /** 查询分页：默认 20、最大 100 */
  queryDefaultLimit: 20,
  queryMaxLimit: 100,
  /** 查询：最多五个 AND 条件 */
  queryMaxConditions: 5,
} as const;

export const memberRoles = ["owner", "editor", "viewer"] as const;
export type MemberRole = (typeof memberRoles)[number];

export const collectionActions = [
  "read",
  "create",
  "update",
  "delete",
  "restore",
  "export",
] as const;
export type CollectionAction = (typeof collectionActions)[number];

/** 角色能力上限（不可放宽；策略只能收紧）。 */
export const ROLE_CEILINGS: Record<
  MemberRole,
  ReadonlySet<CollectionAction>
> = {
  owner: new Set(collectionActions),
  editor: new Set(["read", "create", "update"]),
  viewer: new Set(["read"]),
};

export const recordScopes = [
  "shared",
  "creator_only",
  "subject_only",
  "assignee",
] as const;
export type RecordScope = (typeof recordScopes)[number];

export const maskTemplates = ["last4", "email", "phone"] as const;
export type MaskTemplate = (typeof maskTemplates)[number];

const fieldKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "字段键必须为小写 snake_case");

export const businessFieldSchema = z
  .object({
    key: fieldKey,
    type: z.enum(["string", "number", "boolean", "date", "enum"]),
    required: z.boolean().optional(),
    /** type=enum 的取值集合 */
    enumValues: z.array(z.string().min(1).max(128)).max(64).optional(),
    /** string 字段的邮箱语义（唯一/规范化用账号邮箱规范化） */
    format: z.literal("email").optional(),
    queryable: z.boolean().optional(),
    sortable: z.boolean().optional(),
    unique: z.boolean().optional(),
    /** 字段级读角色（默认全部成员角色） */
    read: z.array(z.enum(memberRoles)).optional(),
    /** 字段级写角色（默认 owner/editor） */
    write: z.array(z.enum(memberRoles)).optional(),
    maskedRead: z
      .object({
        roles: z.array(z.enum(memberRoles)).min(1),
        template: z.enum(maskTemplates),
      })
      .optional(),
  })
  .strict();

export const businessCollectionSchema = z
  .object({
    key: fieldKey,
    recordScope: z.enum(recordScopes),
    /** 集合动作策略：只能收紧（见 compile 期校验） */
    actions: z
      .record(z.enum(collectionActions), z.array(z.enum(memberRoles)))
      .optional(),
    fields: z.array(businessFieldSchema).min(1).max(64),
  })
  .strict();

export const businessSchemaSchema = z
  .object({
    collections: z.array(businessCollectionSchema).min(1).max(32),
  })
  .strict();

export type BusinessField = z.infer<typeof businessFieldSchema>;
export type BusinessCollection = z.infer<typeof businessCollectionSchema>;
export type BusinessSchema = z.infer<typeof businessSchemaSchema>;

export class BusinessSchemaError extends Error {
  readonly code = "schema_invalid";
  constructor(message: string) {
    super(message);
    this.name = "BusinessSchemaError";
  }
}

/** 编译期校验（fail-closed）：结构 + 策略收紧性 + 资源上限。 */
export function validateBusinessSchema(input: unknown): BusinessSchema {
  const parsed = businessSchemaSchema.safeParse(input);
  if (!parsed.success) {
    throw new BusinessSchemaError(
      `业务 Schema 结构非法：${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  const schema = parsed.data;
  const collectionKeys = new Set<string>();
  let queryableTotal = 0;
  let uniqueTotal = 0;
  for (const collection of schema.collections) {
    if (collectionKeys.has(collection.key)) {
      throw new BusinessSchemaError(`集合键重复：${collection.key}`);
    }
    collectionKeys.add(collection.key);
    // 策略只能收紧：声明的角色不得超出能力上限
    for (const [action, roles] of Object.entries(collection.actions ?? {})) {
      for (const role of roles ?? []) {
        if (!ROLE_CEILINGS[role].has(action as CollectionAction)) {
          throw new BusinessSchemaError(
            `策略扩权被拒绝：${role} 不允许 ${action}（集合 ${collection.key}）`,
          );
        }
      }
    }
    const fieldKeys = new Set<string>();
    for (const field of collection.fields) {
      if (fieldKeys.has(field.key)) {
        throw new BusinessSchemaError(
          `字段键重复：${collection.key}.${field.key}`,
        );
      }
      fieldKeys.add(field.key);
      if (field.unique && field.type !== "string") {
        throw new BusinessSchemaError(
          `唯一约束仅支持 string 字段：${collection.key}.${field.key}`,
        );
      }
      if (
        field.type === "enum" &&
        (!field.enumValues || field.enumValues.length === 0)
      ) {
        throw new BusinessSchemaError(
          `enum 字段缺少取值集合：${collection.key}.${field.key}`,
        );
      }
      if (field.format === "email" && field.type !== "string") {
        throw new BusinessSchemaError(
          `email 格式仅支持 string 字段：${collection.key}.${field.key}`,
        );
      }
      if (field.queryable) queryableTotal += 1;
      if (field.unique) uniqueTotal += 1;
    }
  }
  if (queryableTotal > LIMITS.schemaMaxQueryableFields) {
    throw new BusinessSchemaError(
      `可查询字段超限：${queryableTotal} > ${LIMITS.schemaMaxQueryableFields}`,
    );
  }
  if (uniqueTotal > LIMITS.schemaMaxUniqueFields) {
    throw new BusinessSchemaError(
      `唯一字段超限：${uniqueTotal} > ${LIMITS.schemaMaxUniqueFields}`,
    );
  }
  return schema;
}

export function findCollection(
  schema: BusinessSchema,
  collectionKey: string,
): BusinessCollection | null {
  return schema.collections.find((c) => c.key === collectionKey) ?? null;
}

/** 集合动作是否允许（能力上限 ∩ 策略收紧）。 */
export function isActionAllowed(
  role: MemberRole,
  collection: BusinessCollection,
  action: CollectionAction,
): boolean {
  if (!ROLE_CEILINGS[role].has(action)) return false;
  const policy = collection.actions?.[action];
  if (!policy) return true; // 未声明 = 保持上限
  return policy.includes(role);
}
