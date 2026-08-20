import { sql, type SQL } from "drizzle-orm";
import { businessRecords } from "../db/schema.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { ReleaseRepository } from "../repositories/release-repository.ts";
import type { BusinessDataRepository } from "../repositories/business-data-repository.ts";
import { HttpError, conflict, notFound } from "../middleware/errors.ts";
import {
  LIMITS,
  findCollection,
  validateBusinessSchema,
  type BusinessCollection,
  type BusinessSchema,
} from "./schema-contract.ts";
import {
  FieldValueError,
  FieldWriteDeniedError,
  PolicyDeniedError,
  assertCollectionAction,
  assertWritableFields,
  canSeeRecord,
  normalizeUniqueValue,
  projectReadableData,
  projectReadableDataIntersection,
  validateFieldValues,
  type CallerContext,
} from "./policy.ts";
import {
  QueryRejected,
  compileQuery,
  dataQueryRequestSchema,
  encodeCursor,
} from "../data-query/compiler.ts";

/**
 * 业务数据服务（S5a，设计 §4.5/§6.3）。
 * 授权顺序：Session → App → Membership → 集合动作 → 记录范围 → 字段权限。
 * 无权记录 = 不可见（404/空页）；超限 = 400 limit_*；修订冲突 = 409 并回
 * 当前记录与 revision；所有写入在主记录 + 修订 + 投影同事务完成。
 */

const RECYCLE_BIN_DAYS = 30;

/** 导出供 S8 executor 复用（纯函数；行为与既有私有方法一致）。 */
export function buildIndexValues(
  collection: BusinessCollection,
  data: Record<string, unknown>,
): Array<{
  fieldKey: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
  valueDate: Date | null;
}> {
  const out: Array<{
    fieldKey: string;
    valueText: string | null;
    valueNumber: number | null;
    valueBool: boolean | null;
    valueDate: Date | null;
  }> = [];
  for (const field of collection.fields) {
    if (!field.queryable) continue;
    const value = data[field.key];
    if (value === undefined || value === null) continue;
    out.push({
      fieldKey: field.key,
      valueText:
        field.type === "string" || field.type === "enum"
          ? String(value)
          : null,
      valueNumber: field.type === "number" ? (value as number) : null,
      valueBool: field.type === "boolean" ? (value as boolean) : null,
      valueDate: field.type === "date" ? new Date(value as string) : null,
    });
  }
  return out;
}

/** 导出供 S8 executor 复用。 */
export function buildUniqueValues(
  collection: BusinessCollection,
  data: Record<string, unknown>,
): Array<{ fieldKey: string; valueNormalized: string }> {
  const out: Array<{ fieldKey: string; valueNormalized: string }> = [];
  for (const field of collection.fields) {
    if (!field.unique) continue;
    const value = data[field.key];
    if (value === undefined || value === null) continue;
    out.push({
      fieldKey: field.key,
      valueNormalized: normalizeUniqueValue(field, value),
    });
  }
  return out;
}

