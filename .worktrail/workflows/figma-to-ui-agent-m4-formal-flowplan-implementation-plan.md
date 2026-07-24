---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-m4-formal-flowplan-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent M4 正式 FlowPlan 实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# 实施计划：M4 正式 FlowPlan 契约与持久化

## 来源与对齐

- 需求来源：当前目标“制定正式 M4 实施计划”；用户已明确 M4-spike 之后不能直接跳 M5/M6/M7，需要把 FlowPlan 正式纳入架构、Schema、工具边界和验收标准。
- 设计来源：
  - `.worktrail/architecture/figma-to-ui-agent-flow-plan-conclusion.md`
  - `docs/flow-plan-conclusion.md`
  - `.worktrail/validation/figma-to-ui-agent-m4-flowplan-spike-result.md`
  - `.worktrail/workflows/figma-to-ui-agent-mvp-implementation-plan.md`
  - `.plans/m4-flowplan-spike-plan.md`
- 代码基线：
  - `src/flow-plan/draft.ts`、`src/flow-plan/interaction-candidates.ts`、`src/flow-plan/apply-confirmations.ts`、`src/flow-plan/confirmation-questions.ts`、`src/flow-plan/to-ui-spec.ts`
  - `src/project-store/store.ts`、`src/project-store/path-safety.ts`
  - `src/tools/contracts.ts`
  - `src/runtime/tool-boundary.ts`、`src/runtime/tool-services.ts`
  - `src/extension.ts`
  - `src/ui-spec/schema.ts`
  - `tests/unit/flow-plan/*`、`tests/integration/flow-plan/m4-flowplan-spike.test.ts`、`tests/unit/project-store/store.test.ts`、`tests/unit/tools/contracts.test.ts`、`tests/integration/extension/tool-wiring.test.ts`
- ADR 约束：未在本次 Worktrail context 中发现需要冻结的 active Accepted ADR；本计划受 active Worktrail workflow 的全局不变量约束。
- 决策锁：
  - Figma 正式通道仍然只能是项目自有 REST Adapter。
  - 模型可见工具默认仍恰好为 `inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`。
  - `FlowPlanDraft` 的 `schemaVersion: "m4-spike"` 只能作为 spike 证据和迁移输入，不得冒充正式产品契约。
  - `figma` interactions 是 FlowPlan 输入之一，不是业务真相的唯一来源。
  - `inferred` 和 `missing` interaction 必须 fail closed，不能生成业务行为。
- 范围边界：
  - 本次做：正式 `FlowPlan` / `InteractionPlan` Schema、ProjectStore 持久化、跨回合确认记录、FlowPlan 到 UISpec 的受控转换、现有四工具下的 inspect supplement / output 集成、标准报告和本地验证链路。
  - 本次不做：M5 多 artboard 静态生成、M6 多页面行为自动探索、M7 生产级复杂业务流、后端业务调用、真实 Figma/OpenAI live probe、依赖新增、工具数量变更、部署、commit/push。
- 兼容策略：additive compatibility。新增正式 FlowPlan 契约和存储能力；保留 spike-only 文件作为迁移参考，直到正式 runner 和测试覆盖同等能力后再单独清理。
- 设计取向假设：
  - 【设计取向·假设】正式 M4 可以在不新增模型可见工具名的前提下落地；FlowPlan 通过 `inspect_figma` 的结构化输出和 supplement 暴露给 agent，通过 `save_ui_spec` 写入受 FlowPlan 约束的 UISpec。依据：MVP 实施计划的四工具全局不变量。若推翻，必须先进入 GATE-TOOL-CHANGE。
  - 【设计取向·假设】正式 M4 的第一版只支持 `navigate`、`set_state`、`open_dialog` 三类 intent。依据：当前 `UISpec` action schema 和 M4-spike 已验证范围。若需要更多 intent，先扩展 UISpec 设计，不在本计划内偷加。

## 授权边界

- 本计划被接受仅表示：可作为正式 M4 的执行来源，并可进入 plan-review-loop 或后续实现。
- 不自动授权：
  - 修改生产代码。
  - 修改模型可见工具数量或工具名称。
  - 新增或升级依赖、修改 `package.json` / `package-lock.json`。
  - 调用真实 Figma 或 OpenAI。
  - 访问生产数据、部署、commit、push、删除文件。
  - 修改 Worktrail 正式知识或 promote 候选。
