import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../persistence/database.ts";
import {
  appPlans,
  apps,
  businessIndexValues,
  businessRecordRevisions,
  businessRecords,
  businessUniqueValues,
  chatMessages,
  chatThreads,
  deletedItems,
  draftVersions,
  generationLogs,
  generationRuns,
  invitations,
  memberships,
  publishedVersions,
  questionAnswers,
  questionSets,
  recordPrincipals,
  releasePointers,
} from "../db/schema.ts";
import { conflict, notFound } from "../middleware/errors.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { BusinessDataRepository } from "../repositories/business-data-repository.ts";
import { UniqueConflictError } from "../repositories/business-data-repository.ts";
import {
  findCollection,
  type BusinessCollection,
} from "../business-data/schema-contract.ts";
import { normalizeUniqueValue } from "../business-data/policy.ts";

/**
 * 回收站与平台治理（S5b，设计 §4.6、AC9/AC15）：
 * - 记录/应用删除进入回收站（30 天），正常路由对已删除应用全部关闭；
 * - 恢复原子完成：记录恢复重建投影并复查唯一占用；应用恢复仅治理端点；
 * - 永久清理有界（每次 ≤500 项）且幂等；普通请求绝不隐式永久清理。
 */
export const RECYCLE_BIN_RETENTION_DAYS = 30;
export const CLEANUP_BATCH = 500;

export class RecycleBinService {
  private readonly db: Database;
  private readonly appRepository: AppRepository;
  private readonly data: BusinessDataRepository;

  constructor(deps: {
    db: Database;
    appRepository: AppRepository;
    data: BusinessDataRepository;
  }) {
    this.db = deps.db;
    this.appRepository = deps.appRepository;
    this.data = deps.data;
  }

