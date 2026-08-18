# 实施计划：M6 路由与 Flow 执行验证

## 来源与对齐

- 需求来源：当前目标“制定完整的 M6 计划”。
- 正式设计来源：
  - `.worktrail/architecture/figma-to-ui-agent-flow-plan-conclusion.md`
  - `.worktrail/workflows/figma-to-ui-agent-m4-formal-flowplan-implementation-plan.md`
  - `.worktrail/workflows/figma-to-ui-agent-m5-static-generation-plan.md`
  - `.worktrail/validation/figma-to-ui-agent-m5-static-generation-result.md`
- 当前代码基线：
  - `src/flow-plan/schema.ts` 已有正式 FlowPlan / InteractionPlan schema。
  - `src/project-store/store.ts` 已有 `saveFlowPlan` / `loadFlowPlan` 和 UISpec 对 FlowPlan revision 的引用校验。
  - `src/flow-plan/to-ui-spec.ts` 已能把已确认 interaction 转成 UISpec action 和 behaviorFixture。
  - `src/validation/render-and-compare.ts` 已能按 `behaviorFixtureIds` 执行 Playwright 点击、页面断言、键盘、console 和视觉比较。
  - `scripts/run-m4-flowplan.mjs` 已有一条 M4 语义的端到端样例：FlowPlan 持久化、UISpec 转换、`render_and_compare` 验证。
  - `scripts/run-m5-static.mjs` 已提供 M5 多页面静态 UISpec 生成和逐页比较。
- ADR 约束：当前 Worktrail context 未发现需要冻结的 active Accepted ADR；本计划受 active Worktrail 架构、workflow、validation 约束。
- 决策锁：
  - M6 不是 live M5 blind 测；live M5 blind 只验证未知 Figma 文件上的静态生成泛化能力。
  - M6 不是 M7；复杂表单提交、条件分支、业务状态机、后端调用、真实 submit 不属于 M6。
  - M6 默认只验证 `navigate` 页面跳转 Flow；`set_state`、`open_dialog`、`submit`、业务状态变化进入 out-of-scope / M7 诊断，除非另有单独 M7 计划。
  - 只有 `source: "figma"` 且 `confirmed: true`，或 `source: "user_confirmed"` 且 `confirmed: true` 的 interaction 可以生成可执行 action / fixture。
  - `inferred` / `missing` interaction 必须 fail closed：只能生成确认问题、unresolved 诊断或 residual risk，不能生成真实跳转。
  - 模型可见工具仍保持四个：`inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`。
- 范围边界：
  - 本次做：M6 报告契约、FlowPlan navigate 过滤、route/action/behaviorFixture 执行计划、runner、fixture、integration 验证、Worktrail validation 准备。
  - 本次不做：M5 live blind、M7 表单/状态/业务交互、外部 Figma/OpenAI 调用、依赖新增、工具名变更、部署、commit/push、自动 promote。
- 兼容策略：additive compatibility。优先复用 M4/M5 既有 schema、ProjectStore、UISpec、Preview 和 render-and-compare 能力；新增 M6 report/runner/fixtures，不破坏现有 M4/M5 runner。
- 设计取向假设：
  - 【设计取向·假设】M6 第一版只把 `navigate` 作为通过项；已有 `set_state/open_dialog` 转换能力保留给 M4 兼容测试和 M7，不作为 M6 默认成功条件。依据：正式架构把 M6 定义为“路由与 Flow 执行验证”，把状态/表单归 M7。
  - 【设计取向·假设】M6 可以通过现有四工具完成，不需要新增 `run_flow` 或 `create_route` 模型可见工具。依据：`render_and_compare` 已支持 `behaviorFixtureIds`。
  - 【设计取向·假设】M6 本地验收基于 ProjectStore fixture；真实 Figma/OpenAI live 只作为单独授权 gate。

## 授权边界

