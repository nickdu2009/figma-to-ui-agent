---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "product-m9-confirmed-submit-restricted-live-validation",
  "scope": "project",
  "type": "validation",
  "title": "Product-M9 confirmed submit restricted-live validation",
  "status": "active",
  "lifecycle": "current",
  "topic": "product-m9-real-flowplan-agent-entry"
}
---

# Product-M9 confirmed submit restricted-live validation

## 结论

Product-M9 已支持在 Flow-M11 执行前应用 Flow-M10 结构化确认答案，并能把用户确认的 submit-like 交互转换为可执行 fixture。restricted-live Design System 样本复跑结果为：执行阶段 passed，生成 1 个 confirmed submit fixture，fixture 成功 1/1，失败 0。

整体 Product-M9 run 仍为 partial，因为同一个样本中还有 5 个未确认/unsupported 交互按 fail-closed 策略保留为 pending，不被猜测执行。

## 实施内容

- Product-M9 run 增加 `answersPath` 应用链路：读取 Flow-M10 answers，基于当前 FlowPlan 生成确认问题，应用答案后写出 `confirmed-flow-plan.json`，再进入 Flow-M11。
- Flow-M10 answer applier 对布尔 `submit` / `set_state` effect 推导可 hydrate 的初始值：目标 `true` 推导初始 `false`，目标 `false` 推导初始 `true`；字符串/数字不做默认业务推导。
- Flow-M11 artifact loader 允许可信 confirmed `submit` 的 set_state effect 在 postcondition 可验证时交给 UISpec hydration 创建 state entry。
- 未确认或 unsupported interactions 仍作为 partial artifact rejections 保留，不进入可执行 fixture。

## 脱敏运行证据

- 六样本 restricted-live extraction：`reports/flow-m14-next/flow-m14-next-six-sample-extraction-20260809t2030/summary.json`
  - status: passed
  - readableSamples: 6
  - trustedStateChange: 12
  - submitLikeNeedsConfirmation: 9
  - missingEvidence: 7
  - notAccessible: 0
  - figmaRestCalled: true
  - openaiCalled: false

- Product-M9 Design System confirmed submit restricted-live：`reports/product-m9/product-m9-ac10-design-system-submit-001-20260809t2041/summary.json`
  - status: partial
  - execution stage: passed
  - confirmation stage: passed, applied=1, rejected=0
  - successfulFixtureIds: `flow-missing-ui-in-modals-14-4815-control-fixture`
  - failedFixtureIds: []
  - pending reason: `flow_plan_untrusted_source`

- Flow-M11 execution summary：`reports/product-m9/product-m9-ac10-design-system-submit-001-20260809t2041/flow-m11-summary.json`
  - status: passed
  - fixtureCount: 1
  - successfulFixtureCount: 1
  - failedFixtureCount: 0
  - stepCount: 20
  - failedCheckCount: 0
  - untrustedSourceRejectionCount: 5
  - referenceDanglingRejectionCount: 0
  - figmaRestCalled: true
  - openaiCalled: false

## 本地验证

- `npm run typecheck`: passed
- `npm run test:unit`: passed, 62 files / 354 tests
- `PLAYWRIGHT_BROWSERS_PATH=./data/playwright-browsers npm run test:integration`: passed, 20 files / 80 tests
- `PLAYWRIGHT_BROWSERS_PATH=./data/playwright-browsers npm run test:e2e`: passed, 6 tests
- 报告目录脱敏扫描：未命中 token、原始 Figma URL、node-id、file key 或 token 字段；源码/测试中的命中为合法 URL 构造或 fixture URL。

## 边界

- 本次验证证明 confirmed submit answer 能进入 Product-M9 agent entry、生成 confirmed FlowPlan、通过 M11 artifact load、生成多步骤 submit fixture 并执行成功。
- 本次验证不证明 Figma 原型中存在真实 submit 后置业务页面；该 Community 样本没有可自动信任的 submit postcondition，因此仍依赖用户确认答案。
- 本次 run 未调用 OpenAI。