- 执行前需单独确认：
  - `GATE-TOOL-CHANGE`：若要新增 `create_flow_plan`、`apply_flow_plan` 等模型可见工具。
  - `GATE-LIVE-PROBE`：若要把 live Figma prototype interactions 或 OpenAI 调用纳入验证。
  - `GATE-DEPENDENCY`：若实现需要新依赖。
  - `GATE-COMMIT`：若需要提交或推送。

## Truth 与 Ownership

- 业务真相 owner：用户在 chat 中确认的行为说明和确认答案。
- 设计真相 owner：Figma REST 读取并持久化后的 `DesignBundle`。
- FlowPlan owner：正式 `FlowPlan` artifact，记录设计输入、推断、确认状态和未决项；它是解释和确认记录，不是原始业务事实。
- UISpec owner：`UISpec` 是渲染目标和交互实现草稿，不是 Flow 真相来源。
- 非 truth surfaces：inspect supplement、运行报告、Playwright 截图、validation logs、agent context、spike fixtures、mock data。
- 共享写面单 owner：
  - FlowPlan 契约：`src/flow-plan/schema.ts` 或从 `src/flow-plan/draft.ts` 迁出的正式 schema。
  - ProjectStore 存储布局：`src/project-store/path-safety.ts`、`src/project-store/store.ts`。
  - 工具契约：`src/tools/contracts.ts`。
  - Extension 集成：`src/runtime/tool-services.ts`、`src/extension.ts`。
  - UISpec 可选追溯字段：`src/ui-spec/schema.ts`。

## 验收标准追溯

- AC1：存在正式 `FlowPlan` / `InteractionPlan` zod schema，包含 schema version、projectId、source revisions、pages、interactions、confirmationQuestions、confirmations、report；每个 interaction 有 `source`、`confidence`、`confirmed`、intent、target、blockedReason。
- AC2：ProjectStore 能用 revision CAS、history/current、schema 校验和路径隔离保存/读取 FlowPlan；失败不得覆盖上一份有效 FlowPlan。
- AC3：FlowPlan builder 能从 DesignBundle、可选 UISpec、可选 InteractionSupplement 生成正式 FlowPlan；无 supplement 时明确记录 `figmaInteractionSource: "absent"` 或等价状态。
- AC4：用户确认可跨回合持久化；合法答案把 interaction 变成 `user_confirmed`，缺失或非法答案保持未决并 fail closed。
- AC5：FlowPlan 转 UISpec 时只转换 `figma` 和 `user_confirmed` 且 `confirmed: true` 的 interaction；`inferred` / `missing` 必须进入 unresolved/report，不生成 action。
- AC6：默认路径不新增模型可见工具名；`EXACT_TOOL_NAMES` 仍是四个工具。
- AC7：`inspect_figma` 能暴露 FlowPlan summary、pending questions、unresolved count 和可审计提示，不泄露凭据、原始 file key、远端资产 URL 或私有 raw payload。
- AC8：`save_ui_spec` 或 ProjectStore 校验能识别 UISpec 与 DesignBundle / FlowPlan revision 的引用关系；可选追溯字段不破坏旧 UISpec。
- AC9：`render_and_compare` 能验证 FlowPlan 生成的 behaviorFixtures，失败时报告明确原因。
- AC10：标准报告列出 unresolved flow、blocked interaction、converted actions、behaviorFixtures、验证结果和残留风险，不把静态还原误报为完整 Flow 支持。
- AC11：全套本地验证覆盖 schema、store、builder、confirmation、conversion、tool contract、extension wiring 和 flow integration；默认不访问外部服务。

## 开工 Gate

### GATE-00：正式 M4 边界与工具不变量

- goal：确认正式 M4 采用四工具兼容路径，不新增模型可见工具。
- prerequisites：M4-spike 验证结论已推广；MVP 四工具不变量仍 active。
- owns：go/no-go 记录和本计划的执行边界。
- must-not-touch：`EXACT_TOOL_NAMES`、package/lockfile、外部服务、Worktrail promote。
- actions：
  1. 检查 `src/runtime/tool-boundary.ts` 的 `EXACT_TOOL_NAMES`。
  2. 检查 `src/tools/contracts.ts` 的四个工具参数和输出。
  3. 确认本次只做 additive schema/output 字段，不新增工具名。
