---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-unsupported-features-backlog",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent unsupportedFeatures 处理 Backlog",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent unsupportedFeatures 处理 Backlog

## 背景和来源

来源：`login-ui-concept` 手工测试，以及对当前代码契约的只读检查。

`login-ui-concept` 暴露出一个关键问题：当 agent 以视觉 diff 通过为最高目标时，可能把整个 Figma 页面保存成单个截图 image，从而获得 `0 diff`，但页面没有真实 input、button、text，也无法证明 Figma 到真实 UI 的可行性。

该问题不是 Figma REST API 只能返回图片。该测试中 inspect 已拿到页面结构、节点和局部资源。第一次失败路径来自生成策略：当前受控 prompt 允许在复杂视觉无法快速重建且没有交互声明时使用全宽截图兜底。

后续 backlog 的目标是：禁止整页截图伪通过，允许局部图片兜底，把 unsupportedFeatures 从泛化抱怨变成可分类、可验证、可排期的工程队列。

## 当前代码事实

- `src/extension.ts` 当前 prompt 仍允许 `figma/screenshots/...` 全宽顶部对齐截图兜底。
- `src/ui-spec/schema.ts` 的普通 `image` 只有 `assetRef`、`alt`、`fit`，没有 `frame`、`width`、`height`。
- `src/ui-spec/schema.ts` 已有 `pixel_overlay` schema，但 `src/preview/catalog.ts` 和 `src/preview/json-render-adapter.ts` 尚未把它渲染出来。
- `save_ui_spec` 输出目前只有 `validation.warningCount`，`render_and_compare` 输出也没有标准化 unsupportedFeatures 字段。
- 因此 P0 必须先做可实现的最小阻断和 additive 契约扩展，再做面积阈值、overlay 交互遮挡等增强。

## 原则

- 结构化优先：登录、注册、表单、导航等 UI 的 input、button、text 必须是真节点。
- 局部图片允许：插画、图标、头像、产品图、复杂装饰可以作为 image 或 overlay。
- 整页截图不允许作为交付通过条件：视觉 `0 diff` 不能覆盖结构化缺失。
- unsupportedFeatures 只记录真实能力缺口，不记录缺少业务说明、未调准像素或三轮内未完成的普通实现差距。
- 每个 unsupportedFeatures 条目必须带证据来源：inspect warning、Schema 限制、renderer 限制或 validation 产物。
- 验收分两条线：结构化可用性验收和视觉相似度验收分别判断。
- 公共工具契约变更必须 additive 优先，先不破坏现有调用方。

## P0：阻断整页截图伪通过

### P0-1 第一阶段：阻断 root 单截图交付

目标：先用当前 schema 能可靠实现的规则，禁止最危险的整页截图伪通过。

第一阶段检测规则：

- UISpec root 可达节点中，结构化节点不足，例如真实 `input`、`button`、`text` 数量低于最小阈值。
- root 或 root 的直接主体子节点是单个普通 `image`。
- 该 image 的 `assetRef` 指向 `figma/screenshots/...`。
- 满足以上条件时，保存或验证必须失败，错误码建议为 `full_page_screenshot_fallback_rejected`。

不在第一阶段做的事：

- 不按 image 面积比例判断，因为普通 `image` 当前没有 frame/width/height。
- 不做 overlay 与交互区域碰撞检测，因为当前 renderer 尚未支持 `pixel_overlay`。
- 不把所有 `figma/screenshots/...` 一刀切拒绝，避免误伤后续受控局部截图或 overlay 用法。

建议落点：

- `src/extension.ts`
- `src/tools/ui-spec-service.ts`
- `src/project-store/store.ts`
- `tests/unit/tools/ui-spec-service.test.ts`
- `tests/unit/project-store/store.test.ts`

行动：

1. 修改 agent 系统提示，移除“可以引用 figma/screenshots 作为全宽顶部对齐截图兜底”的默认许可。
2. 新增 root 单截图交付检测，先以节点结构和 assetRef 类型判断。
3. 失败时给出明确错误，说明应生成结构化节点，只允许局部图片兜底。

验收：

- `login-ui-concept` revision 1 这种 root 下只有整页截图 image 的 UISpec 不再能通过。
- 局部插画、图标、产品图仍可作为 `figma/assets/...` image 使用。
- 测试覆盖 root 单截图失败和局部 asset image 允许两个分支。

### P0-2 第二阶段：受控 screenshot fallback 分类和审计

目标：在第一阶段阻断后，把图片 fallback 区分为允许、警告和失败。

