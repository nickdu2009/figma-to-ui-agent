---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m14-change-to-variant-executable-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M14 CHANGE_TO Variant Executable Result",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m14"
}
---

# Figma-to-UI Agent Flow-M14 CHANGE_TO Variant Executable Result

## 结论

Flow-M14 v2 已把 Product-M9 AC10 Fitness community 样本中的真实 Figma `CHANGE_TO` / component variant state change 全部转成可执行行为 fixture。

本轮修复前，Product-M9 AC10 restricted-live 在 artifact 层已经可以加载，但 12 个可信 `set_state` 中只有 5 个生成 fixture，剩余 7 个 page-root component variant interaction 卡在 `state_action_not_verifiable`。

本轮修复后，`applyFlowPlanToUISpec` 对跨页面 component variant 的 source 如果是 page root，会创建受控 wrapper 作为新的 page root，并把 source variant 与 cloned target variant 放在同一局部容器下，通过同一 `stateKey` / `visibleWhen` 切换。这保持真实 DOM action 与行为 fixture，不退回截图 fallback，也不降低引用校验。

## 验证证据

### 本地 artifact replay

命令：

```bash
node scripts/run-product-m9-flow.mjs \
  --project-id product-m9-ac10-community-mobile-001 \
  --mode local \
  --flow-plan data/projects/product-m9-ac10-community-mobile-001/flow/current.json \
  --ui-spec data/projects/product-m9-ac10-community-mobile-001/specs/current.json \
  --reportRoot data/tmp/product-m9-flow-m14-v2 \
  --runId flow-m14-v2-local-ac10-artifacts \
  --json
```

结果：

- status: `partial`
- trustedStateChange: 12
- successfulFixtureIds: 12
- failedFixtureIds: 0
- partial reason: 当前样本没有 trusted submit / multistep submit / select-radio-toggle 证据。

### Product-M9 AC10 restricted-live

命令：

```bash
PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs \
  --project-id product-m9-ac10-community-mobile-001 \
  --mode restricted-live \
  --file-key <redacted> \
  --node-id 3186:4543 \
  --allow-figma-network \
  --reportRoot reports/product-m9 \
  --runId product-m9-ac10-community-mobile-001-flow-m14-v2-20260809t2025 \
  --json
```

报告：`reports/product-m9/product-m9-ac10-community-mobile-001-flow-m14-v2-20260809t2025/flow-m11-summary.json`

关键结果：

- networkBoundary.figmaRestCalled: true
- networkBoundary.openaiCalled: false
- artifact.status: `loaded`
- artifact.reasonCodes: []
- artifact.rejectionCount: 0
- fixtureCount: 12
- successfulFixtureCount: 12
- failedFixtureCount: 0
- referenceDanglingRejectionCount: 0
- summaryOnlyRejectionCount: 0
- scenarioOnlyRejectionCount: 0
- untrustedSourceRejectionCount: 0

### 代码门禁

已通过：

```bash
npm run typecheck
npm exec -- vitest run \
  tests/unit/flow-plan/to-ui-spec.test.ts \
  tests/unit/flow-plan/m11-fixture-planner.test.ts \
  tests/unit/runtime/product-m9-flow-service.test.ts
```

结果：3 个测试文件通过，23 个测试通过。

## 当前边界

本轮只证明真实 Figma `CHANGE_TO` / component variant state change 可以进入可执行 FlowPlan / UISpec / fixture 闭环。

Product-M9 AC10 状态仍为 `partial`，不是因为 variant state change 失败，而是 Fitness 样本没有覆盖：

- trusted submit fixture
- multistep submit fixture
- select / radio / toggle fixture

这些需要后续用真实表单、checkout、settings 类 community 样本继续补证。
