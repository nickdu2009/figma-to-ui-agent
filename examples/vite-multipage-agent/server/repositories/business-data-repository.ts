import { and, asc, desc, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  businessIndexValues,
  businessRecordRevisions,
  businessRecords,
  businessUniqueValues,
  deletedItems,
  recordPrincipals,
  type BusinessRecordRow,
  type DeletedItemRow,
} from "../db/schema.ts";
import { randomUUID } from "node:crypto";
import { isDuplicateEntry } from "./errors.ts";

/**
 * 业务数据 Repository（S5a，设计 §4.4）。
 * 查询只走固定投影表（business_index_values），禁止动态物理索引。
 * 主记录 + 修订 + 投影 + 唯一投影在同事务写入（规则 6）。
 */

export interface RecordFilter {
  appId: string;
  collectionKey: string;
  includeDeleted?: boolean;
}

export interface CompiledQuery {
  /** 每个条件产出一个 fieldKey 上的子条件 */
  conditions: Array<{
    fieldKey: string;
    clause: SQL;
  }>;
  orderBy?: {
    fieldKey: string;
    direction: "asc" | "desc";
    /** 排序字段类型：决定原生比较列（评审修复：不再统一 CHAR cast） */
    fieldType: "string" | "number" | "boolean" | "date" | "enum";
  };
  limit: number;
  cursor?: { sortValue: unknown; recordId: string } | undefined;
  /** 记录范围追加的主记录条件 */
  scopeClause?: SQL | undefined;
}