  /** owner 删除应用 → 回收站（正常路由随后全部 404）。 */
  async deleteApp(input: {
    appId: string;
    deletedByUserId: string;
  }): Promise<void> {
    const now = new Date();
    const moved = await this.appRepository.softDeleteApp(input.appId, now);
    if (!moved) throw notFound();
    await this.data.insertDeletedItem({
      appId: input.appId,
      itemType: "app",
      itemRef: input.appId,
      collectionKey: null,
      deletedByUserId: input.deletedByUserId,
      now,
      expiresAt: new Date(
        now.getTime() + RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
    });
  }

  /** 治理端点恢复应用（原子：状态恢复 + 回收站条目移除）。 */
  async restoreApp(appId: string): Promise<void> {
    const app = await this.appRepository.findAppById(appId);
    if (!app) throw notFound();
    if (app.status !== "deleted") {
      throw conflict("not_deleted", "应用不在回收站中");
    }
    await this.db.transaction(async (tx) => {
      const [result] = await tx
        .update(apps)
        .set({ status: "active", deletedAt: null, updatedAt: new Date() })
        .where(and(eq(apps.id, appId), eq(apps.status, "deleted")));
      if (result.affectedRows !== 1) {
        throw conflict("restore_conflict", "应用状态已变化");
      }
      await tx
        .delete(deletedItems)
        .where(
          and(
            eq(deletedItems.appId, appId),
            eq(deletedItems.itemType, "app"),
            eq(deletedItems.itemRef, appId),
          ),
        );
    });
  }

  /** owner 恢复记录（原子：undelete + 投影重建 + 唯一复查 + 条目移除）。 */
  async restoreRecord(input: {
    appId: string;
    deletedItemId: string;
    collection: BusinessCollection;
  }): Promise<void> {
    const item = await this.data.findDeletedItem(input.deletedItemId);
    if (!item || item.appId !== input.appId || item.itemType !== "record") {
      throw notFound();
    }
    const record = await this.data.findRecord(
      input.appId,
      item.collectionKey ?? "",
      item.itemRef,
    );
    if (!record || !record.deletedAt) throw notFound();
    const data = record.data as Record<string, unknown>;
    const indexValues: Array<{
      fieldKey: string;
      valueText: string | null;
      valueNumber: number | null;
      valueBool: boolean | null;
      valueDate: Date | null;
    }> = [];
    const uniqueValues: Array<{ fieldKey: string; valueNormalized: string }> =
      [];
    for (const field of input.collection.fields) {
      const value = data[field.key];
      if (value === undefined || value === null) continue;
      if (field.queryable) {
        indexValues.push({
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
        uniqueValues.push({
          fieldKey: field.key,
          valueNormalized: normalizeUniqueValue(field, value),
        });
      }
    }
    try {
      const restored = await this.data.restoreRecord({
        appId: input.appId,
        collectionKey: item.collectionKey ?? "",
        recordId: item.itemRef,
        deletedItemId: item.id,
        indexValues,
        uniqueValues,
        now: new Date(),
      });
      if (!restored) throw conflict("restore_conflict", "记录状态已变化");
    } catch (error) {
      if (error instanceof UniqueConflictError) {
        throw conflict("unique_conflict", "唯一值在删除期间已被占用，无法恢复");
      }
      throw error;
    }
  }

  /**
   * 过期永久清理（有界、幂等）：仅由启动扫描或 owner/admin 显式端点触发；
   * 普通请求绝不隐式调用。
   */
  async cleanupExpired(now: Date): Promise<number> {
    const expired = await this.data.listExpiredDeletedItems(now, CLEANUP_BATCH);
    let purged = 0;
    for (const item of expired) {
      if (item.itemType === "record") {
        await this.data.hardDeleteRecord(item.appId, item.itemRef);
      } else if (item.itemType === "app") {
        await this.hardDeleteAppCascade(item.appId);
      }
      await this.data.removeDeletedItem(item.id);
      purged += 1;
    }
    return purged;
  }

  /** 应用级联硬删除（永久清理；按依赖序，幂等）。 */
  private async hardDeleteAppCascade(appId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // 业务数据
      const recordRows = await tx
        .select({ id: businessRecords.id })
        .from(businessRecords)
        .where(eq(businessRecords.appId, appId));
      const recordIds = recordRows.map((r) => r.id);
      if (recordIds.length > 0) {
        await tx
          .delete(businessRecordRevisions)
          .where(inArray(businessRecordRevisions.recordId, recordIds));
        await tx
          .delete(businessIndexValues)
          .where(inArray(businessIndexValues.recordId, recordIds));
        await tx
          .delete(businessUniqueValues)
          .where(inArray(businessUniqueValues.recordId, recordIds));
        await tx
          .delete(recordPrincipals)
          .where(inArray(recordPrincipals.recordId, recordIds));
      }
      await tx.delete(businessRecords).where(eq(businessRecords.appId, appId));
      // 会话/问答/计划/日志
      const threadRows = await tx
        .select({ id: chatThreads.id })
        .from(chatThreads)
        .where(eq(chatThreads.appId, appId));
      const threadIds = threadRows.map((r) => r.id);
      if (threadIds.length > 0) {
        await tx
          .delete(chatMessages)
          .where(inArray(chatMessages.threadId, threadIds));
      }
      await tx.delete(chatThreads).where(eq(chatThreads.appId, appId));
      const qsRows = await tx
        .select({ id: questionSets.id })
        .from(questionSets)
        .where(eq(questionSets.appId, appId));
      const qsIds = qsRows.map((r) => r.id);
      if (qsIds.length > 0) {
        await tx
          .delete(questionAnswers)
          .where(inArray(questionAnswers.questionSetId, qsIds));
      }
      await tx.delete(questionSets).where(eq(questionSets.appId, appId));
      await tx.delete(appPlans).where(eq(appPlans.appId, appId));
      await tx.delete(generationLogs).where(eq(generationLogs.appId, appId));
      await tx.delete(generationRuns).where(eq(generationRuns.appId, appId));
      // 发布链
      await tx.delete(releasePointers).where(eq(releasePointers.appId, appId));
      await tx
        .delete(publishedVersions)
        .where(eq(publishedVersions.appId, appId));
      await tx.delete(draftVersions).where(eq(draftVersions.appId, appId));
      // 成员/邀请/回收站残留
      await tx.delete(memberships).where(eq(memberships.appId, appId));
      await tx.delete(invitations).where(eq(invitations.appId, appId));
      await tx.delete(deletedItems).where(eq(deletedItems.appId, appId));
      // 应用本体
      await tx.delete(apps).where(eq(apps.id, appId));
    });
  }
}

export { findCollection };
