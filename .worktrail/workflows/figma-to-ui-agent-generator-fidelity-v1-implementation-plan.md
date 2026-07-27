---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-generator-fidelity-v1-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Generator Fidelity v1 实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Generator Fidelity v1 实施计划

## 1. 来源与目标

- 设计来源：`architecture/figma-to-ui-agent-generator-fidelity-v1-design.md`。
- 上游架构来源：`architecture/figma-coverage-engine-design.md`。
- 上游实施来源：`workflows/figma-to-ui-agent-m5-1-coverage-engine-implementation-plan.md`。
- 上游验证来源：`reports/community-corpus/20260726-m5-coverage-v21-local-summary.json` 与 `reports/community-corpus/20260726-m5-visual-v21-local-summary.json`。

当前事实：Coverage Engine v2.1 已显著改善抽取与 coverage，但 Community corpus 视觉门禁只有 `1/6` 通过 `<5%`。Generator Fidelity v1 的目标是修生成端保真，把 6 样本 `<5%` 通过数提升到至少 `4/6`，同时保留真实 DOM 交互、不使用整页 screenshot fallback。

## 2. 推广顺序

本 workflow 依赖同名 architecture candidate。推荐 lifecycle 顺序：

1. 同批 promote architecture candidate `architecture/figma-to-ui-agent-generator-fidelity-v1-design.md`。
2. 同批或随后 promote 本 workflow candidate。
3. 若只允许单个 candidate 先 promote，architecture 必须先于 workflow。

旧版未修订候选不应与修订版一起 promote；修订版通过 review 后，旧版应单独 discard。

## 3. 决策锁

- 继续以 `UISpec` 作为唯一中间产物。
- 继续使用双层模型：结构化交互层 + 视觉保真层。
- 禁止整页 `backgroundSnapshot`、root screenshot、full artboard screenshot fallback。
- 禁止把 input、button、link、text 替换为图片以降低 diff。
- static generation、preview render、render compare 不调用 Figma/OpenAI。
- overlay 默认 `pointer-events: none`，不得遮挡交互控件。
- 所有改动必须是通用能力，不允许对单个 fileKey、nodeId、文案或样本写死。
- 默认不扩大模型可见 `render_and_compare` region enum；如需扩大，必须先通过 `GATE-TOOL-CONTRACT`。
- 不新增或升级依赖，除非单独触发并通过 `GATE-DEPENDENCY`。
- 不执行 commit/push/promote/discard，除非用户单独明确授权。

## 4. 固定 Corpus 输入

Generator Fidelity v1 的本地回归 corpus 固定为：

- dataRoot：`data/community-corpus-v21`
- visual baseline：`reports/community-corpus/20260726-m5-visual-v21-local-summary.json`
- coverage guard：`reports/community-corpus/20260726-m5-coverage-v21-local-summary.json`
- projectIds：
  - `community-v21-login-001`
  - `community-v21-mobile-001`
  - `community-v21-dashboard-001`
  - `community-v21-ecommerce-001`
  - `community-v21-landing-001`
  - `community-v21-design-system-001`

除非另有明确变更记录，T06/T07 不得回退到旧 `data` root 或旧 community projectId。

## 5. 验收标准

### 5.1 功能验收

- 6 个 Community 样本均可从本地 `DesignBundle` 生成 `UISpec`、启动 preview、执行 render-and-compare。
- 至少 4/6 样本 `<5%` pixel diff。
- 失败样本必须输出细分 region diagnosis 和 suspected causes。
- LoginUIConcept 保留真实 input/button/social buttons/footer DOM。
- keyboard/focus 基础验证通过，console 无错误。
- coverage 不倒退：无静默 unmapped，`fullPageScreenshotFallback` 仍为 false。

### 5.2 测试与报告验收