- expected outputs：`GATE-00: go`，或升级到 `GATE-TOOL-CHANGE`。
- verify：`tests/integration/extension/tool-wiring.test.ts` 和 runtime/provider 工具边界测试仍断言四工具。
- done conditions：四工具兼容路径确认后，T01/T02/T03 可以开始。
- stop/escalate conditions：实现者认为必须新增工具名、改 Pi provider、或绕过工具边界。
- handoff：给实现者的结论必须写明“新增字段可以，新增工具名不可以”。

### GATE-01：正式 FlowPlan 存储契约冻结

- goal：在修改 ProjectStore 前冻结 FlowPlan 文件布局、revision 语义和引用校验。
- prerequisites：AC1 的 schema 草案通过 unit test；FlowPlan artifact 名称确定。
- owns：`data/projects/<projectId>/flow/current.json` 与 `data/projects/<projectId>/flow/history/<revision>.json` 或等价布局。
- must-not-touch：既有 `figma/current.json`、`specs/current.json` 历史文件格式。
- actions：
  1. 确定 `flowRoot` / `flowHistoryRoot` 命名。
  2. 确定 `saveFlowPlan` / `loadFlowPlan` API。
  3. 确定 FlowPlan 对 `DesignBundle.revision` 和可选 `UISpec.revision` 的校验规则。
- expected outputs：store API 和布局在计划执行记录中固定。
- verify：`tests/unit/project-store/store.test.ts` 新增 FlowPlan CAS、history、invalid reference、atomic write 测试。
- done conditions：ProjectStore 的 FlowPlan 增量能力可安全实施。
- stop/escalate conditions：需要迁移旧数据、修改已有 DesignBundle/UISpec 存储语义、或引入数据库。
- handoff：交给 T02。

### GATE-TOOL-CHANGE：模型可见工具变更

- goal：仅当四工具路径被证明无法满足 M4 时开启。
- prerequisites：实现者提供不可规避的证据，说明 `inspect_figma` + `save_ui_spec` 无法承载 FlowPlan。
- owns：新的工具设计、Pi provider 边界、prompt、安全审计、测试矩阵。
- must-not-touch：生产工具列表，直到用户明确授权。
- actions：停止 M4 实现，回到架构设计和 Worktrail 候选。
- expected outputs：新的设计方案和用户确认。
- verify：Worktrail promote 后再恢复实现。
- done conditions：不在默认 M4 内触发。
- stop/escalate conditions：任何新增工具名需求。
- handoff：交给架构/设计评审，不交给 coding agent 继续猜。

### GATE-LIVE-PROBE：外部服务验证

- goal：仅在本地正式 M4 能力完成后，决定是否调用 Figma/OpenAI 做 live 验证。
- prerequisites：用户明确授权；限流、脱敏、失败语义已确认。
- owns：live 报告和脱敏边界。
- must-not-touch：默认本地测试、凭据、原始 Figma payload、OpenAI 私有正文。
- actions：另行制定 live probe 命令和报告路径。
- expected outputs：脱敏 live validation report。
- verify：报告不含 token、file key、远端资产 URL、私有 raw payload。
- done conditions：本计划不依赖该 gate 通过。
- stop/escalate conditions：授权缺失或 429/403 无法解释。
- handoff：后续 M4-live 验证计划。

## 并行规划

[parallelism:
- independent lanes: schema/unit tests、ProjectStore 设计与测试、builder/confirmation/conversion 测试、tool output/report 测试
- sequential blockers: AC1 schema 先于 store/builder；GATE-01 先于 ProjectStore 写入；conversion 先于 render integration；tool output schema 先于 extension wiring
- shared write surfaces: `src/flow-plan/*`、`src/project-store/*`、`src/tools/contracts.ts`、`src/runtime/tool-services.ts`、`src/extension.ts`、`src/ui-spec/schema.ts`、相关 tests
- delegation: 0；该计划是契约和存储边界工作，多个 agent 并写会提高冲突风险
]

## 实施步骤

### 步骤 1：建立正式 FlowPlan Schema

- 落地文件/模块：
  - 新增或重构 `src/flow-plan/schema.ts`
  - 保留 `src/flow-plan/draft.ts` 的 spike 兼容导出，或将其标记为 spike facade
  - `tests/unit/flow-plan/schema.test.ts`
