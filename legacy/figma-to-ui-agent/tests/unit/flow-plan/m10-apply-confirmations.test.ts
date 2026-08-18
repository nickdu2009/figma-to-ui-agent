import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { applyFlowM10Confirmations } from "../../../src/flow-plan/m10-apply-confirmations.ts";
import { generateFlowM10ConfirmationQuestions } from "../../../src/flow-plan/m10-confirmation-questions.ts";
import { flowM10ConfirmationQuestionSchema } from "../../../src/flow-plan/m10-schema.ts";
import { flowPlanDraftSchema } from "../../../src/flow-plan/schema.ts";
import { uiSpecDraftSchema } from "../../../src/ui-spec/schema.ts";

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function loadFixture() {
  const flowPlan = flowPlanDraftSchema.parse(
    await loadJson("tests/fixtures/flow-plan/m10-confirmation-semantics/flow-plan.json"),
  );
  const uiSpec = uiSpecDraftSchema.parse(
    await loadJson("tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json"),
  );
  const answers = await loadJson(
    "tests/fixtures/flow-plan/m10-confirmation-semantics/answers.json",
  );
  return { flowPlan, uiSpec, answers };
}

describe("Flow-M10 answer applier", () => {
  it("应用合法结构化 submit，并拒绝悬空 postcondition", async () => {
    const { flowPlan, uiSpec, answers } = await loadFixture();
    const questions = generateFlowM10ConfirmationQuestions({ flowPlan });
    const result = applyFlowM10Confirmations({
      flowPlan,
      questions,
      rawAnswers: (answers as unknown[]).slice(0, 2),
      uiSpec,
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        answerId: "answer-apply-submit",
        result: "applied",
        intent: "submit",
      }),
      expect.objectContaining({
        answerId: "answer-broken-ref",
        result: "rejected",
        reasonCode: "postcondition_reference_missing",
      }),
    ]);
    expect(result.flowPlan.interactions[0]).toMatchObject({
      id: "missing-login-submit",
      source: "user_confirmed",
      confirmed: true,
      trigger: "submit",
      intent: "submit",
      stateKey: "form-status",
      value: "review",
      postconditions: [{ kind: "expect_visible", nodeId: "review-text" }],
    });
  });

  it("summary-only question 没有 FlowPlan 载体时 fail closed", async () => {
    const { flowPlan, uiSpec, answers } = await loadFixture();
    const questions = [
      ...generateFlowM10ConfirmationQuestions({ flowPlan }),
      flowM10ConfirmationQuestionSchema.parse({
        schemaVersion: "1" as const,
        id: "m10-community-login-001-missing-ui-login-version-1-3-5137-control",
        interactionId: "missing-ui-login-version-1-3-5137-control",
        sampleId: "community-login-001",
        source: "missing" as const,
        classification: "needs_confirmation.submit_like" as const,
        questionKind: "submit_like" as const,
        prompt: "真实样本 submit-like 候选",
        evidenceSummary: "summary only",
        applyCarrier: "summary_only" as const,
        allowedAnswerKinds: ["submit", "decline"],
        requiredPostconditions: "at_least_one_observable" as const,
        candidateRefs: {
          pageIds: [],
          nodeIds: [],
          stateKeys: [],
          transitionIds: [],
        },
        required: true,
      }),
    ];
    const result = applyFlowM10Confirmations({
      flowPlan,
      questions,
      rawAnswers: (answers as unknown[]).slice(2),
      uiSpec,
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        answerId: "answer-summary-only",
        result: "rejected",
        reasonCode: "summary_only_apply_carrier",
      }),
    ]);
    expect(result.flowPlan.interactions[0]).toMatchObject({
      source: "missing",
      confirmed: false,
    });
  });

  it("为布尔 submit set_state effect 推导可 hydrate 的初始值", async () => {
    const { flowPlan, uiSpec } = await loadFixture();
    const questions = generateFlowM10ConfirmationQuestions({ flowPlan });
    const result = applyFlowM10Confirmations({
      flowPlan,
      questions,
      rawAnswers: [
        {
          id: "answer-boolean-submit",
          questionId: "m10-missing-login-submit",
          answerKind: "submit",
          effect: {
            kind: "set_state",
            stateKey: "invite-submitted",
            value: true,
          },
          postconditions: [
            {
              kind: "expect_visible",
              nodeId: "review-text",
            },
          ],
        },
      ],
      uiSpec,
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        answerId: "answer-boolean-submit",
        result: "applied",
      }),
    ]);
    expect(result.flowPlan.interactions[0]).toMatchObject({
      source: "user_confirmed",
      intent: "submit",
      stateKey: "invite-submitted",
      value: true,
      stateInitialValue: false,
    });
  });
});
