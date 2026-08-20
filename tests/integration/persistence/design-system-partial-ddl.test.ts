/**
 * S2：0005/0006 fail-closed 与断点续跑测试（计划 S2 验证）。
 * 1. 部分 DDL（进程中断形态：已应用部分 step + 部分账本、journal 未记录）
 *    → runStartupMigrations 幂等续跑并完整收口；
 * 2. 伪造 journal（标记 0005 完成但结构未应用）→ fail closed；
 * 3. 篡改列型 / 删索引 / 删 CHECK / 篡改账本 digest / 受管新表加私列
 *    → 二次启动 fail closed。
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../../server/persistence/database.ts";
import { runStartupMigrations } from "../../../server/persistence/migrations.ts";
import {
  AdditiveMigrationError,
  MIGRATION_0005_STEPS,
  readJournal0005,
} from "../../../server/persistence/additive-migration-verifier.ts";
import { readTestAdminUrl } from "../../helpers/test-database.ts";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../server/db/migrations/", import.meta.url),
);
const EARLY_MIGRATIONS = [
  "0000_0001_platform_init.sql",
  "0001_0002_utf8mb4_bin_collation.sql",
  "0002_0003_generation_correlation.sql",
  "0003_0003_business_data.sql",
  "0004_0004_migration_plans.sql",
];

interface BareSchema {
  schemaName: string;
  databaseUrl: string;
  adminPool: mysql.Pool;
}

async function createBareSchema(): Promise<BareSchema> {
  const adminPool = mysql.createPool({
    uri: readTestAdminUrl(),
    connectionLimit: 2,
    multipleStatements: true,
  });
  const schemaName = `vma_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await adminPool.query("CREATE SCHEMA ??", [schemaName]);
  return {
    schemaName,
    databaseUrl: `${readTestAdminUrl()}/${schemaName}`,
    adminPool,
  };
}

async function dropSchema(bare: BareSchema): Promise<void> {
  await bare.adminPool.query("DROP SCHEMA IF EXISTS ??", [bare.schemaName]);
  await bare.adminPool.end();
}

function statementsOf(file: string): string[] {
  return readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 手工置为 0004 完成 + 可选伪造 0005 journal 行。 */
async function applyThrough0004(
  bare: BareSchema,
  forge0005Journal: boolean,
): Promise<void> {
  const conn = await mysql.createConnection(bare.databaseUrl);
  try {
    const journal = JSON.parse(
      readFileSync(`${MIGRATIONS_DIR}meta/_journal.json`, "utf8"),
    ) as { entries: Array<{ tag: string; when: number }> };
    await conn.query(
      "CREATE TABLE `__drizzle_migrations` (`id` serial PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)",
    );
    for (const [index, file] of EARLY_MIGRATIONS.entries()) {
      for (const stmt of statementsOf(file)) {
        await conn.query(stmt);
      }
      const entry = journal.entries[index];
      if (!entry) throw new Error(`journal 缺少第 ${index} 条`);
      await conn.query(
        "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        [`manual-${entry.tag}`, entry.when],
      );
    }
    if (forge0005Journal) {
      const entry0005 = readJournal0005();
      await conn.query(
        "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        ["forged-0005", entry0005.when],
      );
    }
  } finally {
    await conn.end();
  }
}

/**
 * 模拟进程中断：在单一连接上执行 0005 的前 N 条语句
 * （PREPARE/EXECUTE 依赖会话变量，必须同一连接）。
 */
async function applyPartial0005(bare: BareSchema, statementCount: number): Promise<void> {
  const conn = await mysql.createConnection(bare.databaseUrl);
  try {
    const statements = statementsOf("0005_0005_design_system_catalog.sql");
    for (const stmt of statements.slice(0, statementCount)) {
      await conn.query(stmt);
    }
  } finally {
    await conn.end();
  }
}