- 依赖：GATE-00。
- 操作要点：
  1. 定义 `FLOW_PLAN_SCHEMA_VERSION = "1"`。
  2. 定义正式 `FlowPlan`、`InteractionPlan`、`FlowPlanPage`、`FlowPlanInteraction`、`FlowConfirmationQuestion`、`FlowConfirmationAnswer`、`FlowPlanReport`。
  3. 增加 `figmaInteractionSource`，允许 `present`、`absent`、`unavailable`、`not_authorized`。
  4. 明确 `source` 只能是 `figma`、`inferred`、`user_confirmed`、`missing`。
  5. 保留 `confidence`、`confirmed`、`blockedReason`、`confirmationQuestionId`。
  6. 把 `confirmations` 作为正式数组落入 FlowPlan，记录 questionId、answer、appliedAt、result；不得保存敏感原文或 raw payload。
- 受约束 ADR：None。
- 验收检查：
  - `npm run test:unit -- tests/unit/flow-plan/schema.test.ts`
  - schema 拒绝 `schemaVersion: "m4-spike"` 被当成正式 FlowPlan。
  - schema 拒绝未知 source / intent / figmaInteractionSource。
- 覆盖验收标准：AC1、AC3、AC4、AC10。

### 步骤 2：把 FlowPlan 纳入 ProjectStore

- 落地文件/模块：
  - `src/project-store/path-safety.ts`
  - `src/project-store/store.ts`
  - `tests/unit/project-store/store.test.ts`
- 依赖：步骤 1、GATE-01。
- 操作要点：
  1. 在 `ProjectLayout` 增加 `flowRoot` 和 `flowHistoryRoot`。
  2. 在 `ensureProjectLayout` 创建 flow 目录。
  3. 增加 `saveFlowPlan({ projectId, baseRevision, draft })` 和 `loadFlowPlan(projectId, revision?)`。
  4. 复用 `saveArtifact` 的 CAS、history/current、atomic publish。
  5. 保存前校验 `sourceDesignBundleRevision` 必须存在且 projectId 匹配。
  6. 若 FlowPlan 带 `sourceUISpecRevision`，校验对应 UISpec 存在且 projectId 匹配。
  7. 保存失败不得覆盖上一份有效 `flow/current.json`。
- 受约束 ADR：None。
- 验收检查：
  - FlowPlan 第一次保存 revision 1，第二次 CAS 成功 revision 2。
  - baseRevision 错误时报 `revision_conflict`。
  - 无效 DesignBundle / UISpec 引用时报 `cross_reference_invalid`。
  - history 文件 immutable conflict 仍被拒绝。
- 覆盖验收标准：AC2、AC8。

### 步骤 3：升级 builder 和 confirmation 应用

- 落地文件/模块：
  - `src/flow-plan/interaction-candidates.ts`
  - `src/flow-plan/apply-confirmations.ts`
  - `src/flow-plan/confirmation-questions.ts`
  - 可选新增 `src/flow-plan/service.ts`
  - `tests/unit/flow-plan/interaction-candidates.test.ts`
  - `tests/unit/flow-plan/apply-confirmations.test.ts`
  - `tests/unit/flow-plan/confirmation-questions.test.ts`
- 依赖：步骤 1。
- 操作要点：
  1. 将 builder 输出从 spike-only `FlowPlanDraft` 升级为正式 `FlowPlan`。
  2. 无 InteractionSupplement 时写入 `figmaInteractionSource: "absent"`，并对可点击但无行为的控件生成 `missing` 或 `inferred` interaction。
  3. 有 InteractionSupplement 时校验 projectId 和 sourceDesignBundleRevision。
  4. 对 `inferred` / `missing` 生成中文确认问题。
  5. 应用确认时只接受匹配 questionId 和合法 option 的答案；成功后 interaction 变为 `user_confirmed`、`confirmed: true`。
  6. 保留未回答、非法、无法转换的 interaction 为 unresolved，不丢弃原因。
- 受约束 ADR：None。
- 验收检查：
  - 原 M4-spike builder/confirmation 测试迁移到正式 schema。
  - 非法确认不会生成 trusted interaction。
  - report 中 unresolved/unsupported/confirmation count 与 interactions 一致。
- 覆盖验收标准：AC3、AC4、AC5、AC10。

### 步骤 4：正式 FlowPlan 到 UISpec 转换

- 落地文件/模块：
  - `src/flow-plan/to-ui-spec.ts`
  - `src/ui-spec/schema.ts`
  - `tests/unit/flow-plan/to-ui-spec.test.ts`
  - `tests/unit/contracts/ui-spec.test.ts`
