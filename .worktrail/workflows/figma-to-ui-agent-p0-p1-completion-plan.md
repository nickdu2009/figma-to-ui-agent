---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-p0-p1-completion-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent P0/P1 补齐计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent P0/P1 补齐计划

## 目标

补齐 UISpec 的 P0/P1 生产可用能力：在已具备 root 单截图阻断、基础 `unsupportedFeatures` 契约、基础样式、button icon、`pixel_overlay` renderer 和 M3 结构化证据的基础上，补齐剩余高频组件、fallback 审计分类、结构化证据统计扩展和完整测试矩阵。

## 当前事实基线

当前代码已经具备以下能力，计划不得重复实现：

- `src/project-store/store.ts` 已阻断 root 单截图交付，错误码包含 `full_page_screenshot_fallback_rejected`。
- `src/tools/contracts.ts` 已有 optional `unsupportedFeatures` 契约，字段包括 `code`、`severity`、`evidenceSource`、`figmaNodeRefs`、`uiSpecNodeRefs`、`impact`、`recommendedAction`。
- `src/tools/unsupported-features.ts` 已能发现 `figma/screenshots/...` 的 image / pixel_overlay fallback，但目前只有单一 `screenshot_fallback_used` 分类。
- `src/ui-spec/schema.ts` 已支持 `stack`、`grid`、`section`、`dialog`、`text`、`image`、`pixel_overlay`、`button`、`input`、`checkbox`、`divider`。
- `src/preview/catalog.ts` 和 `src/preview/json-render-adapter.ts` 已支持上述节点。
- Preview renderer 已拆分到 `preview/src/components/`，`preview/src/catalog-registry.tsx` 只负责注册。
- `scripts/run-m3-blind.mjs` 已有 `fullPageScreenshotFallback`、`interactiveNodeCount`、`textNodeCount`、`screenshotFallbackKind`、`screenshotFallbackNodeCount`。
- `scripts/finalize-m3.mjs` 已要求结构化证据存在，并检查 `structuredText` 和 `noFullPageScreenshotFallback`。

## 执行边界

- 不安装或升级依赖。
- 不调用 Figma、OpenAI 或其他外部服务。
- 不执行 Git commit、push、deploy 或破坏性清理。
- 不直接编辑正式 `.worktrail` 知识文件。
- schema、catalog、adapter、renderer 是共享契约，必须单 owner 串行修改。
- 充分测试是硬门槛；不能只补 schema 而不补 adapter、renderer、结构化证据和验证测试。

## 并行性

```text
[parallelism:
- independent lanes: 测试夹具设计、P0 fallback 分类规则梳理、P1 组件字段草案可先并行阅读
- sequential blockers: UISpec schema 先于 Preview Catalog；Catalog 先于 adapter；adapter 先于 renderer 行为测试；新增交互组件先于 M3 structural evidence 扩展
- shared write surfaces: src/ui-spec/schema.ts、src/preview/catalog.ts、src/preview/json-render-adapter.ts、scripts/run-m3-blind.mjs、scripts/finalize-m3.mjs 单 owner 串行修改
- delegation: 0；公共契约和验收统计强耦合，先单线推进更稳
]
```

## 验收标准

- AC1：整页截图不能作为成功交付；局部图片和 overlay 可以受控使用并可审计。
- AC2：`unsupportedFeatures` 不再只有单一截图 fallback 文本，至少能区分局部截图 fallback、renderer/schema 缺口、缺少行为说明和被拒绝的整页截图路径。
- AC3：登录、注册、搜索、设置页的表单区域必须有真实 `input`、`button`、`text`、`link`、`checkbox`、`radio`、`switch`、`select`、`textarea` 语义。
- AC4：P1 常用 UI 能被 schema、catalog、adapter、Preview renderer 全链路支持。
- AC5：所有新增样式仍是白名单字段，不允许任意 CSS、外部脚本、外部 URL 或任意事件处理器。
- AC6：M3 structural evidence 统计包含新增交互节点，不会低估合法 P1 组件。
- AC7：本地单元、集成和 e2e 测试能证明 schema 校验、adapter 映射、renderer 可用、禁用状态、状态绑定、fallback 审计和最终验收行为正确。

