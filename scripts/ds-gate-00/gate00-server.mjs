#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-04：探针模式服务端包装。
 *
 * - 创建隔离 MySQL schema（vma_gate00_<随机>，仅本地探针使用）
 * - 以 VMA_AGENT_MODE=probe 在隔离端口启动 server/index.ts
 * - 采样服务端子进程 RSS 峰值（供 2MiB finish 探针记录服务端内存）
 * - 退出时清理：终止子进程并 DROP 隔离 schema
 *
 * 该包装不触碰任何现有数据库 schema。
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import mysql from "mysql2/promise";
import process from "node:process";

const repoRoot = new URL("../..", import.meta.url).pathname;
const adminUrl =
  process.env.VMA_TEST_ADMIN_DATABASE_URL ??
  "mysql://root:vma-root-local-dev-only@127.0.0.1:3317";
const schemaName = `vma_gate00_${randomBytes(6).toString("hex")}`;
const serverPort = process.env.VMA_GATE00_SERVER_PORT ?? "3199";
const agentMode = process.env.VMA_GATE00_AGENT_MODE ?? "probe";
// RSS 峰值结果文件（由 generation-finish-probe.ts 传入路径后汇总）。
const resultFile = process.env.VMA_GATE00_RESULT_FILE ?? null;

const SCHEMA_PATTERN = /^vma_gate00_[0-9a-f]{12}$/;
if (!SCHEMA_PATTERN.test(schemaName)) {
  console.error("[gate00-server] invalid schema name (refuse DDL)");
  process.exit(2);
}

let child = null;
let peakRssBytes = 0;
let cleanedUp = false;

function writeResultFile() {
  if (!resultFile) return;
  try {
    writeFileSync(
      resultFile,
      JSON.stringify({ peakRssBytes, schemaName, serverPort }, null, 2),
    );
  } catch {
    /* 结果文件写入失败不影响运行 */
  }
}

function sampleRss() {
  if (!child?.pid) return;
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
      encoding: "utf8",
      timeout: 1_500,
    });
    const kb = Number(out.trim());
    if (Number.isFinite(kb)) {
      const changed = kb * 1024 > peakRssBytes;
      peakRssBytes = Math.max(peakRssBytes, kb * 1024);
      // 每次采样都同步写结果文件：Playwright 拆除可能直接 SIGKILL，
      // 信号处理器没有机会运行（前几轮已观察到 schema/结果文件泄漏）。
      if (changed) writeResultFile();
    }
  } catch {
    /* 进程退出中 */
  }
}

async function dropSchema() {
  const admin = await mysql.createConnection(adminUrl);
  try {
    await admin.query(`DROP SCHEMA IF EXISTS \`${schemaName}\``);
  } finally {
    await admin.end();
  }
}

async function cleanup(code) {
  if (cleanedUp) return;
  cleanedUp = true;
  writeResultFile();
  if (child && child.exitCode === null) {
    child.kill("SIGKILL");
  }
  try {
    await dropSchema();
  } catch (error) {
    console.error(
      `[gate00-server] schema drop failed: ${String(error instanceof Error ? error.message : error)}`,
    );
  }
  console.error(
    `[gate00-server] schema=${schemaName} dropped; peakRssBytes=${peakRssBytes}`,
  );
  process.exit(code ?? 0);
}

process.on("SIGTERM", () => void cleanup(0));
process.on("SIGINT", () => void cleanup(0));

// 1) 创建隔离 schema
{
  const admin = await mysql.createConnection(adminUrl);
  try {
    await admin.query(`CREATE SCHEMA \`${schemaName}\``);
  } catch (error) {
    console.error(
      "[gate00-server] MySQL 不可用：请先运行 `npm run db:up`（docker compose up -d --wait）",
    );
    console.error(
      `    cause: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    await admin.end();
  }
}

// 2) 启动服务端（受控 Agent 模式、隔离库、隔离端口）。默认 probe；真实
// E2E 必须由专用 Playwright 配置显式传入 openai，避免普通 Gate 探针误耗模型。
child = spawn(process.execPath, ["server/index.ts"], {
  cwd: repoRoot,
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...process.env,
    VMA_AGENT_MODE: agentMode,
    VMA_SERVER_PORT: serverPort,
    VMA_DATABASE_URL: `${adminUrl}/${schemaName}`,
  },
});

const rssTimer = setInterval(sampleRss, 500);
child.on("exit", (code) => {
  clearInterval(rssTimer);
  void cleanup(code ?? 0);
});
