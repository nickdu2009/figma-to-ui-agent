import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { businessIndexValues } from "../db/schema.ts";
import type {
  BusinessCollection,
  BusinessField,
} from "../business-data/schema-contract.ts";
import { LIMITS } from "../business-data/schema-contract.ts";
import type { CompiledQuery } from "../repositories/business-data-repository.ts";

/**
 * 固定查询编译器（S5a，设计 §6.3 查询契约）：
 * - string/enum：eq、in；number/date：eq、gt、gte、lt、lte、in；boolean：eq；
 * - 最多五个 AND 条件；同字段多个条件拒绝（多值用 in）；
 * - 只允许一个排序字段，并以 recordId 稳定收尾；
 * - 无 null 查询、无模糊匹配、无自由 OR、无隐式类型转换；
 * - 不接受自由 SQL / JSONPath / 过滤 DSL；非法字段/操作符/类型/游标 → 400；
 * - 游标为带 HMAC 完整性校验的 opaque 字符串。
 */

const cursorSecret =
  process.env.VMA_CURSOR_SECRET ?? randomBytes(32).toString("hex");

const queryConditionSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(["eq", "in", "gt", "gte", "lt", "lte"]),
  value: z.unknown(),
});

export const dataQueryRequestSchema = z
  .object({
    where: z
      .array(queryConditionSchema)
      .max(LIMITS.queryMaxConditions)
      .optional(),
    orderBy: z
      .object({
        field: z.string().min(1).max(64),
        direction: z.enum(["asc", "desc"]),
      })
      .optional(),
    limit: z.number().int().min(1).max(LIMITS.queryMaxLimit).optional(),
    cursor: z.string().max(512).optional(),
  })
  .strict();

export type DataQueryRequest = z.infer<typeof dataQueryRequestSchema>;

export class QueryRejected extends Error {
  readonly code = "invalid_query";
  constructor(message: string) {
    super(message);
    this.name = "QueryRejected";
  }
}

const OPS_BY_TYPE: Record<string, ReadonlySet<string>> = {
  string: new Set(["eq", "in"]),
  enum: new Set(["eq", "in"]),
  number: new Set(["eq", "gt", "gte", "lt", "lte", "in"]),
  date: new Set(["eq", "gt", "gte", "lt", "lte", "in"]),
  boolean: new Set(["eq"]),
};

function conditionHash(where: unknown): string {
  return createHmac("sha256", cursorSecret)
    .update(JSON.stringify(where ?? []))
    .digest("hex")
    .slice(0, 16);
}

export function encodeCursor(payload: {
  collectionKey: string;
  where: unknown;
  orderBy: unknown;
  sortValue: unknown;
  recordId: string;
}): string {
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      c: payload.collectionKey,
      h: conditionHash({ where: payload.where, orderBy: payload.orderBy }),
      s: payload.sortValue ?? null,
      r: payload.recordId,
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", cursorSecret)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function decodeCursor(
  cursor: string,
  collectionKey: string,
  where: unknown,
  orderBy: unknown,
): { sortValue: unknown; recordId: string } {
  const [body, sig] = cursor.split(".");
  if (!body || !sig) throw new QueryRejected("游标格式非法");
  const expected = createHmac("sha256", cursorSecret)
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new QueryRejected("游标完整性校验失败");
  }
  let parsed: {
    v?: number;
    c?: string;
    h?: string;
    s?: unknown;
    r?: string;
  };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new QueryRejected("游标内容非法");
  }
  if (parsed.v !== 1 || parsed.c !== collectionKey || !parsed.r) {
    throw new QueryRejected("游标与查询不匹配");
  }
  if (parsed.h !== conditionHash({ where, orderBy })) {
    throw new QueryRejected("游标与查询条件不匹配");
  }
  return { sortValue: parsed.s ?? null, recordId: parsed.r };
}