- 依赖：步骤 1、步骤 3。
- 操作要点：
  1. `applyFlowPlanToUISpec` 接收正式 `FlowPlan`。
  2. 只转换 `source in ["figma", "user_confirmed"] && confirmed === true` 的 interaction。
  3. 对 `navigate`、`set_state`、`open_dialog` 生成 UISpec actions。
  4. 为可验证 action 生成 behaviorFixtures。
  5. 对无法匹配 clickable node、target page、state、dialog 的 interaction 写入 unresolved。
  6. 在 `UISpec` 中添加 optional `sourceFlowPlanRevision`，仅作为追溯字段；旧 UISpec 不要求该字段。
  7. converter 生成的 draft 必须通过 `uiSpecDraftSchema`。
- 受约束 ADR：None。
- 验收检查：
  - `inferred` / `missing` 不会生成 action。
  - `user_confirmed` 可生成 action 和 fixture。
  - `sourceFlowPlanRevision` 缺失时旧 fixture 仍通过。
  - `sourceFlowPlanRevision` 存在时类型和数值校验通过。
- 覆盖验收标准：AC5、AC8、AC9。

### 步骤 5：扩展工具契约但保持四工具

- 落地文件/模块：
  - `src/tools/contracts.ts`
  - `tests/unit/tools/contracts.test.ts`
  - `src/runtime/tool-boundary.ts` 只读核对，原则上不改
  - `tests/integration/extension/tool-wiring.test.ts`
- 依赖：步骤 1、GATE-00。
- 操作要点：
  1. 在 `inspectFigmaInputSchema` 增加 optional `flowConfirmations`，结构为 questionId + value/reason。
  2. 在 `inspectFigmaOutputSchema` 增加 optional `flowPlanRevision`、`flowPlanSummary`、`confirmationQuestions`、`unresolvedInteractionCount`。
  3. TypeBox 参数同步 `flowConfirmations`。
  4. 不新增 `create_flow_plan` 或 `apply_flow_plan`。
  5. `EXACT_TOOL_NAMES` 必须保持四个工具不变。
  6. 输出字段不得包含 token、raw file key、远端资产 URL、raw Figma response。
- 受约束 ADR：None。
- 验收检查：
  - `tests/unit/tools/contracts.test.ts` 验证新字段 optional 且结构化。
  - `tests/integration/extension/tool-wiring.test.ts` 验证 active tools 仍等于 `EXACT_TOOL_NAMES`。
  - provider audit 测试仍通过。
- 覆盖验收标准：AC6、AC7、AC11。

### 步骤 6：集成 LocalExtensionToolServices

- 落地文件/模块：
  - `src/runtime/tool-services.ts`
  - `src/extension.ts`
  - 可选 `src/flow-plan/service.ts`
  - `tests/integration/extension/tool-wiring.test.ts`
- 依赖：步骤 2、步骤 3、步骤 5。
- 操作要点：
  1. `inspect` 完成 DesignBundle 保存后，加载现有 UISpec（若存在）和现有 FlowPlan（若存在）。
  2. 基于最新 DesignBundle 构建或更新 FlowPlan。
  3. 若输入包含 `flowConfirmations`，应用到现有/新 FlowPlan 并持久化。
  4. 保存 FlowPlan 后，在 inspect output 或 supplement 中返回 summary 和 pending questions。
  5. supplement 继续返回 `inspect_agent_context` 和图片；新增 FlowPlan context 只作为结构化文本，不夹带 raw payload。
  6. 错误语义：FlowPlan 构建失败不能覆盖 DesignBundle；应返回 inspect warning 或抛出明确本地错误，不能静默伪通过。
- 受约束 ADR：None。
- 验收检查：
  - fake services 下 tool wiring 能看到 flow summary。
  - confirm 再 inspect 能读回同一 FlowPlan revision 或递增 revision。
  - FlowPlan 构建失败不会删除/覆盖既有 UISpec。
- 覆盖验收标准：AC2、AC4、AC6、AC7、AC10。

### 步骤 7：标准 runner 与报告

- 落地文件/模块：
  - 新增 `scripts/run-m4-flowplan.mjs`
  - 保留 `scripts/run-m4-flowplan-spike.mjs` 直到正式 runner 验证通过
  - `reports/m4-flowplan/<run-id>/summary.json`
  - `reports/m4-flowplan/<run-id>/summary.md`
  - `tests/integration/flow-plan/m4-flowplan.test.ts`