建议分类：

- `local_asset_ok`：局部插画、图标、头像、产品图。
- `decorative_overlay_ok`：装饰性背景或复杂矢量局部覆盖，不影响交互。
- `full_page_screenshot_rejected`：整页或主体区域截图，缺少结构化 UI。
- `needs_user_behavior_notes`：需要用户说明行为，不能归入 unsupportedFeatures。

面积比例增强的前置条件：

- 普通 `image` 增加受控 frame/size 字段；或
- 从 DesignBundle node bounds 反查 image 覆盖范围；或
- 仅对 `pixel_overlay` 使用其显式 width/height 计算。

建议落点：

- `src/validation/schema.ts`
- `src/validation/render-and-compare.ts`
- `src/runtime/inspect-agent-context.ts`
- `tests/integration/validation/render-and-compare.test.ts`

验收：

- validation 输出包含 screenshot fallback 分类。
- 失败时能指出具体节点、assetRef 类型和判断依据。
- 报告中不会把缺少业务行为说明误报为不支持特性。

### P0-3 unsupportedFeatures additive 契约标准化

目标：让 unsupportedFeatures 成为可执行 backlog，而不是自由文本。

重要前置：当前工具输出没有 unsupportedFeatures 承载位。因此第一版必须是 additive 契约变更，不能移除或破坏现有 `save_ui_spec`、`render_and_compare` 输出字段。

建议字段：

- `code`：稳定机器码。
- `severity`：`must_support`、`fallback_ok`、`defer`、`missing_behavior_notes`。
- `evidenceSource`：`inspect_warning`、`schema_limit`、`renderer_limit`、`validation_artifact`。
- `figmaNodeRefs`：相关 Figma 节点。
- `uiSpecNodeRefs`：相关 UISpec 节点。
- `impact`：影响视觉、交互、响应式、可访问性或行为。
- `recommendedAction`：补 schema、补 renderer、允许局部 fallback、请求用户行为说明或延期。

建议落点：

- `src/tools/contracts.ts`
- `src/ui-spec/schema.ts`
- `src/validation/schema.ts`
- `src/extension.ts`
- `tests/unit/tools/contracts.test.ts`

行动：

1. 定义 `unsupportedFeatureSchema`。
2. 在 `save_ui_spec` 或 `render_and_compare` 输出中添加 optional `unsupportedFeatures` 字段。
3. Extension prompt 要求 agent 使用结构化字段或等价报告，不允许自由发挥成不可追踪文本。
4. M3/blind/finalize 消费方先兼容字段缺失，后续再收紧。

验收：

- 现有工具调用仍兼容。
- 新输出可携带结构化 unsupportedFeatures。
- 缺少 behaviorNotes 被标为 `missing_behavior_notes`，不进入真实不支持能力缺口。
- 每条 unsupportedFeatures 都能追溯证据来源。

## P1：补齐高频 MVP 能力

### P1-1 表单结构化识别和生成约束

目标：登录、注册、搜索、设置等页面中常见表单必须生成真实控件。

范围：

- label + input。
- password/email/search 输入类型。
- primary/secondary button。
- text link 或 ghost button。

建议落点：

- `src/extension.ts`
- `src/runtime/inspect-agent-context.ts`
- `src/ui-spec/schema.ts`
- `tests/integration/extension/tool-wiring.test.ts`

验收：

- `login-ui-concept` 的 Full Name、Email、Password 是真实 input。
- Create Account、Log in、Google、GitHub 是真实 button 或可解释的交互节点。
- keyboard check 能检测到可 tab 的控件。

### P1-2 icon + text button 表达能力

目标：支持 Google/GitHub 这类带 icon 的按钮，而不是只能用纯 label 或拆散结构。

候选方案：

- 方案 A：给 button 增加 `leadingIconAssetRef` 和 `trailingIconAssetRef`。
- 方案 B：给 button 增加 `childIds`，允许 icon image + text 组合。

建议优先级：先实现方案 A，保持 schema 简单；如后续需要复杂按钮内容，再升级方案 B。

建议落点：

- `src/ui-spec/schema.ts`
- `src/preview/catalog.ts`
- `src/preview/json-render-adapter.ts`
- `tests/unit/contracts/ui-spec.test.ts`
- `tests/unit/preview/json-render-adapter.test.ts`

验收：

- 社交登录按钮可以同时保留真实 button 语义和图标资产。
- 图标缺失时降级为纯文本按钮，并产生可解释 warning。