function compileValueClause(
  field: BusinessField,
  op: string,
  value: unknown,
): SQL {
  const col =
    field.type === "number"
      ? businessIndexValues.valueNumber
      : field.type === "boolean"
        ? businessIndexValues.valueBool
        : field.type === "date"
          ? businessIndexValues.valueDate
          : businessIndexValues.valueText;

  const coerce = (v: unknown): string | number | boolean | Date => {
    switch (field.type) {
      case "string":
      case "enum":
        if (typeof v !== "string") {
          throw new QueryRejected(`字段 ${field.key} 的值必须为 string`);
        }
        if (field.type === "enum" && !(field.enumValues ?? []).includes(v)) {
          throw new QueryRejected(`字段 ${field.key} 的值不在 enum 集合内`);
        }
        return v;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new QueryRejected(`字段 ${field.key} 的值必须为有限 number`);
        }
        return v;
      case "boolean":
        if (typeof v !== "boolean") {
          throw new QueryRejected(`字段 ${field.key} 的值必须为 boolean`);
        }
        return v;
      case "date": {
        if (typeof v !== "string") {
          throw new QueryRejected(`字段 ${field.key} 的值必须为日期字符串`);
        }
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          throw new QueryRejected(`字段 ${field.key} 的值必须为可解析日期`);
        }
        return d;
      }
      default:
        throw new QueryRejected(`字段 ${field.key} 类型未知`);
    }
  };

  if (value === null || value === undefined) {
    throw new QueryRejected("不支持 null 查询");
  }
  switch (op) {
    case "eq":
      return sql`${col} = ${coerce(value)}`;
    case "gt":
      return sql`${col} > ${coerce(value)}`;
    case "gte":
      return sql`${col} >= ${coerce(value)}`;
    case "lt":
      return sql`${col} < ${coerce(value)}`;
    case "lte":
      return sql`${col} <= ${coerce(value)}`;
    case "in": {
      if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
        throw new QueryRejected("in 取值必须为 1–100 个元素的数组");
      }
      const values = value.map(coerce);
      return sql`${col} IN ${values}`;
    }
    default:
      throw new QueryRejected(`不支持的操作符：${op}`);
  }
}

/** 编译查询（fail-closed：任何非法输入 → QueryRejected 400）。 */
export function compileQuery(
  collection: BusinessCollection,
  request: DataQueryRequest,
): CompiledQuery {
  const conditions: CompiledQuery["conditions"] = [];
  const seenFields = new Set<string>();
  for (const condition of request.where ?? []) {
    const field = collection.fields.find((f) => f.key === condition.field);
    if (!field) {
      throw new QueryRejected(`未知字段：${condition.field}`);
    }
    if (!field.queryable) {
      throw new QueryRejected(`字段不可查询：${condition.field}`);
    }
    if (seenFields.has(condition.field)) {
      throw new QueryRejected(`同字段多条件请使用 in：${condition.field}`);
    }
    seenFields.add(condition.field);
    const allowed = OPS_BY_TYPE[field.type];
    if (!allowed?.has(condition.op)) {
      throw new QueryRejected(
        `字段 ${condition.field}（${field.type}）不支持操作符 ${condition.op}`,
      );
    }
    conditions.push({
      fieldKey: field.key,
      clause: compileValueClause(field, condition.op, condition.value),
    });
  }

  let orderBy: CompiledQuery["orderBy"];
  if (request.orderBy) {
    const field = collection.fields.find(
      (f) => f.key === request.orderBy!.field,
    );
    if (!field) {
      throw new QueryRejected(`未知排序字段：${request.orderBy.field}`);
    }
    if (!field.sortable) {
      throw new QueryRejected(`字段不可排序：${request.orderBy.field}`);
    }
    orderBy = {
      fieldKey: field.key,
      direction: request.orderBy.direction,
      fieldType: field.type,
    };
  }

  let cursor: CompiledQuery["cursor"];
  if (request.cursor) {
    cursor = decodeCursor(
      request.cursor,
      collection.key,
      request.where ?? [],
      request.orderBy ?? null,
    );
  }

  return {
    conditions,
    orderBy,
    limit: request.limit ?? LIMITS.queryDefaultLimit,
    cursor,
  };
}
