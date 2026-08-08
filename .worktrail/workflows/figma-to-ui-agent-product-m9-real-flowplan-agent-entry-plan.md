---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-product-m9-real-flowplan-agent-entry-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Product-M9 Real FlowPlan Agent Entry Implementation Plan",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-product-m9-real-flowplan-agent-entry"
}
---

# Product-M9 Real FlowPlan Agent Entry Implementation Plan

## 1. 计划目标

实现 Product-M9：把 Product-M8 的 agent usage loop 和 Flow-M13 已验证的真实 FlowPlan 能力合并成一个稳定产品入口。完成后，PI / mono coding agent 可以用一个命令运行 local 或 restricted-live FlowPlan 交付链路，并通过 JSON result、summary report、artifact refs 和 nextAction 自主判断下一步。

## 2. 来源和边界

正式来源：

- `architecture/figma-to-ui-agent-product-m9-real-flowplan-agent-entry-design.md`
- `architecture/figma-to-ui-agent-product-m8-agent-usage-loop-design.md`
- `workflows/figma-to-ui-agent-product-m8-agent-usage-loop-plan.md`
- `workflows/figma-to-ui-agent-flow-m9-m12-real-flowplan-roadmap.md`
- `workflows/figma-to-ui-agent-flow-m13-real-artifact-closure-plan.md`
- `validation/figma-to-ui-agent-flow-m13-three-sample-closure-v2-result.md`

现有代码入口：

- `scripts/run-figma-to-ui.mjs`
- `scripts/run-flow-m9-restricted-live.mjs`
- `scripts/run-flow-m10-confirmation.mjs`
- `scripts/run-flow-m11-execution.mjs`
- `scripts/run-flow-m12-corpus.mjs`
- `src/runtime/e2e-flow-contracts.ts`
- `src/runtime/e2e-flow-service.ts`
- `src/flow-plan/*`
- `src/project-store/store.ts`

## 3. 授权边界

默认允许：

- 修改/新增 Product-M9 CLI、runtime contracts/service/report、docs、fixtures、tests。
- 运行本地 typecheck/unit/integration。
- 使用本地 fixtures 和 ProjectStore。
- 创建 Product-M9 Worktrail validation candidate。

默认禁止：

- 不调用 OpenAI。
- 不调用真实 Figma REST，除非进入明确 `GATE-PRODUCT-M9-FIGMA`。
- 不新增依赖、不改 `package-lock.json`。
- 不修改 Pi 四工具边界，不新增模型可见 tool。
- 不把真实 token、raw Figma URL、file key、REST payload、`.envrc` 值写入报告或 Worktrail。
- 不自动 promote Worktrail candidates。
- 不提交、不推送，除非用户单独授权。

需要单独 gate：

- `GATE-PRODUCT-M9-FIGMA`：restricted-live Figma REST smoke。
- `GATE-PRODUCT-M9-OPENAI`：任何 OpenAI 调用；首版不需要。
- `GATE-PRODUCT-M9-DEPS`：新增依赖或 lockfile 改动。
- `GATE-PRODUCT-M9-TOOL-BOUNDARY`：修改 Pi 四工具边界；首版不需要。
- `GATE-PRODUCT-M9-GIT`：提交、推送。

## 4. 并行性

[parallelism:
- independent lanes: JSON contract/tests、report markdown、manual docs 可在 T01 契约稳定后并行
- sequential blockers: T00 基线先于修改；T01 result schema 先于 CLI/orchestrator；T02 orchestrator 先于 T03 local smoke；T05 restricted-live 依赖显式 Figma gate；T07 validation candidate 依赖验证结果
- shared write surfaces: `src/runtime/product-m9-*`、`scripts/run-product-m9-flow.mjs`、FlowPlan runner adapters、tests fixtures
- delegation: 0，首版涉及契约和编排边界，单 agent 顺序实施更安全
]

## 5. 验收标准

