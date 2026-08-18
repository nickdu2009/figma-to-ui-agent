import type { M5StaticReport } from "./report.ts";

export interface ReportToMarkdownOptions {
  readonly title?: string;
  readonly variablesMode?: string;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "-" : `${(value * 100).toFixed(2)}%`;
}

export function reportToMarkdown(
  report: M5StaticReport,
  options: ReportToMarkdownOptions = {},
): string {
  const title = options.title ?? "M5 报告";
  const lines = [
    `# ${title}`,
    "",
    `- runId: ${report.runId}`,
    `- projectId: ${report.projectId}`,
    `- designBundleRevision: ${report.designBundleRevision}`,
    `- uiSpecRevision: ${report.uiSpecRevision ?? "未保存"}`,
    `- status: ${report.status}`,
    `- scope: ${report.scope}`,
    `- behaviorFlowVerified: ${report.behaviorFlowVerified}`,
    `- m4ValidationStatus: ${report.m4ValidationStatus ?? "未指定"}`,
  ];

  if (options.variablesMode) {
    lines.push(`- variablesMode: ${options.variablesMode}`);
  }

  if (report.apiBoundary) {
    lines.push(
      `- apiBoundary: openai=${report.apiBoundary.openai}, figmaMe=${report.apiBoundary.figmaMe}, variables=${report.apiBoundary.variables}`,
    );
  }

  lines.push(
    "",
    `## 页面摘要`,
    "",
  );

  for (const page of report.pages) {
    lines.push(
      `### ${page.pageId} (${page.path})`,
      "",
      `- viewportRole: ${page.viewportRole ?? "unknown"}`,
      `- nodes: ${JSON.stringify(page.nodeCounts)}`,
      `- structuredCoverage: text=${page.structuredCoverage.textNodeCount}, interactive=${page.structuredCoverage.interactiveNodeCount}`,
      `- componentFidelity: sourceComponentNodes=${page.componentFidelity?.sourceComponentNodeCount ?? 0}, families=${JSON.stringify(page.componentFidelity?.byFamily ?? {})}, states=${JSON.stringify(page.componentFidelity?.byState ?? {})}`,
      `- visualLayerCoverage: candidate=${page.visualLayerCoverage.candidateCount}, rendered=${page.visualLayerCoverage.renderedCount}, unsupported=${page.visualLayerCoverage.unsupportedCount}`,
      "",
      `#### regions`,
      "",
    );
    for (const region of page.regions) {
      lines.push(
        `- **${region.id}**: ${region.status}`,
      );
      for (const note of region.notes) {
        lines.push(`  - ${note}`);
      }
    }
    lines.push("");
    if (page.comparison) {
      lines.push(
        `#### comparison`,
        "",
        `- diffPixels: ${page.comparison.diffPixels}`,
        `- diffPixelRatio: ${page.comparison.diffPixelRatio}`,
        `- screenshots: ${page.comparison.screenshotPaths.join(", ")}`,
        "",
      );
      if (page.comparison.canvasMapping) {
        const mapping = page.comparison.canvasMapping;
        lines.push(
          `##### canvasMapping`,
          "",
          `- artboard: ${mapping.artboard.width}x${mapping.artboard.height}`,
          `- viewport: ${mapping.viewport.id} ${mapping.viewport.width}x${mapping.viewport.height} @${mapping.viewport.deviceScaleFactor}x`,
          `- scale: ${mapping.scale}`,
          `- origin: ${mapping.origin.x},${mapping.origin.y}`,
          `- renderMode: ${mapping.renderMode}`,
          "",
        );
      }
      if (page.comparison.regionDiffs?.length) {
        lines.push(
          `##### regionDiffs`,
          "",
          "| bucket | diff | pixels | bounds |",
          "|---|---:|---:|---|",
        );
        for (const region of page.comparison.regionDiffs) {
          lines.push(
            `| ${region.id} | ${formatRatio(region.diffPixelRatio)} | ${region.diffPixelCount} | ${region.bounds.x},${region.bounds.y},${region.bounds.width}x${region.bounds.height} |`,
          );
        }
        lines.push("");
      }
      if (page.comparison.regionDiagnostics?.length) {
        lines.push(
          `##### top failing regions`,
          "",
          "| region | bucket | diff | pixels | suspectedCauses |",
          "|---|---|---:|---:|---|",
        );
        for (const diagnosis of page.comparison.regionDiagnostics.slice(0, 8)) {
          lines.push(
            `| ${diagnosis.id} | ${diagnosis.contractBucket ?? "-"} | ${formatRatio(diagnosis.diffPixelRatio)} | ${diagnosis.diffPixels ?? "-"} | ${diagnosis.suspectedCauses.join(", ")} |`,
          );
        }
        lines.push("");
      }
    }
  }

  if (report.visualLayers.length > 0) {
    lines.push(
      "## 视觉层追溯",
      "",
      "| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |",
      "|---|---|---|---|---|",
    );
    for (const layer of report.visualLayers) {
      lines.push(
        `| ${layer.sourceNodeId} | ${layer.reason} | ${layer.layerRole} | ${layer.rendered} | ${layer.uiSpecNodeId ?? "-"} |`,
      );
    }
    lines.push("");
  }

  if (report.coverage) {
    lines.push(
      "## 覆盖率摘要",
      "",
      `- sourceNodeCount: ${report.coverage.aggregate.sourceNodeCount}`,
      `- visibleNodeCount: ${report.coverage.aggregate.visibleNodeCount}`,
      `- unsupportedCount: ${report.coverage.aggregate.unsupportedCount}`,
      `- unmappedCount: ${report.coverage.aggregate.unmappedCount}`,
      "",
    );
    for (const page of report.coverage.pages) {
      const budgetExceeded = report.coverage.records.filter(
        (record) =>
          record.sourcePageId === page.sourcePageId &&
          record.reasonCode === "budget_exceeded",
      ).length;
      lines.push(
        `### ${page.pageId}`,
        "",
        `- sourceNodeCount: ${page.sourceNodeCount}`,
        `- visibleNodeCount: ${page.visibleNodeCount}`,
        `- vector: total=${page.vector.total}, rendered=${page.vector.rendered}, ignoredSafe=${page.vector.ignoredSafe}, unsupported=${page.vector.unsupported}, unmapped=${page.vector.unmapped}`,
        `- imageFill: total=${page.imageFill.total}, rendered=${page.imageFill.rendered}, missingAsset=${page.imageFill.missingAsset}`,
        `- text: total=${page.text.total}, rendered=${page.text.rendered}, styleComplete=${page.text.styleComplete}`,
        `- budgetExceeded: ${budgetExceeded}`,
        `- pageSize: ${page.pageSize.actualWidth}x${page.pageSize.actualHeight} / ${page.pageSize.expectedWidth}x${page.pageSize.expectedHeight} (${page.pageSize.policy})`,
        `- widthMatched: ${page.pageSize.widthMatched}`,
        `- heightMatched: ${page.pageSize.heightMatched}`,
        "",
      );
    }
    if (report.coverage.diagnostics) {
      lines.push(
        "### unsupported 诊断",
        "",
        `- byReason: ${JSON.stringify(report.coverage.diagnostics.unsupportedByReason)}`,
        `- byKind: ${JSON.stringify(report.coverage.diagnostics.unsupportedByKind)}`,
        "",
      );
      for (const item of report.coverage.diagnostics.topUnsupported.slice(0, 10)) {
        lines.push(
          `- ${item.sourceNodeId} (${item.nodeKind}, ${item.reasonCode}, area=${Math.round(item.area)}): ${item.sourceNodeName ?? "-"}`,
        );
      }
      lines.push("");
    }
    lines.push("");
  }

  if (report.unsupportedFeatures.length > 0) {
    lines.push(
      "## unsupportedFeatures",
      "",
    );
    for (const feature of report.unsupportedFeatures) {
      lines.push(
        `- **${feature.code}** (${feature.severity}): ${feature.recommendedAction}`,
      );
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push(
      "## Warnings",
      "",
    );
    for (const warning of report.warnings) {
      lines.push(`- **${warning.code}**: ${warning.detail}`);
    }
    lines.push("");
  }

  lines.push(
    "## 残留风险",
    "",
  );
  for (const risk of report.residualRisks) {
    lines.push(`- ${risk}`);
  }
  lines.push("");

  return lines.join("\n");
}
