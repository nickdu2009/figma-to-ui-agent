---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-m5-1-coverage-engine-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent M5.1 Coverage Engine 实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M5.1 Coverage Engine 实施计划

## 来源与对齐

- 需求来源：M5 live blind 后的视觉目标调整与 Coverage Engine 方向确认。
- 设计来源：`architecture/figma-coverage-engine-design.md`。
- 上游验证来源：`validation/figma-to-ui-agent-m5-static-generation-result.md`。
- 上游计划来源：`workflows/figma-to-ui-agent-m5-static-generation-plan.md`。
- 当前代码基线：
  - `src/static-generation/report.ts` 已有 `M5StaticReportSchema`，`schemaVersion` 固定为 `"1"`，当前还没有 `CoverageReport`、逐页 `CoverageMatrix`、`CoverageRecord[]` 和 `PageSizeDiagnostic`。
  - `src/static-generation/visual-layer-planner.ts` 已有视觉层规划，但主要靠面积和少量名称命中，小图标、线条、logo、decorative vector 仍可能漏掉。
  - `src/figma/inspector.ts` 已通过 `/v1/images/:file_key` 导出 page screenshot、image fill 和部分 visual layer；当前 `inspect()` 无条件调用 `getLocalVariables()`，因此受限 live 需要显式禁用 Variables 的内部入口。
  - `src/static-generation/node-mapper.ts`、`style-mapper.ts`、`page-mapper.ts`、`src/preview/json-render-adapter.ts` 已支持结构化 DOM、image、`pixel_overlay` 和 button icon 的基础渲染。
  - `src/validation/render-and-compare.ts` 目前以 `Math.min(viewport.height, expectedRef.height)` 计算 canvasHeight，长页面会被 viewport 截断；case-c 已暴露 `1778 -> 900` 的问题。
  - `scripts/run-m5-static.mjs` 已输出 `summary.json`/`summary.md`，但 markdown 还未展示 coverage matrix、page height diagnostic 和 coverage attribution，且尚无测试断言 markdown 必须由 JSON 完整派生。
  - `scripts/` 当前没有受限 live M5.1 wrapper；`scripts/run-m5-static.mjs` 只消费已保存的 `DesignBundle`。
- 当前 blind baseline：case-a diff 14.12%，case-b diff 71.44%，case-c diff 34.58%；case-a/b/c 都有 vector 或 viewport coverage 缺口。
- ADR 约束：无独立 Accepted ADR 文件作为冻结约束；本计划只把已推广架构中的现有约束作为执行来源。架构文档中的 ADR-COV-001/002/004 仍为 Proposed，不作为冻结 ADR。

## 决策锁

- 禁止整页 `backgroundSnapshot` / root screenshot fallback。
- 继续保持四个模型可见工具：`inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`。
- DOM 控件继续负责 input、button、link、focus、keyboard 和测试。
- Coverage 结果归 report 所有；`DesignBundle` 保持设计事实，`UISpec` 只保存渲染需要的结构化节点。
- static-time 不能重新访问 Figma；缺少 asset 时只能报告 `unsupported_missing_asset` / `visual_layer_no_asset` 并建议重新 inspect。
- 产品默认 inspect 保留 Variables optional policy；受限 live M5.1 通过内部参数禁用 Variables，不删除默认能力。
- 本计划做 M5.1 Coverage Engine L1，并推进到 L2；不做 M6 跨页面 Flow 执行验证，也不做 M7 复杂业务状态机。
- 兼容策略：additive compatibility。默认保持 `M5StaticReport.schemaVersion: "1"`，新增 M5.1 字段必须兼容旧 M5 报告 fixture。

## 授权边界

- 本计划被接受仅表示：可以作为 M5.1 coding agent 的执行来源。
- 不自动授权：
  - 新增或升级 npm 依赖、修改 package/lockfile。
  - 调用外部 Figma/OpenAI、执行 live blind、下载真实远端资产。
  - 新增模型可见工具或改变 Pi tool boundary。
  - commit、push、deploy、删除用户数据或清理无关 dirty worktree。
  - 推广、丢弃其他 Worktrail candidate。
- 执行前需单独确认：
  - `GATE-LIVE-M5.1` 下真实 Figma 文件回归。
  - `GATE-UISPEC-SCHEMA` 下的 UISpec schema additive change。
  - `GATE-DEPENDENCY` 下任何依赖或 lockfile 变化。
  - `GATE-GIT` 下 commit/push。

## Truth 与 Ownership

- 设计事实 owner：`ProjectStore` 中已校验保存的 `DesignBundle`。
- Figma 远端事实 owner：受授权的 `inspect_figma` / `FigmaInspector` inspect-time 输出；static-time 不能自行补远端事实。
- Coverage 事实 owner：M5.1 `CoverageReport` / `M5StaticReport` 扩展，而不是 `UISpec` 节点自由字段。
- inspect-to-static 诊断 owner：共享纯函数 `src/static-generation/visual-asset-priority.ts`，由 inspect-time 和 static-time 使用同一 priority/budget 规则，保证 budget exceeded 可在无 Figma 访问时重算归因。
- 渲染事实 owner：`UISpec` 中的 `image`、`pixel_overlay`、结构化 DOM 节点和 preview renderer。
- 行为事实 owner：正式 FlowPlan 与用户确认；M5.1 不新增行为推断。
- 非 truth surfaces：agent prompt、临时截图、`summary.md` 自由文本、未推广 candidate、测试 fixture、console 日志。
- 共享写面单 owner：
  - Coverage schema/classifier：`src/static-generation/coverage.ts`。
  - visual asset priority：`src/static-generation/visual-asset-priority.ts`。
  - M5/M5.1 report：`src/static-generation/report.ts`、`src/static-generation/report-markdown.ts`、`scripts/run-m5-static.mjs`。
  - inspect-time asset export：`src/figma/inspector.ts`、`src/figma/normalize.ts`。
  - static mapping：`src/static-generation/visual-layer-planner.ts`、`node-mapper.ts`、`style-mapper.ts`、`page-mapper.ts`。
  - renderer/compare：`src/preview/json-render-adapter.ts`、`src/validation/render-and-compare.ts`、`preview/src/preview-app.tsx`。
  - live wrapper：`scripts/run-m5-live-restricted.mjs`。
  - tests：`tests/unit/static-generation/*`、`tests/integration/static-generation/*`、`tests/integration/figma/*`、`tests/integration/validation/*`、`tests/e2e/*`。