export class BusinessDataRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async insertRecord(input: {
    appId: string;
    collectionKey: string;
    data: unknown;
    createdByUserId: string;
    subjectMembershipId: string | null;
    indexValues: Array<{
      fieldKey: string;
      valueText: string | null;
      valueNumber: number | null;
      valueBool: boolean | null;
      valueDate: Date | null;
    }>;
    uniqueValues: Array<{ fieldKey: string; valueNormalized: string }>;
    principals: string[];
    now: Date;
  }): Promise<BusinessRecordRow> {
    const recordId = randomUUID();
    return this.db.transaction(async (tx) => {
      const row: BusinessRecordRow = {
        id: recordId,
        appId: input.appId,
        collectionKey: input.collectionKey,
        data: input.data,
        revision: 1,
        createdByUserId: input.createdByUserId,
        updatedByUserId: input.createdByUserId,
        subjectMembershipId: input.subjectMembershipId,
        deletedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      await tx.insert(businessRecords).values(row);
      await tx.insert(businessRecordRevisions).values({
        id: randomUUID(),
        appId: input.appId,
        recordId,
        revision: 1,
        data: input.data,
        changedByUserId: input.createdByUserId,
        changedAt: input.now,
      });
      if (input.indexValues.length > 0) {
        await tx.insert(businessIndexValues).values(
          input.indexValues.map((v) => ({
            id: randomUUID(),
            appId: input.appId,
            collectionKey: input.collectionKey,
            recordId,
            fieldKey: v.fieldKey,
            valueText: v.valueText,
            valueNumber: v.valueNumber,
            valueBool: v.valueBool,
            valueDate: v.valueDate,
          })),
        );
      }
      if (input.uniqueValues.length > 0) {
        try {
          await tx.insert(businessUniqueValues).values(
            input.uniqueValues.map((v) => ({
              id: randomUUID(),
              appId: input.appId,
              collectionKey: input.collectionKey,
              fieldKey: v.fieldKey,
              valueNormalized: v.valueNormalized,
              recordId,
              createdAt: input.now,
            })),
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new UniqueConflictError(input.collectionKey);
          }
          throw error;
        }
      }
      if (input.principals.length > 0) {
        await tx.insert(recordPrincipals).values(
          input.principals.map((membershipId) => ({
            id: randomUUID(),
            appId: input.appId,
            collectionKey: input.collectionKey,
            recordId,
            principalMembershipId: membershipId,
            createdAt: input.now,
          })),
        );
      }
      return row;
    });
  }

  async findRecord(
    appId: string,
    collectionKey: string,
    recordId: string,
  ): Promise<BusinessRecordRow | null> {
    const rows = await this.db
      .select()
      .from(businessRecords)
      .where(
        and(
          eq(businessRecords.appId, appId),
          eq(businessRecords.collectionKey, collectionKey),
          eq(businessRecords.id, recordId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** expectedRevision 条件更新（409）；同事务重写修订与投影。 */
  async updateRecord(input: {
    appId: string;
    collectionKey: string;
    recordId: string;
    expectedRevision: number;
    data: unknown;
    updatedByUserId: string;
    subjectMembershipId: string | null;
    indexValues: Array<{
      fieldKey: string;
      valueText: string | null;
      valueNumber: number | null;
      valueBool: boolean | null;
      valueDate: Date | null;
    }>;
    uniqueValues: Array<{ fieldKey: string; valueNormalized: string }>;
    principals: string[];
    now: Date;
  }): Promise<BusinessRecordRow | null> {
    return this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(businessRecords)
        .set({
          data: input.data,
          revision: input.expectedRevision + 1,
          updatedByUserId: input.updatedByUserId,
          subjectMembershipId: input.subjectMembershipId,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(businessRecords.id, input.recordId),
            eq(businessRecords.appId, input.appId),
            eq(businessRecords.revision, input.expectedRevision),
            sql`${businessRecords.deletedAt} IS NULL`,
          ),
        );
      if (result.affectedRows !== 1) return null; // 修订冲突：无任何写入
      await tx.insert(businessRecordRevisions).values({
        id: randomUUID(),
        appId: input.appId,
        recordId: input.recordId,
        revision: input.expectedRevision + 1,
        data: input.data,
        changedByUserId: input.updatedByUserId,
        changedAt: input.now,
      });
      // 投影重建（同事务）
      await tx
        .delete(businessIndexValues)
        .where(eq(businessIndexValues.recordId, input.recordId));
      if (input.indexValues.length > 0) {
        await tx.insert(businessIndexValues).values(
          input.indexValues.map((v) => ({
            id: randomUUID(),
            appId: input.appId,
            collectionKey: input.collectionKey,
            recordId: input.recordId,
            fieldKey: v.fieldKey,
            valueText: v.valueText,
            valueNumber: v.valueNumber,
            valueBool: v.valueBool,
            valueDate: v.valueDate,
          })),
        );
      }
      await tx
        .delete(businessUniqueValues)
        .where(eq(businessUniqueValues.recordId, input.recordId));
      if (input.uniqueValues.length > 0) {
        try {
          await tx.insert(businessUniqueValues).values(
            input.uniqueValues.map((v) => ({
              id: randomUUID(),
              appId: input.appId,
              collectionKey: input.collectionKey,
              fieldKey: v.fieldKey,
              valueNormalized: v.valueNormalized,
              recordId: input.recordId,
              createdAt: input.now,
            })),
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new UniqueConflictError(input.collectionKey);
          }
          throw error;
        }
      }
      await tx
        .delete(recordPrincipals)
        .where(eq(recordPrincipals.recordId, input.recordId));
      if (input.principals.length > 0) {
        await tx.insert(recordPrincipals).values(
          input.principals.map((membershipId) => ({
            id: randomUUID(),
            appId: input.appId,
            collectionKey: input.collectionKey,
            recordId: input.recordId,
            principalMembershipId: membershipId,
            createdAt: input.now,
          })),
        );
      }
      const rows = await tx
        .select()
        .from(businessRecords)
        .where(eq(businessRecords.id, input.recordId))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  /** 软删除（expectedRevision 条件 + 回收站条目同事务）。 */
  async softDeleteRecord(input: {
    appId: string;
    collectionKey: string;
    recordId: string;
    expectedRevision: number;
    deletedByUserId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(businessRecords)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(
          and(
            eq(businessRecords.id, input.recordId),
            eq(businessRecords.appId, input.appId),
            eq(businessRecords.revision, input.expectedRevision),
            sql`${businessRecords.deletedAt} IS NULL`,
          ),
        );
      if (result.affectedRows !== 1) return false;
      // 唯一投影同步移除（软删除释放唯一值占用）
      await tx
        .delete(businessUniqueValues)
        .where(eq(businessUniqueValues.recordId, input.recordId));
      await tx
        .delete(businessIndexValues)
        .where(eq(businessIndexValues.recordId, input.recordId));
      await tx.insert(deletedItems).values({
        id: randomUUID(),
        appId: input.appId,
        itemType: "record",
        itemRef: input.recordId,
        collectionKey: input.collectionKey,
        deletedByUserId: input.deletedByUserId,
        deletedAt: input.now,
        expiresAt: input.expiresAt,
      });
      return true;
    });
  }

  async listPrincipals(
    appId: string,
    recordIds: string[],
  ): Promise<Map<string, string[]>> {
    if (recordIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(recordPrincipals)
      .where(
        and(
          eq(recordPrincipals.appId, appId),
          inArray(recordPrincipals.recordId, recordIds),
        ),
      );
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.recordId) ?? [];
      list.push(row.principalMembershipId);
      map.set(row.recordId, list);
    }
    return map;
  }

  async isPrincipal(
    appId: string,
    recordId: string,
    membershipId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: recordPrincipals.id })
      .from(recordPrincipals)
      .where(
        and(
          eq(recordPrincipals.appId, appId),
          eq(recordPrincipals.recordId, recordId),
          eq(recordPrincipals.principalMembershipId, membershipId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async countCollectionRecords(
    appId: string,
    collectionKey: string,
  ): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(businessRecords)
      .where(
        and(
          eq(businessRecords.appId, appId),
          eq(businessRecords.collectionKey, collectionKey),
          sql`${businessRecords.deletedAt} IS NULL`,
        ),
      );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * 编译后查询：投影表按条件分组取 recordId 交集，再回主记录表。
   * 排序以 recordId 稳定收尾；游标条件由编译器生成。
   */
  async queryRecords(
    filter: RecordFilter,
    query: CompiledQuery,
  ): Promise<Array<BusinessRecordRow & { __sortValue: unknown }>> {
    // 1. 投影交集：满足全部条件的 recordId
    let candidateIds: string[] | null = null;
    if (query.conditions.length > 0) {
      const perCondition: string[][] = [];
      for (const condition of query.conditions) {
        const rows = await this.db
          .select({ recordId: businessIndexValues.recordId })
          .from(businessIndexValues)
          .where(
            and(
              eq(businessIndexValues.appId, filter.appId),
              eq(businessIndexValues.collectionKey, filter.collectionKey),
              eq(businessIndexValues.fieldKey, condition.fieldKey),
              condition.clause,
            ),
          );
        perCondition.push(rows.map((r) => r.recordId));
      }
      const [first, ...rest] = perCondition;
      const set = new Set(first);
      for (const ids of rest) {
        const other = new Set(ids);
        for (const id of [...set]) {
          if (!other.has(id)) set.delete(id);
        }
      }
      candidateIds = [...set];
      if (candidateIds.length === 0) return [];
    }
    // 2. 主记录过滤 + 排序 + 游标
    const where: SQL[] = [
      eq(businessRecords.appId, filter.appId),
      eq(businessRecords.collectionKey, filter.collectionKey),
    ];
    if (!filter.includeDeleted) {
      where.push(sql`${businessRecords.deletedAt} IS NULL`);
    }
    if (candidateIds) {
      where.push(inArray(businessRecords.id, candidateIds));
    }
    if (query.scopeClause) where.push(query.scopeClause);
    if (query.cursor && !query.orderBy) {
      // 默认按 recordId 排序时的游标
      where.push(gt(businessRecords.id, query.cursor.recordId));
    }
    // 评审修复：按字段类型选原生比较列，不再统一 CHAR cast
    //（旧实现对 number/date 是字典序比较，排序与游标均错误）。
    const sortExpr = query.orderBy
      ? query.orderBy.fieldType === "number"
        ? sql`__sort.value_number`
        : query.orderBy.fieldType === "date"
          ? sql`__sort.value_date`
          : query.orderBy.fieldType === "boolean"
            ? sql`__sort.value_bool`
            : sql`__sort.value_text` // string/enum：utf8mb4_bin 精确排序
      : null;
    const sortSelect = sortExpr
      ? sql`${sortExpr} AS __sort_value`
      : sql`NULL AS __sort_value`;
    let orderBy: SQL[];
    if (query.orderBy && sortExpr) {
      // 排序字段走投影原生列；同值以 recordId 稳定收尾（方向一致）
      const dir = query.orderBy.direction === "desc" ? desc : asc;
      orderBy = [dir(sortExpr), dir(businessRecords.id)];
      // 排序查询只包含具有该字段值的记录：无值记录不参与排序结果，
      // 避免“首页含 NULL、后续页静默丢失”的不一致语义。
      where.push(isNotNull(sql`__sort.record_id`));
      if (query.cursor) {
        // 游标：原生类型字面量 + recordId 严格推进（方向感知）
        const cmp = query.orderBy.direction === "desc" ? lt : gt;
        const raw = query.cursor.sortValue;
        const sortLiteral =
          query.orderBy.fieldType === "number"
            ? sql`${Number(raw)}`
            : query.orderBy.fieldType === "date"
              ? sql`${new Date(String(raw))}`
              : query.orderBy.fieldType === "boolean"
                ? sql`${raw === true || raw === "true"}`
                : sql`${String(raw ?? "")}`;
        where.push(
          or(
            cmp(sortExpr, sortLiteral),
            and(
              eq(sortExpr, sortLiteral),
              cmp(businessRecords.id, query.cursor.recordId),
            ),
          )!,
        );
      }
    } else {
      orderBy = [asc(businessRecords.id)];
    }
    const sortJoin = query.orderBy
      ? sql`LEFT JOIN ${businessIndexValues} __sort ON __sort.record_id = ${businessRecords.id}
        AND __sort.app_id = ${filter.appId}
        AND __sort.collection_key = ${filter.collectionKey}
        AND __sort.field_key = ${query.orderBy.fieldKey}`
      : sql``;
    const result = await this.db.execute(sql`
      SELECT ${businessRecords}.*, ${sortSelect}
      FROM ${businessRecords}
      ${sortJoin}
      WHERE ${and(...where)}
      ORDER BY ${sql.join(orderBy, sql`, `)}
      LIMIT ${query.limit + 1}
    `);
    // mysql2 驱动返回 [rows, fields] 元组
    const rawRows = (Array.isArray(result)
      ? result[0]
      : result) as unknown as Array<Record<string, unknown>>;
    const records = rawRows.map((raw) => {
      const { __sort_value, ...rest } = raw;
      // 随行返回原生排序值，供服务层生成游标（Date 在游标中序列化为 ISO）
      return {
        ...(rest as unknown as BusinessRecordRow),
        __sortValue: (__sort_value ?? null) as unknown,
      };
    });
    return records;
  }

  async insertDeletedItem(input: {
    appId: string;
    itemType: string;
    itemRef: string;
    collectionKey: string | null;
    deletedByUserId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(deletedItems).values({
      id: randomUUID(),
      appId: input.appId,
      itemType: input.itemType,
      itemRef: input.itemRef,
      collectionKey: input.collectionKey,
      deletedByUserId: input.deletedByUserId,
      deletedAt: input.now,
      expiresAt: input.expiresAt,
    });
  }

  /** 回收站列表（按应用/类型）。 */
  async listDeletedItems(
    appId: string,
    itemType?: string,
  ): Promise<DeletedItemRow[]> {
    const where = [eq(deletedItems.appId, appId)];
    if (itemType) where.push(eq(deletedItems.itemType, itemType));
    return this.db
      .select()
      .from(deletedItems)
      .where(and(...where))
      .orderBy(desc(deletedItems.deletedAt));
  }

  /** 治理端点：按类型列出全部回收站条目（仅元数据）。 */
  async listAllDeletedItemsByType(itemType: string): Promise<DeletedItemRow[]> {
    return this.db
      .select()
      .from(deletedItems)
      .where(eq(deletedItems.itemType, itemType))
      .orderBy(desc(deletedItems.deletedAt));
  }

  async findDeletedItem(id: string): Promise<DeletedItemRow | null> {
    const rows = await this.db
      .select()
      .from(deletedItems)
      .where(eq(deletedItems.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async removeDeletedItem(id: string): Promise<void> {
    await this.db.delete(deletedItems).where(eq(deletedItems.id, id));
  }

  /**
   * 记录恢复（S5b，原子）：deleted_at 置空 + 投影重建 + 回收站条目移除，
   * 同事务；唯一值被占用 → UniqueConflictError（409），不产生部分写入。
   */
  async restoreRecord(input: {
    appId: string;
    collectionKey: string;
    recordId: string;
    deletedItemId: string;
    indexValues: Array<{
      fieldKey: string;
      valueText: string | null;
      valueNumber: number | null;
      valueBool: boolean | null;
      valueDate: Date | null;
    }>;
    uniqueValues: Array<{ fieldKey: string; valueNormalized: string }>;
    now: Date;
  }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(businessRecords)
        .set({ deletedAt: null, updatedAt: input.now })
        .where(
          and(
            eq(businessRecords.id, input.recordId),
            eq(businessRecords.appId, input.appId),
            sql`${businessRecords.deletedAt} IS NOT NULL`,
          ),
        );
      if (result.affectedRows !== 1) return false;
      if (input.indexValues.length > 0) {
        await tx.insert(businessIndexValues).values(
          input.indexValues.map((v) => ({
            id: randomUUID(),
            appId: input.appId,
            collectionKey: input.collectionKey,
            recordId: input.recordId,
            fieldKey: v.fieldKey,
            valueText: v.valueText,
            valueNumber: v.valueNumber,
            valueBool: v.valueBool,
            valueDate: v.valueDate,
          })),
        );
      }
      if (input.uniqueValues.length > 0) {
        try {
          await tx.insert(businessUniqueValues).values(
            input.uniqueValues.map((v) => ({
              id: randomUUID(),
              appId: input.appId,
              collectionKey: input.collectionKey,
              fieldKey: v.fieldKey,
              valueNormalized: v.valueNormalized,
              recordId: input.recordId,
              createdAt: input.now,
            })),
          );
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new UniqueConflictError(input.collectionKey);
          }
          throw error;
        }
      }
      await tx
        .delete(deletedItems)
        .where(eq(deletedItems.id, input.deletedItemId));
      return true;
    });
  }

  /** 过期回收站条目（有界、幂等清理用）。 */
  async listExpiredDeletedItems(
    now: Date,
    limit: number,
  ): Promise<DeletedItemRow[]> {
    return this.db
      .select()
      .from(deletedItems)
      .where(lt(deletedItems.expiresAt, now))
      .orderBy(asc(deletedItems.expiresAt))
      .limit(limit);
  }

  /** 硬删除记录（永久清理）：主记录 + 修订 + principals（投影软删时已移除）。 */
  async hardDeleteRecord(appId: string, recordId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(businessRecordRevisions)
        .where(eq(businessRecordRevisions.recordId, recordId));
      await tx
        .delete(recordPrincipals)
        .where(eq(recordPrincipals.recordId, recordId));
      await tx
        .delete(businessIndexValues)
        .where(eq(businessIndexValues.recordId, recordId));
      await tx
        .delete(businessUniqueValues)
        .where(eq(businessUniqueValues.recordId, recordId));
      await tx
        .delete(businessRecords)
        .where(
          and(
            eq(businessRecords.id, recordId),
            eq(businessRecords.appId, appId),
          ),
        );
    });
  }
}

export class UniqueConflictError extends Error {
  readonly code = "unique_conflict";
  constructor(collectionKey: string) {
    super(`唯一值冲突（集合 ${collectionKey}）`);
    this.name = "UniqueConflictError";
  }
}
