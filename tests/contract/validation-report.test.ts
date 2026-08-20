/**
 * S9 契约测试 2：ValidationProfile / 报告 / 协议 / 会话（计划 S9 验证）。
 * - fatal 阈值与 fatal-visual-cases.v1.json 批准夹具逐项一致；
 * - case 展开：全部静态路由 + 动态路由首条 staticParams × 两视口，
 *   >512 在启动浏览器前 validation_case_limit_exceeded；
 * - worker 协议 schema（strict）与 issue 截断（20 条/200 字符/8 KiB，
 *   fatal 优先）；
 * - ValidationSession capability：单 job 绑定、TTL、请求预算、资产
 *   allowlist、吊销；原值不落存储（HMAC）。
 * - 报告 digest 确定性（canonical helper）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FATAL_VISUAL_PROFILE_VERSION,
  FATAL_VISUAL_THRESHOLDS_V1,
  VALIDATION_MAX_CASES,
  ValidationCaseLimitError,
  expandValidationCases,
} from "../../server/validation/profile.ts";
import {
  truncateIssues,
  validationIssueSchema,
  workerReportSchema,
  type ValidationIssue,
} from "../../server/validation/worker-protocol.ts";
import {
  ValidationSessionIssuer,
  ValidationSessionRejection,
} from "../../server/validation/session.ts";
import { reportDigest } from "../../server/bundle/digests.ts";

interface FatalThresholdRecord {
  rule: string;
  issueCode: string;
}

interface FatalFixture {
  profileVersion: string;
  thresholds: Record<string, FatalThresholdRecord>;
}

describe("S9 fatal 阈值：批准夹具锁定", () => {
  const fixture = JSON.parse(
    readFileSync(
      "tests/fixtures/validation/fatal-visual-cases.v1.json",
      "utf8",
    ),
  ) as FatalFixture;

  it("profileVersion 与夹具一致", () => {
    expect(FATAL_VISUAL_PROFILE_VERSION).toBe(fixture.profileVersion);
  });

  it("七项阈值数值与 issueCode 逐项锁定（夹具 rule 字符串内嵌批准值）", () => {
    const t = FATAL_VISUAL_THRESHOLDS_V1;
    const f = fixture.thresholds;
    // 每项：夹具 rule 字符串必须内嵌代码常量的精确数值表达式
    expect(f.contentWidthMinRatio?.rule).toContain(
      `mainWidthRatio < ${t.contentWidthMinRatio.toFixed(2)}`,
    );
    expect(f.contentWidthMinRatio?.issueCode).toBe("content_width_too_narrow");
    expect(f.verticalCollapseMinCount?.rule).toContain(
      `verticalCollapseCount >= ${t.verticalCollapseMinCount}`,
    );
    expect(f.verticalCollapseMinCount?.issueCode).toBe("vertical_text_collapse");
    expect(f.overlapMinRatio?.rule).toContain(
      `maxOverlapRatio > ${t.overlapMinRatio.toFixed(2)}`,
    );
    expect(f.overlapMinRatio?.issueCode).toBe("critical_overlap");
    expect(f.overflowMaxPx?.rule).toContain(
      `horizontalOverflowPx > ${t.overflowMaxPx}`,
    );
    expect(f.overflowMaxPx?.issueCode).toBe("viewport_overflow");
    expect(f.clippedMinPx?.rule).toContain(`maxClippedPx > ${t.clippedMinPx}`);
    expect(f.clippedMinPx?.issueCode).toBe("content_clipped");
    expect(f.navGapMaxPx?.rule).toContain(`navMainGapPx > ${t.navGapMaxPx}`);
    expect(f.navGapMaxPx?.issueCode).toBe("navigation_content_detached");
    expect(f.blankBandMaxPx?.rule).toContain(
      `maxBlankBandPx > ${t.blankBandMaxPx}`,
    );
    expect(f.blankBandMaxPx?.issueCode).toBe("excessive_blank_region");
  });
});

describe("S9 ValidationProfile：case 展开", () => {
  it("静态路由 × 两视口；字典序确定性", () => {
    const cases = expandValidationCases({
      routes: {
        "/b": {},
        "/a": {},
      },
    });
    expect(cases.map((entry) => [entry.route, entry.viewport.label])).toEqual([
      ["/a", "desktop"],
      ["/a", "mobile"],
      ["/b", "desktop"],
      ["/b", "mobile"],
    ]);
    expect(cases.every((entry) => entry.params === undefined)).toBe(true);
  });

  it("动态路由取首条 staticParams；无 staticParams 不产生 case", () => {
    const cases = expandValidationCases({
      routes: {
        "/": {},
        "/users/[id]": {
          staticParams: [{ id: "u-1" }, { id: "u-2" }],
        },
        "/orphan/[id]": {},
      },
    });
    expect(cases).toHaveLength(4); // / ×2 + /users/[id](u-1) ×2 + orphan 0
    const dynamic = cases.filter((entry) => entry.route === "/users/[id]");
    expect(dynamic).toHaveLength(2);
    expect(dynamic[0]!.params).toEqual({ id: "u-1" });
  });

  it(">512 case 在启动浏览器前抛 validation_case_limit_exceeded", () => {
    const routes: Record<string, never> = {};
    for (let index = 0; index < 300; index++) {
      routes[`/r${index}`] = {} as never;
    }
    try {
      expandValidationCases({ routes });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationCaseLimitError);
      expect((error as ValidationCaseLimitError).code).toBe(
        "validation_case_limit_exceeded",
      );
      expect((error as ValidationCaseLimitError).caseCount).toBe(600);
      expect((error as ValidationCaseLimitError).maxCases).toBe(
        VALIDATION_MAX_CASES,
      );
    }
  });

  it("恰好 512 通过", () => {
    const routes: Record<string, never> = {};
    for (let index = 0; index < 256; index++) {
      routes[`/r${index}`] = {} as never;
    }
    expect(expandValidationCases({ routes })).toHaveLength(512);
  });
});

describe("S9 worker 协议与 issue 截断", () => {
  const issue = (overrides: Partial<ValidationIssue>): ValidationIssue => ({
    code: "viewport_overflow",
    severity: "fatal",
    gate: "G1-fatal",
    path: "/",
    message: "溢出",
    route: "/",
    ...overrides,
  });

  it("issue schema strict：未知键拒绝", () => {
    const withUnknown = { ...issue({}), unknown: true };
    expect(validationIssueSchema.safeParse(withUnknown).success).toBe(false);
  });

  it("report schema strict：绑定字段必填", () => {
    const base = {
      status: "completed",
      candidateDigest: "cd",
      profileVersion: "pv",
      fatalVisualProfileVersion: "fv",
      plannedCases: 0,
      cases: [],
    };
    expect(workerReportSchema.safeParse(base).success).toBe(true);
    expect(
      workerReportSchema.safeParse({ ...base, extra: 1 }).success,
    ).toBe(false);
    expect(
      workerReportSchema.safeParse({ ...base, candidateDigest: "" }).success,
    ).toBe(false);
  });

  it("截断：fatal 优先保留、20 条上限、truncated 标记", () => {
    const issues: ValidationIssue[] = [
      ...Array.from({ length: 15 }, (_, index) =>
        issue({ severity: "warning", code: `w${index}`, route: "/z" }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        issue({ severity: "fatal", code: `f${index}`, route: "/a" }),
      ),
    ];
    const result = truncateIssues(issues);
    expect(result.issues).toHaveLength(20);
    expect(result.truncated).toBe(true);
    // 前 10 条全部为 fatal（fatal 优先）
    expect(
      result.issues.slice(0, 10).every((entry) => entry.severity === "fatal"),
    ).toBe(true);
  });

  it("截断：message >200 字符截断", () => {
    const result = truncateIssues([issue({ message: "x".repeat(500) })]);
    expect(result.issues[0]!.message).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  it("截断：聚合 >8 KiB 从尾部移除（fatal 优先保留）", () => {
    // CJK 消息：200 字符 × 3 字节，20 条即可超过 8 KiB 预算
    const issues: ValidationIssue[] = [
      issue({ severity: "fatal", code: "fatal-keep" }),
      ...Array.from({ length: 19 }, (_, index) =>
        issue({
          severity: "warning",
          code: `w${index}`,
          message: "界".repeat(200),
        }),
      ),
    ];
    const result = truncateIssues(issues);
    const bytes = Buffer.byteLength(JSON.stringify(result.issues), "utf8");
    expect(bytes).toBeLessThanOrEqual(8 * 1024);
    expect(result.truncated).toBe(true);
    expect(result.issues.some((entry) => entry.code === "fatal-keep")).toBe(true);
  });
});

describe("S9 ValidationSession capability", () => {
  const grant = {
    jobId: "job-1",
    generationId: "run-1",
    candidateDigest: "cd",
    profileVersion: "pv",
    mode: "p0-validation",
    assetAllowlist: ["asset-1"],
    expiresAtMs: Date.now() + 60_000,
    maxRequests: 3,
  };

  it("签发→核验消耗请求预算；预算耗尽稳定拒绝", () => {
    const issuer = new ValidationSessionIssuer();
    const token = issuer.issue(grant);
    expect(token.startsWith("vma_val_")).toBe(true);
    expect(issuer.verify(token).generationId).toBe("run-1");
    expect(issuer.verify(token).candidateDigest).toBe("cd");
    issuer.verify(token);
    expect(() => issuer.verify(token)).toThrowError(ValidationSessionRejection);
    try {
      issuer.verify(token);
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationSessionRejection).code).toBe(
        "validation_session_request_limit_exceeded",
      );
    }
  });

  it("过期 → validation_session_expired；未知令牌 → invalid", () => {
    const issuer = new ValidationSessionIssuer();
    const expired = issuer.issue({ ...grant, expiresAtMs: Date.now() - 1 });
    try {
      issuer.verify(expired);
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationSessionRejection).code).toBe(
        "validation_session_expired",
      );
    }
    expect(() => issuer.verify("vma_val_nonexistent")).toThrowError(
      ValidationSessionRejection,
    );
  });

  it("资产 allowlist：越权 assetId 稳定拒绝", () => {
    const issuer = new ValidationSessionIssuer();
    const token = issuer.issue(grant);
    const verified = issuer.verify(token);
    expect(() => issuer.assertAssetAllowed(verified, "asset-1")).not.toThrow();
    try {
      issuer.assertAssetAllowed(verified, "asset-evil");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationSessionRejection).code).toBe(
        "validation_session_asset_forbidden",
      );
    }
  });

  it("吊销后一律拒绝（job 结束语义）", () => {
    const issuer = new ValidationSessionIssuer();
    const token = issuer.issue(grant);
    issuer.revoke(token);
    expect(() => issuer.verify(token)).toThrowError(ValidationSessionRejection);
  });
});

describe("S9 报告 digest 确定性", () => {
  it("canonical helper：同内容同 digest；键序无关", () => {
    const reportA = {
      version: 1,
      profileVersion: "pv",
      candidateDigest: "cd",
      issues: [{ code: "a", message: "m" }],
    };
    const reportB = {
      issues: [{ message: "m", code: "a" }],
      candidateDigest: "cd",
      profileVersion: "pv",
      version: 1,
    };
    expect(reportDigest(reportA)).toBe(reportDigest(reportB));
    expect(reportDigest(reportA)).not.toBe(
      reportDigest({ ...reportA, candidateDigest: "other" }),
    );
  });
});