- 本计划被接受仅表示：可作为 M6 实施来源，可进入 plan-review-loop 或后续实现。
- 不自动授权：
  - 修改生产代码。
  - 新增或升级依赖、修改 package/lockfile。
  - 调用 Figma/OpenAI 或访问 live 文件。
  - 新增模型可见工具名或改变 Pi provider 工具边界。
  - commit、push、deploy、删除用户文件。
  - Worktrail promote / discard / merge。
- 执行前需单独确认：
  - `GATE-DEPENDENCY`：任何依赖或 lockfile 变化。
  - `GATE-TOOL-CHANGE`：任何模型可见工具列表变化。
  - `GATE-LIVE-M6`：任何真实 Figma/OpenAI 验证。
  - `GATE-COMMIT`：任何 Git commit/push。
  - `GATE-WORKTRAIL`：M6 plan/validation 的 Worktrail draft/promote/discard。

## Truth 与 Ownership

- 业务 Flow 真相 owner：正式 `FlowPlan` 中已确认的 `figma` / `user_confirmed` interaction；用户 chat 确认是推断交互升级为 truth 的来源。
- 设计事实 owner：ProjectStore 中已校验和持久化的 `DesignBundle`。
- 静态页面 owner：ProjectStore 中已校验和持久化的 M5 `UISpec`。
- M6 执行 owner：新增 M6 runner/service/report，负责从 FlowPlan 和 UISpec 派生可执行 route/action/fixture，并调用 render-and-compare 验证。
- 非 truth surfaces：agent prompt、runner stdout、临时 report、Playwright 截图、diff 图、test fixture、未推广 pending candidate。
- 共享写面单 owner：
  - M6 report 契约：`src/flow-execution/report.ts` 或 `src/validation/m6-flow-report.ts`。
  - M6 flow execution service：`src/flow-execution/service.ts`。
  - FlowPlan 到 UISpec 转换选项：`src/flow-plan/to-ui-spec.ts`。
  - Runner：`scripts/run-m6-flow.mjs`。
  - ProjectStore 引用校验：`src/project-store/store.ts`，仅在发现缺口时小范围补强。
  - Validation 执行：`src/validation/render-and-compare.ts`，仅在 behavior fixture 诊断不足时补强。
  - Tests：`tests/unit/flow-execution/*`、`tests/integration/flow-execution/*`、现有 `tests/unit/flow-plan/*`。

## 验收标准追溯

- AC1：M6 有独立 `M6FlowExecutionReportSchema`，明确 `scope: "flow_execution_only"`、`behaviorFlowVerified`、FlowPlan/UISpec revision、routes、actions、fixtures、validation、unresolved、outOfScope 和 residualRisks。
- AC2：M6 runner 能从 ProjectStore 加载 DesignBundle、UISpec、FlowPlan；缺少任一输入时 fail closed，并输出明确错误或 partial report，不生成伪 Flow。
- AC3：M6 只执行 confirmed navigate interaction；`inferred` / `missing` / 未确认 / 非 navigate interaction 不生成 M6 action/fixture。
- AC4：M6 生成或复用 UISpec route/actionId/navigate action，并确保 `sourceFlowPlanRevision` 指向被执行的 FlowPlan revision。
- AC5：M6 能为每个可执行 navigate interaction 生成单步 behaviorFixture，也能为入口页起始的可达 navigate 链生成 bounded multi-step flow fixture。
- AC6：M6 能调用 `render_and_compare` 执行 Playwright 点击路径，验证 `expect_page`，并把 functional/keyboard/console/visual 结果写入 M6 report。
- AC7：M6 报告能区分 `passed`、`failed`、`partial`：无可执行 confirmed navigate 为 partial；fixture 任一检查失败为 failed；所有选定 Flow 通过为 passed。
- AC8：M6 不把 M5 静态视觉通过误报为 Flow 通过；报告必须同时记录 `staticGenerationVerified` / `m5ValidationStatus` 和 `behaviorFlowVerified`。
- AC9：M6 保持四工具不变量，不新增模型可见工具名。
- AC10：M6 默认不调用外部 Figma/OpenAI；live 验证只能通过 `GATE-LIVE-M6` 单独授权。
- AC11：本地验证覆盖 report schema、navigate 过滤、action/fixture 生成、多步路径、runner fail closed、render_and_compare 成功/失败诊断。
- AC12：默认验证命令通过：`npm run typecheck`、M6 靶向 unit/integration、`npm run test:unit`、`npm run test:integration`；必要时补跑 `npm run test:e2e`。