### P1-3 基础视觉样式能力

目标：降低结构化 UI 的视觉差距，但不追求像素级 `0 diff`。

最小能力：

- background color。
- text color。
- font size、font weight、line height。
- border radius。
- border color、border width。
- box shadow。
- width、height、min/max 约束。

建议落点：

- `src/ui-spec/schema.ts`
- `src/preview/catalog.ts`
- `src/preview/json-render-adapter.ts`
- `tests/unit/contracts/ui-spec.test.ts`
- `tests/unit/preview/json-render-adapter.test.ts`

验收：

- 结构化版本的登录页视觉差距明显下降。
- 样式字段有 schema 限制，不能让 agent 注入任意 CSS。
- 未支持的 Figma 特效仍进入 unsupportedFeatures，而不是猜测实现。

### P1-4 pixel_overlay renderer 支持和边界

目标：允许复杂装饰和插画局部覆盖，但不影响真实控件。

当前状态：UISpec schema 已有 `pixel_overlay`，但 Preview Catalog 和 json-render adapter 尚未支持。因此本项第一步是补 renderer/catalog 映射，不应假设 overlay 当前可用。

建议落点：

- `src/preview/catalog.ts`
- `src/preview/json-render-adapter.ts`
- `src/ui-spec/schema.ts`
- `tests/unit/preview/json-render-adapter.test.ts`

验收：

- `pixel_overlay` 能渲染为受控图片覆盖层，并保持 childIds 可达。
- overlay 必须有显式尺寸和 alt。
- overlay 不得覆盖真实 input/button 的可交互区域；第一版如果无法自动检测，必须在 residual assumptions 中记录，并用后续验证补齐。
- overlay 面积阈值检查只在有足够尺寸信息时启用。

## P2：盲测和最终验收收紧

### P2-1 增加结构化覆盖率指标

目标：M3/blind/finalize 不只看视觉和基础覆盖，还要看是否真实结构化。

建议指标：

- `fullPageScreenshotFallback` 必须为 false。
- `interactiveNodeCount` 至少达到用例期望。
- `textNodeCount` 至少达到用例期望。
- `screenshotFallbackKind` 区分 rejected、allowed-local、none。
- `screenshotAreaRatio` 只在有 frame/bounds 信息时计算。
- `localAssetAreaRatio` 单独统计，不和 screenshot 混淆。

建议落点：

- `scripts/run-m3-blind.mjs`
- `scripts/finalize-m3.mjs`
- `tests/unit/runtime/m3-finalize.test.mjs`

验收：

- 整页截图即使视觉 diff 为 0 也不能让 blind/finalize 通过。
- 多页面、组件、图片、AutoLayout、Variables 仍保持原有 M3 统计。
- 缺少面积信息时不猜测面积，而是使用 root 单截图和结构化覆盖率指标。

### P2-2 固化 login-ui-concept 回归用例

目标：把该页面作为结构化优先策略的回归样例。

验收标准：

- 不允许整页截图。
- 左侧插画可用局部 image。
- 背景复杂装饰可用局部 overlay 或简化结构。
- 表单区域必须真实结构化。
- 视觉不要求 `0 diff`，但要记录残余 diff 和 unsupportedFeatures。

建议落点：

- `data/projects/login-ui-concept` 作为手工证据保留。
- 测试夹具另行最小化，不直接依赖 live Figma 或用户项目数据。
- `scripts/run-m3-blind.mjs` 增加结构化结果汇总。

验收：

- 回归测试能复现“整页截图失败、结构化版本可继续迭代”的判断。
- 不需要真实 Figma API 即可跑最小本地测试。

## 执行顺序

1. P0-1：先阻断 root 单截图伪通过，使用当前 schema 可实现的最小规则。
2. P0-3：增加 additive unsupportedFeatures 契约承载位，保证后续报告可结构化。
3. P0-2：把 fallback 分类接入 validation/report，面积判断只在有 frame/bounds 时启用。
4. 用 `login-ui-concept` 重新跑一次手工流，收集真实 unsupportedFeatures。
5. P1：按出现频率和影响补表单、icon button、基础样式、pixel_overlay renderer。
6. P2：收紧 blind/finalize，让最终验收无法被整页截图绕过。

## 独立 agent 任务卡

### Task A：root 单截图兜底阻断

目标：禁止 root 单截图作为成功交付。

必须阅读：