- `npm run typecheck` 通过。
- 相关 unit/integration/e2e 通过。
- 6 样本 visual regression summary 写入 `reports/community-corpus/`。
- 严格 secret scan 不命中 Figma/OpenAI token、signed image URL、`fuid` 或原始 PAT。
- Worktrail validation candidate 记录最终结果，但不自动 promote。

## 6. Gate

### GATE-00：基线冻结

- goal：冻结 Generator Fidelity v1 开工基线，防止把 coverage 改善误当成 visual fidelity 完成。
- prerequisites：v2.1 coverage summary 和 visual summary 可读。
- actions：
  1. 用 `jq` 读取 `reports/community-corpus/20260726-m5-visual-v21-local-summary.json`，确认 `aggregate.passed5PctCount == 1`。
  2. 从 visual summary 读取 6 个 projectId，并逐项检查 `data/community-corpus-v21/projects/<projectId>/figma/current.json` 存在。
  3. 记录当前 diff：landing 4.22%、ecommerce 8.03%、dashboard 11.78%、LoginUIConcept 12.10%、design-system 37.58%、mobile profile 51.97%。
- verify：上述 jq/test 命令 exit code 为 0。
- done：T01 可以开始。
- stop：summary 缺失、样本集合变化未被明确记录、DesignBundle 缺失。

### GATE-TOOL-CONTRACT

- goal：控制模型可见 `render_and_compare` 输出契约变化。
- default：不扩大 `src/tools/contracts.ts` 的 `regionDiffSchema.id` enum；细分区域诊断先作为 M5/Generator Fidelity report-level `RegionDiagnosis` 输出，并映射到现有四类 bucket。
- owns：`src/tools/contracts.ts`、`src/validation/render-and-compare.ts`、`tests/integration/validation/render-and-compare.test.ts`，以及必要的 contract/schema 测试。
- trigger：只有实现者确认细分区域必须直接进入 `RenderAndCompareOutput.regionDiffs[].id` 时才触发。
- verify：contract schema parse 测试覆盖旧四类和新增类；旧工具消费者测试通过。
- stop：需要破坏性工具契约变更、模型可见 tool contract 变更未获确认。

### GATE-UISPEC-SCHEMA

- goal：控制公共 UISpec schema 变更。
- rule：只有现有 `UISpec` 无法表达 canvas mapping、typography diagnostics 或 layering metadata 时，才提出 additive schema change。
- verify：旧 UISpec fixture 继续 parse；新字段有 renderer/store 测试。
- stop：需要破坏性 schema migration 或模型可见 tool contract 变更。

### GATE-DEPENDENCY

- goal：隔离依赖风险。
- rule：默认不改 `package.json` / lockfile；若必须新增图像/font/DOM 处理依赖，需要单独说明必要性、替代方案和验证计划。
- stop：无授权的依赖变更。

### GATE-LIVE

- goal：区分本地 cached corpus 回归与外部 live Figma 回归。
- rule：v1 首先只跑本地 cached DesignBundle；外部 Figma live rerun 需要用户单独授权。
- stop：无授权访问 Figma/OpenAI。

### GATE-GIT

- goal：隔离提交与远端副作用。
- rule：不自动 commit/push；若用户要求提交，必须 staged diff allowlist。
- stop：dirty worktree 中存在未归属变更且影响提交边界。

## 7. 并行规划

[parallelism:
- independent lanes: T01 canvas mapping 诊断、T02 typography mapper、T04 report-level region diagnosis 可先并行调研
- sequential blockers: GATE-00 先于 T01；GATE-TOOL-CONTRACT 决定 T04 是否触碰 `src/tools/contracts.ts`；T01 先于 T03/T05；T04 先于 T07 final summary；T06 六样本 harness 先于 T07 visual gate
- shared write surfaces: `src/preview/*`、`src/validation/render-and-compare.ts`、`src/tools/contracts.ts`、`src/static-generation/*`、`src/ui-spec/schema.ts` 需要单 owner 顺序落地
- delegation: 0；当前仓库已有较多 dirty/untracked 文件，Generator Fidelity v1 会触碰 renderer/schema/report 多个共享面，不适合多 agent 同时写
]

