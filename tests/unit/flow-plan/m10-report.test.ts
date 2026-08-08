import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applyFlowM10Confirmations } from "../../../src/flow-plan/m10-apply-confirmations.ts";
import { generateFlowM10ConfirmationQuestions } from "../../../src/flow-plan/m10-confirmation-questions.ts";
import {
  buildFlowM10ConfirmationReport,
  redactionCheckFlowM10Report,
} from "../../../src/flow-plan/m10-report.ts";
import { flowPlanDraftSchema } from "../../../src/flow-plan/schema.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

describe("Flow-M10 report", () => {
  it("生成 passed 报告并统计 apply/reject/userConfirmedSubmit", async () => {
    const flowPlan = flowPlanDraftSchema.parse(
      await loadJson("tests/fixtures/flow-plan/m10-confirmation-semantics/flow-plan.json"),
    );
    const uiSpec = uiSpecDraftSchema.parse(
      await loadJson("tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json"),
    );
    const answers = await loadJson(
      "tests/fixtures/flow-plan/m10-confirmation-semantics/answers.json",
    );
    const questions = generateFlowM10ConfirmationQuestions({ flowPlan });
    const applied = applyFlowM10Confirmations({
      flowPlan,
      questions,
      rawAnswers: (answers as unknown[]).slice(0, 2),
      uiSpec,
    });

    const report = buildFlowM10ConfirmationReport({
      runId: "flow-m10-local",
      mode: "local",
      flowPlanRef: "tests/fixtures/flow-plan/m10-confirmation-semantics/flow-plan.json",
      uiSpecRef: "tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json",
      answerRef: "tests/fixtures/flow-plan/m10-confirmation-semantics/answers.json",
      questions,
      results: applied.results,
      flowPlan: applied.flowPlan,
    });

    expect(report.status).toBe("passed");
    expect(report.counts).toMatchObject({
      generatedQuestions: 1,
      submitLikeQuestions: 1,
      applied: 1,
      rejected: 1,
      userConfirmedSubmit: 1,
    });
  });

  it("拒绝包含 Figma URL 的报告", () => {
    expect(() =>
      redactionCheckFlowM10Report({
        designUrl: "https://www.figma.com/design/abc",
      }),
    ).toThrow("flow_m10_report_redaction_failed:figma_design_url");
  });
});