## 验收标准追溯

- AC1：每个进入 `DesignBundle` 的可见节点都有 `CoverageRecord`，无静默 unmapped。
- AC2：vector/icon/logo/line/decorative/image fill 被分类为 rendered、ignored_safe、unsupported 或 budget_exceeded；`unmapped_node_vector` 不再作为主要缺口形式出现。
- AC3：inspect-time 能按优先级规划并导出局部 visual asset，每页上限 80，单 `/images` 请求最多 100 ids，超预算必须入报告。
- AC4：static-time 只消费已有 DesignBundle/assets/provenance；缺 asset 不重新访问 Figma，只报告并建议重新 inspect。
- AC5：DOM 控件仍可编辑、可聚焦、可点击；overlay 默认 `pointerEvents: none`，不得遮挡交互。
- AC6：overlay/image 按 page-relative bounds、zIndex、opacity 渲染；图标优先进入 button icon asset，而非随意 root overlay。
- AC7：长页面比较支持 full-page capture 或明确 `viewport_crop`，case-c 不再把 `1778px` 静默截成 `900px` 当作通过证据。
- AC8：`M5StaticReport` 在 `schemaVersion: "1"` 下 additive 扩展出 `coverageVersion: "1"`、逐页 `CoverageMatrix`、`CoverageRecord[]`、`PageSizeDiagnostic` 和 aggregate 统计；旧 M5 报告 fixture 继续 parse。
- AC9：ProjectStore 继续拒绝整页 screenshot/root 单 overlay 伪通过。
- AC10：本地验证通过：`npm run typecheck`、`npm run test:unit`、`npm run test:integration`、`npm run test:e2e`。
- AC11：受限 live M5.1 blind 默认不调用 `/v1/me`、OpenAI、Variables；产品默认 inspect 仍保留 Variables optional policy。
- AC12：相对当前 baseline，至少满足一项：任一 case diff 相对下降 30%，或三例 aggregate diff 相对下降 20%，或 diff 未下降但剩余差距全部可归因且没有 unmapped 节点。

## 开工 Gate

### GATE-00：当前基线确认

- goal：确认实施者以已推广的 M5 验收和 Coverage Engine 架构为输入，不回退到 M5 之前的静态方案。
- prerequisites：`architecture/figma-coverage-engine-design.md` 与 `validation/figma-to-ui-agent-m5-static-generation-result.md` 可读。
- owns：M5.1 go/no-go 与范围边界。
- must-not-touch：M6/M7 行为契约、模型可见工具列表、外部服务、依赖。
- actions：
  1. 检查 Worktrail 正式文档存在。
  2. 检查当前 dirty worktree，记录但不清理无关改动。
  3. 确认 M5.1 只处理 coverage、asset、render compare、report，不处理 Flow 行为。
- expected outputs：基线说明、风险说明、可进入 T01 的结论。
- verify：`worktrail context --semantic=auto "M5.1"` 可列出 Coverage Engine 架构和 M5 validation；若语义索引 fallback，需要记录 fallback 原因但不阻塞。
- done conditions：T01 可以开始。
- stop/escalate conditions：正式架构缺失、M5 validation 被撤销、用户要求同时实现 M6/M7。
- handoff：把正式来源路径和当前 dirty 状态交给实现者。

### GATE-REPORT-SCHEMA：M5.1 report 兼容策略

- goal：把 coverage/report schema 扩展做成可执行契约，避免破坏旧 M5 报告。
- prerequisites：T01 前必须完成。
- owns：`src/static-generation/report.ts`、`tests/unit/static-generation/report-schema.test.ts`。
- must-not-touch：`schemaVersion` 不升级到 `"2"`，除非另起 schema migration 计划并获确认。
- actions：
  1. 保持 `m5StaticReportSchema.shape.schemaVersion` 为 `z.literal("1")`。
  2. 新增 `coverageVersion?: "1"` 与 `coverage?: CoverageReport`；旧 M5 报告允许缺省。
  3. 新增 M5.1 runner 内部校验函数或 schema，例如 `m5StaticCoverageReportSchema`，要求 `coverageVersion` 和 `coverage` 必须存在。
  4. 在 `tests/unit/static-generation/report-schema.test.ts` 中同时覆盖旧 M5 fixture parse 与 M5.1 required coverage parse。
- expected outputs：旧 M5 兼容、新 M5.1 严格。
- verify：`npx vitest run tests/unit/static-generation/report-schema.test.ts`。
- done conditions：旧 fixture 不改即可通过，新 M5.1 fixture 缺 coverage 会失败。
- stop/escalate conditions：必须升级 `schemaVersion` 或迁移历史报告。
- handoff：report schema contract 摘要。