## 8. 实施步骤

### T01：Viewport / Artboard Mapping 基线与诊断

- owns：`src/validation/render-and-compare.ts`、`src/preview/server.ts`、`preview/src/*`、`tests/integration/validation/render-and-compare.test.ts`。
- goal：让每次 compare 显式记录 artboard、viewport、scale、origin、renderMode、crop/scroll 策略。
- actions：
  1. 为每页计算 `CanvasMapping`：artboard size、viewport size、scale、origin、renderMode。
  2. mobile artboard 在 desktop viewport 下禁止隐式拉伸；使用 `native_artboard` 或明确居中 fit 策略。
  3. 长页面使用 full-page/scroll canvas；若裁切必须记录 `viewport_crop`。
  4. 将 mapping 写入 render output 和 M5 visual summary；若需要 UISpec 字段，先走 `GATE-UISPEC-SCHEMA`。
- verify：
  - `npx vitest run tests/integration/validation/render-and-compare.test.ts`
  - 6 样本 summary 均包含 canvas mapping。
- acceptance：mobile profile 的主要 diff 不再由隐式 viewport 缩放或裁切造成。

### T02：Typography Fidelity Mapper

- owns：`src/static-generation/style-mapper.ts`、`src/static-generation/node-mapper.ts`、`src/preview/json-render-adapter.ts`、`preview/src/components/typography.tsx`、`preview/src/components/form-controls.tsx`、`tests/unit/static-generation/style-mapper.test.ts`、`tests/unit/static-generation/node-mapper.test.ts`。
- goal：减少 text box、line-height、font-weight、nowrap/换行造成的 diff。
- actions：
  1. 新增或扩展 `tests/unit/static-generation/style-mapper.test.ts`；该文件当前不存在，T02 必须创建它或在同等测试文件中覆盖 `mapTextStyle`。
  2. 建立 `TextMetricsMapper` 或扩展现有 `style-mapper.ts`，从 Figma style 映射 fontFamily、fontSize、fontWeight、lineHeightPx/ratio、letterSpacingPx、textAlign、width、whiteSpace。
  3. footer、button label、placeholder、label 默认保持单行，除非 Figma text box 明确多行。
  4. 对缺字体、缺 lineHeight、fallback whiteSpace 写 diagnostics。
  5. 调整 renderer CSS，避免浏览器默认 line-height 和 input placeholder 样式扩大 diff。
- verify：
  - `npx vitest run tests/unit/static-generation/style-mapper.test.ts tests/unit/static-generation/node-mapper.test.ts`
  - LoginUIConcept footer 不再异常换行。
- acceptance：LoginUIConcept typography 区域 diff 下降，且真实 DOM 保留。

### T03：Asset Layering / zIndex / Clip / Pointer Safety

- owns：`src/static-generation/visual-layer-planner.ts`、`src/static-generation/node-mapper.ts`、`src/preview/json-render-adapter.ts`、`preview/src/components/media.tsx`、`tests/unit/static-generation/visual-layer-planner.test.ts`、`tests/integration/static-generation/m5-static.test.ts`。
- goal：让已导出的 vector/image/decorative asset 按 Figma bounds、zIndex、opacity、clip 和 pointer behavior 稳定渲染。
- actions：
  1. 将 visual layer 的 page-relative bounds、zIndex、opacity、asset intrinsic size 映射到 renderer。
  2. button 内 icon 使用控件内布局，不作为遮挡 button 的绝对 overlay。
  3. decorativeLayer 默认 `pointer-events: none`。
  4. clip parent 可表达时绑定；不可表达时输出 `clip_unsupported` 区域诊断。
  5. 添加 overlay-control overlap 检测。