- `src/extension.ts`
- `src/tools/ui-spec-service.ts`
- `src/project-store/store.ts`
- `src/ui-spec/schema.ts`
- `tests/unit/tools/ui-spec-service.test.ts`
- `tests/unit/project-store/store.test.ts`

拥有范围：

- 保存前后校验。
- prompt 约束文本。
- root 单截图失败测试。

禁止触碰：

- Figma REST 认证、限流和外部调用逻辑。
- package.json 和 package-lock.json。
- Git commit、push、deploy。
- UISpec 公共 schema，除非先和 Task B 对齐。

验证：

- `npm run test:unit -- tests/unit/tools tests/unit/project-store`
- `npm run typecheck`

停止条件：

- 如果必须依赖 image frame/area 才能判断，停止并回到 P0-2 设计，不在 Task A 中扩大 schema。

### Task B：unsupportedFeatures additive 契约

目标：把 unsupportedFeatures 从文本约定变成结构化契约，并保持现有输出兼容。

必须阅读：

- `src/tools/contracts.ts`
- `src/ui-spec/schema.ts`
- `src/validation/schema.ts`
- `src/extension.ts`
- `tests/unit/tools/contracts.test.ts`

拥有范围：

- optional unsupportedFeatures 字段定义。
- evidenceSource/severity/code/impact/recommendedAction 的 schema。
- contract tests。

禁止触碰：

- renderer 大规模样式实现。
- live Figma/OpenAI 探针。
- M3 freeze 文件，除非另有授权。

验证：

- `npm run test:unit -- tests/unit/tools tests/unit/contracts`
- `npm run typecheck`

停止条件：

- 如果现有工具输出无法兼容 optional 字段，先产出兼容设计，不直接破坏工具契约。

### Task C：表单和 icon button MVP 能力

目标：让登录/注册页关键交互区域结构化。

必须阅读：

- `src/ui-spec/schema.ts`
- `src/preview/catalog.ts`
- `src/preview/json-render-adapter.ts`
- `src/runtime/inspect-agent-context.ts`
- `tests/unit/preview/json-render-adapter.test.ts`

拥有范围：

- input/button/text 的结构化表达。
- button icon 最小 schema。
- renderer 映射和本地测试。

禁止触碰：

- 整页截图策略。
- Figma REST 客户端。
- 外部服务调用。

验证：

- `npm run test:unit -- tests/unit/preview tests/unit/contracts`
- `npm run typecheck`

停止条件：

- 如果需要支持任意 CSS 或复杂嵌套按钮，先回到设计/计划评审，不在 MVP 中扩大范围。

### Task D：M3/blind/finalize 结构化验收

目标：让最终验收识别整页截图绕过。

必须阅读：

- `scripts/run-m3-blind.mjs`
- `scripts/finalize-m3.mjs`
- `tests/unit/runtime/m3-finalize.test.mjs`
- `src/validation/schema.ts`

拥有范围：

- 结构化覆盖率指标。
- fullPageScreenshotFallback 指标。
- finalize 判定和测试。

禁止触碰：

- M3 阈值冻结结果，除非用户确认重新 freeze。
- live blind 外部调用。

验证：

- `npm run test:unit -- tests/unit/runtime`
- `npm run typecheck`

停止条件：

- 若指标需要新增 validation 输出契约，先与 Task B 对齐。

## 风险和回滚

- 风险：过早禁止截图可能让复杂视觉页面短期全部失败。缓解：第一阶段只阻断 root 单截图；局部 asset image 仍允许。
- 风险：unsupportedFeatures 契约扩大可能影响已有测试。缓解：先做 additive optional 字段，后续再收紧必填。
- 风险：样式能力扩展过快导致任意 CSS 注入。缓解：只允许枚举和数值白名单，不接受自由 CSS 字符串。
- 风险：pixel_overlay schema 存在但 renderer 未支持，agent 可能误用。缓解：P1-4 明确先补 renderer/catalog，再允许作为验收路径。
- 回滚：P0 可通过恢复 prompt 和关闭 root 单截图校验回滚；P1/P2 应分支独立提交，避免和 schema 变更混在一起。

## 后续检查点

- P0-1 完成后，重新运行 `login-ui-concept` 手工流，确认 root 单截图失败、结构化版本可继续迭代。
- P0-3 完成后，确认工具输出仍兼容旧调用方，并能携带结构化 unsupportedFeatures。
- P1 完成后，比较结构化版本的视觉 residual diff 和 keyboard check。
- P2 完成后，重新执行本地 M3/finalize，不调用 live Figma/OpenAI，确认新增指标不会误伤合法局部图片。
