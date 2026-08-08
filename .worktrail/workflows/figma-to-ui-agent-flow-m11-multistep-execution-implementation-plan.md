---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m11-multistep-execution-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M11 多步骤业务 Flow 执行验证实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m11"
}
---

# Figma-to-UI Agent Flow-M11 多步骤业务 Flow 执行验证实施计划

## 1. 来源与边界

本计划执行 Flow-M11 多步骤业务 Flow 执行验证设计，承接：

- Flow-M8：本地 submit、postcondition、select/radio、状态机、RenderAndCompare 因果校验已完成。
- Flow-M9：restricted-live interaction 抽取已完成，真实样本可读并能产生 submit-like/interaction 候选。
- Flow-M10：user confirmation 链路已完成，合法 answer 可写回 `user_confirmed submit`；summary-only 只能作为 provenance，不能作为 apply 成功依据。

边界：默认 local-only，不调用 Figma/OpenAI，不新增依赖，不修改 package-lock，不改变四工具边界，不执行 Git lifecycle，除非单独授权。

## 2. 验收标准

- AC1：新增 Flow-M11 artifact loader，只允许可读取、schema 校验通过、引用闭合的 FlowPlan artifact 进入执行。
- AC2：`ephemeral-flow-plan`、summary-only、scenario-only、不可信来源必须 rejected 或 partial，不能生成 passed fixture。
- AC3：新增 behavior fixture schema，支持 `fill`、`select_option`、`choose_radio`、`toggle`、`click`、`expect_page`、`expect_visible`、`expect_value`、`expect_checked`、`expect_selected`。
- AC4：Fixture planner 能从可信 `figma` 或 `user_confirmed` interaction 生成多步骤路径。
- AC5：至少一个本地 fixture 覆盖 `fill + submit + postcondition`。
- AC6：至少一个本地 fixture 覆盖 `select_option`、`choose_radio` 或 `toggle`。
- AC7：Runner 能执行 fixture，并拒绝静态 pre-satisfied expectation。
- AC8：Flow-M11 report schema 能输出 passed/partial/failed、fixture/step 级失败原因、summaryOnly/untrusted/preSatisfied 统计。
- AC9：本地 unit/integration/e2e 回归通过。
- AC10：restricted-live 验证只在单独授权后运行；默认验证不访问外部服务。

## 3. 并行与授权

[parallelism:
- independent lanes: schema/report 设计与 fixture 样本阅读可并行；实现落地应单线串行
- sequential blockers: T00 -> T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08
- shared write surfaces: `src/flow-plan/*`、validation runner、fixtures/tests、reports
- delegation: 0，FlowPlan contract、fixture schema 和 runner 报告共享面较大
]

单独授权门禁：

- Git commit/push。
- 真实 Figma restricted-live 访问。
- OpenAI 调用。
- 依赖、package-lock、四工具边界变更。

## 4. 实施任务

### T00 基线检查

落点：只读。

动作：

- 检查 `git status --short --branch`。
- 检查四工具边界未变。
- 读取 Flow-M8、Flow-M9、Flow-M10 的 schema、planner、runner、report 和测试。
- 确认 M10 restricted-live regression 中 summary-only 与可读取 FlowPlan artifact 的边界。

验证：

- 工作区状态可解释。
- 无外部服务调用。
- Flow-M11 不依赖 semantic runtime。

覆盖：AC1、AC2、AC10。

### T01 Artifact Loader 与引用校验

落点：

- `src/flow-plan/m11-artifact-loader.ts`。
- `tests/unit/flow-plan/m11-artifact-loader.test.ts`。

动作：

- 定义可读取 FlowPlan artifact 输入。
- 复用现有 FlowPlan schema parse。
- 校验 page/node/state/postcondition 引用闭合。
- 检测 `ephemeral-flow-plan`、summary-only、scenario-only、不可信来源。
- 输出稳定原因码。

验证：

- 有效 artifact 返回 loaded。
- 缺文件、schema invalid、悬空引用、不可信来源分别 rejected。
- summary-only 只能进入 partial/rejected。

覆盖：AC1、AC2。

### T02 Behavior Fixture Schema

落点：

- `src/flow-plan/m11-fixture-schema.ts` 或合并到明确的 M11 schema 模块。
- `tests/unit/flow-plan/m11-fixture-schema.test.ts`。

动作：

- 定义 behavior fixture、step、expectation、execution result schema。
- 约束 selector/control refs、输入值长度、fixture id、step id。
- 保留后续接入 Playwright 的最小稳定字段。

验证：

- 所有 AC3 step 类型 parse 通过。
- 缺 action/expectation、非法 selector、超长值、重复 step id 被拒绝。