- 依赖：步骤 2、步骤 4、步骤 6。
- 操作要点：
  1. runner 只使用本地 fixtures / ProjectStore，默认不调用 Figma/OpenAI。
  2. 执行顺序：加载 DesignBundle 和 UISpec -> build/save FlowPlan -> apply confirmations -> convert UISpec -> save UISpec -> render_and_compare。
  3. 报告列出 FlowPlan revision、source revisions、convertedActionIds、behaviorFixtureIds、unresolved interactions、validation 结果。
  4. 报告脱敏：不写 token、raw file key、远端资产 URL、raw response。
  5. 单页面输入或无 flow 条件时明确输出“不满足多页面 Flow 验证条件”，不伪造通过。
- 受约束 ADR：None。
- 验收检查：
  - `npm run test:integration -- tests/integration/flow-plan/m4-flowplan.test.ts`
  - runner 生成 summary JSON/MD。
  - 无 supplement 场景报告 `figmaInteractionSource` 不可用/缺失，不生成虚假行为。
- 覆盖验收标准：AC9、AC10、AC11。

### 步骤 8：全量本地验证和旧 spike 收敛

- 落地文件/模块：
  - `tests/unit/flow-plan/*`
  - `tests/unit/project-store/store.test.ts`
  - `tests/unit/tools/contracts.test.ts`
  - `tests/integration/extension/tool-wiring.test.ts`
  - `tests/integration/flow-plan/m4-flowplan.test.ts`
  - `.plans/m4-flowplan-spike-plan.md` 只读参考，不在本步骤改
- 依赖：步骤 1-7。
- 操作要点：
  1. 跑最小定向测试。
  2. 跑 `npm run typecheck`。
  3. 跑 `npm run test:unit`。
  4. 跑相关 integration tests。
  5. 若正式 runner 覆盖 spike 能力，记录后续清理项；本计划不强制删除 spike 文件。
- 受约束 ADR：None。
- 验收检查：
  - `npm run typecheck`
  - `npm run test:unit`
  - `npm run test:integration -- tests/integration/flow-plan/m4-flowplan.test.ts`
  - `npm run test:integration -- tests/integration/extension/tool-wiring.test.ts`
- 覆盖验收标准：AC1-AC11。

## Coding Agent 任务卡

### T01：正式 FlowPlan Schema

- goal：把 spike-only `FlowPlanDraft` 升级为正式 `FlowPlan` / `InteractionPlan` 契约。
- prerequisites：GATE-00 go。
- must-read：
  - `.worktrail/architecture/figma-to-ui-agent-flow-plan-conclusion.md`
  - `.worktrail/validation/figma-to-ui-agent-m4-flowplan-spike-result.md`
  - `src/flow-plan/draft.ts`
  - `tests/unit/flow-plan/draft.test.ts`
- owns：`src/flow-plan/schema.ts`、相关 schema tests。
- must-not-touch：ProjectStore、tool contract、UISpec schema、package files。
- actions：新增正式 schema、parser、summary、report recompute；迁移 spike 测试为正式 schema 测试。
- expected outputs：正式 FlowPlan 类型和测试。
- verify：`npm run test:unit -- tests/unit/flow-plan/schema.test.ts`。
- done conditions：AC1 通过，`m4-spike` 不能被正式 parser 接收。
- stop/escalate conditions：需要修改 UISpec action kind 或新增工具名。
- handoff：schema 字段清单、parser 名称、测试命令。

### T02：ProjectStore FlowPlan 持久化

- goal：让 FlowPlan 成为正式 ProjectStore artifact。
- prerequisites：T01 完成，GATE-01 go。
- must-read：
  - `src/project-store/store.ts`
  - `src/project-store/path-safety.ts`
  - `tests/unit/project-store/store.test.ts`
- owns：ProjectStore flow layout、save/load FlowPlan、store tests。
- must-not-touch：Figma REST client、renderer、Pi provider、package files。
- actions：增加 flow layout、saveFlowPlan/loadFlowPlan、cross-reference validation、CAS/history tests。
- expected outputs：ProjectStore 支持 FlowPlan revision。
- verify：`npm run test:unit -- tests/unit/project-store/store.test.ts`。
- done conditions：AC2、AC8 的 store 部分通过。
- stop/escalate conditions：需要迁移旧 data、改变 DesignBundle/UISpec 的历史语义、或引入数据库。
- handoff：flow 文件布局、store API、错误码行为。

