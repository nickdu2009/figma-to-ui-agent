---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-milestone-naming-rule",
  "scope": "project",
  "type": "rule",
  "title": "Figma-to-UI Agent Milestone Naming Rule",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-milestone-naming"
}
---

# Figma-to-UI Agent Milestone Naming Rule

## 1. 规则结论

后续计划、验证、提交信息和沟通中，不应裸用 `M8`、`M9`、`M10` 或继续复用未限定的 `M7`。必须明确使用里程碑线前缀：

- `Product-M*`：产品化、CLI、PI / mono coding agent 使用闭环、报告、运行稳定性。
- `Flow-M*`：FlowPlan、InteractionPlan、路由、用户确认、状态、表单和业务交互。

## 2. 为什么需要校准

早期 FlowPlan 文档中的 `正式 M7` 指“状态、表单与简单业务交互”。近期完成的 M7 指“端到端产品化主流程”。两者不是同一条线，如果继续裸用 `M7/M8`，会导致计划、验收、Worktrail candidate 和 commit 语义混淆。

## 3. 当前命名映射

### Product 线

- `Product-M7`：端到端产品化主流程，已完成。
- `Product-M8`：PI / mono coding agent 使用闭环。

### Flow 线

- `Flow-M4`：FlowPlan 契约。
- `Flow-M5`：多 artboard 静态生成与逐页验证。
- `Flow-M6`：路由与 Flow 执行验证。
- `Flow-M7`：状态、表单与简单业务交互。

## 4. 使用要求

从本规则生效后：

- 新的 Worktrail architecture/workflow/validation 文档标题必须使用 `Product-M*` 或 `Flow-M*` 前缀。
- 新的候选 ID、target path 和 topic 应体现对应里程碑线。
- commit message 涉及里程碑时应使用 `Product-M*` 或 `Flow-M*`。
- 若引用旧文档中的 `M4/M5/M6/M7`，必须说明它属于早期 FlowPlan 线，或映射为 `Flow-M*`。
- 不得把 Product-M8 的 PI/coding agent 使用闭环与 Flow-M6/Flow-M7 的业务交互验收混在一个验收项里。

## 5. 例子

推荐：

```text
Product-M8 PI agent usage loop design
Flow-M6 route and behavior fixture validation
Product-M7 restricted-live smoke addendum
```

不推荐：

```text
M8 design
M7 state support
next milestone
```

## 6. 当前立即影响

Post-M7 roadmap 后续执行应按以下顺序称呼：

1. `Product-M7` 收尾：smoke addendum 与报告目录策略。
2. 里程碑编号校准：本规则。
3. `Product-M8` 设计。
4. `Product-M8` 实施。
5. 回到 `Flow-M6` / `Flow-M7`。
