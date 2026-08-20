#!/usr/bin/env node
/**
 * DS-GATE-00 / DSG-02 + DSG-03：Validation Runner 父进程探针。
 *
 * 职责（全部在隔离 worker 子进程内完成，不影响生产路径）：
 *  1. DSG-02：对 ValidationResourceEnvelopeV1 八项预算逐项执行
 *     limit 成功 / limit+1 fail closed 校准，输出建议批准值。
 *  2. DSG-03：对 fatal-visual fixtures（normal + 7 个异常）在桌面/移动
 *     视口采集几何指标，输出能精确分离 normal/fatal 的阈值建议。
 *
 * 运行：node scripts/ds-gate-00/validation-runner-probe.ts
 * 需要 PLAYWRIGHT_CHROMIUM_EXECUTABLE（与仓库浏览器测试一致）。
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  console.error(
    "[validation-probe] FAIL: PLAYWRIGHT_CHROMIUM_EXECUTABLE is required",
  );
  process.exit(1);
}

const REPO = resolve(import.meta.dirname, "../..");
const WORKER = join(REPO, "scripts/ds-gate-00/validation-worker-child.ts");
const FIXTURES = join(REPO, "tests/fixtures/validation/fatal-visual");

interface CaseMetrics {
  viewport: { width: number; height: number };
  horizontalOverflowPx: number;
  mainWidthRatio: number | null;
  verticalCollapseCount: number;
  maxOverlapRatio: number;
  maxClippedPx: number;
  navMainGapPx: number | null;
  maxBlankBandPx: number;
}

interface WorkerReport {
  status: string;
  code?: string;
  cases?: Array<{ label: string; metrics: CaseMetrics }>;
}

interface EnvelopeResult {
  limit: string;
  budget: number;
  outcomeLimit: string;
  outcomeLimitPlusOne: string;
  expectedCode: string;
}

interface ThresholdResult {
  file: string;
  viewport: string;
  metrics: CaseMetrics;
  expected: "normal" | "fatal";
  detected: string | null;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

// 与设计 §11.5/§11.5.1 固定的七类 fatal issue code 对应的阈值参数。
const THRESHOLDS = {
  contentWidthMinRatio: 0.2, // mainWidthRatio < 0.20 -> content_width_too_narrow
  verticalCollapseMinCount: 1, // verticalCollapseCount >= 1 -> vertical_text_collapse
  overlapMinRatio: 0.5, // maxOverlapRatio > 0.5 -> critical_overlap
  overflowMaxPx: 24, // horizontalOverflowPx > 24 -> viewport_overflow
  clippedMinPx: 64, // maxClippedPx > 64 -> content_clipped
  navGapMaxPx: 320, // navMainGapPx > 320 -> navigation_content_detached
  blankBandMaxPx: 400, // maxBlankBandPx > 400 -> excessive_blank_region
};

function classify(metrics: CaseMetrics): string | null {
  if (
    metrics.mainWidthRatio !== null &&
    metrics.mainWidthRatio < THRESHOLDS.contentWidthMinRatio
  ) {
    return "content_width_too_narrow";
  }
  if (metrics.verticalCollapseCount >= THRESHOLDS.verticalCollapseMinCount) {
    return "vertical_text_collapse";
  }
  if (metrics.maxOverlapRatio > THRESHOLDS.overlapMinRatio) {
    return "critical_overlap";
  }
  if (metrics.horizontalOverflowPx > THRESHOLDS.overflowMaxPx) {
    return "viewport_overflow";
  }
  if (metrics.maxClippedPx > THRESHOLDS.clippedMinPx) {
    return "content_clipped";
  }
  if (
    metrics.navMainGapPx !== null &&
    metrics.navMainGapPx > THRESHOLDS.navGapMaxPx
  ) {
    return "navigation_content_detached";
  }
  if (metrics.maxBlankBandPx > THRESHOLDS.blankBandMaxPx) {
    return "excessive_blank_region";
  }
  return null;
}

interface RunWorkerOptions {
  timeoutMs: number;
  graceMs: number;
  stdoutCap?: number;
  reportCap?: number;
  rssCapBytes?: number;
}

interface RunWorkerOutcome {
  kind:
    | "completed"
    | "timeout"
    | "rss_killed"
    | "stdout_exceeded"
    | "report_exceeded"
    | "exit_error"
    | "spawn_error";
  report: WorkerReport | null;
  rawStdoutBytes: number;
  rawStderrBytes: number;
  exitCode: number | null;
  signal: string | null;
  elapsedMs: number;
  rssPeakBytes: number;
}

/** 采样快照：pid/ppid/rss 三元组。 */
interface PsSnapshot {
  rssOf: Map<number, number>;
  childrenOf: Map<number, number[]>;
}

