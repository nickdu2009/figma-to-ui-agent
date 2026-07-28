---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-product-m8-agent-usage-loop-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Product-M8 PI Agent Usage Loop Implementation Plan",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-product-m8-agent-usage-loop"
}
---

# Product-M8 PI Agent Usage Loop Implementation Plan

## 1. 计划目标

本计划用于指导 coding agent 实现 Product-M8：让 PI / mono coding agent 能稳定调用 Figma-to-UI Agent 的 Product-M7 CLI，并从稳定 JSON、summary 报告和错误建议中自主判断下一步。

Product-M8 是 agent-facing 使用闭环，不是新的 Figma 视觉保真阶段，也不是 FlowPlan 业务交互阶段。

## 2. 来源和对齐

正式来源：

- `architecture/figma-to-ui-agent-product-m8-agent-usage-loop-design.md`
- `workflows/figma-to-ui-agent-post-m7-roadmap.md`
- `rules/figma-to-ui-agent-milestone-naming.md`
- `validation/figma-to-ui-agent-product-m7-smoke-addendum.md`
- `architecture/figma-to-ui-agent-m7-e2e-productized-flow-design.md`
- `workflows/figma-to-ui-agent-m7-e2e-productized-flow-implementation-plan.md`

现有代码来源：

- `scripts/run-figma-to-ui.mjs`
- `src/runtime/e2e-flow-contracts.ts`
- `src/runtime/e2e-flow-service.ts`
- `src/runtime/e2e-flow-report.ts`
- `tests/unit/runtime/e2e-flow-*.test.ts`
- `tests/integration/runtime/e2e-flow-cli.test.ts`
- `.gitignore`

## 3. 授权边界

默认允许：

- 修改 CLI help 和参数说明。
- 新增 agent-facing docs、examples、manual test docs。
- 新增本地 tests 和 fixtures。
- 运行本地 typecheck/unit/integration。
- 创建 Worktrail validation candidate。

默认禁止：

- 不调用 Figma live API。
- 不调用 OpenAI。
- 不新增依赖，不修改 `package-lock.json`。
- 不新增 PI tool，不修改 `src/runtime/tool-boundary.ts` 或 `scripts/start-agent.mjs`。
- 不提交、不推送，除非单独授权。
- 不清理大量历史 reports。

需要单独 gate：

- `GATE-PRODUCT-M8-LIVE-FIGMA`
- `GATE-PRODUCT-M8-OPENAI`
- `GATE-PRODUCT-M8-DEPS`
- `GATE-PRODUCT-M8-PI-TOOL`
- `GATE-PRODUCT-M8-GIT`

## 4. 并行性

[parallelism:
- independent lanes: docs/examples、CLI help polish、schema/example tests 可在契约确认后并行
- sequential blockers: T01 agent decision contract 先于 examples/tests；T02 CLI help 先于 manual guide final copy；T05 validation candidate 依赖 T03/T04 验证结果
- shared write surfaces: `scripts/run-figma-to-ui.mjs`、`src/runtime/e2e-flow-contracts.ts`、`tests/integration/runtime/e2e-flow-cli.test.ts`、docs/examples 路径
- delegation: 0，Product-M8 首版表面小但涉及 agent-facing 契约一致性，单 agent 顺序实施更安全
]

## 5. 验收标准

- AC1：PI / mono coding agent 可以通过一条 documented CLI 调用 local mode。
- AC2：PI / mono coding agent 可以理解 restricted-live Figma-only 调用方式和 gate。
- AC3：成功 JSON 示例与 `m7RunResultSchema` 一致。
- AC4：失败 JSON 示例覆盖 `input_invalid`、`auth_missing`、`figma_rate_limited`、`figma_permission_denied`、`figma_not_found`。
- AC5：agent decision table 覆盖所有 `M7RunErrorCategory`。
- AC6：manual test doc 明确如何确认没有调用 OpenAI。
- AC7：`.gitignore` 和文档都明确 `reports/m7-e2e/` 为本地报告目录。
- AC8：tool boundary 保持现有四工具不变。
- AC9：本地 typecheck、targeted unit/integration 通过。
- AC10：最终 Product-M8 validation candidate 记录实现范围和验证结果。

## 6. 实施任务

### T00：基线确认

Landing：无代码改动。

动作：

1. 运行 Worktrail context，确认 Product-M8 设计和计划已 promote。
2. 读取 current `scripts/run-figma-to-ui.mjs`、`src/runtime/e2e-flow-contracts.ts`、Product-M7 validation、Product-M7 smoke addendum。
3. 记录 `git status --short`，不清理 unrelated untracked 文件。
4. 确认 `reports/m7-e2e/` 已被 `.gitignore` 忽略。
5. 确认 `src/runtime/tool-boundary.ts` 和 `scripts/start-agent.mjs` 本阶段只读。

验证：

- 输出基线说明。
- `git diff --name-status -- src/runtime/tool-boundary.ts scripts/start-agent.mjs package-lock.json` 为空。

覆盖：AC7、AC8。

### T01：定义 agent decision table 和 example policy

Landing：建议新增或更新：

- `docs/product-m8-agent-usage.md`，若项目已有 docs 约定，则使用既有 docs 路径。
- 或 Worktrail/README 之外的 repo doc：`docs/product-m8-agent-usage.md` 作为用户可读说明。
- 测试 fixtures：`tests/fixtures/product-m8/*.json` 或现有 fixture 目录。

动作：

1. 写 agent decision table，覆盖所有 `M7RunErrorCategory`。
2. 说明 retry policy：`do_not_retry`、`retry_after_fix`、`retry_after_wait`、`manual_review`。
3. 明确 examples 不得包含 token/secret。
4. 明确 examples 必须能被 schema parse。

验证：

