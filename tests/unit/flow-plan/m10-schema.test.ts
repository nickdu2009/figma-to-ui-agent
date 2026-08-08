import { describe, expect, it } from "vitest";

import {
  flowM10ConfirmationAnswerSchema,
  flowM10ConfirmationQuestionSchema,
} from "../../../src/flow-plan/m10-schema.ts";

describe("Flow-M10 schema", () => {
  it("解析结构化 question 和 submit answer", () => {
    expect(
      flowM10ConfirmationQuestionSchema.parse({
        schemaVersion: "1",
        id: "m10-login",
        interactionId: "missing-login",
        source: "missing",
        classification: "needs_confirmation.submit_like",
        questionKind: "submit_like",
        prompt: "确认提交行为",
        evidenceSummary: "Log In button",
        applyCarrier: "flow_plan",
        allowedAnswerKinds: ["submit", "decline"],
        requiredPostconditions: "at_least_one_observable",
        candidateRefs: {
          pageIds: ["home"],
          nodeIds: ["login-button"],
          stateKeys: ["form-status"],
          transitionIds: [],
        },
        required: true,
      }),
    ).toMatchObject({
      questionKind: "submit_like",
      applyCarrier: "flow_plan",
    });

    expect(
      flowM10ConfirmationAnswerSchema.parse({
        id: "answer-login",
        questionId: "m10-login",
        answerKind: "submit",
        effect: {
          kind: "set_state",
          stateKey: "form-status",
          value: "review",
        },
        postconditions: [{ kind: "expect_visible", nodeId: "review-text" }],
      }),
    ).toMatchObject({
      answerKind: "submit",
    });
  });

  it("拒绝缺少 postcondition 的 submit answer 和额外敏感字段", () => {
    expect(() =>
      flowM10ConfirmationAnswerSchema.parse({
        id: "answer-login",
        questionId: "m10-login",
        answerKind: "submit",
        effect: {
          kind: "set_state",
          stateKey: "form-status",
          value: "review",
        },
        postconditions: [],
      }),
    ).toThrow();

    expect(() =>
      flowM10ConfirmationAnswerSchema.parse({
        id: "answer-login",
        questionId: "m10-login",
        answerKind: "decline",
        reason: "decline",
        designUrl: "https://www.figma.com/design/raw",
      }),
    ).toThrow();
  });
});
