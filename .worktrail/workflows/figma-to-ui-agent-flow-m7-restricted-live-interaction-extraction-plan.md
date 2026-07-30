---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m7-restricted-live-interaction-extraction-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Flow-M7 restricted-live interaction extraction 实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m7-restricted-live"
}
---

# Flow-M7 restricted-live interaction extraction 实施计划

## 来源与对齐

- 需求来源：Flow-M7 restricted-live 验证出现“部分通过”，需要解释并解决真实 Figma 行为链路不足的问题。
- 设计来源：已推广的 Flow-M7 interactive behavior design 与 Flow-M7 local implementation plan。
- 当前代码事实：`DesignBundle.normalizedNode` 尚未保存 Figma REST prototype interaction / reaction；`buildFlowPlanDraft` 主要依赖 `interactionSupplement`；`applyFlowPlanToUISpec` 已具备 `set_state`、`open_dialog`、`navigate` 的受控落地能力。
- restricted-live 样本依据：只读探测推荐 Fitness App UI Kit 样本作为首个真实 interaction 样本；该样本存在 ON_CLICK + CHANGE_TO 类型 interaction，适合验证 interactive component / variant state change 到 Flow-M7 `set_state` 的链路。正式知识不保存原始 Figma URL、file key、token 或 REST payload。
- 决策锁：
  - Flow-M7 只证明非路由交互行为；路由跳转仍归 Flow-M6。
  - Flow-M7 不允许通过“场景夹具通过”伪装成真实 Figma prototype interaction 通过。
  - 只有 `source="figma"` 或 `source="user_confirmed"` 的受控 interaction 可进入 Flow-M7 action 转换；节点名、按钮文案和视觉猜测不是 truth。
- 范围边界：本计划只补齐 restricted-live 下 Figma REST prototype interaction 提取、转换、验证与报告；不调用 OpenAI、不改 Pi 四工具边界、不新增依赖、不做 Git 生命周期动作。
- 兼容策略：additive compatibility。新增字段与解析链路必须向后兼容既有 DesignBundle / UISpec / FlowPlan 数据。
- 设计取向假设：
  - 【设计取向·假设】Figma REST 返回的 `interactions` / `reactions` 可作为受信输入，但只能保存经过白名单化、限长、脱敏后的最小字段。（依据：restricted-live 需要证明真实 Figma prototype；若字段形态漂移，则降级为 unresolved，不猜测。）
  - 【设计取向·假设】CHANGE_TO 可映射为 `set_state` 的前提是目标状态能在现有 UISpec state/target node 中被明确表达。（依据：Flow-M7 已有 set_state action；若无法表达，则必须返回 unresolved reason，而不是新增隐式行为。）

## 授权边界

- 本计划被接受仅表示：可作为后续 coding agent 的实施来源与 review 对象。
- 不自动授权：真实 Figma REST 调用、OpenAI 调用、依赖变更、Pi tool boundary 变更、Git add/commit/push、删除本地 reports 或 data、推广/废弃 Worktrail candidate。
- 执行前需单独确认：restricted-live 真实 Figma 验证、任何公开 API/schema 合同扩大、任何需要新增依赖或修改四工具边界的替代方案。
- 默认实施方式：local mock first。真实样本只在 gated restricted-live 阶段运行。

## Truth 与 Ownership

- Figma prototype truth owner：Figma REST 响应中的受控 `interactions` / `reactions` 字段。
- Flow behavior truth owner：FlowPlan confirmed interaction 与 UISpec action/postcondition。
- 非 truth surfaces：节点名称、按钮文案、截图 diff、生成报告、场景夹具、agent 推断、手写样本标题。
- 共享写面单 owner：`src/design-bundle/schema.ts`、`src/figma/normalize.ts`、`src/flow-plan/*`、Flow-M7 runner script、相关测试夹具。
- 证据边界：reports 和 data 是运行证据，不等于正式知识；进入 Worktrail 的内容必须脱敏且不包含原始 Figma URL、file key、token、REST payload。

## 验收标准追溯

