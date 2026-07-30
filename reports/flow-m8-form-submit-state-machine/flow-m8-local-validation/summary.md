# Flow-M8 表单提交与状态机报告

- projectId：demo-project
- runId：flow-m8-local-validation
- status：passed
- scope：form_submit_state_machine
- sourceUISpecRevision：1
- sourceFlowPlanRevision：1
- savedUISpecRevision：2
- trustedSubmitConverted：2
- userConfirmedConverted：1
- stateMachineTransitions：2
- selectRadioAssertions：4
- scenarioOnlyFixtures：3
- unresolved：1

## Converted Actions

- flow-figma-submit-review：submit/figma
- flow-user-confirmed-finish：submit/user_confirmed

## Behavior Fixtures

- m8-fill-email：scenario
- m8-select-plan：scenario
- m8-radio-role：scenario
- flow-figma-submit-review-fixture：flow_plan/submit/submit/transition
- flow-user-confirmed-finish-fixture：flow_plan/submit/submit/transition

## Reasons

- flow_m8_scenario_used_as_fixture_input_only

## Playwright 验证

- passed：true
- runId：flow-m8-local-validation
- resultCount：1
- failedCheckCount：0
- successfulFixtureIds：m8-fill-email, m8-select-plan, m8-radio-role, flow-figma-submit-review-fixture, flow-user-confirmed-finish-fixture
- failedFixtureIds：none

## 残留风险

- Flow-M8 submit 只表示本地 UI effect 和 Playwright postcondition，不表示真实后端业务成功。
- 默认本地验证不调用 Figma/OpenAI；restricted-live submit 样本仍需要后续单独 gate。