### T03：FlowPlan Builder 与确认持久化

- goal：从 DesignBundle/UISpec/supplement 构建正式 FlowPlan，并安全应用用户确认。
- prerequisites：T01 完成；T02 可并行但 integration 前需完成。
- must-read：
  - `src/flow-plan/interaction-candidates.ts`
  - `src/flow-plan/apply-confirmations.ts`
  - `src/flow-plan/confirmation-questions.ts`
  - `tests/unit/flow-plan/*`
- owns：flow builder、confirmation、question tests。
- must-not-touch：tool contract、ProjectStore layout、renderer。
- actions：正式化 builder 输出、添加 `figmaInteractionSource`、确认记录、fail-closed 语义。
- expected outputs：builder/confirmation 纯函数稳定。
- verify：`npm run test:unit -- tests/unit/flow-plan/interaction-candidates.test.ts tests/unit/flow-plan/apply-confirmations.test.ts tests/unit/flow-plan/confirmation-questions.test.ts`。
- done conditions：AC3、AC4、AC5 的纯函数部分通过。
- stop/escalate conditions：无法仅靠当前 UISpec/DesignBundle 定位 interaction target，或需要 live Figma 才能继续。
- handoff：unresolved 分类和 confirmation application 语义。

### T04：FlowPlan 到 UISpec 转换

- goal：把可信 FlowPlan interaction 转换为 UISpec actions 和 behaviorFixtures。
- prerequisites：T01、T03。
- must-read：
  - `src/flow-plan/to-ui-spec.ts`
  - `src/ui-spec/schema.ts`
  - `tests/unit/flow-plan/to-ui-spec.test.ts`
  - `tests/unit/contracts/ui-spec.test.ts`
- owns：converter、optional `sourceFlowPlanRevision`、conversion tests。
- must-not-touch：ProjectStore、tool contract、external service code。
- actions：更新 converter 输入、trusted interaction 规则、fixtures、optional UISpec trace field。
- expected outputs：正式 converter 和 UISpec 追溯字段。
- verify：`npm run test:unit -- tests/unit/flow-plan/to-ui-spec.test.ts tests/unit/contracts/ui-spec.test.ts`。
- done conditions：AC5、AC8、AC9 的 conversion 部分通过。
- stop/escalate conditions：需要新增 UISpec action kind 或行为 fixture step kind。
- handoff：convertedActionIds、behaviorFixtureIds、unresolved 列表语义。

### T05：工具契约与 Extension 集成

- goal：在四工具不变量下，把 FlowPlan 暴露给 agent 并支持跨回合确认。
- prerequisites：T01、T02、T03。
- must-read：
  - `src/tools/contracts.ts`
  - `src/runtime/tool-boundary.ts`
  - `src/runtime/tool-services.ts`
  - `src/extension.ts`
  - `tests/unit/tools/contracts.test.ts`
  - `tests/integration/extension/tool-wiring.test.ts`
- owns：inspect input/output additive fields、tool-services integration、extension wiring tests。
- must-not-touch：`EXACT_TOOL_NAMES`、Pi provider internals、package files。
- actions：添加 optional `flowConfirmations` 和 flow summary output；集成 save/load FlowPlan；保持 supplement 脱敏。
- expected outputs：四工具边界不变，inspect 可返回 FlowPlan summary/questions。
- verify：`npm run test:unit -- tests/unit/tools/contracts.test.ts`；`npm run test:integration -- tests/integration/extension/tool-wiring.test.ts`。
- done conditions：AC6、AC7、AC11 相关测试通过。
- stop/escalate conditions：需要新增模型可见工具、需要暴露 raw Figma payload、或需要外部服务。
- handoff：工具字段变更说明、脱敏证据、四工具测试结果。

### T06：正式 M4 Runner 与验证报告

- goal：用本地可复现链路证明正式 M4 端到端成立。
- prerequisites：T01-T05。
- must-read：
  - `scripts/run-m4-flowplan-spike.mjs`
  - `tests/integration/flow-plan/m4-flowplan-spike.test.ts`
  - `src/validation/render-and-compare.ts`
