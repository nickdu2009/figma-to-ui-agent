/**
 * S9 集成测试：ValidationScheduler + ValidationService（计划 S9 验证）。
 *
 * 两层验证：
 * 1. 真实 ValidationScheduler + fake worker 测试替身（不经 Chromium）：
 *    容量（1 active/4 waiting/第 5 拒绝）、timeout、stdout 上限、RSS 击杀、
 *    临时工件配额、报告绑定/完整性/shape/失败/crash 的稳定失败类别；
 *    崩溃路径不产生部分报告。
 * 2. ValidationService + stub Scheduler + 隔离 MySQL schema：
 *    validation_running → awaiting_preview / recovery_pending / failed 的
 *    CAS 转移、reportDigest 落库、CAS 冲突丢弃（stale）、容量错误不改状态、
 *    case 超限在启动浏览器前 failed。
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  createTestDatabase,
  dropTestDatabase,
  type TestDatabaseHandle,
} from "../../helpers/test-database.ts";
import { MysqlReleaseRepository } from "../../../server/repositories/release-repository.ts";
import {
  ValidationCapacityError,
  ValidationScheduler,
  type ValidationJob,
  type ValidationJobOutcome,
} from "../../../server/validation/scheduler.ts";
import {
  ValidationService,
  type ValidationServiceDeps,
} from "../../../server/validation/service.ts";
import { ValidationSessionIssuer } from "../../../server/validation/session.ts";
import type { ValidationResourceEnvelopeV1 } from "../../../server/validation/resource-envelope.ts";
import type { WorkerReport } from "../../../server/validation/worker-protocol.ts";

const FAKE_WORKER = fileURLToPath(
  new URL("../../fixtures/validation/fake-worker.mjs", import.meta.url),
);

const FAST_ENVELOPE: ValidationResourceEnvelopeV1 = {
  jobTimeoutMs: 600,
  workerTerminationGraceMs: 200,
  workerMaxRssBytes: 256 * 1024 * 1024,
  workerStdoutStderrBytes: 8 * 1024,
  workerTemporaryArtifactBytes: 1024 * 1024,
  ipcReportBytes: 1024 * 1024,
  validationSessionTtlSeconds: 600,
  validationSessionMaxRequests: 512,
};

function makeJob(mode: string, overrides?: Partial<ValidationJob>): ValidationJob {
  const jobId = randomUUID();
  return {
    jobId,
    capability: "fake-capability",
    instructions: {
      jobId,
      bootstrapUrl: "http://127.0.0.1:3101/api/validation/bootstrap",
      pageUrl: mode,
      executablePath: undefined,
      candidateDigest: "cd-test",
      profileVersion: "pv-test",
      fatalVisualProfileVersion: "fv-test",
      cases: [
        {
          route: "/",
          viewport: { label: "desktop", width: 1440, height: 900 },
        },
        {
          route: "/",
          viewport: { label: "mobile", width: 390, height: 844 },
        },
      ],
      thresholds: {
        contentWidthMinRatio: 0.2,
        verticalCollapseMinCount: 1,
        overlapMinRatio: 0.5,
        overflowMaxPx: 24,
        clippedMinPx: 64,
        navGapMaxPx: 320,
        blankBandMaxPx: 400,
      },
      renderTimeoutMs: 1_000,
    },
    ...overrides,
  };
}

describe("S9 ValidationScheduler（真实调度器 + fake worker）", () => {
  it("completed 报告：绑定+完整性通过 → completed", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const outcome = await scheduler.enqueue(makeJob("fake://good"));
    expect(outcome.status).toBe("completed");
    expect(outcome.report?.plannedCases).toBe(2);
    expect(outcome.report?.cases).toHaveLength(2);
    expect(outcome.report?.candidateDigest).toBe("cd-test");
  });

  it("容量：1 active + 4 waiting；第 6 个在启动浏览器前拒绝", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: { ...FAST_ENVELOPE, jobTimeoutMs: 5_000 },
    });
    // 5 个慢 job 占满 1 active + 4 waiting
    const queued = [
      scheduler.enqueue(makeJob("fake://sleep/4000")),
      scheduler.enqueue(makeJob("fake://sleep/4000")),
      scheduler.enqueue(makeJob("fake://sleep/4000")),
      scheduler.enqueue(makeJob("fake://sleep/4000")),
      scheduler.enqueue(makeJob("fake://sleep/4000")),
    ];
    // 队列泵是同步的：第一个已进入 active，其余 waiting
    await new Promise((resolve) => setImmediate(resolve));
    expect(scheduler.depth).toEqual({ active: 1, waiting: 4 });
    await expect(scheduler.enqueue(makeJob("fake://good"))).rejects.toThrowError(
      ValidationCapacityError,
    );
    try {
      await scheduler.enqueue(makeJob("fake://good"));
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationCapacityError).code).toBe(
        "validation_capacity_exceeded",
      );
    }
    // 等待中的 job 全部超时失败（包络 5s jobTimeout？不——sleep 4000 < 5000 → completed）
    const outcomes = await Promise.all(queued);
    expect(outcomes.every((entry) => entry.status === "completed")).toBe(true);
  }, 30_000);

  it("timeout：SIGTERM→宽限→SIGKILL → validation_timeout，无部分报告", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const outcome = await scheduler.enqueue(makeJob("fake://sleep/30000"));
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("validation_timeout");
    expect(outcome.failureKind).toBe("timeout");
    expect(outcome.report).toBeUndefined();
  }, 15_000);

  it("stdout 上限：超限 SIGKILL → validation_output_limit_exceeded", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const outcome = await scheduler.enqueue(makeJob("fake://spew"));
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("validation_output_limit_exceeded");
    expect(outcome.failureKind).toBe("stdout_exceeded");
  }, 15_000);

  it("RSS 上限：子树 RSS 轮询击杀 → validation_memory_limit_exceeded", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: { ...FAST_ENVELOPE, workerMaxRssBytes: 96 * 1024 * 1024 },
    });
    const outcome = await scheduler.enqueue(makeJob("fake://alloc/512"));
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("validation_memory_limit_exceeded");
    expect(outcome.failureKind).toBe("rss_killed");
  }, 20_000);

  it("临时工件配额：worker 退出后父进程核验 → validation_output_limit_exceeded", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const outcome = await scheduler.enqueue(makeJob("fake://artifact/8"));
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("validation_output_limit_exceeded");
    expect(outcome.failureKind).toBe("temp_artifact_exceeded");
  }, 15_000);

  it("报告绑定不符 → validation_failed/report_binding_mismatch", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const outcome = await scheduler.enqueue(makeJob("fake://bad-digest"));
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("validation_failed");
    expect(outcome.failureKind).toBe("report_binding_mismatch");
  });

  it("矩阵未完整执行 → validation_failed/report_incomplete", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const outcome = await scheduler.enqueue(makeJob("fake://incomplete"));
    expect(outcome.status).toBe("failed");
    expect(outcome.code).toBe("validation_failed");
    expect(outcome.failureKind).toBe("report_incomplete");
  });

  it("非 JSON 输出 → validation_failed（crash）；status:failed → worker_failed；非零退出 → crash", async () => {
    const scheduler = new ValidationScheduler({
      workerEntry: FAKE_WORKER,
      envelope: FAST_ENVELOPE,
    });
    const invalid = await scheduler.enqueue(makeJob("fake://invalid-json"));
    expect(invalid.status).toBe("failed");
    expect(invalid.code).toBe("validation_failed");

    const workerFailed = await scheduler.enqueue(makeJob("fake://worker-failed"));
    expect(workerFailed.status).toBe("failed");
    expect(workerFailed.code).toBe("validation_failed");
    expect(workerFailed.failureKind).toBe("worker_failed");

    const crash = await scheduler.enqueue(makeJob("fake://crash"));
    expect(crash.status).toBe("failed");
    expect(crash.code).toBe("validation_failed");
    expect(crash.failureKind).toBe("crash");
  });
});

// ---------- ValidationService（stub Scheduler + 隔离 MySQL） ----------

function completedReport(issues: WorkerReport["cases"][number]["issues"]): WorkerReport {
  return {
    status: "completed",
    candidateDigest: "cd-svc",
    profileVersion: "p0-validation-v1",
    fatalVisualProfileVersion: "fatal-visual-v1",
    plannedCases: 2,
    cases: [
      {
        route: "/",
        viewport: { label: "desktop", width: 1440, height: 900 },
        metrics: {
          horizontalOverflowPx: 0,
          mainWidthRatio: 0.8,
          verticalCollapseCount: 0,
          maxOverlapRatio: 0,
          maxClippedPx: 0,
          navMainGapPx: 0,
          maxBlankBandPx: 0,
        },
        issues,
      },
      {
        route: "/",
        viewport: { label: "mobile", width: 390, height: 844 },
        metrics: {
          horizontalOverflowPx: 0,
          mainWidthRatio: 0.8,
          verticalCollapseCount: 0,
          maxOverlapRatio: 0,
          maxClippedPx: 0,
          navMainGapPx: 0,
          maxBlankBandPx: 0,
        },
        issues: [],
      },
    ],
  };
}


/** mysql2 的 JSON 列返回已解析对象（String(obj) 不是 JSON）。 */
function readJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

