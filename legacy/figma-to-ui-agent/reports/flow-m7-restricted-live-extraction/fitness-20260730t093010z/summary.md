# Flow-M7 restricted-live interaction extraction 报告

- projectId：flow-m7-fitness-restricted-live
- runId：fitness-20260730t093010z
- status：partial
- figmaInteractionSource：present
- sourceUISpecRevision：1
- sourceFlowPlanRevision：1
- savedUISpecRevision：none
- trustedNonRouteConverted：0
- scenarioOnlyFixtures：0
- unresolved：6

## Converted Actions

- 无

## Rejected Interactions

- figma-f1e69831804cba1c：ui_node_not_clickable
- figma-076a56448bf7956b：ui_node_not_clickable
- figma-aad70f0e58a4873e：ui_node_not_clickable
- figma-046f548ad78b98e0：ui_node_not_clickable
- figma-064cffbb9f8efd85：ui_node_not_clickable
- missing-ui-6-11---a---profile-3186-4431-control：interaction_target_missing

## Reasons

- flow_m7_no_trusted_non_route_interaction
- flow_m7_behavior_validation_missing

## 残留风险

- Flow-M7 v1 不新增 submit action kind；复杂业务状态机、select/radio 完整选择语义和真实后端仍不在本期范围。
- 当前 runner 为 local-only；restricted-live/live Figma 样本需要单独 gate。