## 开工 Gate

### GATE-M4-VALIDATION：正式 FlowPlan 验收状态

- goal：确认 M6 是否基于已推广的正式 M4 validation，或仅基于当前代码事实继续。
- prerequisites：`worktrail review plan --format json` 能解释 M4 validation candidate 状态。
- owns：M6 治理状态，不属于生产代码。
- must-not-touch：M4 validation candidate，除非用户单独授权。
- actions：
  1. 检查 `.worktrail/validation/figma-to-ui-agent-m4-formal-flowplan-result.md` 是否存在。
  2. 若不存在但代码能力存在，则 M6 implementation 可继续，但 M6 report 必须标记 `m4ValidationStatus: "pending"`。
  3. 若用户要求正式知识链闭合，先进入 Worktrail review/promote M4 validation。
- expected outputs：`m4ValidationStatus` 确认。
- verify：Worktrail review plan 或正式 validation 文件。
- done conditions：M6 计划/实现明确记录 M4 状态。
- stop/escalate conditions：用户要求在 M4 validation 未闭合时声明“正式链路已闭合”。
- handoff：给 T01/T05。

### GATE-M5-BASELINE：M5 静态基线

- goal：确认 M6 输入 UISpec 来自已验证的 M5 静态生成或等价手工 fixture。
- prerequisites：M5 validation active 或测试 fixture 明确构造合法多页面 UISpec。
- owns：M6 输入前置条件。
- must-not-touch：M5 静态生成逻辑，除非 M6 测试发现直接阻塞。
- actions：
  1. 检查 `.worktrail/validation/figma-to-ui-agent-m5-static-generation-result.md`。
  2. 检查 UISpec 是否包含至少 2 个 page、合法 path、rootNodeId、viewport。
  3. 检查 DesignBundle screenshot/provenance 是否足以支持 render-and-compare。
- expected outputs：`m5ValidationStatus: "promoted" | "fixture_only" | "pending"`。
- verify：M5 validation 文件和 runner/integration fixture。
- done conditions：T03/T05 可以用稳定多页输入。
- stop/escalate conditions：只有单页 UISpec，或 root 单 screenshot fallback 被用作 Flow 通过依据。
- handoff：给 T03/T05。

### GATE-M6-SCOPE：M6 与 M7 边界

- goal：冻结 M6 第一版只验证 route/navigate Flow。
- prerequisites：正式 FlowPlan 里可能存在 `set_state/open_dialog/unknown`。
- owns：allowed intents 策略。
- must-not-touch：M7 表单/状态业务规则。
- actions：
  1. 确定 M6 default `allowedIntents = ["navigate"]`。
  2. 非 navigate confirmed interaction 进入 `outOfScopeInteractions`，不计入 M6 passed。
  3. unknown/missing/inferred 进入 unresolved。
- expected outputs：M6 report 中有明确 `outOfScopeInteractions`。
- verify：unit tests 构造 navigate + set_state + missing 混合 FlowPlan。
- done conditions：T02/T03 可开始。
- stop/escalate conditions：实现者试图把 submit/set_state/open_dialog 当作 M6 完成项。
- handoff：给 T02/T03/T04。

### GATE-TOOL-CHANGE：模型可见工具变更

- goal：阻止 M6 默默新增工具名。
- prerequisites：实现者认为四工具不足。
- owns：工具边界设计。
- must-not-touch：`src/runtime/tool-boundary.ts` 中的正式工具列表。
- actions：停止实现，回到架构设计和用户确认。
- expected outputs：新的 Worktrail 设计候选。
- verify：`tests/integration/extension/tool-wiring.test.ts` 仍断言四工具。
- done conditions：默认不触发。
- stop/escalate conditions：新增 `execute_flow`、`save_flow_plan` 等模型可见工具需求。
- handoff：架构评审。

