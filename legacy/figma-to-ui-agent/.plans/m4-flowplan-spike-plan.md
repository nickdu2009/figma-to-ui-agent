# 实施计划：M4-spike FlowPlan 可行性验证

## 来源与对齐

- 需求来源：[docs/flow-plan-conclusion.md](../docs/flow-plan-conclusion.md)。
- 设计结论：当前 Pi + TypeScript Extension + Figma REST + `DesignBundle` + `UISpec` + Preview + Playwright 能承载 chat-first FlowPlan 方向，但不能从 M3 直接推导出完整多页面业务 Flow 支持。
- 当前代码事实：
  - `DesignBundle` 已表达页面、节点、样式、素材和部分视觉层，落点在 `src/design-bundle/schema.ts`。
  - 当前 `DesignBundle` 未把 Figma prototype interactions 作为正式字段保存；M4-spike 若需要 interaction 输入，必须通过 spike-only interaction supplement、fixture 或单独授权的 live probe 提供。
  - `UISpec` 已支持多页面、`navigate`、`set_state`、`open_dialog`、`behaviorFixtures`，落点在 `src/ui-spec/schema.ts`。
  - Preview 已能 dispatch `UISpec.actions`，落点在 `preview/src/preview-app.tsx`。
  - `render_and_compare` 已能按 `behaviorFixtureIds` 执行行为验证，落点在 `src/validation/render-and-compare.ts`。
- 决策锁：
  - M4-spike 只验证链路，不引入正式 `FlowPlan` / `InteractionPlan` 产品契约。
  - 未确认的 `inferred` / `missing` interaction 不得转换为 `UISpec.actions`。
  - Figma interactions 是输入之一，不是业务 Flow 唯一事实来源。
- 范围边界：
  - 本次做：候选页面识别、Figma interaction 提取/归类、推断/缺失问题生成、用户确认输入的结构化记录、确认后转换为 `UISpec.actions` 和 `behaviorFixtures`、本地验证报告。
  - 本次不做：正式 Pi 工具、正式持久化 `FlowPlan`、跨回合恢复、依赖变更、任意 Figma 自动业务 Flow 承诺、复杂表单业务规则、后端调用、动画还原。
- 兼容策略：additive spike。新增 spike-only helper、脚本、测试和报告，不破坏现有 `DesignBundle` / `UISpec` 正式契约。

## 授权边界

- 接受本计划仅表示可以作为 M4-spike 的执行来源。
- 不自动授权：
  - 调用 Figma/OpenAI 外部服务。
  - 新增 npm 依赖或改 package-lock。
  - 将 `FlowPlan` 作为正式 project store 对象落库。
  - 修改正式 Pi tool 列表或 tool contract。
  - commit、push、部署、删除数据。
- 执行前需单独确认：
  - 是否允许 live Figma 探测。
  - 是否允许用当前真实 Figma 样例作为 M4-spike 验收输入。
  - 是否要把验证报告迁入 Worktrail 候选并推广。

## Truth 与 Ownership

- 业务 Flow 真相 owner：用户 chat 确认结果。
- Figma 真相 owner：`DesignBundle` 中来自 Figma REST 的设计事实；prototype interaction 事实只能来自 spike-only interaction supplement、fixture 或单独授权 live probe 输出，不能假装已经是 `DesignBundle` 正式字段。
- 非 truth surfaces：
  - Agent 根据页面名、按钮文案、布局关系产生的推断。
  - `FlowPlanDraft` 临时产物。
  - 运行报告、日志、测试 fixture、视觉 diff。
- 共享写面单 owner：
  - `src/ui-spec/schema.ts`：本次原则上不改；如果 spike 证明必须改，停止并进入正式 M4 设计。
  - `src/tools/contracts.ts`：本次不改。
  - `src/project-store/*`：本次不改正式存储。
  - `package.json` / `package-lock.json`：本次不改依赖。

## 验收标准追溯