- AC1：存在单一 Product-M9 agent-facing CLI，例如 `scripts/run-product-m9-flow.mjs`。
- AC2：CLI 支持 local mode，无外部服务即可完成至少一个 smoke。
- AC3：CLI 支持 restricted-live Figma-only mode，但必须显式 gate 和 `--allow-figma-network`。
- AC4：输出稳定 JSON result，包含 `ok`、`status`、`mode`、`projectId`、`runId`、`stages`、`artifactRefs`、`metrics`、`error`、`nextAction`。
- AC5：错误分类覆盖 input invalid、auth missing、Figma 429、permission denied、not found、artifact missing、needs confirmation、unsupported action、flow execution failed、partial evidence、internal error。
- AC6：FlowPlan artifact refs 使用 ProjectStore 或 run artifact 的可审计路径，不输出 raw secret 或 raw Figma payload。
- AC7：只有 `figma` 和 `user_confirmed` 来源可进入 passed 行为验证；`needs_confirmation` 必须返回 partial。
- AC8：不改变 Pi 四工具边界。
- AC9：Product-M9 本地 tests、typecheck、targeted integration 通过。
- AC10：restricted-live smoke 在授权后至少跑 Flow-M13 三样本中的一个 navigate/state-change 样本，输出未调用 OpenAI 证据。
- AC11：创建 Product-M9 validation candidate，记录实现范围、验证命令、外部调用边界和残余风险。

## 6. 实施任务

### T00：基线确认

Landing：无代码改动。

动作：

1. 运行 `worktrail context --semantic=auto "Product-M9 implementation"`。
2. 记录 `git status --short`，确认没有 unrelated dirty work。
3. 读取 Product-M8 docs、Flow-M13 v2 validation、现有 Flow runner scripts。
4. 确认 `src/runtime/tool-boundary.ts` 和 `scripts/start-agent.mjs` 本阶段只读。
5. 确认不需要新增依赖。

验证：

- `git diff --name-status -- src/runtime/tool-boundary.ts scripts/start-agent.mjs package-lock.json` 为空。

覆盖：AC8。

### T01：Product-M9 result contract

Landing：

- `src/runtime/product-m9-flow-contracts.ts`
- `tests/unit/runtime/product-m9-flow-contracts.test.ts`
- `tests/fixtures/product-m9/*.json`

动作：

1. 定义 `productM9RunRequestSchema`、`productM9RunResultSchema`、`productM9ErrorCategorySchema`。
2. 固化 stage result、artifact refs、metrics、nextAction 字段。
3. 建立 success、partial needs-confirmation、failure examples。
4. 添加 secret pattern scan，确保 fixture 不含 token、key、raw URL 或 `.envrc` 值。

验证：

- `npm exec -- vitest run tests/unit/runtime/product-m9-flow-contracts.test.ts`
- examples 全部能被 schema parse。

覆盖：AC4、AC5、AC6。

### T02：Product-M9 orchestrator service

Landing：

- `src/runtime/product-m9-flow-service.ts`
- `src/runtime/product-m9-flow-report.ts`
- `tests/unit/runtime/product-m9-flow-service.test.ts`

动作：

1. 实现 local orchestrator：读取 ProjectStore / fixture 中的 DesignBundle、UISpec、FlowPlan。
2. 复用现有 Flow-M11 fixture/execution/report 逻辑，不复制 FlowPlan 引擎。
3. 将 stage 成功/失败映射到 Product-M9 result。
4. 对 artifact 缺失、需要确认、unsupported、执行失败进行 fail-closed 分类。
5. 输出 `summary.json` 和 `summary.md`，路径建议为 `reports/product-m9/<runId>/`。

验证：

- local service tests 覆盖 passed、partial、failed 三类结果。
- summary markdown 不包含 secret pattern。

覆盖：AC2、AC4、AC5、AC6、AC7。

### T03：Product-M9 CLI entry

Landing：

- `scripts/run-product-m9-flow.mjs`
- `tests/integration/runtime/product-m9-flow-cli.test.ts`
- `package.json` 可选新增 script；若新增 script，需要测试和文档同步。

动作：

1. 实现 `--help`，说明 local / restricted-live / confirmed flow 模式。
2. 支持 `--mode local|restricted-live`、`--project-id`、`--figma-url`、`--flow-plan`、`--answers`、`--json`、`--report-root`、`--allow-figma-network`。
3. invalid args 返回稳定 exit code 和 `input_invalid`。
4. missing gate 返回 `auth_missing`，不得偷偷访问网络。
5. 默认不调用 OpenAI。

验证：

- CLI help test。
- invalid input test。
- missing auth gate test。
- local smoke test。

