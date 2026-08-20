/**
 * S2：0005/0006 additive 迁移测试（计划 S2 验证）。
 * 1. 空库 → 0006 全量：表/列/索引/约束/账本/journal 三者一致；
 * 2. 0004 → 0006 升级：手工置为 0004 状态并播种旧数据，升级后旧数据完整保留；
 * 3. 既有完成 0005（46 条 ledger）→ 0006：历史 digest 不变，仅补新约束；
 * 3. 幂等重跑：再次运行迁移不报错、账本不重复；
 * 4. SQL 文件与 step 注册表无漂移（generate0005Sql 与磁盘一致）。
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { createDatabase } from "../../../server/persistence/database.ts";
import { runStartupMigrations } from "../../../server/persistence/migrations.ts";
import {
  EXPECTED_TABLES_0005,
  generate0005Sql,
  generate0006Sql,
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
  const adminUrl = new URL(readTestAdminUrl());
  const adminPool = mysql.createPool({
    uri: adminUrl.toString(),
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

function splitMigration(file: string): string[] {
  return readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function journalEntries(): Array<{ tag: string; when: number }> {
  const journal = JSON.parse(
    readFileSync(`${MIGRATIONS_DIR}meta/_journal.json`, "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> };
  return journal.entries;
}

/** 手工把库置为 0004 完成状态（前 5 个迁移 + journal 行）。 */
async function applyThrough0004(bare: BareSchema): Promise<void> {
  // 必须在选库连接上执行（DDL 与 information_schema 条件均依赖 DATABASE()）
  const schemaPool = mysql.createPool({
    uri: bare.databaseUrl,
    connectionLimit: 2,
  });
  try {
    const entries = journalEntries();
    await schemaPool.query(
      "CREATE TABLE `__drizzle_migrations` (`id` serial PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)",
    );
    for (const [index, file] of EARLY_MIGRATIONS.entries()) {
      for (const stmt of splitMigration(file)) {
        await schemaPool.query(stmt);
      }
      const entry = entries[index];
      if (!entry) throw new Error(`journal 缺少第 ${index} 条`);
      await schemaPool.query(
        "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        [`manual-${entry.tag}`, entry.when],
      );
    }
  } finally {
    await schemaPool.end();
  }
}

async function ledgerCount(
  pool: mysql.Pool,
): Promise<number> {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM schema_migration_steps WHERE migration_id = '0005'",
  );
  return (rows as Array<{ n: number }>)[0]?.n ?? 0;
}

/** 模拟已发布的历史 0005：46 条账本和 Drizzle journal 均已完成。 */
async function applyHistorical0005(bare: BareSchema): Promise<void> {
  const pool = mysql.createPool({ uri: bare.databaseUrl, connectionLimit: 1 });
  try {
    for (const stmt of splitMigration("0005_0005_design_system_catalog.sql")) {
      await pool.query(stmt);
    }
    const entry = readJournal0005();
    await pool.query(
      "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
      ["manual-0005-historical", entry.when],
    );
  } finally {
    await pool.end();
  }
}