- AC1：能从目标 `DesignBundle` 识别至少两个候选页面；若输入只有单页面，则明确报告“不满足多页面 Flow 验证条件”。
- AC2：能把 interactions 分为 `figma`、`inferred`、`user_confirmed`、`missing` 四类。
- AC3：能为每个 `inferred` 或 `missing` interaction 生成用户可读的确认问题。
- AC4：能把用户确认结果写入结构化 `FlowPlanDraft`，至少包含页面、交互、来源可信度、确认状态、目标页面/状态。
- AC5：生成 `UISpec` 时，只把 `figma` 和 `user_confirmed` interaction 转换为 `navigate`、`set_state` 或 `open_dialog`。
- AC6：至少生成一个 `behaviorFixture` 验证确认后的页面跳转或状态行为。
- AC7：Preview 和 Playwright 验证能证明 `behaviorFixture` 通过，或报告明确失败原因。
- AC8：运行报告列出未实现的 `inferred` / `missing` interaction，避免把静态页面误报为完整 Flow 支持。
- AC9：不新增正式 Pi 工具、不新增依赖、不修改正式 project store，不把 `FlowPlanDraft` 冒充正式 `DesignBundle` 或 `UISpec` 字段。

## 开工 Gate

### GATE-00：Spike 边界确认

- goal：确认 M4-spike 只做本地可行性验证，不提前进入正式 M4/M5/M6/M7。
- prerequisites：
  - 已阅读 `docs/flow-plan-conclusion.md`。
  - 已确认当前 `UISpec` 支持 actions 和 behavior fixtures。
- owns：计划边界、授权边界、go/no-go。
- must-not-touch：
  - 正式 Pi tool 列表。
  - 正式 `ProjectStore` schema。
  - npm 依赖。
- actions：
  1. 确认本轮只新增 spike-only helper、脚本、测试和报告。
  2. 确认是否使用 live Figma；若未授权，只能用 fixture / 已有 `DesignBundle`。
  3. 确认 `FlowPlanDraft` 不跨回合恢复。
- expected outputs：
  - go/no-go 记录。
  - live 或 fixture 输入边界。
- verify：
  - `git diff --name-only` 中没有 `package-lock.json`、正式 tool contract 或 project-store schema 改动。
- done conditions：
  - GATE-00 通过后才能进入 STEP-1。
- stop/escalate conditions：
  - 需要跨回合恢复 FlowPlanDraft。
  - 需要把 FlowPlan 作为正式存储对象。
  - 需要新增正式 Pi 工具。
- handoff：
  - 若触发 stop，转入正式 M4 设计，不继续 spike。

## 并行规划

```text
[parallelism:
- independent lanes:
  - FlowPlanDraft 类型与分类规则
  - 页面候选识别
  - confirmation question 生成
  - FlowPlanDraft -> UISpec action/fixture 转换
  - fixture 测试数据
- sequential blockers:
  - FlowPlanDraft 最小结构必须先确定
  - 转换器必须等 classification/question 结构稳定后实现
  - 集成验证必须等转换器和 fixture 数据完成后执行
- shared write surfaces:
  - src/flow-plan/* 单 owner
  - scripts/run-m4-flowplan-spike.mjs 单 owner
  - tests/unit/flow-plan/* 单 owner
  - tests/integration/flow-plan/* 单 owner
- delegation: 0；M4-spike 的关键风险在契约边界，单线推进更稳
]
```

## FlowPlanDraft 最小结构

M4-spike 允许定义内部 TypeScript 类型和 zod 校验，但不作为正式 project store schema。

建议结构：

```typescript
type FlowInteractionSource =
  | "figma"
  | "inferred"
  | "user_confirmed"
  | "missing";

interface FlowPlanDraft {
  schemaVersion: "m4-spike";
  projectId: string;
  sourceDesignBundleRevision: number;
  pages: Array<{
    id: string;
    sourcePageId: string;
    name: string;
    role: "entry" | "screen" | "state" | "component" | "unknown";
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
  interactions: Array<{
    id: string;
    source: FlowInteractionSource;
    sourceNodeId?: string;
    sourceNodeName?: string;
    trigger?: "click" | "hover" | "timeout" | "submit" | "unknown";
    intent: "navigate" | "set_state" | "open_dialog" | "unknown";
    fromPageId?: string;
    targetPageId?: string;
    stateKey?: string;
    value?: string | number | boolean;
    confirmationQuestionId?: string;
    confirmed: boolean;
    blockedReason?: string;
  }>;
  confirmationQuestions: Array<{
    id: string;
    interactionId: string;
    question: string;
    options: Array<{
      label: string;
      value: string;
    }>;
    required: boolean;
  }>;
  report: {
    unsupportedCount: number;
    unresolvedInteractionCount: number;
    convertedActionCount: number;
    behaviorFixtureCount: number;
  };
}
```

