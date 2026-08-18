import { describe, expect, it } from "vitest";

import {
  m5StaticCoverageReportSchema,
  m5StaticReportSchema,
} from "../../../src/static-generation/report.ts";

function validReport() {
  return {
    schemaVersion: "1",
    runId: "run-1",
    projectId: "demo",
    designBundleRevision: 1,
    status: "passed",
    scope: "static_generation_only",
    behaviorFlowVerified: false,
    pages: [
      {
        pageId: "login",
        sourcePageId: "page-login",
        path: "/login",
        nodeCounts: {
          text: 2,
          input: 2,
          select: 0,
          button: 1,
          image: 0,
          pixelOverlay: 0,
          total: 5,
        },
        structuredCoverage: {
          textNodeCount: 2,
          interactiveNodeCount: 3,
          fullPageScreenshotFallback: false,
        },
        visualLayerCoverage: {
          candidateCount: 1,
          renderedCount: 1,
          unsupportedCount: 0,
        },
        regions: [
          {
            id: "form_fields",
            status: "passed",
            notes: ["ok"],
          },
        ],
        comparison: {
          diffPixelRatio: 0.12,
          diffPixels: 120,
          screenshotPaths: [
            "runs/run-1/screenshots/000-a-expected.png",
            "runs/run-1/screenshots/000-a-actual.png",
            "runs/run-1/diffs/000-a-diff.png",
          ],
          regionDiffs: [
            {
              id: "text_regions",
              label: "text regions",
              bounds: { x: 0, y: 200, width: 320, height: 80 },
              diffPixelCount: 80,
              diffPixelRatio: 0.25,
            },
          ],
          regionDiagnostics: [
            {
              id: "footer",
              contractBucket: "text_regions",
              bounds: { x: 0, y: 200, width: 320, height: 80 },
              diffPixelRatio: 0.25,
              diffPixels: 80,
              sourceNodeIds: ["source-footer"],
              uiSpecNodeIds: ["footer"],
              suspectedCauses: ["typography"],
            },
          ],
          canvasMapping: {
            sourcePageId: "page-login",
            pageId: "login",
            artboard: {
              width: 320,
              height: 480,
            },
            viewport: {
              id: "desktop",
              width: 1440,
              height: 900,
              deviceScaleFactor: 1,
            },
            scale: 1,
            origin: { x: 0, y: 0 },
            renderMode: "native_artboard",
          },
        },
      },
    ],
    visualLayers: [
      {
        sourceNodeId: "blob",
        sourcePageId: "page-login",
        reason: "large_visual",
        layerRole: "decorative_background",
        zOrder: 0,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        pageRelativeBounds: { x: 0, y: 0, width: 100, height: 100 },
        rendered: true,
      },
    ],
    unsupportedFeatures: [],
    warnings: [],
    residualRisks: ["behavior not verified"],
  };
}

function validCoverageReport() {
  return {
    ...validReport(),
    coverageVersion: "1",
    coverage: {
      coverageVersion: "1",
      pages: [
        {
          pageId: "login",
          sourcePageId: "page-login",
          sourceNodeCount: 2,
          visibleNodeCount: 2,
          byKind: {},
          vector: {
            total: 1,
            rendered: 0,
            ignoredSafe: 0,
            unsupported: 1,
            unmapped: 0,
          },
          imageFill: {
            total: 0,
            rendered: 0,
            missingAsset: 0,
          },
          text: {
            total: 1,
            rendered: 1,
            styleComplete: 1,
          },
          pageSize: {
            expectedWidth: 1440,
            expectedHeight: 900,
            actualWidth: 1440,
            actualHeight: 900,
            widthMatched: true,
            heightMatched: true,
            policy: "full_page",
          },
        },
      ],
      records: [
        {
          sourceNodeId: "blob",
          sourcePageId: "page-login",
          nodeKind: "vector",
          decision: "unsupported",
          reasonCode: "budget_exceeded",
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          pageRelativeBounds: { x: 0, y: 0, width: 100, height: 100 },
          zOrder: 0,
          area: 10_000,
          areaRatio: 0.01,
          confidence: "medium",
          impact: ["visual"],
        },
      ],
      aggregate: {
        sourceNodeCount: 2,
        visibleNodeCount: 2,
        unsupportedCount: 1,
        unmappedCount: 0,
      },
    },
  };
}

describe("m5StaticReportSchema", () => {
  it("accepts a valid report", () => {
    const parsed = m5StaticReportSchema.safeParse(validReport());
    expect(parsed.success).toBe(true);
  });

  it("accepts old M5 reports without coverage on the compatibility schema", () => {
    const parsed = m5StaticReportSchema.safeParse(validReport());
    expect(parsed.success).toBe(true);
  });

  it("requires coverage on the M5.1 schema", () => {
    const missingCoverage = m5StaticCoverageReportSchema.safeParse(
      validReport(),
    );
    expect(missingCoverage.success).toBe(false);

    const withCoverage = m5StaticCoverageReportSchema.safeParse(
      validCoverageReport(),
    );
    expect(withCoverage.success).toBe(true);
  });

  it("accepts restricted live api boundary as an additive report field", () => {
    const parsed = m5StaticCoverageReportSchema.safeParse({
      ...validCoverageReport(),
      apiBoundary: {
        openai: false,
        figmaMe: false,
        variables: false,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-static scope", () => {
    const report = {
      ...validReport(),
      scope: "behavior_flow",
    };
    const parsed = m5StaticReportSchema.safeParse(report);
    expect(parsed.success).toBe(false);
  });

  it("rejects behaviorFlowVerified true", () => {
    const report = {
      ...validReport(),
      behaviorFlowVerified: true,
    };
    const parsed = m5StaticReportSchema.safeParse(report);
    expect(parsed.success).toBe(false);
  });

  it("rejects fullPageScreenshotFallback true", () => {
    const report = {
      ...validReport(),
      pages: [
        {
          ...validReport().pages[0],
          structuredCoverage: {
            textNodeCount: 0,
            interactiveNodeCount: 0,
            fullPageScreenshotFallback: true,
          },
        },
      ],
    };
    const parsed = m5StaticReportSchema.safeParse(report);
    expect(parsed.success).toBe(false);
  });
});
