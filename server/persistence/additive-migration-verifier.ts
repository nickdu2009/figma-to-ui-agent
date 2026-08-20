/**
 * 0005/0006 additive 迁移的期望结构、step 注册表与 preflight/postflight 校验
 * （计划 S2 操作 1-3，设计 §13.2.10）：
 *
 * - 每个 additive DDL step 固定 stepId 与 definitionDigest；
 * - 0005 是已发布历史，46 个 step 的定义与账本 digest 永不改写；
 * - 0006 只补 0005 发布后发现的 recovery/source 约束，且独立校验完成状态；
 * - SQL 由本注册表生成（scripts/generate-migration-0005.mjs），
 *   集成测试断言文件与注册表无漂移；
 * - preflight：Drizzle journal 无 0005 时，完整结构缺账本可只补账本、
 *   已知部分结构可续跑；journal 已有 0005 但账本/结构不完整一律 fail closed；
 *   未知列型、nullable、default、索引、约束或 digest 差异同样 fail closed；
 * - postflight：journal/账本/information_schema 三者一致，否则拒绝启动。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type mysql from "mysql2/promise";

export const MIGRATION_0005_ID = "0005";
export const MIGRATION_0005_TAG = "0005_0005_design_system_catalog";
export const MIGRATION_0006_ID = "0006";
export const MIGRATION_0006_TAG = "0006_0006_recovery_asset_constraints";

/* ------------------------------------------------------------------ */
/* 期望结构（postflight 权威）                                           */
/* ------------------------------------------------------------------ */

export interface ExpectedColumn {
  name: string;
  dataType: string; // information_schema.columns.data_type（小写）
  nullable: boolean;
  columnType?: string; // information_schema.columns.column_type（如 'varchar(71)'）
}

