---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m6-route-execution-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M6 路由与 Flow 执行验证实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m6-route-execution"
}
---

# Figma-to-UI Agent Flow-M6 路由与 Flow 执行验证实施计划

## 1. 目标

Flow-M6 的目标是把用户确认后的页面跳转从 FlowPlan 转换为 UISpec navigate action，并通过 Preview + Playwright behavior fixture 证明点击路径实际可执行。

本计划只覆盖 `route_execution_only`。表单、submit、checkbox、业务状态切换、`set_state` 和 `open_dialog` 的正式验收不在 Flow-M6 中完成。

## 2. Sources and Alignment

正式来源：

- `architecture/figma-to-ui-agent-flow-plan-conclusion.md`：正式 M6 定义为 route 生成、button navigate、behavior fixture 页面流转、Playwright 点击路径。
- `workflows/figma-to-ui-agent-post-m7-roadmap.md`：明确 Product-M* 与 Flow-M* 分线，Flow-M6 在 Product-M8 后推进。
- `rules/figma-to-ui-agent-milestone-naming.md`：后续必须使用 `Flow-M6`，不得裸用 M6。
- `validation/figma-to-ui-agent-m5-static-generation-result.md`：M5 不代表 M6 完成，M6 必须单独验收 route/navigate/fixture/click path。
- `architecture/figma-to-ui-agent-flow-m6-route-execution-design.md`：本计划对应的 Flow-M6 设计候选。

仓库现实：

- `src/flow-plan/schema.ts` 已有正式 FlowPlan Schema。
- `src/flow-plan/to-ui-spec.ts` 已能转换可信 interaction 为 UISpec action 和 behavior fixture。
- `src/ui-spec/schema.ts` 已有 `pages[].path`、`navigate` action、behavior fixtures。
- `preview/src/preview-app.tsx` 已有 Preview navigate dispatch。
- `src/validation/render-and-compare.ts` 已能执行 `click` 和 `expect_page`。
- `tests/integration/flow-plan/m4-flowplan.test.ts` 已证明 M4 底层链路，但不能作为 Flow-M6 验收替代。

Accepted ADR：None identified for this plan. 若后续新增 ADR，实施前必须重新审核计划。

## 3. 授权边界

本计划默认实施边界：

- 允许：本地代码改动、本地 fixture、本地 Vitest/Playwright 验证、创建本地 reports。
- 不允许：调用真实 Figma、调用 OpenAI、安装或升级依赖、执行 Git commit/push、删除历史 reports、修改模型可见工具数量或名称。
- 需要单独确认：修改 `package.json` npm scripts、提交、推送、restricted-live/live Flow-M6 探针。

## 4. Source of Truth

- FlowPlan 是行为事实来源：只有 `figma` 或 `user_confirmed` 且 `confirmed = true` 的 `navigate` interaction 可进入行为执行。
- UISpec 是 Preview 渲染和行为执行的唯一中间产物。
- `reports/flow-m6-route-execution/*` 是运行证据，不是正式知识来源。
- Worktrail validation candidate 是正式验收结论入口。
- UI runtime state、Playwright temporary state、report markdown 都不是业务事实来源。

## 5. Acceptance Criteria

- AC1：Flow-M6 runner 只验收 navigate，不把 `set_state`、`open_dialog` 或表单行为计入 Flow-M6 成功。
- AC2：可信 navigate interaction 可转换为 UISpec `navigate` action，并绑定到 button/link `actionId`。
- AC3：生成的 behavior fixture 至少包含 `click` 和 `expect_page`，并引用正确 `initialPageId`、`viewportId` 和目标页。
- AC4：Playwright 执行点击路径后，能证明 active page 切换到目标 page。
- AC5：无 UISpec、单页、无可信 navigate、悬空 target、不可点击 source 等场景 fail closed 或 `partial`，不得构造假 route。
- AC6：Flow-M6 报告独立于 M4，包含 `milestone = Flow-M6` 和 `scope = route_execution_only`。
- AC7：报告脱敏，不包含 Figma file key、token、原始 URL、远端资产 URL、raw Figma payload 或助手正文。
- AC8：本地验证命令可重复运行，至少覆盖 unit、integration 和 typecheck。
- AC9：四工具边界不变，`EXACT_TOOL_NAMES` 不新增、不删除、不重命名。
- AC10：最终 Worktrail validation 记录明确 Flow-M6 完成范围与 Flow-M7 残留项。