### GATE-LIVE-M6：可选 live Flow 验证

- goal：在本地 M6 通过后，决定是否用真实 Figma/OpenAI 做 live Flow 验证。
- prerequisites：用户明确授权；输入 file/node、限流、脱敏、报告路径已确认。
- owns：live evidence，不属于默认验收。
- must-not-touch：凭据、raw Figma payload、raw OpenAI prompt/response、远端资产 URL。
- actions：单独制定 live runbook，使用脱敏标识。
- expected outputs：live validation candidate 或 report。
- verify：报告不含 token、file key、原始 payload。
- done conditions：不阻塞本地 M6。
- stop/escalate conditions：授权缺失、403/429 不可解释、敏感信息无法脱敏。
- handoff：后续 live 验证。

## 并行规划

[parallelism:
- independent lanes: report schema、navigate filtering unit tests、fixture design 可以先并行设计
- sequential blockers: GATE-M6-SCOPE 先于 conversion；report schema 先于 runner；multi-step fixture 先于 render integration；runner 先于 validation candidate
- shared write surfaces: `src/flow-plan/to-ui-spec.ts`、`src/flow-execution/*`、`src/validation/render-and-compare.ts`、`scripts/run-m6-flow.mjs`、`package.json`、integration fixtures/tests 需要单 owner 顺序提交
- delegation: 0；M6 横跨 contract、runner、validation，多个 agent 并写容易导致 report/schema/fixture 不一致
]

## 实施步骤

### 步骤 1：建立 M6 报告契约

- 落地文件/模块：
  - 新增 `src/flow-execution/report.ts`。
  - 新增 `tests/unit/flow-execution/report-schema.test.ts`。
- 依赖：GATE-M4-VALIDATION、GATE-M5-BASELINE、GATE-M6-SCOPE。
- 操作要点：
  1. 定义 `M6FlowExecutionReportSchema` 和 `M6FlowExecutionReport`。
  2. 字段至少包含：`schemaVersion`、`runId`、`projectId`、`status`、`scope: "flow_execution_only"`、`m4ValidationStatus`、`m5ValidationStatus`、`behaviorFlowVerified`、`sourceDesignBundleRevision`、`sourceUISpecRevision`、`sourceFlowPlanRevision`、`savedUISpecRevision`。
  3. 增加 `routes[]`：fromPageId、toPageId、path/actionId、interactionId、source、confirmed。
  4. 增加 `fixtures[]`：fixtureId、kind `single_navigation | multi_step_flow`、initialPageId、expectedFinalPageId、interactionIds、status。
  5. 增加 `validation` 字段，嵌入或引用 render-and-compare output summary。
  6. 增加 `unresolvedInteractions[]`、`outOfScopeInteractions[]`、`warnings[]`、`residualRisks[]`。
  7. schema 必须拒绝 `behaviorFlowVerified: true` 但无 successful fixture 的报告。
- 验收检查：
  - `npx vitest run tests/unit/flow-execution/report-schema.test.ts`
  - schema 对 passed/failed/partial 状态一致性做校验。
- 覆盖验收标准：AC1、AC7、AC8、AC11。

### 步骤 2：实现 M6 Flow 执行选择器

- 落地文件/模块：
  - 新增 `src/flow-execution/service.ts`。
  - 新增 `tests/unit/flow-execution/service.test.ts`。
- 依赖：步骤 1、GATE-M6-SCOPE。
- 操作要点：
  1. 输入：DesignBundle、UISpec、FlowPlan、options。
  2. 选择 `confirmed === true` 且 source 为 `figma | user_confirmed` 且 intent 为 `navigate` 的 interaction。
  3. 验证 `fromPageId`、`targetPageId`、`uiNodeId` 均能映射到 UISpec page/node。
  4. 对不可执行项生成 `blockedReason`，进入 unresolved，不生成 action。
  5. 对 confirmed 但非 navigate 的 interaction 进入 out-of-scope，不计入 M6 passed。
  6. 输出 executable routes、blocked interactions、out-of-scope interactions。
