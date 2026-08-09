import { describe, expect, it } from "vitest";

import {
  buildProductM9EvidenceReport,
  classifyProductM9EvidenceSample,
  redactionCheckProductM9EvidenceReport,
} from "../../../src/runtime/product-m9-evidence-classifier.ts";

function sample(overrides: Record<string, unknown>) {
  return {
    sampleId: "community-mobile-001",
    category: "mobile-app",
    status: "passed",
    ok: true,
    metrics: {
      trustedNavigate: 0,
      trustedStateChange: 0,
      confirmedSubmit: 0,
      submitLikeNeedsConfirmation: 0,
      unsupported: 0,
      missingEvidence: 0,
      successfulFixtureIds: [],
      failedFixtureIds: [],
    },
    ...overrides,
  };
}

describe("Product-M9 evidence classifier", () => {
  it("classifies CHANGE_TO / variant evidence only when a fixture succeeded", () => {
    const report = classifyProductM9EvidenceSample(
      sample({
        metrics: {
          trustedStateChange: 2,
          successfulFixtureIds: ["fixture-1"],
          failedFixtureIds: [],
        },
      }),
    );

    expect(report.classifications.map((item) => item.classification)).toEqual([
      "positive.change_to_variant",
    ]);
    expect(report.recommendedUse).toContain("Flow-M14");
  });

  it("classifies confirmed submit evidence as Product-M9 submit/dialog positive", () => {
    const report = classifyProductM9EvidenceSample(
      sample({
        sampleId: "community-checkout-001",
        category: "ecommerce",
        metrics: {
          confirmedSubmit: 1,
          successfulFixtureIds: ["submit-fixture"],
          failedFixtureIds: [],
        },
      }),
    );

    expect(report.classifications.map((item) => item.classification)).toEqual([
      "positive.confirmed_submit",
    ]);
    expect(report.recommendedUse).toContain("submit/dialog");
  });

  it("keeps submit-like samples pending until confirmation is applied", () => {
    const report = classifyProductM9EvidenceSample(
      sample({
        sampleId: "community-login-001",
        status: "partial",
        ok: false,
        metrics: {
          submitLikeNeedsConfirmation: 3,
          successfulFixtureIds: [],
          failedFixtureIds: [],
        },
      }),
    );

    expect(report.classifications.map((item) => item.classification)).toEqual([
      "pending.submit_like_confirmation",
    ]);
  });

  it("builds a partial report when CHANGE_TO is proven but confirmed submit is missing", () => {
    const report = buildProductM9EvidenceReport({
      runId: "evidence-run",
      samples: [
        sample({
          metrics: {
            trustedStateChange: 12,
            successfulFixtureIds: ["fixture-1"],
            failedFixtureIds: [],
          },
        }),
        sample({
          sampleId: "community-login-001",
          status: "partial",
          ok: false,
          metrics: {
            submitLikeNeedsConfirmation: 3,
            successfulFixtureIds: [],
            failedFixtureIds: [],
          },
        }),
      ],
    });

    expect(report.status).toBe("partial");
    expect(report.totals.changeToVariantPositive).toBe(1);
    expect(report.totals.confirmedSubmitPositive).toBe(0);
    expect(report.totals.submitLikeNeedsConfirmation).toBe(1);
    expect(report.decision).toContain("仍需补 submit/dialog");
  });

  it("does not pass a batch that still has missing evidence", () => {
    const report = buildProductM9EvidenceReport({
      runId: "evidence-run-with-missing",
      samples: [
        sample({
          metrics: {
            trustedStateChange: 1,
            successfulFixtureIds: ["change-fixture"],
            failedFixtureIds: [],
          },
        }),
        sample({
          sampleId: "community-submit-001",
          metrics: {
            confirmedSubmit: 1,
            successfulFixtureIds: ["submit-fixture"],
            failedFixtureIds: [],
          },
        }),
        sample({
          sampleId: "community-missing-001",
          status: "partial",
          ok: false,
          metrics: {
            missingEvidence: 1,
            successfulFixtureIds: [],
            failedFixtureIds: [],
          },
        }),
      ],
    });

    expect(report.status).toBe("partial");
    expect(report.totals.changeToVariantPositive).toBe(1);
    expect(report.totals.confirmedSubmitPositive).toBe(1);
    expect(report.totals.missingEvidence).toBe(1);
  });

  it("rejects secrets and raw Figma URLs in evidence reports", () => {
    expect(() =>
      redactionCheckProductM9EvidenceReport({
        token: "figd_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(/product_m9_evidence_redaction_failed:figma_token/);
    expect(() =>
      redactionCheckProductM9EvidenceReport({
        source: "https://www.figma.com/design/ABCDEFGH/File",
      }),
    ).toThrow(/product_m9_evidence_redaction_failed:figma_design_url/);
  });
});
