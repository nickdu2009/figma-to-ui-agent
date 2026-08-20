/**
 * Validation Scheduler（设计 §11.5，计划 S9 动作 3–6）。
 *
 * - 全局 1 active / 4 waiting 有界 FIFO；第 5 个 waiting 在启动浏览器前
 *   以 validation_capacity_exceeded 失败；服务重启不恢复队列。
 * - worker 是独立子进程：不共享 Playwright Browser、页面对象或可变内存；
 *   按 ValidationResourceEnvelopeV1 执行 timeout/grace/RSS/输出/临时工件/
 *   IPC 报告上限；临时工件使用每 job 专用 tempDir，退出后父进程核验配额
 *   并删除目录。
 * - 崩溃/超时/超限只产生失败 outcome（稳定 code），父进程绝不把不完整
 *   输出组装成 ValidationReport；只有 schema 校验通过、case 完整、
 *   digest/profile 绑定的 completed 报告才上送 Service。
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  VALIDATION_CAPACITY_EXCEEDED,
  VALIDATION_RESOURCE_ENVELOPE_V1,
  type ValidationResourceEnvelopeV1,
} from "./resource-envelope.ts";
import {
  workerReportSchema,
  type WorkerInstructions,
  type WorkerReport,
} from "./worker-protocol.ts";

export const VALIDATION_MAX_ACTIVE_JOBS = 1;
export const VALIDATION_MAX_WAITING_JOBS = 4;

export type WorkerFailureKind =
  | "timeout"
  | "rss_killed"
  | "stdout_exceeded"
  | "report_exceeded"
  | "temp_artifact_exceeded"
  | "temp_artifact_unreadable"
  | "crash"
  | "spawn_error"
  | "worker_failed"
  | "report_invalid"
  | "report_incomplete"
  | "report_binding_mismatch";

export type WorkerFailureCode =
  | "validation_timeout"
  | "validation_memory_limit_exceeded"
  | "validation_output_limit_exceeded"
  | "validation_failed";

export interface ValidationJobOutcome {
  status: "completed" | "failed";
  /** status=failed 时的稳定 code（映射自失败类别）。 */
  code?: WorkerFailureCode;
  /** 失败类别（诊断用；不进入用户可见报告）。 */
  failureKind?: WorkerFailureKind;
  /** worker 自报的稳定失败码（failureKind=worker_failed 时；诊断用）。 */
  workerCode?: string;
  /** worker 自报的有界诊断详情（诊断用；不含堆栈/凭据）。 */
  workerDetail?: string;
  report?: WorkerReport;
  elapsedMs: number;
  rssPeakBytes: number;
}

export class ValidationCapacityError extends Error {
  readonly code = VALIDATION_CAPACITY_EXCEEDED;
  constructor() {
    super("验证队列容量已满（1 active / 4 waiting）");
  }
}

export interface ValidationJob {
  jobId: string;
  instructions: Omit<WorkerInstructions, "capability">;
  /** capability 原值只在写入指令文件时经手；不进入日志。 */
  capability: string;
}

interface QueuedJob {
  job: ValidationJob;
  resolve: (outcome: ValidationJobOutcome) => void;
}

interface WorkerChild {
  pid: number | undefined;
  exitCode: number | null;
  stdout: { on(event: "data", cb: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: "data", cb: (chunk: Buffer) => void): void } | null;
  kill(signal?: string): void;
  on(event: "close", cb: (code: number | null, signal: string | null) => void): void;
  on(event: "error", cb: (error: Error) => void): void;
}

function psSnapshot(): {
  rssOf: Map<number, number>;
  childrenOf: Map<number, number[]>;
} | null {
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

function subtreeRssBytes(rootPid: number): number {
  const snap = psSnapshot();
  if (!snap) return 0;
  let totalKb = snap.rssOf.get(rootPid) ?? 0;
  const queue = [...(snap.childrenOf.get(rootPid) ?? [])];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    totalKb += snap.rssOf.get(pid) ?? 0;
    for (const child of snap.childrenOf.get(pid) ?? []) queue.push(child);
  }
  return totalKb * 1024;
}

/**
 * 目录字节合计（worker 临时工件配额核验；跟随一级子目录）。
 *
 * 注意：读取失败绝不能被折算为 0。0 是一个有效、可通过配额的测量值；把
 * I/O 错误伪装成 0 会让父进程在无法核验临时工件时错误接受 worker 报告。
 */
function directoryBytes(root: string): number | null {
  let total = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
    }
  };
  try {
    walk(root, 0);
  } catch {
    return null;
  }
  return total;
}