## 6. Parallelism

[parallelism:
- independent lanes: report schema/tests 与 runner fixture 准备可并行设计，但实现阶段共享 Flow-M6 report contract，需单 owner 合并
- sequential blockers: GATE-00 必须先完成；report schema 必须早于 runner summary；runner 必须早于 validation candidate
- shared write surfaces: `src/flow-plan/*`、`scripts/*`、`tests/fixtures/flow-plan/*`、`tests/integration/flow-plan/*`、`package.json` scripts
- delegation: 0；当前阶段共享契约和测试链路紧密，适合单 agent 顺序实施
]

## 7. GATE-00：预编码确认

实施前必须确认：

- Flow-M6 只做 local-only，不调用 Figma/OpenAI live。
- 不新增 npm 依赖。
- 不修改 `EXACT_TOOL_NAMES`。
- 若要添加 npm script，需要用户确认该 root config 变更；没有确认时可直接用 `node scripts/run-flow-m6.mjs` 验证。
- 若发现需要新增 UISpec action kind 或 behavior fixture step kind，停止并回到设计修订。

验证：

- `git status --short` 记录实施前状态。
- `rg -n "EXACT_TOOL_NAMES" src/runtime/tool-boundary.ts` 确认工具边界文件。
- `npm run typecheck` 作为基线可选检查；如果环境成本高，可在编码后执行。

## 8. 实施步骤

### Step 1：Flow-M6 报告 Schema

- landing：`src/flow-plan/m6-report.ts` 或 `src/flow-plan/route-execution-report.ts`，`tests/unit/flow-plan/m6-report.test.ts`。
- dependency：GATE-00。
- actions：定义 `FlowM6RouteExecutionReportSchema`，字段包含 `schemaVersion`、`milestone`、`scope`、`status`、revision、counts、converted ids、fixture ids、unresolved interactions、validation summary、residual risks。
- verify：`npx vitest run tests/unit/flow-plan/m6-report.test.ts`。
- covers：AC5、AC6、AC7。
- rollback：删除新增 report schema 和对应 unit test，不影响 M4/M5/M7。

### Step 2：Navigate-only 转换包装

- landing：`src/flow-plan/to-ui-spec.ts` 或新增 `src/flow-plan/route-execution.ts`，`tests/unit/flow-plan/to-ui-spec.test.ts`。
- dependency：Step 1。
- actions：在 Flow-M6 路径中过滤或包装现有 converter，只把可信 `navigate` 计入 `convertedNavigateActionIds`；非 navigate intent 必须进入 `unresolvedInteractions` 或 residual risk，不计入 Flow-M6 成功。
- verify：`npx vitest run tests/unit/flow-plan/to-ui-spec.test.ts tests/unit/flow-plan/m6-report.test.ts`。
- covers：AC1、AC2、AC3、AC5。
- rollback：回退 wrapper；保留原 M4 converter 行为不变。

### Step 3：Flow-M6 Runner

- landing：`scripts/run-flow-m6.mjs`，可选 `package.json` script `run:flow:m6` 需另行授权。
- dependency：Step 1、Step 2。
- actions：新增 local runner，从 ProjectStore 读取 DesignBundle、UISpec、FlowPlan；执行 navigate-only conversion；可选保存 UISpec；调用 RenderAndCompare 验证 behavior fixture；输出 `reports/flow-m6-route-execution/<runId>/summary.json` 和派生 `summary.md`。
- verify：通过 integration test 间接运行；手动命令 `node scripts/run-flow-m6.mjs --project-id <id> --data-root <tmp> --report-root <tmp> --run-id <id> --save-ui-spec --run-compare`。
- covers：AC2、AC3、AC4、AC6、AC7。
- rollback：删除 runner；不影响正式 ProjectStore artifact。

### Step 4：Local Fixture / Corpus

- landing：`tests/fixtures/flow-plan/multipage-flow.ts`、可选新增 `tests/fixtures/flow-plan/flow-m6-route.ts`。
- dependency：Step 2。
- actions：构造至少三种 fixture：成功 navigate、无可信 navigate partial、坏 target partial/failed。复用现有 multipage flow fixture 时不得污染 M4 测试语义。
- verify：fixture 被 Step 5 integration test 覆盖。
- covers：AC4、AC5、AC8。
- rollback：删除新增 fixture 或恢复 fixture 扩展，不影响生产代码。