describe("0005/0006 fail-closed 与断点续跑（S2）", () => {
  let bare: BareSchema | null = null;
  let db: Database | null = null;
  let pool: mysql.Pool | null = null;

  beforeAll(async () => {
    bare = await createBareSchema();
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (bare) await dropSchema(bare);
  });

  it("部分 DDL：幂等续跑并完整收口", async () => {
    const schema = bare as BareSchema;
    await applyThrough0004(schema, false);
    // 执行前 36 条：schema_migration_steps 建表+账本 + 7 个 generation_runs 列 step
    await applyPartial0005(schema, 36);
    const handle = createDatabase(schema.databaseUrl);
    db = handle.db;
    pool = handle.pool;
    const before = await ledgerRows(pool);
    expect(before.length).toBeGreaterThan(0);
    expect(before.length).toBeLessThan(MIGRATION_0005_STEPS.length);
    // 续跑：journal 未记录 0005 → drizzle 重放全部语句，已存在的子步骤跳过
    await runStartupMigrations(db);
    const after = await ledgerRows(pool);
    expect(after.length).toBe(MIGRATION_0005_STEPS.length);
  }, 120000);

  it("伪造 journal：结构不完整时 fail closed", async () => {
    const schema = await createBareSchema();
    try {
      await applyThrough0004(schema, true);
      const handle = createDatabase(schema.databaseUrl);
      try {
        await expect(runStartupMigrations(handle.db)).rejects.toThrow(
          AdditiveMigrationError,
        );
      } finally {
        await handle.pool.end();
      }
    } finally {
      await dropSchema(schema);
    }
  }, 120000);

  it("篡改列型 / 删索引 / 删 CHECK / 篡改账本 / 受管新表加私列：fail closed", async () => {
    if (!db || !pool) throw new Error("前置测试未完成");
    // 已完整迁移的库上二次启动：先验证幂等通过
    await runStartupMigrations(db);

    // 1) 篡改列型
    await pool.query(
      "ALTER TABLE `generation_runs` MODIFY COLUMN `candidate_bundle` longtext NULL",
    );
    await expect(runStartupMigrations(db)).rejects.toThrow(AdditiveMigrationError);
    await pool.query(
      "ALTER TABLE `generation_runs` MODIFY COLUMN `candidate_bundle` JSON NULL",
    );

    // 2) 删索引
    await pool.query("ALTER TABLE `preview_selections` DROP INDEX `preview_selections_app_membership`");
    await expect(runStartupMigrations(db)).rejects.toThrow(AdditiveMigrationError);
    await pool.query(
      "ALTER TABLE `preview_selections` ADD UNIQUE KEY `preview_selections_app_membership` (`app_id`, `membership_id`)",
    );

    // 3) 删 CHECK
    await pool.query(
      "ALTER TABLE `preview_selections` DROP CHECK `preview_selections_kind_version`",
    );
    await expect(runStartupMigrations(db)).rejects.toThrow(AdditiveMigrationError);
    await pool.query(
      "ALTER TABLE `preview_selections` ADD CONSTRAINT `preview_selections_kind_version` CHECK ((`kind` = 'draft' AND `version_id` IS NOT NULL AND `revision` IS NOT NULL) OR (`kind` IN ('empty','published') AND `version_id` IS NULL AND `revision` IS NULL))",
    );

    // 3b) 0006 完成后少任一新 CHECK 也必须 fail closed（独立 postflight）。
    await pool.query(
      "ALTER TABLE `generation_recovery_records` DROP CHECK `generation_recovery_records_status`",
    );
    await expect(runStartupMigrations(db)).rejects.toThrow(AdditiveMigrationError);
    await pool.query(
      "ALTER TABLE `generation_recovery_records` ADD CONSTRAINT `generation_recovery_records_status` CHECK ((`status` = 'pending' AND `decision` IS NULL AND `decided_by` IS NULL AND `decided_at` IS NULL AND `successor_generation_id` IS NULL AND `expired_at` IS NULL) OR (`status` = 'consumed' AND `decision` IN ('repair','regenerate','keep_current') AND `decided_by` IS NOT NULL AND `decided_at` IS NOT NULL AND `expired_at` IS NULL) OR (`status` = 'expired' AND `decision` IS NULL AND `expired_at` IS NOT NULL))",
    );

    // 4) 篡改账本 digest
    await pool.query(
      "UPDATE `schema_migration_steps` SET `definition_digest` = 'sha256:0000000000000000000000000000000000000000000000000000000000000000' WHERE `migration_id` = '0005' LIMIT 1",
    );
    await expect(runStartupMigrations(db)).rejects.toThrow(AdditiveMigrationError);

    // 5) 恢复账本后，受管新表加私列
    const step = MIGRATION_0005_STEPS[0];
    if (!step) throw new Error("注册表为空");
    await pool.query(
      "UPDATE `schema_migration_steps` SET `definition_digest` = ? WHERE `migration_id` = '0005' AND `step_id` = ?",
      [step.definitionDigest, step.stepId],
    );
    await pool.query(
      "ALTER TABLE `preview_selections` ADD COLUMN `rogue_col` varchar(10) NULL",
    );
    await expect(runStartupMigrations(db)).rejects.toThrow(AdditiveMigrationError);
  }, 120000);
});

async function ledgerRows(pool: mysql.Pool): Promise<unknown[]> {
  const [rows] = await pool.query(
    "SELECT `step_id` FROM `schema_migration_steps` WHERE `migration_id` = '0005'",
  );
  return rows as unknown[];
}
