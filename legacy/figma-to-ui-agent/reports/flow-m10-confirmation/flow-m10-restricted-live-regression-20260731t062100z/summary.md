# Flow-M10 真实语义补全与用户确认报告

- runId：flow-m10-restricted-live-regression-20260731t062100z
- mode：restricted-live-regression
- status：passed
- figmaRestCalled：false
- openaiCalled：false
- generatedQuestions：9
- submitLikeQuestions：9
- summaryOnlyQuestions：8
- applied：1
- rejected：2
- invalid：0
- unmatched：0
- userConfirmedSubmit：1
- userConfirmedStateMachineTransitions：0

## Samples

- community-design-system-001：questions=5 summaryOnly=5 applied=0 rejected=0
- community-login-001：questions=3 summaryOnly=3 applied=0 rejected=1

## Rejections

- m10-missing-login-submit：postcondition_reference_missing
- m10-community-login-001-missing-ui-login-version-1-3-5137-control：summary_only_apply_carrier

## Reasons

- m8_user_confirmed_converted=1
- m8_trusted_submit_converted=1
- m8_state_machine_transitions=0

## 残留风险

- restricted-live 回归复用 Flow-M9 summary 作为真实 question provenance；apply 证据来自可读取 FlowPlan fixture 或 artifact。