- AC1：DesignBundle normalized node 能保存有界、脱敏、白名单化的 prototype interaction refs。← 来源：restricted-live 根因分析。
- AC2：Figma normalize 能从 REST node 中保留支持字段，并丢弃 raw payload。← 来源：Figma REST truth owner。
- AC3：FlowPlan builder 能把支持的 Figma prototype interaction 转为 `source="figma"`、`confirmed=true` 的 interaction。← 来源：Flow-M7 design。
- AC4：CHANGE_TO 只在可明确表达状态与目标节点时映射为 `set_state`；否则 unresolved。← 来源：Fitness 样本与 Flow-M7 set_state 能力。
- AC5：NAVIGATE 不计入 Flow-M7 非路由行为通过；需要时交给 Flow-M6 route execution。← 来源：Flow-M6/Flow-M7 边界。
- AC6：unsupported / incomplete interaction 必须保留 reason，不允许名称猜测或视觉猜测。← 来源：Flow-M7 真实性约束。
- AC7：restricted-live Fitness 样本至少产生一个 trusted non-route conversion 并进入 Flow-M7 runner；否则报告精确失败原因。← 来源：当前优先真实样本。
- AC8：LoginUIConcept 这类无 prototype interaction 的样本必须保持 partial / no_figma_prototype_interactions，不得误判通过。← 来源：回归保护。
- AC9：不调用 OpenAI、不新增依赖、不改变 Pi 四工具边界，日志与报告通过脱敏检查。← 来源：项目安全边界。
- AC10：本地 unit/integration/e2e/targeted validation 通过；restricted-live 结果形成单独 validation candidate，等待人工 review。← 来源：Worktrail 验证流程。

## 开工 Gate

### GATE-00：restricted-live interaction extraction 开工检查

- goal：确认代码与知识边界，排除假阳性、泄密和范围扩张。
- prerequisites：用户确认进入该计划实施；如运行真实 Figma，需要额外确认 restricted-live gate。
- owns：go/no-go ledger、样本输入脱敏策略、现有 partial candidate 处理建议。
- must-not-touch：依赖、Pi 四工具边界、OpenAI probe、Git lifecycle、未跟踪 reports 目录、正式 `.worktrail` 知识文件。
- actions：
  - 检查 `git status --short --branch`，记录未跟踪/未提交文件并排除无关文件。
  - 读取 Flow-M7 design、Flow-M7 local plan、当前 FlowPlan/DesignBundle/Figma normalize 代码。
  - 确认既有 restricted-live partial validation candidate 仍是 partial，不把它当完成态。
  - 确认正式计划与报告不包含 raw Figma URL、file key、token、REST payload。
- expected outputs：开工检查记录、可实施文件清单、blocked/allowed 列表。
- verify：检查输出中无 secret/raw URL/file key；检查不含 dependency/tool-boundary/Git 操作。
- done conditions：T01-T05 可进入本地实施；restricted-live T05-live 仍需额外 gate。
- stop/escalate conditions：发现需要 schema 公共合同破坏性变更、新依赖、OpenAI、无法脱敏的样本输入、或 CHANGE_TO 无法用现有 UISpec 表达且必须扩展合同。
- handoff：交给 T01 的 schema 字段边界与禁止事项。

## 并行规划

[parallelism:
- independent lanes: mock fixture 设计与现有 Flow-M7 runner 阅读可并行；schema/normalizer 与 FlowPlan extractor 不应并行写同一合同
- sequential blockers: T01 schema 必须先于 T02 normalize；T02 必须先于 T03 extractor；T03 必须先于 T04 runner；T05-live 必须在本地验证后单独授权
- shared write surfaces: `src/design-bundle/schema.ts`, `src/figma/normalize.ts`, `src/flow-plan/*`, `scripts/*`, `tests/*`
- delegation: 0；合同与转换链路共享写面集中，主 agent 单 owner 更安全
]

## 实施步骤

### 步骤 1：定义 DesignBundle prototype interaction 最小合同

- 落地文件/模块：`src/design-bundle/schema.ts`，相关 schema/unit tests。
- 依赖：GATE-00。
- 操作要点：
  - 在 normalized node 上新增可选 `prototypeInteractions` 数组。
  - 仅允许保存白名单字段：source、trigger、actionType/navigation、transition/destination node id、有限 reason/warning、可选稳定 interaction id。
  - 设置数组长度、字符串长度和 enum fallback 上限。
  - 禁止保存 raw URL、token、REST payload、完整 node subtree。
- 受约束 ADR：None。
- 验收检查（verify）：schema parse/negative tests 覆盖 unknown/oversized/raw-field rejection。
- 覆盖验收标准：AC1、AC9。

