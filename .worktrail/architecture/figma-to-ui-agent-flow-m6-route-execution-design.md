---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m6-route-execution-design",
  "scope": "project",
  "type": "architecture",
  "title": "Figma-to-UI Agent Flow-M6 路由与 Flow 执行验证设计",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m6-route-execution"
}
---

# Figma-to-UI Agent Flow-M6 路由与 Flow 执行验证设计

## 1. 背景

Product-M8 已完成 PI / coding agent 使用闭环。Post-M7 Roadmap 将后续工作拆成两条线：`Product-M*` 面向产品化使用，`Flow-M*` 面向 FlowPlan、路由、用户确认、状态、表单和业务交互。

Flow-M6 是 FlowPlan 线的下一阶段，目标是验证用户确认后的页面跳转可以从 FlowPlan 进入 UISpec，并在 Preview 中通过 Playwright 点击路径证明执行成功。

Flow-M6 不重新解决视觉保真问题，也不扩大到 Flow-M7 的状态、表单、submit 或业务状态机。

## 2. 上游约束

- FlowPlan 结论要求正式 M6 支持 route 生成、button navigate、behavior fixture 中验证页面流转、Playwright 执行点击路径。
- Post-M7 Roadmap 要求 Flow-M6 和 Flow-M7 分离，Flow-M6 只覆盖路由与 Flow 执行验证。
- Milestone Naming Rule 要求后续计划、验证和提交信息使用 `Flow-M*`，不得裸用 `M6/M7` 造成与 Generator Fidelity 或 Product 线混淆。
- M5 静态生成验收明确：M5 不代表 M6 完成，M6 应单独处理 route、navigate action、behavior fixture 和点击路径验证。
- 四工具边界保持不变：不得新增、删除或重命名模型可见工具。
- 外部服务保持 gate：Flow-M6 默认只使用本地 fixture，不调用 Figma 或 OpenAI live path。

## 3. 目标

Flow-M6 要证明以下链路成立：

```text
FlowPlan confirmed navigate interaction
  -> UISpec page route / navigate action
  -> Preview dispatch navigate
  -> Playwright behavior fixture click + expect_page
  -> Flow-M6 validation report
```

成功后，coding agent 可以把可信页面跳转作为可验证行为处理，而不是只生成静态多页面 UI。

## 4. 非目标

Flow-M6 明确不做：

- 不新增 UISpec action kind。
- 不新增模型可见工具。
- 不修改 OpenAI / Figma live 授权策略。
- 不处理 input、checkbox、submit、set_state、open_dialog 的正式验收；这些归入 Flow-M7 或后续阶段。
- 不把 inferred 或 missing interaction 静默转换为业务行为。
- 不追求新的视觉 diff 阈值优化。
- 不引入新 npm 依赖。

## 5. 设计边界

### 5.1 行为边界

Flow-M6 只验收 `navigate`：

- 可信来源：`source = figma` 且 `confirmed = true`，或 `source = user_confirmed` 且 `confirmed = true`。
- 必要字段：`uiNodeId`、`fromPageId`、`targetPageId`。
- 允许的 UI 节点：`button` 或 `link`。
- 目标页面必须存在于同一 UISpec 的 `pages[]`。
- `inferred`、`missing`、缺少 target、不可点击节点、悬空页面引用都必须进入 unresolved。

### 5.2 UISpec 映射

Flow-M6 复用现有 UISpec 能力：

- `pages[].path` 表示站内路由路径。
- `actions[]` 使用 `kind: "navigate"` 和 `pageId`。
- `button` / `link` 节点通过 `actionId` 绑定行为。
- `behaviorFixtures[]` 使用 `click` 和 `expect_page` 验证页面跳转。
- `sourceFlowPlanRevision` 用于追溯生成行为的 FlowPlan revision。

Flow-M6 不应在 UISpec 中写入 Figma provenance、报告字段或临时诊断字段。

### 5.3 Preview 执行

Preview 继续通过 JSON Render adapter 将 `actionId` 绑定为 `dispatch`。Preview app 接收到 `navigate` action 后更新 active page，并同步 URL `pageId` 查询参数。

Flow-M6 不新增前端路由框架。当前 Preview 的内存页切换足以证明本地 Flow 执行。

### 5.4 验证执行

RenderAndCompare 继续作为本地验证入口。Flow-M6 只要求行为 fixture 的 functional checks 证明：

- click step 成功定位并点击源节点；
- expect_page step 观察到 `.implementation-canvas[data-page-id]` 已切换到目标页；
- 失败时报告 fixture id、step kind 和失败原因，不覆盖旧 UISpec。

