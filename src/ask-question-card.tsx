import { useMemo, useState } from "react";
import type { AskQuestion } from "../server/contracts.ts";

type Answer = { questionId: string; value: string; text?: string };

/**
 * 多题问卷式 interrupt UI。问题正文已由服务端写入普通 assistant message；
 * 此卡只管理选择、分页与最终的结构化 answers，不承担业务状态。
 */
export function AskQuestionCard(props: {
  questions: AskQuestion[];
  resolve: (payload?: unknown) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const current = props.questions[index]!;
  const answer = answers[current.id];
  const canClose = props.questions.every((question) => question.allowSkip);
  const isLast = index === props.questions.length - 1;

  const result = useMemo(
    () =>
      props.questions.map((question) => answers[question.id]).filter(
        (answer): answer is Answer => answer !== undefined,
      ),
    [answers, props.questions],
  );

  const choose = (value: string, text?: string) => {
    setAnswers((previous) => ({
      ...previous,
      [current.id]: { questionId: current.id, value, ...(text ? { text } : {}) },
    }));
  };

  const updateOther = (text: string) => choose("other", text);
  const advance = () => {
    if (!answer) return;
    if (isLast) {
      if (result.length === props.questions.length) {
        props.resolve({ answers: result });
      }
      return;
    }
    setIndex((value) => value + 1);
  };

  const skipAll = () => {
    props.resolve({
      answers: props.questions.map((question) => ({
        questionId: question.id,
        value: "skip",
      })),
    });
  };

  return (
    <section
      data-testid="ask-question-card"
      className="ask-question-card"
      aria-label="需要你的回答"
    >
      <div className="ask-question-heading">
        <h2>{current.question}</h2>
        <div className="ask-question-pagination" aria-label={`第 ${index + 1} 题，共 ${props.questions.length} 题`}>
          <button
            type="button"
            aria-label="上一题"
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            disabled={index === 0}
          >
            ‹
          </button>
          <span>{index + 1} of {props.questions.length}</span>
          <button
            type="button"
            aria-label="下一题"
            onClick={advance}
            disabled={!answer || isLast}
          >
            ›
          </button>
          {canClose ? (
            <button type="button" aria-label="跳过问卷" onClick={skipAll}>×</button>
          ) : null}
        </div>
      </div>

      <p className="ask-question-header">{current.header}</p>
      <div className="ask-question-options" role="radiogroup" aria-label={current.question}>
        {current.options.map((option, optionIndex) => (
          <button
            key={option.value}
            type="button"
            data-testid={`ask-option-${current.id}-${option.value}`}
            className={answer?.value === option.value ? "ask-question-option selected" : "ask-question-option"}
            role="radio"
            aria-checked={answer?.value === option.value}
            onClick={() => choose(option.value)}
          >
            <span className="ask-question-number">{optionIndex + 1}</span>
            <span className="ask-question-option-copy">
              <strong>{option.label}</strong>
              {option.recommended ? <em>推荐</em> : null}
              {option.description ? <small>{option.description}</small> : null}
            </span>
            <span aria-hidden="true" className="ask-question-arrow">→</span>
          </button>
        ))}
        {current.allowCustom ? (
          <label className={answer?.value === "other" ? "ask-question-custom selected" : "ask-question-custom"}>
            <span className="ask-question-number">✎</span>
            <input
              data-testid={`ask-other-${current.id}`}
              value={answer?.value === "other" ? (answer.text ?? "") : ""}
              placeholder="其他，请说明…"
              onFocus={() => choose("other", answer?.text)}
              onChange={(event) => updateOther(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="ask-question-footer">
        {current.allowSkip ? (
          <button type="button" className="ask-question-skip" onClick={() => choose("skip")}>
            跳过此题
          </button>
        ) : <span />}
        <button
          type="button"
          data-testid="ask-question-continue"
          className="ask-question-continue"
          onClick={advance}
          disabled={!answer || (answer.value === "other" && !answer.text?.trim())}
        >
          {isLast ? "提交回答" : "下一题"}
        </button>
      </div>
    </section>
  );
}