覆盖：AC1、AC2、AC3、AC4、AC5。

### T04：Local smoke fixture and docs

Landing：

- `docs/product-m9-agent-usage.md`
- `docs/product-m9-manual-test.md`
- `tests/fixtures/product-m9/local-*`

动作：

1. 写 PI / mono agent 使用说明。
2. 写 local smoke 手动测试步骤，默认不需要外部服务。
3. 写 confirmed flow answers file 示例。
4. 明确 reports 策略：`reports/product-m9/` 为运行证据，正式知识通过 Worktrail validation。
5. 明确如何判断 `needs_confirmation` 不等于失败。

验证：

- 文档命令可复制。
- 文档不含 secret。
- docs 和 CLI help 的参数名称一致。

覆盖：AC1、AC2、AC7。

### T05：Restricted-live Figma-only adapter

Landing：

- `src/runtime/product-m9-flow-service.ts`
- `tests/integration/runtime/product-m9-flow-restricted-live.test.ts` 或现有 Flow-M9 runner tests 扩展

动作：

1. 在显式 gate 下复用 FigmaInspector / Flow-M9 restricted-live extraction。
2. 保存 DesignBundle、UISpec、FlowPlan artifact refs。
3. 将 Flow-M13 metrics 映射到 Product-M9 metrics。
4. Figma 429、403、404 分类进入 Product-M9 error category。
5. 保证不传 `--allow-openai` 时没有 OpenAI 调用路径。

验证：

- mock Figma REST integration 覆盖 success、429、permission denied、not found。
- live restricted smoke 只在用户授权 `GATE-PRODUCT-M9-FIGMA` 后执行。

覆盖：AC3、AC5、AC6、AC10。

### T06：Flow execution wiring

Landing：

- `src/runtime/product-m9-flow-service.ts`
- `tests/unit/runtime/product-m9-flow-service.test.ts`
- `tests/integration/runtime/product-m9-flow-cli.test.ts`

动作：

1. 对可信 FlowPlan 生成 Flow-M11 behavior fixture。
2. 执行 Playwright behavior validation。
3. successful / failed fixture ids 写入 metrics。
4. scenario-only、missing postcondition、untrusted source fail closed。

验证：

- 一条 passed local flow。
- 一条 `needs_confirmation` partial。
- 一条 `flow_execution_failed`。
- 一条 scenario-only negative。

覆盖：AC7、AC9。

### T07：Product-M9 validation candidate

Landing：Worktrail pending validation candidate。

动作：

1. 汇总实现文件、测试命令、local smoke、restricted-live smoke 是否执行。
2. 记录是否调用 Figma REST / OpenAI。
3. 记录 artifact refs、summary paths、残余风险。
4. 使用 `worktrail draft create --scope project --type validation` 创建 validation candidate。
5. 等待用户 review/promote confirmation。

验证：

- `worktrail review plan --format json --scope project` 能看到 validation candidate。

覆盖：AC11。

### T08：提交准备

Landing：Git lifecycle，仅在用户授权后执行。

动作：

1. `git status --short` 确认只包含 Product-M9 相关文件。
2. `git diff --check`。
3. 根据授权小提交，commit message 建议：`Implement Product-M9 real FlowPlan entry`。
4. push 只在用户明确授权后执行。

验证：

- commit 后工作树干净。
- 若 push，`git status -sb` 不再 ahead。

## 7. 推荐执行顺序

1. T00 基线确认。
2. T01 result contract。
3. T02 local orchestrator。
4. T03 CLI entry。
5. T04 local docs and fixtures。
6. T05 restricted-live adapter with mock tests。
7. T06 Flow execution wiring。
8. T07 validation candidate。
9. T08 authorized commit/push。

## 8. 风险和回滚

- 如果单入口过大，优先保留 Product-M9 wrapper，内部继续调用现有 runner services；不要复制 FlowPlan 引擎。
- 如果 restricted-live 样本不稳定，保留 mock integration 为硬门禁，live smoke 作为 gated validation evidence。
- 如果 Product-M9 result 与 Product-M8 result 有重叠，保持 Product-M8 静态入口兼容，不修改旧字段语义。
- 如果报告目录膨胀，保持 `reports/product-m9/` 为本地运行证据，长期结论进入 Worktrail validation。
