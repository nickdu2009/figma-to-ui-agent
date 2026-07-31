import { describe, expect, it } from "vitest";

import {
  aggregateFlowM9Samples,
  parseFlowM9RestrictedLiveExtractionReport,
  redactionCheckFlowM9Report,
  statusForFlowM9Aggregate,
  type FlowM9SampleReport,
} from "../../../src/flow-plan/m9-report.ts";

function sample(
  id: string,
  counts: Partial<FlowM9SampleReport["counts"]> = {},
): FlowM9SampleReport {
  return {
    sampleId: id,
    category: "mobile-app",
    expectedViewport: "mobile",
    accessStatus: "readable",
    interactionSource: "present",
    counts: {
      prototypeInteractionCount: 1,
      flowPlanInteractionCount: 1,
      trustedNavigate: 0,
      trustedStateChange: 0,
      submitLikeNeedsConfirmation: 0,
      unsupported: 0,
      missingEvidence: 0,
      ...counts,
    },
    classifications: [
      {
        classification:
          counts.trustedStateChange === 1
            ? "trusted.set_state"
            : counts.submitLikeNeedsConfirmation === 1
              ? "needs_confirmation.submit_like"
              : "missing_evidence",
        evidence: "test evidence",
      },
    ],
    blockedReasons: [],
    artifactRefs: {},
  };
}

describe("Flow-M9 extraction report schema", () => {
  it("按 samples 重新计算 aggregate 并判定 passed", () => {
    const samples = [
      sample("community-mobile-001", { trustedStateChange: 1 }),
      sample("community-login-001", { submitLikeNeedsConfirmation: 1 }),
      sample("community-dashboard-001", { missingEvidence: 1 }),
    ];
    const aggregate = aggregateFlowM9Samples(samples);

    const report = parseFlowM9RestrictedLiveExtractionReport({
      schemaVersion: "1",
      milestone: "Flow-M9",
      scope: "restricted_live_interaction_extraction",
      status: statusForFlowM9Aggregate(aggregate),
      input: {
        runId: "unit",
        sampleManifestRef: "tests/fixtures/figma/community-sample-manifest.json",
        sampleIds: samples.map((item) => item.sampleId),
        networkBoundary: {
          figmaRestCalled: false,
          openaiCalled: false,
          mode: "local",
        },
      },
      samples,
      aggregate,
      reasons: [],
      residualRisks: ["Flow-M10 仍需确认 submit-like 语义。"],
    });

    expect(report.status).toBe("passed");
    expect(report.aggregate).toMatchObject({
      readableSamples: 3,
      trustedStateChange: 1,
      submitLikeNeedsConfirmation: 1,
    });
  });

  it("拒绝与 samples 不一致的 aggregate", () => {
    const samples = [sample("community-mobile-001")];

    expect(() =>
      parseFlowM9RestrictedLiveExtractionReport({
        schemaVersion: "1",
        milestone: "Flow-M9",
        scope: "restricted_live_interaction_extraction",
        status: "partial",
        input: {
          runId: "unit",
          sampleManifestRef: "manifest.json",
          sampleIds: ["community-mobile-001"],
          networkBoundary: {
            figmaRestCalled: false,
            openaiCalled: false,
            mode: "local",
          },
        },
        samples,
        aggregate: {
          totalSamples: 1,
          readableSamples: 99,
          trustedNavigate: 0,
          trustedStateChange: 0,
          submitLikeNeedsConfirmation: 0,
          unsupported: 0,
          missingEvidence: 0,
          notAccessible: 0,
        },
        reasons: [],
        residualRisks: ["risk"],
      }),
    ).toThrow(/aggregate/);
  });

  it("报告脱敏检查拒绝真实 Figma URL、fileKey 字段和 token", () => {
    expect(() =>
      redactionCheckFlowM9Report({
        sampleId: "community-mobile-001",
        designUrl: "https://www.figma.com/design/ABCDEFGH/Test",
      }),
    ).toThrow(/report_redaction_failed/);
    expect(() =>
      redactionCheckFlowM9Report({ token: "figd_abcdef" }),
    ).toThrow(/report_redaction_failed/);
    expect(() =>
      redactionCheckFlowM9Report({ fileKey: "ABCDEFGH" }),
    ).toThrow(/report_redaction_failed/);
  });
});