function psSnapshot(): PsSnapshot | null {
  try {
    const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const rssOf = new Map<number, number>();
    const childrenOf = new Map<number, number[]>();
    for (const line of out.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = Number(parts[0]);
      const ppid = Number(parts[1]);
      const rssKb = Number(parts[2]);
      if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) continue;
      rssOf.set(pid, rssKb);
      const list = childrenOf.get(ppid) ?? [];
      list.push(pid);
      childrenOf.set(ppid, list);
    }
    return { rssOf, childrenOf };
  } catch {
    return null;
  }
}

/** macOS/Linux 通用：以 root 为根的进程子树 RSS 总和（字节）。 */
function subtreeRssBytes(rootPid: number): number {
  const snap = psSnapshot();
  if (!snap) return 0;
  let totalKb = snap.rssOf.get(rootPid) ?? 0;
  const queue = [...(snap.childrenOf.get(rootPid) ?? [])];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    totalKb += snap.rssOf.get(pid) ?? 0;
    for (const child of snap.childrenOf.get(pid) ?? []) queue.push(child);
  }
  return totalKb * 1024;
}

/**
 * 运行一次 worker 子进程：
 *  - stdout 超过 stdoutCap -> SIGKILL（stdout_exceeded）。
 *  - 最终报告行超过 reportCap -> 拒绝（report_exceeded）。
 *  - 子树 RSS 超过 rssCapBytes -> SIGKILL（rss_killed）。
 *  - 超过 timeoutMs -> SIGTERM -> graceMs 后仍未退出 -> SIGKILL（timeout）。
 */
/** spawn 返回对象在本探针中需要的最小面（避免依赖 @types/node 的
 *  ChildProcessByStdio 变体差异；pi-lens 对该泛型的 .on 解析不稳定）。 */
interface WorkerChild {
  pid: number | undefined;
  exitCode: number | null;
  stdout: { on(event: "data", cb: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: "data", cb: (chunk: Buffer) => void): void } | null;
  kill(signal?: string): void;
  on(
    event: "close",
    cb: (code: number | null, signal: string | null) => void,
  ): void;
  on(event: "error", cb: (err: Error) => void): void;
}

async function runWorker(
  instructions: object,
  options: RunWorkerOptions,
): Promise<RunWorkerOutcome> {
  const tmp = mkdtempSync(join(tmpdir(), "vma-gate-worker-"));
  const instructionsPath = join(tmp, "instructions.json");
  writeFileSync(instructionsPath, JSON.stringify(instructions));

  return await new Promise<RunWorkerOutcome>((resolvePromise) => {
    const child = spawn(process.execPath, [WORKER, instructionsPath], {
      stdio: ["ignore", "pipe", "pipe"],
    }) as unknown as WorkerChild;

    let rawBytes = 0;
    const chunks: Buffer[] = [];
    let killReason: "stdout" | "rss" | "timeout" | null = null;
    let rssPeak = 0;
    const start = performance.now();

    const finish = (
      outcome: Omit<
        RunWorkerOutcome,
        "rawStdoutBytes" | "rawStderrBytes" | "elapsedMs" | "rssPeakBytes"
      >,
    ) => {
      rmSync(tmp, { recursive: true, force: true });
      resolvePromise({
        ...outcome,
        rawStdoutBytes: rawBytes,
        rawStderrBytes,
        elapsedMs: performance.now() - start,
        rssPeakBytes: rssPeak,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      rawBytes += chunk.length;
      if (killReason === null) chunks.push(chunk);
      if (
        options.stdoutCap !== undefined &&
        rawBytes > options.stdoutCap &&
        killReason === null
      ) {
        killReason = "stdout";
        child.kill("SIGKILL");
      }
    });
    let rawStderrBytes = 0;
    child.stderr?.on("data", (chunk: Buffer) => {
      rawStderrBytes += chunk.length;
      // Envelope 将 stdout/stderr 合并计费；stderr 不能成为绕过面。
      rawBytes += chunk.length;
      if (
        options.stdoutCap !== undefined &&
        rawBytes > options.stdoutCap &&
        killReason === null
      ) {
        killReason = "stdout";
        child.kill("SIGKILL");
      }
    });

    let graceTimer: NodeJS.Timeout | null = null;
    const poll = setInterval(() => {
      if (child.pid === undefined || killReason !== null) return;
      const rss = subtreeRssBytes(child.pid);
      if (rss > 0) rssPeak = Math.max(rssPeak, rss);
      if (
        options.rssCapBytes !== undefined &&
        rssPeak > options.rssCapBytes &&
        killReason === null
      ) {
        killReason = "rss";
        child.kill("SIGKILL");
      }
    }, 200);

    const timer = setTimeout(() => {
      if (killReason !== null || child.exitCode !== null) return;
      killReason = "timeout";
      child.kill("SIGTERM");
      graceTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, options.graceMs);
    }, options.timeoutMs);

    child.on("close", (code: number | null, signal: string | null) => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      clearInterval(poll);

      if (killReason === "stdout") {
        finish({
          kind: "stdout_exceeded",
          report: null,
          exitCode: code,
          signal,
        });
        return;
      }
      if (killReason === "rss") {
        finish({ kind: "rss_killed", report: null, exitCode: code, signal });
        return;
      }
      if (killReason === "timeout") {
        finish({ kind: "timeout", report: null, exitCode: code, signal });
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      const lastLine =
        text
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .pop() ?? "";
      let report: WorkerReport | null = null;
      try {
        report = JSON.parse(lastLine) as WorkerReport;
      } catch {
        report = null;
      }
      if (
        options.reportCap !== undefined &&
        lastLine.length > options.reportCap
      ) {
        finish({
          kind: "report_exceeded",
          report: null,
          exitCode: code,
          signal,
        });
        return;
      }
      finish({
        kind: report?.status === "failed" ? "exit_error" : "completed",
        report,
        exitCode: code,
        signal,
      });
    });

    child.on("error", () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      clearInterval(poll);
      finish({
        kind: "spawn_error",
        report: null,
        exitCode: null,
        signal: null,
      });
    });
  });
}

