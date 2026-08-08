---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m10-confirmation-semantics-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M10 真实语义补全与用户确认实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m10"
}
---

# Figma-to-UI Agent Flow-M10 真实语义补全与用户确认实施计划

## 1. 来源与边界

本计划执行 Flow-M10 真实语义补全与用户确认设计，承接：

- Flow-M8：本地 submit、postcondition、stateMachine、select/radio、RenderAndCompare 因果校验已完成。
- Flow-M9：真实 Figma restricted-live 抽取已 passed，3 个 primary 样本全部 readable，`submitLikeNeedsConfirmation=8`。
- Flow-M9~M12 roadmap：Product 线后置，当前继续 Flow 线。

边界：默认 local-only，不调用 OpenAI，不默认访问 Figma，不新增依赖，不修改 package-lock，不改变四工具边界，不执行 Git lifecycle，除非单独授权。

关键实施事实：Flow-M9 summary report 可以证明真实 `needs_confirmation.submit_like` 来源，但其中 `flowPlanPath` 当前可能是 `ephemeral-flow-plan`。因此 M10 restricted-live-regression 必须区分两类证据：真实 M9 summary 用于 question provenance；answer apply 和 M8 消费必须使用受控 fixture FlowPlan 或未来已落盘的完整 FlowPlan artifact。

## 2. 验收标准

- AC1：新增 Flow-M10 question schema，能表达 submit-like、navigate、set_state、open_dialog、stateMachine transition。
- AC2：新增结构化 answer schema，支持 submit effect、postconditions、decline、rejected/invalid/unmatched 结果。
- AC3：Flow-M9 `needs_confirmation.submit_like` 只生成 question，不直接生成 submit action。
- AC4：合法结构化 answer 可写回 `user_confirmed submit`，并能被 Flow-M8 planner 消费。
- AC5：缺 postcondition、悬空引用、answerKind 不匹配、不可信来源、unsupported 强转必须 fail closed。
- AC6：新增 Flow-M10 report schema，统计 generated/applied/rejected/unmatched/summaryOnlyQuestions/userConfirmedSubmit。
- AC7：本地 fixture 证明合法与非法答案路径；默认验证不调用 OpenAI/Figma。
- AC8：restricted-live 回归复用 Flow-M9 三个样本的本地 report 证明真实 submit-like 候选进入 question 链路；apply 成功必须由可读取 FlowPlan fixture 或 artifact 证明。
- AC9：Flow-M8 submit/stateMachine 回归继续通过。
- AC10：Worktrail validation 记录本地和 restricted-live-regression 结果，报告脱敏通过。

## 3. 并行与授权

[parallelism:
- independent lanes: schema/report 与 fixture 起草可并行阅读，但代码落地应单线串行，避免公共 FlowPlan contract 冲突
- sequential blockers: T00 -> T01/T02 -> T03 -> T04/T05 -> T06 -> T07 -> T08
- shared write surfaces: `src/flow-plan/schema.ts`、FlowPlan confirmation modules、M8 planner inputs、runner scripts、fixtures/tests
- delegation: 0，公共 schema 与 confirmation 写回路径共享面太大
]

单独授权门禁：

- Git commit/push。
- 任何真实 Figma 重新访问。
- 依赖或 package-lock 变更，本计划默认不需要。
- 四工具边界变更，本计划明确禁止。

## 4. 实施任务

### T00 基线检查

落点：只读。

动作：

- 检查 `git status --short --branch`。
- 检查 `src/runtime/tool-boundary.ts` 的四工具边界未变。
- 读取 Flow-M8/M9 validation、Flow-M9 restricted-live report、相关 schema/service/planner 文件。
- 确认 Flow-M9 summary 中 `flowPlanPath` 是否可读取；若为 `ephemeral-flow-plan`，后续 apply 只允许使用 fixture FlowPlan。

验证：

- 工作区变更可解释。
- Worktrail review pending 状态明确。
- 无外部服务调用。
- M9 summary-only 与可应用 FlowPlan 载体边界明确。

覆盖：AC7、AC8、AC9。

### T01 Schema 与类型

落点：

- `src/flow-plan/m10-schema.ts` 或在 `src/flow-plan/schema.ts` 中最小扩展。
- `tests/unit/flow-plan/m10-schema.test.ts`。

动作：

- 定义 `flowM10ConfirmationQuestionSchema`，包含 `applyCarrier: "flow_plan" | "summary_only"`。
- 定义 `flowM10ConfirmationAnswerSchema`。
- 定义 `flowM10ConfirmationApplyResultSchema`。
- 保持旧 `flowConfirmationInputSchema` 兼容，不破坏 M4/M8 测试。

