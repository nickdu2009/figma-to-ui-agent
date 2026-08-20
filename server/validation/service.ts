/**
 * ValidationService（设计 §11.5，计划 S9 动作 5–6）。
 *
 * 编排 validation_running → {awaiting_preview | recovery_pending | failed}：
 * - 前置：run 必须处于 validation_running 且 candidateDigest/candidateBundle
 *   在位；case 清单在启动浏览器前计算，超限 → failed(validation_failed/
 *   validation_case_limit_exceeded)；
 * - 每 job 签发单 job/短时/请求预算受限的 ValidationSession capability，
 *   job 结束（任何结果）即吊销；
 * - Scheduler 容量满 → validation_capacity_exceeded（可重试，不改 run 状态）；
 * - 完整报告：fatal → recovery_pending；无 fatal → awaiting_preview
 *   （publishBlocked=普通 G1 error 存在性，P0 恒 false）；CAS 失败丢弃报告；
 * - 基础设施失败（timeout/RSS/输出/崩溃/绑定或完整性不符）→
 *   failed，diagnostics.code="validation_failed"（不产生部分报告/finish/
 *   草稿/recovery）。
 *
 * 同文件挂载 capability 端点（计划 S9 文件清单无独立 routes 文件）：
 * - GET /api/validation/bootstrap：只读 Candidate 交付（无 Cookie/Session）；
 * - GET /api/validation/assets/:assetId：allowlist 内的 DesignAsset 字节。
 */
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { MysqlReleaseRepository } from "../repositories/release-repository.ts";
import { reportDigest as computeReportDigest } from "../bundle/digests.ts";
import {
  VALIDATION_FAILED,
  VALIDATION_RESOURCE_ENVELOPE_V1,
  type ValidationResourceEnvelopeV1,
} from "./resource-envelope.ts";
import {
  FATAL_VISUAL_PROFILE_VERSION,
  FATAL_VISUAL_THRESHOLDS_V1,
  VALIDATION_PROFILE_VERSION,
  ValidationCaseLimitError,
  expandValidationCases,
} from "./profile.ts";
import {
  type ValidationSessionIssuer,
  ValidationSessionRejection,
  VALIDATION_SESSION_MODE,
  type ValidationSessionGrant,
} from "./session.ts";
import {
  ValidationCapacityError,
  type ValidationScheduler,
  type ValidationJobOutcome,
} from "./scheduler.ts";
import { truncateIssues, type ValidationIssue } from "./worker-protocol.ts";

/** 单 case 渲染就绪等待（远小于 jobTimeoutMs）。 */
const RENDER_TIMEOUT_MS = 10_000;

export interface ValidationReportV1 {
  version: 1;
  profileVersion: string;
  fatalVisualProfileVersion: string;
  candidateDigest: string;
  plannedCases: number;
  completedCases: number;
  cases: unknown[];
  issues: ValidationIssue[];
  truncated: boolean;
}

export type ValidationRunOutcome =
  | {
      status: "awaiting_preview";
      reportDigest: string;
      publishBlocked: boolean;
    }
  | { status: "recovery_pending"; reportDigest: string }
  | { status: "failed"; code: string }
  | { status: "capacity_exceeded" }
  | { status: "stale" };

export class ValidationServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ValidationServiceDeps {
  releaseRepository: MysqlReleaseRepository;
  scheduler: ValidationScheduler;
  sessionIssuer: ValidationSessionIssuer;
  /** 服务端可达的基址（如 http://127.0.0.1:3100；缺省时降级为各自独立配置）。 */
  baseUrl?: string;
  /** __validation 页面基址（如 http://127.0.0.1:3100）。 */
  pageBaseUrl?: string;
  /** capability/bootstrap API 基址（如 http://127.0.0.1:3101）。 */
  apiBaseUrl?: string;
  /** Playwright Chromium 可执行路径（缺省用 Playwright 默认解析）。 */
  chromiumExecutablePath?: string;
  envelope?: ValidationResourceEnvelopeV1;
  profileVersion?: string;
}

export class ValidationService {
  private readonly deps: ValidationServiceDeps;
  private readonly envelope: ValidationResourceEnvelopeV1;
  private readonly profileVersion: string;

  constructor(deps: ValidationServiceDeps) {
    this.deps = deps;
    this.envelope = deps.envelope ?? VALIDATION_RESOURCE_ENVELOPE_V1;
    this.profileVersion = deps.profileVersion ?? VALIDATION_PROFILE_VERSION;
  }

