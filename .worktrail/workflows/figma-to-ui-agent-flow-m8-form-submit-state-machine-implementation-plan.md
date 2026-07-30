---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m8-form-submit-state-machine-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M8 表单提交与状态机实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m8"
}
---

# Figma-to-UI Agent Flow-M8 表单提交与状态机实施计划

## 1. 目的

本计划指导 coding agent 在 Flow-M7 之后实施 `Flow-M8 form_submit_state_machine`：补齐显式 submit action、select/radio 行为语义、用户确认补全和本地多步 UI 状态机，并用本地 Preview/Playwright 生成可审计证据。

本计划不是 Product-M8/Product-M9，也不替代视觉保真或 Figma coverage engine。它只推进 FlowPlan 到 UISpec 的行为表达能力。

## 2. 当前事实

- Flow-M7 restricted-live r4 已通过，证明真实 Figma `CHANGE_TO` interaction 可转换为 UISpec `set_state` 并完成本地 DOM 点击验证。
- Flow-M7 残留风险明确包含 submit-like 表单提交、checkout/login 等业务动作。
- 当前 `FlowPlan` 支持 `trigger="submit"`，但 `intent` 尚不支持 `submit`。
- 当前 `UISpec.actions` 只有 `navigate`、`set_state`、`open_dialog`。
- 当前 Preview dispatch 只处理 `navigate`、`set_state`、`open_dialog`。
- 当前 behavior fixture 已有 `expect_value` / `expect_checked`，但没有 `select_option`、`choose_radio`、`expect_selected`。

## 3. 范围

### In Scope

- 扩展 FlowPlan schema：`intent="submit"`、submit postcondition、可选本地状态机结构。
- 扩展 UISpec schema：`action.kind="submit"`、submit effect、postconditions。
- 扩展 behavior step：`select_option`、`choose_radio`、`expect_selected`。
- 扩展 Preview dispatch：submit 只执行本地 effect，不做网络请求。
- 扩展 RenderAndCompare：选择控件执行、selected 断言、submit 前后因果校验。
- 扩展 confirmation question / apply confirmations：让用户确认补齐 submit/state machine 所需字段。
- 新增 Flow-M8 planner、report、local runner、fixtures、unit/integration/e2e targeted tests。
- 创建 Flow-M8 validation Worktrail candidate。

### Out of Scope

- 不调用真实 OpenAI。
- 不默认调用 Figma live 或 restricted-live。
- 不新增依赖。
- 不改变 Pi 四工具边界。
- 不实现真实后端、登录、支付、报价、订单或数据库。
- 不执行 Git commit/push，除非用户单独授权。
- 不把 scenario-only 作为 passed 依据。

## 4. 并行性

[parallelism:
- independent lanes: schema/report 草案、fixture 设计、验证器测试用例可先并行阅读；实际代码落地需要串行
- sequential blockers: T01 schema 必须先于 planner、Preview dispatch 和 validation；T04 validation 必须先于 T06 runner passed 判定
- shared write surfaces: `src/flow-plan/*`、`src/ui-spec/schema.ts`、`src/validation/render-and-compare.ts`、`preview/src/preview-app.tsx`、`tests/*`、`scripts/*`
- delegation: 0，Flow-M8 涉及公共契约和多处共享行为，首版应单 agent 串行实施以减少契约漂移
]

## 5. 验收标准

- AC1：FlowPlan schema 支持 `intent="submit"`，且旧 Flow-M6/Flow-M7 fixtures 仍能解析。
- AC2：UISpec schema 支持 `action.kind="submit"`，submit action 必须包含本地 effect 或 postcondition，不能无效果通过。
- AC3：Preview dispatch 支持 submit 的本地 effect：set_state、open_dialog、navigate、none；不发网络请求。
- AC4：behavior fixture 支持并验证 `select_option`、`choose_radio`、`expect_selected`。
- AC5：submit fixture 必须证明点击后的 postcondition；点击前已满足且点击后无变化的静态 expect 不能算 submit verified。
- AC6：用户确认答案可把 eligible `inferred` / `missing` interaction 转成 `user_confirmed`，但缺字段、悬空引用、无 postcondition 时必须 rejected。
- AC7：本地状态机至少覆盖两次 transition，且每个 transition 有 Playwright 可验证 postcondition。
- AC8：`inferred`、`missing`、scenario-only、不可信来源不得生成 submit action 或 state machine transition。
- AC9：Flow-M6 route-only 和 Flow-M7 restricted-live/local 回归测试继续通过。
- AC10：默认验证链路不调用 OpenAI/Figma，不新增依赖，不改四工具边界。

## 6. 实施步骤

### T00：Gate 和基线确认