### GATE-RESTRICTED-LIVE-INTERFACE：受限 live 内部接口

- goal：让 AC11 可执行，避免受限 live 路径仍由 `src/figma/inspector.ts` 无条件调用 Variables。
- prerequisites：T03 前设计，T07 前实现并测试。
- owns：`src/figma/inspector.ts`、`scripts/run-m5-live-restricted.mjs`、`tests/integration/figma/inspector.test.ts`。
- must-not-touch：模型可见工具 schema、产品默认 Variables optional policy、OpenAI provider。
- actions：
  1. 给 `FigmaInspector.inspect()` 增加内部选项，例如 `variablesMode: "default_optional" | "disabled_restricted_live"`，默认值保持 `default_optional`。
  2. `disabled_restricted_live` 路径不得调用 `restClient.getLocalVariables()`；应直接使用 binding inference / repeated design values fallback，并记录 `variables_disabled_restricted_live` warning。
  3. 新增 `scripts/run-m5-live-restricted.mjs`，顺序执行 inspect + static + compare，并把接口边界写入 report，例如 `apiBoundary: { openai: false, figmaMe: false, variables: false }`。
  4. 用 fake/rest spy integration test 证明 restricted runner 或 inspector option 未调用 `getLocalVariables()`。
- expected outputs：受限 live 可真实运行，且不依赖人工日志证明没有 Variables 调用。
- verify：`npx vitest run tests/integration/figma/inspector.test.ts`，并在 T07 检查 live aggregate 的 `apiBoundary`。
- done conditions：默认 inspect 仍可尝试 Variables；restricted live 明确禁用 Variables。
- stop/escalate conditions：需要改变模型可见 `inspect_figma` tool contract 或删除默认 Variables 能力。
- handoff：restricted live interface contract。

### GATE-UISPEC-SCHEMA：可选 UISpec schema 扩展

- goal：只有现有 `image` / `pixel_overlay` / button icon asset 无法表达必要视觉时，才允许扩展 UISpec。
- prerequisites：T03/T04 的测试证明确实需要新增字段。
- owns：`src/ui-spec/schema.ts`、renderer、ProjectStore compatibility。
- must-not-touch：未经确认不得向 strict UINode schema 添加任意 provenance 字段。
- actions：提出 additive schema 变更、旧 fixture 兼容测试、renderer/store 测试。
- expected outputs：单独 schema 变更计划或确认无需 schema 变更。
- verify：旧 UISpec fixture 仍 parse，新字段仅在需要处出现。
- done conditions：schema 变更被单独确认，或证明无需变更。
- stop/escalate conditions：需要公共契约变更但没有确认。
- handoff：schema gate 结论。

### GATE-LIVE-M5.1：受限 live 回归

- goal：仅在本地测试通过后，对三例真实 Figma 文件验证泛化效果。
- prerequisites：用户明确授权访问 Figma；限流和 429 日志保持启用；`GATE-RESTRICTED-LIVE-INTERFACE` 已通过；报告路径已确认。
- owns：live input、run id、脱敏报告和 Worktrail validation candidate。
- must-not-touch：OpenAI、`/v1/me`、Variables 受限路径、未授权文件。
- actions：执行 `scripts/run-m5-live-restricted.mjs`，生成 aggregate 和逐 case summary。
- expected outputs：diff、coverage matrix、height diagnostic、unsupported attribution、无 token/raw URL 泄露。
- verify：报告显示 `apiBoundary.openai=false`、`apiBoundary.figmaMe=false`、`apiBoundary.variables=false`；若产品默认 inspect 调用 Variables，必须是非受限路径并按 optional policy 处理。
- done conditions：AC11/AC12 有证据。
- stop/escalate conditions：429 超出 bounded retry、token scope 不足、报告可能含敏感信息。
- handoff：live validation 结果进入 Worktrail validation 候选。

### GATE-DEPENDENCY / GATE-GIT

- goal：隔离依赖、提交和远端副作用。
- prerequisites：用户分别明确授权。
- owns：package/lockfile、commit、push。
- must-not-touch：没有授权不得改依赖、commit、push。
- actions：如需新增依赖或提交，先说明必要性、影响和验证。
- verify：`git status --short`、staged diff allowlist、对应测试。
- done conditions：授权范围内完成。
- stop/escalate conditions：dirty worktree 有无关改动影响 staged diff。
- handoff：提交或依赖变更证据。

## Inspect-to-static 诊断契约

- static-time 不读取 Figma，但必须能解释 inspect-time 未导出的视觉节点。
- 新增共享纯函数模块 `src/static-generation/visual-asset-priority.ts`：
  - 输入：normalized source node、page bounds、父级语义、zOrder、视觉元数据。
  - 输出：`VisualAssetCandidate`，包含 `sourceNodeId`、`sourcePageId`、`priorityRank`、`reasonCode`、`eligible`、`budgetGroup`、`pageRelativeBounds`。
  - inspect-time 用它选择 `/v1/images` 导出节点；static-time 用同一函数重算候选列表和 budget cutoff。
- `budget_exceeded` 判定：同页 eligible candidate 排名超过 `MAX_VISUAL_LAYERS_PER_PAGE`，且未被父 asset 覆盖。
- `unsupported_missing_asset` 判定：排名在 budget 内、应该有 asset，但 DesignBundle 中没有 local asset/provenance。
- `visual_layer_no_asset` 判定：节点应以视觉层表达，但当前 UISpec/renderer 或 asset 类型不能渲染。
- 该契约不要求把 coverage facts 写入 `DesignBundle`；只允许保留已存在的 local asset/provenance 和必要的 source node metadata。
- 验证：同一 fixture 在 inspect priority test 与 static coverage test 中产生相同 `priorityRank`、budget cutoff 和 reasonCode。

