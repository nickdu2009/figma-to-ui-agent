/**
 * S8：迁移演练（设计 §9，AC1）。
 * 1. 空库升级：全新 schema 跑启动迁移，全部表就位，重复运行幂等。
 * 2. 上一个测试 schema 升级演练：手工把库置为 0002 状态（前三个迁移
 *    + drizzle 追踪表），播种数据，再跑启动迁移只补 0003/0004，
 *    旧数据必须完整保留。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import mysql from "mysql2/promise";
import { createDatabase } from "../../../server/persistence/database.ts";
import { runStartupMigrations } from "../../../server/persistence/migrations.ts";
import { readTestAdminUrl } from "../../helpers/test-database.ts";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../server/db/migrations/", import.meta.url),
);
const EARLY_MIGRATIONS = [
  "0000_0001_platform_init.sql",
  "0001_0002_utf8mb4_bin_collation.sql",
  "0002_0003_generation_correlation.sql",
];

async function createBareSchema(): Promise<{
  schemaName: string;
  databaseUrl: string;
  adminPool: mysql.Pool;
}> {
  const adminUrl = new URL(readTestAdminUrl());
  const adminPool = mysql.createPool({
    uri: adminUrl.toString(),
    connectionLimit: 2,
    multipleStatements: true,
  });
  const schemaName = `vma_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await adminPool.query(`CREATE SCHEMA \`${schemaName}\``);
  // 与既有测试助手一致：用 admin 凭据直连新 schema（root 具备全部权限）
  return {
    schemaName,
    databaseUrl: `${readTestAdminUrl()}/${schemaName}`,
    adminPool,
  };
}

async function dropSchema(adminPool: mysql.Pool, schemaName: string) {
  await adminPool.query(`DROP SCHEMA IF EXISTS \`${schemaName}\``);
  await adminPool.end();
}

async function tableExists(
  pool: mysql.Pool,
  schema: string,
  table: string,
): Promise<boolean> {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
    [schema, table],
  );
  return Number((rows as Array<{ n: number }>)[0].n) === 1;
}

describe("S8 迁移演练", () => {
  const created: Array<{ schemaName: string; adminPool: mysql.Pool }> = [];
  afterAll(async () => {
    for (const { schemaName, adminPool } of created) {
      await dropSchema(adminPool, schemaName).catch(() => {});
    }
  });

  it("空库升级：全部表就位且重复运行幂等", async () => {
    const { schemaName, databaseUrl, adminPool } = await createBareSchema();
    created.push({ schemaName, adminPool });
    const handle = createDatabase(databaseUrl);
    await runStartupMigrations(handle.db);
    // 重复运行：已应用的迁移不得重放（drizzle 追踪表）
    await runStartupMigrations(handle.db);
    for (const table of [
      "users",
      "apps",
      "generation_runs",
      "draft_versions",
      "business_records",
      "deleted_items",
    ]) {
      expect(await tableExists(handle.pool, schemaName, table), table).toBe(
        true,
      );
    }
    await handle.pool.end();
  });

  it("旧 schema（0002 状态）升级：只补后续迁移且旧数据保留", async () => {
    const { schemaName, databaseUrl, adminPool } = await createBareSchema();
    created.push({ schemaName, adminPool });
    const workPool = mysql.createPool({
      uri: databaseUrl,
      connectionLimit: 2,
      multipleStatements: true,
    });

    // 1. 手工置为 0002 状态：执行前三个迁移并登记 drizzle 追踪表。
    // drizzle 按 journal 的 when 与追踪表最大 created_at 决定待应用集合，
    // 因此 created_at 必须与 journal 一致。
    const journal = JSON.parse(
      readFileSync(`${MIGRATIONS_DIR}meta/_journal.json`, "utf8"),
    ) as { entries: Array<{ tag: string; when: number }> };
    await workPool.query(
      "CREATE TABLE `__drizzle_migrations` (`id` serial PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)",
    );
    for (const file of EARLY_MIGRATIONS) {
      const tag = file.replace(/\.sql$/, "");
      const entry = journal.entries.find((e) => e.tag === tag);
      if (!entry) throw new Error(`journal 中找不到 ${tag}`);
      const sql = readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const statement of statements) {
        await workPool.query(statement);
      }
      const hash = createHash("sha256").update(sql).digest("hex");
      await workPool.query(
        "INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)",
        [hash, entry.when],
      );
    }
    // 0003/0004 的表此时必须不存在
    expect(await tableExists(workPool, schemaName, "business_records")).toBe(
      false,
    );

    // 2. 播种旧数据
    const userId = randomUUID();
    await workPool.query(
      "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `is_admin`, `created_at`, `updated_at`) VALUES (?, ?, ?, false, NOW(3), NOW(3))",
      [userId, "drill@example.com", "drill@example.com"],
    );

    // 3. 启动迁移：只补 0003/0004
    const handle = createDatabase(databaseUrl);
    await runStartupMigrations(handle.db);

    // 4. 旧数据完整保留 + 新表出现 + 再跑幂等
    const [users] = await workPool.query(
      "SELECT `email_normalized` FROM `users` WHERE `id` = ?",
      [userId],
    );
    expect(
      (users as Array<{ email_normalized: string }>)[0].email_normalized,
    ).toBe("drill@example.com");
    expect(await tableExists(workPool, schemaName, "business_records")).toBe(
      true,
    );
    expect(await tableExists(workPool, schemaName, "deleted_items")).toBe(true);
    await runStartupMigrations(handle.db);
    await handle.pool.end();
    await workPool.end();
  });
});
