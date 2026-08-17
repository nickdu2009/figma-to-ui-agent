import type {
  BusinessCollection,
  BusinessField,
  CollectionAction,
  MemberRole,
} from "./schema-contract.ts";
import { isActionAllowed } from "./schema-contract.ts";

/**
 * 数据访问策略执行（S5a，设计 §4.5）。
 * 授权顺序：Session → App → Membership → 集合动作 → 记录范围 → 字段权限。
 * 无权记录 = 不可见；无权字段读 = 投影时剔除/脱敏；无权字段写 = 显式拒绝。
 */

export interface CallerContext {
  userId: string;
  membershipId: string;
  role: MemberRole;
}

/** 集合动作授权（能力上限 ∩ 策略收紧）。 */
export function assertCollectionAction(
  caller: CallerContext,
  collection: BusinessCollection,
  action: CollectionAction,
): void {
  if (!isActionAllowed(caller.role, collection, action)) {
    throw new PolicyDeniedError(action);
  }
}

export class PolicyDeniedError extends Error {
  readonly code = "forbidden";
  constructor(action: string) {
    super(`无权执行集合动作：${action}`);
    this.name = "PolicyDeniedError";
  }
}

export class FieldWriteDeniedError extends Error {
  readonly code = "field_write_forbidden";
  readonly fields: string[];
  constructor(fields: string[]) {
    super(`无权写入字段：${fields.join(", ")}`);
    this.name = "FieldWriteDeniedError";
    this.fields = fields;
  }
}

/** 记录范围判定（设计 §4.5 表）。 */
export function canSeeRecord(
  caller: CallerContext,
  collection: BusinessCollection,
  record: {
    createdByUserId: string;
    subjectMembershipId: string | null;
  },
  isPrincipal: boolean,
): boolean {
  if (caller.role === "owner") return true;
  switch (collection.recordScope) {
    case "shared":
      return true;
    case "creator_only":
      return record.createdByUserId === caller.userId;
    case "subject_only":
      return record.subjectMembershipId === caller.membershipId;
    case "assignee":
      return record.createdByUserId === caller.userId || isPrincipal;
  }
}

/** 字段级读投影：无权字段剔除；maskedRead 命中的角色看到模板脱敏值。 */
export function projectReadableData(
  caller: CallerContext,
  collection: BusinessCollection,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of collection.fields) {
    if (!(field.key in data)) continue;
    const readRoles = field.read ?? ["owner", "editor", "viewer"];
    if (!readRoles.includes(caller.role)) continue;
    let value = data[field.key];
    if (field.maskedRead && field.maskedRead.roles.includes(caller.role)) {
      value = maskValue(value, field.maskedRead.template);
    }
    out[field.key] = value;
  }
  return out;
}

/**
 * DraftDataView（S5b，设计 §4.3）：当前与候选策略的最严交集投影。
 * 字段须同时存在于两个 Schema 且两个策略都允许读；任一方脱敏则脱敏。
 */
export function projectReadableDataIntersection(
  caller: CallerContext,
  current: BusinessCollection,
  candidate: BusinessCollection,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of current.fields) {
    if (!(field.key in data)) continue;
    const candidateField = candidate.fields.find((f) => f.key === field.key);
    if (!candidateField) continue; // 候选已删除：最严交集 = 不可见
    const currentRead = field.read ?? ["owner", "editor", "viewer"];
    const candidateRead = candidateField.read ?? ["owner", "editor", "viewer"];
    if (!currentRead.includes(caller.role)) continue;
    if (!candidateRead.includes(caller.role)) continue;
    let value = data[field.key];
    if (field.maskedRead && field.maskedRead.roles.includes(caller.role)) {
      value = maskValue(value, field.maskedRead.template);
    }
    if (
      candidateField.maskedRead &&
      candidateField.maskedRead.roles.includes(caller.role)
    ) {
      value = maskValue(value, candidateField.maskedRead.template);
    }
    out[field.key] = value;
  }
  return out;
}

export function maskValue(value: unknown, template: string): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  switch (template) {
    case "last4":
      return `****${value.slice(-4)}`;
    case "email": {
      const at = value.indexOf("@");
      if (at <= 0) return "***";
      return `${value[0]}***${value.slice(at)}`;
    }
    case "phone":
      return `***${value.slice(-4)}`;
    default:
      return "***";
  }
}

/** 字段级写校验：无权写入的字段显式拒绝（不得静默丢弃）。 */
export function assertWritableFields(
  caller: CallerContext,
  collection: BusinessCollection,
  data: Record<string, unknown>,
): void {
  const denied: string[] = [];
  for (const key of Object.keys(data)) {
    const field = collection.fields.find((f) => f.key === key);
    if (!field) {
      denied.push(key);
      continue;
    }
    const writeRoles = field.write ?? ["owner", "editor"];
    if (!writeRoles.includes(caller.role)) denied.push(key);
  }
  if (denied.length > 0) throw new FieldWriteDeniedError(denied);
}

/** 创建/更新时的字段值类型校验（fail-closed，无隐式类型转换）。 */
export function validateFieldValues(
  collection: BusinessCollection,
  data: Record<string, unknown>,
  partial: boolean,
): void {
  for (const field of collection.fields) {
    const present = field.key in data;
    if (!present) {
      if (!partial && field.required) {
        throw new FieldValueError(field, "缺少必填字段");
      }
      continue;
    }
    const value = data[field.key];
    if (value === null || value === undefined) {
      if (field.required) throw new FieldValueError(field, "必填字段不得为空");
      continue;
    }
    switch (field.type) {
      case "string":
        if (typeof value !== "string") {
          throw new FieldValueError(field, "类型必须为 string");
        }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new FieldValueError(field, "类型必须为有限 number");
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          throw new FieldValueError(field, "类型必须为 boolean");
        }
        break;
      case "date":
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
          throw new FieldValueError(field, "类型必须为可解析的日期字符串");
        }
        break;
      case "enum":
        if (
          typeof value !== "string" ||
          !(field.enumValues ?? []).includes(value)
        ) {
          throw new FieldValueError(field, "取值不在 enum 集合内");
        }
        break;
    }
  }
}

export class FieldValueError extends Error {
  readonly code = "field_invalid";
  constructor(field: BusinessField, message: string) {
    super(`${field.key}：${message}`);
    this.name = "FieldValueError";
  }
}

/** 唯一值规范化（规则 6）：普通字符串 Unicode NFC + 大小写敏感；邮箱走账号规范化。 */
export function normalizeUniqueValue(
  field: BusinessField,
  value: unknown,
): string {
  const raw = String(value);
  if (field.format === "email") {
    return raw.trim().normalize("NFC").toLowerCase();
  }
  return raw.normalize("NFC");
}
