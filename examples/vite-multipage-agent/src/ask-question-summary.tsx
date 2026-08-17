import { useState } from "react";
import type { AskQuestion, AskQuestionResult } from "../server/contracts.ts";

type Answer = AskQuestionResult["answers"][number];

function parseAnswers(result: string | undefined): Answer[] {
  if (!result) return [];
  try {
    const value = JSON.parse(result) as { answers?: unknown };
    return Array.isArray(value.answers)
      ? value.answers.filter(
          (answer): answer is Answer =>
            typeof answer === "object" &&
            answer !== null &&
            typeof (answer as { questionId?: unknown }).questionId === "string" &&
            typeof (answer as { value?: unknown }).value === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function answerLabel(question: AskQuestion, answer: Answer | undefined): string {
  if (!answer) return "未提供答案";
  if (answer.value === "skip") return "已跳过";
  if (answer.value === "other") return answer.text?.trim() || "未提供答案";
  return question.options.find((option) => option.value === answer.value)?.label ?? "未提供答案";
}

/**
 * 已完成 ask_question 的持久化工具结果。它和普通 assistant 文本一起保留
 * 在消息流中；默认收起，避免把已完成的问卷继续当成可交互的 interrupt。
 */
export function AskQuestionSummary(props: {
  questions: AskQuestion[];
  result: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const answers = parseAnswers(props.result);
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const answeredCount = props.questions.filter((question) => {
    const answer = answerByQuestionId.get(question.id);
    return answer !== undefined && answer.value !== "skip";
  }).length;
  const status = answeredCount === 0
    ? "未提供答案"
    : `已回答 ${answeredCount} 个问题`;

  return (
    <section className="ask-question-summary" data-testid="ask-question-summary">
      <button
        type="button"
        className="ask-question-summary-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
        <span>{status}</span>
        <span className={open ? "ask-question-summary-chevron open" : "ask-question-summary-chevron"} aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <dl className="ask-question-summary-details" data-testid="ask-question-summary-details">
          {props.questions.map((question) => (
            <div key={question.id}>
              <dt>{question.question}</dt>
              <dd>{answerLabel(question, answerByQuestionId.get(question.id))}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