class StubScheduler {
  outcome: ValidationJobOutcome | Error = {
    status: "completed",
    report: completedReport([]),
    elapsedMs: 1,
    rssPeakBytes: 1,
  };
  enqueue(): Promise<ValidationJobOutcome> {
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
}

describe("S9 ValidationService（stub Scheduler + 隔离 schema）", () => {
  let handle: TestDatabaseHandle;
  let pool: mysql.Pool;
  let releaseRepository: MysqlReleaseRepository;
  let appId: string;
  let stubScheduler: StubScheduler;
  let service: ValidationService;

  const seedRun = async (
    status: string,
    options?: { candidateBundle?: unknown; candidateDigest?: string | null },
  ): Promise<string> => {
    const runId = randomUUID();
    await pool.query(
      "INSERT INTO `generation_runs` (`id`, `app_id`, `status`, `candidate_digest`, `candidate_bundle`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [
        runId,
        appId,
        status,
        options?.candidateDigest === undefined
          ? "cd-svc"
          : options.candidateDigest,
        JSON.stringify(
          options?.candidateBundle ?? {
            spec: { routes: { "/": {} } },
            assets: { entries: [] },
          },
        ),
      ],
    );
    return runId;
  };

  beforeAll(async () => {
    handle = await createTestDatabase();
    pool = handle.pool;
    releaseRepository = new MysqlReleaseRepository(handle.db);
    stubScheduler = new StubScheduler();
    service = new ValidationService({
      releaseRepository,
      scheduler: stubScheduler as unknown as ValidationServiceDeps["scheduler"],
      sessionIssuer: new ValidationSessionIssuer(),
      baseUrl: "http://127.0.0.1:3100",
    });
    const userId = randomUUID();
    appId = randomUUID();
    await pool.query(
      "INSERT INTO `users` (`id`, `email_normalized`, `email_display`, `created_at`, `updated_at`) VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [userId, `u-${userId}@example.com`, `u-${userId}@example.com`],
    );
    await pool.query(
      "INSERT INTO `apps` (`id`, `name`, `created_by_user_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [appId, `app-${appId}`, userId],
    );
  }, 120000);

  afterAll(async () => {
    await dropTestDatabase(handle);
  });

  it("无 fatal 完整报告 → awaiting_preview（报告+digest/profileVersion 落库）", async () => {
    stubScheduler.outcome = {
      status: "completed",
      report: completedReport([]),
      elapsedMs: 1,
      rssPeakBytes: 1,
    };
    const runId = await seedRun("validation_running");
    const outcome = await service.runValidation(runId);
    expect(outcome.status).toBe("awaiting_preview");
    const [rows] = await pool.query(
      "SELECT `status`, `report_digest`, `validation_profile_version`, `publish_blocked`, `validation_report` FROM `generation_runs` WHERE `id` = ?",
      [runId],
    );
    const row = (rows as Array<Record<string, unknown>>)[0]!;
    expect(row.status).toBe("awaiting_preview");
    expect(row.report_digest).toBeTruthy();
    expect(row.validation_profile_version).toBe("p0-validation-v1");
    expect(Number(row.publish_blocked)).toBe(0);
    const report = readJsonColumn(row.validation_report) as {
      candidateDigest: string;
      plannedCases: number;
      completedCases: number;
    };
    expect(report.candidateDigest).toBe("cd-svc");
    expect(report.plannedCases).toBe(2);
    expect(report.completedCases).toBe(2);
  });

  it("完整报告含 fatal → recovery_pending（fatalVisualIssues 落库）", async () => {
    stubScheduler.outcome = {
      status: "completed",
      report: completedReport([
        {
          code: "viewport_overflow",
          severity: "fatal",
          gate: "G1-fatal",
          path: "/",
          message: "横向溢出 120px",
          route: "/",
        },
      ]),
      elapsedMs: 1,
      rssPeakBytes: 1,
    };
    const runId = await seedRun("validation_running");
    const outcome = await service.runValidation(runId);
    expect(outcome.status).toBe("recovery_pending");
    const [rows] = await pool.query(
      "SELECT `status`, `fatal_visual_issues` FROM `generation_runs` WHERE `id` = ?",
      [runId],
    );
    const row = (rows as Array<Record<string, unknown>>)[0]!;
    expect(row.status).toBe("recovery_pending");
    const fatal = readJsonColumn(row.fatal_visual_issues) as Array<{
      code: string;
    }>;
    expect(fatal[0]?.code).toBe("viewport_overflow");
  });

  it("worker 基础设施失败 → failed/validation_failed（无报告落库）", async () => {
    stubScheduler.outcome = {
      status: "failed",
      code: "validation_timeout",
      failureKind: "timeout",
      elapsedMs: 1,
      rssPeakBytes: 1,
    };
    const runId = await seedRun("validation_running");
    const outcome = await service.runValidation(runId);
    expect(outcome).toEqual({ status: "failed", code: "validation_timeout" });
    const [rows] = await pool.query(
      "SELECT `status`, `diagnostics`, `validation_report` FROM `generation_runs` WHERE `id` = ?",
      [runId],
    );
    const row = (rows as Array<Record<string, unknown>>)[0]!;
    expect(row.status).toBe("failed");
    const diagnostics = readJsonColumn(row.diagnostics) as {
      code: string;
      reason: string;
    };
    expect(diagnostics.code).toBe("validation_failed");
    expect(diagnostics.reason).toBe("validation_timeout");
    expect(row.validation_report).toBeNull();
  });

  it("容量满 → capacity_exceeded 且 run 状态不变（可重试）", async () => {
    stubScheduler.outcome = new ValidationCapacityError();
    const runId = await seedRun("validation_running");
    const outcome = await service.runValidation(runId);
    expect(outcome.status).toBe("capacity_exceeded");
    const [rows] = await pool.query(
      "SELECT `status` FROM `generation_runs` WHERE `id` = ?",
      [runId],
    );
    expect((rows as Array<{ status: string }>)[0]!.status).toBe(
      "validation_running",
    );
  });

  it("CAS 冲突（状态已被他处推进）→ stale，不覆盖报告", async () => {
    stubScheduler.outcome = {
      status: "completed",
      report: completedReport([]),
      elapsedMs: 1,
      rssPeakBytes: 1,
    };
    // 播种为 running（非 validation_running）会被前置拒绝——用并发推进模拟：
    // 先播种 validation_running，再在 scheduler 返回前由他处推进状态。
    const runId = await seedRun("validation_running");
    const racing = new (class extends StubScheduler {
      override async enqueue(): Promise<ValidationJobOutcome> {
        await pool.query(
          "UPDATE `generation_runs` SET `status` = 'failed' WHERE `id` = ?",
          [runId],
        );
        return {
          status: "completed",
          report: completedReport([]),
          elapsedMs: 1,
          rssPeakBytes: 1,
        };
      }
    })();
    const racingService = new ValidationService({
      releaseRepository,
      scheduler: racing as unknown as ValidationServiceDeps["scheduler"],
      sessionIssuer: new ValidationSessionIssuer(),
      baseUrl: "http://127.0.0.1:3100",
    });
    const outcome = await racingService.runValidation(runId);
    expect(outcome.status).toBe("stale");
    const [rows] = await pool.query(
      "SELECT `status`, `report_digest` FROM `generation_runs` WHERE `id` = ?",
      [runId],
    );
    const row = (rows as Array<Record<string, unknown>>)[0]!;
    expect(row.status).toBe("failed");
    expect(row.report_digest).toBeNull();
  });

  it("case 超限（>512）在启动浏览器前 failed（validation_case_limit_exceeded）", async () => {
    const routes: Record<string, never> = {};
    for (let index = 0; index < 300; index++) routes[`/r${index}`] = {} as never;
    const runId = await seedRun("validation_running", {
      candidateBundle: { spec: { routes }, assets: { entries: [] } },
    });
    let schedulerCalled = false;
    const tracking = new (class extends StubScheduler {
      override enqueue(): Promise<ValidationJobOutcome> {
        schedulerCalled = true;
        return super.enqueue();
      }
    })();
    const trackingService = new ValidationService({
      releaseRepository,
      scheduler: tracking as unknown as ValidationServiceDeps["scheduler"],
      sessionIssuer: new ValidationSessionIssuer(),
      baseUrl: "http://127.0.0.1:3100",
    });
    const outcome = await trackingService.runValidation(runId);
    expect(outcome).toEqual({
      status: "failed",
      code: "validation_case_limit_exceeded",
    });
    expect(schedulerCalled).toBe(false); // 未启动浏览器/子进程
    const [rows] = await pool.query(
      "SELECT `status`, `diagnostics` FROM `generation_runs` WHERE `id` = ?",
      [runId],
    );
    const row = (rows as Array<Record<string, unknown>>)[0]!;
    expect(row.status).toBe("failed");
    expect(
      (readJsonColumn(row.diagnostics) as { reason: string }).reason,
    ).toBe("validation_case_limit_exceeded");
  });

  it("非 validation_running / 缺 Candidate → 拒绝（不动状态）", async () => {
    const running = await seedRun("running");
    await expect(service.runValidation(running)).rejects.toMatchObject({
      code: "validation_run_not_ready",
    });
    const noCandidate = await seedRun("validation_running", {
      candidateDigest: null,
    });
    await expect(service.runValidation(noCandidate)).rejects.toMatchObject({
      code: "validation_candidate_missing",
    });
  });
});