### 步骤 2：从 Figma REST node 规范化 interactions / reactions

- 落地文件/模块：`src/figma/normalize.ts`，Figma mock fixture tests。
- 依赖：步骤 1。
- 操作要点：
  - 在 raw node schema 中显式接收 `interactions` 与兼容字段 `reactions`。
  - 抽取 ON_CLICK、CHANGE_TO、NAVIGATE 等支持信号；未知 trigger/navigation 进入 `unsupported` reason。
  - 对缺失 destination / transitionNodeID 的 interaction 保留 unresolved metadata，不转换为 confirmed 行为。
  - 对 raw payload 做丢弃，不透传 `.passthrough()` 内容到 DesignBundle。
- 受约束 ADR：None。
- 验收检查（verify）：mock REST fixture 包含 CHANGE_TO、NAVIGATE destination null、无 interaction 三类样本。
- 覆盖验收标准：AC2、AC6、AC8、AC9。

### 步骤 3：构建 Figma prototype interaction 到 FlowPlan 的转换器

- 落地文件/模块：`src/flow-plan/figma-prototype-interactions.ts` 或 `src/flow-plan/interaction-candidates.ts`，相关 unit/integration tests。
- 依赖：步骤 2。
- 操作要点：
  - 从 DesignBundle normalized nodes 读取 `prototypeInteractions`。
  - 只有 source node 可映射到 UISpec uiNodeId 且 target 可验证时，才生成 `source="figma"`、`confirmed=true`。
  - CHANGE_TO 映射为 `set_state` 的条件：存在明确 stateKey、state value 与 targetNodeId；否则 unresolved reason=`change_to_target_not_representable`。
  - NAVIGATE 只输出 route/navigate 候选，不计入 Flow-M7 non-route success；缺 destination 时 unresolved。
  - 不使用节点名、按钮文案、视觉位置推断行为。
- 受约束 ADR：None。
- 验收检查（verify）：mock DesignBundle -> FlowPlan tests 覆盖 trusted set_state、unresolved change_to、navigate boundary、no interaction partial。
- 覆盖验收标准：AC3、AC4、AC5、AC6、AC8。

### 步骤 4：接入 restricted-live Flow-M7 runner

- 落地文件/模块：`scripts/run-flow-m7-restricted-live.mjs` 或现有 Flow-M7 runner 的 gated 参数；必要时只改 `src/flow-plan/m7-runner.ts` 的输入适配。
- 依赖：步骤 3。
- 操作要点：
  - 新增或扩展 restricted-live 命令，流程为 inspect DesignBundle -> build FlowPlan from figma prototype -> apply to UISpec -> run Flow-M7 validation。
  - 命令必须要求显式 Figma gate，例如 `FLOW_M7_RESTRICTED_LIVE_AUTHORIZED=1` 与 `--allow-figma-network`。
  - 命令不得调用 OpenAI，不得新增模型环节。
  - 输出 sanitized summary，禁止 raw URL/file key/token/REST payload。
- 受约束 ADR：None。
- 验收检查（verify）：local dry-run 或 mock mode 证明无 gate 时 fail closed，有 gate 时才允许进入 Figma adapter。
- 覆盖验收标准：AC7、AC9、AC10。

### 步骤 5：验证与回归

- 落地文件/模块：`tests/unit/*`、`tests/integration/*`、`tests/e2e/*`、受控 reports 输出。
- 依赖：步骤 4。
- 操作要点：
  - 运行最小本地验证：typecheck、unit、integration、与 Flow-M7 相关 e2e/runner tests。
  - restricted-live Fitness 样本只在用户授权后运行，样本原始 URL 仅作为本地命令输入，不写入正式知识。
  - LoginUIConcept 无 interaction 样本作为 false-positive 回归：应 partial，不应 pass。
  - Dynamic/NAVIGATE-null 类样本作为 boundary 回归：不应计入 Flow-M7 non-route pass。
- 受约束 ADR：None。
- 验收检查（verify）：validation report 中包含 conversion count、unresolved reasons、scenario-only=false/true 判定、redaction check。
- 覆盖验收标准：AC7、AC8、AC9、AC10。

### 步骤 6：Worktrail validation 与候选收敛