- 验收检查：
  - confirmed navigate 被选中。
  - inferred/missing/未确认不被选中。
  - set_state/open_dialog 被分类为 out-of-scope。
  - 悬空 page/node 引用进入 blocked。
- 覆盖验收标准：AC2、AC3、AC7、AC11。

### 步骤 3：生成 route/action 和单步 behaviorFixture

- 落地文件/模块：
  - `src/flow-plan/to-ui-spec.ts` 可加 additive option：`allowedIntents?: FlowIntent[]` 或新增 M6 wrapper 调用现有转换后再过滤。
  - `src/flow-execution/service.ts`。
  - `tests/unit/flow-execution/service.test.ts`。
  - 必要时补充 `tests/unit/flow-plan/to-ui-spec.test.ts`。
- 依赖：步骤 2。
- 操作要点：
  1. 默认 `allowedIntents = ["navigate"]`。
  2. 为每个 executable route 生成稳定 action id，绑定到 button/link 的 `actionId`。
  3. action 必须是 `{ kind: "navigate", pageId }`。
  4. UISpec `sourceFlowPlanRevision` 必须写入当前 FlowPlan revision。
  5. 为每个 executable route 生成单步 fixture：click -> expect_page。
  6. 不覆盖用户已有无关 action；action id 冲突时稳定后缀化。
- 验收检查：
  - `uiSpecDraftSchema.parse` 通过。
  - actionId 绑定到正确 node。
  - `sourceFlowPlanRevision` 正确。
  - 非 navigate 不生成 fixture。
- 覆盖验收标准：AC3、AC4、AC5、AC11。

### 步骤 4：生成 bounded multi-step Flow fixture

- 落地文件/模块：
  - `src/flow-execution/service.ts`。
  - `tests/unit/flow-execution/path-planner.test.ts` 或并入 service test。
- 依赖：步骤 3。
- 操作要点：
  1. 从 entry page 或 UISpec 第一页开始建立 navigate graph。
  2. 生成最多 N 条路径，默认 N=20，最大深度默认 6，防止循环爆炸。
  3. 每条路径转成一个 behaviorFixture：click/expect_page 重复。
  4. 对循环、分叉、不可达页面写入 warnings，不把不可达当通过。
  5. 路径 fixture 和单步 fixture 都可通过 `behaviorFixtureIds` 选择运行。
- 验收检查：
  - home -> quote -> result 生成 multi-step fixture。
  - 循环路径被截断并记录 warning。
  - 无 entry 或无可达路径时 partial。
- 覆盖验收标准：AC5、AC7、AC11。

### 步骤 5：实现 `run:m6:flow` runner

- 落地文件/模块：
  - 新增 `scripts/run-m6-flow.mjs`。
  - 修改 `package.json` 增加 `"run:m6:flow": "node scripts/run-m6-flow.mjs"`；若 package/lock 变化只限脚本字段，不新增依赖。
  - 新增 `tests/integration/flow-execution/m6-flow.test.ts`。
- 依赖：步骤 1-4。
- 操作要点：
  1. CLI 参数：`--projectId`、`--dataRoot`、`--designBundleRevision`、`--uiSpecRevision`、`--flowPlanRevision`、`--reportRoot`、`--runId`、`--save-ui-spec`、`--run-compare`、`--viewportIds`、`--behaviorFixtureIds`、`--maxPaths`、`--maxDepth`、`--m4ValidationStatus`、`--m5ValidationStatus`。
  2. 缺少 UISpec 或 FlowPlan 时 fail closed。
  3. 默认不保存 UISpec；只有 `--save-ui-spec` 才写入 converted UISpec。
  4. `--run-compare` 必须要求 `--save-ui-spec`，并只运行 M6 生成的 fixture ids。
  5. 输出 `summary.json`，`summary.md` 只能从 JSON 派生。
  6. stdout 只打印脱敏摘要，不打印 raw project payload。