- owns：`scripts/run-m4-flowplan.mjs`、`tests/integration/flow-plan/m4-flowplan.test.ts`、`reports/m4-flowplan/*`。
- must-not-touch：live Figma/OpenAI、package files、Worktrail formal docs。
- actions：新增正式 runner、报告 schema、integration test；保留 spike runner。
- expected outputs：本地 M4 summary JSON/MD 和 integration 通过。
- verify：`npm run test:integration -- tests/integration/flow-plan/m4-flowplan.test.ts`。
- done conditions：AC9、AC10、AC11 通过。
- stop/escalate conditions：runner 需要 live token、真实 Figma 文件、或 OpenAI 才能证明本地能力。
- handoff：报告路径、验证命令、残留风险。

## 风险与回滚

- 风险：工具契约字段扩展影响 Pi tool schema。
  - 关联步骤：步骤 5、步骤 6。
  - 影响：agent 调用失败或 provider payload 漂移。
  - 缓解 / 回滚：字段只做 optional additive；`EXACT_TOOL_NAMES` 不变；失败时回滚 `src/tools/contracts.ts` 的新增字段和 integration 集成，保留 schema/store 纯内部能力。
- 风险：FlowPlan store 与 DesignBundle/UISpec revision 不一致。
  - 关联步骤：步骤 2、步骤 6。
  - 影响：跨回合确认应用到过期设计或过期 UISpec。
  - 缓解 / 回滚：保存前 cross-reference validation；发现 mismatch 时新建未决 FlowPlan 或报告 blocked，不覆盖旧 artifact。
- 风险：Agent 把 inferred/missing 当成真实行为。
  - 关联步骤：步骤 3、步骤 4、步骤 7。
  - 影响：生成未经确认的业务动作。
  - 缓解 / 回滚：converter 只接受 `figma` / `user_confirmed` 且 `confirmed: true`；测试覆盖 forbidden sources。
- 风险：`sourceFlowPlanRevision` 破坏旧 UISpec。
  - 关联步骤：步骤 4。
  - 影响：历史 specs 无法加载。
  - 缓解 / 回滚：字段 optional；仅新 converter 输出时写入；旧 fixture 回归测试。
- 风险：报告泄露 Figma file key、token、远端资产 URL 或 raw payload。
  - 关联步骤：步骤 5、步骤 7。
  - 影响：安全违规。
  - 缓解 / 回滚：报告仅写 projectId、revision、hash/计数和 managed relative paths；复用 audit 脱敏测试模式。
- 风险：正式 M4 被误解为 M5/M6/M7 已完成。
  - 关联步骤：步骤 7、步骤 8。
  - 影响：范围漂移。
  - 缓解 / 回滚：报告中明确 M4 只证明 FlowPlan 契约、持久化和受控转换；多 artboard 静态批量生成和复杂业务流仍在后续阶段。

## 验收标准覆盖检查

- AC1 → 步骤 1、T01。
- AC2 → 步骤 2、T02。
- AC3 → 步骤 3、T03。
- AC4 → 步骤 3、步骤 6、T03、T05。
- AC5 → 步骤 4、T04。
- AC6 → 步骤 5、T05。
- AC7 → 步骤 5、步骤 6、T05。
- AC8 → 步骤 2、步骤 4、T02、T04。
- AC9 → 步骤 4、步骤 7、T04、T06。
- AC10 → 步骤 3、步骤 7、T03、T06。
- AC11 → 步骤 8、全部任务卡。

## 待确认 / 残留假设

- 【假设】正式 M4 默认不新增模型可见工具。验证方法：GATE-00 和 extension tool wiring 测试。
- 【假设】第一版只支持 `navigate`、`set_state`、`open_dialog`。验证方法：converter 对其他 intent 写入 unresolved，后续若需扩展再进入 UISpec 设计。
- 【假设】`flowConfirmations` 放在 `inspect_figma` 输入里足以承载 chat-first 跨回合确认。验证方法：integration test 模拟第一次 inspect 生成 questions，第二次 inspect 带 answers 后保存新 FlowPlan revision。
- 【假设】本地 fixtures 足以证明正式 M4 基础能力。验证方法：T06 integration report；live probe 另走 GATE-LIVE-PROBE。

## 下一步

1. 本地 plan-review-loop 通过后，用 Worktrail draft 创建 pending workflow candidate。
2. 由用户基于精确 candidate id 和 project scope 确认是否 promote。
3. 用户确认实现后，从 T01 开始实施，不调用外部服务、不改依赖、不提交，除非另行授权。
