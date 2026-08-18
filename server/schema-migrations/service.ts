import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../persistence/database.ts";
import {
  businessIndexValues,
  businessRecordRevisions,
  businessRecords,
  businessUniqueValues,
  draftVersions,
  publishedVersions,
  recordPrincipals,
  releasePointers,
} from "../db/schema.ts";
import type {
  BusinessCollection,
  BusinessSchema,
} from "../business-data/schema-contract.ts";
import { findCollection } from "../business-data/schema-contract.ts";
import {
  MIGRATION_BATCH_SIZE,
  MIGRATION_MAX_RECORDS,
  MigrationRejected,
  assertPlanCoversDestructiveChanges,
  transformRecord,
  validateTransformedBatch,
  type DataMigrationPlan,
} from "./plan.ts";
import { normalizeUniqueValue } from "../business-data/policy.ts";

/**
 * Schema 迁移服务（S5b，设计 §4.4、AC5/AC7）：
 * 1. 在内存中对全部记录副本验证计划（批次 500，总量 50,000）；
 * 2. 原子提交：记录重写 + 投影重建 + 新版本 + 指针移动，同事务；
 * 3. 失败保留旧 Schema、旧数据、旧发布版本（事务回滚）；
 * 4. 反向计划同样先验证再允许存储；无反向计划不可跨 Schema 回滚。
 */
type MigrationTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class SchemaMigrationService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  private async loadCollectionRecords(
    appId: string,
    collectionKey: string,
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const out: Array<{ id: string; data: Record<string, unknown> }> = [];
    let afterId: string | null = null;
    for (;;) {
      const where = [
        eq(businessRecords.appId, appId),
        eq(businessRecords.collectionKey, collectionKey),
        isNull(businessRecords.deletedAt),
      ];
      if (afterId) where.push(gt(businessRecords.id, afterId));
      const rows = await this.db
        .select({ id: businessRecords.id, data: businessRecords.data })
        .from(businessRecords)
        .where(and(...where))
        .orderBy(asc(businessRecords.id))
        .limit(MIGRATION_BATCH_SIZE);
      for (const row of rows) {
        out.push({ id: row.id, data: row.data as Record<string, unknown> });
      }
      if (rows.length < MIGRATION_BATCH_SIZE) break;
      afterId = rows[rows.length - 1]!.id;
    }
    return out;
  }

  /**
   * 内存验证（不触碰存储）：返回每个集合变换后的记录映射。
   * 任何失败 → MigrationRejected，调用方不得继续。
   * recordsOverride：以内存记录集替代存储读取（反向计划验证用）。
   */
  async validatePlan(input: {
    appId: string;
    fromSchema: BusinessSchema;
    toSchema: BusinessSchema;
    plan: DataMigrationPlan;
    recordsOverride?: Map<string, Map<string, Record<string, unknown>>>;
  }): Promise<Map<string, Map<string, Record<string, unknown>>>> {
    assertPlanCoversDestructiveChanges(
      input.fromSchema,
      input.toSchema,
      input.plan,
    );
    const transformed = new Map<string, Map<string, Record<string, unknown>>>();
    const uniqueSeen = new Map<string, Set<string>>();
    let total = 0;
    for (const collection of input.toSchema.collections) {
      const existed = findCollection(input.fromSchema, collection.key);
      const override = input.recordsOverride?.get(collection.key);
      const records = override
        ? [...override.entries()].map(([id, data]) => ({ id, data }))
        : existed
          ? await this.loadCollectionRecords(input.appId, collection.key)
          : [];
      total += records.length;
      if (total > MIGRATION_MAX_RECORDS) {
        throw new MigrationRejected(
          "migration_limit_exceeded",
          `迁移记录总量超限：>${MIGRATION_MAX_RECORDS}`,
        );
      }
      const batch: Array<Record<string, unknown>> = [];
      const mapping = new Map<string, Record<string, unknown>>();
      for (const record of records) {
        const next = transformRecord(collection, input.plan, record.data);
        batch.push(next);
        mapping.set(record.id, next);
      }
      validateTransformedBatch(
        input.toSchema,
        collection.key,
        batch,
        uniqueSeen,
      );
      transformed.set(collection.key, mapping);
    }
    return transformed;
  }

  /**
   * 原子应用（设计 §4.4）：迁移 + 新版本 + 指针移动同事务。
   * 预验证结果由 validatePlan 提供（调用方必须先验证）。
   */
  async applyMigrationAndPublish(input: {
    appId: string;
    draftId: string;
    fromSchema: BusinessSchema;
    toSchema: BusinessSchema;
    plan: DataMigrationPlan;
    reversePlan: DataMigrationPlan | null;
    publishedByMembershipId: string;
    now: Date;
  }): Promise<{ publishedVersionId: string }> {
    // 二次内存验证（同一事务前）：防止验证与提交之间数据变化导致不一致。
    // 严格并发一致性由事务内重写时的行级条件与唯一约束兜底：
    // 任何冲突 → 事务回滚 → 旧 Schema/旧数据/旧版本保留。
    const transformed = await this.validatePlan({
      appId: input.appId,
      fromSchema: input.fromSchema,
      toSchema: input.toSchema,
      plan: input.plan,
    });
    return this.db.transaction(async (tx) => {
      // 1. 重写各集合记录（同事务；修订留痕）
      for (const collection of input.toSchema.collections) {
        const mapping = transformed.get(collection.key)!;
        if (mapping.size === 0) continue;
        for (const [recordId, data] of mapping) {
          await this.rewriteRecordInTx(tx, {
            appId: input.appId,
            collection,
            recordId,
            data,
            changedByUserId: input.publishedByMembershipId,
            now: input.now,
          });
        }
      }
      // 2. 删除被 drop 的集合（记录 + 投影 + 修订 + principals）
      for (const dropped of input.plan.dropCollections ?? []) {
        await this.dropCollectionInTx(tx, input.appId, dropped);
      }
      // 3. 新版本 + 指针移动（同事务）
      const drafts = await tx
        .select()
        .from(draftVersions)
        .where(
          and(
            eq(draftVersions.id, input.draftId),
            eq(draftVersions.appId, input.appId),
          ),
        )
        .limit(1);
      const draft = drafts[0];
      if (!draft || draft.status !== "ready") {
        throw new MigrationRejected("draft", "草稿不存在或不可发布");
      }
      const publishedVersionId = randomUUID();
      await tx.insert(publishedVersions).values({
        id: publishedVersionId,
        appId: input.appId,
        draftVersionId: draft.id,
        spec: draft.spec,
        businessSchema: draft.businessSchema,
        migrationPlan: input.plan,
        reversePlan: input.reversePlan,
        publishedByMembershipId: input.publishedByMembershipId,
        publishedAt: input.now,
      });
      await tx
        .insert(releasePointers)
        .values({
          appId: input.appId,
          publishedVersionId,
          updatedAt: input.now,
          revision: 1,
        })
        .onDuplicateKeyUpdate({
          set: { publishedVersionId, updatedAt: input.now },
        });
      return { publishedVersionId };
    });
  }

  /** 跨 Schema 回滚：应用当前版本的反向计划 + 指针移动（同事务）。 */
  async applyRollbackMigration(input: {
    appId: string;
    fromSchema: BusinessSchema;
    toSchema: BusinessSchema;
    reversePlan: DataMigrationPlan;
    targetPublishedVersionId: string;
    changedByUserId: string;
    now: Date;
  }): Promise<void> {
    const transformed = await this.validatePlan({
      appId: input.appId,
      fromSchema: input.fromSchema,
      toSchema: input.toSchema,
      plan: input.reversePlan,
    });
    await this.db.transaction(async (tx) => {
      for (const collection of input.toSchema.collections) {
        const mapping = transformed.get(collection.key)!;
        if (mapping.size === 0) continue;
        for (const [recordId, data] of mapping) {
          await this.rewriteRecordInTx(tx, {
            appId: input.appId,
            collection,
            recordId,
            data,
            changedByUserId: input.changedByUserId,
            now: input.now,
          });
        }
      }
      for (const dropped of input.reversePlan.dropCollections ?? []) {
        await this.dropCollectionInTx(tx, input.appId, dropped);
      }
      await tx
        .update(releasePointers)
        .set({
          publishedVersionId: input.targetPublishedVersionId,
          updatedAt: input.now,
        })
        .where(eq(releasePointers.appId, input.appId));
    });
  }

  private async rewriteRecordInTx(
    tx: MigrationTx,
    input: {
      appId: string;
      collection: BusinessCollection;
      recordId: string;
      data: Record<string, unknown>;
      changedByUserId: string;
      now: Date;
    },
  ): Promise<void> {
    // 读取当前 revision（同事务）；记录不存在/已删除 → 抛错回滚整个迁移
    const current = await tx
      .select({ revision: businessRecords.revision })
      .from(businessRecords)
      .where(
        and(
          eq(businessRecords.id, input.recordId),
          eq(businessRecords.appId, input.appId),
          isNull(businessRecords.deletedAt),
        ),
      )
      .limit(1);
    const revision = current[0]?.revision;
    if (revision === undefined) {
      throw new MigrationRejected(
        "migration_apply_failed",
        `记录在迁移期间不可写：${input.recordId}`,
      );
    }
    // 重写主记录（revision 递增，留痕迁移）
    await tx.execute(sql`
      UPDATE business_records
      SET data = ${JSON.stringify(input.data)},
          revision = revision + 1,
          updated_by_user_id = ${input.changedByUserId},
          updated_at = ${input.now}
      WHERE id = ${input.recordId} AND app_id = ${input.appId}
        AND deleted_at IS NULL
    `);
    await tx.insert(businessRecordRevisions).values({
      id: randomUUID(),
      appId: input.appId,
      recordId: input.recordId,
      revision: revision + 1,
      data: input.data,
      changedByUserId: input.changedByUserId,
      changedAt: input.now,
    });
    // 重建投影
    await tx
      .delete(businessIndexValues)
      .where(eq(businessIndexValues.recordId, input.recordId));
    await tx
      .delete(businessUniqueValues)
      .where(eq(businessUniqueValues.recordId, input.recordId));
    const indexRows: Array<typeof businessIndexValues.$inferInsert> = [];
    const uniqueRows: Array<typeof businessUniqueValues.$inferInsert> = [];
    for (const field of input.collection.fields) {
      const value = input.data[field.key];
      if (value === undefined || value === null) continue;
      if (field.queryable) {
        indexRows.push({
          id: randomUUID(),
          appId: input.appId,
          collectionKey: input.collection.key,
          recordId: input.recordId,
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
      if (field.unique) {
        uniqueRows.push({
          id: randomUUID(),
          appId: input.appId,
          collectionKey: input.collection.key,
          fieldKey: field.key,
          valueNormalized: normalizeUniqueValue(field, value),
          recordId: input.recordId,
          createdAt: input.now,
        });
      }
    }
    if (indexRows.length > 0) {
      await tx.insert(businessIndexValues).values(indexRows);
    }
    if (uniqueRows.length > 0) {
      await tx.insert(businessUniqueValues).values(uniqueRows);
    }
  }

  private async dropCollectionInTx(
    tx: MigrationTx,
    appId: string,
    collectionKey: string,
  ): Promise<void> {
    const rows = await tx
      .select({ id: businessRecords.id })
      .from(businessRecords)
      .where(
        and(
          eq(businessRecords.appId, appId),
          eq(businessRecords.collectionKey, collectionKey),
        ),
      );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    const { inArray } = await import("drizzle-orm");
    await tx
      .delete(businessIndexValues)
      .where(inArray(businessIndexValues.recordId, ids));
    await tx
      .delete(businessUniqueValues)
      .where(inArray(businessUniqueValues.recordId, ids));
    await tx
      .delete(recordPrincipals)
      .where(inArray(recordPrincipals.recordId, ids));
    await tx
      .delete(businessRecordRevisions)
      .where(inArray(businessRecordRevisions.recordId, ids));
    await tx.delete(businessRecords).where(inArray(businessRecords.id, ids));
  }
}
