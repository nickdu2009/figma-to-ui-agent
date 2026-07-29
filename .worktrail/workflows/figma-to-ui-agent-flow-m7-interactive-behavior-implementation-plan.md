---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m7-interactive-behavior-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M7 状态、表单与简单业务交互执行计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m7"
}
---

# Figma-to-UI Agent Flow-M7 状态、表单与简单业务交互执行计划

## 1. 目的

本计划指导 coding agent 实施 `Flow-M7 interactive_behavior`：在已完成的 Flow-M6 `route_execution_only` 之后，正式覆盖可信 `set_state`、`open_dialog`、表单填写、checkbox/switch 切换和 submit-like 行为路径，并用本地 Preview/Playwright 生成可审计证据。

本计划是 Flow-M7 执行计划，不是 Product-M7，也不替代 Generator Fidelity、Figma coverage engine 或产品化 agent usage loop。

## 2. 本次修订结论

上一版计划有三个验收缺口，本版修订为硬约束：

1. `passed` 不能由 scenario-only fixture 满足；必须至少有一个可信非 navigate FlowPlan interaction 被转换成 UISpec action，并通过行为验证。
2. `fill` / `toggle` 不能只执行不断言；必须支持并使用 `expect_value` / `expect_checked`，或验证由填写/切换导致的可观察后置状态。
3. submit-like 路径不能用点击前已经存在的静态元素冒充成功；必须点击一个可信 converted action 绑定的按钮或链接，并证明点击后的页面、可见性、文本、value 或 checked 状态发生可观察变化。

## 3. 上游与当前代码事实

- Flow-M6 已明确为 navigate-only；M7 不得回改 M6 的里程碑定义。
- `src/ui-spec/schema.ts` 当前 action 已有 `navigate`、`set_state`、`open_dialog`。
- `src/ui-spec/schema.ts` 当前 behavior fixture step 已有 `click`、`fill`、`toggle`、`expect_visible`、`expect_text`、`expect_page`。
- `src/validation/render-and-compare.ts` 当前会执行 `fill` / `toggle`，但还缺少 `expect_value` / `expect_checked` 断言。
- `src/flow-plan/to-ui-spec.ts` 当前已能处理 `set_state` / `open_dialog`，但 M7 需要独立报告、计数、fixture 和完成状态，不能复用 M4/M6 plumbing 作为完成证明。
- `preview/src/preview-app.tsx` 当前已 dispatch `navigate`、`set_state`、`open_dialog`。

## 4. 范围

### In Scope

- 新增 Flow-M7 report schema 和本地运行记录。
- 新增 Flow-M7 behavior scenario schema。
- 扩展 UISpec behavior fixture step：`expect_value`、`expect_checked`。
- 扩展 RenderAndCompare 的行为执行器以验证 value / checked。
- 新增 Flow-M7 local runner，对可信 `set_state` / `open_dialog` 和 submit-like click 做行为验证。
- 增加 local fixtures、unit/integration/e2e targeted validation。
- 生成 Worktrail validation pending candidate。

### Out of Scope

- 不调用真实 Figma/OpenAI。
- 不新增依赖。
- 不改变 Pi 四工具边界。
- 不新增 submit action kind。
- 不覆盖 select/radio 的完整选择语义；如后续纳入，作为 Flow-M7 v1.1。
- 不修改 Product-M7 / Product-M8 目标定义。
- 不执行 Git commit/push。

## 5. 验收标准