export interface ExpectedIndex {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ExpectedCheck {
  name: string;
  clauseIncludes: string; // check_clause 必须包含的规范化片段
}

export interface ExpectedForeignKey {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

export interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
  indexes: ExpectedIndex[];
  checks?: ExpectedCheck[];
  foreignKeys?: ExpectedForeignKey[];
}

const digest = (name: string): ExpectedColumn => ({
  name,
  dataType: "varchar",
  columnType: "varchar(71)",
  nullable: true,
});
const digestNotNull = (name: string): ExpectedColumn => ({
  name,
  dataType: "varchar",
  columnType: "varchar(71)",
  nullable: false,
});
const idCol = (name: string, nullable = false): ExpectedColumn => ({
  name,
  dataType: "varchar",
  columnType: "varchar(36)",
  nullable,
});
const jsonCol = (name: string, nullable = true): ExpectedColumn => ({
  name,
  dataType: "json",
  nullable,
});
const dt = (name: string, nullable = true): ExpectedColumn => ({
  name,
  dataType: "datetime",
  columnType: "datetime(3)",
  nullable,
});
const vc = (name: string, length: number, nullable = true): ExpectedColumn => ({
  name,
  dataType: "varchar",
  columnType: `varchar(${length})`,
  nullable,
});
const intCol = (name: string, nullable = true): ExpectedColumn => ({
  name,
  dataType: "int",
  nullable,
});
const boolCol = (name: string, nullable = true): ExpectedColumn => ({
  name,
  dataType: "tinyint",
  nullable,
});

const GENERATION_RUNS_NEW_COLUMNS: ExpectedColumn[] = [
  jsonCol("candidate_bundle"),
  vc("catalog_version", 16),
  jsonCol("validation_issues"),
  jsonCol("fatal_visual_issues"),
  boolCol("publish_blocked"),
  digest("candidate_digest"),
  digest("ui_bundle_digest"),
  intCol("digest_version"),
  vc("validation_profile_version", 32),
  jsonCol("validation_report"),
  digest("report_digest"),
  jsonCol("candidate_migration_plan"),
  jsonCol("candidate_reverse_migration_plan"),
  idCol("migration_from_published_version_id", true),
  digest("migration_from_schema_digest"),
  digest("migration_to_schema_digest"),
  jsonCol("brand_source_snapshot"),
  digest("generation_context_digest"),
];

const DRAFT_VERSIONS_NEW_COLUMNS: ExpectedColumn[] = [
  jsonCol("bundle"),
  vc("catalog_version", 16),
  jsonCol("validation_issues"),
  boolCol("publish_blocked"),
  digest("candidate_digest"),
  digest("ui_bundle_digest"),
  intCol("digest_version"),
  jsonCol("migration_plan"),
  jsonCol("reverse_plan"),
  idCol("migration_from_published_version_id", true),
  digest("migration_from_schema_digest"),
  digest("migration_to_schema_digest"),
];

const PUBLISHED_VERSIONS_NEW_COLUMNS: ExpectedColumn[] = [
  jsonCol("bundle"),
  vc("catalog_version", 16),
  digest("candidate_digest"),
  digest("ui_bundle_digest"),
  intCol("digest_version"),
  idCol("migration_from_published_version_id", true),
  digest("migration_from_schema_digest"),
  digest("business_schema_digest"),
];

/** 0005 只加列的既有表：extra-column 检查不适用（它们还有既有列）。 */
const EXISTING_TABLES_WITH_NEW_COLUMNS = new Set([
  "generation_runs",
  "draft_versions",
  "published_versions",
]);

export const EXPECTED_TABLES_0005: ExpectedTable[] = [
  {
    name: "generation_runs",
    columns: GENERATION_RUNS_NEW_COLUMNS,
    indexes: [],
  },
  {
    name: "draft_versions",
    columns: DRAFT_VERSIONS_NEW_COLUMNS,
    indexes: [],
  },
  {
    name: "published_versions",
    columns: PUBLISHED_VERSIONS_NEW_COLUMNS,
    indexes: [],
  },
  {
    name: "schema_migration_steps",
    columns: [
      vc("migration_id", 64, false),
      vc("step_id", 128, false),
      digestNotNull("definition_digest"),
      dt("applied_at", false),
    ],
    indexes: [
      {
        name: "schema_migration_steps_key",
        columns: ["migration_id", "step_id"],
        unique: true,
      },
    ],
  },
  {
    name: "preview_selections",
    columns: [
      idCol("app_id"),
      idCol("membership_id"),
      vc("kind", 16, false),
      idCol("version_id", true),
      intCol("revision"),
      dt("updated_at", false),
    ],
    indexes: [
      {
        name: "preview_selections_app_membership",
        columns: ["app_id", "membership_id"],
        unique: true,
      },
      {
        name: "preview_selections_membership",
        columns: ["membership_id"],
        unique: false,
      },
    ],
    checks: [
      {
        name: "preview_selections_kind_version",
        clauseIncludes: "`kind`",
      },
    ],
    foreignKeys: [
      {
        name: "preview_selections_membership",
        columns: ["membership_id"],
        referencedTable: "memberships",
        referencedColumns: ["id"],
      },
    ],
  },
  {
    name: "generation_recovery_records",
    columns: [
      idCol("id"),
      idCol("app_id"),
      idCol("failed_generation_id"),
      digestNotNull("failed_candidate_digest"),
      vc("status", 16, false),
      vc("decision", 16),
      idCol("decided_by", true),
      dt("decided_at"),
      dt("decision_expires_at", false),
      dt("expired_at"),
      idCol("successor_generation_id", true),
      vc("stable_result_code", 64),
      dt("created_at", false),
      { name: "revision", dataType: "int", nullable: false },
    ],
    indexes: [
      {
        name: "generation_recovery_records_key",
        columns: ["app_id", "failed_generation_id", "failed_candidate_digest"],
        unique: true,
      },
      {
        name: "generation_recovery_records_expiry",
        columns: ["status", "decision_expires_at"],
        unique: false,
      },
      {
        name: "generation_recovery_records_app_expiry",
        columns: ["app_id", "status", "decision_expires_at"],
        unique: false,
      },
      {
        name: "generation_recovery_records_successor",
        columns: ["successor_generation_id"],
        unique: false,
      },
    ],
  },
  {
    name: "design_asset_blobs",
    columns: [
      digestNotNull("content_hash"),
      vc("mime_type", 128, false),
      { name: "byte_length", dataType: "bigint", nullable: false },
      vc("kind", 16, false),
      vc("status", 16, false),
      dt("created_at", false),
    ],
    indexes: [
      {
        name: "design_asset_blobs_kind",
        columns: ["kind", "status"],
        unique: false,
      },
    ],
  },
  {
    name: "design_asset_sources",
    columns: [
      idCol("id"),
      idCol("app_id"),
      idCol("created_by_membership_id"),
      digestNotNull("blob_content_hash"),
      vc("purpose", 32, false),
      vc("display_name", 255, false),
      vc("status", 16, false),
      idCol("ready_extraction_id", true),
      dt("created_at", false),
      dt("retention_until"),
      dt("deleted_at"),
      { name: "revision", dataType: "int", nullable: false },
    ],
    indexes: [
      {
        name: "design_asset_sources_app_status",
        columns: ["app_id", "status"],
        unique: false,
      },
      {
        name: "design_asset_sources_blob",
        columns: ["blob_content_hash"],
        unique: false,
      },
      {
        name: "design_asset_sources_ready_extraction",
        columns: ["ready_extraction_id"],
        unique: false,
      },
    ],
    foreignKeys: [
      {
        name: "design_asset_sources_blob_fk",
        columns: ["blob_content_hash"],
        referencedTable: "design_asset_blobs",
        referencedColumns: ["content_hash"],
      },
    ],
  },
  {
    name: "design_asset_extractions",
    columns: [
      idCol("id"),
      idCol("source_id"),
      digestNotNull("source_content_hash"),
      vc("extractor_profile_version", 64, false),
      { name: "schema_version", dataType: "int", nullable: false },
      jsonCol("structured_summary", false),
      digestNotNull("summary_digest"),
      { name: "byte_length", dataType: "int", nullable: false },
      vc("status", 16, false),
      dt("created_at", false),
    ],
    indexes: [
      {
        name: "design_asset_extractions_source",
        columns: ["source_id"],
        unique: false,
      },
      {
        name: "design_asset_extractions_blob",
        columns: ["source_content_hash"],
        unique: false,
      },
    ],
    foreignKeys: [
      {
        name: "design_asset_extractions_source_fk",
        columns: ["source_id"],
        referencedTable: "design_asset_sources",
        referencedColumns: ["id"],
      },
      {
        name: "design_asset_extractions_blob_fk",
        columns: ["source_content_hash"],
        referencedTable: "design_asset_blobs",
        referencedColumns: ["content_hash"],
      },
    ],
  },
  {
    name: "design_asset_extraction_jobs",
    columns: [
      idCol("id"),
      idCol("app_id"),
      idCol("source_id"),
      digestNotNull("source_content_hash"),
      vc("extractor_profile_version", 64, false),
      vc("status", 16, false),
      vc("lease_owner", 128),
      dt("lease_expires_at"),
      idCol("result_extraction_id", true),
      vc("stable_error_code", 64),
      dt("created_at", false),
      dt("started_at"),
      dt("completed_at"),
      { name: "revision", dataType: "int", nullable: false },
    ],
    indexes: [
      {
        name: "design_asset_extraction_jobs_source",
        columns: ["source_id", "status"],
        unique: false,
      },
      {
        name: "design_asset_extraction_jobs_lease",
        columns: ["status", "lease_expires_at"],
        unique: false,
      },
    ],
    checks: [
      {
        name: "extraction_jobs_status_result",
        clauseIncludes: "`status`",
      },
    ],
    foreignKeys: [
      {
        name: "design_asset_extraction_jobs_source_fk",
        columns: ["source_id"],
        referencedTable: "design_asset_sources",
        referencedColumns: ["id"],
      },
    ],
  },
  {
    name: "business_action_idempotency",
    columns: [
      idCol("id"),
      idCol("app_id"),
      idCol("membership_id"),
      vc("canonical_action_name", 64, false),
      vc("idempotency_key", 128, false),
      { name: "protocol_version", dataType: "int", nullable: false },
      idCol("published_version_id", true),
      digestNotNull("request_hash"),
      vc("status", 16, false),
      vc("result_ref", 255),
      digest("result_digest"),
      vc("stable_result_code", 64),
      dt("created_at", false),
      dt("completed_at"),
      dt("expires_at", false),
    ],
    indexes: [
      {
        name: "business_action_idempotency_key",
        columns: [
          "app_id",
          "membership_id",
          "canonical_action_name",
          "idempotency_key",
        ],
        unique: true,
      },
      {
        name: "business_action_idempotency_expiry",
        columns: ["status", "expires_at"],
        unique: false,
      },
    ],
  },
];

/**
 * 0006 的全部职责。它们不属于 0005 的历史 table-create step：把它们塞回
 * 0005 会改变已应用库中的 ledger definitionDigest，导致启动永久 fail-closed。
 */
interface Expected0006Constraint {
  table: string;
  constraint: ExpectedCheck | ExpectedForeignKey;
}

export const EXPECTED_CONSTRAINTS_0006: Expected0006Constraint[] = [
  {
    table: "generation_recovery_records",
    constraint: {
      name: "generation_recovery_records_status",
      clauseIncludes: "`status` = 'pending'",
    },
  },
  {
    table: "design_asset_sources",
    constraint: {
      name: "design_asset_sources_ready_extraction",
      clauseIncludes: "`status` = 'ready'",
    },
  },
  {
    table: "design_asset_sources",
    constraint: {
      name: "design_asset_sources_ready_extraction_fk",
      columns: ["ready_extraction_id"],
      referencedTable: "design_asset_extractions",
      referencedColumns: ["id"],
    },
  },
];

/* ------------------------------------------------------------------ */
/* Step 注册表（0005 SQL 与账本 digest 的单一来源）                        */
/* ------------------------------------------------------------------ */

export interface AdditiveStep {
  stepId: string;
  /** 条件化 DDL 语句组（按序执行）。 */
  statements: string[];
  definitionDigest: `sha256:${string}`;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function columnDdl(column: ExpectedColumn): string {
  const type = column.columnType ?? column.dataType.toUpperCase();
  return `\`${column.name}\` ${type} ${column.nullable ? "NULL" : "NOT NULL"}`;
}

function addColumnStatements(table: string, column: ExpectedColumn): string[] {
  const alter = `ALTER TABLE \`${table}\` ADD COLUMN ${columnDdl(column)}`;
  return [
    `SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = '${column.name}') = 0, '${alter.replaceAll("'", "''")}', 'SELECT 1')`,
    "PREPARE vma_stmt FROM @vma_ddl",
    "EXECUTE vma_stmt",
    "DEALLOCATE PREPARE vma_stmt",
  ];
}

function ledgerStatement(stepId: string, definitionDigest: string): string {
  return `INSERT INTO \`schema_migration_steps\` (\`migration_id\`, \`step_id\`, \`definition_digest\`, \`applied_at\`) VALUES ('${MIGRATION_0005_ID}', '${stepId}', '${definitionDigest}', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE \`applied_at\` = \`applied_at\``;
}

/** CREATE TABLE IF NOT EXISTS 的列/索引/约束定义（从期望结构派生）。 */
export function createTableDdl(table: ExpectedTable): string {
  const parts: string[] = [];
  const pkColumns: string[] = [];
  for (const column of table.columns) {
    const isPk =
      (table.name === "design_asset_blobs" && column.name === "content_hash") ||
      (column.name === "id" && table.name !== "schema_migration_steps") ||
      (table.name === "design_asset_extractions" && column.name === "id");
    parts.push(`  ${columnDdl(column)}`);
    if (isPk) pkColumns.push(column.name);
  }
  if (pkColumns.length > 0) {
    parts.push(`  PRIMARY KEY (${pkColumns.map((c) => `\`${c}\``).join(", ")})`);
  }
  for (const index of table.indexes) {
    const cols = index.columns.map((c) => `\`${c}\``).join(", ");
    parts.push(
      index.unique
        ? `  UNIQUE KEY \`${index.name}\` (${cols})`
        : `  KEY \`${index.name}\` (${cols})`,
    );
  }
  for (const fk of table.foreignKeys ?? []) {
    const cols = fk.columns.map((c) => `\`${c}\``).join(", ");
    const refCols = fk.referencedColumns.map((c) => `\`${c}\``).join(", ");
    parts.push(
      `  CONSTRAINT \`${fk.name}\` FOREIGN KEY (${cols}) REFERENCES \`${fk.referencedTable}\` (${refCols})`,
    );
  }
  for (const chk of table.checks ?? []) {
    parts.push(`  CONSTRAINT \`${chk.name}\` CHECK (${checkClause(chk.name)})`);
  }
  // 与平台既有表一致：MySQL 8 默认 utf8mb4_0900_ai_ci（0001 仅转换 email_normalized 列），
  // 跨表外键要求引用列 collation 完全一致
  return `CREATE TABLE IF NOT EXISTS \`${table.name}\` (\n${parts.join(",\n")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;
}

function checkClause(name: string): string {
  if (name === "preview_selections_kind_version") {
    return "(`kind` = 'draft' AND `version_id` IS NOT NULL AND `revision` IS NOT NULL) OR (`kind` IN ('empty','published') AND `version_id` IS NULL AND `revision` IS NULL)";
  }
  if (name === "extraction_jobs_status_result") {
    return "(`status` IN ('queued','running') AND `result_extraction_id` IS NULL) OR (`status` = 'succeeded' AND `result_extraction_id` IS NOT NULL) OR (`status` = 'failed' AND `result_extraction_id` IS NULL AND `stable_error_code` IS NOT NULL)";
  }
  if (name === "generation_recovery_records_status") {
    return "(`status` = 'pending' AND `decision` IS NULL AND `decided_by` IS NULL AND `decided_at` IS NULL AND `successor_generation_id` IS NULL AND `expired_at` IS NULL) OR (`status` = 'consumed' AND `decision` IN ('repair','regenerate','keep_current') AND `decided_by` IS NOT NULL AND `decided_at` IS NOT NULL AND `expired_at` IS NULL) OR (`status` = 'expired' AND `decision` IS NULL AND `expired_at` IS NOT NULL)";
  }
  if (name === "design_asset_sources_ready_extraction") {
    return "(`status` = 'ready' AND `ready_extraction_id` IS NOT NULL) OR (`status` IN ('uploaded','extracting','failed','deleted') AND `ready_extraction_id` IS NULL)";
  }
  throw new Error(`未知 CHECK 约束：${name}`);
}

function addConstraintStatements(
  table: string,
  constraint: ExpectedForeignKey | ExpectedCheck,
): string[] {
  const isForeignKey = "referencedTable" in constraint;
  const definition = isForeignKey
    ? `CONSTRAINT \`${constraint.name}\` FOREIGN KEY (${constraint.columns.map((column) => `\`${column}\``).join(", ")}) REFERENCES \`${constraint.referencedTable}\` (${constraint.referencedColumns.map((column) => `\`${column}\``).join(", ")})`
    : `CONSTRAINT \`${constraint.name}\` CHECK (${checkClause(constraint.name)})`;
  const constraintType = isForeignKey ? "FOREIGN KEY" : "CHECK";
  const escaped = `ALTER TABLE \`${table}\` ADD ${definition}`.replaceAll("'", "''");
  return [
    `SET @vma_ddl := IF((SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = '${table}' AND constraint_name = '${constraint.name}' AND constraint_type = '${constraintType}') = 0, '${escaped}', 'SELECT 1')`,
    "PREPARE vma_stmt FROM @vma_ddl",
    "EXECUTE vma_stmt",
    "DEALLOCATE PREPARE vma_stmt",
  ];
}

