import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  authorProductM9ConfirmationAnswers,
  parseProductM9Postcondition,
  parseProductM9Scalar,
} from "../../../src/runtime/product-m9-answer-authoring.ts";
import { flowM10ConfirmationAnswersSchema } from "../../../src/flow-plan/m10-schema.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeQuestions(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const path = join(root, "confirmation-questions.json");
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: "1",
        projectId: "demo-project",
        runId: "demo-run",
        questionCount: 2,
        questions: [
          {
            schemaVersion: "1",
            id: "m10-follow-one",
            interactionId: "missing-follow-one",
            source: "missing",
            classification: "needs_confirmation.submit_like",
            questionKind: "submit_like",
            prompt: "Confirm follow one",
            evidenceSummary: "Missing target",
            uiNodeId: "follow-one",
            fromPageId: "home",
            applyCarrier: "flow_plan",
            allowedAnswerKinds: [
              "submit",
              "navigate",
              "set_state",
              "open_dialog",
              "decline",
            ],
            requiredPostconditions: "at_least_one_observable",
            candidateRefs: {
              pageIds: ["home"],
              nodeIds: ["follow-one", "follow-success"],
              stateKeys: [],
              transitionIds: [],
            },
            required: true,
          },
          {
            schemaVersion: "1",
            id: "m10-follow-two",
            interactionId: "missing-follow-two",
            source: "missing",
            classification: "needs_confirmation.submit_like",
            questionKind: "submit_like",
            prompt: "Confirm follow two",
            evidenceSummary: "Missing target",
            uiNodeId: "follow-two",
            fromPageId: "home",
            applyCarrier: "flow_plan",
            allowedAnswerKinds: ["submit", "decline"],
            requiredPostconditions: "at_least_one_observable",
            candidateRefs: {
              pageIds: ["home"],
              nodeIds: ["follow-two", "follow-success"],
              stateKeys: [],
              transitionIds: [],
            },
            required: true,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

describe("Product-M9 answer authoring", () => {
  it("writes schema-valid submit answers for all questions", async () => {
    const root = "data/test-product-m9-answer-authoring";
    roots.push(root);
    const questionsPath = await writeQuestions(root);
    const outPath = join(root, "answers.json");

    const result = await authorProductM9ConfirmationAnswers({
      questionsPath,
      outPath,
      questionIds: [],
      all: true,
      answerKind: "submit",
      effectKind: "set_state",
      stateKey: "follow-status",
      value: true,
      postconditions: [{ kind: "expect_visible", nodeId: "follow-success" }],
      reason: "User confirmed follow success state.",
    });

    expect(result).toMatchObject({
      projectId: "demo-project",
      runId: "demo-run",
      outPath,
      answerCount: 2,
    });
    const answers = flowM10ConfirmationAnswersSchema.parse(
      JSON.parse(await readFile(outPath, "utf8")),
    );
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({
      questionId: "m10-follow-one",
      answerKind: "submit",
      effect: {
        kind: "set_state",
        stateKey: "follow-status",
        value: true,
      },
      postconditions: [{ kind: "expect_visible", nodeId: "follow-success" }],
    });
  });

  it("rejects missing question ids", async () => {
    const root = "data/test-product-m9-answer-authoring-missing";
    roots.push(root);
    const questionsPath = await writeQuestions(root);

    await expect(
      authorProductM9ConfirmationAnswers({
        questionsPath,
        outPath: join(root, "answers.json"),
        questionIds: ["m10-missing"],
        all: false,
        answerKind: "decline",
        reason: "No confirmed behavior.",
      }),
    ).rejects.toThrow("question_not_found:m10-missing");
  });

  it("rejects answer kinds that a question does not allow", async () => {
    const root = "data/test-product-m9-answer-authoring-kind";
    roots.push(root);
    const questionsPath = await writeQuestions(root);

    await expect(
      authorProductM9ConfirmationAnswers({
        questionsPath,
        outPath: join(root, "answers.json"),
        questionIds: ["m10-follow-two"],
        all: false,
        answerKind: "navigate",
        targetPageId: "home",
      }),
    ).rejects.toThrow("answer_kind_not_allowed:m10-follow-two:navigate");
  });

  it("parses scalar values and postconditions from CLI strings", () => {
    expect(parseProductM9Scalar("true")).toBe(true);
    expect(parseProductM9Scalar("12.5")).toBe(12.5);
    expect(parseProductM9Scalar("active")).toBe("active");
    expect(parseProductM9Postcondition("expect_text:toast:Followed: OK")).toEqual({
      kind: "expect_text",
      nodeId: "toast",
      text: "Followed: OK",
    });
  });
});