### Step 5：Integration 验证

- landing：`tests/integration/flow-plan/flow-m6-route-execution.test.ts`。
- dependency：Step 1-4。
- actions：用临时 ProjectStore 保存 DesignBundle、UISpec、FlowPlan 和本地 PNG；执行 runner；断言 report schema、status、converted ids、fixture ids、Playwright functional checks、summary.md 脱敏边界。
- verify：`npx vitest run tests/integration/flow-plan/flow-m6-route-execution.test.ts`。
- covers：AC2、AC3、AC4、AC5、AC6、AC7、AC8。
- rollback：删除 integration test 和 runner changes。

### Step 6：Boundary Regression

- landing：existing tests only；必要时补 `tests/integration/extension/tool-wiring.test.ts` 断言。
- dependency：Step 1-5。
- actions：确认四工具边界不变，确认 Product-M8 CLI 不受影响，确认 M4 FlowPlan test 仍通过。
- verify：
  - `npm run typecheck`
  - `npx vitest run tests/unit/flow-plan tests/integration/flow-plan/m4-flowplan.test.ts tests/integration/flow-plan/flow-m6-route-execution.test.ts`
  - `npm run test:integration -- tests/integration/extension/tool-wiring.test.ts`
- covers：AC8、AC9。
- rollback：若 Product-M8/M4 回归失败，优先回退 Flow-M6 runner/report wrapper，不修改既有工具边界。

### Step 7：Flow-M6 Validation Candidate

- landing：Worktrail pending validation candidate，target `validation/figma-to-ui-agent-flow-m6-route-execution-result.md`。
- dependency：Step 1-6 全部通过。
- actions：记录本地验证命令、报告路径、范围、残留风险；明确 Flow-M7 未完成。
- verify：`worktrail review plan --format json` 能看到 pending validation candidate。
- covers：AC10。
- rollback：不 promote；若记录有误，discard candidate 后重建。

## 9. Coding Agent 任务卡

### T01：Report Contract

- goal：定义 Flow-M6 独立报告契约，避免复用 M4 报告误报。
- prerequisites：GATE-00。
- must-read：`src/flow-plan/schema.ts`、`scripts/run-m4-flowplan.mjs`、Flow-M6 设计文档。
- owns：`src/flow-plan/m6-report.ts`、`tests/unit/flow-plan/m6-report.test.ts`。
- must-not-touch：ProjectStore、Preview、package files。
- actions：实现 zod schema、parse helper、summary markdown input shape。
- expected outputs：report schema 和 unit tests。
- verify：`npx vitest run tests/unit/flow-plan/m6-report.test.ts`。
- done conditions：AC6、AC7 通过。
- stop/escalate conditions：需要把 report 字段写入 UISpec 或 DesignBundle。
- handoff：schema 字段、status 语义、脱敏约束。

### T02：Navigate-only Conversion Path

- goal：让 Flow-M6 只把可信 navigate 计入成功。
- prerequisites：T01。
- must-read：`src/flow-plan/to-ui-spec.ts`、`tests/unit/flow-plan/to-ui-spec.test.ts`、`src/ui-spec/schema.ts`。
- owns：`src/flow-plan/to-ui-spec.ts` 或 `src/flow-plan/route-execution.ts`、相关 unit tests。
- must-not-touch：UISpec action kind、Preview app、external service code。
- actions：新增 wrapper 或 narrow option；确保 non-navigate 不计入 Flow-M6 success。
- expected outputs：converted navigate ids、fixture ids、unresolved interactions 明确。
- verify：`npx vitest run tests/unit/flow-plan/to-ui-spec.test.ts tests/unit/flow-plan/m6-report.test.ts`。
- done conditions：AC1、AC2、AC3、AC5 通过。
- stop/escalate conditions：需要新增 behavior step kind 或 action kind。
- handoff：转换规则和 unresolved 分类。

### T03：Runner

- goal：提供可重复运行的 local-only Flow-M6 runner。
- prerequisites：T01、T02。
- must-read：`scripts/run-m4-flowplan.mjs`、`src/project-store/store.ts`、`src/validation/render-and-compare.ts`。
- owns：`scripts/run-flow-m6.mjs`、可选 package script 仅在授权后修改。
- must-not-touch：Figma REST、OpenAI provider、tool boundary。
- actions：读取 artifact、运行转换、保存可选 UISpec、执行 compare、写 summary JSON/MD。
- expected outputs：local runner 和 reports 目录输出。
- verify：integration test 调用 runner。
- done conditions：AC4、AC6、AC7 通过。
- stop/escalate conditions：runner 需要 live token 或外部网络。
- handoff：CLI 参数、报告路径、失败码。

