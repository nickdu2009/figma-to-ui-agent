/**
 * Validation worker 父/子进程协议（设计 §11.5，计划 S9 动作 4–6）。
 *
 * - 父进程以 instructions JSON 文件启动独立 worker 子进程；
 * - worker 以 stdout 单行有界 JSON 回报（ipcReportBytes 上限内）；
 * - 任何崩溃/超时/超限只产生失败 outcome，父进程不得把不完整输出
 *   组装成 ValidationReport；
 * - 报告绑定 candidateDigest/profileVersion，case 清单必须与计划一致；
 * - Issue 截断：最多 20 条、单条 message ≤200 字符、聚合 ≤8 KiB
 *   （fatal 优先保留）。
 */
import { z } from "zod";

export const VALIDATION_ISSUE_LIMIT = 20;
export const VALIDATION_ISSUE_MESSAGE_MAX = 200;
export const VALIDATION_ISSUES_MAX_BYTES = 8 * 1024;

export const validationIssueSchema = z
  .object({
    code: z.string().min(1).max(64),
    severity: z.enum(["fatal", "error", "warning"]),
    gate: z.enum(["B0", "G0", "G1-fatal", "G1", "G2"]),
    path: z.string().max(256),
    message: z.string().max(VALIDATION_ISSUE_MESSAGE_MAX),
    route: z.string().max(256).optional(),
    componentId: z.string().max(128).optional(),
    ruleIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** 单 case 的 fatal 视觉指标（worker 采集；阈值判定在 worker 内完成）。 */
export const caseMetricsSchema = z
  .object({
    horizontalOverflowPx: z.number(),
    mainWidthRatio: z.number().nullable(),
    verticalCollapseCount: z.number().int().nonnegative(),
    maxOverlapRatio: z.number(),
    maxClippedPx: z.number(),
    navMainGapPx: z.number().nullable(),
    maxBlankBandPx: z.number(),
  })
  .strict();

export type CaseMetrics = z.infer<typeof caseMetricsSchema>;

export const caseResultSchema = z
  .object({
    route: z.string().min(1).max(256),
    params: z.record(z.string(), z.string()).optional(),
    viewport: z.object({
      label: z.enum(["desktop", "mobile"]),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    metrics: caseMetricsSchema,
    issues: z.array(validationIssueSchema),
  })
  .strict();

export type ValidationCaseResult = z.infer<typeof caseResultSchema>;

/** worker → 父进程的有界报告（完整执行才有；部分输出不得组装成报告）。 */
export const workerReportSchema = z
  .object({
    status: z.enum(["completed", "failed"]),
    /** status=failed 时的稳定 code（completed 时缺省）。 */
    code: z.string().max(64).optional(),
    /** status=failed 时的有界诊断详情（≤200 字符；不含堆栈/凭据）。 */
    detail: z.string().max(200).optional(),
    candidateDigest: z.string().min(1),
    profileVersion: z.string().min(1),
    fatalVisualProfileVersion: z.string().min(1),
    plannedCases: z.number().int().nonnegative(),
    cases: z.array(caseResultSchema),
  })
  .strict();

export type WorkerReport = z.infer<typeof workerReportSchema>;

/** 父进程 → worker 的执行指令（JSON 文件，路径为 argv[2]）。 */
export interface WorkerInstructions {
  jobId: string;
  /** 只读 bootstrap 端点（capability 经 Authorization header 携带）。 */
  bootstrapUrl: string;
  /** __validation 页面 URL（同源 Vite/静态入口）。 */
  pageUrl: string;
  /** ValidationSession capability 原值（仅此指令文件携带；不入 URL/日志）。 */
  capability: string;
  executablePath?: string;
  candidateDigest: string;
  profileVersion: string;
  fatalVisualProfileVersion: string;
  cases: Array<{
    route: string;
    params?: Record<string, string>;
    viewport: { label: "desktop" | "mobile"; width: number; height: number };
  }>;
  thresholds: {
    contentWidthMinRatio: number;
    verticalCollapseMinCount: number;
    overlapMinRatio: number;
    overflowMaxPx: number;
    clippedMinPx: number;
    navGapMaxPx: number;
    blankBandMaxPx: number;
  };
  /** 渲染就绪标记等待超时（单 case；远小于 jobTimeoutMs）。 */
  renderTimeoutMs: number;
}

/**
 * Issue 截断（fatal 优先，其次 error/warning；同优先级按 route+code 字典序
 * 稳定排序）：最多 20 条、message ≤200 字符、聚合 ≤8 KiB。
 * 返回截断后的列表与 truncated 标记。
 */
export function truncateIssues(issues: readonly ValidationIssue[]): {
  issues: ValidationIssue[];
  truncated: boolean;
} {
  const severityRank = (severity: ValidationIssue["severity"]): number => {
    if (severity === "fatal") return 0;
    if (severity === "error") return 1;
    return 2;
  };
  const sorted = [...issues].sort((a, b) => {
    const rankDiff = severityRank(a.severity) - severityRank(b.severity);
    if (rankDiff !== 0) return rankDiff;
    const routeDiff = compareStrings(a.route ?? "", b.route ?? "");
    if (routeDiff !== 0) return routeDiff;
    return compareStrings(a.code, b.code);
  });
  let truncated = sorted.length > VALIDATION_ISSUE_LIMIT;
  const capped = sorted.slice(0, VALIDATION_ISSUE_LIMIT).map((issue) => {
    if (issue.message.length <= VALIDATION_ISSUE_MESSAGE_MAX) return issue;
    truncated = true;
    return {
      ...issue,
      message: issue.message.slice(0, VALIDATION_ISSUE_MESSAGE_MAX),
    };
  });
  // 聚合字节预算：从尾部移除直到落入 8 KiB（保持 fatal 优先顺序）
  let total = Buffer.byteLength(JSON.stringify(capped), "utf8");
  while (total > VALIDATION_ISSUES_MAX_BYTES && capped.length > 0) {
    capped.pop();
    truncated = true;
    total = Buffer.byteLength(JSON.stringify(capped), "utf8");
  }
  return { issues: capped, truncated };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