## 并行规划

[parallelism:
- independent lanes: classifier/report schema 测试夹具、inspect-time asset priority、render-and-compare full-page diagnostic 可以先并行调查
- sequential blockers: GATE-REPORT-SCHEMA 先于 T01；T01 coverage schema 先于 T02/T04；T03 inspect-time asset policy 和 GATE-RESTRICTED-LIVE-INTERFACE 先于 live 回归；T05 full-page capture 先于 case-c 验收；T06 report/runner 汇总先于 validation candidate
- shared write surfaces: `src/static-generation/report.ts`、`src/static-generation/coverage.ts`、`src/static-generation/visual-asset-priority.ts`、`src/figma/inspector.ts`、`src/validation/render-and-compare.ts`、`scripts/run-m5-static.mjs` 必须单 owner 顺序落地
- delegation: 0；当前仓库有较多 dirty/untracked 文件，计划阶段不拆多 agent 写入，避免 schema、runner、report 多头漂移
]

## 实施步骤

### 步骤 1：新增 Coverage schema、report schema 兼容与 classifier

- 落地文件/模块：
  - `src/static-generation/coverage.ts`
  - `src/static-generation/report.ts`
  - `tests/unit/static-generation/coverage-classifier.test.ts`
  - `tests/unit/static-generation/report-schema.test.ts`
- 依赖：GATE-00、GATE-REPORT-SCHEMA。
- 操作要点：
  - 定义 `CoverageDecision`、`CoverageReasonCode`、`CoverageRecord`、`CoverageMatrix`、`PageCoverageMatrix`、`CoverageReport`。
  - `CoverageReasonCode` 必须包含 `budget_exceeded`、`unsupported_missing_asset`、`visual_layer_no_asset`、`covered_by_parent_asset`。
  - `m5StaticReportSchema` 保持 `schemaVersion: "1"`，additive 增加可选 `coverageVersion` 和 `coverage`。
  - 新增 M5.1 严格校验入口，runner 输出必须包含 `coverageVersion: "1"` 和完整 `coverage`。
  - classifier 输入 `DesignBundle` + `StaticPagePlan` + visual candidate/budget 结果，输出逐节点 decision。
  - 可见节点必须覆盖；hidden/0 面积/透明/被父 asset 覆盖进入 `ignored_safe`。
  - vector/icon/logo/line/decorative/image fill 必须进入 rendered、ignored_safe、unsupported 或 budget_exceeded，不允许直接消失。
  - Coverage report 归 report schema 所有，不把 coverage facts 写入 `DesignBundle`。
- 验收检查（verify）：
  - `npx vitest run tests/unit/static-generation/coverage-classifier.test.ts tests/unit/static-generation/report-schema.test.ts`
  - fixture 覆盖 text、input、button、container、image、vector、line、hidden、covered-by-parent、budget_exceeded。
  - 旧 M5 report fixture 缺 `coverage` 仍通过；M5.1 required schema 缺 `coverage` 必须失败。
- 覆盖验收标准：AC1、AC2、AC8。

### 步骤 2：共享 visual asset priority 与 inspect/static 证据链

- 落地文件/模块：
  - `src/static-generation/visual-asset-priority.ts`
  - `src/static-generation/visual-layer-planner.ts`
  - `src/figma/normalize.ts`
  - `tests/unit/static-generation/visual-asset-priority.test.ts`
  - `tests/unit/static-generation/visual-layer-planner.test.ts`
  - `tests/unit/figma/normalize.test.ts`
- 依赖：步骤 1。
- 操作要点：
  - 把 visual candidate 识别从 ad hoc 面积阈值抽成共享纯函数。
  - 覆盖 icon、logo、arrow、search、cart、google、github、divider、line、shape、blob、background、button 内 icon、header/nav icon。
  - 明确每页最多 80 visual asset、单 `/images` 请求最多 100 ids。
  - static-time 用同一 priority 规则重算 `budget_exceeded` 和 `unsupported_missing_asset`，不需要 Figma fileKey。
  - 对父 asset 完全覆盖的子节点输出 `ignored_safe: covered_by_parent_asset`。
- 验收检查（verify）：
  - `npx vitest run tests/unit/static-generation/visual-asset-priority.test.ts tests/unit/static-generation/visual-layer-planner.test.ts tests/unit/figma/normalize.test.ts`
  - fixture 证明 inspect priority 和 static coverage 对同一节点给出一致 reason/budget cutoff。
- 覆盖验收标准：AC2、AC3、AC4、AC6。

### 步骤 3：扩展 inspect-time visual asset export policy 与 restricted Variables mode

- 落地文件/模块：
  - `src/figma/normalize.ts`
  - `src/figma/inspector.ts`
  - `src/figma/assets.ts`（仅当现有下载器需要补 MIME/错误处理）
  - `tests/unit/figma/normalize.test.ts`
  - `tests/integration/figma/inspector.test.ts`
