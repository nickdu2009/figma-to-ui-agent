#!/usr/bin/env node
/**
 * S16：v2 首次部署与联合恢复演练。
 *
 * 仅在 --confirm 下执行。它创建两个随机、白名单命名的 MySQL schema 及两个
 * OS 临时资产目录：源环境完成完整 Mock 浏览器验收，随后将 MySQL 表和资产目录
 * 克隆到恢复环境，验证迁移账本、Bundle/spec 投影和 Blob SHA-256。无默认库、
 * 用户资产目录或 down migration 会被触碰。
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, cp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import mysql from "mysql2/promise";

const confirmed = process.argv.slice(2).includes("--confirm");
if (!confirmed) {
  console.error(
    "[s16] dry-run only: pass --confirm to create isolated schemas and temporary asset roots",
  );
  process.exit(2);
}

const adminUrl =
  process.env.VMA_TEST_ADMIN_DATABASE_URL ??
  "mysql://root:vma-root-local-dev-only@127.0.0.1:3317";
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!chromium) {
  console.error("[s16] PLAYWRIGHT_CHROMIUM_EXECUTABLE is required");
  process.exit(2);
}

const suffix = randomBytes(6).toString("hex");
const sourceSchema = `vma_s16_${suffix}`;
const restoredSchema = `vma_s16_restore_${suffix}`;
const schemaPattern = /^vma_s16(?:_restore)?_[0-9a-f]{12}$/;
if (!schemaPattern.test(sourceSchema) || !schemaPattern.test(restoredSchema)) {
  throw new Error("[s16] generated schema rejected by cleanup allowlist");
}

const sourceAssetRoot = await mkdtemp(path.join(tmpdir(), "vma-s16-source-"));
const restoredAssetRoot = await mkdtemp(path.join(tmpdir(), "vma-s16-restored-"));
const sourceUrl = withSchema(adminUrl, sourceSchema);
const restoredUrl = withSchema(adminUrl, restoredSchema);
let admin;

function quoteIdent(name) {
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`[s16] unsafe identifier: ${name}`);
  return `\`${name}\``;
}

function withSchema(url, schema) {
  const parsed = new URL(url);
  parsed.pathname = `/${schema}`;
  return parsed.toString();
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`[s16] ${command} ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

async function tableNames(schema) {
  const [rows] = await admin.query(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
    [schema],
  );
  return rows.map((row) => row.tableName);
}

async function tableCounts(schema, tables) {
  const counts = {};
  for (const table of tables) {
    const [rows] = await admin.query(
      `SELECT COUNT(*) AS count FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
    );
    counts[table] = Number(rows[0].count);
  }
  return counts;
}

async function cloneSchema(source, target) {
  const tables = await tableNames(source);
  await admin.query(`CREATE SCHEMA ${quoteIdent(target)}`);
  await admin.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    await admin.query(`USE ${quoteIdent(target)}`);
    for (const table of tables) {
      // CREATE TABLE ... LIKE 会静默丢弃外键与 CHECK；恢复必须复用完整 DDL，
      // 否则受控 migration preflight 应（并且确实会）拒绝该伪恢复库启动。
      const [definition] = await admin.query(
        `SHOW CREATE TABLE ${quoteIdent(source)}.${quoteIdent(table)}`,
      );
      const createSql = definition[0]["Create Table"];
      if (typeof createSql !== "string" || !createSql.startsWith("CREATE TABLE")) {
        throw new Error(`[s16] cannot read complete DDL for ${table}`);
      }
      await admin.query(createSql);
      await admin.query(
        `INSERT INTO ${quoteIdent(target)}.${quoteIdent(table)} SELECT * FROM ${quoteIdent(source)}.${quoteIdent(table)}`,
      );
    }
  } finally {
    await admin.query("SET FOREIGN_KEY_CHECKS = 1");
  }
  return tables;
}

async function verifyBundles(schema) {
  const [draftRows] = await admin.query(
    `SELECT COUNT(*) AS count FROM ${quoteIdent(schema)}.\`draft_versions\` WHERE bundle IS NULL`,
  );
  const [publishedRows] = await admin.query(
    `SELECT COUNT(*) AS count FROM ${quoteIdent(schema)}.\`published_versions\` WHERE bundle IS NULL`,
  );
  if (Number(draftRows[0].count) !== 0 || Number(publishedRows[0].count) !== 0) {
    throw new Error("[s16] restored Bundle/spec projection has NULL bundle rows");
  }
}

async function verifyBlobs(schema, assetRoot) {
  const [rows] = await admin.query(
    `SELECT content_hash AS contentHash, byte_length AS byteLength FROM ${quoteIdent(schema)}.\`design_asset_blobs\` WHERE status = 'ready'`,
  );
  for (const row of rows) {
    const hashHex = String(row.contentHash).replace(/^sha256:/, "");
    if (!/^[a-f0-9]{64}$/.test(hashHex)) throw new Error("[s16] invalid stored Blob hash");
    const blobPath = path.join(assetRoot, "sha256", hashHex.slice(0, 2), hashHex);
    const bytes = await readFile(blobPath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    const fileStat = await stat(blobPath);
    if (actual !== hashHex || fileStat.size !== Number(row.byteLength)) {
      throw new Error(`[s16] restored Blob verification failed: sha256:${hashHex}`);
    }
  }
  return rows.length;
}

async function cleanup() {
  const drop = async (schema) => {
    if (schemaPattern.test(schema)) {
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)}`);
    }
  };
  await Promise.all([
    drop(sourceSchema),
    drop(restoredSchema),
    rm(sourceAssetRoot, { recursive: true, force: true }),
    rm(restoredAssetRoot, { recursive: true, force: true }),
  ]);
}

try {
  admin = await mysql.createConnection(adminUrl);
  await admin.query(`CREATE SCHEMA ${quoteIdent(sourceSchema)}`);

  await run("npm", ["run", "build:runtime"]);
  await run("node", ["scripts/db-migrate.mjs"], {
    VMA_DATABASE_URL: sourceUrl,
    VMA_PROTOCOL_MODE: "v2",
  });
  await run("npx", ["playwright", "test", "--config", "playwright.mock.config.ts"], {
    VMA_DATABASE_URL: sourceUrl,
    VMA_PROTOCOL_MODE: "v2",
    VMA_E2E_ASSET_ROOT: sourceAssetRoot,
    PLAYWRIGHT_CHROMIUM_EXECUTABLE: chromium,
  });

  const tables = await cloneSchema(sourceSchema, restoredSchema);
  const sourceCounts = await tableCounts(sourceSchema, tables);
  const restoredCounts = await tableCounts(restoredSchema, tables);
  if (JSON.stringify(sourceCounts) !== JSON.stringify(restoredCounts)) {
    throw new Error("[s16] database restore table counts differ from source snapshot");
  }
  await rm(restoredAssetRoot, { recursive: true, force: true });
  await cp(sourceAssetRoot, restoredAssetRoot, { recursive: true, force: true });
  await run("node", ["scripts/db-migrate.mjs"], {
    VMA_DATABASE_URL: restoredUrl,
    VMA_PROTOCOL_MODE: "v2",
  });
  await verifyBundles(restoredSchema);
  const blobCount = await verifyBlobs(restoredSchema, restoredAssetRoot);
  const migrationSteps = restoredCounts.schema_migration_steps ?? 0;
  const journalRows = restoredCounts.__drizzle_migrations ?? 0;
  // 历史 ledger 的精确条目数由受控迁移定义决定；恢复正确性的判据是：
  // 源/恢复计数逐表一致（上方已比较）、非空，且 restored preflight+postflight 通过。
  if (migrationSteps === 0 || journalRows === 0) {
    throw new Error("[s16] restored migration ledger is incomplete");
  }
  console.log(
    JSON.stringify(
      {
        status: "passed",
        protocolMode: "v2",
        schemas: "isolated-and-cleaned",
        tableCount: tables.length,
        migrationSteps,
        journalRows,
        blobCount,
      },
      null,
      2,
    ),
  );
} finally {
  if (admin) {
    await cleanup().catch((error) => {
      console.error(`[s16] cleanup failed: ${String(error)}`);
      process.exitCode = 1;
    });
    await admin.end();
  }
}
