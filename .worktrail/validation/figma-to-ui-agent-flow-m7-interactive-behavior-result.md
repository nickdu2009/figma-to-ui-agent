---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m7-interactive-behavior-result",
  "scope": "project",
  "type": "validation",
  "title": "Flow-M7 interactive_behavior 本地实现验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m7"
}
---

# Flow-M7 interactive_behavior 本地实现验收记录

## 1. 范围

本记录对应 `Flow-M7 interactive_behavior` 本地实现验收。实现范围包括：

- Flow-M7 report schema。
- Flow-M7 behavior scenario schema。
- Flow-M7 trusted non-route interaction executor。
- Flow-M7 local runner `scripts/run-flow-m7.mjs`。
- Flow-M7 计划兼容入口 `scripts/flow-m7-local.mjs`。
- UISpec behavior step：`expect_value`、`expect_checked`。
- RenderAndCompare 对 `fill` / `toggle` 后置断言、value/checked 断言的执行支持。
- 本地 fixtures 和单元/集成测试。

本记录不代表 restricted-live/live Figma 或 OpenAI 验收；当前实现不调用外部服务、不新增依赖、不改变 Pi 四工具边界。

## 2. 已完成验收项

- AC1：Flow-M7 有独立 report schema，scope 为 `interactive_behavior`。
- AC2：`passed` 需要 `trustedNonRouteConverted >= 1`、`validation.passed=true`，且至少一个非 navigate flow fixture 成功。
- AC3：scenario-only 不得产生 `passed`；本地测试覆盖 partial 结果和 `flow_m7_scenario_only_not_sufficient`。
- AC4：可信 `set_state` 可转换为 UISpec action，并可被本地 runner 统计和验证。
- AC5：可信 `open_dialog` 可转换为 UISpec action，并通过 dialog 可见性验证。
- AC6：表单 `fill` / `toggle` 必须有 `expect_value` / `expect_checked` 或其他后置断言；无后置断言会失败关闭。
- AC7：submit-like 需要可信 converted action 和 post-click observable change；静态可见性/静态文本断言会被拒绝。
- AC8：缺少可信来源或 confirmed 的 interaction 不转换。
- AC9：Flow-M6 route_execution_only targeted regression 通过。
- AC10：typecheck、unit、integration、e2e 均通过；M3 local probe 受冻结漂移限制，见残留风险。
- AC11：本 validation candidate 已创建，等待人工 review/promote。

## 3. 验证命令

已通过：

```bash
npm run typecheck
npm run test:unit
npx vitest run tests/unit/flow-plan/m7-report.test.ts tests/unit/flow-plan/m7-scenario.test.ts tests/unit/flow-plan/m7-interactions.test.ts tests/unit/contracts/ui-spec.test.ts
npx vitest run tests/integration/flow-plan/flow-m7-interactive-behavior.test.ts
npx vitest run tests/integration/validation/render-and-compare.test.ts
npx vitest run tests/integration/flow-plan/flow-m6-route-execution.test.ts
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e
git diff --check
```

结果摘要：

- `npm run test:unit`：47 files / 276 tests passed。
- `npx vitest run tests/integration/flow-plan/flow-m7-interactive-behavior.test.ts`：1 file / 3 tests passed，覆盖 passed、partial、failed 三类 report。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration`：13 files / 56 tests passed。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e`：6 tests passed。

未通过但已解释：

```bash
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run probe:m3:local
```

失败原因：`scripts/run-m3-flow.mjs` 在 M3 freeze 检查阶段返回 `m3_preflight_drift:package.json`，manifest/blind 也会因已存在的 M3 frozen source drift fail closed。该 probe 仍证明 M3 冻结保护有效，但不能作为 post-M3 代码演进后的绿色回归门禁。

## 4. 产物

- `src/flow-plan/m7-report.ts`
- `src/flow-plan/m7-scenario.ts`
- `src/flow-plan/m7-interactions.ts`
- `src/flow-plan/m7-runner.ts`
- `scripts/run-flow-m7.mjs`
- `scripts/flow-m7-local.mjs`
- `tests/fixtures/flow-plan/m7-interactive-flow.json`
- `tests/fixtures/flow-plan/m7-interactive-ui-spec.json`
- `tests/fixtures/flow-plan/m7-interactive-scenario.json`
- `tests/fixtures/flow-plan/m7-scenario-only.json`
- `tests/fixtures/flow-plan/m7-invalid-submit-like.json`
- `tests/fixtures/flow-plan/m7-failing-scenario.json`
- `tests/unit/flow-plan/m7-report.test.ts`
- `tests/unit/flow-plan/m7-scenario.test.ts`
- `tests/unit/flow-plan/m7-interactions.test.ts`
- `tests/integration/flow-plan/flow-m7-interactive-behavior.test.ts`

## 5. 残留风险

1. `probe:m3:local` 不再适合作为 post-M3 源码演进后的绿色门禁；它当前会被 freeze drift fail closed 阻断。
2. Flow-M7 v1 不新增 submit action kind；复杂业务状态机、select/radio 完整选择语义和真实后端仍不在本期范围。
3. 当前验收为 local-only；restricted-live/live Figma 样本需要独立 gate。
