# Flow-M11 多步骤业务 Flow 执行报告

- runId：flow-m11-local-smoke-3
- status：passed
- mode：local
- figmaRestCalled：false
- openaiCalled：false
- fixtureCount：1
- successfulFixtureIds：flow-figma-submit-review-fixture
- failedFixtureIds：none
- stepCount：10
- failedCheckCount：0
- preSatisfiedExpectationCount：0
- summaryOnlyRejectionCount：0
- scenarioOnlyRejectionCount：0
- untrustedSourceRejectionCount：1

## Fixtures

- flow-figma-submit-review-fixture：submit/figma input=1 selectRadioToggle=3 postconditions=5
- flow-user-confirmed-finish-fixture：submit/user_confirmed input=1 selectRadioToggle=3 postconditions=5

## Reasons

- flow_plan_untrusted_source

## Residual Risks

- 本地 fixture 证明多步骤行为执行链路，不代表真实 Figma 样本覆盖已完成。
