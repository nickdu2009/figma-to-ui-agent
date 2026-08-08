---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m11-multistep-execution-design",
  "scope": "project",
  "type": "architecture",
  "title": "Figma-to-UI Agent Flow-M11 多步骤业务 Flow 执行验证设计",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m11"
}
---

# Figma-to-UI Agent Flow-M11 多步骤业务 Flow 执行验证设计

## 1. 背景

Flow-M8 已完成本地表单提交、postcondition、select/radio、状态机和 RenderAndCompare 因果校验。Flow-M9 已完成 restricted-live interaction 抽取，证明真实 Figma 样本可读且能产出 interaction/submit-like 候选。Flow-M10 已完成真实语义补全与用户确认链路，合法 answer 可以转为 `user_confirmed submit`，summary-only 只能作为问题来源，不能作为 apply 成功依据。

Flow-M11 的目标是把这些能力推进到“多步骤业务 Flow 可执行验证”：从真实或受控可读取的 FlowPlan artifact 生成 behavior fixture，在 Preview 中执行 fill/select/radio/checkbox/click/submit，并验证页面、状态或 DOM postcondition。

## 2. 设计目标

- 建立真实可读取 FlowPlan artifact 的输入边界，禁止把 `ephemeral-flow-plan` 或 summary-only report 当作可执行载体。
- 将可信 FlowPlan interaction 编排为多步骤 behavior fixture。
- 支持输入、选择、切换、提交、状态切换、跨页面导航和 postcondition 验证。
- 用 Playwright 执行 fixture，并输出可解释的 execution report。
- 保持 fail-closed：证据不足、静态预满足、悬空引用、不可信来源和 scenario-only 均不能算 passed。
- 默认本地执行，不调用 Figma/OpenAI，不新增依赖，不改变四工具边界。

## 3. 非目标

- 不引入新的 Agent 工具。
- 不实现真实后端、登录、数据库、云队列或部署。
- 不把自然语言 scenario 当成可执行业务证明。
- 不追求未知 Figma 文件的全自动业务语义推断；不可信语义仍交给 M10 user confirmation。
- 不回退到整页截图 fallback。

## 4. 核心概念

### 4.1 FlowPlan Artifact

Flow-M11 只接受可读取、schema 校验通过、引用闭合的 FlowPlan artifact。artifact 可以来自：

- 本地受控 fixture。
- Flow-M9/M10 后续落盘的真实 FlowPlan。
- Project Store 中未来受管的 FlowPlan 当前版本。

以下输入只能用于 provenance 或 rejected/partial 诊断，不能直接执行：

- `flowPlanPath=ephemeral-flow-plan`。
- summary-only report。
- scenario-only 文本。
- 缺少目标 page/node/state/postcondition 的 interaction 摘要。

### 4.2 Behavior Fixture

Behavior fixture 是 Flow-M11 的执行产物，描述 Playwright 可以执行和验证的步骤。最小 step 集合：

- `fill`：向 input/textarea 写入值。
- `select_option`：选择 select 值。
- `choose_radio`：选择 radio。
- `toggle`：切换 checkbox/switch。
- `click`：点击按钮、链接或交互节点。
- `expect_page`：验证页面切换。
- `expect_visible`：验证成功提示、错误提示、弹窗或状态区可见。
- `expect_value`：验证输入值。
- `expect_checked`：验证 checkbox/switch/radio 选中状态。
- `expect_selected`：验证 select 当前值。

### 4.3 因果校验

Flow-M11 继承 Flow-M8 的因果边界：postcondition 必须由前置 action 触发，不能在执行前已经满足。Runner 应在关键 action 前采样 pre-state，在 action 后采样 post-state，并拒绝静态预满足的 expectation。

### 4.4 信任边界

可执行 interaction 只允许来源为：

- `figma` 且已由抽取器标记为可信。
- `user_confirmed` 且通过 M10 answer applier 写回。

以下来源必须 fail closed 或进入 partial：

- `inferred`。
- `missing`。
- `summary_only`。
- `scenario_only`。
- unsupported 强转。

## 5. 组件设计

### 5.1 FlowPlan Artifact Loader