function buildSteps(): AdditiveStep[] {
  const steps: AdditiveStep[] = [];
  const push = (stepId: string, statements: string[]) => {
    const definitionDigest = `sha256:${sha256Hex(
      JSON.stringify({ migrationId: MIGRATION_0005_ID, stepId, statements }),
    )}` as const;
    steps.push({
      stepId,
      statements: [...statements, ledgerStatement(stepId, definitionDigest)],
      definitionDigest,
    });
  };

  const ledgerTable = EXPECTED_TABLES_0005.find(
    (t) => t.name === "schema_migration_steps",
  );
  if (!ledgerTable) throw new Error("缺少 schema_migration_steps 期望结构");
  push("schema_migration_steps.create", [createTableDdl(ledgerTable)]);

  const alterTargets: Array<[string, ExpectedColumn[]]> = [
    ["generation_runs", GENERATION_RUNS_NEW_COLUMNS],
    ["draft_versions", DRAFT_VERSIONS_NEW_COLUMNS],
    ["published_versions", PUBLISHED_VERSIONS_NEW_COLUMNS],
  ];
  for (const [table, columns] of alterTargets) {
    for (const column of columns) {
      push(`${table}.${column.name}`, addColumnStatements(table, column));
    }
  }

  for (const table of EXPECTED_TABLES_0005) {
    if (
      table.name === "schema_migration_steps" ||
      alterTargets.some(([name]) => name === table.name)
    ) {
      continue;
    }
    push(`${table.name}.create`, [createTableDdl(table)]);
  }
  return steps;
}

