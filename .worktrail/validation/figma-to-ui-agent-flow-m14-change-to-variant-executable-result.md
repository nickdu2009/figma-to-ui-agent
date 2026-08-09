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

Flow-M14 第一段目标已完成：真实 Figma `CHANGE_TO` / variant state-change 不再因为缺少预先存在的 UISpec state key 被 Flow-M11 artifact loader 判定为 `flow_plan_reference_dangling`。

修复后，同一个 Product-M9 AC10 restricted-live Community mobile 样本从 artifact-level rejected 前进到 artifact loaded，并生成真实 `set_state` behavior fixtures。

## 修复范围

- `src/flow-plan/m11-artifact-loader.ts`
  - 保持 uiNode、dialog、postcondition、page 引用 fail-closed。
  - 对可信且 confirmed 的 `set_state` interaction，允许缺失 stateKey 交给 `applyFlowPlanToUISpec` hydration 创建。
  - 只在 interaction 带有可用 `value` 时放行，避免无值状态动作被伪装为可执行。
- `tests/unit/flow-plan/m11-artifact-loader.test.ts`
  - 增加可信 `set_state` missing stateKey 的 loader 回归。
  - 原有 submit/postcondition/state dangling 负例仍保持拒绝。

## 验证命令

- `npm exec -- vitest run tests/unit/flow-plan/m11-artifact-loader.test.ts tests/unit/flow-plan/m11-fixture-planner.test.ts tests/unit/flow-plan/m11-report.test.ts tests/unit/runtime/product-m9-flow-contracts.test.ts tests/unit/runtime/product-m9-flow-service.test.ts tests/integration/runtime/product-m9-flow-cli.test.ts`
- `npm run typecheck`
- `git diff --check`
- Local AC10 artifact replay: `node scripts/run-product-m9-flow.mjs --project-id product-m9-ac10-community-mobile-001 --mode local --flow-plan data/projects/product-m9-ac10-community-mobile-001/flow/current.json --ui-spec data/projects/product-m9-ac10-community-mobile-001/specs/current.json --reportRoot data/tmp/product-m9-flow-m14 --runId flow-m14-local-ac10-artifacts --json`
- Restricted-live AC10 rerun: `PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs --project-id product-m9-ac10-community-mobile-001 --mode restricted-live --file-key <redacted> --node-id <redacted> --allow-figma-network --reportRoot reports/product-m9 --runId product-m9-ac10-community-mobile-001-flow-m14-20260809t2017 --json`

## 验证结果

- targeted tests: passed, 6 files / 29 tests
- typecheck: passed
- diff check: passed
- local AC10 artifact replay:
  - Product-M9 status: `partial`
  - error category: `partial_evidence`
  - successfulFixtureIds: 5
  - failedFixtureIds: 0
- restricted-live AC10 rerun:
  - Product-M9 status: `partial`
  - error category: `partial_evidence`
  - trustedStateChange: 12
  - successfulFixtureIds: 5
  - failedFixtureIds: 0
  - `input.networkBoundary.figmaRestCalled=true`
  - `input.networkBoundary.openaiCalled=false`
  - Flow-M11 artifact status: `loaded`
  - `referenceDanglingRejectionCount=0`
  - `summaryOnlyRejectionCount=0`
  - `scenarioOnlyRejectionCount=0`
  - `untrustedSourceRejectionCount=0`

## 产物

- Product-M9 Flow-M14 summary JSON: `reports/product-m9/product-m9-ac10-community-mobile-001-flow-m14-20260809t2017/summary.json`
- Product-M9 Flow-M14 summary Markdown: `reports/product-m9/product-m9-ac10-community-mobile-001-flow-m14-20260809t2017/summary.md`
- Flow-M11 Flow-M14 summary: `reports/product-m9/product-m9-ac10-community-mobile-001-flow-m14-20260809t2017/flow-m11-summary.json`

## 残余风险

- 当前样本仍是 `partial_evidence`，因为 Flow-M11 多步骤 submit/select/radio 覆盖条件未满足：`flow_m11_trusted_submit_fixture_missing`、`flow_m11_multistep_submit_fixture_missing`、`flow_m11_select_radio_toggle_missing`。
- 12 个 trusted `set_state` 中有 5 个生成可执行 fixture；其余 7 个 detached component variant 仍被 `state_action_not_verifiable` 拒绝。下一阶段应做 detached component variant 全量可执行化，而不是放宽 artifact loader。
- 本结果证明 CHANGE_TO / variant target 的 artifact-level dangling 已消除，并证明至少一组真实 variant state-change 可执行；不证明表单提交业务流已完成。
