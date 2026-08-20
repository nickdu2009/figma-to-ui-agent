#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-04：2MiB generation finish 探针汇总入口。
 *
 * 步骤：
 *  1. 确保本地 MySQL 可用（docker compose up -d --wait；隔离 schema 由
 *     gate00-server.mjs 自动创建并在退出时 DROP，不触碰现有库）。
 *  2. 运行 playwright（playwright.gate00.config.ts）：vite 3198 +
 *     probe server 3199 + gate00-generation-finish.spec.ts。
 *  3. 汇总浏览器侧 [gate00-finish] 指标与服务端 RSS 峰值，输出脱敏 JSON。
 *
 * 运行：node scripts/ds-gate-00/generation-finish-probe.ts
 * 需要 PLAYWRIGHT_CHROMIUM_EXECUTABLE。不调用任何真实 LLM。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  console.error(
    "[finish-probe] FAIL: PLAYWRIGHT_CHROMIUM_EXECUTABLE is required",
  );
  process.exit(1);
}

// 1) 本地 MySQL：先探活；不可达才尝试 docker compose（避免与既有容器冲突）
async function mysqlReachable(): Promise<boolean> {
  const mysql = await import("mysql2/promise");
  const url =
    process.env.VMA_TEST_ADMIN_DATABASE_URL ??
    "mysql://root:vma-root-local-dev-only@127.0.0.1:3317";
  try {
    const conn = await mysql.createConnection(url);
    try {
      await conn.ping();
      return true;
    } finally {
      await conn.end();
    }
  } catch {
    return false;
  }
}
if (!(await mysqlReachable())) {
  try {
    execFileSync("docker", ["compose", "up", "-d", "--wait"], {
      stdio: "pipe",
      timeout: 120_000,
    });
  } catch (error) {
    console.error(
      "[finish-probe] FAIL: MySQL unreachable and docker compose up failed",
      String(error instanceof Error ? error.message : error),
    );
    process.exit(1);
  }
}

// 2) 运行 playwright gate00 探针
const resultFile = join(
  mkdtempSync(join(tmpdir(), "vma-gate00-finish-")),
  "server-rss.json",
);
const playwrightRun = spawnSync(
  "npx",
  ["playwright", "test", "--config", "playwright.gate00.config.ts"],
  {
    encoding: "utf8",
    timeout: 300_000,
    env: {
      ...process.env,
      VMA_GATE00_RESULT_FILE: resultFile,
    },
  },
);

const finishLines: string[] = [];
for (const line of (playwrightRun.stdout ?? "").split("\n")) {
  if (line.includes("[gate00-finish]")) finishLines.push(line.trim());
}

interface FinishMetrics {
  scenario: "probe" | "overflow";
  generationId: string;
  utf8Bytes: number;
  structureOk: boolean;
  latencyMs: number;
  heapUsedBefore: number | null;
  heapUsedAfter: number | null;
}
const metrics: FinishMetrics[] = [];
for (const line of finishLines) {
  const jsonStart = line.indexOf("{");
  if (jsonStart === -1) continue;
  try {
    const parsed = JSON.parse(line.slice(jsonStart)) as FinishMetrics;
    if (parsed.scenario && parsed.utf8Bytes) metrics.push(parsed);
  } catch {
    /* 汇总行（非完整 JSON）忽略 */
  }
}

// 3) 服务端 RSS 峰值
let serverRss: { peakRssBytes: number; schemaName: string } | null = null;
try {
  serverRss = JSON.parse(readFileSync(resultFile, "utf8"));
} catch {
  serverRss = null;
}

// 3b) 清扫残留探针 schema：vma_gate00_* 仅由本探针创建（pattern 固定、
// 不含任何用户数据）；Playwright SIGKILL 可能绕过 gate00-server 的
// 退出清理，这里在 run 结束后统一回收。
let leftoverSchemasDropped = 0;
try {
  const mysql = await import("mysql2/promise");
  const adminUrl =
    process.env.VMA_TEST_ADMIN_DATABASE_URL ??
    "mysql://root:vma-root-local-dev-only@127.0.0.1:3317";
  const conn = await mysql.createConnection(adminUrl);
  try {
    const [rows] = await conn.query(
      "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name LIKE 'vma_gate00_%'",
    );
    for (const row of rows as Array<{ name: string }>) {
      if (!/^vma_gate00_[0-9a-f]{12}$/.test(row.name)) continue; // 白名单 DDL
      // mysql2 标识符占位符 ??：由驱动做标识符转义，无字符串插值。
      await conn.query("DROP SCHEMA IF EXISTS ??", [row.name]);
      leftoverSchemasDropped++;
    }
  } finally {
    await conn.end();
  }
} catch {
  /* 清扫失败不影响探针结论（仅残留隔离探针 schema） */
}

const probeMetrics = metrics.find((m) => m.scenario === "probe");
const overflowMetrics = metrics.find((m) => m.scenario === "overflow");

const summary = {
  probe: "ds-gate-00/generation-finish-probe",
  node: process.version,
  measuredAt: new Date().toISOString(),
  playwrightExitCode: playwrightRun.status,
  nearLimit: probeMetrics
    ? {
        utf8Bytes: probeMetrics.utf8Bytes,
        structureOk: probeMetrics.structureOk,
        firstEventToFinishMs: Math.round(probeMetrics.latencyMs),
        heapUsedBeforeBytes: probeMetrics.heapUsedBefore,
        heapUsedAfterBytes: probeMetrics.heapUsedAfter,
      }
    : null,
  overLimit: overflowMetrics
    ? {
        utf8Bytes: overflowMetrics.utf8Bytes,
        structureOk: overflowMetrics.structureOk,
        firstEventToFinishMs: Math.round(overflowMetrics.latencyMs),
        heapUsedBeforeBytes: overflowMetrics.heapUsedBefore,
        heapUsedAfterBytes: overflowMetrics.heapUsedAfter,
        behavior:
          "transported without truncation (no server-side cap implemented pre-S11)",
      }
    : null,
  serverPeakRssBytes: serverRss?.peakRssBytes ?? null,
  isolatedSchema: serverRss?.schemaName ?? null,
  leftoverSchemasDropped,
  playwrightFailed:
    playwrightRun.status === 0
      ? null
      : (playwrightRun.stdout ?? "").split("\n").slice(-30),
};

rmSync(join(resultFile, ".."), { recursive: true, force: true });

console.log(JSON.stringify(summary, null, 2));
if (playwrightRun.status !== 0 || !probeMetrics || !overflowMetrics) {
  process.exitCode = 1;
}
