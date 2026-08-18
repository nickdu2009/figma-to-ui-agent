import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import {
  createDatabase,
  healthCheck,
  type Database,
} from "../../server/persistence/database.ts";
import { runStartupMigrations } from "../../server/persistence/migrations.ts";

/**
 * Per-test MySQL schema 隔离（GATE-00 决策补充 §5 / 计划 S8）：
 * 每个测试文件创建独立 schema（vma_test_<随机>），用完 DROP。
 * 管理员连接串只从环境读取；默认指向本地 docker-compose 开发库的 root。
 */

const DEFAULT_ADMIN_URL = "mysql://root:vma-root-local-dev-only@127.0.0.1:3317";

// schema 标识符白名单：仅允许本 helper 生成的固定格式，禁止外部输入进入 DDL。
const TEST_SCHEMA_PATTERN = /^vma_test_[0-9a-f]{12}$/;

function assertTestSchemaName(schemaName: string): void {
  if (!TEST_SCHEMA_PATTERN.test(schemaName)) {
    throw new Error(`非法测试 schema 名（拒绝执行 DDL）：${schemaName}`);
  }
}

export function readTestAdminUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.VMA_TEST_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_URL;
}

export interface TestDatabaseHandle {
  db: Database;
  pool: mysql.Pool;
  schemaName: string;
  databaseUrl: string;
}

export async function createTestDatabase(): Promise<TestDatabaseHandle> {
  const adminUrl = readTestAdminUrl();
  const schemaName = `vma_test_${randomBytes(6).toString("hex")}`;
  const admin = mysql.createPool({ uri: adminUrl, connectionLimit: 2 });
  try {
    assertTestSchemaName(schemaName);
    await admin.query(`CREATE SCHEMA \`${schemaName}\``);
  } catch (error) {
    await admin.end();
    throw new Error(
      "测试 MySQL 不可用：请先运行 `npm run db:up`（docker compose up -d --wait）",
      { cause: error },
    );
  }
  await admin.end();

  const databaseUrl = `${adminUrl}/${schemaName}`;
  const { db, pool } = createDatabase(databaseUrl);
  await healthCheck(pool);
  await runStartupMigrations(db);
  return { db, pool, schemaName, databaseUrl };
}

export async function dropTestDatabase(
  handle: TestDatabaseHandle,
): Promise<void> {
  await handle.pool.end();
  const admin = mysql.createPool({
    uri: readTestAdminUrl(),
    connectionLimit: 1,
  });
  try {
    assertTestSchemaName(handle.schemaName);
    await admin.query(`DROP SCHEMA IF EXISTS \`${handle.schemaName}\``);
  } finally {
    await admin.end();
  }
}

/** 用同一 schema 新建连接，模拟“重启本地服务”（AC1 读回验证）。 */
export async function reconnectTestDatabase(
  handle: TestDatabaseHandle,
): Promise<TestDatabaseHandle> {
  const { db, pool } = createDatabase(handle.databaseUrl);
  await healthCheck(pool);
  return { ...handle, db, pool };
}