## 实施步骤

### STEP-1：新增 FlowPlanDraft spike 类型与校验

- 落地文件/模块：
  - `src/flow-plan/draft.ts`
  - `tests/unit/flow-plan/draft.test.ts`
- 依赖：GATE-00。
- 操作要点：
  1. 定义 spike-only `FlowPlanDraft` TypeScript 类型。
  2. 定义 zod schema，只用于本地校验和报告质量控制。
  3. 明确 `schemaVersion: "m4-spike"`，避免被误认为正式契约。
  4. 导出 `parseFlowPlanDraft` / `flowPlanDraftSchema`。
- 验收检查：
  - 单测覆盖四种 source：`figma`、`inferred`、`user_confirmed`、`missing`。
  - 单测覆盖未确认 interaction 仍可存在于 draft，但不能标记为 converted。
- 覆盖验收标准：AC2, AC4, AC9。

### STEP-2：实现候选页面识别

- 落地文件/模块：
  - `src/flow-plan/page-candidates.ts`
  - `tests/unit/flow-plan/page-candidates.test.ts`
- 依赖：STEP-1。
- 操作要点：
  1. 输入 `DesignBundle`。
  2. 从 `bundle.pages[]` 和 `rootNodeIds` 识别候选页面。
  3. 基于尺寸、名称、root 节点数量、可见节点数量判断 role：
     - `entry`
     - `screen`
     - `state`
     - `component`
     - `unknown`
  4. 不把 role 推断当作业务事实，只写入 `confidence` 和 `reason`。
  5. 单页面输入输出明确报告“不满足多页面 Flow 验证条件”。
- 验收检查：
  - 2+ page fixture 能识别至少两个候选页面。
  - 单 page fixture 返回结构化 insufficient 条件。
- 覆盖验收标准：AC1, AC8。

### STEP-3：提取和归类 Figma interactions

- 落地文件/模块：
  - `src/flow-plan/interaction-candidates.ts`
  - `tests/unit/flow-plan/interaction-candidates.test.ts`
  - `tests/fixtures/flow-plan/interaction-supplement.ts`
- 依赖：STEP-1, STEP-2。
- 操作要点：
  1. 定义 spike-only `InteractionSupplement` 输入结构，作为 Figma prototype interaction 的临时载体，不写入正式 `DesignBundle`：
     ```typescript
     interface InteractionSupplement {
       schemaVersion: "m4-spike";
       projectId: string;
       sourceDesignBundleRevision: number;
       interactions: Array<{
         sourceNodeId: string;
         trigger: "click" | "hover" | "timeout" | "unknown";
         actionType: "node" | "unknown";
         targetNodeId?: string;
         rawSource: "figma_rest_probe" | "fixture" | "manual";
       }>;
     }
     ```
  2. 优先读取 `InteractionSupplement`；没有 supplement 时，不能声称已读取 Figma interactions。
  3. 若后续获得单独 live 授权，可新增只读 probe 生成 supplement，但这属于独立授权路径。
  4. 将 supplement 中目标明确、可映射到候选页面的 interaction 标记为 `source: "figma"`。
  5. 对按钮/链接/submit 文案与页面名的弱匹配生成 `source: "inferred"`，并附带 `reason`。
  6. 对明显可交互但没有目标的节点生成 `source: "missing"`。
  7. hover/timeout 只作为交互事实记录，不自动转成业务导航，除非 target 和意图明确。