  /**
   * 对 validation_running 的 run 执行完整 P0 验证矩阵。
   * 结果经条件更新落库；CAS 失败（状态已被他处推进）丢弃报告返回 stale。
   */
  async runValidation(runId: string): Promise<ValidationRunOutcome> {
    const run = await this.deps.releaseRepository.findRunById(runId);
    if (!run || run.status !== "validation_running") {
      throw new ValidationServiceError(
        "validation_run_not_ready",
        "run 不在 validation_running",
      );
    }
    if (!run.candidateDigest || run.candidateBundle == null) {
      throw new ValidationServiceError(
        "validation_candidate_missing",
        "run 缺少 Candidate/digest",
      );
    }
    const bundle = run.candidateBundle as {
      spec?: {
        routes?: Record<
          string,
          { staticParams?: Array<Record<string, string>> }
        >;
      };
      assets?: { entries?: Array<{ assetId: string }> };
    };

    // 启动浏览器前计算完整 case 清单；超限拒绝（设计 §11.5）
    let cases;
    try {
      cases = expandValidationCases(bundle.spec ?? {});
    } catch (error) {
      if (error instanceof ValidationCaseLimitError) {
        await this.deps.releaseRepository.markFailedFrom({
          runId,
          from: "validation_running",
          diagnostics: {
            code: VALIDATION_FAILED,
            reason: error.code,
            caseCount: error.caseCount,
            maxCases: error.maxCases,
          },
          now: new Date(),
        });
        return { status: "failed", code: error.code };
      }
      throw error;
    }

    const jobId = randomUUID();
    const capability = this.deps.sessionIssuer.issue({
      jobId,
      generationId: runId,
      candidateDigest: run.candidateDigest,
      profileVersion: this.profileVersion,
      mode: VALIDATION_SESSION_MODE,
      assetAllowlist: (bundle.assets?.entries ?? []).map(
        (entry) => entry.assetId,
      ),
      expiresAtMs:
        Date.now() + this.envelope.validationSessionTtlSeconds * 1000,
      maxRequests: this.envelope.validationSessionMaxRequests,
    });

    const pageBase =
      this.deps.pageBaseUrl ?? this.deps.baseUrl ?? "http://127.0.0.1:3100";
    const apiBase =
      this.deps.apiBaseUrl ?? this.deps.baseUrl ?? "http://127.0.0.1:3101";

    let outcome: ValidationJobOutcome;
    try {
      outcome = await this.deps.scheduler.enqueue({
        jobId,
        capability,
        instructions: {
          jobId,
          bootstrapUrl: `${apiBase}/api/validation/bootstrap`,
          pageUrl: `${pageBase}/__validation/`,
          executablePath: this.deps.chromiumExecutablePath,
          candidateDigest: run.candidateDigest,
          profileVersion: this.profileVersion,
          fatalVisualProfileVersion: FATAL_VISUAL_PROFILE_VERSION,
          cases,
          thresholds: { ...FATAL_VISUAL_THRESHOLDS_V1 },
          renderTimeoutMs: RENDER_TIMEOUT_MS,
        },
      });
    } catch (error) {
      if (error instanceof ValidationCapacityError) {
        // 可重试：不改 run 状态（调用方可稍后重试）
        return { status: "capacity_exceeded" };
      }
      throw error;
    } finally {
      this.deps.sessionIssuer.revoke(capability);
    }

    if (outcome.status !== "completed" || !outcome.report) {
      await this.deps.releaseRepository.markFailedFrom({
        runId,
        from: "validation_running",
        diagnostics: {
          code: VALIDATION_FAILED,
          reason: outcome.code ?? VALIDATION_FAILED,
          failureKind: outcome.failureKind ?? "crash",
          ...(outcome.workerCode ? { workerCode: outcome.workerCode } : {}),
          ...(outcome.workerDetail
            ? { workerDetail: outcome.workerDetail }
            : {}),
        },
        now: new Date(),
      });
      return { status: "failed", code: outcome.code ?? VALIDATION_FAILED };
    }

    const report = outcome.report;
    const allIssues = report.cases.flatMap((caseResult) => caseResult.issues);
    const truncated = truncateIssues(allIssues);
    const fatalIssues = truncated.issues.filter(
      (issue) => issue.severity === "fatal",
    );
    const publishBlocked = truncated.issues.some(
      (issue) => issue.severity === "error",
    );
    const validationReport: ValidationReportV1 = {
      version: 1,
      profileVersion: this.profileVersion,
      fatalVisualProfileVersion: FATAL_VISUAL_PROFILE_VERSION,
      candidateDigest: run.candidateDigest,
      plannedCases: report.plannedCases,
      completedCases: report.cases.length,
      cases: report.cases,
      issues: truncated.issues,
      truncated: truncated.truncated,
    };
    const digest = computeReportDigest(validationReport);
    const now = new Date();

    if (fatalIssues.length > 0) {
      const transitioned =
        await this.deps.releaseRepository.markRecoveryPending({
          runId,
          fatalVisualIssues: fatalIssues,
          validationReport,
          reportDigest: digest,
          validationProfileVersion: this.profileVersion,
          now,
        });
      if (!transitioned) return { status: "stale" };
      return { status: "recovery_pending", reportDigest: digest };
    }
    const transitioned =
      await this.deps.releaseRepository.markAwaitingPreviewFromValidation({
        runId,
        validationReport,
        reportDigest: digest,
        validationProfileVersion: this.profileVersion,
        validationIssues: truncated.issues,
        publishBlocked,
        now,
      });
    if (!transitioned) return { status: "stale" };
    return { status: "awaiting_preview", reportDigest: digest, publishBlocked };
  }
}