## P0 剩余计划

### P0-1 fallback 审计分类收紧

落点：

- `src/tools/unsupported-features.ts`
- `src/tools/ui-spec-service.ts`
- `src/validation/render-and-compare.ts`
- `src/tools/contracts.ts`，仅当现有 enum 无法表达时做 additive 扩展
- `tests/unit/tools/contracts.test.ts`
- `tests/unit/tools/ui-spec-service.test.ts`
- `tests/integration/validation/render-and-compare.test.ts`

动作：

- 保留现有 `UnsupportedFeature` 契约字段；优先通过稳定 `code` 和 `severity` 表达分类，避免无必要扩大 `recommendedAction`。
- 建议第一版 code：
  - `screenshot_fallback_used`：局部截图或 overlay fallback 被接受但需要审计。
  - `full_page_screenshot_fallback_rejected`：整页或主体截图伪通过路径；保存阶段应直接失败，成功输出中通常不出现。
  - `missing_behavior_notes`：用户未声明行为，不能归类为工具能力缺口。
  - `renderer_limit_*` 或 `schema_limit_*`：仅用于真实 Catalog / schema / renderer 缺口。
- `recommendedAction` 第一版使用现有枚举：局部 fallback 用 `allow_local_fallback`；缺行为说明用 `request_behavior_notes`；schema/renderer 缺口用 `extend_schema` / `extend_renderer`；整页截图拒绝以错误码和 validation evidence 表达，不强塞进成功输出。
- 若发现 rejected 路径必须进入 `unsupportedFeatures`，再 additive 增加 `recommendedAction: reject_full_page_fallback`，并补 contracts 测试。

验证：

- root 单截图失败，错误包含 `full_page_screenshot_fallback_rejected`。
- 局部 `figma/assets/...` image 允许且不产生截图 fallback feature。
- 局部 `figma/screenshots/...` image / `pixel_overlay` 输出可审计 fallback。
- 缺少行为说明时标记为 `missing_behavior_notes`，不误报成 schema/renderer 缺口。

### P0-2 扩展现有结构化覆盖率指标

当前 `run-m3-blind` 和 `finalize-m3` 已经有结构化指标。本项不是从零新增，而是随 P1 组件扩展现有统计。

落点：

- `scripts/run-m3-blind.mjs`
- `scripts/finalize-m3.mjs`
- `tests/unit/runtime/m3-blind-structural-evidence.test.mjs`
- `tests/unit/runtime/m3-finalize.test.mjs`

动作：

- 将 `interactiveNodeCount` 从当前 `button`、`checkbox`、`input` 扩展为包含 `link`、`radio`、`switch`、`select`、`textarea`，以及有交互语义的 `tabs`。
- 保持 `textNodeCount` 只统计真实 `text`，不要把 placeholder、label-only props 误计为 text node，除非 schema 明确生成独立 text 节点。
- `screenshotFallbackKind` 保持 `rejected`、`allowed-local`、`none` 的最小稳定集合；更细粒度 fallback 类型放在 `unsupportedFeatures` 或 future evidence 字段，不破坏 M3 汇总。

验证：

- 新增交互节点会增加 `interactiveNodeCount`。
- `fullPageScreenshotFallback=true` 时 finalize 失败。
- 缺少结构化字段时 finalize 失败。
- 合法局部图片不误伤。

## P1 组件补齐计划

### 第一批：表单基础组件

新增 UISpec node 和最小字段：

#### `link`

字段：

- `id`
- `kind: "link"`
- `label: string`
- `actionId?: id`
- `disabled?: boolean`
- `designValueRefs`
- `style?`

约束：

- 不接受外部 URL。
- `actionId` 指向 `navigate` 或其他声明式 action；disabled 时 adapter 不输出 press action。

#### `radio`

字段：

- `id`
- `kind: "radio"`
- `label: string`
- `stateKey: id`
- `value: string`
- `disabled?: boolean`
- `designValueRefs`
- `style?`

约束：

- `stateKey` 必须引用 string state。
- 同一组 radio 通过共享 `stateKey` 表达。

#### `switch`

字段：