- AC1：Flow-M7 有独立 report schema，scope 为 `interactive_behavior`。
- AC2：`passed` 必须满足 `trustedNonRouteConverted >= 1`、`validation.passed=true`，并且至少一个非 navigate fixture 成功。
- AC3：scenario-only fixture 只能作为补充验证；没有可信非 route FlowPlan 转换时，结果必须是 `partial` 或 `failed`，原因包含 `flow_m7_scenario_only_not_sufficient`。
- AC4：可信 `set_state` 被转换为 UISpec action，并通过点击或等效触发验证状态变化。
- AC5：可信 `open_dialog` 被转换为 UISpec action，并通过 closed -> visible 的 dialog 可见性验证。
- AC6：表单 `fill` / `toggle` 后必须有 `expect_value` / `expect_checked`，或由该操作导致的 `expect_text` / `expect_visible` 后置断言。
- AC7：submit-like 路径必须点击可信 converted action 绑定的按钮或链接，并验证点击后的可观察变化；点击前已存在的静态 expect 不算通过。
- AC8：缺少可信来源或缺少 `confirmed=true` 的 interaction 不得转换为 UISpec action。
- AC9：Flow-M6 route-execution-only 测试继续通过。
- AC10：typecheck、FlowPlan unit、Flow-M7 integration、Preview/validation targeted checks 通过。
- AC11：创建 Worktrail validation pending candidate，记录本地命令、报告路径、完成范围和残留风险。

## 6. 并行性

[parallelism:
- independent lanes: schema/report 草案和 fixtures 草案可先读并行，但落代码需串行
- sequential blockers: T01 schema 必须先于 T02 runner、T03 fixtures、T05 validation 扩展
- shared write surfaces: `src/ui-spec/schema.ts`、`src/validation/render-and-compare.ts`、`src/flow-plan/*`、`tests/*`
- delegation: 0，Flow-M7 首版涉及共享 schema、行为验证和完成状态，单 agent 顺序实施更稳妥
]

## 7. 实施步骤

### T00：进入 Flow-M7 Gate 和基线确认

操作：

1. 运行 `worktrail context --semantic=auto "Flow-M7 interactive behavior implementation"`。
2. 确认当前工作树状态，列出 staged、unstaged、untracked。
3. 读取 Flow-M6 promoted 设计与计划，确认 navigate-only 边界。
4. 读取 `src/ui-spec/schema.ts`、`src/flow-plan/to-ui-spec.ts`、`src/validation/render-and-compare.ts`、`preview/src/preview-app.tsx`。

验证：

- 输出当前 scope、禁止事项和本次允许修改文件列表。
- 不修改文件。

### T01：定义 Flow-M7 report 和 behavior scenario 契约

落点：

- `src/flow-plan/m7-report.ts`
- `src/flow-plan/m7-scenario.ts`
- `src/flow-plan/index.ts` 如已有导出模式需要
- `src/ui-spec/schema.ts`
- `tests/unit/flow-plan-m7-report.test.ts`
- `tests/unit/flow-plan-m7-scenario.test.ts`
- `tests/unit/ui-spec-schema.test.ts` 或同类 schema 测试

操作：

1. 定义 `FlowM7InteractiveBehaviorReport`，至少包含：
   - `milestone: "Flow-M7"`
   - `scope: "interactive_behavior"`
   - `input.projectId`
   - `input.flowPlanPath`
   - `input.uiSpecRevision`
   - `actions.converted`
   - `actions.rejected`
   - `behaviors.fixtures`
   - `counts.trustedNonRouteConverted`
   - `counts.scenarioOnlyFixtures`
   - `counts.submitLikeVerified`
   - `counts.unresolved`
   - `validation`
   - `status: "passed" | "partial" | "failed"`
   - `reasons: string[]`
2. 在 report schema 中加入 superRefine 或等效校验：
   - `status="passed"` 时 `counts.trustedNonRouteConverted >= 1`。
   - `status="passed"` 时 `validation.passed === true`。
   - `status="passed"` 时至少一个非 navigate fixture 成功。
   - `scenarioOnlyFixtures > 0` 不能单独满足 passed。
3. 定义 `FlowM7BehaviorScenario`，用于提供本地 fixture 值和后置断言，但标记 scenario 来源。
4. 扩展 UISpec behavior fixture step schema，新增：
   - `expect_value`: `{ kind: "expect_value"; nodeId: string; value: string }`
   - `expect_checked`: `{ kind: "expect_checked"; nodeId: string; checked: boolean }`
5. 保持已有 `click`、`fill`、`toggle`、`expect_visible`、`expect_text`、`expect_page` 兼容。

验证：

- Unit 覆盖：合法 report、scenario-only passed 被拒绝、缺少 trusted non-route passed 被拒绝、`expect_value` / `expect_checked` schema 通过、非法 step 被拒绝。