操作：

1. 运行 `worktrail context --semantic=auto "Flow-M8 form submit state machine implementation"`。
2. 记录 `git status --short --branch`，确认 staged、unstaged、untracked。
3. 读取 Flow-M7 架构、计划和 restricted-live validation。
4. 读取当前契约文件：`src/flow-plan/schema.ts`、`src/ui-spec/schema.ts`、`src/flow-plan/to-ui-spec.ts`、`src/validation/render-and-compare.ts`、`preview/src/preview-app.tsx`。
5. 确认本阶段无外部调用、无依赖变更、无 Git lifecycle。

验证：

- 输出 scope、禁止事项、允许修改文件列表。
- 不修改文件。

### T01：扩展 FlowPlan / UISpec schema

落点：

- `src/flow-plan/schema.ts`
- `src/flow-plan/draft.ts` 如仍需兼容旧入口
- `src/ui-spec/schema.ts`
- `tests/unit/flow-plan-schema.test.ts`
- `tests/unit/ui-spec-schema.test.ts`

操作：

1. `flowIntentSchema` 增加 `submit`。
2. 新增 postcondition schema，覆盖 page、visible、text、value、checked、selected。
3. 在 interaction 中新增 submit 所需字段，例如 `postconditions` 和可选 `stateMachineTransitionId`。
4. 在 UISpec action union 中新增 `submit` action。
5. 在 behavior step union 中新增 `select_option`、`choose_radio`、`expect_selected`。
6. 增加 superRefine：submit action 必须有 postcondition；effect 引用必须闭合；selected step 目标必须是 select/radio。

验证：

- unit：旧 action/step 兼容。
- unit：合法 submit 通过。
- unit：无 postcondition submit 被拒绝。
- unit：悬空引用被拒绝。
- unit：select/radio step 目标错误被拒绝。

### T02：扩展用户确认模型

落点：

- `src/flow-plan/confirmation-questions.ts`
- `src/flow-plan/apply-confirmations.ts`
- `tests/unit/flow-plan-confirmations.test.ts`

操作：

1. 对缺少 submit/postcondition 的 inferred/missing interaction 生成问题。
2. 问题选项必须要求用户指定动作类型和可观察结果。
3. `applyConfirmations` 写回 `user_confirmed` 时必须校验 page/node/state/dialog/postcondition 引用。
4. 无法匹配或字段不完整的答案保持 `invalid` / `unmatched`，不得转换。
5. 记录确认来源和 reason，便于报告审计。

验证：

- unit：missing submit 生成问题。
- unit：合法答案转换为 `user_confirmed`。
- unit：缺 postcondition 答案被拒绝。
- unit：悬空 node/page/dialog/state 答案被拒绝。

### T03：实现 Flow-M8 planner 和 report

落点：

- `src/flow-plan/m8-planner.ts`
- `src/flow-plan/m8-report.ts`
- `src/flow-plan/index.ts` 如已有导出模式需要
- `tests/unit/flow-plan-m8-planner.test.ts`
- `tests/unit/flow-plan-m8-report.test.ts`

操作：

1. 接收 UISpec、FlowPlan、可选 scenario。
2. 只转换 `source=figma | user_confirmed` 且 `confirmed=true` 的 submit/state machine interaction。
3. 对 `navigate`、`set_state`、`open_dialog` 继续复用现有逻辑，不回退 Flow-M7 能力。
4. 对 submit 生成 `action.kind="submit"` 和 behavior fixture。
5. 对 state machine 生成 transitions、状态项和对应 fixture。
6. 输出 report：converted、rejected、unresolved、submitVerified、userConfirmedConverted、selectRadioAssertions、stateMachineTransitions。
7. `passed` 条件必须满足 AC5/AC7/AC8，不允许 scenario-only。

验证：

- unit：trusted submit 转换。
- unit：user_confirmed submit 转换。
- unit：inferred submit rejected。
- unit：scenario-only partial。
- unit：两步状态机 passed。
- unit：无 postcondition failed。

### T04：扩展 Preview submit dispatch

落点：

- `preview/src/preview-app.tsx`
- `preview/src/catalog-registry.tsx` 如 action binding mock 需要
- `tests/e2e/preview-flow-m8-submit.spec.ts`

操作：

1. dispatch 识别 `action.kind="submit"`。
2. effect `set_state` 写入 state store。
3. effect `open_dialog` 打开 dialog state。
4. effect `navigate` 调用 `onNavigate`。
5. effect `none` 不改变状态，但允许 native validation 或 postcondition 外部由 fixture 验证。
6. 不发起 fetch/XHR，不引入后台调用。

验证：