// ---------- capability 端点（无 Cookie/Session；能力即授权） ----------

export interface ValidationRouteDeps {
  sessionIssuer: ValidationSessionIssuer;
  releaseRepository: MysqlReleaseRepository;
  /** 按 contentHash 读字节（S7 BlobStore 面；未配置时资产端点 404）。 */
  readAssetBytes?: (
    contentHash: string,
  ) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header);
  return match?.[1] ?? null;
}

export function createValidationRoutes(deps: ValidationRouteDeps): Hono {
  const routes = new Hono();

  const authorize = (
    authorization: string | undefined,
  ): ValidationSessionGrant => {
    const token = extractBearer(authorization);
    if (!token) {
      throw new ValidationSessionRejection("validation_session_invalid");
    }
    return deps.sessionIssuer.verify(token);
  };

  routes.get("/validation/bootstrap", async (c) => {
    let grant: ValidationSessionGrant;
    try {
      grant = authorize(c.req.header("authorization"));
    } catch (error) {
      return sessionRejectionResponse(c, error);
    }
    const run = await deps.releaseRepository.findRunById(grant.generationId);
    if (
      !run ||
      run.status !== "validation_running" ||
      run.candidateDigest !== grant.candidateDigest ||
      run.candidateBundle == null
    ) {
      return c.json({ error: { code: "validation_session_invalid" } }, 403);
    }
    let origin: string;
    try {
      origin = new URL(c.req.url).origin;
    } catch {
      return c.json({ error: { code: "validation_session_invalid" } }, 403);
    }
    return c.json(
      {
        bundle: run.candidateBundle,
        businessSchema: run.candidateBusinessSchema ?? null,
        candidateDigest: run.candidateDigest,
        assetBaseUrl: `${origin}/api/validation/assets`,
        assetAllowlist: [...grant.assetAllowlist],
      },
      200,
      {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    );
  });

  routes.get("/validation/assets/:assetId", async (c) => {
    let grant: ValidationSessionGrant;
    try {
      grant = authorize(c.req.header("authorization"));
      deps.sessionIssuer.assertAssetAllowed(grant, c.req.param("assetId"));
    } catch (error) {
      return sessionRejectionResponse(c, error);
    }
    if (!deps.readAssetBytes) {
      return c.json({ error: { code: "asset_not_found" } }, 404);
    }
    // assetId → contentHash 绑定以 run 的不可变 candidateBundle Manifest 为准
    const run = await deps.releaseRepository.findRunById(grant.generationId);
    const bundle = run?.candidateBundle as {
      assets?: { entries?: Array<{ assetId: string; contentHash: string }> };
    } | null;
    const entry = bundle?.assets?.entries?.find(
      (candidate) => candidate.assetId === c.req.param("assetId"),
    );
    if (!entry) {
      return c.json({ error: { code: "asset_not_found" } }, 404);
    }
    const loaded = await deps.readAssetBytes(entry.contentHash);
    if (!loaded) {
      return c.json({ error: { code: "asset_not_found" } }, 404);
    }
    return new Response(loaded.bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": loaded.mimeType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });

  return routes;
}

function sessionRejectionResponse(
  c: { json: (body: unknown, status: number) => Response },
  error: unknown,
): Response {
  if (error instanceof ValidationSessionRejection) {
    // 统一 403 + 稳定 code（过期/预算耗尽/无效/越权均不泄露细节）
    return c.json({ error: { code: error.code } }, 403);
  }
  throw error;
}
