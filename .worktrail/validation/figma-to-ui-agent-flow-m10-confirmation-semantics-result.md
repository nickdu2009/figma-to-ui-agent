---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m10-confirmation-semantics-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M10 真实语义补全与用户确认验收结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m10"
}
---

# Figma-to-UI Agent Flow-M10 真实语义补全与用户确认验收结果

## 1. 验收范围

本记录验收已推广的 Flow-M10 设计与实施计划，范围包括：

- 结构化 confirmation question schema。
- 结构化 answer schema。
- 可信来源规则：`figma` 和 `user_confirmed` 才能进入业务行为；`inferred`、`missing`、summary-only 只能生成问题或拒绝结果。
- fail-closed 拒绝规则：缺 postcondition、悬空引用、summary-only 无 FlowPlan 载体、answerKind 不匹配等不写回 confirmed interaction。
- Flow-M10 report schema 与脱敏检查。
- 与 Flow-M8 submit/stateMachine planner 的消费链路。
- restricted-live-regression 复用 Flow-M9 三个样本 summary report，不重新访问 Figma，不调用 OpenAI。

## 2. 实现落点

新增或修改的主要落点：

- `src/flow-plan/m10-schema.ts`
- `src/flow-plan/m10-confirmation-questions.ts`
- `src/flow-plan/m10-apply-confirmations.ts`
- `src/flow-plan/m10-report.ts`
- `src/flow-plan/m10-runner.ts`
- `scripts/run-flow-m10-confirmation.mjs`
- `tests/fixtures/flow-plan/m10-confirmation-semantics/`
- `tests/unit/flow-plan/m10-*.test.ts`
- `tests/integration/flow-plan/flow-m10-confirmation.test.ts`
- `reports/flow-m10-confirmation/flow-m10-local-20260731t062100z/`
- `reports/flow-m10-confirmation/flow-m10-restricted-live-regression-20260731t062100z/`

未修改：

- `package.json`
- `package-lock.json`
- `src/runtime/tool-boundary.ts`

## 3. 本地运行结果

本地 M10 run：`flow-m10-local-20260731t062100z`。

报告路径：`reports/flow-m10-confirmation/flow-m10-local-20260731t062100z/summary.json`。

关键结果：

- status：`passed`
- mode：`local`
- figmaRestCalled：`false`
- openaiCalled：`false`
- generatedQuestions：1
- submitLikeQuestions：1
- applied：1
- rejected：1
- unmatched：0
- summaryOnlyQuestions：0
- userConfirmedSubmit：1
- M8 消费证据：`m8_user_confirmed_converted=1`

含义：本地 fixture 中的 missing submit-like interaction 经结构化 answer 写回为 `user_confirmed submit`，并被 Flow-M8 planner 转换；悬空 postcondition 的坏答案被拒绝。

## 4. Restricted-live-regression 结果

restricted-live-regression run：`flow-m10-restricted-live-regression-20260731t062100z`。

报告路径：`reports/flow-m10-confirmation/flow-m10-restricted-live-regression-20260731t062100z/summary.json`。

输入来源：复用 `reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json`。

关键结果：

- status：`passed`
- mode：`restricted-live-regression`
- figmaRestCalled：`false`
- openaiCalled：`false`
- generatedQuestions：9
- submitLikeQuestions：9
- summaryOnlyQuestions：8
- applied：1
- rejected：2
- userConfirmedSubmit：1
- sample provenance 覆盖：`community-design-system-001`、`community-login-001`
- summary-only 拒绝证据：`summary_only_apply_carrier`
- M8 消费证据：`m8_user_confirmed_converted=1`

含义：Flow-M9 三个样本报告中的真实 submit-like classification 可以进入 M10 question 链路；由于 Flow-M9 当前 summary 中 `flowPlanPath` 为 `ephemeral-flow-plan`，summary-only 问题不会被假装应用，必须由 fixture 或未来可读取 FlowPlan artifact 提供 apply 证据。

## 5. 验证命令

已通过：

```bash
npm exec -- vitest run tests/unit/flow-plan/m10-schema.test.ts tests/unit/flow-plan/m10-confirmation-questions.test.ts tests/unit/flow-plan/m10-apply-confirmations.test.ts tests/unit/flow-plan/m10-report.test.ts tests/integration/flow-plan/flow-m10-confirmation.test.ts
```

结果：5 个测试文件、9 个测试通过。

已通过：

```bash
npm exec -- vitest run tests/unit/flow-plan/m10-schema.test.ts tests/unit/flow-plan/m10-confirmation-questions.test.ts tests/unit/flow-plan/m10-apply-confirmations.test.ts tests/unit/flow-plan/m10-report.test.ts tests/integration/flow-plan/flow-m10-confirmation.test.ts tests/unit/flow-plan/m8-planner.test.ts tests/integration/flow-plan/flow-m8-form-submit-state-machine.test.ts
```

结果：7 个测试文件、14 个测试通过。

已通过：

```bash
npm run typecheck
```

已通过：

```bash
npm run test:unit
```

结果：56 个测试文件、320 个测试通过。

已通过：

```bash
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm exec -- vitest run tests/integration --testTimeout=30000
```

结果：17 个测试文件、71 个测试通过。

已通过：

```bash
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e
```

结果：6 个 Playwright E2E 测试通过。

## 6. 脱敏与外部边界

- M10 本地 run 和 restricted-live-regression run 均记录 `figmaRestCalled=false`、`openaiCalled=false`。
- 新增代码没有默认 Figma/OpenAI 调用。
- runner 中真实 Figma refresh 仍被 gate 阻断，且当前未实现刷新路径。
- 报告脱敏检查覆盖 token、Figma design URL、fileKey、designUrl、rawResponse。
- 报告只保存 sampleId、questionId、interactionId、受控 reasonCode 和本地 artifact refs。

## 7. 残留风险

- restricted-live-regression 当前复用 Flow-M9 summary report 证明真实 question provenance；由于 Flow-M9 未落盘完整 FlowPlan artifact，真实样本本体的 answer apply 仍需要后续 runner 落盘 FlowPlan 后再验证。
- M10 首版只证明结构化确认语义和 M8 消费链路，不代表真实后端业务成功。
- Product/PI agent 交互式确认 UI 仍属于后续 Product 线，不在本次 Flow-M10 范围内。

## 8. 结论

Flow-M10 本地实现和 restricted-live-regression 验收通过。当前能力已经能把 submit-like 候选安全转换为结构化确认问题，并且只有带可观察 postcondition、引用闭合、可读取 FlowPlan 载体的结构化答案才会写回为 `user_confirmed submit`。真实 Flow-M9 summary-only 候选会进入 question/report 链路，但不会在缺少 FlowPlan 载体时被假装应用。