export const MIGRATION_0005_STEPS: AdditiveStep[] = buildSteps();

/** 生成 0005 SQL 文件内容（scripts/generate-migration-0005.mjs 与漂移测试共用）。 */
export function generate0005Sql(): string {
  const header = [
    "-- Custom SQL migration file, put your code below! --",
    "-- 0005 设计系统与 Catalog additive DDL（计划 S2）。",
    "-- 由 server/persistence/additive-migration-verifier.ts 的 step 注册表生成；",
    "-- 每个 step 以 information_schema 判断状态，只执行缺失的已知 additive 子步骤，",
    "-- 并以固定 stepId/definitionDigest 写入 schema_migration_steps 账本（幂等）。",
  ];
  const chunks: string[] = [];
  for (const step of MIGRATION_0005_STEPS) {
    for (const [index, statement] of step.statements.entries()) {
      // 注释与语句同块，breakpoint 只出现在真实语句之间。
      const prefix = index === 0 ? `-- step: ${step.stepId}\n` : "";
      chunks.push(`${prefix}${statement}`);
    }
  }
  return `${header.join("\n")}\n${chunks.join("\n--> statement-breakpoint\n")}\n`;
}

/** 生成 0006 SQL；没有 0005 ledger 行，避免篡改已发布的历史账本。 */
export function generate0006Sql(): string {
  const header = [
    "-- Custom SQL migration file, put your code below! --",
    "-- 0006 recovery/source constraint additive DDL（0005 历史账本保持不变）。",
    "-- 每个约束按 information_schema 幂等添加；postflight0006 以定义 introspection 收口。",
  ];
  const chunks: string[] = [];
  for (const { table, constraint } of EXPECTED_CONSTRAINTS_0006) {
    for (const [index, statement] of addConstraintStatements(table, constraint).entries()) {
      const prefix = index === 0 ? `-- constraint: ${table}.${constraint.name}\n` : "";
      chunks.push(`${prefix}${statement}`);
    }
  }
  return `${header.join("\n")}\n${chunks.join("\n--> statement-breakpoint\n")}\n`;
}

