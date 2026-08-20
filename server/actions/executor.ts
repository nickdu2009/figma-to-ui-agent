/**
 * TransactionalBusinessActionExecutor（设计 §9.2/§9.3，计划 S8 动作 1–5）。
 *
 * 唯一服务端执行边界：所有 published 业务 custom Action 经此执行。
 * - 身份：只信 path appId + Session/Membership（调用方已解析 caller）；
 *   envelope 不含身份/角色/替代 appId。
 * - 读命令（queryRecords/loadRecordForm/downloadExport）：不建幂等账本，
 *   但在同一事务快照核对 ReleasePointer、解析 Schema/权限并执行查询。
 * - 写命令（createRecord/updateRecord/deleteRecord/submitForm 解析的单一
 *   opcode）：固定锁序 ReleasePointer(FOR UPDATE) → ledger claim → 记录
 *   mutation + 终态，全部在同一 UoW 事务；崩溃回滚无孤立 pending；重放
 *   重新鉴权后从 resultRef 投影（不重放 mutation）。
 * - 不同 hash 同 key → idempotency_key_conflict；权限/版本已变化 → 拒绝且
 *   不泄露旧结果。
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { businessRecords } from "../db/schema.ts";
import type { Database } from "../persistence/database.ts";
import type { AppRepository } from "../repositories/app-repository.ts";
import type { MysqlReleaseRepository } from "../repositories/release-repository.ts";
import type { BusinessDataRepository } from "../repositories/business-data-repository.ts";
import { UniqueConflictError } from "../repositories/business-data-repository.ts";
import type { MysqlBusinessActionIdempotencyRepository } from "../repositories/business-action-idempotency-repository.ts";
import { IdempotencyClaimConflictError } from "../repositories/business-action-idempotency-repository.ts";
import {
  LIMITS,
  findCollection,
  validateBusinessSchema,
  type BusinessCollection,
  type BusinessSchema,
} from "../business-data/schema-contract.ts";
import {
  FieldValueError,
  FieldWriteDeniedError,
  PolicyDeniedError,
  assertCollectionAction,
  assertWritableFields,
  canSeeRecord,
  validateFieldValues,
  type CallerContext,
} from "../business-data/policy.ts";
import {
  buildIndexValues,
  buildUniqueValues,
  toRecordView,
} from "../business-data/service.ts";
import {
  QueryRejected,
  compileQuery,
  encodeCursor,
  dataQueryRequestSchema,
} from "../data-query/compiler.ts";
import {
  BusinessActionError,
  computeRequestHash,
  createRecordParamsSchema,
  deleteRecordParamsSchema,
  downloadExportParamsSchema,
  loadRecordFormParamsSchema,
  queryRecordsParamsSchema,
  submitFormParamsSchema,
  updateRecordParamsSchema,
  type BusinessActionCommand,
  type BusinessActionResponse,
  type ResolvedMutation,
} from "./contracts.ts";
import {
  lockAndVerifyReleasePointer,
  runInBusinessActionUoW,
} from "./unit-of-work.ts";
import {
  CSV_MAX_RECORDS,
  encodeCsv,
  safeExportFileName,
} from "./csv-export.ts";
import type { UnitOfWork } from "../repositories/business-action-idempotency-repository.ts";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** 回收站保留期（与 BusinessDataService.RECYCLE_BIN_DAYS 一致）。 */
const RECYCLE_BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ExecutorDeps {
  db: Database;
  appRepository: AppRepository;
  releaseRepository: MysqlReleaseRepository;
  data: BusinessDataRepository;
  idempotency: MysqlBusinessActionIdempotencyRepository;
}

export interface ExecuteInput {
  appId: string;
  caller: CallerContext;
  command: BusinessActionCommand;
}

interface ResolvedContext {
  schema: BusinessSchema;
  collection: BusinessCollection;
}

function mapPolicyError(error: unknown): never {
  if (error instanceof PolicyDeniedError) {
    throw new BusinessActionError(403, "policy_denied", "无权执行该操作");
  }
  if (error instanceof FieldWriteDeniedError) {
    throw new BusinessActionError(400, "field_write_denied", "字段不可写");
  }
  if (error instanceof FieldValueError) {
    throw new BusinessActionError(400, "field_value_invalid", "字段值不合法");
  }
  if (error instanceof UniqueConflictError) {
    throw new BusinessActionError(409, "unique_conflict", "唯一值冲突");
  }
  if (error instanceof QueryRejected) {
    throw new BusinessActionError(400, "invalid_query", "查询不合法");
  }
  throw error;
}