function validationCaseKey(caseValue: {
  route: string;
  params?: Record<string, string>;
  viewport: { label: string; width: number; height: number };
}): string {
  const params = Object.entries(caseValue.params ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify({
    route: caseValue.route,
    params,
    viewport: caseValue.viewport,
  });
}

/**
 * 不只比较数量：worker 必须恰好回传已计划的 route/params/viewport 多重集。
 * 这能拒绝“重复一个 case、遗漏另一个 case”这类长度相同的部分报告。
 */
function reportsExactlyPlannedCases(
  planned: readonly WorkerInstructions["cases"][number][],
  actual: readonly WorkerReport["cases"][number][],
): boolean {
  if (planned.length !== actual.length) return false;
  const remaining = new Map<string, number>();
  for (const caseValue of planned) {
    const key = validationCaseKey(caseValue);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const caseValue of actual) {
    const key = validationCaseKey(caseValue);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) remaining.delete(key);
    else remaining.set(key, count - 1);
  }
  return remaining.size === 0;
}

export class ValidationScheduler {
  private readonly envelope: ValidationResourceEnvelopeV1;
  private readonly workerEntry: string;
  private active = 0;
  private readonly waiting: QueuedJob[] = [];

  constructor(options: {
    /** worker 子进程入口（server/validation/worker.ts 的可执行路径）。 */
    workerEntry: string;
    envelope?: ValidationResourceEnvelopeV1;
  }) {
    this.workerEntry = options.workerEntry;
    this.envelope = options.envelope ?? VALIDATION_RESOURCE_ENVELOPE_V1;
  }