### T02：实现 Flow-M7 Interaction Executor

落点：

- `src/flow-plan/m7-interactions.ts`
- `src/flow-plan/to-ui-spec.ts` 如需复用入口
- `tests/unit/flow-plan-m7-interactions.test.ts`

操作：

1. 复用或包装 `applyFlowPlanToUISpec`，不要复制 M6 navigate-only 逻辑。
2. 对 trusted 非 navigate interaction 计数：
   - `source` 必须是 `figma` 或 `user_confirmed`。
   - `confirmed` 必须为 `true`。
   - action kind 必须能落到现有 UISpec action：`set_state` 或 `open_dialog`。
3. 对缺少可信来源、缺少 confirmed、目标 node 不存在、state 类型不匹配、dialog 不存在的 interaction，写入 rejected，不静默转换。
4. 对 submit-like scenario 建立因果约束：
   - click target 必须是按钮或链接。
   - click target 必须绑定可信 converted action，或 scenario 显式引用该 converted action id。
   - click 后必须有可观察 postcondition。
5. 统计：`trustedNonRouteConvertedCount`、`scenarioOnlyFixtureCount`、`submitLikeVerifiedCount`、`unresolvedCount`。

验证：

- Unit 覆盖 trusted `set_state` 转换、trusted `open_dialog` 转换、不可信 rejected、scenario-only 不计入 trusted non-route、submit-like 缺 postcondition 不通过。

### T03：补齐本地 fixtures

落点：

- `tests/fixtures/flow-plan/m7-interactive-flow.json`
- `tests/fixtures/flow-plan/m7-interactive-ui-spec.json`
- `tests/fixtures/flow-plan/m7-interactive-scenario.json`
- `tests/fixtures/flow-plan/m7-scenario-only.json`
- `tests/fixtures/flow-plan/m7-invalid-submit-like.json`

操作：

1. 构造包含 input、textarea、checkbox、switch、button、status text、dialog 的 UISpec fixture。
2. 构造 FlowPlan fixture：包含可信 `set_state`、可信 `open_dialog`、不可信/missing source 的负例。
3. 构造 scenario fixture：
   - `fill` + `expect_value`。
   - `toggle` + `expect_checked`。
   - 可信 click + 点击后 `expect_visible` / `expect_text` / `expect_value` / `expect_checked`。
4. 构造 scenario-only 负例：所有 fixture 都来自 scenario，没有可信非 navigate FlowPlan 转换。
5. 构造 invalid submit-like 负例：click 后只有点击前已存在的静态 expect，或缺少 postcondition。

验证：

- fixtures 均能被 schema parse。
- 负例 fixture 能触发预期 reason code。

### T04：实现 Flow-M7 local runner

落点：

- `scripts/flow-m7-local.mjs`
- `package.json` scripts，如添加 `flow:m7:local`
- `src/flow-plan/m7-runner.ts`
- `tests/integration/flow-plan-m7-local-runner.test.ts`

操作：

1. runner 读取 fixture FlowPlan、UISpec、scenario。
2. 运行 Flow-M7 executor，生成 updated UISpec 与 report。
3. 调用 RenderAndCompare 的本地行为验证路径。
4. 计算 status：
   - `failed`：schema 或验证失败，或存在硬失败 reason。
   - `passed`：满足 AC2 全部条件。
   - `partial`：有验证通过但没有可信非 route 转换，或只有 scenario-only。
5. 对 invalid scenario 或 CAS 冲突，fail closed，不覆盖 `current.json`。
6. report 写入 `data/projects/<projectId>/runs/<runId>/flow-m7-report.json` 或既有 run 目录约定。

验证：

- Integration 覆盖 passed、partial scenario-only、failed invalid submit-like、fail-closed 不覆盖 current。

### T05：扩展 RenderAndCompare 行为断言

落点：

- `src/validation/render-and-compare.ts`
- `tests/integration/render-and-compare-behavior.test.ts` 或同类文件
- `tests/e2e/preview-*.spec.ts` 如需要覆盖真实 DOM

