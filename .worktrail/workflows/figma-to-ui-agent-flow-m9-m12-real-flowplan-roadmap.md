---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m9-m12-real-flowplan-roadmap",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M9 到 Flow-M12 真实 FlowPlan 能力路线",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-real-flowplan"
}
---

# Figma-to-UI Agent Flow-M9 到 Flow-M12 真实 FlowPlan 能力路线

## 1. 决策

当前先做 Flow 线，Product 线后置。

原因：Flow-M8 已证明本地 submit、postcondition、select/radio 和状态机能力可运行，但真正的不确定性仍在真实 Figma 文件：能否稳定抽取 interaction、能否把真实 prototype/variant/form 语义转为可信 FlowPlan、能否通过用户确认补齐业务含义、能否生成多步骤 Playwright 行为验证。

Product 线要等真实 Flow 能力打穿后再做，否则只是提前包装一个仍未充分验证的能力。

## 2. 总目标

把 Flow-M8 从“本地 fixture 证明能力存在”推进到“未知真实 Figma 文件也能抽取、补全、执行、验证业务 Flow”。

最终能力应满足：

- 从真实 Figma REST 数据中抽取 prototype interaction、component interaction、variant state change 和 submit-like 行为候选。
- 将可信 interaction 转为 `navigate`、`set_state`、`open_dialog`、`submit`、`stateMachine` 等 FlowPlan 语义。
- 证据不足时进入 user confirmation，不允许 `inferred` 或 `missing` 静默生成业务逻辑。
- 生成可执行 behavior fixture，覆盖 `fill`、`select_option`、`choose_radio`、`toggle`、`click`、`expect_page`、`expect_visible`、`expect_value`、`expect_checked`、`expect_selected`。
- 用本地 Preview/Playwright 输出 `passed`、`partial`、`failed` 报告。
- 在多个真实 Community 样本上形成可回归的 corpus。

## 3. Flow-M9：真实 Figma interaction 抽取

目标：证明 Flow 线可以从真实 Figma 文件读取并抽取可用 interaction，而不是只依赖本地 fixture。

范围：

- 选择 3 到 5 个真实 Community 样本，优先包含 login、checkout、settings、tabs、interactive component 或 variant switch。
- 使用 restricted-live Figma-only gate，不调用 OpenAI。
- 从 Figma REST nodes/prototype/interactions 中抽取：
  - click navigate
  - CHANGE_TO / variant state change
  - open overlay/dialog-like interaction
  - submit-like button 候选
- 输出抽取报告，区分 `trusted`、`needs_confirmation`、`unsupported`、`missing_evidence`。

验收：

- 至少 3 个真实样本完成只读抽取。
- 至少 1 个样本包含可验证 `navigate`。
- 至少 1 个样本包含可验证 `set_state` 或 variant transition。
- 至少 1 个样本包含 submit-like 候选并进入 confirmation，而不是自动编业务逻辑。
- 不调用 OpenAI，不新增依赖，不改变四工具边界。

## 4. Flow-M10：真实语义补全与用户确认

目标：把真实抽取结果转成可审计 FlowPlan，明确什么能自动转换，什么必须用户确认。

范围：

- 扩展 confirmation question，使真实 submit-like、表单成功态、错误态、状态机 transition 可以被用户补全。
- 对 `figma` / `user_confirmed` interaction 才允许生成业务行为。
- 对 `inferred` / `missing` / scenario-only / 不可信来源保持 rejected、unresolved 或 partial。
- 对 postcondition、page、node、state、dialog、transition 引用做 fail-closed 校验。
- 输出补全报告，记录确认来源、问题 id、答案、转换结果和拒绝原因。

验收：

- 真实样本中的 submit-like 候选可生成 confirmation question。
- 合法用户确认可转为 `user_confirmed submit` 或 `stateMachine transition`。
- 缺 postcondition、悬空引用、类型不兼容答案必须拒绝。
- 不允许 scenario-only 作为 passed 依据。
- Flow-M8 本地测试和 Flow-M9 restricted-live 抽取回归继续通过。

## 5. Flow-M11：多步骤业务 Flow 执行验证

目标：让真实 FlowPlan 可以生成并执行多步骤业务路径，而不是单点点击验证。

范围：

- 基于真实 FlowPlan 生成多步骤 behavior fixture：填写表单、选择 select/radio、切换 checkbox/switch、点击 submit、验证页面或状态变化。
- 支持跨页面 flow path：例如登录页到 dashboard、checkout 表单到确认页、settings 修改到保存提示。
- RenderAndCompare 继续做 submit 前后因果校验，防止静态 pre-satisfied expectation 被当作成功。
- 输出 Flow execution report，包括 successfulFixtureIds、failedFixtureIds、failedCheckCount、partial reasons。

验收：

- 至少 2 个真实样本完成多步骤 Flow 执行。
- 至少 1 条路径包含 fill + submit + postcondition。
- 至少 1 条路径包含 select/radio/checkbox 类输入。
- 负例覆盖静态 pre-satisfied expectation、悬空 postcondition、不可信来源和 scenario-only。
- 本地 unit/integration/e2e 回归通过。

## 6. Flow-M12：真实样本矩阵与稳定化

目标：把真实 Flow 能力收口为可持续回归的能力矩阵。

范围：

- 建立真实 Community 样本 corpus，记录样本类型、Figma URL、node id、可用 interaction 类型、授权 gate、失败分类和期望结果。
- 对 Flow-M9 到 Flow-M11 的样本建立 regression runner。
- 稳定错误分类：permission、rate limit、missing prototype、unsupported interaction、unverifiable postcondition、ambiguous business semantics。
- 固化报告格式和手动确认流程，便于后续 Product 线包装。

验收：

- 至少 5 个真实样本进入 corpus。
- 每个样本都有 passed/partial/failed 的可解释报告。
- Flow 能力矩阵覆盖 navigate、set_state、submit、stateMachine、select/radio/checkbox。
- 失败样本也必须有稳定分类和下一步建议。
- 完成后再进入 Product-M9。

## 7. Product 线后置条件

只有满足以下条件后再重启 Product 线：

- Flow-M9 证明真实 Figma interaction 可抽取。
- Flow-M10 证明真实语义补全和用户确认链路可用。
- Flow-M11 证明多步骤业务 Flow 可执行验证。

到此再设计 Product-M9：面向 PI / mono coding agent 的稳定入口、JSON result、错误分类、artifact refs、手动测试和安装说明。

## 8. 当前立即下一步

立即下一步是设计并实施 Flow-M9 restricted-live interaction extraction：先选样本、定义只读 gate、扩展抽取报告，再跑 3 到 5 个真实样本，验证真实 interaction 抽取能力。