  /** 队列深度（监控/测试用）。 */
  get depth(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length };
  }

  /**
   * 排队执行一个验证 job。容量满（1 active + 4 waiting）时同步抛
   * ValidationCapacityError——在启动任何浏览器/子进程之前。
   */
  enqueue(job: ValidationJob): Promise<ValidationJobOutcome> {
    if (
      this.active >= VALIDATION_MAX_ACTIVE_JOBS &&
      this.waiting.length >= VALIDATION_MAX_WAITING_JOBS
    ) {
      return Promise.reject(new ValidationCapacityError());
    }
    return new Promise<ValidationJobOutcome>((resolve) => {
      this.waiting.push({ job, resolve });
      this.pump();
    });
  }

  private pump(): void {
    while (
      this.active < VALIDATION_MAX_ACTIVE_JOBS &&
      this.waiting.length > 0
    ) {
      const next = this.waiting.shift();
      if (!next) return;
      this.active += 1;
      void this.runWorker(next.job)
        .then(next.resolve)
        .catch(() =>
          next.resolve({
            status: "failed",
            code: "validation_failed",
            failureKind: "crash",
            elapsedMs: 0,
            rssPeakBytes: 0,
          }),
        )
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  /** 服务进程内丢弃等待队列（重启语义：不恢复队列）。 */
  discardWaiting(): void {
    const dropped = this.waiting.splice(0);
    for (const entry of dropped) {
      entry.resolve({
        status: "failed",
        code: "validation_failed",
        failureKind: "crash",
        elapsedMs: 0,
        rssPeakBytes: 0,
      });
    }
  }

  private runWorker(job: ValidationJob): Promise<ValidationJobOutcome> {
    const tmp = mkdtempSync(join(tmpdir(), "vma-validation-worker-"));
    const artifactDir = join(tmp, "artifacts");
    const instructionsPath = join(tmp, "instructions.json");
    const instructions: WorkerInstructions = {
      ...job.instructions,
      capability: job.capability,
    };
    writeFileSync(instructionsPath, JSON.stringify(instructions));
    const envelope = this.envelope;

    return new Promise<ValidationJobOutcome>((resolvePromise) => {
      const child = spawn(process.execPath, [this.workerEntry, instructionsPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          VMA_VALIDATION_ARTIFACT_DIR: artifactDir,
        },
      }) as unknown as WorkerChild;

      let rawBytes = 0;
      const chunks: Buffer[] = [];
      let killReason: "stdout" | "rss" | "timeout" | null = null;
      let rssPeak = 0;
      const start = performance.now();

      const finish = (
        outcome: Omit<ValidationJobOutcome, "elapsedMs" | "rssPeakBytes">,
      ) => {
        // 临时工件配额：worker 退出后父进程核验（超限即失败 outcome）。
        let finalOutcome = outcome;
        if (outcome.status === "completed") {
          const artifactBytes = directoryBytes(tmp);
          if (artifactBytes === null) {
            finalOutcome = {
              status: "failed",
              code: "validation_output_limit_exceeded",
              failureKind: "temp_artifact_unreadable",
            };
          }
          // instructions.json 自身占用从配额中扣除（只计 worker 产物）
          if (artifactBytes !== null) {
            const instructionsBytes = statSync(instructionsPath).size;
            const workerBytes = Math.max(0, artifactBytes - instructionsBytes);
            if (workerBytes > envelope.workerTemporaryArtifactBytes) {
              finalOutcome = {
                status: "failed",
                code: "validation_output_limit_exceeded",
                failureKind: "temp_artifact_exceeded",
              };
            }
          }
        }
        rmSync(tmp, { recursive: true, force: true });
        resolvePromise({
          ...finalOutcome,
          elapsedMs: performance.now() - start,
          rssPeakBytes: rssPeak,
        });
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        rawBytes += chunk.length;
        if (killReason === null) chunks.push(chunk);
        if (rawBytes > envelope.workerStdoutStderrBytes && killReason === null) {
          killReason = "stdout";
          child.kill("SIGKILL");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        // stderr 不进入 IPC 报告，但仍属于 worker 的输出资源包络，防止
        // worker 通过 stderr 绕过 stdout 预算耗尽父进程内存/管道资源。
        rawBytes += chunk.length;
        if (rawBytes > envelope.workerStdoutStderrBytes && killReason === null) {
          killReason = "stdout";
          child.kill("SIGKILL");
        }
      });

      let graceTimer: NodeJS.Timeout | null = null;
      const poll = setInterval(() => {
        if (child.pid === undefined || killReason !== null) return;
        const rss = subtreeRssBytes(child.pid);
        if (rss > 0) rssPeak = Math.max(rssPeak, rss);
        if (rssPeak > envelope.workerMaxRssBytes && killReason === null) {
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
        }, envelope.workerTerminationGraceMs);
      }, envelope.jobTimeoutMs);

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        clearInterval(poll);

        if (killReason === "stdout") {
          finish({
            status: "failed",
            code: "validation_output_limit_exceeded",
            failureKind: "stdout_exceeded",
          });
          return;
        }
        if (killReason === "rss") {
          finish({
            status: "failed",
            code: "validation_memory_limit_exceeded",
            failureKind: "rss_killed",
          });
          return;
        }
        if (killReason === "timeout") {
          finish({
            status: "failed",
            code: "validation_timeout",
            failureKind: "timeout",
          });
          return;
        }
        const text = Buffer.concat(chunks).toString("utf8");
        const lastLine =
          text
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .pop() ?? "";
        if (lastLine.length > envelope.ipcReportBytes) {
          finish({
            status: "failed",
            code: "validation_output_limit_exceeded",
            failureKind: "report_exceeded",
          });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(lastLine);
        } catch {
          parsed = null;
        }
        const validated = workerReportSchema.safeParse(parsed);
        if (!validated.success) {
          // 非零退出且无可解析报告 → crash；可解析但形状非法 → report_invalid
          finish({
            status: "failed",
            code: "validation_failed",
            failureKind:
              code !== 0 || signal !== null || parsed === null
                ? "crash"
                : "report_invalid",
          });
          return;
        }
        const report = validated.data;
        if (report.status === "failed") {
          finish({
            status: "failed",
            code: "validation_failed",
            failureKind: "worker_failed",
            // 保留 worker 的稳定失败码供诊断（不进入用户可见报告）
            workerCode: report.code,
            ...(report.detail ? { workerDetail: report.detail } : {}),
          });
          return;
        }
        // 绑定核对：digest/profile 必须与本 job 计划一致
        if (
          report.candidateDigest !== job.instructions.candidateDigest ||
          report.profileVersion !== job.instructions.profileVersion ||
          report.fatalVisualProfileVersion !==
            job.instructions.fatalVisualProfileVersion
        ) {
          finish({
            status: "failed",
            code: "validation_failed",
            failureKind: "report_binding_mismatch",
          });
          return;
        }
        // 完整性：矩阵必须完整执行，且身份必须与计划的 case 多重集完全一致。
        if (
          report.plannedCases !== job.instructions.cases.length ||
          !reportsExactlyPlannedCases(job.instructions.cases, report.cases)
        ) {
          finish({
            status: "failed",
            code: "validation_failed",
            failureKind: "report_incomplete",
          });
          return;
        }
        finish({ status: "completed", report });
      });

      child.on("error", () => {
        clearTimeout(timer);
        if (graceTimer) clearTimeout(graceTimer);
        clearInterval(poll);
        finish({
          status: "failed",
          code: "validation_failed",
          failureKind: "spawn_error",
        });
      });
    });
  }
}