- 新增测试读取 examples 并用 `m7RunResultSchema` parse。
- 测试 redaction 示例不含 `figd_`、`sk-`、`OPENAI_API_KEY` 值。

覆盖：AC3、AC4、AC5。

### T02：CLI help 和 usage polish

Landing：

- `scripts/run-figma-to-ui.mjs`
- `tests/integration/runtime/e2e-flow-cli.test.ts`

动作：

1. 更新 `--help`，明确 Product-M8 agent-facing usage。
2. 在 help 中给出 local 和 restricted-live 最小示例。
3. 明确 `--allow-openai` 只有 live/full live 才需要，restricted-live Figma-only 不传。
4. 保持参数向后兼容。
5. 不新增依赖。

验证：

- CLI help test 断言包含 local example、restricted-live example、gate 文案、summary path 文案。
- invalid argument 仍返回 exit code 2。

覆盖：AC1、AC2、AC6、AC7。

### T03：JSON examples 和 failure fixtures

Landing：

- `tests/fixtures/product-m8/local-success.json`
- `tests/fixtures/product-m8/restricted-live-success.json`
- `tests/fixtures/product-m8/input-invalid.json`
- `tests/fixtures/product-m8/auth-missing.json`
- `tests/fixtures/product-m8/figma-rate-limited.json`
- `tests/fixtures/product-m8/figma-permission-denied.json`
- `tests/fixtures/product-m8/figma-not-found.json`
- `tests/unit/runtime/product-m8-examples.test.ts`

动作：

1. 以真实 M7 result schema 写最小 JSON examples。
2. 对成功样例包含 artifact refs 和 summary paths。
3. 对失败样例包含 `error.category`、`recoverable`、`nextAction`。
4. 不包含真实 token、完整私有 payload 或 `.envrc` 值。

验证：

- 所有 fixture 被 `m7RunResultSchema` parse。
- 每个 fixture 的 `m7ExitCode` 符合预期。
- fixture 内容通过 secret pattern scan。

覆盖：AC3、AC4、AC5、AC9。

### T04：Manual test doc

Landing：

- `docs/product-m8-manual-test.md`

动作：

1. 写 local smoke 手动流程，优先显式 `designBundleRevision`。
2. 写 restricted-live Figma-only 手动流程，说明只传 `--allow-figma-network`。
3. 写如何确认未调用 OpenAI：命令不传 `--allow-openai`，result nextAction 说明未调用 OpenAI，report 中 mode 为 `restricted-live`。
4. 写如何读取 summary 和 artifact refs。
5. 写 reports 策略：`reports/m7-e2e/` 本地忽略，不随手提交。

验证：

- 文档命令可复制执行；local 命令默认不需要外部服务。
- 文档不包含 secret。

覆盖：AC1、AC2、AC6、AC7。

### T05：Agent usage regression tests

Landing：

- `tests/unit/runtime/product-m8-examples.test.ts`
- `tests/integration/runtime/e2e-flow-cli.test.ts`
- 可选：`tests/integration/extension/tool-wiring.test.ts`

动作：

1. 扩展 CLI help integration test。
2. 新增 examples schema test。
3. 新增 decision table coverage test，保证所有 error categories 都有 agent action。
4. 确认 tool boundary 不变；若已有测试覆盖，只运行不改。

验证：

- `npm run typecheck`
- targeted tests：Product-M8 example tests + CLI help tests。
- 如触及 shared behavior，再运行 `npm run test:unit` 或相关 integration。

覆盖：AC3、AC4、AC5、AC8、AC9。

### T06：Product-M8 validation candidate

Landing：Worktrail pending validation candidate。

动作：

1. 使用 `worktrail draft create --scope project --type validation` 创建 Product-M8 validation candidate。
2. 记录实现文件、命令、测试结果、未调用外部服务声明。
3. 记录 local example 和 restricted-live instruction 覆盖情况。
4. 记录仍需 gate 的 live/OpenAI 验证。
5. 等待 review/promote confirmation，除非用户已明确授权。

验证：

- `worktrail review plan --format json` 中能看到 Product-M8 validation candidate。

覆盖：AC10。

## 7. 推荐执行顺序

1. T00：基线确认。
2. T01：agent decision table 和 example policy。
3. T02：CLI help polish。
4. T03：JSON examples 和 schema tests。
5. T04：manual test doc。
6. T05：targeted validation。
7. T06：Worktrail validation candidate。

## 8. 风险和回滚

- 如果 CLI help 文案导致测试脆弱，回滚为更稳定的 section heading 断言，而不是检查整段文本。
- 如果 examples 与 schema 漂移，优先修 examples；不得放宽 schema 来适配错误示例。
- 如果 docs 路径与项目约定冲突，保留内容但移动到项目已存在 docs 路径；不重复维护两份文档。
- 如果 Product-M8 需要新增 runtime helper，应先确认它不是新的 M8 runtime contract；否则回到设计修订。
- 如果用户要求 PI tool 集成，停止 Product-M8 实现，进入 `GATE-PRODUCT-M8-PI-TOOL` 设计。

## 9. 完成定义

Product-M8 实现完成需同时满足：

- Product-M8 usage guide 存在并覆盖 local / restricted-live / live gate。
- Manual test doc 存在并能指导本地和 restricted-live smoke。
- JSON examples 覆盖成功和关键失败路径，且通过 schema parse。
- Agent decision table 覆盖全部 M7 error categories。
- CLI help 对 agent 可用。
- Tool boundary 未变化。
- 本地 targeted tests 通过。
- Product-M8 validation candidate 已创建；promote 需用户确认或明确授权。

## 10. 下一步

计划 promote 后，进入 Product-M8 实现。默认实现边界仍为本地、无外部服务、无依赖变更、无 Git lifecycle。