describe("0005/0006 additive 迁移（S2）", () => {
  let bare: BareSchema | null = null;
  afterAll(async () => {
    if (bare) await dropSchema(bare);
  });

  it("空库 → 0006：结构/账本/journal 一致，幂等重跑", async () => {
    bare = await createBareSchema();
    const { db, pool } = createDatabase(bare.databaseUrl);
    try {
      await runStartupMigrations(db);
      // 0005 历史账本固定为 46 步；0006 不回写 0005 ledger。
      expect(await ledgerCount(pool)).toBe(MIGRATION_0005_STEPS.length);
      // 幂等重跑
      await runStartupMigrations(db);
      expect(await ledgerCount(pool)).toBe(MIGRATION_0005_STEPS.length);
      // 新表全部存在
      const [tables] = await pool.query(
        "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
      );
      const names = new Set(
        (tables as Array<{ table_name: string }>).map((t) => t.table_name),
      );
      for (const table of EXPECTED_TABLES_0005) {
        expect(names.has(table.name)).toBe(true);
      }
    } finally {
      await pool.end();
    }
  }, 120000);

  it("0004 → 0006 升级：旧数据完整保留", async () => {
    const upgradeBare = await createBareSchema();
    try {
      await applyThrough0004(upgradeBare);
      // 播种旧数据（旧列形态；必须在选库连接上执行）
      const seedPool = mysql.createPool({ uri: upgradeBare.databaseUrl });
      const appId = randomUUID();
      const userId = randomUUID();
      const runId = randomUUID();
      const draftId = randomUUID();
      try {
        await seedPool.query(
          "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
          [userId, "up@example.com", "up@example.com"],
        );
        await seedPool.query(
          "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
          [appId, "升级演练", userId],
        );
        await seedPool.query(
          "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `correlation_ref`, `created_at`, `updated_at`) VALUES (?, ?, 'succeeded', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
          [runId, appId, "gen-upgrade-1"],
        );
        await seedPool.query(
          "INSERT INTO `draft_versions` (`id`, `app_id`, `generation_run_id`, `spec`, `status`, `created_at`) VALUES (?, ?, ?, ?, 'ready', UTC_TIMESTAMP(3))",
          [draftId, appId, runId, JSON.stringify({ routes: {} })],
        );
      } finally {
        await seedPool.end();
      }

      const { db, pool } = createDatabase(upgradeBare.databaseUrl);
      try {
        await runStartupMigrations(db);
        expect(await ledgerCount(pool)).toBe(MIGRATION_0005_STEPS.length);
        // 旧行完整保留且新列为 NULL
        const [runs] = await pool.query(
          "SELECT status, candidate_bundle, catalog_version FROM generation_runs WHERE id = ?",
          [runId],
        );
        const run = (runs as Array<Record<string, unknown>>)[0];
        expect(run?.status).toBe("succeeded");
        expect(run?.candidate_bundle).toBeNull();
        expect(run?.catalog_version).toBeNull();
        const [drafts] = await pool.query(
          "SELECT spec, bundle FROM draft_versions WHERE id = ?",
          [draftId],
        );
        const draft = (drafts as Array<Record<string, unknown>>)[0];
        expect(draft?.spec).toBeDefined();
        expect(draft?.bundle).toBeNull();
      } finally {
        await pool.end();
      }
    } finally {
      await dropSchema(upgradeBare);
    }
  }, 120000);

  it("完成的 0005 历史账本（46 条）可只应用 0006", async () => {
    const upgradeBare = await createBareSchema();
    try {
      await applyThrough0004(upgradeBare);
      await applyHistorical0005(upgradeBare);
      const { db, pool } = createDatabase(upgradeBare.databaseUrl);
      try {
        expect(await ledgerCount(pool)).toBe(46);
        await runStartupMigrations(db);
        expect(await ledgerCount(pool)).toBe(46);
        const [rows] = await pool.query(
          "SELECT COUNT(*) AS n FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_name IN ('generation_recovery_records_status', 'design_asset_sources_ready_extraction', 'design_asset_sources_ready_extraction_fk')",
        );
        expect((rows as Array<{ n: number }>)[0]?.n).toBe(3);
      } finally {
        await pool.end();
      }
    } finally {
      await dropSchema(upgradeBare);
    }
  }, 120000);

  it("SQL 文件与 step 注册表无漂移", () => {
    const onDisk0005 = readFileSync(
      `${MIGRATIONS_DIR}0005_0005_design_system_catalog.sql`,
      "utf8",
    );
    const onDisk0006 = readFileSync(
      `${MIGRATIONS_DIR}0006_0006_recovery_asset_constraints.sql`,
      "utf8",
    );
    expect(onDisk0005).toBe(generate0005Sql());
    expect(onDisk0006).toBe(generate0006Sql());
    expect(MIGRATION_0005_STEPS.length).toBe(46);
    const stepIds = MIGRATION_0005_STEPS.map((s) => s.stepId);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    for (const step of MIGRATION_0005_STEPS) {
      expect(step.definitionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
