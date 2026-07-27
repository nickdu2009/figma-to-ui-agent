import type { DesignBundle } from "../design-bundle/schema.ts";
import type { UISpecDraft } from "../ui-spec/schema.ts";
import type { UnsupportedFeature } from "../tools/contracts.ts";
import type {
  M5StaticReport,
  M5StaticPageSummary,
  M5StaticRegion,
} from "./report.ts";
import {
  mapPageNodes,
  type MapPageNodesInput,
} from "./node-mapper.ts";
import {
  mapStaticPages,
  type StaticPagePlan,
} from "./page-mapper.ts";
import {
  planVisualLayers,
  toReportVisualLayers,
  type VisualLayerPlan,
} from "./visual-layer-planner.ts";
import {
  buildCoverageReport,
  classifyPageCoverage,
  type PageCoverageResult,
} from "./coverage.ts";

export interface BuildStaticUISpecOptions {
  readonly sourceFlowPlanRevision?: number;
  readonly m4ValidationStatus?: M5StaticReport["m4ValidationStatus"];
}

export interface BuildStaticUISpecResult {
  readonly uiSpecDraft: UISpecDraft;
  readonly reportDraft: Omit<M5StaticReport, "runId" | "projectId">;
}

function pageArea(page: StaticPagePlan): number {
  return page.bounds.width * page.bounds.height;
}

function countNodesByKind(
  nodes: UISpecDraft["nodes"],
): M5StaticPageSummary["nodeCounts"] {
  const counts = {
    text: 0,
    input: 0,
    select: 0,
    button: 0,
    image: 0,
    pixelOverlay: 0,
    total: nodes.length,
  };
  for (const node of nodes) {
    if (node.kind === "text") counts.text += 1;
    if (node.kind === "input") counts.input += 1;
    if (node.kind === "select") counts.select += 1;
    if (node.kind === "button") counts.button += 1;
    if (node.kind === "image") counts.image += 1;
    if (node.kind === "pixel_overlay") counts.pixelOverlay += 1;
  }
  return counts;
}

function diagnoseRegions(
  nodes: UISpecDraft["nodes"],
): M5StaticRegion[] {
  const hasLeftVisual = nodes.some(
    (node) =>
      (node.kind === "image" || node.kind === "pixel_overlay") &&
      node.style?.left !== undefined &&
      node.style.left < 100,
  );
  const hasFormFields = nodes.some(
    (node) => node.kind === "input" || node.kind === "select",
  );
  const hasCta = nodes.some(
    (node) =>
      node.kind === "button" &&
      (node.label.toLowerCase().includes("sign in") ||
        node.label.toLowerCase().includes("get started")),
  );
  const hasSocialButtons = nodes.some(
    (node) =>
      node.kind === "button" &&
      (node.label.toLowerCase().includes("google") ||
        node.label.toLowerCase().includes("github")),
  );
  const hasFooter = nodes.some(
    (node) =>
      node.kind === "text" &&
      node.text.toLowerCase().includes("©"),
  );

  return [
    {
      id: "left_visual",
      status: hasLeftVisual ? "passed" : "not_applicable",
      notes: hasLeftVisual ? ["检测到左侧视觉层"] : ["无左侧视觉层"],
    },
    {
      id: "form_fields",
      status: hasFormFields ? "passed" : "not_applicable",
      notes: hasFormFields ? ["检测到表单输入域"] : ["无表单输入域"],
    },
    {
      id: "cta",
      status: hasCta ? "passed" : "not_applicable",
      notes: hasCta ? ["检测到主要 CTA"] : ["无明确 CTA"],
    },
    {
      id: "social_buttons",
      status: hasSocialButtons ? "passed" : "not_applicable",
      notes: hasSocialButtons ? ["检测到社交登录按钮"] : ["无社交按钮"],
    },
    {
      id: "footer",
      status: hasFooter ? "passed" : "not_applicable",
      notes: hasFooter ? ["检测到页脚文案"] : ["无页脚文案"],
    },
    {
      id: "page",
      status: nodes.length > 0 ? "passed" : "failed",
      notes: nodes.length > 0 ? ["页面包含可渲染节点"] : ["页面没有节点"],
    },
  ];
}

function componentFidelityForNodes(
  nodes: UISpecDraft["nodes"],
): NonNullable<M5StaticPageSummary["componentFidelity"]> {
  const byFamily: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let sourceComponentNodeCount = 0;

  for (const node of nodes) {
    const sourceComponent = node.sourceComponent;
    if (!sourceComponent) continue;
    sourceComponentNodeCount += 1;
    const family = sourceComponent.family ?? "unknown";
    const state = sourceComponent.state ?? "default";
    byFamily[family] = (byFamily[family] ?? 0) + 1;
    byState[state] = (byState[state] ?? 0) + 1;
  }

  return {
    sourceComponentNodeCount,
    byFamily,
    byState,
  };
}