- 依赖：步骤 1、步骤 2、GATE-RESTRICTED-LIVE-INTERFACE；不依赖 static-time 远端调用。
- 操作要点：
  - inspect-time 使用 `visual-asset-priority.ts` 输出 render id plan。
  - 导出优先级：image fill、button 内 icon、logo、nav/header icon、line/divider、large visual、named decorative、structural visual、other vector。
  - 超预算节点不请求 `/images`，但进入 coverage/report 可重算链路，reason 为 `budget_exceeded`。
  - 429 继续走已有 REST client bounded retry/logging。
  - 所有远端 image URL 只用于下载，持久层只保存 project-local `figma/assets` / `figma/screenshots` 和 provenance。
  - 给 `FigmaInspector.inspect()` 增加内部 `variablesMode` 选项；默认 `default_optional` 维持现状，`disabled_restricted_live` 明确跳过 `getLocalVariables()`。
  - restricted Variables 路径必须通过 fake client test 证明不会调用 `getLocalVariables()`。
- 验收检查（verify）：
  - `npx vitest run tests/unit/figma/normalize.test.ts tests/integration/figma/inspector.test.ts`
  - fixture 证明小 icon、line、logo、decorative shape 会进入 visual render id plan；不导出整页 root fallback。
  - fake client 断言 restricted mode 未调用 `getLocalVariables()`，默认 mode 保留 optional Variables 行为。
- 覆盖验收标准：AC2、AC3、AC4、AC11。

### 步骤 4：把 Coverage classification 接入 static generation

- 落地文件/模块：
  - `src/static-generation/service.ts`
  - `src/static-generation/node-mapper.ts`
  - `src/static-generation/visual-layer-planner.ts`
  - `tests/unit/static-generation/service.test.ts`
  - `tests/unit/static-generation/node-mapper.test.ts`
- 依赖：步骤 1、步骤 2。
- 操作要点：
  - `buildStaticUISpecFromDesignBundle` 先生成 page plan，再对每页调用 classifier。
  - node mapper 根据 coverage result 生成 DOM 节点和 overlay/image 节点。
  - 对已被结构化 DOM 覆盖的文本/控件记录 `structured_dom`，对 layout parent 记录 `layout_container`。
  - 对没有 asset 的 visual 节点生成 unsupportedFeature 和 coverage record，不能只生成 warning。
  - 保留 `fullPageScreenshotFallback: false` 和 ProjectStore 的 root fallback 拒绝规则。
- 验收检查（verify）：
  - `npx vitest run tests/unit/static-generation/service.test.ts tests/unit/static-generation/node-mapper.test.ts`
  - `uiSpecDraftSchema.parse` 仍通过；coverage records 数量覆盖每页可见节点。
- 覆盖验收标准：AC1、AC2、AC4、AC5、AC9。

### 步骤 5：升级 visual layer planner 与 DOM/overlay 合成

- 落地文件/模块：
  - `src/static-generation/visual-layer-planner.ts`
  - `src/static-generation/node-mapper.ts`
  - `src/static-generation/style-mapper.ts`
  - `src/preview/json-render-adapter.ts`
  - `tests/unit/static-generation/visual-layer-planner.test.ts`
  - `tests/unit/preview/json-render-adapter.test.ts`
  - `tests/e2e/preview.spec.ts`
- 依赖：步骤 2、步骤 4；若需要 schema 扩展，先过 GATE-UISPEC-SCHEMA。
- 操作要点：
  - 从面积阈值扩展为名称、类型、父级语义、位置和可见影响综合判定。
  - overlay/image 使用 page-relative bounds、zIndex、opacity、`pointerEvents: none`。
  - button 内 icon 优先作为 button icon asset，避免把可点击控件拆成 overlay。
  - 父 asset 完全覆盖的子节点进入 `ignored_safe: covered_by_parent_asset`。
  - 保持 DOM 控件真实可编辑、可聚焦、可点击。
- 验收检查（verify）：
  - `npx vitest run tests/unit/static-generation/visual-layer-planner.test.ts tests/unit/preview/json-render-adapter.test.ts`
  - `npm run test:e2e`
- 覆盖验收标准：AC2、AC5、AC6、AC9、AC10。

### 步骤 6：修复长页面 full-page capture 和 PageSizeDiagnostic

- 落地文件/模块：
  - `src/static-generation/page-mapper.ts`
  - `src/static-generation/report.ts`
  - `src/validation/render-and-compare.ts`
  - `preview/src/preview-app.tsx`（仅当 canvas sizing 需要 UI 支持）
  - `tests/integration/validation/render-and-compare.test.ts`
  - `tests/unit/static-generation/page-mapper.test.ts`
- 依赖：步骤 1；可与步骤 3 部分并行，但最终要接入 report。
- 操作要点：
  - page/root bounds 成为 content height 来源。
  - render compare 在 reference screenshot 高度大于 viewport 时支持 full-page policy，actual capture 高度覆盖 expected height。
  - 报告写入 expectedWidth/Height、actualWidth/Height、widthMatched、heightMatched、policy。
  - 如果选择 viewport crop，必须显式 `viewport_crop`，不能作为视觉通过证据。
- 验收检查（verify）：
  - `npx vitest run tests/integration/validation/render-and-compare.test.ts tests/unit/static-generation/page-mapper.test.ts`
  - fixture 覆盖 expected 1778、viewport 900 的长页面场景。
- 覆盖验收标准：AC7、AC8、AC12。

### 步骤 7：升级 runner、summary 和 report 派生

- 落地文件/模块：
  - `scripts/run-m5-static.mjs`
  - `src/static-generation/report.ts`
  - `src/static-generation/report-markdown.ts`
  - `tests/integration/static-generation/m5-static.test.ts`
  - `reports/m5-static/*`（仅本地验证输出，不作为 truth）
