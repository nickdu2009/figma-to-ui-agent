import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { Database } from "./database.ts";

/**
 * 启动迁移（fail-closed）：
 * - 空库或落后库：应用 server/db/migrations 下的受管迁移；
 * - 迁移失败：抛 BootMigrationError，服务拒绝启动（设计 §9、AC1）。
 */
export class BootMigrationError extends Error {
  readonly code = "boot_migration_failed";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BootMigrationError";
  }
}

const MIGRATIONS_FOLDER = join(
  dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);

export async function runStartupMigrations(db: Database): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    throw new BootMigrationError(
      "平台表迁移失败：服务拒绝启动。注意：MySQL DDL 不可回滚，失败时可能已应用部分迁移；请检查已应用迁移记录并重试迁移，或从备份恢复后重试",
      { cause: error },
    );
  }
}