/* ------------------------------------------------------------------ */
/* preflight / postflight                                               */
/* ------------------------------------------------------------------ */

export class AdditiveMigrationError extends Error {
  readonly code = "additive_migration_inconsistent";
  constructor(message: string) {
    super(message);
    this.name = "AdditiveMigrationError";
  }
}

interface JournalEntryMeta {
  idx: number;
  tag: string;
  when: number;
}

function readJournalEntry(tag: string): JournalEntryMeta {
  const journalPath = fileURLToPath(
    new URL("../db/migrations/meta/_journal.json", import.meta.url),
  );
  let journal: { entries: JournalEntryMeta[] };
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: JournalEntryMeta[];
    };
  } catch (error) {
    throw new AdditiveMigrationError(
      `drizzle journal 无法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entry = journal.entries.find((e) => e.tag === tag);
  if (!entry) {
    throw new AdditiveMigrationError(
      `drizzle journal 缺少 ${tag} 条目`,
    );
  }
  return entry;
}

export function readJournal0005(): JournalEntryMeta {
  return readJournalEntry(MIGRATION_0005_TAG);
}

export function readJournal0006(): JournalEntryMeta {
  return readJournalEntry(MIGRATION_0006_TAG);
}

async function tableExists(
  pool: mysql.Pool,
  schema: string,
  table: string,
): Promise<boolean> {
  // 迁移校验器职责即查询 information_schema，参数全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
    [schema, table],
  );
  const first = (rows as Array<{ n: number }>)[0];
  return (first?.n ?? 0) > 0;
}

async function drizzleJournalHas(
  pool: mysql.Pool,
  tag: string,
): Promise<boolean> {
  const entry = readJournalEntry(tag);
  const schema = await currentSchema(pool);
  if (!(await tableExists(pool, schema, "__drizzle_migrations"))) return false;
  // 迁移校验器职责即查询系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM `__drizzle_migrations` WHERE `created_at` = ?",
    [entry.when],
  );
  const first = (rows as Array<{ n: number }>)[0];
  return (first?.n ?? 0) > 0;
}

async function drizzleJournalHas0005(pool: mysql.Pool): Promise<boolean> {
  return drizzleJournalHas(pool, MIGRATION_0005_TAG);
}

async function drizzleJournalHas0006(pool: mysql.Pool): Promise<boolean> {
  return drizzleJournalHas(pool, MIGRATION_0006_TAG);
}

interface LedgerRow {
  step_id: string;
  definition_digest: string;
}

async function readLedger(pool: mysql.Pool): Promise<LedgerRow[]> {
  const schema = await currentSchema(pool);
  if (!(await tableExists(pool, schema, "schema_migration_steps"))) return [];
  // 迁移校验器职责即查询 information_schema/系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
  const [rows] = await pool.query(
    "SELECT `step_id`, `definition_digest` FROM `schema_migration_steps` WHERE `migration_id` = ?",
    [MIGRATION_0005_ID],
  );
  return rows as LedgerRow[];
}

async function currentSchema(pool: mysql.Pool): Promise<string> {
  // 迁移校验器职责即查询 information_schema/系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
  const [rows] = await pool.query("SELECT DATABASE() AS s");
  const first = (rows as Array<{ s: string }>)[0];
  if (!first?.s) throw new AdditiveMigrationError("无法确定当前数据库");
  return first.s;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  column_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function readColumns(
  pool: mysql.Pool,
  schema: string,
  table: string,
): Promise<ColumnRow[]> {
  // 迁移校验器职责即查询 information_schema/系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
  const [rows] = await pool.query(
    "SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default FROM information_schema.columns WHERE table_schema = ? AND table_name = ?",
    [schema, table],
  );
  return rows as ColumnRow[];
}

function fail(message: string): never {
  throw new AdditiveMigrationError(message);
}

/**
 * 结构核对（preflight/postflight 共用）：
 * 已知列存在时必须与期望完全一致（列型/nullable/default）；
 * 不允许期望外的列出现在受管新表。
 */
async function verifyStructure(
  pool: mysql.Pool,
  options: { requireComplete: boolean; checkExtraColumns: boolean },
): Promise<void> {
  const schema = await currentSchema(pool);
  const problems: string[] = [];
  for (const table of EXPECTED_TABLES_0005) {
    const exists = await tableExists(pool, schema, table.name);
    if (!exists) {
      if (options.requireComplete) problems.push(`缺少表 ${table.name}`);
      continue;
    }
    const actual = await readColumns(pool, schema, table.name);
    const actualByName = new Map(actual.map((c) => [c.column_name, c]));
    for (const expected of table.columns) {
      const found = actualByName.get(expected.name);
      if (!found) {
        if (options.requireComplete) {
          problems.push(`${table.name}.${expected.name} 缺失`);
        }
        continue;
      }
      if (found.data_type !== expected.dataType) {
        problems.push(
          `${table.name}.${expected.name} 列型 ${found.data_type} != 期望 ${expected.dataType}`,
        );
      }
      if (
        expected.columnType &&
        found.column_type.toLowerCase() !== expected.columnType.toLowerCase()
      ) {
        problems.push(
          `${table.name}.${expected.name} column_type ${found.column_type} != 期望 ${expected.columnType}`,
        );
      }
      const nullable = found.is_nullable === "YES";
      if (nullable !== expected.nullable) {
        problems.push(
          `${table.name}.${expected.name} nullable=${nullable} != 期望 ${expected.nullable}`,
        );
      }
      if (expected.nullable && found.column_default !== null) {
        problems.push(
          `${table.name}.${expected.name} 存在非 NULL default（${found.column_default}）`,
        );
      }
    }
    if (options.checkExtraColumns && !EXISTING_TABLES_WITH_NEW_COLUMNS.has(table.name)) {
      const expectedNames = new Set(table.columns.map((c) => c.name));
      for (const column of actual) {
        if (!expectedNames.has(column.column_name)) {
          problems.push(`${table.name} 存在期望外的列 ${column.column_name}`);
        }
      }
    }
  }
  if (problems.length > 0) {
    fail(`0005 结构不一致：${problems.join("；")}`);
  }
}

/** 索引/约束核对（postflight 专用，要求全部存在）。 */
async function verifyIndexesAndConstraints(pool: mysql.Pool): Promise<void> {
  const schema = await currentSchema(pool);
  const problems: string[] = [];
  for (const table of EXPECTED_TABLES_0005) {
    if (table.indexes.length === 0) continue;
    // 迁移校验器职责即查询 information_schema/系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
    const [indexRows] = await pool.query(
      "SELECT INDEX_NAME AS index_name, COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index",
      [schema, table.name],
    );
    const byIndex = new Map<string, { columns: string[]; nonUnique: number }>();
    for (const row of indexRows as Array<{
      index_name: string;
      column_name: string;
      non_unique: number;
    }>) {
      const entry = byIndex.get(row.index_name) ?? { columns: [], nonUnique: 0 };
      entry.columns.push(row.column_name);
      entry.nonUnique = row.non_unique;
      byIndex.set(row.index_name, entry);
    }
    for (const expected of table.indexes) {
      const actual = byIndex.get(expected.name);
      if (!actual) {
        problems.push(`${table.name} 缺少索引 ${expected.name}`);
        continue;
      }
      if (actual.columns.join(",") !== expected.columns.join(",")) {
        problems.push(
          `${table.name} 索引 ${expected.name} 列 ${actual.columns.join(",")} != 期望 ${expected.columns.join(",")}`,
        );
      }
      const actualUnique = actual.nonUnique === 0;
      if (actualUnique !== expected.unique) {
        problems.push(
          `${table.name} 索引 ${expected.name} unique=${actualUnique} != 期望 ${expected.unique}`,
        );
      }
    }
    for (const chk of table.checks ?? []) {
      // 迁移校验器职责即查询 information_schema/系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
      const [rows] = await pool.query(
        `SELECT tc.CONSTRAINT_NAME AS constraint_name, cc.CHECK_CLAUSE AS check_clause
         FROM information_schema.table_constraints tc
         JOIN information_schema.check_constraints cc
           ON cc.constraint_schema = tc.constraint_schema
          AND cc.constraint_name = tc.constraint_name
         WHERE tc.table_schema = ? AND tc.table_name = ?
           AND tc.constraint_type = 'CHECK' AND tc.constraint_name = ?`,
        [schema, table.name, chk.name],
      );
      const checkRows = rows as Array<{ check_clause: string }>;
      if (checkRows.length === 0) {
        problems.push(`${table.name} 缺少 CHECK 约束 ${chk.name}`);
      } else {
        // MySQL 会把字符串字面量改写为 `_utf8mb4'…'`、并重排外层括号；
        // 比较逻辑去掉这些展示层差异，仍严格核对约束中的规范片段。
        const normalizeClause = (value: string) =>
          value
            .toLowerCase()
            .replaceAll(/_utf8mb4/g, "")
            .replaceAll(/[\\\s`()]/g, "");
        const actual = normalizeClause(checkRows[0]!.check_clause);
        const expected = normalizeClause(chk.clauseIncludes);
        if (!actual.includes(expected)) {
          problems.push(`${table.name} CHECK 约束 ${chk.name} 定义与期望不一致`);
        }
      }
    }
    for (const fk of table.foreignKeys ?? []) {
      // 迁移校验器职责即查询 information_schema/系统表，值全部经 ? 绑定，drizzle ORM 无法建模
  // pi-lens-ignore: ast-grep:no-sql-in-code
      const [rows] = await pool.query(
        `SELECT kcu.COLUMN_NAME AS column_name, kcu.REFERENCED_TABLE_NAME AS referenced_table_name, kcu.REFERENCED_COLUMN_NAME AS referenced_column_name
         FROM information_schema.key_column_usage kcu
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_schema = kcu.constraint_schema
          AND rc.constraint_name = kcu.constraint_name
          AND rc.table_name = kcu.table_name
         WHERE kcu.constraint_schema = ? AND kcu.table_name = ? AND kcu.constraint_name = ?`,
        [schema, table.name, fk.name],
      );
      const fkRows = rows as Array<{
        column_name: string;
        referenced_table_name: string;
        referenced_column_name: string;
      }>;
      if (fkRows.length === 0) {
        problems.push(`${table.name} 缺少外键 ${fk.name}`);
        continue;
      }
      const first = fkRows[0];
      if (
        first?.referenced_table_name !== fk.referencedTable ||
        fkRows.map((r) => r.column_name).join(",") !== fk.columns.join(",") ||
        fkRows.map((r) => r.referenced_column_name).join(",") !==
          fk.referencedColumns.join(",")
      ) {
        problems.push(`${table.name} 外键 ${fk.name} 定义与期望不一致`);
      }
    }
  }
  if (problems.length > 0) {
    fail(`0005 索引/约束不一致：${problems.join("；")}`);
  }
}