- 依赖：步骤 1 到步骤 6。
- 操作要点：
  - `summary.json` 通过 M5.1 required coverage schema parse。
  - 把 markdown 生成逻辑从脚本提取到 `src/static-generation/report-markdown.ts`，使测试可直接断言。
  - `summary.md` 必须完全从 JSON 派生，显示 coverage matrix、vector rendered/ignored/unsupported/budget、page height diagnostic、region diff。
  - integration test 必须读取同一次 run 的 `summary.json` 与 `summary.md`，断言 markdown 包含 JSON 中的关键 page id、coverage aggregate、height policy、budget exceeded、unsupported attribution。
  - runner 标明 `scope: static_generation_only` 和 `behaviorFlowVerified: false`。
  - `--run-compare` 合并 comparison 到 page diagnostic，不覆盖原始 coverage 事实。
- 验收检查（verify）：
  - `npx vitest run tests/integration/static-generation/m5-static.test.ts`
  - 测试自动断言 `summary.md` 字段完整；不再依赖人工手动检查作为验收。
- 覆盖验收标准：AC8、AC10、AC12。

### 步骤 8：本地全量回归与 Worktrail validation 候选

- 落地文件/模块：
  - `tests/unit/static-generation/*`
  - `tests/integration/static-generation/*`
  - `tests/integration/figma/*`
  - `tests/integration/validation/*`
  - Worktrail `validation/figma-to-ui-agent-m5-1-coverage-engine-result.md` 候选
- 依赖：步骤 1 到步骤 7。
- 操作要点：
  - 运行本地验证：`npm run typecheck`、`npm run test:unit`、`npm run test:integration`、`npm run test:e2e`。
  - 记录 coverage completeness、vector unmapped、height diagnostic、ProjectStore fallback guard、restricted Variables unit/integration evidence。
  - 只创建 validation candidate，不自动 promote，除非用户明确确认。
- 验收检查（verify）：
  - 上述四条命令通过。
  - validation candidate 包含命令、结果、报告路径、残留风险。
- 覆盖验收标准：AC1 到 AC11。

### 步骤 9：受限 live M5.1 blind 回归

- 落地文件/模块：
  - `scripts/run-m5-live-restricted.mjs`
  - `reports/m5-live-blind-restricted/*`
  - Worktrail validation candidate（live 结果）
- 依赖：步骤 8；必须先过 GATE-LIVE-M5.1。
- 操作要点：
  - 使用三例 baseline 文件重新 inspect + static + compare。
  - 不调用 `/v1/me`、OpenAI、Variables；产品默认 inspect 的 Variables optional policy 不因此删除。
  - 对 case-a/b/c 输出 diff、coverage matrix、height diagnostic、unmapped count、unsupported attribution、apiBoundary。
  - 根据 AC12 判断是否达到 M5.1 live 目标。
- 验收检查（verify）：
  - aggregate report 显示接口边界、diff 改善或完整 attribution。
  - 报告无 token、原始 file key、远端 asset URL 或 raw payload。
  - `apiBoundary.openai=false`、`apiBoundary.figmaMe=false`、`apiBoundary.variables=false`。
- 覆盖验收标准：AC11、AC12。

## Coding Agent 任务卡

### T01：Coverage schema、report 兼容与 classifier

- goal：让每个可见 Figma 节点得到可审计 coverage decision，同时保持旧 M5 report 兼容。
- prerequisites：GATE-00、GATE-REPORT-SCHEMA。
- must-read：`architecture/figma-coverage-engine-design.md` 第 5.1、5.6、8.1、9.1 节；`src/design-bundle/schema.ts`；`src/static-generation/report.ts`。
- owns：`src/static-generation/coverage.ts`、`src/static-generation/report.ts`、coverage/report schema unit tests。
- must-not-touch：`src/figma/inspector.ts`、`src/ui-spec/schema.ts`、package/lockfile。
- actions：实现 coverage types、classifier、matrix builder、M5.1 required coverage schema。
- expected outputs：coverage records、page matrix、aggregate stats、旧 M5 兼容测试。
- verify：`npx vitest run tests/unit/static-generation/coverage-classifier.test.ts tests/unit/static-generation/report-schema.test.ts`。
- done conditions：无 visible node 缺 coverage record；旧 M5 fixture parse 通过；M5.1 report 缺 coverage 会失败。
- stop/escalate conditions：需要修改 `DesignBundle` schema、UISpec schema 或升级 report `schemaVersion`。
- handoff：coverage API、reason code 列表、schema 兼容证据。

### T02：Visual asset priority 共享契约

- goal：让 inspect-time 和 static-time 使用同一 visual priority/budget 规则，补上 budget_exceeded 证据链。
- prerequisites：T01。
- must-read：`src/static-generation/visual-layer-planner.ts`、`src/figma/normalize.ts`、`architecture/figma-coverage-engine-design.md` 第 5.2 节。
- owns：`src/static-generation/visual-asset-priority.ts`、相关 unit tests。
- must-not-touch：Figma REST client、OpenAI provider、package/lockfile。
- actions：实现共享 candidate ranking、budget cutoff、reasonCode 映射。
- expected outputs：inspect/static 可复用的 priority API。
- verify：`npx vitest run tests/unit/static-generation/visual-asset-priority.test.ts tests/unit/static-generation/visual-layer-planner.test.ts tests/unit/figma/normalize.test.ts`。
- done conditions：budget_exceeded、unsupported_missing_asset、covered_by_parent_asset 都有 deterministic test。
- stop/escalate conditions：需要把 coverage facts 写入 DesignBundle。
- handoff：priority API 和 fixture evidence。

### T03：Inspect-time asset export 与 restricted Variables mode