- 验收检查：
  - runner 在 fixture 上生成 passed report。
  - 无 confirmed navigate 时生成 partial report。
  - 缺 FlowPlan / 缺 UISpec 时错误清晰且不写伪结果。
- 覆盖验收标准：AC1、AC2、AC6、AC7、AC8、AC10、AC11。

### 步骤 6：补强 render-and-compare Flow 诊断

- 落地文件/模块：
  - `src/validation/render-and-compare.ts`，仅在当前输出不足时补强。
  - `tests/integration/validation/render-and-compare.test.ts`。
- 依赖：步骤 5。
- 操作要点：
  1. 确认 `behaviorFixtureIds` 只运行选定 fixture。
  2. 对 fixture target 不在 page/viewport 范围内保持 fail closed。
  3. 如 M6 report 需要更细粒度失败原因，给 checks message 增加 fixture id、step kind、expected/actual page。
  4. 不改变现有视觉 diff 阈值默认行为，M6 只消费结果。
- 验收检查：
  - 指定一个 fixture id 时只执行一个 fixture。
  - 错误 page 断言返回 failed check，而不是静默通过。
  - console/keyboard checks 仍执行。
- 覆盖验收标准：AC6、AC7、AC11。

### 步骤 7：构造 M6 多页 Flow fixture 和 integration

- 落地文件/模块：
  - 新增 `tests/fixtures/flow-execution/m6-flow-fixture.ts`，或扩展 `tests/fixtures/flow-plan/*`。
  - 新增 `tests/integration/flow-execution/m6-flow.test.ts`。
- 依赖：步骤 5-6。
- 操作要点：
  1. 使用临时 data root，避免污染仓库 `data/projects`。
  2. 通过 ProjectStore 保存真实 screenshot / asset PNG，避免 ENOENT 类问题。
  3. 构造至少 3 页：home、quote、result。
  4. 构造 confirmed navigate：home -> quote、quote -> result。
  5. 构造 negative cases：missing target、inferred 未确认、set_state out-of-scope。
  6. 跑 runner：`--save-ui-spec --run-compare`，断言 M6 report passed、multi-step fixture 存在、validation passed。
- 验收检查：
  - `npx vitest run tests/integration/flow-execution/m6-flow.test.ts`
  - 所有临时目录 afterEach 清理。
- 覆盖验收标准：AC2、AC3、AC4、AC5、AC6、AC7、AC8、AC11。

### 步骤 8：验证矩阵和 Worktrail validation 准备

- 落地文件/模块：
  - `reports/m6-flow/<runId>/summary.json` 和 `summary.md`，仅由 runner 生成。
  - 可选 Worktrail validation candidate：`validation/figma-to-ui-agent-m6-flow-execution-result.md`。
- 依赖：步骤 1-7。
- 操作要点：
  1. 运行 `npm run typecheck`。
  2. 运行 M6 靶向 unit/integration。
  3. 运行 `npm run test:unit`。
  4. 运行 `npm run test:integration`。
  5. 若 Preview/e2e 表面受影响，运行 `npm run test:e2e`。
  6. 验证报告写明：M6 Flow 已验证 / M7 业务状态未验证 / live 未验证。
  7. 若用户要求持久化，使用 `worktrail draft create --type validation` 创建 pending candidate；不自动 promote。
- 验收检查：
  - 所有本地命令通过。
  - Worktrail review plan 能显示 M6 validation pending 或无重复 target。
- 覆盖验收标准：AC7、AC8、AC9、AC10、AC11、AC12。

## Coding Agent 任务卡

### T01：M6 report schema

