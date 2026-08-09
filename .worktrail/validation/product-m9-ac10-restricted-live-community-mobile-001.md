---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "product-m9-ac10-restricted-live-community-mobile-001",
  "scope": "project",
  "type": "validation",
  "title": "Product-M9 AC10 Restricted-Live Community Mobile Validation",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-product-m9-real-flowplan-agent-entry"
}
---

# Product-M9 AC10 Restricted-Live Community Mobile Validation

## 结论

Product-M9 AC10 已执行一个 Flow-M13 来源的真实 Community mobile state-change 样本 restricted-live smoke。结果为 `partial_evidence`，不是 `passed`。

该结果满足 AC10 的网络边界和产物链路要求：restricted-live 只调用 Figma REST，不调用 OpenAI；DesignBundle、UISpec、真实 FlowPlan artifact 和 Product-M9 summary 均生成。它不满足行为可执行通过，因为 Flow-M11 artifact loader 检出 12 个 `flow_plan_reference_dangling`，当前样本的 CHANGE_TO / variant target 还没有映射为 UISpec 可引用节点或可观察 postcondition。

## 验证命令

- Product-M9 targeted tests: `npm exec -- vitest run tests/unit/runtime/product-m9-flow-service.test.ts tests/unit/runtime/product-m9-flow-contracts.test.ts tests/integration/runtime/product-m9-flow-cli.test.ts`
- Typecheck: `npm run typecheck`
- AC10 restricted-live smoke: `PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs --project-id product-m9-ac10-community-mobile-001 --mode restricted-live --file-key <redacted> --node-id <redacted> --allow-figma-network --reportRoot reports/product-m9 --runId product-m9-ac10-community-mobile-001-20260809t2002 --json`

## 验证结果

- targeted tests: passed, 3 files / 16 tests
- typecheck: passed
- AC10 runId: `product-m9-ac10-community-mobile-001-20260809t2002`
- Product-M9 status: `partial`
- Product-M9 error category: `partial_evidence`
- trustedNavigate: 0
- trustedStateChange: 12
- unsupported: 0
- missingEvidence: 0
- successfulFixtureIds: []
- failedFixtureIds: []

## 产物

- Product-M9 summary JSON: `reports/product-m9/product-m9-ac10-community-mobile-001-20260809t2002/summary.json`
- Product-M9 summary Markdown: `reports/product-m9/product-m9-ac10-community-mobile-001-20260809t2002/summary.md`
- Flow-M11 summary: `reports/product-m9/product-m9-ac10-community-mobile-001-20260809t2002/flow-m11-summary.json`
- DesignBundle artifact ref: `data/projects/product-m9-ac10-community-mobile-001/figma/current.json`
- UISpec artifact ref: `data/projects/product-m9-ac10-community-mobile-001/specs/current.json`
- FlowPlan artifact ref: `data/projects/product-m9-ac10-community-mobile-001/flow/current.json`

## 外部调用边界

- Figma REST: called, authorized by `GATE-PRODUCT-M9-FIGMA`
- OpenAI: not called
- Flow-M11 summary evidence: `input.networkBoundary.figmaRestCalled=true`, `input.networkBoundary.openaiCalled=false`, `input.networkBoundary.mode=restricted-live`

## 实现修复

本次 AC10 首次运行暴露 Product-M9 synthetic Flow-M11 validation summary 的内部一致性问题：没有可执行 fixture 时 `passed=false` 但 `failedFixtureIds=[]`，违反 Flow-M11 summary schema。已修复为 synthetic summary 与 `failedFixtureIds` 保持一致，并新增合法 state-change no-executable 单测，确保 Product-M9 返回 `partial_evidence` 而不是内部 schema 失败。

## 残余风险

- 当前真实样本的 state-change / variant target 仍然产生 `flow_plan_reference_dangling`，说明 Product-M9 已能读取真实交互并生成真实 FlowPlan，但 Flow-M11 可执行层还不能验证这些 variant target。
- 下一步应修复 CHANGE_TO / variant target 到 UISpec 节点或可观察 postcondition 的映射，再重新跑 AC10，使 restricted-live state-change 样本从 `partial_evidence` 推进到可执行验证。
- 本记录不证明真实后端业务提交成功；它只证明 Product-M9 restricted-live Figma-only 入口、产物生成、网络边界和失败分类。