验证：

- 合法 submit/navigate/set_state/open_dialog/decline answer parse 通过。
- 缺 postcondition、非法 answerKind、超长文本、敏感字段 parse 或 redaction check 失败。
- summary-only question 不能被 schema 表达为已应用状态。

覆盖：AC1、AC2、AC5。

### T02 Question Generator

落点：

- `src/flow-plan/m10-confirmation-questions.ts`。
- `tests/unit/flow-plan/m10-confirmation-questions.test.ts`。

动作：

- 从 FlowPlanDraft 和可选 Flow-M9 sample/classification 输入生成结构化 questions。
- 对 `needs_confirmation.submit_like` 生成 `questionKind="submit_like"`。
- 对只有 M9 summary 的真实样本生成 `applyCarrier="summary_only"` 的 question provenance 记录。
- 对普通 inferred/missing navigate 继续支持 navigate question。
- 对可信 figma confirmed interaction 不重复生成问题。

验证：

- Flow-M9 login/design-system submit-like 输入生成 question。
- `source="figma" confirmed=true` 不生成 question。
- 输出不包含 Figma URL/file key/raw payload。
- summary-only question 不被计入 applied。

覆盖：AC1、AC3、AC8。

### T03 Answer Applier

落点：

- `src/flow-plan/m10-apply-confirmations.ts`。
- `tests/unit/flow-plan/m10-apply-confirmations.test.ts`。

动作：

- 解析结构化 answers。
- 校验 questionId、interactionId、answerKind、page/node/state/postcondition 引用。
- 合法 submit answer 写回 `source="user_confirmed"`、`confirmed=true`、`intent="submit"`、`trigger="submit"`、postconditions。
- 对 `applyCarrier="summary_only"` 且无对应 FlowPlan interaction 的答案返回 rejected，不修改 FlowPlan。
- decline/invalid/unmatched 写入 apply result，不生成业务 action。
- 保持幂等，重复答案不重复计数。

验证：

- 合法 submit:set_state + expect_visible 应用成功。
- 缺 postcondition 被 rejected。
- 悬空 node/page/state 被 rejected。
- answerKind 与 question 不匹配被 rejected。
- summary-only answer 无载体时被 rejected。
- scenario-only 无法变成 passed 依据。

覆盖：AC2、AC4、AC5。

### T04 Report 与脱敏

落点：

- `src/flow-plan/m10-report.ts`。
- `tests/unit/flow-plan/m10-report.test.ts`。

动作：

- 定义 `flowM10ConfirmationReportSchema`。
- 统计 generatedQuestions、submitLikeQuestions、answersReceived、applied、declined、rejected、invalid、unmatched、summaryOnlyQuestions、userConfirmedSubmit、userConfirmedStateMachineTransitions。
- 增加 `redactionCheckFlowM10Report`。

验证：

- passed 条件复算一致。
- aggregate/counts 与 samples/apply results 不一致时报错。
- summary-only question 只能支持 provenance，不能满足 applied 条件。
- token、Figma URL、fileKey/designUrl/rawResponse 被拒绝。

覆盖：AC6、AC10。

### T05 本地 Fixture 与 Runner

落点：

- `scripts/run-flow-m10-confirmation.mjs`。
- `tests/fixtures/flow-plan/m10-confirmation-semantics/`。
- `tests/integration/flow-plan/flow-m10-confirmation.test.ts`。

动作：

- 准备 local FlowPlan、UISpec、M9-like report、answers fixture。
- Runner local 模式生成 questions、应用 answers、调用 Flow-M8 planner/runner 或至少验证 M8 planner 可消费输出。
- 输出 `reports/flow-m10-confirmation/<runId>/summary.json|summary.md`。

验证：

- local run status passed。
- 至少 1 个 user_confirmed submit。
- 至少 1 个 rejected answer。
- M8 planner 转换结果包含可信 submit 或 stateMachine transition。

覆盖：AC4、AC5、AC6、AC7、AC9。

### T06 Fail-closed 回归

落点：

- T03/T04/T05 对应测试。

动作：

- 增加负例：缺 postcondition、悬空 page/node/state、unsupported 强转、answerKind 不匹配、重复 answer、敏感字段、summary-only 无 apply 载体。
- 确保失败只进入 report/rejections，不修改 FlowPlan 为 confirmed。

