/**
 * ValidationResourceEnvelopeV1（设计 §11.5，计划 S9）。
 *
 * 数值不是实现者默认值：与 DS-GATE-00 校准批准的
 * tests/fixtures/validation/validation-envelope.json 逐项一致
 * （contract 测试锁定夹具↔代码相等）。修改任一数值必须提升
 * envelopeVersion、重跑边界探针并重新批准。
 */

export const VALIDATION_ENVELOPE_VERSION = "validation-envelope-v1";

export interface ValidationResourceEnvelopeV1 {
  /** 单 job 总超时（SIGTERM → 宽限 → SIGKILL）。 */
  jobTimeoutMs: number;
  /** SIGTERM 后的退出宽限，耗尽升级 SIGKILL。 */
  workerTerminationGraceMs: number;
  /** worker 子树 RSS 上限（ps 快照求和轮询）。 */
  workerMaxRssBytes: number;
  /** worker stdout+stderr 合计上限（超限 SIGKILL）。 */
  workerStdoutStderrBytes: number;
  /** worker 临时工件上限（专用 tempDir，父进程配额）。 */
  workerTemporaryArtifactBytes: number;
  /** IPC 报告（stdout 最后一行 JSON）上限。 */
  ipcReportBytes: number;
  /** ValidationSession capability TTL。 */
  validationSessionTtlSeconds: number;
  /** ValidationSession capability 请求预算。 */
  validationSessionMaxRequests: number;
}

/** DS-GATE-00 批准值（validation-envelope.json envelopeV1.proposedBudget）。 */
export const VALIDATION_RESOURCE_ENVELOPE_V1: ValidationResourceEnvelopeV1 =
  Object.freeze({
    jobTimeoutMs: 120_000,
    workerTerminationGraceMs: 5_000,
    workerMaxRssBytes: 2_147_483_648,
    workerStdoutStderrBytes: 65_536,
    workerTemporaryArtifactBytes: 268_435_456,
    ipcReportBytes: 1_048_576,
    validationSessionTtlSeconds: 600,
    validationSessionMaxRequests: 512,
  });

/** 包络违规的稳定错误码（设计 §11.5）。 */
export const VALIDATION_ENVELOPE_ERROR_CODES = [
  "validation_timeout",
  "validation_memory_limit_exceeded",
  "validation_output_limit_exceeded",
  "validation_session_expired",
  "validation_session_request_limit_exceeded",
] as const;

export type ValidationEnvelopeErrorCode =
  (typeof VALIDATION_ENVELOPE_ERROR_CODES)[number];

/** Scheduler 容量稳定码：第 5 个 waiting 在启动浏览器前失败。 */
export const VALIDATION_CAPACITY_EXCEEDED = "validation_capacity_exceeded";
/** case 清单超限稳定码（启动浏览器前计算并拒绝）。 */
export const VALIDATION_CASE_LIMIT_EXCEEDED = "validation_case_limit_exceeded";
/** 验证基础设施失败的 run diagnostics code（设计 §13.2.1；不新增 run 状态）。 */
export const VALIDATION_FAILED = "validation_failed";
