/**
 * 受控业务 Action 服务端合同（设计 §9.2/§9.3，计划 S8）。
 *
 * - BusinessActionCommand envelope 由宿主构造、strict Schema 校验：只含
 *   protocolVersion/publishedVersionId/actionName/idempotencyKey?/canonicalParams；
 *   不得包含 appId/userId/membershipId/角色/权限（可信身份只来自 URL path +
 *   服务端 Session/Membership 解析）。
 * - publishedVersionId 必须与宿主附加的 X-VMA-Published-Version header 相同；
 *   Hono 在业务 Schema/权限解析与 mutation 的同一事务边界核对它仍等于
 *   ReleasePointer，错配返回 409/published_version_changed 且不执行读写。
 * - requestHash 用 §10.3 canonical helper：覆盖 protocolVersion、appId、
 *   membershipId、publishedVersionId、canonicalActionName、collectionKey、
 *   规范 params/expectedRevision。
 * - 稳定错误码闭合：组件只依赖 code，不依赖服务端实现文本。
 */
import { z } from "zod";
import { canonicalJsonString } from "../../src/catalog/canonical-json.ts";
import { createHash } from "node:crypto";

export const RUNTIME_ACTION_PROTOCOL_VERSION = 1 as const;

/** 宿主附加的发布版本 header（Spec 不可控）。 */
export const PUBLISHED_VERSION_HEADER = "x-vma-published-version";

/** 10 个 P0 custom Action 中经服务端执行的 7 个（ui 类 3 个本地执行）。 */
export const SERVER_ACTION_NAMES = [
  "queryRecords",
  "loadRecordForm",
  "createRecord",
  "updateRecord",
  "deleteRecord",
  "downloadExport",
  "submitForm",
] as const;
export type ServerActionName = (typeof SERVER_ACTION_NAMES)[number];

export const WRITE_ACTION_NAMES = [
  "createRecord",
  "updateRecord",
  "deleteRecord",
  "submitForm",
] as const;
export type WriteActionName = (typeof WRITE_ACTION_NAMES)[number];

export function isWriteAction(name: ServerActionName): name is WriteActionName {
  return (WRITE_ACTION_NAMES as readonly string[]).includes(name);
}

/** BusinessActionCommand envelope（strict；身份字段一律拒绝）。 */
export const businessActionCommandSchema = z
  .object({
    protocolVersion: z.literal(RUNTIME_ACTION_PROTOCOL_VERSION),
    publishedVersionId: z.string().min(1).max(64),
    actionName: z.enum(SERVER_ACTION_NAMES),
    idempotencyKey: z.string().min(8).max(128).optional(),
    canonicalParams: z.unknown(),
  })
  .strict();

export type BusinessActionCommand = z.infer<typeof businessActionCommandSchema>;

/** submitForm 解析后的唯一 mutation opcode（设计 §9.2：不递归 dispatch）。 */
export type ResolvedMutation =
  | {
      opcode: "createRecord";
      collectionKey: string;
      data: Record<string, unknown>;
      subjectMembershipId?: string;
      principals?: string[];
    }
  | {
      opcode: "updateRecord";
      collectionKey: string;
      recordId: string;
      expectedRevision: number;
      patch: Record<string, unknown>;
      subjectMembershipId?: string;
      principals?: string[];
    }
  | {
      opcode: "deleteRecord";
      collectionKey: string;
      recordId: string;
      expectedRevision: number;
    };

/** create/update/delete/submitForm 的规范参数（canonicalParams 形状）。 */
export const createRecordParamsSchema = z
  .object({
    collectionKey: z.string().min(1).max(64),
    data: z.record(z.string(), z.unknown()),
    subjectMembershipId: z.string().max(64).optional(),
    principals: z.array(z.string().max(64)).max(8).optional(),
  })
  .strict();

export const updateRecordParamsSchema = z
  .object({
    collectionKey: z.string().min(1).max(64),
    recordId: z.string().min(1).max(64),
    expectedRevision: z.number().int().positive(),
    patch: z.record(z.string(), z.unknown()),
    subjectMembershipId: z.string().max(64).optional(),
    principals: z.array(z.string().max(64)).max(8).optional(),
  })
  .strict();

export const deleteRecordParamsSchema = z
  .object({
    collectionKey: z.string().min(1).max(64),
    recordId: z.string().min(1).max(64),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export const queryRecordsParamsSchema = z
  .object({
    collectionKey: z.string().min(1).max(64),
    where: z.record(z.string(), z.unknown()).optional(),
    orderBy: z
      .object({ field: z.string().min(1).max(64), direction: z.enum(["asc", "desc"]) })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(512).optional(),
  })
  .strict();

export const loadRecordFormParamsSchema = z
  .object({
    collectionKey: z.string().min(1).max(64),
    recordId: z.string().min(1).max(64),
  })
  .strict();

export const downloadExportParamsSchema = z
  .object({
    collectionKey: z.string().min(1).max(64),
    query: queryRecordsParamsSchema.omit({ collectionKey: true, cursor: true }).optional(),
  })
  .strict();

/** submitForm：客户端已完成类型/required 检查，携带解析后的唯一 opcode。 */
export const submitFormParamsSchema = z
  .object({
    mutation: z.enum(["createRecord", "updateRecord"]),
    create: createRecordParamsSchema.optional(),
    update: updateRecordParamsSchema.optional(),
  })
  .strict()
  .refine((value) => (value.mutation === "createRecord" ? !!value.create : !!value.update), {
    message: "submitForm 参数与 mutation 不一致",
  });

/** 服务端稳定错误码（闭合；ActionResult.error.code 只允许这些值）。 */
export type BusinessActionErrorCode =
  | "action_forbidden"
  | "action_params_invalid"
  | "published_version_changed"
  | "idempotency_key_conflict"
  | "revision_conflict"
  | "revision_required"
  | "unique_conflict"
  | "limit_record_bytes"
  | "limit_collection_records"
  | "limit_principals"
  | "invalid_query"
  | "field_value_invalid"
  | "field_write_denied"
  | "policy_denied"
  | "record_not_found"
  | "collection_not_found"
  | "schema_not_found"
  | "export_too_large"
  | "draft_data_unavailable"
  | "draft_readonly"
  | "internal_error";

export class BusinessActionError extends Error {
  readonly code: BusinessActionErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(
    status: number,
    code: BusinessActionErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BusinessActionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** requestHash：canonical JSON 覆盖身份/版本/动作/集合/规范参数。 */
export function computeRequestHash(input: {
  protocolVersion: number;
  appId: string;
  membershipId: string;
  publishedVersionId: string;
  canonicalActionName: string;
  collectionKey: string;
  canonicalParams: unknown;
}): string {
  const canonical = canonicalJsonString({
    protocolVersion: input.protocolVersion,
    appId: input.appId,
    membershipId: input.membershipId,
    publishedVersionId: input.publishedVersionId,
    canonicalActionName: input.canonicalActionName,
    collectionKey: input.collectionKey,
    canonicalParams: input.canonicalParams ?? null,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/** ActionResult 成功/失败响应体（dispatchId 由宿主在客户端拼回）。 */
export interface BusinessActionResponse {
  serverRequestId: string;
  status: "success" | "error";
  data?: unknown;
  error?: { code: BusinessActionErrorCode; message: string; details?: Record<string, unknown> };
}
