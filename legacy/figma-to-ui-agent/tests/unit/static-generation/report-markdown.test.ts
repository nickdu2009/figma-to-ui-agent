import { describe, expect, it } from "vitest";

import {
  reportToMarkdown,
} from "../../../src/static-generation/report-markdown.ts";
import {
  m5StaticReportSchema,
} from "../../../src/static-generation/report.ts";

function minimalReport(): ReturnType<typeof m5StaticReportSchema.parse> {
  return m5StaticReportSchema.parse({
    schemaVersion: "1",
    runId: "run-1",
    projectId: "demo",
    designBundleRevision: 1,
    status: "passed",
    scope: "static_generation_only",
    behaviorFlowVerified: false,
    m4ValidationStatus: "pending",
    coverageVersion: "1",
    coverage: {
      coverageVersion: "1",
      pages: [
        {
          pageId: "home",
          sourcePageId: "page-home",
          sourceNodeCount: 3,
          visibleNodeCount: 3,
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
          sourcePageId: "page-home",
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
        sourceNodeCount: 3,
        visibleNodeCount: 3,
        unsupportedCount: 0,
        unmappedCount: 0,
      },
      diagnostics: {
        unsupportedByReason: {
          budget_exceeded: 1,
        },
        unsupportedByKind: {
          vector: 1,
        },
        topUnsupported: [
          {
            sourceNodeId: "blob",
            sourcePageId: "page-home",
            sourceNodeName: "Blob",
            nodeKind: "vector",
            reasonCode: "budget_exceeded",
            area: 10_000,
            bounds: { x: 0, y: 0, width: 100, height: 100 },
          },
        ],
      },
    },
    pages: [
      {
        pageId: "home",
        sourcePageId: "page-home",
        sourceRootNodeId: "root",
        path: "/",
        viewportRole: "desktop",
        nodeCounts: {
          text: 1,
          input: 0,
          select: 0,
          button: 0,
          image: 0,
          pixelOverlay: 0,
          total: 1,
        },
        structuredCoverage: {
          textNodeCount: 1,
          interactiveNodeCount: 0,
          fullPageScreenshotFallback: false,
        },
        componentFidelity: {
          sourceComponentNodeCount: 1,
          byFamily: {
            button: 1,
          },
          byState: {
            default: 1,
          },
        },
        visualLayerCoverage: {
          candidateCount: 0,
          renderedCount: 0,
          unsupportedCount: 0,
        },
        regions: [
          {
            id: "page",
            status: "passed",
            notes: ["页面包含可渲染节点"],
          },
        ],
      },
    ],
    visualLayers: [],
    unsupportedFeatures: [],
    warnings: [],
    residualRisks: ["风险 1"],
  });
}

describe("reportToMarkdown", () => {
  it("renders report title and core fields", () => {
    const report = minimalReport();
    const markdown = reportToMarkdown(report, {
      title: "M5 静态生成报告",
    });
    expect(markdown).toContain("# M5 静态生成报告");
    expect(markdown).toContain("- runId: run-1");
    expect(markdown).toContain("- projectId: demo");
    expect(markdown).toContain("- status: passed");
  });

  it("renders component fidelity diagnostics", () => {
    const report = minimalReport();
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain(
      '- componentFidelity: sourceComponentNodes=1, families={"button":1}, states={"default":1}',
    );
  });

  it("renders variablesMode when provided", () => {
    const report = m5StaticReportSchema.parse({
      ...minimalReport(),
      apiBoundary: {
        openai: false,
        figmaMe: false,
        variables: false,
      },
    });
    const markdown = reportToMarkdown(report, {
      title: "M5 Live",
      variablesMode: "disabled_restricted_live",
    });
    expect(markdown).toContain("- variablesMode: disabled_restricted_live");
    expect(markdown).toContain(
      "- apiBoundary: openai=false, figmaMe=false, variables=false",
    );
  });

  it("renders coverage summary and per-page diagnostics", () => {
    const report = minimalReport();
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("## 覆盖率摘要");
    expect(markdown).toContain("- sourceNodeCount: 3");
    expect(markdown).toContain("### home");
    expect(markdown).toContain(
      "- vector: total=1, rendered=0, ignoredSafe=0, unsupported=1, unmapped=0",
    );
    expect(markdown).toContain(
      "- imageFill: total=0, rendered=0, missingAsset=0",
    );
    expect(markdown).toContain(
      "- text: total=1, rendered=1, styleComplete=1",
    );
    expect(markdown).toContain("- budgetExceeded: 1");
    expect(markdown).toContain("- pageSize: 1440x900 / 1440x900 (full_page)");
    expect(markdown).toContain("- widthMatched: true");
    expect(markdown).toContain("- heightMatched: true");
    expect(markdown).toContain("### unsupported 诊断");
    expect(markdown).toContain('- byReason: {"budget_exceeded":1}');
    expect(markdown).toContain(
      "- blob (vector, budget_exceeded, area=10000): Blob",
    );
  });

  it("renders canvas mapping and region diagnostics", () => {
    const base = minimalReport();
    const report = m5StaticReportSchema.parse({
      ...base,
      pages: [
        {
          ...base.pages[0],
          comparison: {
            diffPixelRatio: 0.12,
            diffPixels: 120,
            screenshotPaths: [
              "runs/run-1/screenshots/000-a-expected.png",
              "runs/run-1/screenshots/000-a-actual.png",
            ],
            regionDiffs: [
              {
                id: "visual_assets",
                label: "visual assets",
                bounds: { x: 0, y: 0, width: 100, height: 200 },
                diffPixelCount: 100,
                diffPixelRatio: 0.5,
              },
            ],
            regionDiagnostics: [
              {
                id: "left_visual",
                contractBucket: "visual_assets",
                bounds: { x: 0, y: 0, width: 100, height: 200 },
                diffPixelRatio: 0.5,
                diffPixels: 100,
                suspectedCauses: ["asset_layering"],
              },
            ],
            canvasMapping: {
              sourcePageId: "page-home",
              pageId: "home",
              artboard: { width: 320, height: 480 },
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
    });
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("##### canvasMapping");
    expect(markdown).toContain("- artboard: 320x480");
    expect(markdown).toContain("- viewport: desktop 1440x900 @1x");
    expect(markdown).toContain("##### regionDiffs");
    expect(markdown).toContain("| visual_assets | 50.00% | 100 | 0,0,100x200 |");
    expect(markdown).toContain("##### top failing regions");
    expect(markdown).toContain(
      "| left_visual | visual_assets | 50.00% | 100 | asset_layering |",
    );
  });

  it("renders unsupportedFeatures, warnings and residual risks", () => {
    const report = m5StaticReportSchema.parse({
      ...minimalReport(),
      unsupportedFeatures: [
        {
          code: "visual_asset_budget_exceeded",
          severity: "fallback_ok",
          evidenceSource: "schema_limit",
          impact: ["visual"],
          recommendedAction: "defer",
        },
      ],
      warnings: [
        {
          code: "visual_layer_no_asset",
          detail: "没有可用的局部图片资产",
        },
      ],
      residualRisks: ["残留风险 A"],
    });
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("## unsupportedFeatures");
    expect(markdown).toContain(
      "- **visual_asset_budget_exceeded** (fallback_ok): defer",
    );
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain(
      "- **visual_layer_no_asset**: 没有可用的局部图片资产",
    );
    expect(markdown).toContain("## 残留风险");
    expect(markdown).toContain("- 残留风险 A");
  });

  it("renders visual layers table", () => {
    const report = m5StaticReportSchema.parse({
      ...minimalReport(),
      visualLayers: [
        {
          sourceNodeId: "node-1",
          sourcePageId: "page-home",
          reason: "large_visual",
          layerRole: "decorative_background",
          zOrder: 1,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
          pageRelativeBounds: { x: 0, y: 0, width: 100, height: 100 },
          rendered: true,
          assetRef: "figma/screenshots/abc.png",
        },
      ],
    });
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("## 视觉层追溯");
    expect(markdown).toContain(
      "| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |",
    );
    expect(markdown).toContain(
      "| node-1 | large_visual | decorative_background | true | - |",
    );
  });
});