- 落地文件/模块：Worktrail pending validation candidate；不直接编辑正式 `.worktrail` 文件。
- 依赖：步骤 5。
- 操作要点：
  - restricted-live 成功或失败都创建脱敏 validation candidate。
  - 若 Fitness 样本证明真实 CHANGE_TO -> set_state 链路，可建议 promote 新 validation 并 discard 旧 partial validation；但必须等待用户明确确认。
  - 若仍 partial，记录精确 blocked reason，不调阈值、不伪造 pass。
- 受约束 ADR：None。
- 验收检查（verify）：`worktrail review plan --format json` 能看到待 review validation；无自动 promote/discard。
- 覆盖验收标准：AC10。

## Coding Agent 任务卡

### T01：PrototypeInteraction Schema

- goal：为 DesignBundle 增加最小、脱敏、可验证的 prototype interaction 合同。
- prerequisites：GATE-00。
- must-read：Flow-M7 design、Flow-M7 local plan、`src/design-bundle/schema.ts`。
- owns：`src/design-bundle/schema.ts` 与相关 schema tests。
- must-not-touch：UISpec action schema、依赖、Pi tool boundary。
- actions：新增可选字段、enum、长度上限、negative tests。
- expected outputs：schema tests 通过；旧 fixture 兼容。
- verify：`npm run test:unit -- <schema相关测试>` 或项目现有等价命令。
- done conditions：新旧 DesignBundle 都可 parse；raw payload 不可进入正式字段。
- stop/escalate conditions：需要破坏现有 DesignBundle 合同或新增依赖。
- handoff：字段定义、限制与测试名。

### T02：Figma REST normalize extraction

- goal：从 raw Figma node 提取 interactions/reactions 并写入 normalized node。
- prerequisites：T01。
- must-read：`src/figma/normalize.ts`、Figma mock fixtures。
- owns：`src/figma/normalize.ts` 与相关 fixture tests。
- must-not-touch：Figma REST client 限流/重试策略、真实网络探针。
- actions：添加 parser、白名单转换、unsupported reasons、无 raw payload 输出。
- expected outputs：CHANGE_TO/NAVIGATE/null destination/no interaction fixtures 覆盖。
- verify：相关 unit/integration tests。
- done conditions：normalized node 含受控 prototype interaction；unsupported 可解释。
- stop/escalate conditions：REST 字段形态无法确认且需要 live probe 才能继续。
- handoff：normalized 样例与 unresolved reason 列表。

### T03：FlowPlan trusted extractor

- goal：把 DesignBundle prototype interaction 转为 trusted FlowPlan interaction。
- prerequisites：T02。
- must-read：`src/flow-plan/interaction-candidates.ts`、`src/flow-plan/to-ui-spec.ts`、Flow-M7 tests。
- owns：FlowPlan extractor 文件与 tests。
- must-not-touch：Flow-M6 route executor、Product-M8 CLI、OpenAI prompts。
- actions：实现 figma source extractor、CHANGE_TO->set_state 条件映射、NAVIGATE boundary、unresolved reasons。
- expected outputs：FlowPlan 中存在 `source="figma" confirmed=true` 的真实候选或明确 unresolved。
- verify：mock DesignBundle -> FlowPlan tests。
- done conditions：场景 supplement 不再是 restricted-live 唯一输入。
- stop/escalate conditions：需要新增 UISpec state 表达能力才能完成 CHANGE_TO。
- handoff：转换规则、无法表达项、测试证据。

### T04：Restricted-live runner 接线

- goal：提供 gated restricted-live Flow-M7 验证入口。
- prerequisites：T03。
- must-read：`src/flow-plan/m7-runner.ts`、`scripts/run-flow-m7.mjs`、`src/runtime/e2e-flow-service.ts`。
- owns：runner script/adapter 与 targeted tests。
- must-not-touch：Pi agent startup、四工具边界、OpenAI。
- actions：新增 gate、mock/dry-run、sanitized summary、fail-closed。
- expected outputs：无 gate 失败关闭；mock mode 可跑通转换和 runner。
- verify：targeted runner tests 或 dry-run。
- done conditions：restricted-live 命令能在授权时消费真实 Figma inspect 结果。
- stop/escalate conditions：需要 agent loop/OpenAI 参与生成才能继续。
- handoff：运行命令、gate env、输出路径、脱敏说明。