- e2e：submit -> set_state -> text/visible 改变。
- e2e：submit -> open_dialog。
- e2e：submit -> navigate。
- e2e：submit none 不报 console error，仍需 fixture postcondition 才可 passed。

### T05：扩展 RenderAndCompare 行为执行器

落点：

- `src/validation/render-and-compare.ts`
- `tests/integration/render-and-compare-flow-m8-behavior.test.ts`

操作：

1. `select_option` 使用 Playwright `selectOption`，目标可为 select 或包含 select 的 `data-ui-node-id` 容器。
2. `choose_radio` 使用原生 radio check/click，支持 nodeId 指向 radio 容器或 input。
3. `expect_selected` 读取 select value 或 radio checked/value。
4. submit click 前采样 postcondition，click 后重新采样；若无变化且不是明确允许的 page/dialog/state transition，submit 不计为 verified。
5. 输出失败检查时给出 step kind、node id、expected/actual 脱敏摘要。

验证：

- integration：select option 正例/负例。
- integration：radio choose 正例/负例。
- integration：expect_selected 正例/负例。
- integration：submit 静态 pre-satisfied expect 被拒绝。
- integration：submit post-click visible/text/value/checked/page 通过。

### T06：新增本地 fixtures 和 runner

落点：

- `tests/fixtures/flow-plan/m8-form-submit-state-machine/`
- `scripts/run-flow-m8-local.mjs`
- `tests/integration/flow-plan-m8-local-runner.test.ts`

操作：

1. 建立本地 UISpec fixture：login/register/checkout 类最小页面，包含 input、select、radio、checkbox/switch、submit button、状态文本、dialog、第二页面。
2. 建立 FlowPlan fixture：包含 trusted submit、user_confirmed submit、inferred negative、missing negative、两步 state machine。
3. 建立 scenario fixture：只提供输入值和控件选择，不提供业务真相。
4. runner 写入 `data/projects/<projectId>/runs/<runId>/flow-m8-report.json`，默认可在测试临时目录执行。
5. 失败关闭：schema/validation 失败不覆盖现有 `current.json`。

验证：

- integration：runner passed。
- integration：runner partial scenario-only。
- integration：runner failed invalid submit。
- integration：fail-closed 不覆盖 current。

### T07：回归验证

本地默认命令：

```bash
npm run typecheck
npm run test:unit
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e
```

Flow 回归重点：

- Flow-M6 route-only 测试继续通过。
- Flow-M7 local/restricted-live 相关本地测试继续通过。
- Preview 三栏交互、keyboard、console validation 不回退。
- Pi 四工具边界不变。

### T08：Worktrail validation 收口

操作：

1. 创建 Flow-M8 validation pending candidate，记录：
   - 实施范围。
   - 本地命令和结果。
   - report 路径。
   - 是否有外部调用。
   - 残留风险。
2. 运行 `worktrail review plan --format json`。
3. 等待用户确认 promote/discard。

验证：

- Worktrail review plan 能看到 Flow-M8 validation candidate。
- 不自动 promote。
- 不自动 commit/push。

## 7. 授权边界

需要单独确认的动作：

- 任何 OpenAI 调用。
- 任何 Figma live/restricted-live 调用。
- 新增依赖、修改 package lock、下载浏览器。
- Git commit、push、branch、tag。
- 修改 Pi 四工具边界。
- 将 pending candidate promote/discard/merge。

默认允许的动作：

- 读取本地代码和 Worktrail 当前知识。
- 按本计划做本地代码修改。
- 运行不访问外部服务的本地 typecheck/unit/integration/e2e。
- 创建 Worktrail validation pending candidate。

## 8. 回滚策略

- 所有公共 schema 增量必须保持向后兼容；若验证失败，优先回滚新增 Flow-M8 分支，不修改 Flow-M6/Flow-M7 旧语义。
- Preview submit dispatch 独立在 `submit` 分支中处理，回滚时不影响 `navigate`、`set_state`、`open_dialog`。
- RenderAndCompare 新 step 独立分支处理，回滚时不影响现有 `click/fill/toggle/expect_*`。
- runner 输出写入 run 目录；失败不得覆盖有效 `current.json`。
- Worktrail validation 只创建 pending candidate，错误候选通过 review discard 处理。

## 9. 完成定义

Flow-M8 实现完成必须同时满足：

1. AC1-AC10 全部有当前命令或文件证据。
2. 本地 Flow-M8 runner 产生 passed report。
3. scenario-only / untrusted / no-postcondition 负例失败或 partial。
4. Flow-M6/Flow-M7 回归通过。
5. Worktrail validation candidate 已创建并可 review。
6. 无外部调用、无依赖变更、无四工具边界变更，除非另有明确授权和证据。
