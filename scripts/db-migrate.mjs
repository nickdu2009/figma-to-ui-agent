/**
 * 手动应用平台表迁移（与 server 启动时的 fail-closed 迁移同一路径）。
 * 用法：npm run db:migrate
 */
const { createDatabase, healthCheck, readDatabaseUrl } = await import(
 "../server/persistence/database.ts"
);
const { runStartupMigrations } = await import(
 "../server/persistence/migrations.ts"
);

const { db, pool } = createDatabase(readDatabaseUrl());
try {
 await healthCheck(pool);
 await runStartupMigrations(db);
 console.log("[db:migrate] platform migrations applied");
} finally {
 await pool.end();
}