function normalizeCheckClause(value: string): string {
  // MySQL 会把字符串字面量改写为 `_utf8mb4'…'`、并重排外层括号；
  // 比较时去掉展示层差异，仍核对完整的受管表达式。
  return value
    .toLowerCase()
    .replaceAll(/_utf8mb4/g, "")
    .replaceAll(/[\\\s`()]/g, "");
}

/**
 * 0006 自己的定义 introspection。journal 未完成时允许三个约束尚未出现，
 * 但只要已出现就必须匹配；journal 完成后则三个约束必须全部存在且匹配。
 */
async function verify0006Constraints(
  pool: mysql.Pool,
  requireComplete: boolean,
): Promise<void> {
  const schema = await currentSchema(pool);
  const problems: string[] = [];
  for (const { table, constraint } of EXPECTED_CONSTRAINTS_0006) {
    if ("referencedTable" in constraint) {
      // 迁移校验器职责即查询 information_schema，参数全部经 ? 绑定。
      // pi-lens-ignore: ast-grep:no-sql-in-code
      const [rows] = await pool.query(
        `SELECT kcu.COLUMN_NAME AS column_name, kcu.REFERENCED_TABLE_NAME AS referenced_table_name, kcu.REFERENCED_COLUMN_NAME AS referenced_column_name
         FROM information_schema.key_column_usage kcu
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_schema = kcu.constraint_schema
          AND rc.constraint_name = kcu.constraint_name
          AND rc.table_name = kcu.table_name
         WHERE kcu.constraint_schema = ? AND kcu.table_name = ? AND kcu.constraint_name = ?
         ORDER BY kcu.ordinal_position`,
        [schema, table, constraint.name],
      );
      const actual = rows as Array<{
        column_name: string;
        referenced_table_name: string;
        referenced_column_name: string;
      }>;
      if (actual.length === 0) {
        if (requireComplete) problems.push(`${table} 缺少外键 ${constraint.name}`);
        continue;
      }
      if (
        actual[0]?.referenced_table_name !== constraint.referencedTable ||
        actual.map((row) => row.column_name).join(",") !==
          constraint.columns.join(",") ||
        actual.map((row) => row.referenced_column_name).join(",") !==
          constraint.referencedColumns.join(",")
      ) {
        problems.push(`${table} 外键 ${constraint.name} 定义与期望不一致`);
      }
      continue;
    }

    // 迁移校验器职责即查询 information_schema，参数全部经 ? 绑定。
    // pi-lens-ignore: ast-grep:no-sql-in-code
    const [rows] = await pool.query(
      `SELECT cc.CHECK_CLAUSE AS check_clause
       FROM information_schema.table_constraints tc
       JOIN information_schema.check_constraints cc
         ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
       WHERE tc.table_schema = ? AND tc.table_name = ?
         AND tc.constraint_type = 'CHECK' AND tc.constraint_name = ?`,
      [schema, table, constraint.name],
    );
    const actual = rows as Array<{ check_clause: string }>;
    if (actual.length === 0) {
      if (requireComplete) problems.push(`${table} 缺少 CHECK 约束 ${constraint.name}`);
      continue;
    }
    if (
      normalizeCheckClause(actual[0]!.check_clause) !==
      normalizeCheckClause(checkClause(constraint.name))
    ) {
      problems.push(`${table} CHECK 约束 ${constraint.name} 定义与期望不一致`);
    }
  }
  if (problems.length > 0) {
    fail(`0006 约束不一致：${problems.join("；")}`);
  }
}

function verifyLedgerRows(rows: LedgerRow[]): void {
  const expected = new Map(
    MIGRATION_0005_STEPS.map((s) => [s.stepId, s.definitionDigest] as const),
  );
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const digest = expected.get(row.step_id);
    if (digest === undefined) {
      problems.push(`账本存在未知 step：${row.step_id}`);
      continue;
    }
    if (digest !== row.definition_digest) {
      problems.push(`step ${row.step_id} definitionDigest 不一致`);
    }
    seen.add(row.step_id);
  }
  for (const stepId of expected.keys()) {
    if (!seen.has(stepId)) problems.push(`账本缺少 step：${stepId}`);
  }
  if (problems.length > 0) {
    fail(`0005 账本不一致：${problems.join("；")}`);
  }
}

/**
 * preflight（Drizzle migrate 之前）：
 * - journal 已有 0005：账本与结构必须完整，否则 fail closed；
 * - journal 无 0005：已知部分结构可续跑、完整结构缺账本可只补账本；
 *   已知列存在但定义不符、账本含未知 step 或 digest 篡改 → fail closed。
 */
export async function preflight0005(pool: mysql.Pool): Promise<void> {
  const schema = await currentSchema(pool);
  const journalDone = await drizzleJournalHas0005(pool);
  const ledgerRows = await readLedger(pool);

  // 账本自身一致性（未知 step / digest 篡改在任何路径都 fail closed）
  const expected = new Map(
    MIGRATION_0005_STEPS.map((s) => [s.stepId, s.definitionDigest] as const),
  );
  for (const row of ledgerRows) {
    const digest = expected.get(row.step_id);
    if (digest === undefined) {
      fail(`0005 preflight：账本存在未知 step ${row.step_id}`);
    }
    if (digest !== row.definition_digest) {
      fail(`0005 preflight：step ${row.step_id} definitionDigest 不一致`);
    }
  }

  if (journalDone) {
    // journal 标记完成 → 结构+账本必须完整
    await verifyStructure(pool, {
      requireComplete: true,
      checkExtraColumns: false,
    });
    await verifyIndexesAndConstraints(pool);
    verifyLedgerRows(ledgerRows);
    return;
  }

  // journal 未完成：已存在的已知列必须与期望一致（未知列型差异 fail closed）；
  // 允许结构缺失（由 0005 SQL 幂等续跑）。
  await verifyStructure(pool, {
    requireComplete: false,
    checkExtraColumns: false,
  });
  // 账本存在但对应表不存在 → 账本与结构矛盾，fail closed
  if (ledgerRows.length > 0) {
    for (const step of MIGRATION_0005_STEPS) {
      const [table] = step.stepId.split(".");
      if (!table) continue;
      const marked = ledgerRows.some((r) => r.step_id === step.stepId);
      if (!marked) continue;
      const exists = await tableExists(pool, schema, table);
      if (!exists) {
        fail(`0005 preflight：账本标记 ${step.stepId} 已完成但表 ${table} 不存在`);
      }
    }
  }
}

/**
 * postflight（Drizzle migrate 之后）：journal/账本/information_schema 三者一致。
 */
export async function postflight0005(pool: mysql.Pool): Promise<void> {
  if (!(await drizzleJournalHas0005(pool))) {
    fail("0005 postflight：Drizzle journal 未记录 0005 完成");
  }
  await verifyStructure(pool, {
    requireComplete: true,
    checkExtraColumns: true,
  });
  await verifyIndexesAndConstraints(pool);
  verifyLedgerRows(await readLedger(pool));
}

/**
 * 0006 preflight：若 journal 已标记完成，三个约束必须已完整存在；若尚未
 * 完成，允许缺失以支持 MySQL DDL 中断后的幂等续跑，但拒绝已存在的错误定义。
 */
export async function preflight0006(pool: mysql.Pool): Promise<void> {
  await verify0006Constraints(pool, await drizzleJournalHas0006(pool));
}

/** 0006 postflight：journal 与三项约束的实际定义必须同时完整。 */
export async function postflight0006(pool: mysql.Pool): Promise<void> {
  if (!(await drizzleJournalHas0006(pool))) {
    fail("0006 postflight：Drizzle journal 未记录 0006 完成");
  }
  await verify0006Constraints(pool, true);
}