- `id`
- `kind: "switch"`
- `label: string`
- `stateKey: id`
- `disabled?: boolean`
- `designValueRefs`
- `style?`

约束：

- `stateKey` 必须引用 boolean state。
- renderer 使用原生 checkbox role switch 或等价可访问语义。

#### `select`

字段：

- `id`
- `kind: "select"`
- `label: string`
- `stateKey: id`
- `options: Array<{ value: string, label: string }>`
- `placeholder?: string`
- `disabled?: boolean`
- `designValueRefs`
- `style?`

约束：

- `stateKey` 必须引用 string state。
- `options.value` 同一 select 内不可重复。

#### `textarea`

字段：

- `id`
- `kind: "textarea"`
- `label: string`
- `stateKey: id`
- `placeholder?: string`
- `disabled?: boolean`
- `designValueRefs`
- `style?`

约束：

- `stateKey` 必须引用 string state。

#### `form_field`

字段：

- `id`
- `kind: "form_field"`
- `label: string`
- `helpText?: string`
- `errorText?: string`
- `required?: boolean`
- `childIds: id[]`
- `designValueRefs`
- `style?`

约束：

- `form_field` 是语义容器；具体控件必须是子节点。
- 第一版不强制只包含一个控件，但测试应覆盖常规单控件场景。

落点：

- `src/ui-spec/schema.ts`
- `src/preview/catalog.ts`
- `src/preview/json-render-adapter.ts`
- `preview/src/components/form-controls.tsx`
- `preview/src/catalog-registry.tsx`，只做 import/register
- `preview/src/styles.css`
- `tests/unit/contracts/ui-spec.test.ts`
- `tests/unit/preview/json-render-adapter.test.ts`
- 新增 `tests/unit/preview/catalog.test.ts`
- `tests/e2e/preview.spec.ts` 或新增表单专用 e2e

验证：

- 每个组件有 schema 正反例。
- adapter 能映射到 Preview Catalog。
- renderer DOM 可见且交互行为正确。
- disabled 控件不能 focus、不能触发 action、不能修改状态。
- M3 structural evidence 把新增交互节点计入 `interactiveNodeCount`。

### 第二批：内容和导航组件

新增 UISpec node 和最小字段：

#### `icon`

字段：

- `id`
- `kind: "icon"`
- `assetRef: uiImagePath`
- `alt?: string`
- `decorative?: boolean`
- `designValueRefs`
- `style?`

约束：

- 只允许项目内 Figma 图片。
- `decorative=true` 时 renderer 使用空 alt 或 `aria-hidden`。

#### `spacer`

字段：

- `id`
- `kind: "spacer"`
- `width?: number`
- `height?: number`
- `designValueRefs`
- `style?`

约束：

- 至少提供 width 或 height。
- 不承载 childIds。

#### `card`

字段：

- `id`
- `kind: "card"`
- `childIds: id[]`
- `designValueRefs`
- `style?`

约束：

- 语义容器，不引入复杂变体系统。

#### `list`

字段：

- `id`
- `kind: "list"`
- `ordered?: boolean`
- `childIds: id[]`
- `designValueRefs`
- `style?`

约束：

- 子节点应优先为 `list_item`，第一版可只测试规范路径。

#### `list_item`

字段：

- `id`
- `kind: "list_item"`
- `childIds: id[]`
- `designValueRefs`
- `style?`

#### `badge`

字段：

- `id`
- `kind: "badge"`
- `label: string`
- `tone?: "neutral" | "success" | "warning" | "danger" | "info"`
- `designValueRefs`
- `style?`

#### `avatar`

字段：

- `id`
- `kind: "avatar"`
- `assetRef?: uiImagePath`
- `initials?: string`
- `alt: string`
- `designValueRefs`
- `style?`

约束：

- `assetRef` 或 `initials` 至少一个存在。

#### `tabs`

字段：

- `id`
- `kind: "tabs"`
- `stateKey: id`
- `tabs: Array<{ value: string, label: string, childIds: id[] }>`
- `designValueRefs`
- `style?`

约束：

- `stateKey` 必须引用 string state。
- `tabs.value` 不可重复。
- renderer 仅显示 selected tab 的 children。
- tabs 本身计为交互节点。

