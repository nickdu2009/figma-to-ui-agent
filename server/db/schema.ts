import {
  boolean,
  datetime,
  double,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

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
    // 'running' | 'awaiting_preview' | 'succeeded' | 'failed' | 'incomplete'
    status: varchar("status", { length: 24 }).notNull(),
    // 生成流水线内的 generationId（关联 AG-UI 事件与持久事实，设计 §4.2）
    correlationRef: varchar("correlation_ref", { length: 128 }),
    candidateSpec: json("candidate_spec"),
    candidateBusinessSchema: json("candidate_business_schema"),
    diagnostics: json("diagnostics"),
    lastHeartbeatAt: datetime("last_heartbeat_at", { mode: "date", fsp: 3 }),
    createdByMembershipId: varchar("created_by_membership_id", { length: 36 }),
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
