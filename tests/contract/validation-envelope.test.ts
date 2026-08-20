/**
 * S9 契约测试 1：ValidationResourceEnvelopeV1 批准值锁定（计划 S9 验证）。
 * 代码常量必须与 DS-GATE-00 校准批准的
 * tests/fixtures/validation/validation-envelope.json 逐项一致——任一数值
 * 漂移即失败（修改需提升 envelopeVersion 并重新批准）。
 *
 * 夹具结构：version: 1 + envelopeV1.<字段>.{proposedBudget, limitOutcome,
 * limitPlusOneOutcome, stableErrorCode}（按字段记录 limit/limit+1 实测）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VALIDATION_ENVELOPE_VERSION,
  VALIDATION_RESOURCE_ENVELOPE_V1,
} from "../../server/validation/resource-envelope.ts";

interface EnvelopeFieldRecord {
  proposedBudget: number;
  stableErrorCode: string;
}

interface EnvelopeFixture {
  version: number;
  envelopeV1: Record<string, EnvelopeFieldRecord>;
}

describe("S9 ValidationResourceEnvelopeV1：夹具↔代码相等", () => {
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/validation/validation-envelope.json", "utf8"),
  ) as EnvelopeFixture;

  it("夹具为 v1（与代码 envelopeVersion 对应）", () => {
    expect(fixture.version).toBe(1);
    expect(VALIDATION_ENVELOPE_VERSION).toBe("validation-envelope-v1");
  });

  it("全部预算字段 proposedBudget 逐项相等", () => {
    const code = VALIDATION_RESOURCE_ENVELOPE_V1;
    const fields = fixture.envelopeV1;
    expect(fields.jobTimeoutMs?.proposedBudget).toBe(code.jobTimeoutMs);
    expect(fields.workerTerminationGraceMs?.proposedBudget).toBe(
      code.workerTerminationGraceMs,
    );
    expect(fields.workerMaxRssBytes?.proposedBudget).toBe(
      code.workerMaxRssBytes,
    );
    expect(fields.workerStdoutStderrBytes?.proposedBudget).toBe(
      code.workerStdoutStderrBytes,
    );
    expect(fields.workerTemporaryArtifactBytes?.proposedBudget).toBe(
      code.workerTemporaryArtifactBytes,
    );
    expect(fields.ipcReportBytes?.proposedBudget).toBe(code.ipcReportBytes);
    expect(fields.validationSessionTtlSeconds?.proposedBudget).toBe(
      code.validationSessionTtlSeconds,
    );
    expect(fields.validationSessionMaxRequests?.proposedBudget).toBe(
      code.validationSessionMaxRequests,
    );
  });

  it("夹具稳定错误码与计划合同一致", () => {
    const fields = fixture.envelopeV1;
    expect(fields.jobTimeoutMs?.stableErrorCode).toBe("validation_timeout");
    expect(fields.workerMaxRssBytes?.stableErrorCode).toBe(
      "validation_memory_limit_exceeded",
    );
    expect(fields.workerStdoutStderrBytes?.stableErrorCode).toBe(
      "validation_output_limit_exceeded",
    );
    expect(fields.validationSessionTtlSeconds?.stableErrorCode).toBe(
      "validation_session_expired",
    );
    expect(fields.validationSessionMaxRequests?.stableErrorCode).toBe(
      "validation_session_request_limit_exceeded",
    );
  });

  it("常量冻结：Object.freeze 防运行期篡改", () => {
    expect(Object.isFrozen(VALIDATION_RESOURCE_ENVELOPE_V1)).toBe(true);
  });
});