- verify：
  - `npx vitest run tests/unit/static-generation/visual-layer-planner.test.ts tests/integration/static-generation/m5-static.test.ts`
  - Google/GitHub 图标尺寸不再明显偏小。
- acceptance：ecommerce/dashboard icon/image 错位明显减少；交互控件未被 overlay 遮挡。

### T04：Region Diff Diagnosis v1

- owns：`src/validation/render-and-compare.ts`、`src/tools/contracts.ts`、`src/static-generation/report.ts`、`src/static-generation/report-markdown.ts`、`tests/unit/static-generation/report-markdown.test.ts`、`tests/integration/validation/render-and-compare.test.ts`。
- goal：把整页 diff 拆成可排期区域和 suspected causes，同时不无授权扩大模型可见工具契约。
- actions：
  1. 默认保留 `RenderAndCompareOutput.regionDiffs[].id` 四类 contract bucket：`visual_assets`、`text_regions`、`form_controls`、`button_icon_controls`。
  2. 在 M5/Generator Fidelity report 中新增细分 `RegionDiagnosis`：`left_visual`、`form_fields`、`cta`、`social_buttons`、`footer`、`modal_shell`、`dense_content`、`mobile_canvas`。
  3. 每个细分区域输出 bounds、diffPixelRatio、diffPixels、sourceNodeIds、uiSpecNodeIds、suspectedCauses，并映射到现有 contract bucket。
  4. markdown summary 展示每页 top failing regions。
  5. 如果必须扩大 `regionDiffSchema.id` enum，先执行 `GATE-TOOL-CONTRACT`，并把 contract schema 测试纳入 verify。
- verify：
  - 默认路径：`npx vitest run tests/unit/static-generation/report-markdown.test.ts tests/integration/validation/render-and-compare.test.ts`
  - 若触发 tool contract：再验证 `src/tools/contracts.ts` schema 对旧四类兼容且新增 enum parse 通过。
  - 6 样本 visual summary 包含细分 region table。
- acceptance：失败样本不再只有整页 diff，能直接定位下一步修 typography、asset、canvas 或 unsupported；模型可见 contract 无授权不变。

### T05：Preview Renderer Fidelity Pass

- owns：`preview/src/components/layout.tsx`、`preview/src/components/controlled-style.ts`、`preview/src/components/typography.tsx`、`preview/src/components/form-controls.tsx`、`src/preview/json-render-adapter.ts`、`tests/e2e/preview.spec.ts`、`tests/e2e/catalog.spec.ts`。
- goal：把 T01-T03 的 mapping/style/layering 落到实际 preview DOM/CSS。
- actions：
  1. 固定 canvas root 尺寸，避免内容根据 viewport 自由 reflow。
  2. 为 page root、visual layers、structured DOM 建立稳定 stacking context。
  3. 修 input/button/image/text 的默认 CSS reset，减少浏览器 UA 样式差异。
  4. 添加 Playwright 检查：页面非空、console clean、input 可聚焦编辑、button 可点击、overlay 不抢焦点。
- verify：
  - `npx playwright test tests/e2e/preview.spec.ts tests/e2e/catalog.spec.ts`
  - `npm run typecheck`。
- acceptance：功能验证通过，且 renderer 不再因 CSS reset/stacking 造成大范围 diff。

### T06：6 样本本地回归 Harness

- owns：`scripts/run-m5-static.mjs` 或新增 `scripts/run-generator-fidelity-corpus.mjs`、`reports/community-corpus/*`。
- goal：把 cached Community corpus 的 static + compare + aggregate summary 做成一条可重复命令。
- actions：
  1. 固定使用 `dataRoot=data/community-corpus-v21`。
  2. 固定 projectId 列表为 GATE-00 的六个 `community-v21-*` project。
  3. 对 6 个 projectId 执行 static generation、保存 UISpec、run compare。
  4. 输出 aggregate：passed5PctCount、averageDiff、min/max、每样本 diff、top regions、canvas mapping。
  5. 保留 API boundary：本地回归不访问 Figma/OpenAI。