export class TransactionalBusinessActionExecutor {
  private readonly db: Database;
  private readonly appRepository: AppRepository;
  private readonly releaseRepository: MysqlReleaseRepository;
  private readonly data: BusinessDataRepository;
  private readonly idempotency: MysqlBusinessActionIdempotencyRepository;

  constructor(deps: ExecutorDeps) {
    this.db = deps.db;
    this.appRepository = deps.appRepository;
    this.releaseRepository = deps.releaseRepository;
    this.data = deps.data;
    this.idempotency = deps.idempotency;
  }

  /** 主入口：按 actionName 分流读/写；全部错误归一化为 BusinessActionError。 */
  async execute(input: ExecuteInput): Promise<BusinessActionResponse> {
    const serverRequestId = randomUUID();
    try {
      const data = await this.executeInner(input);
      return { serverRequestId, status: "success", data };
    } catch (error) {
      if (error instanceof BusinessActionError) {
        return {
          serverRequestId,
          status: "error",
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        };
      }
      try {
        mapPolicyError(error);
      } catch (mapped) {
        if (mapped instanceof BusinessActionError) {
          return {
            serverRequestId,
            status: "error",
            error: { code: mapped.code, message: mapped.message },
          };
        }
        throw mapped;
      }
      throw error;
    }
  }

  private async executeInner(input: ExecuteInput): Promise<unknown> {
    const { command } = input;
    switch (command.actionName) {
      case "queryRecords":
        return this.executeQueryRecords(input);
      case "loadRecordForm":
        return this.executeLoadRecordForm(input);
      case "downloadExport":
        return this.executeDownloadExport(input);
      case "createRecord":
      case "updateRecord":
      case "deleteRecord":
        return this.executeWrite(input, this.resolveDirectMutation(command));
      case "submitForm":
        return this.executeWrite(input, this.resolveSubmitForm(command));
    }
  }

  private resolveDirectMutation(command: BusinessActionCommand): ResolvedMutation {
    if (command.actionName === "createRecord") {
      const params = createRecordParamsSchema.parse(command.canonicalParams);
      return {
        opcode: "createRecord",
        collectionKey: params.collectionKey,
        data: params.data,
        ...(params.subjectMembershipId
          ? { subjectMembershipId: params.subjectMembershipId }
          : {}),
        ...(params.principals ? { principals: params.principals } : {}),
      };
    }
    if (command.actionName === "updateRecord") {
      const params = updateRecordParamsSchema.parse(command.canonicalParams);
      return {
        opcode: "updateRecord",
        collectionKey: params.collectionKey,
        recordId: params.recordId,
        expectedRevision: params.expectedRevision,
        patch: params.patch,
        ...(params.subjectMembershipId
          ? { subjectMembershipId: params.subjectMembershipId }
          : {}),
        ...(params.principals ? { principals: params.principals } : {}),
      };
    }
    const params = deleteRecordParamsSchema.parse(command.canonicalParams);
    return {
      opcode: "deleteRecord",
      collectionKey: params.collectionKey,
      recordId: params.recordId,
      expectedRevision: params.expectedRevision,
    };
  }

  /** submitForm：唯一 opcode 解析（不递归 dispatch、不生成第二 key/事务）。 */
  private resolveSubmitForm(command: BusinessActionCommand): ResolvedMutation {
    const params = submitFormParamsSchema.parse(command.canonicalParams);
    if (params.mutation === "createRecord" && params.create) {
      return {
        opcode: "createRecord",
        collectionKey: params.create.collectionKey,
        data: params.create.data,
        ...(params.create.subjectMembershipId
          ? { subjectMembershipId: params.create.subjectMembershipId }
          : {}),
        ...(params.create.principals
          ? { principals: params.create.principals }
          : {}),
      };
    }
    if (params.mutation === "updateRecord" && params.update) {
      return {
        opcode: "updateRecord",
        collectionKey: params.update.collectionKey,
        recordId: params.update.recordId,
        expectedRevision: params.update.expectedRevision,
        patch: params.update.patch,
        ...(params.update.subjectMembershipId
          ? { subjectMembershipId: params.update.subjectMembershipId }
          : {}),
        ...(params.update.principals
          ? { principals: params.update.principals }
          : {}),
      };
    }
    throw new BusinessActionError(
      400,
      "action_params_invalid",
      "submitForm 参数与 mutation 不一致",
    );
  }

