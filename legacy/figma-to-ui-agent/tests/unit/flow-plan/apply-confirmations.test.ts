import { describe, expect, it } from "vitest";

import { applyConfirmations } from "../../../src/flow-plan/apply-confirmations.ts";
import { generateConfirmationQuestions } from "../../../src/flow-plan/confirmation-questions.ts";
import { buildFlowPlanDraft } from "../../../src/flow-plan/interaction-candidates.ts";
import {
  createStoredMultipageFlowDesignBundle,
  createStoredMultipageFlowUISpec,
} from "../../fixtures/flow-plan/multipage-flow.ts";

describe("applyConfirmations", () => {
  it("把用户确认答案写回结构化 FlowPlanDraft", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const confirmed = applyConfirmations(draft, [
      {
        questionId: draft.confirmationQuestions[0]!.id,
        value: "target:quote",
      },
    ]);

    expect(confirmed.interactions[0]).toMatchObject({
      source: "user_confirmed",
      confirmed: true,
      intent: "navigate",
      targetPageId: "quote",
    });
    expect(confirmed.report.unresolvedInteractionCount).toBe(1);
  });

  it("静态答案不会转换为确认交互", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const confirmed = applyConfirmations(draft, [
      {
        questionId: draft.confirmationQuestions[0]!.id,
        answer: "static",
      },
    ]);

    expect(confirmed.interactions[0]).toMatchObject({
      source: "inferred",
      confirmed: false,
      blockedReason: "user_declined_interaction",
    });
  });

  it("把用户确认的 submit 答案写回带 postcondition 的交互", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const confirmed = applyConfirmations(draft, [
      {
        questionId: draft.confirmationQuestions[0]!.id,
        value: "submit:set_state:submitted:true:expect_visible:success-message",
      },
    ]);

    expect(confirmed.interactions[0]).toMatchObject({
      source: "user_confirmed",
      confirmed: true,
      trigger: "submit",
      intent: "submit",
      stateKey: "submitted",
      value: true,
      postconditions: [
        {
          kind: "expect_visible",
          nodeId: "success-message",
        },
      ],
    });
  });

  it("拒绝缺少 postcondition 的 submit 确认答案", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );
    const confirmed = applyConfirmations(draft, [
      {
        questionId: draft.confirmationQuestions[0]!.id,
        value: "submit:set_state:submitted:true",
      },
    ]);

    expect(confirmed.interactions[0]).toMatchObject({
      confirmed: false,
      blockedReason: "invalid_submit_confirmation_answer",
    });
  });
});