### T04：Fixture and Integration

- goal：用本地 fixture 证明 Flow-M6 成功和失败路径。
- prerequisites：T01-T03。
- must-read：`tests/fixtures/flow-plan/*`、`tests/integration/flow-plan/m4-flowplan.test.ts`。
- owns：`tests/fixtures/flow-plan/*`、`tests/integration/flow-plan/flow-m6-route-execution.test.ts`。
- must-not-touch：M5 static fixture、Product-M8 fixtures，除非只读复用。
- actions：新增或扩展 fixture；测试 success、partial、bad target；断言 Playwright checks。
- expected outputs：integration tests 通过。
- verify：`npx vitest run tests/integration/flow-plan/flow-m6-route-execution.test.ts`。
- done conditions：AC4、AC5、AC8 通过。
- stop/escalate conditions：Playwright 本地浏览器缺失且无法用现有 `data/playwright-browsers`。
- handoff：fixture 覆盖矩阵和命令输出。

### T05：Regression and Validation Record

- goal：确认 Flow-M6 未破坏既有 M4/Product-M8 能力，并落 Worktrail 验收候选。
- prerequisites：T01-T04。
- must-read：`tests/integration/extension/tool-wiring.test.ts`、`docs/product-m8-agent-usage.md`、Worktrail validation rules。
- owns：validation candidate only；代码只限必要测试修复。
- must-not-touch：formal `.worktrail` knowledge、Git lifecycle、live services。
- actions：运行 targeted regression；创建 Flow-M6 validation candidate。
- expected outputs：本地验证结果和 pending validation candidate。
- verify：`worktrail review plan --format json`。
- done conditions：AC8、AC9、AC10 通过。
- stop/escalate conditions：需要 promote、commit、push 或 live probe。
- handoff：validation candidate id、测试结果、残留风险。

## 10. 风险与回滚

- 风险：Flow-M6 与 M4 runner 重复。缓解：Flow-M6 runner/report 必须标记 `milestone = Flow-M6` 和 `scope = route_execution_only`；M4 runner 保留为契约验证。
- 风险：M6 混入 M7 状态/表单能力。缓解：runner 只统计 navigate；测试断言非 navigate 不计入成功。
- 风险：修改 `package.json` 造成 root config 变更。缓解：无授权时不改 package script，使用 direct node command；有授权后小改并跑 typecheck/test。
- 风险：Playwright 依赖本地浏览器路径。缓解：沿用现有 integration test 的 `data/playwright-browsers`；缺失时报告环境阻塞，不改产品代码绕过。
- 风险：报告泄露敏感信息。缓解：report schema 禁止 raw input 字段，summary.md 从 summary.json 派生且只写计数、id、revision、managed paths。
- 风险：保存 UISpec 覆盖旧 current。缓解：ProjectStore CAS；Playwright failed 时不发布新的 current UISpec，或 runner 只在 conversion 成功后保存。

## 11. 验收覆盖

- AC1 → Step 2、T02。
- AC2 → Step 2、Step 5、T02、T04。
- AC3 → Step 2、Step 5、T02、T04。
- AC4 → Step 3、Step 5、T03、T04。
- AC5 → Step 1、Step 2、Step 4、Step 5。
- AC6 → Step 1、Step 3、Step 5。
- AC7 → Step 1、Step 3、Step 5。
- AC8 → Step 5、Step 6。
- AC9 → Step 6。
- AC10 → Step 7、T05。

## 12. Residual Assumptions

- 【假设】第一版不需要 live Figma 样本也能证明 Flow-M6 local capability。验证方法：local integration 通过后另建 GATE-LIVE-FLOW-M6 决策。
- 【假设】不新增 package script 也可执行。验证方法：runner integration 直接调用 `node scripts/run-flow-m6.mjs`。
- 【假设】现有 RenderAndCompare functional checks 足以验收 page transition。验证方法：integration test 断言 `expect_page` check passed；如需更细诊断，再局部增强错误消息。

## 13. 下一步

先用 plan-review-loop 审核本计划。审核 clean 后，实施 Flow-M6 local-only T01-T05；实施完成后再创建 validation candidate，等待用户确认 promote。