  /** 同事务快照解析 Schema/集合（ReleasePointer 已锁定核对）。 */
  private async resolveContext(
    tx: UnitOfWork,
    input: ExecuteInput,
    collectionKey: string,
  ): Promise<ResolvedContext> {
    await lockAndVerifyReleasePointer({
      tx,
      releaseRepository: this.releaseRepository,
      appId: input.appId,
      expectedPublishedVersionId: input.command.publishedVersionId,
    });
    const version =
      await this.releaseRepository.findPublishedVersionByIdInTransaction(
        tx,
        input.command.publishedVersionId,
      );
    if (!version || version.appId !== input.appId || version.businessSchema == null) {
      throw new BusinessActionError(404, "schema_not_found", "发布版本缺少业务 Schema");
    }
    const schema = validateBusinessSchema(version.businessSchema);
    const collection = findCollection(schema, collectionKey);
    if (!collection) {
      throw new BusinessActionError(404, "collection_not_found", "集合不存在");
    }
    return { schema, collection };
  }

  // ---------- 读命令 ----------

  private async executeQueryRecords(input: ExecuteInput): Promise<unknown> {
    const params = queryRecordsParamsSchema.parse(input.command.canonicalParams);
    return runInBusinessActionUoW(this.db, async (tx) => {
      const { collection } = await this.resolveContext(tx, input, params.collectionKey);
      assertCollectionAction(input.caller, collection, "read");
      const request = dataQueryRequestSchema.parse({
        where: params.where
          ? Object.entries(params.where).map(([field, value]) => ({
              field,
              op: "eq" as const,
              value,
            }))
          : undefined,
        orderBy: params.orderBy
          ? { field: params.orderBy.field, direction: params.orderBy.direction }
          : undefined,
        limit: params.limit,
        cursor: params.cursor,
      });
      const compiled = compileQuery(collection, request);
      this.assertQueriedFieldsReadable(input.caller, collection, compiled);
      compiled.scopeClause = this.scopeClause(input.caller, collection);
      const rows = await this.data.queryRecordsInTransaction(
        tx,
        { appId: input.appId, collectionKey: params.collectionKey },
        compiled,
      );
      const hasMore = rows.length > compiled.limit;
      const page = rows.slice(0, compiled.limit);
      const items = page.map((record) =>
        toRecordView(input.caller, collection, record),
      );
      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1];
        if (last) {
          nextCursor = encodeCursor({
            collectionKey: params.collectionKey,
            where: request.where ?? [],
            orderBy: request.orderBy ?? null,
            sortValue: readSortValue(last),
            recordId: last.id,
          });
        }
      }
      return { items, nextCursor };
    });
  }

  private async executeLoadRecordForm(input: ExecuteInput): Promise<unknown> {
    const params = loadRecordFormParamsSchema.parse(input.command.canonicalParams);
    return runInBusinessActionUoW(this.db, async (tx) => {
      const { collection } = await this.resolveContext(tx, input, params.collectionKey);
      assertCollectionAction(input.caller, collection, "read");
      const record = await this.data.findRecordInTransaction(
        tx,
        input.appId,
        params.collectionKey,
        params.recordId,
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
      if (!canSeeRecord(input.caller, collection, record, principal)) {
        throw new BusinessActionError(404, "record_not_found", "记录不存在");
      }
      return toRecordView(input.caller, collection, record);
    });
  }

  private async executeDownloadExport(input: ExecuteInput): Promise<unknown> {
    const params = downloadExportParamsSchema.parse(input.command.canonicalParams);
    return runInBusinessActionUoW(this.db, async (tx) => {
      const { collection } = await this.resolveContext(tx, input, params.collectionKey);
      assertCollectionAction(input.caller, collection, "export");
      const compiled = compileQuery(collection, { limit: LIMITS.exportMaxRecords });
      compiled.scopeClause = this.scopeClause(input.caller, collection);
      // 计数必须应用与导出相同的 scope；全集合计数既会错误拒绝受限
      // 调用者，也会成为侧信道。多取一行即可在同一快照内实施上限。
      compiled.limit = CSV_MAX_RECORDS;
      const rows = await this.data.queryRecordsInTransaction(
        tx,
        { appId: input.appId, collectionKey: params.collectionKey },
        compiled,
      );
      if (rows.length > CSV_MAX_RECORDS) {
        throw new BusinessActionError(
          413,
          "export_too_large",
          `导出记录数超限：>${CSV_MAX_RECORDS}`,
        );
      }
      const page = rows;
      const views = page.map((record) =>
        toRecordView(input.caller, collection, record),
      );
      // 授权投影后的字段集合（全部可读字段的键序固定）
      const headers = collection.fields
        .filter((field) =>
          (field.read ?? ["owner", "editor", "viewer"]).includes(input.caller.role),
        )
        .map((field) => field.key);
      const body = views.map((view) =>
        headers.map((header) => view.data[header] ?? null),
      );
      const csv = encodeCsv({ headers, rows: body, totalRows: page.length });
      const fileName = safeExportFileName(params.collectionKey, new Date());
      return {
        fileName,
        rowCount: csv.rowCount,
        byteLength: csv.byteLength,
        // CSV 正文经响应面下发（见 routes/runtime-actions.ts 的 export 通道）；
        // ActionResult 只携带完成摘要，字节不进入 Runtime state/Bundle/日志。
        __csvBody: csv.body,
      };
    });
  }

  // ---------- 写命令 ----------

  private async executeWrite(
    input: ExecuteInput,
    mutation: ResolvedMutation,
  ): Promise<unknown> {
    if (!input.command.idempotencyKey) {
      throw new BusinessActionError(
        400,
        "action_params_invalid",
        "写命令必须携带 idempotencyKey",
      );
    }
    const idempotencyKey = input.command.idempotencyKey;
    return runInBusinessActionUoW(this.db, async (tx) => {
      const { collection } = await this.resolveContext(
        tx,
        input,
        mutation.collectionKey,
      );
      const requestHash = computeRequestHash({
        protocolVersion: input.command.protocolVersion,
        appId: input.appId,
        membershipId: input.caller.membershipId,
        publishedVersionId: input.command.publishedVersionId,
        canonicalActionName: input.command.actionName,
        collectionKey: mutation.collectionKey,
        canonicalParams: input.command.canonicalParams ?? null,
      });
      let claim;
      try {
        claim = await this.idempotency.claimInTransaction(tx, {
          appId: input.appId,
          membershipId: input.caller.membershipId,
          canonicalActionName: input.command.actionName,
          idempotencyKey,
          protocolVersion: input.command.protocolVersion,
          publishedVersionId: input.command.publishedVersionId,
          requestHash,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        });
      } catch (error) {
        if (error instanceof IdempotencyClaimConflictError) {
          throw new BusinessActionError(
            409,
            "idempotency_key_conflict",
            "同一幂等键的请求内容不一致",
          );
        }
        throw error;
      }

      if (!claim.claimed) {
        // 重放：重新鉴权（resolveContext 已完成版本/集合核对；动作授权在下）
        const existing = claim.row;
        if (existing.status === "pending") {
          // 并发同 key/hash：只有锁持有者执行 mutation；非持有者按冲突处理
          throw new BusinessActionError(
            409,
            "idempotency_key_conflict",
            "相同请求正在执行中",
          );
        }
        if (existing.status === "failed") {
          throw new BusinessActionError(
            409,
            "idempotency_key_conflict",
            "该幂等键对应的请求已失败",
          );
        }
        // completed：从 resultRef 投影当次授权结果（不重放 mutation）
        return this.replayFromResultRef(tx, input, collection, existing.resultRef);
      }

      // 首次执行：mutation + 终态同事务
      try {
        const outcome = await this.applyMutation(tx, input, collection, mutation);
        await this.idempotency.completeInTransaction(tx, {
          id: claim.row.id,
          status: "completed",
          resultRef: outcome.resultRef,
          resultDigest: requestHash,
          stableResultCode: "success",
        });
        return outcome.view;
      } catch (error) {
        // 失败也同事务写终态（稳定码），业务 mutation 已部分写入时会随
        // 异常整体回滚——因此这里只在错误发生前未写业务数据时记录失败终态。
        const code =
          error instanceof BusinessActionError ? error.code : "internal_error";
        await this.idempotency.completeInTransaction(tx, {
          id: claim.row.id,
          status: "failed",
          stableResultCode: code,
        });
        throw error;
      }
    });
  }

  private async applyMutation(
    tx: UnitOfWork,
    input: ExecuteInput,
    collection: BusinessCollection,
    mutation: ResolvedMutation,
  ): Promise<{ view: unknown; resultRef: string }> {
    if (mutation.opcode === "createRecord") {
      assertCollectionAction(input.caller, collection, "create");
      assertWritableFields(input.caller, collection, mutation.data);
      validateFieldValues(collection, mutation.data, false);
      const size = Buffer.byteLength(JSON.stringify(mutation.data), "utf8");
      if (size > LIMITS.recordMaxBytes) {
        throw new BusinessActionError(
          409,
          "limit_record_bytes",
          `记录大小超限：${size} > ${LIMITS.recordMaxBytes}`,
        );
      }
      const count = await this.data.countCollectionRecordsInTransaction(
        tx,
        input.appId,
        mutation.collectionKey,
      );
      if (count >= LIMITS.collectionMaxRecords) {
        throw new BusinessActionError(
          409,
          "limit_collection_records",
          `集合记录数超限：${count} >= ${LIMITS.collectionMaxRecords}`,
        );
      }
      const subjectMembershipId = await this.resolveSubjectMembership(
        input,
        collection,
        mutation.subjectMembershipId,
      );
      const principals = await this.resolvePrincipals(
        input,
        collection,
        mutation.principals,
      );
      const recordId = randomUUID();
      const record = await this.data.insertRecordInTransaction(tx, {
        appId: input.appId,
        collectionKey: mutation.collectionKey,
        data: mutation.data,
        createdByUserId: input.caller.userId,
        subjectMembershipId,
        indexValues: buildIndexValues(collection, mutation.data),
        uniqueValues: buildUniqueValues(collection, mutation.data),
        principals,
        now: new Date(),
        recordId,
      });
      return {
        view: toRecordView(input.caller, collection, record),
        resultRef: `record:${record.id}`,
      };
    }

    // updateRecord / deleteRecord
    const isDelete = mutation.opcode === "deleteRecord";
    assertCollectionAction(
      input.caller,
      collection,
      isDelete ? "delete" : "update",
    );
    const record = await this.data.findRecordInTransaction(
      tx,
      input.appId,
      mutation.collectionKey,
      mutation.recordId,
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
    if (!canSeeRecord(input.caller, collection, record, principal)) {
      throw new BusinessActionError(404, "record_not_found", "记录不存在");
    }
    if (isDelete) {
      const view = toRecordView(input.caller, collection, record);
      const now = new Date();
      const deleted = await this.data.softDeleteRecordInTransaction(tx, {
        appId: input.appId,
        collectionKey: mutation.collectionKey,
        recordId: record.id,
        expectedRevision: mutation.expectedRevision,
        deletedByUserId: input.caller.userId,
        now,
        expiresAt: new Date(now.getTime() + RECYCLE_BIN_RETENTION_MS),
      });
      if (!deleted) {
        const current = await this.data.findRecordInTransaction(
          tx,
          input.appId,
          mutation.collectionKey,
          mutation.recordId,
        );
        throw new BusinessActionError(409, "revision_conflict", "修订冲突", {
          currentRevision: current?.revision ?? null,
          current: current
            ? toRecordView(input.caller, collection, current)
            : null,
        });
      }
      return { view, resultRef: `record:${record.id}` };
    }
    assertWritableFields(input.caller, collection, mutation.patch);
    const merged = {
      ...(record.data as Record<string, unknown>),
      ...mutation.patch,
    };
    validateFieldValues(collection, merged, false);
    const size = Buffer.byteLength(JSON.stringify(merged), "utf8");
    if (size > LIMITS.recordMaxBytes) {
      throw new BusinessActionError(
        409,
        "limit_record_bytes",
        `记录大小超限：${size} > ${LIMITS.recordMaxBytes}`,
      );
    }
    const subjectMembershipId =
      mutation.subjectMembershipId === undefined
        ? record.subjectMembershipId
        : await this.resolveSubjectMembership(
            input,
            collection,
            mutation.subjectMembershipId,
          );
    const principals =
      mutation.principals === undefined
        ? [
            ...(
              (await this.data.listPrincipalsInTransaction(tx, input.appId, [record.id])).get(
                record.id,
              ) ?? []
            ),
          ]
        : await this.resolvePrincipals(input, collection, mutation.principals);
    const updated = await this.data.updateRecordInTransaction(tx, {
      appId: input.appId,
      collectionKey: mutation.collectionKey,
      recordId: record.id,
      expectedRevision: mutation.expectedRevision,
      data: merged,
      updatedByUserId: input.caller.userId,
      subjectMembershipId,
      indexValues: buildIndexValues(collection, merged),
      uniqueValues: buildUniqueValues(collection, merged),
      principals,
      now: new Date(),
    });
    if (!updated) {
      const current = await this.data.findRecordInTransaction(
        tx,
        input.appId,
        mutation.collectionKey,
        mutation.recordId,
      );
      throw new BusinessActionError(409, "revision_conflict", "修订冲突", {
        currentRevision: current?.revision ?? null,
        current: current
          ? toRecordView(input.caller, collection, current)
          : null,
      });
    }
    return {
      view: toRecordView(input.caller, collection, updated),
      resultRef: `record:${updated.id}`,
    };
  }

  /** completed 账本的重放投影：重新鉴权后读 resultRef 指向的业务事实。 */
  private async replayFromResultRef(
    tx: UnitOfWork,
    input: ExecuteInput,
    collection: BusinessCollection,
    resultRef: string | null,
  ): Promise<unknown> {
    if (!resultRef || !resultRef.startsWith("record:")) {
      throw new BusinessActionError(
        409,
        "idempotency_key_conflict",
        "历史结果不可重放",
      );
    }
    const recordId = resultRef.slice("record:".length);
    const record = await this.data.findRecordInTransaction(
      tx,
      input.appId,
      collection.key,
      recordId,
    );
    if (!record || record.deletedAt) {
      throw new BusinessActionError(404, "record_not_found", "记录已不存在");
    }
    const principal = await this.data.isPrincipalInTransaction(
      tx,
      input.appId,
      record.id,
      input.caller.membershipId,
    );
    if (!canSeeRecord(input.caller, collection, record, principal)) {
      // 权限已变化：拒绝且不泄露旧结果
      throw new BusinessActionError(403, "policy_denied", "无权查看历史结果");
    }
    assertCollectionAction(input.caller, collection, "read");
    return toRecordView(input.caller, collection, record);
  }

  private async resolveSubjectMembership(
    input: ExecuteInput,
    collection: BusinessCollection,
    subjectMembershipId: string | undefined,
  ): Promise<string | null> {
    if (collection.recordScope !== "subject_only") return null;
    if (typeof subjectMembershipId !== "string") return null;
    const membership =
      await this.appRepository.findMembershipById(subjectMembershipId);
    if (!membership || membership.appId !== input.appId) {
      throw new BusinessActionError(
        400,
        "field_value_invalid",
        "主体成员不存在",
      );
    }
    return membership.id;
  }

  private async resolvePrincipals(
    input: ExecuteInput,
    collection: BusinessCollection,
    principals: string[] | undefined,
  ): Promise<string[]> {
    if (collection.recordScope !== "assignee" || principals === undefined) {
      return [];
    }
    if (principals.length > LIMITS.recordMaxPrincipals) {
      throw new BusinessActionError(
        409,
        "limit_principals",
        `principal 数超限：${principals.length} > ${LIMITS.recordMaxPrincipals}`,
      );
    }
    const out: string[] = [];
    for (const membershipId of principals) {
      const membership =
        await this.appRepository.findMembershipById(membershipId);
      if (!membership || membership.appId !== input.appId) {
        throw new BusinessActionError(
          400,
          "field_value_invalid",
          `成员不存在：${membershipId}`,
        );
      }
      out.push(membershipId);
    }
    return out;
  }

  private scopeClause(caller: CallerContext, collection: BusinessCollection) {
    // 与 BusinessDataService.scopeClause 同一语义（owner 无限制；assignee
    // 经 record_principals 子查询）。抽出独立实现以保持 executor 自足；
    // 两侧语义漂移由 business-data-uow-regression 测试约束。
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

  private assertQueriedFieldsReadable(
    caller: CallerContext,
    collection: BusinessCollection,
    compiled: {
      conditions: Array<{ fieldKey: string }>;
      orderBy?: { fieldKey: string } | null;
    },
  ): void {
    const queriedFieldKeys = [
      ...compiled.conditions.map((condition) => condition.fieldKey),
      ...(compiled.orderBy ? [compiled.orderBy.fieldKey] : []),
    ];
    for (const key of queriedFieldKeys) {
      const field = collection.fields.find((candidate) => candidate.key === key);
      if (!field) {
        throw new BusinessActionError(400, "invalid_query", `未知查询字段：${key}`);
      }
      const readable = (field.read ?? ["owner", "editor", "viewer"]).includes(
        caller.role,
      );
      const masked = field.maskedRead?.roles.includes(caller.role) ?? false;
      if (!readable || masked) {
        throw new BusinessActionError(
          400,
          "invalid_query",
          `字段不可由当前角色查询/排序：${key}`,
        );
      }
    }
  }
}

// scopeClause 的 SQL 辅助（与 BusinessDataService 同语义；见 regression 测试）
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
