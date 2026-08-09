---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "product-m9-run-compare-restricted-live-validation",
  "scope": "project",
  "type": "validation",
  "title": "Product-M9 run-compare restricted-live validation",
  "status": "active",
  "lifecycle": "current",
  "topic": "product-m9-real-flowplan-agent-entry"
}
---

# Product-M9 run-compare restricted-live validation

## 结论

Product-M9 CLI 的 `--run-compare` 已接入真实 Playwright / Preview 执行链路。restricted-live Design System 样本可以从 Figma REST 读取、应用 Flow-M10 confirmed answer、生成 confirmed FlowPlan、进入 Flow-M11 fixture planning，并调用 RenderAndCompareService 执行 fixture。

本次真实 compare 结果为 partial，不是接线失败，而是 confirmed answer 使用了弱 postcondition：`expect_visible` 指向点击前已经可见的 Invite 按钮。RenderAndCompare 正确识别为“submit 后置断言在点击前已满足”，因此 failedFixtureIds 包含该 fixture，preSatisfiedExpectationCount=1。

## 实施内容

- `scripts/run-product-m9-flow.mjs` 将 `--run-compare` 从“需要外部注入 runner”改为 CLI 内部接入现有 RenderAndCompareService。
- CLI 支持 `--browser-executable-path`、`--preview-port`、`--compare-timeout-ms`。
- runCompare runner 会把 planner 生成后的 UISpec 保存回 ProjectStore，再按 fixture 隔离启动 RenderAndCompareService。
- 新增 CLI help 测试，覆盖 `--run-compare` 入口。

## 脱敏运行证据

- Product-M9 runCompare restricted-live：`reports/product-m9/product-m9-ac10-design-system-submit-compare-001-20260809t2046/summary.json`
  - status: partial
  - inspect/staticGeneration/flowPlanExtraction/confirmation: passed
  - execution: partial
  - confirmed answer applied=1, rejected=0
  - successfulFixtureIds: []
  - failedFixtureIds: `flow-missing-ui-in-modals-14-4815-control-fixture`
  - figmaRestCalled: true
  - openaiCalled: false

- Flow-M11 summary：`reports/product-m9/product-m9-ac10-design-system-submit-compare-001-20260809t2046/flow-m11-summary.json`
  - status: partial
  - fixtureCount: 1
  - failedFixtureCount: 1
  - failedCheckCount: 1
  - preSatisfiedExpectationCount: 1
  - untrustedSourceRejectionCount: 5
  - referenceDanglingRejectionCount: 0

## 本地验证

- `npm run typecheck`: passed
- `npm exec -- vitest run tests/integration/runtime/product-m9-flow-cli.test.ts tests/unit/runtime/product-m9-flow-service.test.ts`: passed, 14 tests
- `PLAYWRIGHT_BROWSERS_PATH=./data/playwright-browsers npm run test:integration`: passed, 20 files / 80 tests
- `PLAYWRIGHT_BROWSERS_PATH=./data/playwright-browsers npm run test:e2e`: passed, 6 tests
- 新增后复跑 `npm exec -- vitest run tests/integration/runtime/product-m9-flow-cli.test.ts`: passed, 4 tests
- 报告目录脱敏扫描：未命中 token、原始 Figma URL、node-id、file key 或 token 字段；CLI help 中命中的 URL 是占位示例。

## 边界和下一步

- 现在 Product-M9 已能区分 summary-level fixture 成功与真实 Playwright compare 成功。
- 当前 Design System 样本不能证明真实 submit 业务后置变化；它只能证明弱 postcondition 会被拦截。
- 下一步应优先寻找或构造一个具有真实后置变化的 Figma/community 样本，或要求 confirmed answer 指向点击前不可见、点击后由 state effect 显示的可观察节点。