- 验收检查：
  - Figma interaction fixture 能产生 `figma` interaction。
  - 文案推断 fixture 能产生 `inferred` interaction。
  - 无目标按钮 fixture 能产生 `missing` interaction。
  - 没有 `InteractionSupplement` 时，报告 `figmaInteractionSource: "absent"`，而不是伪造 `figma` 来源。
  - 未确认 `inferred` / `missing` 不含可转换 action。
- 覆盖验收标准：AC2, AC8, AC9。

### STEP-4：生成 chat 确认问题

- 落地文件/模块：
  - `src/flow-plan/confirmation-questions.ts`
  - `tests/unit/flow-plan/confirmation-questions.test.ts`
- 依赖：STEP-3。
- 操作要点：
  1. 为每个 `inferred` 和 `missing` interaction 生成中文问题。
  2. 问题必须包含：
     - 源页面或节点名称。
     - Agent 推断或缺失的原因。
     - 可选目标页面列表。
     - “保持静态 / 不实现”的选项。
  3. 不为 `figma` 且目标明确的 interaction 生成必答问题。
  4. 问题 id 要稳定，便于测试和报告引用。
- 验收检查：
  - 每个 `inferred` / `missing` 都有 question。
  - question 中不泄露 Figma raw token 或完整私密 URL。
- 覆盖验收标准：AC3, AC8。

### STEP-5：应用用户确认结果

- 落地文件/模块：
  - `src/flow-plan/apply-confirmations.ts`
  - `tests/unit/flow-plan/apply-confirmations.test.ts`
- 依赖：STEP-4。
- 操作要点：
  1. 接收 `{ questionId, answer }[]` 形式的确认输入。
  2. 将被用户确认的 inferred interaction 改写为 `source: "user_confirmed"`，`confirmed: true`。
  3. 用户选择“不实现”时保留 interaction，但设置 `blockedReason`，不能转换为 action。
  4. 对缺失或非法 answer fail closed，不猜默认跳转。
- 验收检查：
  - 合法确认能生成 `user_confirmed`。
  - 缺失确认不会生成可转换 action。
  - “保持静态”不会生成 action。
- 覆盖验收标准：AC4, AC5。

### STEP-6：FlowPlanDraft 转换为 UISpec actions 和 behaviorFixtures

- 落地文件/模块：
  - `src/flow-plan/to-ui-spec.ts`
  - `tests/unit/flow-plan/to-ui-spec.test.ts`
- 依赖：STEP-5。
- 操作要点：
  1. 输入现有 `UISpecDraft` 和 `FlowPlanDraft`。
  2. 只转换：
     - `source: "figma"` 且目标明确。
     - `source: "user_confirmed"` 且目标明确。
  3. 对 navigate：
     - 新增 `UISpec.actions[]`。
     - 将源 `button` / `link` 的 `actionId` 指向新增 action。
     - 生成 `behaviorFixture`：`click` -> `expect_page`。
  4. 对 set_state/open_dialog：
     - 只在现有 `UISpec.state` 或 dialog 节点可验证时生成。
     - 生成对应 fixture：`click` -> `expect_visible` 或 `expect_text`。
  5. 不修改视觉层，不重排页面，不新增正式 schema 字段。
- 验收检查：
  - `uiSpecDraftSchema.parse()` 通过。
  - 未确认 interaction 不产生 action。
  - 至少一个确认后的 navigate 产生 action + behaviorFixture。
- 覆盖验收标准：AC5, AC6, AC9。

### STEP-7：新增 M4-spike 本地运行脚本

- 落地文件/模块：
  - `scripts/run-m4-flowplan-spike.mjs`
  - `reports/m4-flowplan-spike/` 运行输出目录。