export function buildStaticUISpecFromDesignBundle(
  bundle: DesignBundle,
  options: BuildStaticUISpecOptions = {},
): BuildStaticUISpecResult {
  const pageMapping = mapStaticPages(bundle);
  const allWarnings: Array<{ code: string; detail: string }> = [
    ...pageMapping.warnings,
  ];
  const allUnsupportedFeatures: UnsupportedFeature[] = [];
  const allVisualLayers: VisualLayerPlan[] = [];
  const allStateEntries: UISpecDraft["state"] = [];

  const uiSpecPages: UISpecDraft["pages"] = [];
  const uiSpecNodes: UISpecDraft["nodes"] = [];
  const allDesignValueRefs = new Set<string>();
  const pageSummaries: M5StaticPageSummary[] = [];
  const pageCoverageResults: PageCoverageResult[] = [];

  for (const pagePlan of pageMapping.pages) {
    const pageOrigin = { x: pagePlan.bounds.x, y: pagePlan.bounds.y };
    const visualResult = planVisualLayers({
      bundle,
      pagePlanId: pagePlan.pageId,
      sourcePageId: pagePlan.sourcePageId,
      pageOrigin,
      pageArea: pageArea(pagePlan),
    });

    allUnsupportedFeatures.push(...visualResult.unsupportedFeatures);
    allWarnings.push(...visualResult.warnings);
    allVisualLayers.push(...visualResult.layers);

    const nodeInput: MapPageNodesInput = {
      bundle,
      pagePlanId: pagePlan.pageId,
      sourcePageId: pagePlan.sourcePageId,
      pagePath: pagePlan.path,
      visualLayers: visualResult.layers,
    };
    const mapped = mapPageNodes(nodeInput);
    const coverageResult = classifyPageCoverage({
      bundle,
      pagePlan,
      visualLayers: visualResult.layers,
      sourceToUiNodeId: mapped.sourceToUiNodeId,
      candidates: visualResult.candidates,
    });
    pageCoverageResults.push(coverageResult);

    uiSpecPages.push({
      id: pagePlan.pageId,
      sourcePageId: pagePlan.sourcePageId,
      path: pagePlan.path,
      title: pagePlan.title,
      rootNodeId: mapped.rootNodeId,
    });
    uiSpecNodes.push(...mapped.nodes);
    for (const node of mapped.nodes) {
      for (const ref of node.designValueRefs) {
        allDesignValueRefs.add(ref);
      }
    }
    for (const entry of mapped.stateEntries) {
      if (!allStateEntries.some((existing) => existing.key === entry.key)) {
        allStateEntries.push(entry);
      }
    }
    allWarnings.push(...mapped.warnings);

    const nodeCounts = countNodesByKind(mapped.nodes);
    const interactiveNodeCount = mapped.nodes.filter(
      (node) =>
        node.kind === "input" ||
        node.kind === "select" ||
        node.kind === "button" ||
        node.kind === "checkbox" ||
        node.kind === "radio" ||
        node.kind === "switch",
    ).length;
    pageSummaries.push({
      pageId: pagePlan.pageId,
      sourcePageId: pagePlan.sourcePageId,
      sourceRootNodeId: pagePlan.sourceRootNodeId,
      path: pagePlan.path,
      viewportRole: pagePlan.viewportRole,
      nodeCounts,
      structuredCoverage: {
        textNodeCount: nodeCounts.text,
        interactiveNodeCount,
        fullPageScreenshotFallback: false,
      },
      componentFidelity: componentFidelityForNodes(mapped.nodes),
      visualLayerCoverage: {
        candidateCount: visualResult.layers.length,
        renderedCount: visualResult.layers.filter((layer) => layer.rendered)
          .length,
        unsupportedCount: visualResult.unsupportedFeatures.length,
      },
      regions: diagnoseRegions(mapped.nodes),
    });
  }

  const state: UISpecDraft["state"] = allStateEntries;

  const viewports: UISpecDraft["viewports"] = [
    {
      id: "desktop",
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    },
    {
      id: "mobile",
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
    },
  ];

  const uiSpecDraft: UISpecDraft = {
    schemaVersion: "1",
    catalogVersion: "1",
    projectId: bundle.projectId,
    sourceDesignBundleRevision: bundle.revision,
    sourceFlowPlanRevision: options.sourceFlowPlanRevision,
    designValueRefs: [...allDesignValueRefs],
    pages: uiSpecPages,
    nodes: uiSpecNodes,
    state,
    actions: [],
    viewports,
    behaviorFixtures: [],
  };

  const status: M5StaticReport["status"] =
    pageMapping.pages.length === 0
      ? "failed"
      : allUnsupportedFeatures.length > 0 || allWarnings.length > 0
        ? "partial"
        : "passed";

  const coverage = buildCoverageReport({ pages: pageCoverageResults });

  const reportDraft: Omit<M5StaticReport, "runId" | "projectId"> = {
    schemaVersion: "1",
    designBundleRevision: bundle.revision,
    status,
    scope: "static_generation_only",
    behaviorFlowVerified: false,
    m4ValidationStatus: options.m4ValidationStatus ?? "pending",
    coverageVersion: "1",
    coverage,
    pages: pageSummaries,
    visualLayers: toReportVisualLayers(allVisualLayers),
    unsupportedFeatures: allUnsupportedFeatures,
    warnings: allWarnings,
    residualRisks: [
      "M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。",
      "图标按钮缺少真实业务 action，仅保留静态语义。",
      "复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。",
    ],
  };

  return { uiSpecDraft, reportDraft };
}
