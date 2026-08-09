import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  type ProductM9RunResult,
  productM9RunResultSchema,
} from "./product-m9-flow-contracts.ts";

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") ? path : relativePath;
}

export function productM9ReportMarkdown(result: ProductM9RunResult): string {
  const lines = [
    "# Product-M9 Real FlowPlan Agent Entry 报告",
    "",
    `- runId: ${result.runId}`,
    `- status: ${result.status}`,
    `- ok: ${result.ok}`,
    `- mode: ${result.mode}`,
    `- projectId: ${result.projectId}`,
    result.artifactRefs.designBundlePath
      ? `- designBundlePath: ${result.artifactRefs.designBundlePath}`
      : undefined,
    result.artifactRefs.uiSpecPath
      ? `- uiSpecPath: ${result.artifactRefs.uiSpecPath}`
      : undefined,
    result.artifactRefs.flowPlanPath
      ? `- flowPlanPath: ${result.artifactRefs.flowPlanPath}`
      : undefined,
    result.artifactRefs.confirmationQuestionsPath
      ? `- confirmationQuestionsPath: ${result.artifactRefs.confirmationQuestionsPath}`
      : undefined,
    result.artifactRefs.confirmationAnswerTemplatePath
      ? `- confirmationAnswerTemplatePath: ${result.artifactRefs.confirmationAnswerTemplatePath}`
      : undefined,
    result.artifactRefs.confirmedFlowPlanPath
      ? `- confirmedFlowPlanPath: ${result.artifactRefs.confirmedFlowPlanPath}`
      : undefined,
    result.artifactRefs.validationPath
      ? `- validationPath: ${result.artifactRefs.validationPath}`
      : undefined,
    "",
    "## Metrics",
    "",
    `- trustedNavigate: ${result.metrics.trustedNavigate ?? 0}`,
    `- trustedStateChange: ${result.metrics.trustedStateChange ?? 0}`,
    `- submitLikeNeedsConfirmation: ${result.metrics.submitLikeNeedsConfirmation ?? 0}`,
    `- unsupported: ${result.metrics.unsupported ?? 0}`,
    `- missingEvidence: ${result.metrics.missingEvidence ?? 0}`,
    `- successfulFixtureIds: ${(result.metrics.successfulFixtureIds ?? []).join(", ") || "none"}`,
    `- failedFixtureIds: ${(result.metrics.failedFixtureIds ?? []).join(", ") || "none"}`,
    "",
    "## Stages",
    "",
    ...Object.entries(result.stages).map(
      ([name, stage]) =>
        `- ${name}: ${stage.status} - ${stage.message}`,
    ),
    "",
    "## Error",
    "",
    result.error ? `- category: ${result.error.category}` : "- None",
    result.error ? `- message: ${result.error.message}` : undefined,
    result.error ? `- recoverable: ${result.error.recoverable}` : undefined,
    result.error ? `- retryPolicy: ${result.error.retryPolicy}` : undefined,
    result.error ? `- nextAction: ${result.error.nextAction}` : undefined,
    "",
    "## Next Action",
    "",
    `- ${result.nextAction}`,
  ];
  return `${lines.filter((line) => line !== undefined).join("\n")}\n`;
}

export async function writeProductM9Report(input: {
  readonly result: ProductM9RunResult;
  readonly reportRoot: string;
  readonly runId: string;
}): Promise<ProductM9RunResult> {
  const runDir = resolve(input.reportRoot, input.runId);
  const summaryJson = join(runDir, "summary.json");
  const summaryMarkdown = join(runDir, "summary.md");
  const result = productM9RunResultSchema.parse({
    ...input.result,
    artifactRefs: {
      ...input.result.artifactRefs,
      summaryJson: displayPath(summaryJson),
      summaryMarkdown: displayPath(summaryMarkdown),
    },
  });

  await mkdir(dirname(summaryJson), { recursive: true });
  await writeFile(summaryJson, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(summaryMarkdown, productM9ReportMarkdown(result));
  return result;
}

export function redactionCheckProductM9Report(value: unknown): void {
  const serialized = JSON.stringify(value);
  const checks: Array<readonly [RegExp, string]> = [
    [/figd_[A-Za-z0-9_-]+/, "figma_token"],
    [/sk-[A-Za-z0-9_-]+/, "openai_token"],
    [/https:\/\/www\.figma\.com\/design\//, "figma_design_url"],
    [/[?&]node-id=/, "figma_node_query"],
    [/"rawResponse"\s*:/, "raw_response"],
    [/"designUrl"\s*:/, "design_url"],
    [/"figmaUrl"\s*:/, "figma_url"],
    [/"fileKey"\s*:/, "file_key"],
    [/"token"\s*:/i, "token_field"],
    [/\/Users\/[^"]+/, "absolute_path"],
    [/\/var\/folders\/[^"]+/, "absolute_path"],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(serialized)) {
      throw new Error(`product_m9_report_redaction_failed:${reason}`);
    }
  }
}
