# Flow-M7 restricted-live interaction extraction 报告

- projectId：flow-m7-fitness-variant-state-r3
- runId：fitness-variant-state-r3-20260730t095300z
- status：passed
- figmaInteractionSource：present
- sourceUISpecRevision：1
- sourceFlowPlanRevision：1
- savedUISpecRevision：2
- trustedNonRouteConverted：1
- scenarioOnlyFixtures：0
- unresolved：8

## Converted Actions

- flow-figma-064cffbb9f8efd85：set_state

## Rejected Interactions

- figma-f1e69831804cba1c：ui_node_not_clickable
- figma-076a56448bf7956b：ui_node_not_clickable
- figma-aad70f0e58a4873e：ui_node_not_clickable
- figma-046f548ad78b98e0：ui_node_not_clickable
- figma-fa1c270553de5d33：ui_node_not_clickable
- figma-49d68f4313157af5：ui_node_not_clickable
- figma-484398ff868da059：ui_node_not_clickable
- figma-3093cd194c7d71a5：ui_node_not_clickable

## Reasons

- 无

## Playwright 验证

- passed：true
- runId：fitness-variant-state-r3-20260730t095300z
- successfulFixtureIds：flow-figma-064cffbb9f8efd85-fixture
- failedFixtureIds：none

## 残留风险

- Flow-M7 v1 不新增 submit action kind；复杂业务状态机、select/radio 完整选择语义和真实后端仍不在本期范围。
- restricted-live 只读取 Figma REST 且不调用 OpenAI；非点击控件或无法映射到 UISpec 可点击节点的 Figma interaction 仍会保持 rejected。