/** 导出供 S8 executor 复用（RecordView 投影）。 */
export function toRecordView(
  caller: CallerContext,
  collection: BusinessCollection,
  record: {
    id: string;
    revision: number;
    data: unknown;
    createdByUserId: string;
    updatedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  },
): RecordView {
  return {
    recordId: record.id,
    revision: record.revision,
    data: projectReadableData(
      caller,
      collection,
      record.data as Record<string, unknown>,
    ),
    createdByUserId: record.createdByUserId,
    updatedByUserId: record.updatedByUserId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface RecordView {
  recordId: string;
  revision: number;
  data: Record<string, unknown>;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class BusinessDataService {
  private readonly appRepository: AppRepository;
  private readonly releaseRepository: ReleaseRepository;
  private readonly data: BusinessDataRepository;

  constructor(deps: {
    appRepository: AppRepository;
    releaseRepository: ReleaseRepository;
    data: BusinessDataRepository;
  }) {
    this.appRepository = deps.appRepository;
    this.releaseRepository = deps.releaseRepository;
    this.data = deps.data;
  }

  /** Session → App → Membership：返回调用者上下文（404 不可见）。 */
  async resolveCaller(appId: string, userId: string): Promise<CallerContext> {
    const app = await this.appRepository.findAppById(appId);
    if (!app || app.status === "deleted") throw notFound();
    const membership = await this.appRepository.findActiveMembership(
      appId,
      userId,
    );
    if (!membership) throw notFound();
    return {
      userId,
      membershipId: membership.id,
      role: membership.role as CallerContext["role"],
    };
  }

  /** 当前发布版本的业务 Schema（无发布/无 Schema → 404）。 */
  async resolveSchema(appId: string): Promise<BusinessSchema> {
    const pointer = await this.releaseRepository.getReleasePointer(appId);
    if (!pointer) throw notFound();
    const version = await this.releaseRepository.findPublishedVersionById(
      pointer.publishedVersionId,
    );
    if (!version || version.businessSchema == null) throw notFound();
    return validateBusinessSchema(version.businessSchema);
  }

  private resolveCollection(
    schema: BusinessSchema,
    collectionKey: string,
  ): BusinessCollection {
    const collection = findCollection(schema, collectionKey);
    if (!collection) throw notFound();
    return collection;
  }

  /** 记录范围 SQL（assignee 走 RecordPrincipal 子查询；owner 无范围限制）。 */
  private scopeClause(
    caller: CallerContext,
    collection: BusinessCollection,
  ): SQL | undefined {
    if (caller.role === "owner") return undefined;
    switch (collection.recordScope) {
      case "shared":
        return undefined;
      case "creator_only":
        return sql`${businessRecords.createdByUserId} = ${caller.userId}`;
      case "subject_only":
        return sql`${businessRecords.subjectMembershipId} = ${caller.membershipId}`;
      case "assignee":
        return sql`(${businessRecords.createdByUserId} = ${caller.userId}
          OR ${businessRecords.id} IN (
            SELECT record_id FROM record_principals
            WHERE principal_membership_id = ${caller.membershipId}
          ))`;
    }
  }

  private async validatePrincipals(
    appId: string,
    principals: unknown,
  ): Promise<string[]> {
    if (principals === undefined) return [];
    if (!Array.isArray(principals)) {
      throw new FieldValueError(
        { key: "principals" } as never,
        "必须为成员 ID 数组",
      );
    }
    if (principals.length > LIMITS.recordMaxPrincipals) {
      throw conflict(
        "limit_principals",
        `principal 数超限：${principals.length} > ${LIMITS.recordMaxPrincipals}`,
      );
    }
    const out: string[] = [];
    for (const membershipId of principals) {
      if (typeof membershipId !== "string") {
        throw new FieldValueError(
          { key: "principals" } as never,
          "成员 ID 必须为字符串",
        );
      }
      const membership =
        await this.appRepository.findMembershipById(membershipId);
      if (!membership || membership.appId !== appId) {
        throw new FieldValueError(
          { key: "principals" } as never,
          `成员不存在：${membershipId}`,
        );
      }
      out.push(membershipId);
    }
    return out;
  }

  private toView(
    caller: CallerContext,
    collection: BusinessCollection,
    record: {
      id: string;
      revision: number;
      data: unknown;
      createdByUserId: string;
      updatedByUserId: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): RecordView {
    return {
      recordId: record.id,
      revision: record.revision,
      data: projectReadableData(
        caller,
        collection,
        record.data as Record<string, unknown>,
      ),
      createdByUserId: record.createdByUserId,
      updatedByUserId: record.updatedByUserId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /** 创建（owner/editor；subject/principal 语义按集合 recordScope）。 */
  async create(input: {
    appId: string;
    collectionKey: string;
    caller: CallerContext;
    data: Record<string, unknown>;
    subjectMembershipId?: unknown;
    principals?: unknown;
  }): Promise<RecordView> {
    const schema = await this.resolveSchema(input.appId);
    const collection = this.resolveCollection(schema, input.collectionKey);
    assertCollectionAction(input.caller, collection, "create");
    assertWritableFields(input.caller, collection, input.data);
    validateFieldValues(collection, input.data, false);
    const size = Buffer.byteLength(JSON.stringify(input.data), "utf8");
    if (size > LIMITS.recordMaxBytes) {
      throw conflict(
        "limit_record_bytes",
        `记录大小超限：${size} > ${LIMITS.recordMaxBytes}`,
      );
    }
    const count = await this.data.countCollectionRecords(
      input.appId,
      input.collectionKey,
    );
    if (count >= LIMITS.collectionMaxRecords) {
      throw conflict(
        "limit_collection_records",
        `集合记录数超限：${count} >= ${LIMITS.collectionMaxRecords}`,
      );
    }
    let subjectMembershipId: string | null = null;
    if (collection.recordScope === "subject_only") {
      if (typeof input.subjectMembershipId === "string") {
        const membership = await this.appRepository.findMembershipById(
          input.subjectMembershipId,
        );
        if (!membership || membership.appId !== input.appId) {
          throw new FieldValueError(
            { key: "subjectMembershipId" } as never,
            "主体成员不存在",
          );
        }
        subjectMembershipId = membership.id;
      }
    }
    const principals =
      collection.recordScope === "assignee"
        ? await this.validatePrincipals(input.appId, input.principals)
        : [];
    const record = await this.data.insertRecord({
      appId: input.appId,
      collectionKey: input.collectionKey,
      data: input.data,
      createdByUserId: input.caller.userId,
      subjectMembershipId,
      indexValues: buildIndexValues(collection, input.data),
      uniqueValues: buildUniqueValues(collection, input.data),
      principals,
      now: new Date(),
    });
    return this.toView(input.caller, collection, record);
  }

  /** 单条读取（无权 = 不可见 404）。 */
  async get(input: {
    appId: string;
    collectionKey: string;
    caller: CallerContext;
    recordId: string;
  }): Promise<RecordView> {
    const schema = await this.resolveSchema(input.appId);
    const collection = this.resolveCollection(schema, input.collectionKey);
    assertCollectionAction(input.caller, collection, "read");
    const record = await this.data.findRecord(
      input.appId,
      input.collectionKey,
      input.recordId,
    );
    if (!record || record.deletedAt) throw notFound();
    const principal = await this.data.isPrincipal(
      input.appId,
      record.id,
      input.caller.membershipId,
    );
    if (!canSeeRecord(input.caller, collection, record, principal)) {
      throw notFound();
    }
    return this.toView(input.caller, collection, record);
  }

  /** 查询（固定契约；无权记录不出现在页中）。 */
  async query(input: {
    appId: string;
    collectionKey: string;
    caller: CallerContext;
    body: unknown;
  }): Promise<{ items: RecordView[]; nextCursor: string | null }> {
    const schema = await this.resolveSchema(input.appId);
    const collection = this.resolveCollection(schema, input.collectionKey);
    assertCollectionAction(input.caller, collection, "read");
    const request = dataQueryRequestSchema.parse(input.body ?? {});
    const compiled = compileQuery(collection, request);
    // 评审修复（查询预言机）：where/orderBy 字段必须对调用方可读且未脱敏，
    // 否则调用方可由结果差异探测其无权读取字段的值。
    const queriedFieldKeys = [
      ...compiled.conditions.map((condition) => condition.fieldKey),
      ...(compiled.orderBy ? [compiled.orderBy.fieldKey] : []),
    ];
    for (const key of queriedFieldKeys) {
      const field = collection.fields.find((f) => f.key === key)!;
      const readable = (field.read ?? ["owner", "editor", "viewer"]).includes(
        input.caller.role,
      );
      const masked = field.maskedRead?.roles.includes(input.caller.role) ?? false;
      if (!readable || masked) {
        throw new QueryRejected(
          `字段不可由当前角色查询/排序：${key}`,
        );
      }
    }
    compiled.scopeClause = this.scopeClause(input.caller, collection);
    const rows = await this.data.queryRecords(
      { appId: input.appId, collectionKey: input.collectionKey },
      compiled,
    );
    const hasMore = rows.length > compiled.limit;
    const page = rows.slice(0, compiled.limit);
    const items = page.map((r) => this.toView(input.caller, collection, r));
    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]!;
      nextCursor = encodeCursor({
        collectionKey: input.collectionKey,
        where: request.where ?? [],
        orderBy: request.orderBy ?? null,
        // 评审修复：游标携带真实排序值（此前恒为 null 导致翻页错误）
        sortValue: (() => {
          const value = (last as { __sortValue?: unknown }).__sortValue;
          if (value instanceof Date) return value.toISOString();
          return value ?? null;
        })(),
        recordId: last.id,
      });
    }
    return { items, nextCursor };
  }

  /** 更新（expectedRevision 条件；冲突 → 409 + 当前记录与 revision）。 */
  async update(input: {
    appId: string;
    collectionKey: string;
    caller: CallerContext;
    recordId: string;
    expectedRevision: unknown;
    patch: Record<string, unknown>;
    subjectMembershipId?: unknown;
    principals?: unknown;
  }): Promise<RecordView> {
    const schema = await this.resolveSchema(input.appId);
    const collection = this.resolveCollection(schema, input.collectionKey);
    assertCollectionAction(input.caller, collection, "update");
    const record = await this.data.findRecord(
      input.appId,
      input.collectionKey,
      input.recordId,
    );
    if (!record || record.deletedAt) throw notFound();
    const principal = await this.data.isPrincipal(
      input.appId,
      record.id,
      input.caller.membershipId,
    );
    if (!canSeeRecord(input.caller, collection, record, principal)) {
      throw notFound();
    }
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw conflict("revision_required", "更新必须携带 expectedRevision");
    }
    assertWritableFields(input.caller, collection, input.patch);
    const merged = {
      ...(record.data as Record<string, unknown>),
      ...input.patch,
    };
    validateFieldValues(collection, merged, false);
    const size = Buffer.byteLength(JSON.stringify(merged), "utf8");
    if (size > LIMITS.recordMaxBytes) {
      throw conflict(
        "limit_record_bytes",
        `记录大小超限：${size} > ${LIMITS.recordMaxBytes}`,
      );
    }
    let subjectMembershipId = record.subjectMembershipId;
    if (
      collection.recordScope === "subject_only" &&
      typeof input.subjectMembershipId === "string"
    ) {
      const membership = await this.appRepository.findMembershipById(
        input.subjectMembershipId,
      );
      if (!membership || membership.appId !== input.appId) {
        throw new FieldValueError(
          { key: "subjectMembershipId" } as never,
          "主体成员不存在",
        );
      }
      subjectMembershipId = membership.id;
    }
    const principals =
      collection.recordScope === "assignee" && input.principals !== undefined
        ? await this.validatePrincipals(input.appId, input.principals)
        : [
            ...((await this.data.listPrincipals(input.appId, [record.id])).get(
              record.id,
            ) ?? []),
          ];
    const updated = await this.data.updateRecord({
      appId: input.appId,
      collectionKey: input.collectionKey,
      recordId: record.id,
      expectedRevision: input.expectedRevision,
      data: merged,
      updatedByUserId: input.caller.userId,
      subjectMembershipId,
      indexValues: buildIndexValues(collection, merged),
      uniqueValues: buildUniqueValues(collection, merged),
      principals,
      now: new Date(),
    });
    if (!updated) {
      // 修订冲突：回当前记录与 revision，不静默覆盖
      const current = await this.data.findRecord(
        input.appId,
        input.collectionKey,
        input.recordId,
      );
      throw new HttpError(409, "revision_conflict", "修订冲突", {
        currentRevision: current?.revision ?? null,
        current: current
          ? this.toView(input.caller, collection, current)
          : null,
      });
    }
    return this.toView(input.caller, collection, updated);
  }

  /** 删除（成员侧仅 owner；expectedRevision；回收站 30 天）。 */
  async remove(input: {
    appId: string;
    collectionKey: string;
    caller: CallerContext;
    recordId: string;
    expectedRevision: unknown;
  }): Promise<void> {
    const schema = await this.resolveSchema(input.appId);
    const collection = this.resolveCollection(schema, input.collectionKey);
    assertCollectionAction(input.caller, collection, "delete");
    const record = await this.data.findRecord(
      input.appId,
      input.collectionKey,
      input.recordId,
    );
    if (!record || record.deletedAt) throw notFound();
    if (
      typeof input.expectedRevision !== "number" ||
      !Number.isInteger(input.expectedRevision)
    ) {
      throw conflict("revision_required", "删除必须携带 expectedRevision");
    }
    const now = new Date();
    const ok = await this.data.softDeleteRecord({
      appId: input.appId,
      collectionKey: input.collectionKey,
      recordId: record.id,
      expectedRevision: input.expectedRevision,
      deletedByUserId: input.caller.userId,
      now,
      expiresAt: new Date(
        now.getTime() + RECYCLE_BIN_DAYS * 24 * 60 * 60 * 1000,
      ),
    });
    if (!ok) {
      const current = await this.data.findRecord(
        input.appId,
        input.collectionKey,
        input.recordId,
      );
      throw new HttpError(409, "revision_conflict", "修订冲突", {
        currentRevision: current?.revision ?? null,
      });
    }
  }

  /** 导出（成员侧仅 owner；批次 500、总量 10000；与读同一授权链）。 */
  async export(input: {
    appId: string;
    collectionKey: string;
    caller: CallerContext;
  }): Promise<{
    format: "json";
    exportedAt: string;
    appId: string;
    collectionKey: string;
    items: RecordView[];
  }> {
    const schema = await this.resolveSchema(input.appId);
    const collection = this.resolveCollection(schema, input.collectionKey);
    assertCollectionAction(input.caller, collection, "export");
    const items: RecordView[] = [];
    let cursor: string | undefined;
    for (;;) {
      const compiled = compileQuery(collection, {
        limit: LIMITS.exportBatchSize,
        cursor,
      });
      const rows = await this.data.queryRecords(
        { appId: input.appId, collectionKey: input.collectionKey },
        compiled,
      );
      const page = rows.slice(0, LIMITS.exportBatchSize);
      for (const record of page) {
        if (items.length >= LIMITS.exportMaxRecords) {
          throw conflict(
            "export_limit_exceeded",
            `导出记录数超限：>${LIMITS.exportMaxRecords}`,
          );
        }
        items.push(this.toView(input.caller, collection, record));
      }
      if (
        page.length < LIMITS.exportBatchSize ||
        rows.length <= LIMITS.exportBatchSize
      ) {
        break;
      }
      cursor = encodeCursor({
        collectionKey: input.collectionKey,
        where: [],
        orderBy: null,
        sortValue: null,
        recordId: page[page.length - 1]!.id,
      });
    }
    return {
      format: "json",
      exportedAt: new Date().toISOString(),
      appId: input.appId,
      collectionKey: input.collectionKey,
      items,
    };
  }

  /**
   * DraftDataView（S5b，设计 §4.3）：草稿候选 Schema 下的只读数据视图，
   * 同时满足当前发布与候选两者的最严交集（动作/范围/字段/脱敏）。
   */
  async previewDraftData(input: {
    appId: string;
    draftId: string;
    collectionKey: string;
    caller: CallerContext;
  }): Promise<{ items: Array<Record<string, unknown>> }> {
    const draft = await this.releaseRepository.findDraftById(input.draftId);
    if (!draft || draft.appId !== input.appId) throw notFound();
    if (draft.businessSchema == null) throw notFound();
    const candidateSchema = validateBusinessSchema(draft.businessSchema);
    const currentSchema = await this.resolveSchema(input.appId);
    const currentCollection = findCollection(
      currentSchema,
      input.collectionKey,
    );
    const candidateCollection = findCollection(
      candidateSchema,
      input.collectionKey,
    );
    // 集合在任一侧缺失：最严交集 = 空视图
    if (!currentCollection || !candidateCollection) {
      return { items: [] };
    }
    // 动作：两侧都必须允许 read
    assertCollectionAction(input.caller, currentCollection, "read");
    assertCollectionAction(input.caller, candidateCollection, "read");
    // 范围：当前范围取数，再按候选范围逐条过滤（两侧都可见才可见）
    const compiled = compileQuery(currentCollection, {
      limit: LIMITS.queryMaxLimit,
    });
    compiled.scopeClause = this.scopeClause(input.caller, currentCollection);
    const rows = await this.data.queryRecords(
      { appId: input.appId, collectionKey: input.collectionKey },
      compiled,
    );
    const page = rows.slice(0, LIMITS.queryMaxLimit);
    const principalsMap = await this.data.listPrincipals(
      input.appId,
      page.map((r) => r.id),
    );
    const items: Array<Record<string, unknown>> = [];
    for (const record of page) {
      const principal = (principalsMap.get(record.id) ?? []).includes(
        input.caller.membershipId,
      );
      if (!canSeeRecord(input.caller, candidateCollection, record, principal)) {
        continue;
      }
      items.push({
        recordId: record.id,
        revision: record.revision,
        data: projectReadableDataIntersection(
          input.caller,
          currentCollection,
          candidateCollection,
          record.data as Record<string, unknown>,
        ),
      });
    }
    return { items };
  }
}

export {
  FieldValueError,
  FieldWriteDeniedError,
  PolicyDeniedError,
  QueryRejected,
};
