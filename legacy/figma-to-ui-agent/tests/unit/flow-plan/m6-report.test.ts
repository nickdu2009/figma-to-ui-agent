import { describe, expect, it } from "vitest";

import {
  parseFlowM6RouteExecutionReport,
  summarizeFlowM6Validation,
} from "../../../src/flow-plan/m6-report.ts";

describe("Flow-M6 route execution report", () => {
  it("接受独立 route_execution_only 报告", () => {
    const report = parseFlowM6RouteExecutionReport({
      schemaVersion: "1",
      milestone: "Flow-M6",
      scope: "route_execution_only",
      status: "passed",
      projectId: "demo-project",
      runId: "flow-m6",
      figmaInteractionSource: "present",
      sourceDesignBundleRevision: 1,
      sourceUISpecRevision: 1,
      sourceFlowPlanRevision: 1,
      savedUISpecRevision: 2,
      routeCount: 2,
      navigateActionCount: 1,
      behaviorFixtureCount: 1,
      convertedNavigateActionIds: ["flow-continue"],
      behaviorFixtureIds: ["flow-continue-fixture"],
      unresolvedInteractions: [],
      validation: {
        schemaVersion: "1",
        runId: "flow-m6",
        previewUrl: "http://127.0.0.1:4173/preview",
        passed: true,
        resultCount: 1,
        failedCheckCount: 0,
      },
      residualRisks: ["Flow-M7 状态、表单和业务逻辑仍未覆盖。"],
    });

    expect(report.milestone).toBe("Flow-M6");
    expect(report.scope).toBe("route_execution_only");
  });

  it("拒绝没有 converted navigate action 的 passed 报告", () => {
    expect(() =>
      parseFlowM6RouteExecutionReport({
        schemaVersion: "1",
        milestone: "Flow-M6",
        scope: "route_execution_only",
        status: "passed",
        projectId: "demo-project",
        runId: "flow-m6",
        sourceDesignBundleRevision: 1,
        routeCount: 1,
        navigateActionCount: 0,
        behaviorFixtureCount: 0,
        convertedNavigateActionIds: [],
        behaviorFixtureIds: [],
        unresolvedInteractions: [],
        residualRisks: ["Flow-M7 状态、表单和业务逻辑仍未覆盖。"],
      }),
    ).toThrow("至少包含一个已转换 navigate action");
  });

  it("从 RenderAndCompare 输出生成脱敏验证摘要", () => {
    expect(
      summarizeFlowM6Validation({
        schemaVersion: "1",
        runId: "flow-m6",
        previewUrl: "http://127.0.0.1:4173/preview",
        passed: false,
        results: [
          {
            checks: [
              { passed: true },
              { passed: false },
            ],
          },
        ],
      }),
    ).toMatchObject({
      passed: false,
      resultCount: 1,
      failedCheckCount: 1,
    });
  });
});