- goal：让小 icon、logo、line、decorative vector 在 inspect-time 获得局部 asset 机会，并让 AC11 可执行。
- prerequisites：T01、T02、GATE-RESTRICTED-LIVE-INTERFACE。
- must-read：`src/figma/normalize.ts`、`src/figma/inspector.ts`、`src/figma/rest-client.ts`、`architecture/figma-coverage-engine-design.md` 第 5.2、7.3 节。
- owns：`src/figma/normalize.ts`、`src/figma/inspector.ts`、figma tests。
- must-not-touch：OpenAI provider、模型可见工具列表、默认 Variables optional policy。
- actions：扩展 visual layer refs、priority、budget、provenance 映射；新增 internal `variablesMode` 并测试禁用路径。
- expected outputs：局部 visual assets 被下载保存并可由 static-time 使用；restricted mode 不调用 Variables。
- verify：`npx vitest run tests/unit/figma/normalize.test.ts tests/integration/figma/inspector.test.ts`。
- done conditions：小图标/line/logo/decorative fixture 进入 render ids；budget exceeded 有报告路径；fake client 证明 restricted mode 未调用 `getLocalVariables()`。
- stop/escalate conditions：需要超过 API budget、调用未授权接口、改变 Variables 默认策略。
- handoff：asset priority、budget evidence、restricted Variables evidence。

### T04：Static generation 接入 coverage

- goal：把 coverage facts 接入 M5 static generation 和 report draft。
- prerequisites：T01、T02。
- must-read：`src/static-generation/service.ts`、`node-mapper.ts`、`visual-layer-planner.ts`。
- owns：`src/static-generation/service.ts`、`node-mapper.ts` 相关测试。
- must-not-touch：Figma REST live client、package/lockfile。
- actions：按 page plan 注入 coverage，生成 DOM/visual/unsupported 映射。
- expected outputs：扩展后的 report draft 与合法 UISpec draft。
- verify：`npx vitest run tests/unit/static-generation/service.test.ts tests/unit/static-generation/node-mapper.test.ts`。
- done conditions：service report 包含 coverage matrix，UISpec strict parse 仍通过。
- stop/escalate conditions：coverage 需要保存到 UISpec provenance 字段。
- handoff：static mapping 规则和 residual unsupported 列表。

### T05：Overlay、DOM 与 renderer 保真

- goal：保留关键视觉层，同时不牺牲真实 DOM 交互。
- prerequisites：T04；T03 可提供真实 asset evidence。
- must-read：`src/static-generation/visual-layer-planner.ts`、`src/preview/json-render-adapter.ts`、`tests/e2e/preview.spec.ts`。
- owns：visual planner、renderer adapter、preview e2e。
- must-not-touch：FlowPlan 行为、M6/M7 fixtures。
- actions：补 zIndex、opacity、bounds、button icon、pointer events、covered-by-parent。
- expected outputs：overlay/image 与 DOM 控件正确合成。
- verify：`npx vitest run tests/unit/static-generation/visual-layer-planner.test.ts tests/unit/preview/json-render-adapter.test.ts`，再跑 `npm run test:e2e`。
- done conditions：DOM 控件可用，overlay 不遮挡，visual layer 不被静默丢失。
- stop/escalate conditions：renderer 需要新节点类型或 schema 字段。
- handoff：renderer 变更摘要和 e2e 证据。

### T06：Full-page capture 与 height diagnostic

- goal：修复长页面截图截断，尤其是 case-c 类场景。
- prerequisites：T01；可与 T03/T05 分支开发。
- must-read：`src/validation/render-and-compare.ts`、`preview/src/preview-app.tsx`、`tests/integration/validation/render-and-compare.test.ts`。
- owns：render compare canvas sizing、PageSizeDiagnostic。
- must-not-touch：视觉 diff 阈值作为伪通过手段。
- actions：改 full-page policy、比较尺寸、height diagnostic、crop attribution。
- expected outputs：expected/actual 高度匹配或显式 crop policy。
- verify：`npx vitest run tests/integration/validation/render-and-compare.test.ts tests/unit/static-generation/page-mapper.test.ts`。
- done conditions：长页面 fixture 不再静默裁剪。
- stop/escalate conditions：Playwright/browser 限制导致无法捕获 full page，需要记录 unsupported。
- handoff：case-c 前置验证证据。

### T07：Runner/report markdown 派生与 validation

- goal：把 M5.1 结果变成可审计报告和 Worktrail validation 候选。
- prerequisites：T01 到 T06。
- must-read：`scripts/run-m5-static.mjs`、`tests/integration/static-generation/m5-static.test.ts`、`validation/figma-to-ui-agent-m5-static-generation-result.md`。
- owns：runner summary、`src/static-generation/report-markdown.ts`、integration tests、validation candidate draft。
- must-not-touch：Git commit/push、其他 pending candidate。
- actions：更新 `summary.json` schema、提取 markdown 派生模块、运行本地验证、起草 validation candidate。
- expected outputs：本地 M5.1 validation evidence。
- verify：`npx vitest run tests/integration/static-generation/m5-static.test.ts`，再跑 `npm run typecheck`、`npm run test:unit`、`npm run test:integration`、`npm run test:e2e`。
- done conditions：四类本地验证通过；markdown 自动化断言通过；validation candidate 可 review。
- stop/escalate conditions：测试失败无法归因、报告含敏感信息、需要外部服务。
- handoff：validation evidence 和剩余风险。

### T08：受限 live blind 回归