验证：

- targeted unit/integration 全通过。
- 负例检查应用后 interaction 仍不是 `user_confirmed confirmed=true`。

覆盖：AC5、AC10。

### T07 Restricted-live 回归

落点：

- `scripts/run-flow-m10-confirmation.mjs`。
- `tests/integration/flow-plan/flow-m10-restricted-live-regression.test.ts` 或并入 T05 integration。
- `reports/flow-m10-confirmation/<runId>/`。

动作：

- 默认复用 `reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json`，不重新调用 Figma。
- 从 `community-login-001` 或 `community-design-system-001` 的 submit-like classification 生成 `summary_only` question。
- 同一轮 run 中使用受控 fixture FlowPlan 和 fixture answer 应用为 `user_confirmed submit`，证明 answer applier 与 M8 链路。
- 报告必须分别呈现：真实样本 question provenance、fixture apply evidence、M8 consumption evidence。
- 如必须刷新真实 Figma 样本，要求 `FLOW_M10_RESTRICTED_LIVE_AUTHORIZED=1` 与 `--allow-figma-network`，并单独记录 networkBoundary。

验证：

- restricted-live-regression report status passed 或 partial with machine-readable reason。
- `networkBoundary.figmaRestCalled=false`，除非用户显式授权刷新。
- 报告脱敏通过。
- 不把 `ephemeral-flow-plan` 作为已应用 FlowPlan artifact。

覆盖：AC8、AC10。

### T08 Worktrail Validation

落点：Worktrail pending validation candidate。

动作：

- 创建 `validation/figma-to-ui-agent-flow-m10-confirmation-semantics-result.md` candidate。
- 记录本地验证、restricted-live-regression、报告路径、脱敏结论、残留风险。
- 明确 restricted-live-regression 的两类证据边界：M9 summary provenance 与 fixture/applicable FlowPlan apply evidence。
- 运行 `worktrail review plan --format json`。

验证：

- candidate redaction clean。
- review plan 无隐藏未处理事项或明确需要用户确认。

覆盖：AC10。

## 5. 验证矩阵

最低本地门禁：

- `npm run typecheck`
- `npm exec -- vitest run tests/unit/flow-plan/m10-schema.test.ts tests/unit/flow-plan/m10-confirmation-questions.test.ts tests/unit/flow-plan/m10-apply-confirmations.test.ts tests/unit/flow-plan/m10-report.test.ts`
- `npm exec -- vitest run tests/integration/flow-plan/flow-m10-confirmation.test.ts`
- Flow-M8 回归：`npm exec -- vitest run tests/unit/flow-plan/m8-planner.test.ts tests/integration/flow-plan/flow-m8-form-submit-state-machine.test.ts`

扩大回归：

- `npm run test:unit`
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm exec -- vitest run tests/integration --testTimeout=30000`
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e`

## 6. 风险与回滚

- 风险：结构化 answer 与旧 confirmation DSL 并存导致语义分裂。缓解：M10 runner 默认只接受结构化 answer，旧 DSL 只作为 compatibility adapter。
- 风险：M10 直接生成 UISpec action 越过 M8。缓解：设计规定 M10 只写 FlowPlan，M8 继续拥有 action/fixture 转换。
- 风险：真实 M9 report 没有完整 FlowPlan artifact。缓解：summary report 仅作为 question provenance；apply 必须使用 fixture FlowPlan 或未来落盘 FlowPlan。
- 风险：真实样本没有足够 postcondition。缓解：受控 fixture answer 提供可观察 postcondition；真实样本只证明 question 来源和候选链路。
- 风险：引用校验遗漏。缓解：T03/T06 覆盖 page/node/state/postcondition 悬空负例。
- 回滚：若 M10 schema 不稳定，保留 M8/M9 现有能力；删除 M10 新文件和 tests 即可回到已推送 Flow-M9 状态，不迁移数据、不改 store schema。

## 7. 完成定义

Flow-M10 完成的最低标准：

- 设计和计划已通过 Worktrail review 并 promoted。
- 本地实现完成 T01-T06，默认不调用外部服务。
- 本地 fixture 证明结构化 question/answer、合法 apply、非法 reject、M8 planner 消费链路。
- restricted-live-regression 复用 Flow-M9 三个样本 report，至少一个真实 submit-like candidate 进入 question/report 链路；至少一个可读取 fixture 或 artifact FlowPlan 完成 answer apply。
- Worktrail validation promoted。
- 代码和验证产物按用户授权提交并推送。