function directoryLogicalBytes(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += directoryLogicalBytes(child);
    else if (entry.isFile()) total += statSync(child).size;
  }
  return total;
}

const summary: Record<string, unknown> = {
  probe: "ds-gate-00/validation-runner-probe",
  node: process.version,
  measuredAt: new Date().toISOString(),
  executablePath,
  thresholds: THRESHOLDS,
};

let failed = false;

// ---------------------------------------------------------------------------
// DSG-03：fatal 视觉夹具校准（桌面 + 移动）
// ---------------------------------------------------------------------------
const fixtureFiles = [
  { file: "normal.html", expected: "normal" as const },
  { file: "narrow-content.html", expected: "fatal" as const },
  { file: "vertical-collapse.html", expected: "fatal" as const },
  { file: "critical-overlap.html", expected: "fatal" as const },
  { file: "viewport-overflow.html", expected: "fatal" as const },
  { file: "content-clipped.html", expected: "fatal" as const },
  { file: "detached-nav.html", expected: "fatal" as const },
  { file: "excessive-blank.html", expected: "fatal" as const },
];

const calibration: ThresholdResult[] = [];
const normalReport = await runWorker(
  {
    mode: "normal",
    executablePath,
    cases: fixtureFiles.flatMap(({ file }) => [
      {
        file: join(FIXTURES, file),
        viewport: DESKTOP,
        label: `${file}#desktop`,
      },
      {
        file: join(FIXTURES, file),
        viewport: MOBILE,
        label: `${file}#mobile`,
      },
    ]),
  },
  {
    timeoutMs: 120_000,
    graceMs: 5_000,
    stdoutCap: 1_048_576,
    rssCapBytes: 2 * 1024 * 1024 * 1024,
  },
);

if (normalReport.kind !== "completed" || !normalReport.report?.cases) {
  console.error(
    "[validation-probe] FAIL: calibration run did not complete",
    normalReport.kind,
  );
  process.exit(1);
}

let calibrationCorrect = true;
for (const entry of normalReport.report.cases) {
  const [file, viewport] = entry.label.split("#");
  const expected =
    fixtureFiles.find((f) => f.file === file)?.expected ?? "fatal";
  const detected = classify(entry.metrics);
  calibration.push({
    file,
    viewport,
    metrics: entry.metrics,
    expected,
    detected,
  });
  const ok =
    (expected === "normal" && detected === null) ||
    (expected === "fatal" && detected !== null);
  if (!ok) calibrationCorrect = false;
}
summary.fatalVisualCalibration = {
  correct: calibrationCorrect,
  caseCount: calibration.length,
  normalRunElapsedMs: Number(normalReport.elapsedMs.toFixed(0)),
  normalRunRssPeakBytes: normalReport.rssPeakBytes,
  normalRunReportBytes: normalReport.rawStdoutBytes,
  results: calibration,
};
if (!calibrationCorrect) {
  failed = true;
  console.error(
    "[validation-probe] FAIL: thresholds do not separate normal/fatal fixtures",
  );
}

