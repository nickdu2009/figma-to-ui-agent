---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m8-form-submit-state-machine-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M8 表单提交与状态机本地实现验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m8"
}
---

# Figma-to-UI Agent Flow-M8 表单提交与状态机本地实现验收记录

## 结论

Flow-M8 `form_submit_state_machine` 本地实现已完成并通过本地验收。实现范围覆盖 FlowPlan submit intent、UISpec submit action、select/radio 行为语义、Preview submit 本地 dispatch、RenderAndCompare 行为执行与 submit 因果校验、Flow-M8 planner/report/local runner、正负 fixture 和回归测试。

本次验收未调用 OpenAI、未调用 Figma live/restricted-live、未新增依赖、未修改 Pi 四工具边界、未执行 Git lifecycle。

## 本地 runner 结果

报告路径：`reports/flow-m8-form-submit-state-machine/flow-m8-local-validation/summary.json`

关键结果：

- status：passed
- projectId：demo-project
- runId：flow-m8-local-validation
- sourceUISpecRevision：1
- sourceFlowPlanRevision：1
- savedUISpecRevision：2
- trustedSubmitConverted：2
- userConfirmedConverted：1
- stateMachineTransitions：2
- selectRadioAssertions：4
- scenarioOnlyFixtures：3
- unresolved：1
- Playwright validation passed：true
- failedCheckCount：0
- successfulFixtureIds：`m8-fill-email`, `m8-select-plan`, `m8-radio-role`, `flow-figma-submit-review-fixture`, `flow-user-confirmed-finish-fixture`

## 命令证据

- `npm run typecheck`：通过，`tsc --noEmit` 无错误。
- `npm run test:unit`：通过，49 个测试文件，303 个测试通过。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration`：通过，15 个测试文件，65 个测试通过。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e`：通过，6 个 Playwright 测试通过。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run flow:m8:local -- --project-id demo-project --data-root data/flow-m8-local-validation --scenario tests/fixtures/flow-plan/m8-form-submit-state-machine/scenario.json --save-ui-spec --run-compare --run-id flow-m8-local-validation --browser-executable-path data/playwright-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell --comparison-json '{"maxDiffPixelRatio":1,"maxDiffPixels":1000000,"timeoutMs":10000}'`：通过，生成 passed report。

## AC 覆盖

- AC1：FlowPlan schema 支持 `intent="submit"`，旧 Flow-M6/Flow-M7 fixture 兼容；由 schema 单元测试和全量 unit 证明。
- AC2：UISpec schema 支持 `action.kind="submit"`，submit action 必须有 postcondition；由 UISpec 契约测试证明。
- AC3：Preview dispatch 支持 submit 的 `set_state`、`open_dialog`、`navigate`、`none` 本地 effect；由 e2e 和 Flow-M8 integration runner 证明。
- AC4：behavior fixture 支持 `select_option`、`choose_radio`、`expect_selected`；由 UISpec 契约测试和 Flow-M8 runner 成功 fixture 证明。
- AC5：submit fixture 执行点击前后 postcondition 采样；点击后未达成 postcondition 不计为 verified；由 RenderAndCompare 行为执行器和 Flow-M8 integration 测试证明。
- AC6：用户确认可生成 `user_confirmed` submit；缺 postcondition 或悬空 postcondition 被拒绝或转换为 unresolved；由 apply-confirmations 和 planner 单元测试证明。
- AC7：本地状态机覆盖两次 transition，且对应 fixture 通过 Playwright；由 Flow-M8 runner 的 `stateMachineTransitions=2` 和 successfulFixtureIds 证明。
- AC8：`inferred`、`missing`、scenario-only、不可信来源不得生成 submit action 或 state machine transition；由 planner/report 单元测试和 runner 中 `inferred-submit` rejected 证明。
- AC9：Flow-M6/Flow-M7 与 Preview 回归通过；由全量 unit/integration/e2e 证明。
- AC10：默认验证链路未调用 OpenAI/Figma，未新增依赖，未修改四工具边界；`package-lock.json` 无变更，四工具边界相关文件无 diff。

## 残留风险

- Flow-M8 submit 只表示本地 UI effect 和 Playwright postcondition，不表示真实后端业务成功。
- 默认本地验证不调用 Figma/OpenAI；真实 restricted-live submit 样本仍需要后续单独 gate。
- scenario fixture 只作为输入/选择步骤，不作为业务真相或 passed 的唯一依据。