- 依赖：STEP-1 至 STEP-6。
- 操作要点：
  1. 输入：
     - `projectId`
     - `designBundleRevision`
     - `uiSpecRevision`
     - 可选 `interactionSupplementPath`
     - confirmation JSON 文件或内联 JSON。
  2. 运行：
     - 读取 bundle/spec。
     - 读取并校验可选 interaction supplement。
     - 构造 `FlowPlanDraft`。
     - 输出 confirmation questions。
     - 若提供 confirmations，则应用确认并生成 updated UISpec draft。
     - 可选保存新 UISpec revision。
     - 调用 `render_and_compare` 验证指定 `behaviorFixtureIds`。
  3. 输出脱敏报告：
     - page candidates。
     - interaction classification。
     - confirmation questions。
     - converted actions。
     - unresolved interactions。
     - interaction supplement 来源：`absent`、`fixture`、`manual` 或 `figma_rest_probe`。
     - validation result。
  4. 脚本默认不调用外部服务；live Figma 只允许作为单独授权路径。
- 验收检查：
  - 无 confirmations 时只生成问题和报告，不写 UISpec。
  - 有 confirmations 时生成 UISpec revision 并能跑 behavior fixture。
  - 报告包含 AC8 所需未确认/未实现列表。
- 覆盖验收标准：AC3, AC4, AC5, AC6, AC7, AC8, AC9。

### STEP-8：准备 fixture 和集成验证

- 落地文件/模块：
  - `tests/fixtures/flow-plan/multipage-flow.ts`
  - `tests/integration/flow-plan/m4-flowplan-spike.test.ts`
  - 如需要，复用 `tests/integration/validation/render-and-compare.test.ts` 中已有多页面行为样例。
- 依赖：STEP-7。
- 操作要点：
  1. 准备一个多页面 fixture：
     - page A：入口页，有按钮或链接。
     - page B：目标页，有可见文本。
     - 可选 page C：未确认目标，用于 unresolved 报告。
  2. 准备一个 interactions fixture：
     - 一个明确 Figma navigation。
     - 一个 inferred navigation。
     - 一个 missing target。
  3. 集成测试验证：
     - 未确认时不生成 action。
     - 确认后生成 action + fixture。
     - `render_and_compare` 执行 fixture 后通过。
- 验收检查：
  - `npm run test:unit -- tests/unit/flow-plan`
  - `npm run test:integration -- tests/integration/flow-plan/m4-flowplan-spike.test.ts`
  - `npm run typecheck`
- 覆盖验收标准：AC1 至 AC9。

### STEP-9：报告和 go/no-go 判定

- 落地文件/模块：
  - `reports/m4-flowplan-spike/<run-id>/summary.json`
  - `reports/m4-flowplan-spike/<run-id>/summary.md`
  - 可选 Worktrail 候选，需用户显式要求。
- 依赖：STEP-8。
- 操作要点：
  1. 报告必须给出：
     - 是否满足多页面 Flow 验证条件。
     - `figma` / `inferred` / `user_confirmed` / `missing` 数量。
     - 转换为 action 的数量。
     - behavior fixture 结果。
     - 未确认和未实现的 interaction 列表。
  2. 明确结论：
     - `passed`: M4-spike 链路成立，可进入正式 M4 设计。
     - `partial`: 静态/提问可行，但转换或验证未通过。
     - `failed`: 页面识别、确认、转换或验证关键链路失败。
  3. 不把 `partial` 或 `failed` 解释成 M5/M6/M7 可开始。
- 验收检查：
  - 报告字段完整。
  - 报告中的 `passed` 必须与测试/验证结果一致。
- 覆盖验收标准：AC7, AC8, AC9。

## Coding Agent 任务卡

### T01：FlowPlanDraft 类型与页面识别

- goal：建立 spike-only FlowPlanDraft 与页面候选识别。
- prerequisites：GATE-00 通过。
- must-read：
  - `docs/flow-plan-conclusion.md`
  - `src/design-bundle/schema.ts`
  - `src/ui-spec/schema.ts`
- owns：
  - `src/flow-plan/draft.ts`
  - `src/flow-plan/page-candidates.ts`
  - `tests/unit/flow-plan/draft.test.ts`
  - `tests/unit/flow-plan/page-candidates.test.ts`
- must-not-touch：
  - `src/project-store/*`
  - `src/tools/contracts.ts`
  - `package-lock.json`
- actions：
  - 定义类型和 zod schema。
  - 实现页面候选识别。
  - 添加单测。