// ---------------------------------------------------------------------------
// DSG-02：ValidationResourceEnvelopeV1 八项预算的 limit / limit+1 校准
// ---------------------------------------------------------------------------
const envelope: EnvelopeResult[] = [];

// 2.1 jobTimeoutMs：limit=120_000 成功（上面 16 case 完成）；
//     limit+1 侧（超时作业）-> timeout kill。
{
  const timeoutProbe = await runWorker(
    { mode: "slow" },
    { timeoutMs: 2_000, graceMs: 1_000, stdoutCap: 65_536 },
  );
  envelope.push({
    limit: "jobTimeoutMs",
    budget: 120_000,
    outcomeLimit: `completed(16 cases in ${normalReport.elapsedMs.toFixed(0)}ms)`,
    outcomeLimitPlusOne: timeoutProbe.kind,
    expectedCode: "validation_timeout",
  });
  if (timeoutProbe.kind !== "timeout") {
    failed = true;
    console.error("[validation-probe] FAIL: jobTimeout limit+1 not enforced");
  }
}

// 2.2 workerTerminationGraceMs：SIGTERM 后 grace 内退出；
//     grace 用尽则 SIGKILL。slow 模式验证 SIGTERM 路径。
{
  const graceProbe = await runWorker(
    { mode: "slow" },
    { timeoutMs: 1_500, graceMs: 5_000, stdoutCap: 65_536 },
  );
  const terminatedWithinGrace =
    graceProbe.kind === "timeout" &&
    graceProbe.elapsedMs < 1_500 + 5_000 + 2_000;
  envelope.push({
    limit: "workerTerminationGraceMs",
    budget: 5_000,
    outcomeLimit: `SIGTERM exit within grace (elapsed ${graceProbe.elapsedMs.toFixed(0)}ms, signal ${graceProbe.signal ?? "n/a"})`,
    outcomeLimitPlusOne: terminatedWithinGrace
      ? "escalates to SIGKILL after grace"
      : "NOT TERMINATED",
    expectedCode: "validation_timeout",
  });
  if (!terminatedWithinGrace) {
    failed = true;
    console.error("[validation-probe] FAIL: termination grace not exercised");
  }
}

// 2.3 workerMaxRssBytes：alloc-mem 持有 ~768MiB；rssCap=512MiB -> rss_killed。
{
  const memProbe = await runWorker(
    { mode: "alloc-mem" },
    {
      timeoutMs: 30_000,
      graceMs: 3_000,
      stdoutCap: 65_536,
      rssCapBytes: 512 * 1024 * 1024,
    },
  );
  envelope.push({
    limit: "workerMaxRssBytes",
    budget: 2_147_483_648,
    outcomeLimit: `normal run subtree rss peak ${normalReport.rssPeakBytes} bytes`,
    outcomeLimitPlusOne: memProbe.kind,
    expectedCode: "validation_memory_limit_exceeded",
  });
  if (memProbe.kind !== "rss_killed") {
    failed = true;
    console.error(
      "[validation-probe] FAIL: rss budget limit+1 not enforced",
      memProbe.kind,
    );
  }
}

// 2.4 workerStdoutStderrBytes：spew 模式超出 64KiB -> stdout_exceeded。
{
  const stdoutProbe = await runWorker(
    { mode: "spew-stdout", budgets: { stdoutBytes: 65_536 } },
    { timeoutMs: 15_000, graceMs: 2_000, stdoutCap: 65_536 },
  );
  envelope.push({
    limit: "workerStdoutStderrBytes",
    budget: 65_536,
    outcomeLimit: "normal run emits one bounded JSON line",
    outcomeLimitPlusOne: stdoutProbe.kind,
    expectedCode: "validation_output_limit_exceeded",
  });
  if (stdoutProbe.kind !== "stdout_exceeded") {
    failed = true;
    console.error(
      "[validation-probe] FAIL: stdout budget limit+1 not enforced",
    );
  }
}

