import { describe, expect, it } from "vitest";

import {
  uiSpecDraftSchema,
} from "../../../src/ui-spec/schema.ts";
import {
  m5StaticReportSchema,
} from "../../../src/static-generation/report.ts";
import {
  buildStaticUISpecFromDesignBundle,
} from "../../../src/static-generation/service.ts";
import { createM5StaticDesignBundle } from "../../fixtures/static-generation/m5-static-fixture.ts";

describe("buildStaticUISpecFromDesignBundle", () => {
  it("generates a valid multi-page UISpec draft and report", () => {
    const bundle = createM5StaticDesignBundle();
    const result = buildStaticUISpecFromDesignBundle(bundle);

    expect(result.uiSpecDraft.pages).toHaveLength(3);
    expect(result.reportDraft.pages).toHaveLength(3);

    const parsedSpec = uiSpecDraftSchema.safeParse(result.uiSpecDraft);
    expect(parsedSpec.success).toBe(true);

    const report = {
      ...result.reportDraft,
      runId: "run-1",
      projectId: bundle.projectId,
    };
    const parsedReport = m5StaticReportSchema.safeParse(report);
    expect(parsedReport.success).toBe(true);
  });

  it("marks behaviorFlowVerified as false", () => {
    const bundle = createM5StaticDesignBundle();
    const result = buildStaticUISpecFromDesignBundle(bundle);
    expect(result.reportDraft.behaviorFlowVerified).toBe(false);
  });

  it("rejects full-page screenshot fallback", () => {
    const bundle = createM5StaticDesignBundle();
    const result = buildStaticUISpecFromDesignBundle(bundle);
    for (const page of result.reportDraft.pages) {
      expect(page.structuredCoverage.fullPageScreenshotFallback).toBe(false);
    }
  });

  it("includes visual layer provenance in report only", () => {
    const bundle = createM5StaticDesignBundle();
    const result = buildStaticUISpecFromDesignBundle(bundle);

    expect(result.reportDraft.visualLayers.length).toBeGreaterThan(0);

    const hasProvenanceInNodes = result.uiSpecDraft.nodes.some(
      (node) =>
        "sourceNodeId" in node ||
        "reason" in node ||
        "layerRole" in node,
    );
    expect(hasProvenanceInNodes).toBe(false);
  });

  it("detects login form regions", () => {
    const bundle = createM5StaticDesignBundle();
    const result = buildStaticUISpecFromDesignBundle(bundle);

    const loginPage = result.reportDraft.pages.find(
      (page) => page.pageId === "login",
    )!;
    expect(loginPage.regions.find((r) => r.id === "form_fields")?.status).toBe(
      "passed",
    );
    expect(loginPage.regions.find((r) => r.id === "cta")?.status).toBe(
      "passed",
    );
    expect(loginPage.regions.find((r) => r.id === "social_buttons")?.status).toBe(
      "passed",
    );
  });

  it("summarizes source component fidelity for each page", () => {
    const bundle = createM5StaticDesignBundle();
    const result = buildStaticUISpecFromDesignBundle(bundle);

    for (const page of result.reportDraft.pages) {
      expect(page.componentFidelity).toBeDefined();
      expect(page.componentFidelity?.sourceComponentNodeCount).toBeGreaterThanOrEqual(
        0,
      );
      expect(page.componentFidelity?.byFamily).toBeDefined();
      expect(page.componentFidelity?.byState).toBeDefined();
    }
  });
});
