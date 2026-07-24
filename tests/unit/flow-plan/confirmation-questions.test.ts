import { describe, expect, it } from "vitest";

import { generateConfirmationQuestions } from "../../../src/flow-plan/confirmation-questions.ts";
import { buildFlowPlanDraft } from "../../../src/flow-plan/interaction-candidates.ts";
import {
  createStoredMultipageFlowDesignBundle,
  createStoredMultipageFlowUISpec,
} from "../../fixtures/flow-plan/multipage-flow.ts";

describe("generateConfirmationQuestions", () => {
  it("为 inferred interaction 生成用户确认问题", () => {
    const draft = generateConfirmationQuestions(
      buildFlowPlanDraft({
        bundle: createStoredMultipageFlowDesignBundle(),
        uiSpec: createStoredMultipageFlowUISpec(),
      }),
    );

    expect(draft.confirmationQuestions).toHaveLength(2);
    expect(draft.confirmationQuestions[0]!.question).toContain("继续报价");
    expect(draft.confirmationQuestions[0]!.question).toContain("原因");
    expect(draft.confirmationQuestions[0]!.question).toContain("首页");
    expect(draft.confirmationQuestions[0]!.options).toEqual(
      expect.arrayContaining([
        { label: "保持静态，不生成交互", value: "static" },
      ]),
    );
    expect(draft.interactions[0]!.confirmationQuestionId).toBe(
      draft.confirmationQuestions[0]!.id,
    );
  });
});