职责：读取 FlowPlan artifact，执行 schema 校验、版本检查、引用闭合检查和来源检查。

输出：

- `loaded`：可用于 fixture 生成。
- `rejected`：不可执行，附原因码。
- `partial`：可生成问题或诊断，但不能执行完整路径。

关键原因码：

- `flow_plan_artifact_missing`。
- `flow_plan_artifact_unreadable`。
- `flow_plan_schema_invalid`。
- `flow_plan_reference_dangling`。
- `flow_plan_summary_only_carrier`。
- `flow_plan_untrusted_source`。

### 5.2 Fixture Planner

职责：把 FlowPlan 中可信 interaction 编排为执行路径。

输入：

- FlowPlan artifact。
- UISpec 页面和控件目录。
- 可选 user confirmation answer 结果。

输出：

- `behaviorFixtures[]`。
- `unresolvedInteractions[]`。
- `planningWarnings[]`。

规划规则：

- submit path 必须包含至少一个 action 和至少一个 postcondition。
- 表单路径优先按 DOM/control 引用生成 fill/select/radio/toggle，再执行 submit click。
- 跨页面 path 必须有明确目标 page 或 navigation postcondition。
- 状态机 path 必须有明确 transition、from/to state 和可观察 postcondition。
- 无法证明 selector 或 postcondition 的步骤不生成 passed fixture。

### 5.3 Flow Execution Runner

职责：复用 Preview/Playwright 执行 behavior fixture，输出机器可读和人工可读报告。

执行要求：

- 每个 fixture 单独隔离执行。
- console error 计入失败。
- pre-satisfied expectation 计入失败或 rejected。
- timeout、missing selector、不可点击、不可编辑都要有稳定原因码。
- 不把 skipped/unresolved 当作 passed。

### 5.4 Report Schema

Flow-M11 report 至少包含：

- `status`: `passed | partial | failed`。
- `artifactStatus`。
- `fixtureCount`、`successfulFixtureIds`、`failedFixtureIds`。
- `stepCount`、`failedCheckCount`。
- `preSatisfiedExpectationCount`。
- `untrustedSourceRejectionCount`。
- `summaryOnlyRejectionCount`。
- `samples[]`。
- `residualRisks[]`。
- `figmaRestCalled`、`openaiCalled`。

## 6. 数据流

```text
FlowPlan artifact
  -> Artifact Loader
  -> reference/source/postcondition validation
  -> Fixture Planner
  -> behavior fixture
  -> Preview + Playwright Runner
  -> execution report
  -> Worktrail validation
```

## 7. 验收标准

- AC1：可读取 FlowPlan artifact 才能进入执行；summary-only/ephemeral-flow-plan 不能执行。
- AC2：能生成包含 `fill + submit + postcondition` 的多步骤 fixture。
- AC3：能生成包含 `select_option`、`choose_radio` 或 `toggle` 的 fixture。
- AC4：能执行跨页面或状态变化路径，并验证 `expect_page` 或 `expect_visible`。
- AC5：静态 pre-satisfied expectation 必须失败或 rejected。
- AC6：悬空 page/node/state/postcondition、不可信来源、scenario-only 必须 fail closed。
- AC7：报告能稳定区分 passed、partial、failed，并列出 fixture/step 级失败原因。
- AC8：本地 unit/integration/e2e 回归通过。
- AC9：restricted-live 只在单独授权后运行；默认验证不调用 Figma/OpenAI。

## 8. 风险与缓解

- 风险：真实 Figma 样本没有可执行 business flow。缓解：Flow-M11 先以 artifact 载体和 execution runner 为目标，真实样本覆盖放入 gated validation。
- 风险：summary-only 被误当作执行证据。缓解：Artifact Loader 将 summary-only 固化为不可执行原因码。
- 风险：静态 DOM 已满足 postcondition 导致假阳性。缓解：强制 pre/post 采样和 pre-satisfied rejection。
- 风险：选择器不稳定。缓解：优先使用 UISpec/control id 和 Preview data attribute，而不是文本猜测。

## 9. 下一步

进入 Flow-M11 实施计划：先实现 artifact loader 与 report schema，再做 fixture planner，最后接入 Playwright runner 和本地/受限真实回归。
