import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  type M7RunResult,
  m7RunResultSchema,
} from "./e2e-flow-contracts.ts";

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") ? path : relativePath;
}

export function m7ReportMarkdown(result: M7RunResult): string {
  const lines = [
    "# M7 端到端产品化主流程报告",
    "",
    `- runId: ${result.runId}`,
    `- status: ${result.ok ? "passed" : "failed"}`,
    result.projectId ? `- projectId: ${result.projectId}` : undefined,
    result.input.mode ? `- mode: ${result.input.mode}` : undefined,
    result.input.designBundleRevision
      ? `- designBundleRevision: ${result.input.designBundleRevision}`
      : undefined,
    result.input.designBundleRevisionSource
      ? `- designBundleRevisionSource: ${result.input.designBundleRevisionSource}`
      : undefined,
    result.artifacts.designBundleRef
      ? `- designBundleRef: ${result.artifacts.designBundleRef}`
      : undefined,
    result.artifacts.uiSpecRef
      ? `- uiSpecRef: ${result.artifacts.uiSpecRef}`
      : undefined,
    result.artifacts.validationRef
      ? `- validationRef: ${result.artifacts.validationRef}`
      : undefined,
    "",
    "## Metrics",
    "",
    result.metrics
      ? `- pages: ${result.metrics.pages}`
      : "- pages: unavailable",
    result.metrics?.passedPages !== undefined
      ? `- passedPages: ${result.metrics.passedPages}`
      : undefined,
    result.metrics?.maxPixelDiffPercent !== undefined
      ? `- maxPixelDiffPercent: ${result.metrics.maxPixelDiffPercent.toFixed(4)}`
      : undefined,
    result.metrics?.averagePixelDiffPercent !== undefined
      ? `- averagePixelDiffPercent: ${result.metrics.averagePixelDiffPercent.toFixed(4)}`
      : undefined,
    result.metrics
      ? `- warnings: ${result.metrics.warnings}`
      : undefined,
    result.metrics
      ? `- unsupported: ${result.metrics.unsupported}`
      : undefined,
    "",
    "## Validation",
    "",
    result.validation
      ? `- status: ${result.validation.status}`
      : "- status: unavailable",
    result.validation?.reason
      ? `- reason: ${result.validation.reason}`
      : undefined,
    "",
    "## Steps",
    "",
    ...result.steps.map(
      (step) => `- ${step.id}: ${step.status} - ${step.message}`,
    ),
    "",
    "## Error",
    "",
    result.error
      ? `- category: ${result.error.category}`
      : "- None",
    result.error ? `- message: ${result.error.message}` : undefined,
    result.error ? `- recoverable: ${result.error.recoverable}` : undefined,
    result.error ? `- nextAction: ${result.error.nextAction}` : undefined,
    "",
    "## Next Action",
    "",
    result.nextAction ? `- ${result.nextAction}` : "- None",
  ];
  return `${lines.filter((line) => line !== undefined).join("\n")}\n`;
}

export async function writeM7Report(input: {
  result: M7RunResult;
  reportRoot: string;
  runId: string;
}): Promise<M7RunResult> {
  const runDir = resolve(input.reportRoot, input.runId);
  const summaryJson = join(runDir, "summary.json");
  const summaryMarkdown = join(runDir, "summary.md");
  const result = m7RunResultSchema.parse({
    ...input.result,
    artifacts: {
      ...input.result.artifacts,
      summaryJson: displayPath(summaryJson),
      summaryMarkdown: displayPath(summaryMarkdown),
    },
  });

  await mkdir(dirname(summaryJson), { recursive: true });
  await writeFile(summaryJson, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(summaryMarkdown, m7ReportMarkdown(result));
  return result;
}
