/**
 * DraftDataView（设计 §4.3/§9.4，计划 S8 动作 6）。
 *
 * 草稿阶段业务数据视图：
 * - 数据源始终是当前已发布记录（草稿无独立数据写入面）；
 * - 策略为当前发布 Schema 与候选（draft）Schema 的最严交集：
 *   动作两侧都允许、范围两侧都可见、字段两侧都可读、任一侧脱敏则脱敏；
 * - 查询经 bounded compiler，游标绑定 appId/draftId/collection/query digest/
 *   policy version；漂移的游标稳定拒绝；
 * - 集合在任一侧缺失 → 空视图（不报错，最严交集为空）；
 * - 写入与导出稳定拒绝（draft_readonly），不触碰业务存储。
 */
import { createHash } from "node:crypto";
import type { Database } from "../persistence/database.ts";
import type { MysqlReleaseRepository } from "../repositories/release-repository.ts";
import type { BusinessDataRepository } from "../repositories/business-data-repository.ts";
import {
  findCollection,
  validateBusinessSchema,
  type BusinessCollection,
} from "../business-data/schema-contract.ts";
import {
  PolicyDeniedError,
  assertCollectionAction,
  canSeeRecord,
  projectReadableDataIntersection,
  type CallerContext,
} from "../business-data/policy.ts";
import {
  QueryRejected,
  compileQuery,
  dataQueryRequestSchema,
  encodeCursor,
} from "../data-query/compiler.ts";
import { BusinessActionError } from "../actions/contracts.ts";
import { runInBusinessActionUoW } from "../actions/unit-of-work.ts";

export interface DraftDataViewDeps {
  db: Database;
  releaseRepository: MysqlReleaseRepository;
  data: BusinessDataRepository;
}

export interface DraftDataViewItem {
  recordId: string;
  revision: number;
  data: Record<string, unknown>;
}

export class DraftDataViewService {
  private readonly db: Database;
  private readonly releaseRepository: MysqlReleaseRepository;
  private readonly data: BusinessDataRepository;

  constructor(deps: DraftDataViewDeps) {
    this.db = deps.db;
    this.releaseRepository = deps.releaseRepository;
    this.data = deps.data;
  }

  /** 交集上下文；集合任一侧缺失返回 null（空视图）。 */
  private async resolveIntersection(input: {
    appId: string;
    draftId: string;
    collectionKey: string;
  }): Promise<{
    current: BusinessCollection;
    candidate: BusinessCollection;
    binding: string;
  } | null> {
    const draft = await this.releaseRepository.findDraftById(input.draftId);
    if (!draft || draft.appId !== input.appId) {
      throw new BusinessActionError(
        404,
        "draft_data_unavailable",
        "草稿不存在",
      );
    }
    if (draft.businessSchema == null) {
      throw new BusinessActionError(
        404,
        "schema_not_found",
        "草稿缺少业务 Schema",
      );
    }
    const candidateSchema = validateBusinessSchema(draft.businessSchema);
    const pointer = await this.releaseRepository.getReleasePointer(input.appId);
    if (!pointer) {
      throw new BusinessActionError(
        404,
        "schema_not_found",
        "当前发布缺少业务 Schema",
      );
    }
    const version = await this.releaseRepository.findPublishedVersionById(
      pointer.publishedVersionId,
    );
    if (!version || version.businessSchema == null) {
      throw new BusinessActionError(
        404,
        "schema_not_found",
        "当前发布缺少业务 Schema",
      );
    }
    const currentSchema = validateBusinessSchema(version.businessSchema);
    const current = findCollection(currentSchema, input.collectionKey);
    const candidate = findCollection(candidateSchema, input.collectionKey);
    if (!current || !candidate) return null;
    // policy version digest：绑定游标到两侧 Schema 策略 + 版本身份
    const binding = createHash("sha256")
      .update(input.appId)
      .update("|")
      .update(input.draftId)
      .update("|")
      .update(pointer.publishedVersionId)
      .update("|")
      .update(
        JSON.stringify({
          current: policyFingerprint(current),
          candidate: policyFingerprint(candidate),
        }),
      )
      .digest("hex")
      .slice(0, 24);
    return { current, candidate, binding };
  }