- expected outputs：
  - FlowPlanDraft 可解析。
  - 页面候选可识别或明确报告单页面不足。
- verify：
  - `npm run test:unit -- tests/unit/flow-plan/draft.test.ts tests/unit/flow-plan/page-candidates.test.ts`
- done conditions：
  - AC1、AC2、AC4 的基础结构通过。
- stop/escalate conditions：
  - 需要把 FlowPlanDraft 放入正式 DesignBundle/UISpec 字段。
- handoff：
  - 输出 draft schema 和 page candidate 示例给 T02。

### T02：Interaction 分类、确认问题和确认应用

- goal：实现 figma/inferred/user_confirmed/missing 分类闭环。
- prerequisites：T01 完成。
- must-read：
  - `src/figma/normalize.ts`
  - `src/runtime/inspect-agent-context.ts`
  - `src/tools/unsupported-features.ts`
- owns：
  - `src/flow-plan/interaction-candidates.ts`
  - `src/flow-plan/confirmation-questions.ts`
  - `src/flow-plan/apply-confirmations.ts`
  - 对应 unit tests。
- must-not-touch：
  - 正式 Pi tool contract。
  - Figma REST client rate-limit 逻辑。
- actions：
  - 提取 figma interaction supplement。
  - 实现推断/缺失分类。
  - 生成中文确认问题。
  - 应用用户确认结果。
- expected outputs：
  - 所有 inferred/missing 均有问题。
  - 未确认默认 fail closed。
- verify：
  - `npm run test:unit -- tests/unit/flow-plan/interaction-candidates.test.ts tests/unit/flow-plan/confirmation-questions.test.ts tests/unit/flow-plan/apply-confirmations.test.ts`
- done conditions：
  - AC2、AC3、AC4、AC5 基础通过。
- stop/escalate conditions：
  - 需要 live Figma 才能继续，但未授权。
- handoff：
  - 输出 confirmed/unresolved interaction 示例给 T03。

### T03：转换为 UISpec action 和 behavior fixture

- goal：把确认后的 FlowPlanDraft 转换成可验证的 UISpec 行为。
- prerequisites：T02 完成。
- must-read：
  - `src/ui-spec/schema.ts`
  - `src/preview/json-render-adapter.ts`
  - `preview/src/preview-app.tsx`
  - `src/validation/render-and-compare.ts`
- owns：
  - `src/flow-plan/to-ui-spec.ts`
  - `tests/unit/flow-plan/to-ui-spec.test.ts`
- must-not-touch：
  - Preview action dispatcher，除非现有行为无法验证且需另起设计。
  - 正式 UISpec schema，除非停止并升级正式 M4。
- actions：
  - 生成 navigate/set_state/open_dialog actions。
  - 绑定 button/link actionId。
  - 生成 behaviorFixtures。
  - 校验 updated UISpec draft。
- expected outputs：
  - confirmed navigate 能通过 schema。
  - unconfirmed interaction 不产生 action。
- verify：
  - `npm run test:unit -- tests/unit/flow-plan/to-ui-spec.test.ts`
- done conditions：
  - AC5、AC6 通过。
- stop/escalate conditions：
  - 需要新增 UISpec action kind。
- handoff：
  - 输出 updated UISpec draft 和 fixture id 给 T04。

### T04：Spike harness、集成验证和报告

- goal：把 M4-spike 链路跑成一次可审计本地验证。
- prerequisites：T03 完成。
- must-read：
  - `src/project-store/store.ts`
  - `src/validation/render-and-compare.ts`
  - `scripts/run-m3-blind.mjs`
- owns：
  - `scripts/run-m4-flowplan-spike.mjs`
  - `tests/fixtures/flow-plan/*`
  - `tests/integration/flow-plan/m4-flowplan-spike.test.ts`
  - `reports/m4-flowplan-spike/*`
- must-not-touch：
  - `scripts/run-m3-blind.mjs`
  - `scripts/freeze-m3.mjs`
  - `data/baselines/m3/*`
- actions：
  - 编写本地 harness。
  - 准备多页面 fixture。
  - 跑集成验证。
  - 生成 summary 报告。