- goal：建立严格 M6 report 契约。
- prerequisites：GATE-M4-VALIDATION、GATE-M5-BASELINE、GATE-M6-SCOPE。
- must-read：本计划、`src/flow-plan/schema.ts`、`src/tools/contracts.ts`、M5 validation。
- owns：`src/flow-execution/report.ts`、`tests/unit/flow-execution/report-schema.test.ts`。
- must-not-touch：runner、ProjectStore、Preview、package.json。
- actions：实现 schema、状态一致性校验、基础 fixtures。
- expected outputs：可 parse 的 `M6FlowExecutionReport`。
- verify：report schema unit tests。
- done conditions：AC1/AC7/AC8 的 schema 层通过。
- stop/escalate conditions：需要把 M7 状态/表单纳入 M6 report 成功条件。
- handoff：给 T02/T05。

### T02：Flow 执行选择器与转换包装

- goal：从 FlowPlan/UISpec 中选择 M6 可执行 confirmed navigate，并生成 action/fixture。
- prerequisites：T01。
- must-read：`src/flow-plan/to-ui-spec.ts`、`tests/unit/flow-plan/to-ui-spec.test.ts`。
- owns：`src/flow-execution/service.ts`、相关 unit tests。
- must-not-touch：`src/ui-spec/schema.ts`，除非有明确 schema 缺口并升级到设计 gate。
- actions：实现过滤、blocked/out-of-scope 分类、单步 fixture、multi-step path fixture。
- expected outputs：M6 execution draft，包括 converted UISpec draft、fixture ids、routes、diagnostics。
- verify：unit tests 覆盖 positive/negative/multi-step/cycle。
- done conditions：AC2-AC5 通过。
- stop/escalate conditions：必须支持 submit/set_state 才能测试业务流程。
- handoff：给 T03。

### T03：M6 runner

- goal：提供离线可复现 M6 验证入口。
- prerequisites：T01/T02。
- must-read：`scripts/run-m4-flowplan.mjs`、`scripts/run-m5-static.mjs`、`src/validation/render-and-compare.ts`。
- owns：`scripts/run-m6-flow.mjs`、`package.json` 脚本字段、runner integration test。
- must-not-touch：依赖版本、package-lock、模型工具列表。
- actions：实现 CLI、ProjectStore load/save、report 写入、optional compare。
- expected outputs：`run:m6:flow` 可生成 summary JSON/Markdown。
- verify：runner integration tests。
- done conditions：AC6-AC10 通过。
- stop/escalate conditions：runner 需要 live Figma/OpenAI。
- handoff：给 T04。

### T04：Flow validation integration

- goal：证明 M6 在本地多页 Flow fixture 上端到端通过。
- prerequisites：T03。
- must-read：`tests/integration/validation/render-and-compare.test.ts`、`tests/integration/flow-plan/m4-flowplan.test.ts`。
- owns：`tests/fixtures/flow-execution/*`、`tests/integration/flow-execution/*`。
- must-not-touch：生产 Preview 样式，除非 M6 行为执行有真实 bug。
- actions：构建真实 PNG fixture、保存 ProjectStore、运行 runner `--save-ui-spec --run-compare`。
- expected outputs：M6 report passed，validation results passed，临时文件清理。
- verify：M6 integration test。
- done conditions：AC5/AC6/AC11 通过。
- stop/escalate conditions：render_and_compare 行为 fixture 本身有 bug，需要先修 validation 层。
- handoff：给 T05。

### T05：最终验收与 Worktrail validation

- goal：形成 M6 本地验收证据。
- prerequisites：T01-T04 全部通过。
- must-read：Testing Rules、Security Rules、Worktrail draft/review 规则。
- owns：`reports/m6-flow/*` 运行产物和可选 Worktrail validation candidate。
- must-not-touch：promote/discard、commit/push。
- actions：跑完整验证矩阵，整理报告，按用户授权创建 validation pending candidate。
- expected outputs：M6 validation draft 或明确本地报告路径。
- verify：`npm run typecheck`、M6 靶向、`npm run test:unit`、`npm run test:integration`、必要时 `npm run test:e2e`。
- done conditions：M6 本地完成状态可被 Worktrail validation 表达。
- stop/escalate conditions：需要 live blind 或 Git lifecycle 操作。
- handoff：给用户 review/promote。

## 风险与回滚