- verify：
  - 本地命令跑完 6/6，exit code 0。
  - summary 写入 `reports/community-corpus/`。
  - summary 中 projectId 集合与 GATE-00 完全一致。
- acceptance：后续每个 fidelity 修复都能用同一 harness 回归。

### T07：Visual Gate 修复循环

- owns：T01-T06 涉及模块。
- goal：以通用能力为单位迭代，直到至少 4/6 样本 `<5%` 或剩余失败有完整归因。
- actions：
  1. 跑 T06 harness 建立 current visual baseline。
  2. 按细分 region diagnosis 排序选择最高收益通用问题。
  3. 每次只修一类通用问题：canvas、typography、asset layering、renderer reset、clip/mask attribution。
  4. 每轮记录 delta，不接受让 coverage 或功能倒退的修复。
- verify：
  - 每轮 targeted unit/integration/e2e + T06 harness。
  - 严格 secret scan。
- acceptance：`passed5PctCount >= 4`；若未达到，必须证明剩余差距属于明确 unsupported 或需单独 schema/字体/asset 授权。

### T08：Worktrail Validation 与收口

- owns：Worktrail validation candidate、final report。
- goal：把 Generator Fidelity v1 结果固化为可审查证据。
- actions：
  1. 生成最终 visual summary 与 coverage guard summary。
  2. 创建 `validation/figma-to-ui-agent-generator-fidelity-v1-result.md` pending candidate。
  3. 运行 `worktrail review plan --format json`。
  4. 不自动 promote，等待用户确认。
- verify：
  - validation candidate 出现在 review plan。
  - 报告不含 secret/raw signed URL/PAT。
- acceptance：用户可以基于候选决定 promote/discard/merge。

## 9. 推荐执行顺序

1. GATE-00：冻结 corpus 与 baseline。
2. T01：先解决 canvas mapping，否则 mobile/design-system diff 解释不可靠。
3. T04：尽早补 report-level region diagnosis，让后续修复可排期；默认不改工具 enum。
4. T02：修 typography，优先影响 LoginUIConcept、ecommerce、dashboard。
5. T03：修 asset layering，优先影响 icon、decorative layer、modal。
6. T05：统一 preview renderer CSS 与 stacking。
7. T06：固化 6 样本 harness。
8. T07：循环修到 `4/6 <5%`。
9. T08：写 Worktrail validation candidate。

## 10. Residual Assumptions

- assumption：T04 默认不扩大 `render_and_compare` 模型可见 enum。
  validation_method：执行 T04 前检查 `src/tools/contracts.ts`；如果实现需要扩 enum，先完成 `GATE-TOOL-CONTRACT` 并补 schema 测试。
- assumption：`tests/unit/static-generation/style-mapper.test.ts` 当前不存在，T02 创建该测试文件属于计划范围。
  validation_method：T02 完成时运行 `test -f tests/unit/static-generation/style-mapper.test.ts` 和对应 vitest 命令。
- assumption：6 样本 cached corpus projectId 与 visual summary 一致。
  validation_method：GATE-00 从 summary 中读取 projectId，并检查每个 project 的 `figma/current.json`。

## 11. 下一步 Coding Agent 指令

Coding agent 接手时应先执行：

1. `worktrail context --semantic=auto "Generator Fidelity v1"`。
2. 读取本计划、Generator Fidelity v1 设计文档、Coverage Engine 设计文档。
3. 运行 GATE-00，只读确认当前 visual summary：`passed5PctCount = 1`，并确认 6 个 `data/community-corpus-v21` DesignBundle 存在。
4. 从 T01 开始实施，不调用外部 Figma/OpenAI，不改依赖，不执行 Git。
5. 每完成一个 T，运行对应 targeted validation，并更新 Worktrail state。