- expected outputs：
  - 一次完整本地 spike run。
  - 报告能支撑 go/no-go。
- verify：
  - `npm run typecheck`
  - `npm run test:unit -- tests/unit/flow-plan`
  - `npm run test:integration -- tests/integration/flow-plan/m4-flowplan-spike.test.ts`
- done conditions：
  - AC1 至 AC9 均有证据。
- stop/escalate conditions：
  - fixture 通过但真实 Figma 无法支持，需要单独 live 授权。
- handoff：
  - 把报告交给 plan-review / design-review，决定是否进入正式 M4。

## 风险与回滚

- 风险：把 spike-only FlowPlanDraft 误升级成正式契约。
  - 关联步骤：STEP-1 至 STEP-9。
  - 影响：正式 Schema/存储边界提前漂移。
  - 缓解 / 回滚：所有文件放在 `src/flow-plan/*` 和 `scripts/run-m4-flowplan-spike.mjs`，不改 `src/tools/contracts.ts` / `src/project-store`；若需要持久化，停止并进入正式 M4 设计。

- 风险：Agent 推断被误当成用户确认。
  - 关联步骤：STEP-3 至 STEP-6。
  - 影响：生成未经授权的业务行为。
  - 缓解 / 回滚：`to-ui-spec` 只接受 `figma` 和 `user_confirmed`；单测覆盖 inferred/missing 不生成 action。

- 风险：Figma interactions 在 REST payload 中缺失或格式变化。
  - 关联步骤：STEP-3。
  - 影响：无法用 Figma interaction 证明业务 Flow。
  - 缓解 / 回滚：缺失 supplement 时报告 `figmaInteractionSource: "absent"`；缺失目标时标记 `missing`，生成确认问题，不生成业务行为。

- 风险：多页面静态视觉生成不足导致 behaviorFixture 无法定位节点。
  - 关联步骤：STEP-6 至 STEP-8。
  - 影响：FlowPlan 链路可推导但无法被 Playwright 验证。
  - 缓解 / 回滚：先用 fixture 验证链路；真实 Figma 失败时报告为 `partial`，不推进 M5/M6。

- 风险：报告与验证结果不一致。
  - 关联步骤：STEP-9。
  - 影响：误判可进入正式 M4。
  - 缓解 / 回滚：报告状态由 validation result、converted action count、behavior fixture result 和 unresolved interaction reporting completeness 计算，不手写通过状态；允许存在 unresolved interaction，但必须完整列出。

## 验收标准覆盖检查

- AC1 → STEP-2, STEP-8, STEP-9
- AC2 → STEP-1, STEP-3
- AC3 → STEP-4, STEP-7
- AC4 → STEP-1, STEP-5, STEP-7
- AC5 → STEP-5, STEP-6
- AC6 → STEP-6, STEP-8
- AC7 → STEP-7, STEP-8, STEP-9
- AC8 → STEP-3, STEP-4, STEP-7, STEP-9
- AC9 → GATE-00, STEP-1, STEP-6, STEP-7

## 待确认 / 残留假设

- 【假设】M4-spike 可以先基于 fixture 和已有 `DesignBundle` 运行，不要求第一次就调用 live Figma。
  - 验证方法：GATE-00 明确 live 授权状态；无授权时只跑本地 fixture。
- 【假设】当前 `UISpec.actions` 足以表达 M4-spike 需要验证的最小 Flow。
  - 验证方法：若 STEP-6 发现需要新增 action kind，停止并升级正式 M4 设计。
- 【假设】M4-spike 报告可以先落在 `reports/m4-flowplan-spike/`，不作为正式 Worktrail 知识。
  - 验证方法：用户明确要求持久化到 Worktrail 时，再用 Worktrail draft/review 流程。

## 下一步

建议先对本计划运行 plan-review-loop。评审通过后，按 T01 → T02 → T03 → T04 顺序实施。实施阶段默认不调用外部服务、不新增依赖、不提交 git；任何 live Figma 验证、Worktrail promote、commit/push 都需要单独确认。