#### `nav`

字段：

- `id`
- `kind: "nav"`
- `orientation: "horizontal" | "vertical"`
- `childIds: id[]`
- `designValueRefs`
- `style?`

约束：

- 子项优先使用 `link` 或 `button` 表达动作。

落点：

- `src/ui-spec/schema.ts`
- `src/preview/catalog.ts`
- `src/preview/json-render-adapter.ts`
- `preview/src/components/media.tsx`，用于 `icon`、`avatar`
- `preview/src/components/layout.tsx` 或新增 `preview/src/components/content.tsx`，用于 `spacer`、`card`、`list`、`list_item`、`badge`
- 新增 `preview/src/components/navigation.tsx`，用于 `tabs`、`nav`、`link` 如未放入 form-controls
- `preview/src/catalog-registry.tsx`，只做 import/register
- `preview/src/styles.css`
- `tests/unit/contracts/ui-spec.test.ts`
- `tests/unit/preview/json-render-adapter.test.ts`
- `tests/unit/preview/catalog.test.ts`
- `tests/e2e/preview.spec.ts` 或新增内容/导航专用 e2e

验证：

- 每个组件都能从 UISpec 转 Preview JSON，再渲染为可访问 DOM。
- `tabs` selected 状态控制内容可见性。
- `nav`、`card`、`list` 不需要业务行为也能结构化表达。
- `icon`、`avatar` 不允许外部 URL。

### 第三批：overlay 边界校验

落点：

- `src/ui-spec/schema.ts`，仅当需要为 overlay 或 image 增加 frame/size 时修改
- `src/validation/render-and-compare.ts`
- `tests/integration/validation/render-and-compare.test.ts`

动作：

- 第一版优先使用已有 `button/input/checkbox` 的 `frame` 和 `pixel_overlay` 的 `width/height` 判断重叠。
- 随 P1 新增交互组件后，若要参与 overlay collision，必须同步为这些节点设计 `frame` 支持或明确记录无法检测。
- 无法判断时输出 residual assumption 或 fallback 审计，不默默通过。
- overlay 面积阈值只在尺寸信息充分时启用。

验证：

- overlay 覆盖 button/input 时失败或输出高严重度警告。
- 装饰区域 overlay 可通过。
- 无尺寸信息不猜测面积。

## 充分测试矩阵

### 1. Schema 契约测试

落点：`tests/unit/contracts/ui-spec.test.ts`

覆盖：

- 每个新增节点合法最小样例可通过。
- 缺必填字段失败。
- enum 越界失败。
- 非法字段会被拒绝。
- 任意 CSS、外部 URL、事件处理器会被拒绝。
- `stateKey` 类型必须匹配组件。
- `childIds` 不能悬空、不能多父节点、不能循环。
- assetRef 只能引用项目内 Figma 图片。
- `select.options`、`tabs.tabs` 的 value 不可重复。

### 2. Preview Catalog 测试

落点：新增 `tests/unit/preview/catalog.test.ts`

覆盖：

- 每个 Catalog 组件正确 props 可通过。
- 缺必填字段失败。
- enum 越界失败。
- 样式白名单生效。
- children 结构符合预期。

### 3. Preview Adapter 测试

落点：`tests/unit/preview/json-render-adapter.test.ts`

覆盖：

- 每个 UISpec node 都映射到 Preview Catalog。
- disabled、selected、checked、value、placeholder、options 能正确传递。
- action binding 只在允许交互时存在。
- 禁用 button/link 不触发 action。
- adapter 输出不包含外部 URL、任意 CSS、脚本字段。

### 4. Renderer 行为测试

落点：`tests/e2e/preview.spec.ts` 或新增专门 e2e 文件。

覆盖：

- input 和 textarea 可输入。
- checkbox、switch、radio、select 状态能改变。
- disabled 控件不能 focus、不能触发 action、不能修改状态。
- link/button 可触发声明动作。
- tabs selected 内容可见性正确。
- dialog 可打开。
- keyboard tab 顺序覆盖关键控件。
- focus-visible 样式存在。

### 5. Validation / fallback 测试

落点：