操作：

1. 为 `expect_value` 定位 `data-ui-node-id` 对应 input/textarea，断言当前 value。
2. 为 `expect_checked` 定位 checkbox、radio、switch 或其实际 native control，断言 checked 状态。
3. `fill` 后没有 value 或后置 UI 断言时，不把 fixture 标记为完成。
4. `toggle` 后没有 checked 或后置 UI 断言时，不把 fixture 标记为完成。
5. submit-like click 的 postcondition 必须在 click 后评估，并记录 pre/post 证据；点击前已满足且点击后无变化的静态 expect 不计为 submit-like verified。

验证：

- Integration 覆盖 value 正例/负例、checked 正例/负例、submit-like 静态 expect 负例、post-click visible/text 正例。

### T06：回归 Flow-M6 和本地验证

操作：

运行最小必要验证：

```bash
npm run typecheck
npm run test:unit -- --runInBand
npm run test:integration -- --runInBand
npm run test:e2e
npm run probe:m3:local
```

如测试脚本不支持 `--runInBand`，按项目实际 Vitest/Playwright 参数调整，但不得跳过同等覆盖。

验证：

- Flow-M6 navigate-only 回归仍通过。
- Flow-M7 本地 runner 生成 `passed`、`partial`、`failed` 三类报告样例。
- Preview 行为验证无 console error。

### T07：创建 Worktrail validation 候选

操作：

1. 汇总本地命令、report 路径、截图/验证记录路径、状态分类和残留风险。
2. 用 `worktrail draft create --type validation --scope project` 创建 pending validation candidate。
3. 运行 `worktrail review plan --format json`。

验证：

- Review plan 能看到 Flow-M7 validation candidate。
- validation candidate 不包含 token、Figma raw URL、file key、截图正文、UISpec 全文。

## 8. 完成定义

Flow-M7 完成必须同时满足：

1. 至少一个可信非 navigate FlowPlan interaction 被转换并通过本地行为验证。
2. scenario-only 不得产生 `passed`。
3. 表单 fixture 通过 `expect_value` / `expect_checked` 或等效后置 UI 断言证明结果。
4. submit-like fixture 通过可信 click 和 post-click observable change 证明因果性。
5. Flow-M7 report/schema 存在并通过 schema 校验。
6. Flow-M6 navigate-only 回归通过。
7. Worktrail validation candidate 创建完成，等待人工 review/promote。

## 9. 风险与回滚

- 风险：Flow-M7 改动破坏 Flow-M6 navigate-only。
  缓解：T06 必跑 Flow-M6 regression；M7 runner 不改 M6 runner 的完成语义。
- 风险：表单断言定位不到真实 native control。
  缓解：优先通过 `data-ui-node-id` 容器内查找 input/textarea/checkbox；找不到即 fail closed。
- 风险：submit-like 因果判断过宽。
  缓解：必须记录 click 前后 postcondition，点击前已满足且点击后无变化不计为 verified。
- 风险：M7 v1 被误解为完整业务状态机。
  缓解：文档明确不新增 submit action kind，不覆盖复杂业务规则、select/radio 完整语义或真实后端。
- 回滚：如 M7 runner 不稳定，停止发布 updated UISpec current，仅保留 schema/fixtures/report 的本地验证；Flow-M6 runner 和 Preview dispatch 不回滚。

## 10. 残留假设

1. 假设：现有 Preview 对 `set_state` / `open_dialog` 的 dispatch 行为足以作为 M7 v1 本地验证对象。
   validation_method：T04/T05 integration 和 Preview targeted test 证明 dispatch 后 DOM 变化。
2. 假设：Flow-M7 v1 暂不纳入 select/radio 完整选择语义不会阻塞当前目标。
   validation_method：T03/T07 validation candidate 明确记录为残留，后续 Flow-M7 v1.1 单独补契约。
3. 假设：submit-like 不新增 action kind，使用可信 click + postcondition 足以覆盖本期简单业务交互。
   validation_method：T02/T05 负例证明静态 expect 不通过，正例证明 click 后状态变化通过。