  /** 交集 bounded 查询（只读；同事务快照）。 */
  async queryCollection(input: {
    appId: string;
    draftId: string;
    collectionKey: string;
    caller: CallerContext;
    request: unknown;
  }): Promise<{ items: DraftDataViewItem[]; nextCursor: string | null }> {
    const context = await this.resolveIntersection(input);
    if (!context) return { items: [], nextCursor: null };
    const { current, candidate, binding } = context;
    try {
      assertCollectionAction(input.caller, current, "read");
      assertCollectionAction(input.caller, candidate, "read");
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        throw new BusinessActionError(403, "policy_denied", "无权读取该集合");
      }
      throw error;
    }
    let request;
    try {
      request = dataQueryRequestSchema.parse(input.request ?? {});
    } catch {
      throw new BusinessActionError(400, "invalid_query", "查询不合法");
    }
    return runInBusinessActionUoW(this.db, async (tx) => {
      let compiled;
      try {
        compiled = compileQuery(current, request, { cursorBinding: binding });
      } catch (error) {
        if (error instanceof QueryRejected) {
          throw new BusinessActionError(400, "invalid_query", "查询不合法");
        }
        throw error;
      }
      compiled.scopeClause = scopeClauseFor(input.caller, current);
      const rows = await this.data.queryRecordsInTransaction(
        tx,
        { appId: input.appId, collectionKey: input.collectionKey },
        compiled,
      );
      const hasMore = rows.length > compiled.limit;
      const page = rows.slice(0, compiled.limit);
      const principalsMap = await this.data.listPrincipalsInTransaction(
        tx,
        input.appId,
        page.map((record) => record.id),
      );
      const items: DraftDataViewItem[] = [];
      for (const record of page) {
        const principal = (principalsMap.get(record.id) ?? []).includes(
          input.caller.membershipId,
        );
        if (
          !canSeeRecord(input.caller, candidate, record, principal) ||
          !canSeeRecord(input.caller, current, record, principal)
        ) {
          continue;
        }
        items.push({
          recordId: record.id,
          revision: record.revision,
          data: projectReadableDataIntersection(
            input.caller,
            current,
            candidate,
            record.data as Record<string, unknown>,
          ),
        });
      }
      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1];
        if (last) {
          nextCursor = encodeCursor({
            collectionKey: input.collectionKey,
            where: request.where ?? [],
            orderBy: request.orderBy ?? null,
            sortValue: readSortValue(last),
            recordId: last.id,
            binding,
          });
        }
      }
      return { items, nextCursor };
    });
  }

  /** 交集单条读取（Form hydration 迟到 load 的草稿面）。 */
  async getRecord(input: {
    appId: string;
    draftId: string;
    collectionKey: string;
    recordId: string;
    caller: CallerContext;
  }): Promise<DraftDataViewItem> {
    const context = await this.resolveIntersection(input);
    if (!context) {
      throw new BusinessActionError(404, "record_not_found", "记录不存在");
    }
    const { current, candidate } = context;
    try {
      assertCollectionAction(input.caller, current, "read");
      assertCollectionAction(input.caller, candidate, "read");
    } catch (error) {
      if (error instanceof PolicyDeniedError) {
        throw new BusinessActionError(403, "policy_denied", "无权读取该集合");
      }
      throw error;
    }
    return runInBusinessActionUoW(this.db, async (tx) => {
      const record = await this.data.findRecordInTransaction(
        tx,
        input.appId,
        input.collectionKey,
        input.recordId,
      );
      if (!record || record.deletedAt) {
        throw new BusinessActionError(404, "record_not_found", "记录不存在");
      }
      const principal = await this.data.isPrincipalInTransaction(
        tx,
        input.appId,
        record.id,
        input.caller.membershipId,
      );
      if (
        !canSeeRecord(input.caller, candidate, record, principal) ||
        !canSeeRecord(input.caller, current, record, principal)
      ) {
        throw new BusinessActionError(404, "record_not_found", "记录不存在");
      }
      return {
        recordId: record.id,
        revision: record.revision,
        data: projectReadableDataIntersection(
          input.caller,
          current,
          candidate,
          record.data as Record<string, unknown>,
        ),
      };
    });
  }

  /** 草稿写入/导出的稳定拒绝（不落存储、不建账本）。 */
  rejectWriteOrExport(): never {
    throw new BusinessActionError(
      409,
      "draft_readonly",
      "草稿阶段业务数据只读，发布后可写",
    );
  }
}

function policyFingerprint(collection: BusinessCollection): unknown {
  return {
    key: collection.key,
    recordScope: collection.recordScope,
    actions: collection.actions,
    fields: collection.fields.map((field) => ({
      key: field.key,
      read: field.read ?? null,
      masked: field.maskedRead ?? null,
    })),
  };
}

function scopeClauseFor(caller: CallerContext, collection: BusinessCollection) {
  // 与 BusinessDataService.scopeClause 同语义；漂移由 regression 测试约束。
  if (caller.role === "owner") return undefined;
  switch (collection.recordScope) {
    case "shared":
      return undefined;
    case "creator_only":
      return sqlCreatorOnly(caller.userId);
    case "subject_only":
      return sqlSubjectOnly(caller.membershipId);
    case "assignee":
      return sqlAssignee(caller.userId, caller.membershipId);
  }
}

import { sql } from "drizzle-orm";
import { businessRecords } from "../db/schema.ts";

function sqlCreatorOnly(userId: string) {
  return sql`${businessRecords.createdByUserId} = ${userId}`;
}
function sqlSubjectOnly(membershipId: string) {
  return sql`${businessRecords.subjectMembershipId} = ${membershipId}`;
}
function sqlAssignee(userId: string, membershipId: string) {
  return sql`(${businessRecords.createdByUserId} = ${userId}
    OR ${businessRecords.id} IN (
      SELECT record_id FROM record_principals
      WHERE principal_membership_id = ${membershipId}
    ))`;
}

function readSortValue(record: unknown): string | number | null {
  const value = (record as { __sortValue?: unknown }).__sortValue;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  return null;
}