视觉 diff 在 Flow-M6 中是辅助诊断，不是主验收目标。

## 6. 报告模型

Flow-M6 应有独立报告，避免复用 M4 报告后误报里程碑完成。

建议报告字段：

- `schemaVersion`：`"1"`。
- `milestone`：`"Flow-M6"`。
- `scope`：`"route_execution_only"`。
- `status`：`passed | partial | failed`。
- `projectId`、`runId`。
- `sourceDesignBundleRevision`、`sourceUISpecRevision`、`sourceFlowPlanRevision`、`savedUISpecRevision`。
- `routeCount`、`navigateActionCount`、`behaviorFixtureCount`。
- `convertedNavigateActionIds`。
- `behaviorFixtureIds`。
- `unresolvedInteractions`。
- `validation`：RenderAndCompare 输出摘要或失败分类。
- `residualRisks`：明确不覆盖 Flow-M7 状态/表单/业务逻辑。

报告必须脱敏：不得写入 Figma file key、token、原始 URL、远端资产 URL、raw Figma payload 或助手正文。

## 7. 成功状态

Flow-M6 完成需要同时满足：

- 有至少两页 UISpec。
- 至少一个可信 navigate interaction 被转换成 UISpec navigate action。
- 对应 button/link 带有 `actionId`。
- 至少一个 behavior fixture 包含 `click` + `expect_page`。
- Playwright functional checks 全部通过。
- 报告 `milestone = Flow-M6` 且 `scope = route_execution_only`。
- 报告列出未转换 interactions，不把未确认行为当成功。
- 本地验证命令可重复运行。

## 8. 失败与降级

- 无 UISpec：`partial`，原因写入 `insufficientReason`，不得创建伪 UISpec。
- 单页或无目标页：`partial`，不得构造假 route。
- 无可信 navigate interaction：`partial`，输出 confirmation questions 或 unresolved。
- 可信 interaction 指向不可点击节点：`partial`，blockedReason 为 `ui_node_not_clickable`。
- 目标页不存在：`partial`，blockedReason 为 `target_page_missing`。
- Playwright fixture 失败：`failed`，保存 validation record 和报告，不覆盖旧 current UISpec。
- Schema 校验失败：fail closed，保留上一份有效 artifact。

## 9. 安全与运维

- 默认 local-only，不访问外部服务。
- restricted-live 或 live Figma 输入如果未来加入，必须使用独立 gate，不由 Flow-M6 默认触发。
- 不修改 `EXACT_TOOL_NAMES`。
- 不将报告写入正式 Worktrail knowledge；正式结论通过 validation candidate 落入 Worktrail review。
- 运行报告进入 `reports/flow-m6-route-execution/`，是否提交由后续 Git scope 单独决定。

## 10. Repository Reality

当前仓库已有可复用基础：

- `src/flow-plan/schema.ts`：正式 FlowPlan Schema。
- `src/flow-plan/to-ui-spec.ts`：可信 interaction 转 UISpec action/behavior fixture。
- `src/ui-spec/schema.ts`：`pages[].path`、`navigate` action、behavior fixtures。
- `preview/src/preview-app.tsx`：Preview dispatch navigate。
- `src/validation/render-and-compare.ts`：执行 `click`、`expect_page` 等 fixture step。
- `tests/integration/flow-plan/m4-flowplan.test.ts`：M4 runner 已证明底层链路可行。

Flow-M6 仍需独立 runner、独立报告 schema、独立 fixture/validation record，避免把 M4 证据当作 Flow-M6 验收。

## 11. 残留假设

- 【假设】Flow-M6 第一版只验收 navigate，不正式验收 open_dialog 和 set_state。验证方法：Flow-M6 runner/report 中 `scope = route_execution_only`，测试断言非 navigate intent 不计入成功。
- 【假设】Preview 的内存页切换足以作为本地 Flow 执行验证。验证方法：Playwright `expect_page` 使用 `.implementation-canvas[data-page-id]` 断言 active page。
- 【假设】M4 已完成的 FlowPlan Schema 和 ProjectStore 能力足以支撑 Flow-M6。验证方法：Flow-M6 integration test 从 ProjectStore 读取真实 DesignBundle、UISpec、FlowPlan 并生成报告。

## 12. 下一步

创建 Flow-M6 实施计划，按独立 runner/report/fixture/validation record 执行。实施前需再次确认：不调用外部服务、不新增依赖、不执行 Git lifecycle，除非用户另行授权。
