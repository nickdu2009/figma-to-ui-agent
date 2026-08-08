# Flow-M11 多步骤业务 Flow 执行报告

- runId：flow-m11-restricted-live-fitness-supplement-20260808-r4
- status：partial
- mode：restricted-live
- figmaRestCalled：false
- openaiCalled：false
- fixtureCount：5
- successfulFixtureIds：flow-figma-f1e69831804cba1c-1-fixture, flow-figma-076a56448bf7956b-1-fixture, flow-figma-aad70f0e58a4873e-1-fixture, flow-figma-046f548ad78b98e0-1-fixture, flow-figma-064cffbb9f8efd85-1-fixture
- failedFixtureIds：none
- stepCount：10
- failedCheckCount：0
- preSatisfiedExpectationCount：0
- summaryOnlyRejectionCount：0
- scenarioOnlyRejectionCount：0
- untrustedSourceRejectionCount：4

## Fixtures

- flow-figma-f1e69831804cba1c-1-fixture：set_state/figma input=0 selectRadioToggle=0 postconditions=1
- flow-figma-076a56448bf7956b-1-fixture：set_state/figma input=0 selectRadioToggle=0 postconditions=1
- flow-figma-aad70f0e58a4873e-1-fixture：set_state/figma input=0 selectRadioToggle=0 postconditions=1
- flow-figma-046f548ad78b98e0-1-fixture：set_state/figma input=0 selectRadioToggle=0 postconditions=1
- flow-figma-064cffbb9f8efd85-1-fixture：set_state/figma input=0 selectRadioToggle=0 postconditions=1

## Reasons

- flow_plan_untrusted_source
- flow_m11_trusted_submit_fixture_missing
- flow_m11_multistep_submit_fixture_missing
- flow_m11_select_radio_toggle_missing

## Residual Risks

- restricted-live 只证明真实样本 FlowPlan artifact 可执行，不代表真实后端业务提交成功。
