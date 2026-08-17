import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../db/schema.ts";

/**
 * 数据库连接（GATE-00 决策补充 §1/§5）。
 * - 驱动：mysql2（稳定版，Drizzle 官方支持）。
 * - 连接串只从进程环境读取；缺省值为本地 docker-compose 开发库。
 * - Docker/MySQL 不可用时 fail-closed：启动健康检查失败即拒绝启动，
 *   不降级为内存模式。
 */

export const DEFAULT_DATABASE_URL =
  "mysql://vma:vma-local-dev-only@127.0.0.1:3317/vite_multipage_agent";

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.VMA_DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export type Database = ReturnType<typeof createDatabase>["db"];

export function createDatabase(url: string = readDatabaseUrl()) {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 8,
    supportBigNumbers: true,
    // 会话时区固定 UTC，datetime 读写不产生时区漂移。
    timezone: "Z",
    // 显式超时与队列上限：默认 queueLimit=0 无限排队，数据库故障时请求堆积。
    connectTimeout: 10_000,
    waitForConnections: true,
    queueLimit: 64,
  });
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool };
}

export class DatabaseUnavailableError extends Error {
  readonly code = "database_unavailable";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

/** 启动健康检查：失败即 DatabaseUnavailableError（fail-closed）。 */
export async function healthCheck(
  pool: mysql.Pool,
  timeoutMs = 5000,
): Promise<void> {
  const acquisition: Promise<mysql.PoolConnection> = pool.getConnection();
  // 吸收拒绝，避免超时路径的未处理 Promise 告警
  acquisition.catch(() => undefined);
  let conn: mysql.PoolConnection | undefined;
  try {
    conn = await Promise.race([
      acquisition,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("health check timed out")),
          timeoutMs,
        ),
      ),
    ]);
    // ping 为驱动级探活，不经 SQL 文本
    await conn.ping();
  } catch (error) {
    // 评审修复：超时后迟到的连接必须释放，否则每次超时泄漏一个池连接
    acquisition.then((late) => late.release()).catch(() => undefined);
    throw new DatabaseUnavailableError(
      "MySQL 不可用：请先运行 `npm run db:up`（docker compose up -d --wait）",
      { cause: error },
    );
  } finally {
    conn?.release();
  }
}