- 风险：M6/M7 边界混淆，把状态或表单提交误报为 Flow 通过。
  - 关联步骤：GATE-M6-SCOPE、步骤 2-5。
  - 影响：用户误以为业务流程已完整支持。
  - 缓解 / 回滚：默认只允许 navigate；非 navigate 进入 out-of-scope；回滚时移除 M6 runner 对非 navigate 的任何通过判定。
- 风险：使用 M4 runner 继续承载 M6，导致报告语义不清。
  - 关联步骤：步骤 5。
  - 影响：validation 记录无法区分 M4 契约验证和 M6 执行验证。
  - 缓解 / 回滚：新增 `run:m6:flow` 和 M6 report schema；保留 M4 runner 不变。
- 风险：multi-step path 生成陷入循环或组合爆炸。
  - 关联步骤：步骤 4。
  - 影响：测试慢、runner 卡住。
  - 缓解 / 回滚：设置 `maxPaths`、`maxDepth`，循环记录 warning；回滚到只生成单步 fixture。
- 风险：M6 修改 `to-ui-spec` 影响 M4 测试。
  - 关联步骤：步骤 3。
  - 影响：M4 行为转换回归。
  - 缓解 / 回滚：优先 M6 wrapper；若改 `to-ui-spec`，必须 additive option 且默认保持原行为。
- 风险：runner 写入真实项目 current UISpec 导致覆盖用户工作。
  - 关联步骤：步骤 5。
  - 影响：ProjectStore current 被非预期更新。
  - 缓解 / 回滚：默认不保存；`--save-ui-spec` 需要 baseRevision CAS；测试使用临时 data root。
- 风险：validation 视觉 diff 失败掩盖 Flow 功能已通过。
  - 关联步骤：步骤 6-8。
  - 影响：难以诊断到底是视觉问题还是点击路径问题。
  - 缓解 / 回滚：M6 report 分开记录 functional/keyboard/console/visual；Flow passed 必须 functional 通过，visual 作为诊断或阈值门按配置。
- 风险：Worktrail lifecycle 混乱。
  - 关联步骤：步骤 8。
  - 影响：重复 pending candidate 或 promote 错误候选。
  - 缓解 / 回滚：创建 validation 后运行 `worktrail review plan --format json`；promote/discard 只接受精确 candidate id 和 scope。

## 验收标准覆盖检查

- AC1 → 步骤 1、T01。
- AC2 → GATE-M5-BASELINE、步骤 2、步骤 5、T02/T03。
- AC3 → GATE-M6-SCOPE、步骤 2、步骤 3、T02。
- AC4 → 步骤 3、T02。
- AC5 → 步骤 3、步骤 4、T02。
- AC6 → 步骤 5、步骤 6、T03/T04。
- AC7 → 步骤 1、步骤 2、步骤 5、T01/T03。
- AC8 → 步骤 1、步骤 8、T05。
- AC9 → GATE-TOOL-CHANGE、步骤 8。
- AC10 → GATE-LIVE-M6、步骤 5、步骤 8。
- AC11 → 步骤 1-7、T01-T04。
- AC12 → 步骤 8、T05。

## 待确认 / 残留假设

- 【假设】M6 第一版只验证 navigate，不把 `set_state/open_dialog` 作为通过项。（验证方法：plan review；若用户要求状态/弹窗纳入，则升级 M7 或先修订架构边界。）
- 【假设】不需要新增模型可见工具。（验证方法：T03 后跑 `tests/integration/extension/tool-wiring.test.ts`。）
- 【假设】不执行 live M6。（验证方法：无 `GATE-LIVE-M6` 授权时所有测试使用本地 fixture。）
- 【假设】M4 validation 可保持 pending，但 M6 report 必须如实记录。（验证方法：Worktrail review plan 与 M6 report 字段。）

## 下一步

建议先对本计划执行 plan-review-loop，修订到 clean 或 clean_with_assumptions 后，再进入 M6 实现。实现完成后再创建 M6 Worktrail validation candidate；是否 promote 由用户用精确 candidate id 单独确认。