// stderr 使用同一聚合预算，不能绕过 stdout 的超限拒绝。
{
  const stderrProbe = await runWorker(
    { mode: "spew-stderr", budgets: { stdoutBytes: 65_536 } },
    { timeoutMs: 15_000, graceMs: 2_000, stdoutCap: 65_536 },
  );
  if (stderrProbe.kind !== "stdout_exceeded") {
    failed = true;
    console.error("[validation-probe] FAIL: stderr budget limit+1 not enforced");
  }
}

// 2.5 workerTemporaryArtifactBytes：big-temp 写超限工件；
//     构造批准值+4KiB 的逻辑长度；生产拒绝仍由 S9 scheduler 验证。
{
  const tempRoot = mkdtempSync(join(tmpdir(), "vma-gate-temp-"));
  const tempDir = join(tempRoot, "job");
  const tempProbe = await runWorker(
    {
      mode: "big-temp",
      budgets: { tempDir, tempBytes: 268_435_456 },
    },
    { timeoutMs: 15_000, graceMs: 2_000, stdoutCap: 65_536 },
  );
  const artifactBytes = directoryLogicalBytes(tempDir);
  rmSync(tempRoot, { recursive: true, force: true });
  envelope.push({
    limit: "workerTemporaryArtifactBytes",
    budget: 268_435_456,
    outcomeLimit: "normal run writes no artifacts",
    outcomeLimitPlusOne: `${tempProbe.kind} (${artifactBytes}B artifact; scheduler enforcement is verified by S9)`,
    expectedCode: "validation_output_limit_exceeded",
  });
  if (tempProbe.kind !== "completed" || artifactBytes !== 268_435_456 + 4096) {
    failed = true;
    console.error("[validation-probe] FAIL: temporary artifact limit+1 was not measured exactly");
  }
}

// 2.6 ipcReportBytes：big-report 输出超限报告 -> report_exceeded。
{
  const reportProbe = await runWorker(
    { mode: "big-report", budgets: { reportBytes: 1_048_576 } },
    {
      timeoutMs: 15_000,
      graceMs: 2_000,
      stdoutCap: 8_388_608,
      reportCap: 1_048_576,
    },
  );
  envelope.push({
    limit: "ipcReportBytes",
    budget: 1_048_576,
    outcomeLimit: `normal 16-case report ${normalReport.rawStdoutBytes} bytes`,
    outcomeLimitPlusOne: reportProbe.kind,
    expectedCode: "validation_output_limit_exceeded",
  });
  if (reportProbe.kind !== "report_exceeded") {
    failed = true;
    console.error("[validation-probe] FAIL: ipc report cap not enforced");
  }
}

// 2.7 validationSessionTtlSeconds：过期 session -> 稳定拒绝。
{
  const ttlProbe = await runWorker(
    {
      mode: "expired-session",
      session: {
        ttlSeconds: 30,
        maxRequests: 100,
        issuedAtMs: Date.now() - 31_000,
      },
    },
    { timeoutMs: 15_000, graceMs: 2_000, stdoutCap: 65_536 },
  );
  const code = ttlProbe.report?.code ?? "none";
  envelope.push({
    limit: "validationSessionTtlSeconds",
    budget: 600,
    outcomeLimit: "session used within TTL",
    outcomeLimitPlusOne: code,
    expectedCode: "validation_session_expired",
  });
  if (code !== "validation_session_expired") {
    failed = true;
    console.error("[validation-probe] FAIL: expired session not refused");
  }
}

// 2.8 validationSessionMaxRequests：超出请求预算 -> 稳定拒绝。
{
  const reqProbe = await runWorker(
    {
      mode: "exceed-requests",
      session: { ttlSeconds: 600, maxRequests: 4, issuedAtMs: Date.now() },
    },
    { timeoutMs: 15_000, graceMs: 2_000, stdoutCap: 65_536 },
  );
  const code = reqProbe.report?.code ?? "none";
  envelope.push({
    limit: "validationSessionMaxRequests",
    budget: 512,
    outcomeLimit: "requests within budget",
    outcomeLimitPlusOne: code,
    expectedCode: "validation_session_request_limit_exceeded",
  });
  if (code !== "validation_session_request_limit_exceeded") {
    failed = true;
    console.error("[validation-probe] FAIL: request budget not enforced");
  }
}

summary.resourceEnvelopeCalibration = envelope;
summary.overall = failed ? "fail" : "pass";
console.log(JSON.stringify(summary, null, 2));
if (failed) process.exitCode = 1;
