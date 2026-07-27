---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-post-m7-roadmap",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Post-M7 Roadmap",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-post-m7-roadmap"
}
---

# Figma-to-UI Agent Post-M7 Roadmap

## 1. 背景

当前项目已经完成 Product-M7 本地产品化主流程，并补充执行了 restricted-live Figma-only smoke test。早期 FlowPlan 文档中的 M7 指“状态、表单与简单业务交互”，而近期完成的 M7 指“端到端产品化主流程”。两条线继续共用 M 编号会造成计划、验收和沟通混乱。

因此，后续安排拆分为两条里程碑线：

- `Product-M*`：面向产品化、PI / coding agent 使用闭环、CLI、报告和运行稳定性。
- `Flow-M*`：面向 FlowPlan、路由、用户确认、状态、表单和业务交互。

## 2. 下一步顺序

推荐按以下顺序推进。

### Step 1：Product-M7 收尾

目标：补齐刚完成的 restricted-live Figma-only smoke test 证据，并处理本地报告生成物。

交付：

- 创建 M7 validation addendum，记录 restricted-live smoke test：
  - `ok=true`
  - `pages=3`
  - `warnings=0`
  - `unsupported=0`
  - mode 为 `restricted-live`
  - 只授权 Figma gate，未授权 OpenAI gate
- 明确 `reports/m7-e2e/` 的处理策略：默认不提交，只作为本地运行报告或后续清理对象。
- 如需长期留证，以 Worktrail validation addendum 为正式知识入口，不把临时报告目录作为主要知识来源。

验收：

- Worktrail 中存在被 review/promote 的 M7 smoke addendum。
- Git 状态中不混入未选择的报告目录。

### Step 2：里程碑编号校准

目标：避免早期 FlowPlan M 编号与 Product-M7/Product-M8 混淆。

建议命名：

- `Product-M7`：端到端产品化主流程，已完成。
- `Product-M8`：PI / mono coding agent 使用闭环。
- `Flow-M4`：FlowPlan 契约。
- `Flow-M5`：多 artboard 静态生成与逐页验证。
- `Flow-M6`：路由与 Flow 执行验证。
- `Flow-M7`：状态、表单与简单业务交互。

交付：

- 创建或更新 Worktrail 中的里程碑命名说明。
- 后续计划、验证报告和提交信息统一使用 `Product-*` 或 `Flow-*` 前缀。

验收：

- 新计划不再裸用 `M8` 表达未限定的方向。
- 任何引用早期 FlowPlan M7 的内容都明确其属于 `Flow-M7`。

### Step 3：Product-M8 设计

目标：让 PI / mono coding agent 能稳定使用 Figma-to-UI Agent，而不是依赖人工理解内部实现。

Product-M8 应解决：

- 单命令输入 Figma URL 或 `fileKey + nodeId`。
- 返回稳定 JSON result。
- 输出可读 summary 报告。
- 错误分类稳定、可恢复建议明确。
- agent 可以根据 `ok`、`error.category`、`nextAction` 和 artifact refs 决定下一步。
- 提供手动测试文档和安装使用说明。
- 明确 local、restricted-live、live 三种 mode 的 gate 和安全边界。

不做：

- 不追求新的视觉 diff 优化。
- 不扩大到复杂 Flow 状态和业务逻辑。
- 不默认调用 OpenAI live path。
- 不引入新依赖，除非单独设计和授权。

建议交付：

- Product-M8 设计文档。
- Product-M8 实施计划。
- PI / mono coding agent 使用说明。
- CLI JSON contract examples。
- 手动测试流程。
- 最小 smoke/corpus regression 验收记录。

验收：

- PI / mono coding agent 可以在不阅读源码的情况下完成一次本地或 restricted-live 调用。
- 失败场景至少覆盖 invalid input、missing auth gate、Figma 429、Figma permission/not found。
- 成功场景至少覆盖 local mode 和 restricted-live Figma-only smoke。

### Step 4：回到 Flow-M6 / Flow-M7

目标：在 Product-M8 使用闭环稳定后，再推进业务 Flow 能力。

Flow-M6：路由与 Flow 执行验证。

- route 生成。
- button navigate。
- behavior fixture 验证页面流转。
- Playwright 执行点击路径。

Flow-M7：状态、表单与简单业务交互。

- input。
- checkbox。
- submit。
- set_state。
- 简单表单路径。
- 用户确认后的业务状态切换。

验收：

- 只把 `figma` 或 `user_confirmed` interaction 转换为行为。
- `inferred` 和 `missing` interaction 必须进入确认问题或报告，不得静默生成业务逻辑。
- 每个行为能力都有 behavior fixture 和 Playwright 证据。

## 3. 当前推荐的立即行动

立即行动顺序：

1. 创建 Product-M7 smoke validation addendum。
2. 创建里程碑编号校准文档。
3. 设计 Product-M8。
4. 评审并 promote Product-M8 设计与实施计划。
5. 开始 Product-M8 实现。

## 4. 决策原则

- 先产品化使用闭环，再扩展业务 Flow。
- 先清楚命名，再继续追加 M 阶段。
- Worktrail 是正式知识入口；本地报告目录只作为运行证据，不作为长期计划来源。
- 任何 live 或外部服务调用都需要显式 gate。
- 不把 FlowPlan 能力和产品化 CLI 能力混在一个验收项里。
