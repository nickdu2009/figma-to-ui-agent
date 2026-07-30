---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m7-variant-state-validation-20260730",
  "scope": "project",
  "type": "validation",
  "title": "Flow-M7 interactive component variant state validation",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m7"
}
---

# Flow-M7 interactive component variant state validation

## 验证结论

Flow-M7 已能把真实 Figma interactive component `CHANGE_TO` 交互转换为 UISpec `set_state`，并通过本地 Preview 的真实 DOM 行为验证。

## 证据

- 样本：Fitness App UI Kit restricted-live 样本。
- 运行：`fitness-variant-state-r3-20260730t095300z`。
- 报告：`reports/flow-m7-restricted-live-extraction/fitness-variant-state-r3-20260730t095300z/summary.json`。
- 状态：`passed`。
- `figmaInteractionSource`：`present`。
- `trustedNonRouteConverted`：`1`。
- 转换动作：`figma-064cffbb9f8efd85 -> flow-figma-064cffbb9f8efd85`。
- 转换意图：`set_state`。
- 保存 UISpec：source revision `1`，saved revision `2`。
- Playwright validation：`passed=true`，`failedCheckCount=0`。
- 成功 fixture：`flow-figma-064cffbb9f8efd85-fixture`。

## 覆盖能力

- UISpec 支持 `visibleWhen` 条件可见性。
- Preview Catalog 支持内部 `Conditional` wrapper。
- FlowPlan 支持 `stateInitialValue`。
- `CHANGE_TO` 可以从 Figma component/instance variant property 或 `Property=Value` component 名称推导状态值。
- 当 target variant 来自 component page 而不在 source page 时，apply 阶段会克隆 target subtree 到 source page，并用同一个 state 控制 source/target 显隐。

## 残留风险

- 非 button/link 的 Figma interaction 源节点仍可能被拒绝为 `ui_node_not_clickable`。
- Flow-M7 仍不新增 submit action kind；复杂业务状态机、真实后端和完整表单提交语义留给后续 M8/M9。
- 本验证没有调用 OpenAI，只覆盖 Figma REST restricted-live 到本地 Preview 行为验证链路。
