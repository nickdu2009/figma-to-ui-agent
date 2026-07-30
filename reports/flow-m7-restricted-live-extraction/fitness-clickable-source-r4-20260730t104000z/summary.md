# Flow-M7 restricted-live interaction extraction 报告

- projectId：flow-m7-fitness-clickable-source-r4
- runId：fitness-clickable-source-r4-20260730t104000z
- status：passed
- figmaInteractionSource：present
- sourceUISpecRevision：1
- sourceFlowPlanRevision：1
- savedUISpecRevision：2
- trustedNonRouteConverted：5
- scenarioOnlyFixtures：0
- unresolved：4

## Converted Actions

- flow-figma-f1e69831804cba1c：set_state
- flow-figma-076a56448bf7956b：set_state
- flow-figma-aad70f0e58a4873e：set_state
- flow-figma-046f548ad78b98e0：set_state
- flow-figma-064cffbb9f8efd85：set_state

## Rejected Interactions

- figma-fa1c270553de5d33：change_to_target_not_representable
- figma-49d68f4313157af5：change_to_target_not_representable
- figma-484398ff868da059：change_to_target_not_representable
- figma-3093cd194c7d71a5：change_to_target_not_representable

## Reasons

- 无

## Playwright 验证

- passed：true
- runId：fitness-clickable-source-r4-20260730t104000z
- successfulFixtureIds：flow-figma-f1e69831804cba1c-fixture, flow-figma-076a56448bf7956b-fixture, flow-figma-aad70f0e58a4873e-fixture, flow-figma-046f548ad78b98e0-fixture, flow-figma-064cffbb9f8efd85-fixture
- failedFixtureIds：none

## 残留风险

- Flow-M7 v1 不新增 submit action kind；复杂业务状态机、select/radio 完整选择语义和真实后端仍不在本期范围。
- restricted-live 只读取 Figma REST 且不调用 OpenAI；非点击控件或无法映射到 UISpec 可点击节点的 Figma interaction 仍会保持 rejected。