覆盖：AC3。

### T03 Fixture Planner

落点：

- `src/flow-plan/m11-fixture-planner.ts`。
- `tests/unit/flow-plan/m11-fixture-planner.test.ts`。

动作：

- 从 loaded FlowPlan artifact 和 UISpec/control catalog 生成 behavior fixtures。
- 对 submit path 生成 fill/select/radio/toggle + submit + postcondition。
- 对 navigate/set_state/open_dialog 生成 click + expectation。
- 无可观察 postcondition 时返回 unresolved，不生成 passed fixture。

验证：

- 本地 login fixture 生成 `fill + submit + expect_visible`。
- settings/checkout fixture 生成 select/radio/toggle。
- 悬空 selector/postcondition 不生成可执行 fixture。

覆盖：AC4、AC5、AC6。

### T04 Execution Report 与脱敏

落点：

- `src/flow-plan/m11-report.ts`。
- `tests/unit/flow-plan/m11-report.test.ts`。

动作：

- 定义 Flow-M11 report schema。
- 统计 fixtureCount、successfulFixtureIds、failedFixtureIds、stepCount、failedCheckCount、preSatisfiedExpectationCount、summaryOnlyRejectionCount、untrustedSourceRejectionCount。
- 增加 report redaction check，拒绝 token、Figma URL、file key、raw response、绝对本地路径。

验证：

- passed/partial/failed 条件复算一致。
- 统计与 fixture results 不一致时报错。
- 敏感字段被拒绝。

覆盖：AC8。

### T05 Runner 与本地 Fixture

落点：

- `scripts/run-flow-m11-execution.mjs`。
- `tests/fixtures/flow-plan/m11-multistep-execution/`。
- `tests/integration/flow-plan/flow-m11-execution.test.ts`。

动作：

- 准备 local FlowPlan、UISpec、answers/apply 结果 fixture。
- Runner 执行 loader -> planner -> execution/report 的本地链路。
- 输出 `reports/flow-m11-execution/<runId>/summary.json|summary.md`。
- 默认设置 `figmaRestCalled=false`、`openaiCalled=false`。

验证：

- local run status passed。
- 至少 1 个 submit 多步骤 fixture 成功。
- 至少 1 个 select/radio/checkbox fixture 成功。
- 至少 1 个 rejected negative case 被报告。

覆盖：AC4、AC5、AC6、AC8、AC10。

### T06 Playwright/Preview 执行接入

落点：

- 复用现有 validation/preview runner 或新增 Flow-M11 专用窄适配层。
- `tests/e2e/` 或现有 integration 中最小覆盖。

动作：

- 执行 fill/select/radio/toggle/click/expect steps。
- 对 submit 前后做 pre/post 采样。
- 捕获 console error、missing selector、timeout、不可编辑、不可点击。

验证：

- 多步骤行为能在本地 Preview 执行。
- pre-satisfied expectation 被拒绝。
- console error 会导致 failed 或 partial。

覆盖：AC7、AC9。

### T07 负例与回归

落点：

- T01-T06 对应测试。

动作：

- 增加负例：summary-only、ephemeral-flow-plan、scenario-only、不可信来源、悬空 postcondition、静态预满足、重复 step、非法 answer carryover。
- 确保失败只进入 report/rejections，不被计为 successful fixture。

验证：

- targeted unit/integration/e2e 全通过。
- 负例报告原因码稳定。

覆盖：AC2、AC7、AC8。

### T08 Worktrail Validation

落点：Worktrail validation candidate。

动作：

- 记录本地验证结果、命令、报告路径、外部调用状态和残留风险。
- 如用户另行授权 restricted-live，再追加真实样本执行记录；否则明确未运行外部验证。

验证：

- validation candidate 通过 review plan。
- 无敏感信息。

覆盖：AC9、AC10。

## 5. 建议验证命令

默认本地验证：

```bash
npm run typecheck
npm exec -- vitest run tests/unit/flow-plan/m11-*.test.ts tests/integration/flow-plan/flow-m11-execution.test.ts --testTimeout=30000
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e
```

完整回归在实现完成后再执行：

```bash
npm run test:unit
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm exec -- vitest run tests/integration --testTimeout=30000
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e
```

## 6. 完成定义

Flow-M11 完成需要同时满足：

- 设计和计划已 promote。
- 本地代码实现完成。
- 本地报告 status passed。
- typecheck、targeted unit/integration/e2e 通过。
- Worktrail validation 记录并 promote。
- 未调用未授权外部服务。

restricted-live 真实样本验证属于单独授权门禁；若未授权，不阻塞 Flow-M11 本地完成，但必须在 validation 中标明残留风险。