### T05：Fitness restricted-live validation

- goal：用 Fitness App UI Kit 样本证明至少一个真实 CHANGE_TO/non-route interaction 链路。
- prerequisites：T04、本地验证通过、用户显式授权 Figma restricted-live。
- must-read：T04 输出命令与脱敏规则。
- owns：本地 validation evidence 与 pending Worktrail validation candidate。
- must-not-touch：OpenAI、raw URL 持久化、Git、candidate promote/discard。
- actions：用 operator 提供的样本输入运行 restricted-live；记录 conversion/unresolved/report；创建脱敏 validation candidate。
- expected outputs：pass 或 precise partial，不允许 scenario-only pass。
- verify：report redaction check；Worktrail review plan 能看到 validation。
- done conditions：Fitness 样本结果可审查；Login/no-interaction 回归不误判。
- stop/escalate conditions：Figma 429/权限失败、CHANGE_TO 目标无法表达、样本被社区移除。
- handoff：validation candidate id、结果摘要、旧 partial candidate 处理建议。

## 风险与回滚

- 风险：Figma REST interaction 字段形态漂移。
  - 关联步骤：步骤 2。
  - 影响：无法稳定解析真实 prototype 行为。
  - 缓解 / 回滚：schema 使用 unknown fallback 与 unresolved reason；旧 DesignBundle 兼容；不阻塞静态生成。
- 风险：CHANGE_TO 无法映射到现有 UISpec state。
  - 关联步骤：步骤 3。
  - 影响：Fitness 样本仍 partial。
  - 缓解 / 回滚：返回 `change_to_target_not_representable`；另开后续设计扩展，不在本计划中猜测。
- 风险：restricted-live 样本只覆盖 state switch，不覆盖 input/submit。
  - 关联步骤：步骤 5。
  - 影响：Flow-M7 覆盖仍不完整。
  - 缓解 / 回滚：本计划只声明 state-switch proof；后续补真实 form/checkout 样本或 gated user-confirmed supplement。
- 风险：报告泄露 raw URL/file key/token。
  - 关联步骤：步骤 4、步骤 5、步骤 6。
  - 影响：安全与合规失败。
  - 缓解 / 回滚：输出前 redaction check；正式 Worktrail 只保存 sample alias 和脱敏摘要；不提交未审查 reports。
- 风险：把 NAVIGATE 当 Flow-M7 行为通过。
  - 关联步骤：步骤 3、步骤 5。
  - 影响：Flow-M6/Flow-M7 边界混淆。
  - 缓解 / 回滚：NAVIGATE 进入 Flow-M6 route path 或 unresolved，不计入 Flow-M7 non-route success。

## 验收标准覆盖检查

- AC1 → 步骤 1，T01。
- AC2 → 步骤 2，T02。
- AC3 → 步骤 3，T03。
- AC4 → 步骤 3，T03，T05。
- AC5 → 步骤 3，步骤 5。
- AC6 → 步骤 2，步骤 3。
- AC7 → 步骤 4，步骤 5，T04，T05。
- AC8 → 步骤 2，步骤 5。
- AC9 → GATE-00，步骤 1-6。
- AC10 → 步骤 5，步骤 6。

## 待确认 / 残留假设

- 【假设】Fitness 样本在执行时仍可被当前 Figma token 读取。（验证方法：restricted-live gate 后只读 inspect。）
- 【假设】至少一个 CHANGE_TO target 能映射到现有 UISpec state/targetNodeId。（验证方法：T03 mock + T05 live conversion report；若失败则进入后续 state representation 设计。）
- 【假设】当前 Flow-M7 runner 对 `set_state` 的执行能力足以承载 interactive component variant state change。（验证方法：T04 mock runner 与 T05 live run。）
- 【假设】完整 Flow-M7 行为覆盖后续仍需要真实 form/checkout 样本；本计划不把 Fitness state-switch proof 等同于全部 Flow-M7 完成。（验证方法：后续样本矩阵 review。）

## 下一步

1. 对本计划运行 Worktrail review，确认是否 promote。
2. promote 后进入 T01-T04 本地实现；不需要真实 Figma 或 OpenAI。
3. 本地验证通过后，再单独请求 T05 restricted-live Fitness 样本授权。
4. T05 产出 validation candidate 后，再决定是否 discard 旧 partial validation candidate。