- `tests/unit/tools/ui-spec-service.test.ts`
- `tests/unit/project-store/store.test.ts`
- `tests/integration/validation/render-and-compare.test.ts`

覆盖：

- root 单截图必须失败。
- 局部 `figma/assets/...` image 允许。
- 局部 `figma/screenshots/...` image / overlay 输出 `unsupportedFeatures`。
- overlay 覆盖 button/input 时失败或警告。
- 缺少尺寸时不猜面积，输出可追踪原因。
- 视觉 diff 为 0 但结构化不足时不能通过最终验收。

### 6. M3 / finalize 测试

落点：

- `tests/unit/runtime/m3-blind-structural-evidence.test.mjs`
- `tests/unit/runtime/m3-finalize.test.mjs`

覆盖：

- `fullPageScreenshotFallback=true` 时 finalize 失败。
- 新增交互节点会计入 `interactiveNodeCount`。
- `textNodeCount` 不足时失败。
- 合法局部图片不误伤。
- `unsupportedFeatures` 中 `missing_behavior_notes` 不等同于真实能力缺口。

### 7. 本地回归夹具

至少准备三类 fixture，不依赖 live Figma：

- 登录/注册页：input、password、email、button、social icon button、link。
- 设置/表单页：checkbox、radio、switch、select、textarea、form field error。
- 内容/导航页：nav、tabs、card、list、badge、avatar、image、icon。

## 测试完成门槛

每个 P0/P1 组件或能力必须满足：

- Schema 有正反例。
- Catalog 有 props 校验测试。
- Adapter 有映射测试。
- Renderer 有至少一个 DOM 行为或渲染断言。
- M3 structural evidence 不低估新增交互节点。
- Validation 不允许整页截图绕过。
- `npm run typecheck` 通过。
- 相关 unit、integration、e2e 测试通过。

建议最终验证命令：

```bash
npm run test:unit -- tests/unit/contracts tests/unit/preview tests/unit/tools tests/unit/runtime
npm run test:integration -- tests/integration/validation tests/integration/preview
npm run test:e2e -- tests/e2e/preview.spec.ts
npm run typecheck
```

## 推荐交付阶段

1. 阶段 1：P0 fallback 审计分类 + M3 structural evidence 扩展点校准。
2. 阶段 2：P1 表单组件：`link`、`radio`、`switch`、`select`、`textarea`、`form_field`，并同步 M3 交互计数。
3. 阶段 3：P1 内容导航组件：`icon`、`spacer`、`card`、`list`、`list_item`、`badge`、`avatar`、`tabs`、`nav`，并同步 renderer 和 catalog tests。
4. 阶段 4：overlay 边界、validation 收紧、login-ui-concept 本地回归。

## 风险和缓解

- schema 一次扩太多会影响 agent 生成稳定性；缓解：分两批组件落地。
- overlay 判断依赖尺寸信息；缓解：没有尺寸时不猜，先记录审计或残余假设。
- `form_field` 和具体控件可能语义重叠；缓解：`form_field` 只做容器，控件仍由子节点表达。
- `tabs` 同时涉及状态、children 和可见性；缓解：第一版只支持 string selected state 和单层 tab panels。
- `link` 和 `button` 动作边界可能重叠；缓解：`link` 偏导航语义，button 保留命令语义，但两者都只绑定声明式 action。
- `card`、`list`、`nav` 可用布局组合表达，但一等组件能提升 agent 稳定性；缓解：先保持属性少，不做复杂变体系统。
- 充分测试会增加实现成本；缓解：每个阶段只运行最小相关测试，阶段收口时运行完整矩阵。

## 回滚边界

- P0 fallback 审计分类可通过关闭新增分类消费回滚到只报告 `screenshot_fallback_used`。
- P1 schema 扩展必须 additive；旧 UISpec 仍应可加载。
- Renderer 新组件失败时可先从 prompt 禁用对应组件，保留 schema 待修复。
- M3/finalize 收紧如误伤合法局部图片，应优先修正分类规则，不回退整页截图阻断。

## 下一步

建议对本修订版再执行一次 plan-review-loop；通过后再 promote 修订版 candidate，并 discard 旧的 P0/P1 candidate。