- goal：用真实 Figma 文件验证 M5.1 泛化和 AC12。
- prerequisites：T07；GATE-LIVE-M5.1 授权。
- must-read：`reports/m5-live-blind-restricted/20260725t122808/aggregate.json`、`scripts/run-m5-live-restricted.mjs`、Figma REST rate limit policy。
- owns：live run reports、live validation candidate。
- must-not-touch：OpenAI、`/v1/me`、Variables 受限路径、未授权文件。
- actions：运行三例 restricted live，输出 aggregate 和逐 case summary。
- expected outputs：diff 改善或完整 attribution；无 unmapped。
- verify：检查 reports JSON、接口调用边界、redaction；`apiBoundary.openai=false`、`apiBoundary.figmaMe=false`、`apiBoundary.variables=false`。
- done conditions：AC11/AC12 有明确证据。
- stop/escalate conditions：429 连续失败、token 权限不足、Figma 文件不可访问。
- handoff：live validation candidate 或 blocker 记录。

## 风险与回滚

- 风险：coverage schema 一次扩展过大，导致 report 和 runner 不稳定。
  - 关联步骤：步骤 1、步骤 7。
  - 影响：M5 runner 输出无法 parse。
  - 缓解 / 回滚：保持 `schemaVersion: "1"`，只 additive 增加 `coverageVersion` 和 `coverage`；旧 M5 fixture 必须继续通过；失败时回退到只生成 coverage report draft，不改 runner 输出。
- 风险：inspect-time asset 数量增加触发 Figma 429。
  - 关联步骤：步骤 2、步骤 3、步骤 9。
  - 影响：live blind 不稳定。
  - 缓解 / 回滚：每页 80、每请求 100、priority 排序、已有 Retry-After/bounded retry；失败资产标记 `unsupported_missing_asset` 而不是静默丢弃。
- 风险：受限 live 声称禁用 Variables，但代码仍走默认 inspect。
  - 关联步骤：GATE-RESTRICTED-LIVE-INTERFACE、步骤 3、步骤 9。
  - 影响：AC11 无法证明。
  - 缓解 / 回滚：新增内部 `variablesMode`、fake client spy test、live `apiBoundary` report；默认产品路径不改。
- 风险：overlay 提升视觉保真但遮挡 DOM 控件。
  - 关联步骤：步骤 5。
  - 影响：功能和键盘测试失败。
  - 缓解 / 回滚：默认 `pointerEvents: none`，DOM 控件置于可交互层，e2e 覆盖 fill/click/focus。
- 风险：长页面 full-page capture 增加截图成本或超过像素上限。
  - 关联步骤：步骤 6。
  - 影响：integration/live 变慢或失败。
  - 缓解 / 回滚：只对 expected 高于 viewport 的页面启用；超过 `VALIDATION_BASELINE.maxComparePixels` 时明确 unsupported/cropped，不作为通过证据。
- 风险：为了降低 diff 倾向整页截图化。
  - 关联步骤：步骤 4、步骤 5、步骤 7。
  - 影响：违背真实 DOM 目标。
  - 缓解 / 回滚：ProjectStore root fallback guard 保持，report 标记 asset 占比和 structuredCoverage，控件/text 优先 DOM。
- 风险：M5.1 与 M6/M7 边界混淆。
  - 关联步骤：全部。
  - 影响：计划和验收扩大到行为 Flow。
  - 缓解 / 回滚：report 保持 `scope: static_generation_only`、`behaviorFlowVerified: false`；行为类缺口进入后续 M6/M7，不作为 M5.1 fail。

## 验收标准覆盖检查

- AC1 → 步骤 1、步骤 4、T01、T04。
- AC2 → 步骤 1、步骤 2、步骤 3、步骤 5、T01、T02、T03、T05。
- AC3 → 步骤 2、步骤 3、T02、T03。
- AC4 → Inspect-to-static 诊断契约、步骤 2、步骤 4、T02、T04。
- AC5 → 步骤 4、步骤 5、T04、T05。
- AC6 → 步骤 5、T05。
- AC7 → 步骤 6、T06。
- AC8 → GATE-REPORT-SCHEMA、步骤 1、步骤 6、步骤 7、T01、T06、T07。
- AC9 → 步骤 4、步骤 5、T04、T05。
- AC10 → 步骤 5、步骤 8、T05、T07。
- AC11 → GATE-RESTRICTED-LIVE-INTERFACE、步骤 3、步骤 9、T03、T08。
- AC12 → 步骤 6、步骤 7、步骤 9、T06、T07、T08。

## 待确认 / 残留假设

- 【假设】M5.1 可以不新增模型可见工具。（验证方法：实施时只改内部模块和 runner，不改 `src/tools/contracts.ts` 的工具列表。）
- 【假设】现有 UISpec `image`、`pixel_overlay`、button icon asset 足够承载 v1 视觉保真。（验证方法：T05 若遇到表达缺口，停止进入 GATE-UISPEC-SCHEMA。）
- 【假设】三例 live blind baseline 仍可作为 M5.1 回归输入。（验证方法：GATE-LIVE-M5.1 前确认文件访问权限和 token scope。）
- 【假设】`<5%` 是推荐目标，不是 M5.1 本地硬门；M5.1 硬门先是 no silent unmapped、height diagnostic、coverage matrix 和量化改善/完整归因。（验证方法：T07/T08 validation 明确区分本地硬门和 live 目标。）

## 下一步

- 本计划 candidate 通过 review 后，需要用户明确 promote，之后 coding agent 才应按正式计划实施。
- promote 后先执行 GATE-00、GATE-REPORT-SCHEMA、T01，不要先调视觉阈值或强跑 live blind。
- 完成本地 M5.1 后，另行请求 `GATE-LIVE-M5.1` 授权，再跑受限 live blind 并创建 validation candidate。
