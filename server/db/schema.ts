import {
  bigint,
  boolean,
  check,
  datetime,
  double,
  foreignKey,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * 平台表 Schema（S1 范围：账号/成员、应用/发布、工作区、开发收件箱）。
 * S5a 扩展：业务数据表（BusinessRecord/Revisions/IndexValue/UniqueValue/
 * RecordPrincipal/DeletedItem）。回收站治理在 S5b 扩展服务层。
 *
 * 约定：
 * - ID 均为应用侧生成的 UUID（varchar(36)），不使用自增。
 * - 时间均为 datetime(3)，由应用侧写入 UTC；defaultNow 仅作兜底。
 * - 每个可变聚合带 revision，用于 expectedRevision 条件更新（409）。
 * - emailNormalized 的唯一约束必须按大小写敏感精确语义执行：
 *   由 server/db/migrations 中的 custom 迁移将列改为 utf8mb4_bin
 *   （GATE-00 决策补充 §1；MySQL 默认 collation 大小写不敏感，禁止依赖）。
 * - 业务数据的规范化/投影列（value_normalized/value_text）同样使用
 *   utf8mb4_bin（大小写敏感精确比较，GATE-00 §1/设计 §9）。
 * - 禁止动态创建按应用或字段增长的物理索引：查询只走以下固定投影表。
 */

const id = () => varchar("id", { length: 36 });
const createdAt = () =>
  datetime("created_at", { mode: "date", fsp: 3 }).notNull();
const updatedAt = () =>
  datetime("updated_at", { mode: "date", fsp: 3 }).notNull();
const revision = () => int("revision").notNull().default(1);
/** `sha256:` + 64 位小写十六进制 = 71 字符（DS S2 digest 列统一长度）。 */
const digestCol = (name: string) => varchar(name, { length: 71 });

// ---------- 账号与成员 ----------

export const users = mysqlTable(
  "users",
  {
    id: id().primaryKey(),
    emailNormalized: varchar("email_normalized", { length: 255 }).notNull(),
    emailDisplay: varchar("email_display", { length: 255 }).notNull(),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [uniqueIndex("users_email_normalized").on(t.emailNormalized)],
);

export const authChallenges = mysqlTable(
  "auth_challenges",
  {
    id: id().primaryKey(),
    emailNormalized: varchar("email_normalized", { length: 255 }).notNull(),
    method: varchar("method", { length: 16 }).notNull(), // 'otp' | 'magic_link'
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    consumedAt: datetime("consumed_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("auth_challenges_token_digest").on(t.tokenDigest),
    index("auth_challenges_email").on(t.emailNormalized),
  ],
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: id().primaryKey(),
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    createdAt: createdAt(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    lastSeenAt: datetime("last_seen_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_digest").on(t.tokenDigest),
    index("sessions_user").on(t.userId),
  ],
);

export const creatorGrants = mysqlTable(
  "creator_grants",
  {
    id: id().primaryKey(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    grantedByUserId: varchar("granted_by_user_id", { length: 36 }).notNull(),
    createdAt: createdAt(),
    revokedAt: datetime("revoked_at", { mode: "date", fsp: 3 }),
    // 'active' 或 NULL：配合唯一索引保证每用户至多一个有效资格
    activeMarker: varchar("active_marker", { length: 8 }),
    revision: revision(),
  },
  (t) => [
    uniqueIndex("creator_grants_user_active").on(t.userId, t.activeMarker),
  ],
);

export const invitations = mysqlTable(
  "invitations",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    emailNormalized: varchar("email_normalized", { length: 255 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(), // 'editor' | 'viewer'
    createdByUserId: varchar("created_by_user_id", { length: 36 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    revokedAt: datetime("revoked_at", { mode: "date", fsp: 3 }),
    acceptedAt: datetime("accepted_at", { mode: "date", fsp: 3 }),
    acceptedMembershipId: varchar("accepted_membership_id", { length: 36 }),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [index("invitations_app").on(t.appId)],
);

export const memberships = mysqlTable(
  "memberships",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(), // 'owner'|'editor'|'viewer'
    status: varchar("status", { length: 16 }).notNull(), // 'active' | 'removed'
    // 'active' 或 NULL：重新加入得到新 Membership ID，旧行不复活（设计 §4.1）
    activeMarker: varchar("active_marker", { length: 8 }),
    createdAt: createdAt(),
    removedAt: datetime("removed_at", { mode: "date", fsp: 3 }),
    revision: revision(),
  },
  (t) => [
    uniqueIndex("memberships_app_user_active").on(
      t.appId,
      t.userId,
      t.activeMarker,
    ),
    index("memberships_user").on(t.userId),
    index("memberships_app").on(t.appId),
  ],
);

// ---------- 应用、草稿与发布 ----------

export const apps = mysqlTable("apps", {
  id: id().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 36 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(), // 'active'|'archived'|'deleted'
  deletedAt: datetime("deleted_at", { mode: "date", fsp: 3 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  revision: revision(),
});

export const generationRuns = mysqlTable(
  "generation_runs",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    // 'running' | 'validation_running' | 'awaiting_preview' |
    // 'recovery_pending' | 'recovery_consumed' | 'succeeded' | 'failed' | 'incomplete'
    // （设计 §13.2.1 闭合状态机；不增加 validation_failed 状态）
    status: varchar("status", { length: 24 }).notNull(),
    // 生成流水线内的 generationId（关联 AG-UI 事件与持久事实，设计 §4.2）
    correlationRef: varchar("correlation_ref", { length: 128 }),
    candidateSpec: json("candidate_spec"),
    candidateBusinessSchema: json("candidate_business_schema"),
    diagnostics: json("diagnostics"),
    lastHeartbeatAt: datetime("last_heartbeat_at", { mode: "date", fsp: 3 }),
    createdByMembershipId: varchar("created_by_membership_id", { length: 36 }),
    // ---------- DS S2 扩展（设计 §13.2.1，全部 nullable） ----------
    candidateBundle: json("candidate_bundle"),
    catalogVersion: varchar("catalog_version", { length: 16 }),
    validationIssues: json("validation_issues"),
    fatalVisualIssues: json("fatal_visual_issues"),
    publishBlocked: boolean("publish_blocked"),
    candidateDigest: digestCol("candidate_digest"),
    uiBundleDigest: digestCol("ui_bundle_digest"),
    digestVersion: int("digest_version"),
    validationProfileVersion: varchar("validation_profile_version", { length: 32 }),
    validationReport: json("validation_report"),
    reportDigest: digestCol("report_digest"),
    candidateMigrationPlan: json("candidate_migration_plan"),
    candidateReverseMigrationPlan: json("candidate_reverse_migration_plan"),
    migrationFromPublishedVersionId: varchar("migration_from_published_version_id", { length: 36 }),
    migrationFromSchemaDigest: digestCol("migration_from_schema_digest"),
    migrationToSchemaDigest: digestCol("migration_to_schema_digest"),
    // 创建时同事务固定，后续只读
    brandSourceSnapshot: json("brand_source_snapshot"),
    generationContextDigest: digestCol("generation_context_digest"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    index("generation_runs_app").on(t.appId),
    uniqueIndex("generation_runs_correlation").on(t.correlationRef),
  ],
);

export const draftVersions = mysqlTable(
  "draft_versions",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    generationRunId: varchar("generation_run_id", { length: 36 }).notNull(),
    spec: json("spec").notNull(),
    businessSchema: json("business_schema"),
    status: varchar("status", { length: 16 }).notNull(), // 'ready'
    // ---------- DS S2 扩展（设计 §13.2.1，全部 nullable） ----------
    bundle: json("bundle"),
    catalogVersion: varchar("catalog_version", { length: 16 }),
    validationIssues: json("validation_issues"),
    publishBlocked: boolean("publish_blocked"),
    candidateDigest: digestCol("candidate_digest"),
    uiBundleDigest: digestCol("ui_bundle_digest"),
    digestVersion: int("digest_version"),
    migrationPlan: json("migration_plan"),
    reversePlan: json("reverse_plan"),
    migrationFromPublishedVersionId: varchar("migration_from_published_version_id", { length: 36 }),
    migrationFromSchemaDigest: digestCol("migration_from_schema_digest"),
    migrationToSchemaDigest: digestCol("migration_to_schema_digest"),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    uniqueIndex("draft_versions_run").on(t.generationRunId),
    index("draft_versions_app").on(t.appId),
  ],
);

export const publishedVersions = mysqlTable(
  "published_versions",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    draftVersionId: varchar("draft_version_id", { length: 36 }),
    spec: json("spec").notNull(),
    businessSchema: json("business_schema"),
    businessSchemaVersionId: varchar("business_schema_version_id", {
      length: 36,
    }),
    dataAccessPolicyVersionId: varchar("data_access_policy_version_id", {
      length: 36,
    }),
    // S5b：发布该版本时应用的 DataMigrationPlan 与经验证的反向计划（可回滚前提）
    migrationPlan: json("migration_plan"),
    reversePlan: json("reverse_plan"),
    // ---------- DS S2 扩展（设计 §13.2.1，全部 nullable） ----------
    bundle: json("bundle"),
    catalogVersion: varchar("catalog_version", { length: 16 }),
    candidateDigest: digestCol("candidate_digest"),
    uiBundleDigest: digestCol("ui_bundle_digest"),
    digestVersion: int("digest_version"),
    migrationFromPublishedVersionId: varchar("migration_from_published_version_id", { length: 36 }),
    migrationFromSchemaDigest: digestCol("migration_from_schema_digest"),
    businessSchemaDigest: digestCol("business_schema_digest"),
    publishedByMembershipId: varchar("published_by_membership_id", {
      length: 36,
    }).notNull(),
    publishedAt: datetime("published_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [index("published_versions_app").on(t.appId, t.publishedAt)],
);

export const releasePointers = mysqlTable("release_pointers", {
  appId: varchar("app_id", { length: 36 }).primaryKey(),
  publishedVersionId: varchar("published_version_id", {
    length: 36,
  }).notNull(),
  updatedAt: updatedAt(),
  revision: revision(),
});

// ---------- 工作区（仅应用所有者可读，设计 §4.3） ----------

export const chatThreads = mysqlTable(
  "chat_threads",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    // AG-UI threadId
    correlationRef: varchar("correlation_ref", { length: 128 }),
    title: varchar("title", { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revision: revision(),
  },
  (t) => [
    index("chat_threads_app").on(t.appId),
    uniqueIndex("chat_threads_correlation").on(t.correlationRef),
  ],
);

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: id().primaryKey(),
    threadId: varchar("thread_id", { length: 36 }).notNull(),
    // AG-UI message id（幂等去重）
    correlationRef: varchar("correlation_ref", { length: 128 }),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("chat_messages_thread").on(t.threadId),
    uniqueIndex("chat_messages_correlation").on(t.threadId, t.correlationRef),
  ],
);

export const questionSets = mysqlTable(
  "question_sets",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    generationRunId: varchar("generation_run_id", { length: 36 }),
    // 服务端签发的 questionSetId（q-{runId}-{toolCallId}）
    correlationRef: varchar("correlation_ref", { length: 128 }),
    payload: json("payload").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    index("question_sets_app").on(t.appId),
    uniqueIndex("question_sets_correlation").on(t.correlationRef),
  ],
);

export const questionAnswers = mysqlTable(
  "question_answers",
  {
    id: id().primaryKey(),
    questionSetId: varchar("question_set_id", { length: 36 }).notNull(),
    payload: json("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("question_answers_set").on(t.questionSetId)],
);

export const appPlans = mysqlTable(
  "app_plans",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    generationRunId: varchar("generation_run_id", { length: 36 }),
    payload: json("payload").notNull(),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [index("app_plans_app").on(t.appId)],
);

export const generationLogs = mysqlTable(
  "generation_logs",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    generationRunId: varchar("generation_run_id", { length: 36 }),
    level: varchar("level", { length: 16 }).notNull(),
    message: varchar("message", { length: 2048 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("generation_logs_app").on(t.appId),
    index("generation_logs_run").on(t.generationRunId),
  ],
);

// ---------- 本地开发收件箱（仅开发模式可用，设计 §6.1/§10） ----------

export const devMailInbox = mysqlTable(
  "dev_mail_inbox",
  {
    id: id().primaryKey(),
    toEmail: varchar("to_email", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("dev_mail_inbox_to").on(t.toEmail)],
);

// ---------- 业务数据（S5a，设计 §4.4/§4.5） ----------

export const businessRecords = mysqlTable(
  "business_records",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    collectionKey: varchar("collection_key", { length: 64 }).notNull(),
    data: json("data").notNull(),
    revision: revision(),
    createdByUserId: varchar("created_by_user_id", { length: 36 }).notNull(),
    updatedByUserId: varchar("updated_by_user_id", { length: 36 }).notNull(),
    subjectMembershipId: varchar("subject_membership_id", { length: 36 }),
    deletedAt: datetime("deleted_at", { mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("business_records_collection").on(
      t.appId,
      t.collectionKey,
      t.deletedAt,
    ),
  ],
);

export const businessRecordRevisions = mysqlTable(
  "business_record_revisions",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    recordId: varchar("record_id", { length: 36 }).notNull(),
    revision: int("revision").notNull(),
    data: json("data").notNull(),
    changedByUserId: varchar("changed_by_user_id", { length: 36 }).notNull(),
    changedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("business_record_revisions_record_rev").on(
      t.recordId,
      t.revision,
    ),
    index("business_record_revisions_app").on(t.appId),
  ],
);

/**
 * 固定查询投影：每个 queryable 字段一行；value_text / value_normalized
 * 必须 utf8mb4_bin（custom 迁移，大小写敏感精确比较）。
 * 查询按 (appId, collectionKey, fieldKey) + 类型化值列过滤；
 * 禁止动态创建按应用或字段增长的物理索引。
 */
export const businessIndexValues = mysqlTable(
  "business_index_values",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    collectionKey: varchar("collection_key", { length: 64 }).notNull(),
    recordId: varchar("record_id", { length: 36 }).notNull(),
    fieldKey: varchar("field_key", { length: 64 }).notNull(),
    valueText: varchar("value_text", { length: 255 }),
    valueNumber: double("value_number"),
    valueBool: boolean("value_bool"),
    valueDate: datetime("value_date", { mode: "date", fsp: 3 }),
  },
  (t) => [
    uniqueIndex("business_index_values_record_field").on(
      t.appId,
      t.collectionKey,
      t.recordId,
      t.fieldKey,
    ),
    index("business_index_values_query").on(
      t.appId,
      t.collectionKey,
      t.fieldKey,
    ),
  ],
);

export const businessUniqueValues = mysqlTable(
  "business_unique_values",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    collectionKey: varchar("collection_key", { length: 64 }).notNull(),
    fieldKey: varchar("field_key", { length: 64 }).notNull(),
    // utf8mb4_bin（custom 迁移）；唯一性=大小写敏感精确比较
    valueNormalized: varchar("value_normalized", { length: 255 }).notNull(),
    recordId: varchar("record_id", { length: 36 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("business_unique_values_key").on(
      t.appId,
      t.collectionKey,
      t.fieldKey,
      t.valueNormalized,
    ),
    index("business_unique_values_record").on(t.recordId),
  ],
);

export const recordPrincipals = mysqlTable(
  "record_principals",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    collectionKey: varchar("collection_key", { length: 64 }).notNull(),
    recordId: varchar("record_id", { length: 36 }).notNull(),
    principalMembershipId: varchar("principal_membership_id", {
      length: 36,
    }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("record_principals_key").on(
      t.appId,
      t.collectionKey,
      t.recordId,
      t.principalMembershipId,
    ),
    index("record_principals_principal").on(t.principalMembershipId),
  ],
);

export const deletedItems = mysqlTable(
  "deleted_items",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    itemType: varchar("item_type", { length: 16 }).notNull(), // 'app' | 'record'
    itemRef: varchar("item_ref", { length: 64 }).notNull(), // recordId 或 appId
    collectionKey: varchar("collection_key", { length: 64 }),
    deletedByUserId: varchar("deleted_by_user_id", { length: 36 }).notNull(),
    deletedAt: createdAt(),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [
    index("deleted_items_app").on(t.appId, t.itemType),
    index("deleted_items_expiry").on(t.expiresAt),
  ],
);

// ---------- DS S2：预览选择 / 恢复 / 设计资源 / 幂等 / 迁移账本 ----------

/**
 * PreviewSelection（设计 §13.2.3）：(appId,membershipId) 唯一。
 * kind='draft' 时保存 versionId/revision；empty/published 两者必须为 NULL
 * （CHECK 约束）。published 只表示跟随 ReleasePointer，不引用具体版本。
 */
export const previewSelections = mysqlTable(
  "preview_selections",
  {
    appId: varchar("app_id", { length: 36 }).notNull(),
    membershipId: varchar("membership_id", { length: 36 }).notNull(),
    // 'empty' | 'published' | 'draft'
    kind: varchar("kind", { length: 16 }).notNull(),
    versionId: varchar("version_id", { length: 36 }),
    revision: int("revision"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("preview_selections_app_membership").on(t.appId, t.membershipId),
    foreignKey({
      columns: [t.membershipId],
      foreignColumns: [memberships.id],
      name: "preview_selections_membership",
    }),
    check(
      "preview_selections_kind_version",
      sql.raw(
        "(`kind` = 'draft' AND `version_id` IS NOT NULL AND `revision` IS NOT NULL) OR (`kind` IN ('empty','published') AND `version_id` IS NULL AND `revision` IS NULL)",
      ),
    ),
  ],
);

/**
 * GenerationRecoveryRecord（设计 §13.2.4/§10.4）：
 * (appId,failedGenerationId,failedCandidateDigest) 唯一；
 * pending → consumed|expired 与原 run 的 recovery_pending → recovery_consumed 同事务；
 * 数据库时间 + CAS 决定竞争，唯一 CAS 获胜。
 */
export const generationRecoveryRecords = mysqlTable(
  "generation_recovery_records",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    failedGenerationId: varchar("failed_generation_id", { length: 36 }).notNull(),
    failedCandidateDigest: digestCol("failed_candidate_digest").notNull(),
    // 'pending' | 'consumed' | 'expired'
    status: varchar("status", { length: 16 }).notNull(),
    // 'repair' | 'regenerate' | 'keep_current'
    decision: varchar("decision", { length: 16 }),
    decidedBy: varchar("decided_by", { length: 36 }),
    decidedAt: datetime("decided_at", { mode: "date", fsp: 3 }),
    decisionExpiresAt: datetime("decision_expires_at", { mode: "date", fsp: 3 }).notNull(),
    expiredAt: datetime("expired_at", { mode: "date", fsp: 3 }),
    successorGenerationId: varchar("successor_generation_id", { length: 36 }),
    stableResultCode: varchar("stable_result_code", { length: 64 }),
    createdAt: createdAt(),
    revision: revision(),
  },
  (t) => [
    uniqueIndex("generation_recovery_records_key").on(
      t.appId,
      t.failedGenerationId,
      t.failedCandidateDigest,
    ),
    index("generation_recovery_records_expiry").on(t.status, t.decisionExpiresAt),
    index("generation_recovery_records_app_expiry").on(
      t.appId,
      t.status,
      t.decisionExpiresAt,
    ),
    index("generation_recovery_records_successor").on(t.successorGenerationId),
    check(
      "generation_recovery_records_status",
      sql.raw(
        "(`status` = 'pending' AND `decision` IS NULL AND `decided_by` IS NULL AND `decided_at` IS NULL AND `successor_generation_id` IS NULL AND `expired_at` IS NULL) OR (`status` = 'consumed' AND `decision` IN ('repair','regenerate','keep_current') AND `decided_by` IS NOT NULL AND `decided_at` IS NOT NULL AND `expired_at` IS NULL) OR (`status` = 'expired' AND `decision` IS NULL AND `expired_at` IS NOT NULL)",
      ),
    ),
  ],
);

/**
 * DesignAssetBlob（设计 §5.4）：内容寻址 Blob 元数据；
 * 正文只存在 VMA_ASSET_ROOT，相对路径由小写 SHA-256 派生。
 */
export const designAssetBlobs = mysqlTable(
  "design_asset_blobs",
  {
    contentHash: digestCol("content_hash").primaryKey(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
    // 'image' | 'svg' | 'font' | 'pdf'
    kind: varchar("kind", { length: 16 }).notNull(),
    // 'ready'（tmp 提升后创建，一期仅 ready）
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("design_asset_blobs_kind").on(t.kind, t.status)],
);

/**
 * DesignAssetSource（设计 §5.4）：source→Blob 外键、readyExtractionId 唯一就绪指针、
 * 7 天删除恢复窗口；不复制原始二进制。
 */
export const designAssetSources = mysqlTable(
  "design_asset_sources",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    createdByMembershipId: varchar("created_by_membership_id", { length: 36 }).notNull(),
    blobContentHash: digestCol("blob_content_hash").notNull(),
    // 'brand_guide_pdf' | 'reference_screenshot' | 'publishable_source'
    purpose: varchar("purpose", { length: 32 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    // 'uploaded' | 'extracting' | 'ready' | 'failed' | 'deleted'
    status: varchar("status", { length: 16 }).notNull(),
    readyExtractionId: varchar("ready_extraction_id", { length: 36 }),
    createdAt: createdAt(),
    retentionUntil: datetime("retention_until", { mode: "date", fsp: 3 }),
    deletedAt: datetime("deleted_at", { mode: "date", fsp: 3 }),
    revision: revision(),
  },
  (t) => [
    index("design_asset_sources_app_status").on(t.appId, t.status),
    index("design_asset_sources_blob").on(t.blobContentHash),
    index("design_asset_sources_ready_extraction").on(t.readyExtractionId),
    foreignKey({
      columns: [t.blobContentHash],
      foreignColumns: [designAssetBlobs.contentHash],
      name: "design_asset_sources_blob_fk",
    }),
    check(
      "design_asset_sources_ready_extraction",
      sql.raw(
        "(`status` = 'ready' AND `ready_extraction_id` IS NOT NULL) OR (`status` IN ('uploaded','extracting','failed','deleted') AND `ready_extraction_id` IS NULL)",
      ),
    ),
  ],
);

/**
 * DesignAssetExtraction（设计 §5.4）：提取结果唯一事实；ready 行不可变
 * （Repository 拒绝 UPDATE）；重新提取新建 extractionId 再 CAS 切换 readyExtractionId。
 */
export const designAssetExtractions = mysqlTable(
  "design_asset_extractions",
  {
    id: id().primaryKey(),
    sourceId: varchar("source_id", { length: 36 }).notNull(),
    sourceContentHash: digestCol("source_content_hash").notNull(),
    extractorProfileVersion: varchar("extractor_profile_version", { length: 64 }).notNull(),
    schemaVersion: int("schema_version").notNull(),
    structuredSummary: json("structured_summary").notNull(),
    summaryDigest: digestCol("summary_digest").notNull(),
    byteLength: int("byte_length").notNull(),
    // 'ready'（不可变行，一期仅 ready）
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("design_asset_extractions_source").on(t.sourceId),
    index("design_asset_extractions_blob").on(t.sourceContentHash),
    foreignKey({
      columns: [t.sourceId],
      foreignColumns: [designAssetSources.id],
      name: "design_asset_extractions_source_fk",
    }),
    foreignKey({
      columns: [t.sourceContentHash],
      foreignColumns: [designAssetBlobs.contentHash],
      name: "design_asset_extractions_blob_fk",
    }),
  ],
);

/**
 * DesignAssetExtractionJob（计划 S2 操作 9）：活动提取任务。
 * - queued/running 不得有 resultExtractionId；
 * - succeeded 必须有 resultExtractionId；
 * - failed 只能保存有界稳定错误码；不保存原始或结构化提取正文。
 */
export const designAssetExtractionJobs = mysqlTable(
  "design_asset_extraction_jobs",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    sourceId: varchar("source_id", { length: 36 }).notNull(),
    sourceContentHash: digestCol("source_content_hash").notNull(),
    extractorProfileVersion: varchar("extractor_profile_version", { length: 64 }).notNull(),
    // 'queued' | 'running' | 'succeeded' | 'failed'
    status: varchar("status", { length: 16 }).notNull(),
    leaseOwner: varchar("lease_owner", { length: 128 }),
    leaseExpiresAt: datetime("lease_expires_at", { mode: "date", fsp: 3 }),
    resultExtractionId: varchar("result_extraction_id", { length: 36 }),
    stableErrorCode: varchar("stable_error_code", { length: 64 }),
    createdAt: createdAt(),
    startedAt: datetime("started_at", { mode: "date", fsp: 3 }),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    revision: revision(),
  },
  (t) => [
    index("design_asset_extraction_jobs_source").on(t.sourceId, t.status),
    index("design_asset_extraction_jobs_lease").on(t.status, t.leaseExpiresAt),
    foreignKey({
      columns: [t.sourceId],
      foreignColumns: [designAssetSources.id],
      name: "design_asset_extraction_jobs_source_fk",
    }),
    check(
      "extraction_jobs_status_result",
      sql.raw(
        "(`status` IN ('queued','running') AND `result_extraction_id` IS NULL) OR (`status` = 'succeeded' AND `result_extraction_id` IS NOT NULL) OR (`status` = 'failed' AND `result_extraction_id` IS NULL AND `stable_error_code` IS NOT NULL)",
      ),
    ),
  ],
);

/**
 * BusinessActionIdempotency（设计 §13.2.6）：
 * (appId,membershipId,canonicalActionName,idempotencyKey) 唯一；
 * 只保存 mutation 重放结果引用，不保存 RecordView/CSV/表单输入/业务数据副本；
 * claim/mutation/终态由同一 BusinessActionUnitOfWork 事务写入。
 */
export const businessActionIdempotency = mysqlTable(
  "business_action_idempotency",
  {
    id: id().primaryKey(),
    appId: varchar("app_id", { length: 36 }).notNull(),
    membershipId: varchar("membership_id", { length: 36 }).notNull(),
    canonicalActionName: varchar("canonical_action_name", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    protocolVersion: int("protocol_version").notNull(),
    publishedVersionId: varchar("published_version_id", { length: 36 }),
    requestHash: digestCol("request_hash").notNull(),
    // 'pending' | 'completed' | 'failed'
    status: varchar("status", { length: 16 }).notNull(),
    resultRef: varchar("result_ref", { length: 255 }),
    resultDigest: digestCol("result_digest"),
    stableResultCode: varchar("stable_result_code", { length: 64 }),
    createdAt: createdAt(),
    completedAt: datetime("completed_at", { mode: "date", fsp: 3 }),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("business_action_idempotency_key").on(
      t.appId,
      t.membershipId,
      t.canonicalActionName,
      t.idempotencyKey,
    ),
    index("business_action_idempotency_expiry").on(t.status, t.expiresAt),
  ],
);

/**
 * 迁移账本（计划 S2 操作 1）：(migrationId,stepId) 唯一；
 * 每个 additive DDL step 固定 stepId + definitionDigest，支持部分续跑与篡改检测。
 */
export const schemaMigrationSteps = mysqlTable(
  "schema_migration_steps",
  {
    migrationId: varchar("migration_id", { length: 64 }).notNull(),
    stepId: varchar("step_id", { length: 128 }).notNull(),
    definitionDigest: digestCol("definition_digest").notNull(),
    appliedAt: datetime("applied_at", { mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [uniqueIndex("schema_migration_steps_key").on(t.migrationId, t.stepId)],
);

export type PreviewSelectionRow = typeof previewSelections.$inferSelect;
export type GenerationRecoveryRecordRow =
  typeof generationRecoveryRecords.$inferSelect;
export type DesignAssetBlobRow = typeof designAssetBlobs.$inferSelect;
export type DesignAssetSourceRow = typeof designAssetSources.$inferSelect;
export type DesignAssetExtractionRow = typeof designAssetExtractions.$inferSelect;
export type DesignAssetExtractionJobRow =
  typeof designAssetExtractionJobs.$inferSelect;
export type BusinessActionIdempotencyRow =
  typeof businessActionIdempotency.$inferSelect;
export type SchemaMigrationStepRow = typeof schemaMigrationSteps.$inferSelect;

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type AuthChallengeRow = typeof authChallenges.$inferSelect;
export type CreatorGrantRow = typeof creatorGrants.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type AppRow = typeof apps.$inferSelect;
export type GenerationRunRow = typeof generationRuns.$inferSelect;
export type DraftVersionRow = typeof draftVersions.$inferSelect;
export type PublishedVersionRow = typeof publishedVersions.$inferSelect;
export type ReleasePointerRow = typeof releasePointers.$inferSelect;
export type ChatThreadRow = typeof chatThreads.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type QuestionSetRow = typeof questionSets.$inferSelect;
export type QuestionAnswerRow = typeof questionAnswers.$inferSelect;
export type AppPlanRow = typeof appPlans.$inferSelect;
export type GenerationLogRow = typeof generationLogs.$inferSelect;
export type DevMailInboxRow = typeof devMailInbox.$inferSelect;
export type BusinessRecordRow = typeof businessRecords.$inferSelect;
export type BusinessRecordRevisionRow =
  typeof businessRecordRevisions.$inferSelect;
export type BusinessIndexValueRow = typeof businessIndexValues.$inferSelect;
export type BusinessUniqueValueRow = typeof businessUniqueValues.$inferSelect;
export type RecordPrincipalRow = typeof recordPrincipals.$inferSelect;
export type DeletedItemRow = typeof deletedItems.$inferSelect;
