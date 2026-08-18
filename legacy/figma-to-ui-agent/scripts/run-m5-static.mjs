#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  m5StaticCoverageReportSchema,
} from "../src/static-generation/report.ts";
import {
  reportToMarkdown,
} from "../src/static-generation/report-markdown.ts";
import {
  buildStaticUISpecFromDesignBundle,
} from "../src/static-generation/service.ts";
import { ProjectStore } from "../src/project-store/store.ts";
import {
  RenderAndCompareService,
} from "../src/validation/render-and-compare.ts";

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    projectId: undefined,
    dataRoot: "data",
    designBundleRevision: undefined,
    runId: undefined,
    reportRoot: "reports/m5-static",
    saveUiSpec: false,
    runCompare: false,
    viewportIds: ["desktop"],
    m4ValidationStatus: "pending",
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const next = args[index + 1];
    switch (flag) {
      case "--projectId":
        options.projectId = next;
        index += 1;
        break;
      case "--dataRoot":
        options.dataRoot = next;
        index += 1;
        break;
      case "--designBundleRevision":
        options.designBundleRevision = Number.parseInt(next, 10);
        index += 1;
        break;
      case "--runId":
        options.runId = next;
        index += 1;
        break;
      case "--reportRoot":
        options.reportRoot = next;
        index += 1;
        break;
      case "--save-ui-spec":
        options.saveUiSpec = true;
        break;
      case "--run-compare":
        options.runCompare = true;
        break;
      case "--viewportIds":
        options.viewportIds = next.split(",");
        index += 1;
        break;
      case "--m4ValidationStatus":
        options.m4ValidationStatus = next;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function createRunId() {
  return `${Date.now().toString(36)}-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function validateRunId(runId) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) {
    throw new Error(
      `Invalid runId: ${runId}. Must be 1-128 alphanumeric, hyphen or underscore characters.`,
    );
  }
}

function causesForBucket(bucket) {
  switch (bucket) {
    case "visual_assets":
      return ["asset_layering"];
    case "text_regions":
      return ["typography"];
    case "form_controls":
      return ["typography", "renderer_reset"];
    case "button_icon_controls":
      return ["asset_layering", "renderer_reset"];
    default:
      return ["unknown"];
  }
}

function nodesForIds(uiSpec, nodeIds) {
  const nodesById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  return nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter(Boolean);
}

function regionIdsForBucket(bucket, context, ids) {
  const nodes = nodesForIds(context.uiSpec, ids.uiSpecNodeIds);
  switch (bucket) {
    case "visual_assets": {
      const mapping = context.result.canvasMapping;
      const bounds = context.region.bounds;
      const likelyLeftVisual =
        bounds.x <= 100 &&
        (!mapping || bounds.width <= mapping.artboard.width * 0.7);
      return [likelyLeftVisual ? "left_visual" : "dense_content"];
    }
    case "text_regions": {
      const hasFooterText = nodes.some(
        (node) =>
          node.kind === "text" &&
          /(?:©|copyright|all rights reserved)/i.test(node.text),
      );
      return [hasFooterText ? "footer" : "dense_content"];
    }
    case "form_controls":
      return ["form_fields"];
    case "button_icon_controls": {
      const labels = nodes
        .map((node) =>
          "label" in node && typeof node.label === "string"
            ? node.label
            : "",
        )
        .join(" ");
      if (/(?:google|github|facebook|apple|twitter|social)/i.test(labels)) {
        return ["social_buttons"];
      }
      return ["cta"];
    }
    default:
      return ["dense_content"];
  }
}

function pageNodeIds(uiSpec, pageId, predicate) {
  const page = uiSpec.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    return [];
  }
  const nodesById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const visited = new Set();
  const visit = (nodeId) => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node || !Array.isArray(node.childIds)) {
      return;
    }
    for (const childId of node.childIds) {
      visit(childId);
    }
  };
  visit(page.rootNodeId);
  return [...visited].filter((nodeId) => {
    const node = nodesById.get(nodeId);
    return node ? predicate(node) : false;
  });
}

function idsForBucket(bucket, context) {
  const isFormControl = (node) =>
    [
      "input",
      "checkbox",
      "radio",
      "switch",
      "select",
      "textarea",
      "form_field",
    ].includes(node.kind);
  const isButtonIconControl = (node) =>
    ["button", "link", "icon"].includes(node.kind);
  const unique = (items) => [...new Set(items.filter(Boolean))].slice(0, 1_000);
  const uiSpecNodeIds = pageNodeIds(context.uiSpec, context.page.pageId, (node) => {
    switch (bucket) {
      case "visual_assets":
        return node.kind === "pixel_overlay" || node.kind === "image";
      case "text_regions":
        return node.kind === "text";
      case "form_controls":
        return isFormControl(node);
      case "button_icon_controls":
        return isButtonIconControl(node);
      default:
        return false;
    }
  });
  const visualLayers =
    bucket === "visual_assets"
      ? context.report.visualLayers.filter(
          (layer) => layer.sourcePageId === context.page.sourcePageId,
        )
      : [];
  return {
    sourceNodeIds: unique(visualLayers.map((layer) => layer.sourceNodeId)),
    uiSpecNodeIds: unique([
      ...uiSpecNodeIds,
      ...visualLayers
        .map((layer) => layer.uiSpecNodeId)
        .filter(Boolean),
    ]),
  };
}

function diagnoseComparisonRegions(result, context) {
  const diagnostics = [];
  for (const region of result.regionDiffs ?? []) {
    if (region.diffPixelCount === 0) {
      continue;
    }
    const ids = idsForBucket(region.id, context);
    for (const id of regionIdsForBucket(region.id, { ...context, region, result }, ids)) {
      diagnostics.push({
        id,
        contractBucket: region.id,
        bounds: region.bounds,
        diffPixelRatio: region.diffPixelRatio,
        diffPixels: region.diffPixelCount,
        sourceNodeIds: ids.sourceNodeIds,
        uiSpecNodeIds: ids.uiSpecNodeIds,
        suspectedCauses: causesForBucket(region.id),
      });
    }
  }
  const mapping = result.canvasMapping;
  if (
    mapping &&
    mapping.artboard.width < 600 &&
    mapping.viewport.width >= 1_000
  ) {
    diagnostics.push({
      id: "mobile_canvas",
      bounds: {
        x: 0,
        y: 0,
        width: mapping.artboard.width,
        height: mapping.artboard.height,
      },
      diffPixelRatio: result.diffPixelRatio,
      diffPixels: result.diffPixelCount,
      sourceNodeIds: [],
      uiSpecNodeIds: [],
      suspectedCauses: ["canvas_mapping"],
    });
  }
  if (
    mapping &&
    mapping.renderMode === "scroll_canvas" &&
    mapping.artboard.width >= 600
  ) {
    diagnostics.push({
      id: context.page.pageId.includes("modal")
        ? "modal_shell"
        : "dense_content",
      bounds: {
        x: 0,
        y: 0,
        width: mapping.artboard.width,
        height: mapping.artboard.height,
      },
      diffPixelRatio: result.diffPixelRatio,
      diffPixels: result.diffPixelCount,
      sourceNodeIds: [],
      uiSpecNodeIds: [],
      suspectedCauses: ["renderer_reset"],
    });
  }
  return diagnostics
    .sort(
      (left, right) =>
        (right.diffPixelRatio ?? 0) - (left.diffPixelRatio ?? 0),
    )
    .slice(0, 8);
}

async function main() {
  const options = parseArgs(process.argv);

  if (!options.projectId) {
    console.error("Usage: node scripts/run-m5-static.mjs --projectId <id> [--dataRoot <path>] [--designBundleRevision <n>] [--runId <id>] [--reportRoot <path>] [--save-ui-spec] [--run-compare] [--viewportIds desktop,mobile]");
    process.exit(1);
  }

  const m4StatusSchema = z.enum(["pending", "promoted", "not_required"]);
  const m4ValidationStatus = m4StatusSchema.parse(
    options.m4ValidationStatus,
  );

  const dataRoot = resolve(options.dataRoot);
  const reportRoot = resolve(options.reportRoot);
  const projectStore = new ProjectStore(dataRoot);

  const designBundle = await projectStore.loadDesignBundle(
    options.projectId,
    options.designBundleRevision,
  );

  const { uiSpecDraft, reportDraft } =
    buildStaticUISpecFromDesignBundle(designBundle, {
      m4ValidationStatus,
    });

  let uiSpecRevision = undefined;
  if (options.saveUiSpec) {
    const currentUiSpec = await projectStore
      .loadUISpec(options.projectId)
      .catch((error) => {
        if (error?.code === "not_found") {
          return undefined;
        }
        throw error;
      });
    const saved = await projectStore.saveUISpec({
      projectId: options.projectId,
      baseRevision: currentUiSpec?.revision ?? 0,
      draft: uiSpecDraft,
    });
    uiSpecRevision = saved.revision;
  }

  const runId = options.runId ?? createRunId();
  validateRunId(runId);
  const runDir = join(reportRoot, runId);
  await mkdir(runDir, { recursive: true });

  const report = m5StaticCoverageReportSchema.parse({
    ...reportDraft,
    runId,
    projectId: options.projectId,
    uiSpecRevision,
  });

  if (options.runCompare && uiSpecRevision !== undefined) {
    const renderService = new RenderAndCompareService({
      dataRoot,
      projectStore,
    });
    try {
      const renderOutput = await renderService.render({
        schemaVersion: "1",
        projectId: options.projectId,
        pageIds: report.pages.map((page) => page.pageId),
        viewportIds: options.viewportIds,
        comparison: {
          maxDiffPixelRatio: 0.05,
          maxDiffPixels: 10_000,
          timeoutMs: 30_000,
        },
      });

      const resultByPage = new Map();
      for (const result of renderOutput.results) {
        const existing = resultByPage.get(result.pageId);
        if (!existing || result.diffPixelRatio > existing.diffPixelRatio) {
          resultByPage.set(result.pageId, result);
        }
      }

      for (const page of report.pages) {
        const result = resultByPage.get(page.pageId);
        if (result) {
          page.comparison = {
            diffPixelRatio: result.diffPixelRatio,
            diffPixels: result.diffPixelCount,
            screenshotPaths: [
              result.expectedImage,
              result.actualImage,
              ...(result.diffImage ? [result.diffImage] : []),
            ],
            regionDiffs: result.regionDiffs ?? [],
            regionDiagnostics: diagnoseComparisonRegions(result, {
              page,
              report,
              uiSpec: uiSpecDraft,
            }),
            canvasMapping: result.canvasMapping,
          };
        }
      }
    } finally {
      await renderService.close();
    }
  }

  const summaryPath = join(runDir, "summary.json");
  const markdownPath = join(runDir, "summary.md");
  const finalReport = m5StaticCoverageReportSchema.parse(report);
  await writeFile(
    summaryPath,
    `${JSON.stringify(finalReport, null, 2)}\n`,
  );
  await writeFile(
    markdownPath,
    reportToMarkdown(finalReport, { title: "M5 静态生成报告" }),
  );

  console.log(`M5 static report written to ${summaryPath}`);
  console.log(`M5 static markdown written to ${markdownPath}`);
  console.log(`status: ${finalReport.status}`);
  console.log(`pages: ${finalReport.pages.length}`);
  console.log(`visualLayers: ${finalReport.visualLayers.length}`);
  console.log(`unsupportedFeatures: ${finalReport.unsupportedFeatures.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
