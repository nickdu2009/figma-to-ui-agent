---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "architecture-figma-to-ui-agent-generator-fidelity-v1-design",
  "scope": "project",
  "type": "architecture",
  "title": "Figma-to-UI Agent Generator Fidelity v1 设计文档",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Generator Fidelity v1 设计文档

## 1. 背景

Coverage Engine v2.1 已经把 Figma 读取与覆盖归因推进到可审计阶段。Community corpus v2.1-local 的 coverage 结果为：

- 6/6 样本完成 coverage 重算；
- unsupported 为 `213/1397 = 15.25%`，相对 M5 baseline 减少 `350` 个节点；
- vectorRendered 为 `530/740 = 71.62%`，相对 M5 baseline 增加 `370` 个节点；
- imageFillRendered 为 `8/8 = 100%`；
- textRendered 为 `228/235 = 97.02%`。

但同一批样本的视觉验证仍未达到目标：

| sample | page | diff | pass <5% |
| --- | --- | ---: | --- |
| community-v21-landing-001 | home | 4.22% | yes |
| community-v21-ecommerce-001 | featured | 8.03% | no |
| community-v21-dashboard-001 | light dashboard | 11.78% | no |
| community-v21-login-001 | login version 1 | 12.10% | no |
| community-v21-design-system-001 | in modals | 37.58% | no |
| community-v21-mobile-001 | profile | 51.97% | no |

结论：当前主要问题已从“Figma 视觉层被静默丢失”转移到“已抽取出的 `UISpec` 和 asset 没有被足够准确地渲染”。Generator Fidelity v1 负责这一层：在不回退整页截图、不牺牲真实 DOM 交互的前提下，提高 DOM/CSS/asset renderer 对 Figma 画板的感知保真度。

## 2. 定位

Generator Fidelity v1 是 `DesignBundle -> UISpec -> Preview Renderer -> Render Compare` 链路中的生成端保真层。它不替代 Coverage Engine：

- Coverage Engine 回答“Figma 里有什么、哪些节点被覆盖、哪些节点缺 asset 或 unsupported”。
- Generator Fidelity 回答“已覆盖的结构和视觉资产如何被排版、层叠、缩放、裁切和渲染得更像 Figma”。

v1 的目标是把 Community corpus 的 `<5%` pixel diff 通过数从 `1/6` 提升到至少 `4/6`，同时保留真实 DOM 交互、键盘可用性、console 无错误、coverage 无静默丢失。

## 3. 设计目标

1. 渲染端可解释：每个 visible UI node、visual asset、decorative layer 的最终 CSS geometry、zIndex、clip、opacity、font metrics 都能追溯到 Figma source 或明确 fallback。
2. 真实 DOM 优先：input、button、link、text、section、stack 等结构化交互层继续由 DOM 承担，不用截图替代控件。
3. 视觉层精确叠加：`vectorAsset`、`decorativeLayer`、`imageAsset`、`iconAsset` 按 Figma page-relative 坐标、zIndex、opacity、clip/mask 语义渲染。
4. 画板映射稳定：mobile artboard、desktop artboard、长页面和 modal canvas 在实际 viewport 下使用可复现的 scale、origin、crop/scroll 策略。
5. 文字接近 Figma：字体族、字号、字重、行高、letter spacing、文本框宽度、换行策略和基线高度尽量映射 Figma。
6. 区域诊断闭环：失败样本必须能解释问题属于 canvas、typography、asset layering、interaction overlap、clip/mask unsupported 还是 renderer reset。
7. 泛化优先：所有规则必须服务于 Community corpus 中的通用 Figma 模式，禁止为单个文件、单个 node id 或固定文案写死。
8. 门禁可回归：6 样本 visual regression 是 v1 的主门禁，单个修复必须能解释对样本、区域和 diff 的影响。

## 4. 非目标

- 不追求未知 Figma 文件固定 `<1%` pixel diff。
- 不使用整页 `backgroundSnapshot`、root screenshot、全画板 screenshot fallback 伪通过。
- 不把 input/button/link/text 替换成图片。
- 不新增模型可见工具。
- 不把 static-time renderer 变成 Figma REST 调用方。
- 不实现完整 prototype interaction、业务状态机或跨页面 Flow 验证。
- 不完整还原所有 blend mode、boolean operation、复杂 mask 和 Figma plugin 私有数据。
- 不新增依赖，除非另走 `GATE-DEPENDENCY` 并获得确认。

## 5. 生成端保真边界

Generator Fidelity v1 只处理已经存在于本地事实中的输入：

- `DesignBundle` 中的 pages、nodes、bounds、styles、fills、effects、assets、screenshots、provenance；
- `CoverageReport` 中的 coverage records、visual layer decisions、unsupported diagnostics；
- `UISpec` 中的 pages、nodes、viewports、state、actions；
- preview renderer 和 render-and-compare 生成的 actual/expected/diff artifacts。

它不得在 static generation、preview render 或 compare 阶段重新访问 Figma。若发现缺少必要 asset，应该报告 `unsupported_missing_asset` 或 `visual_layer_no_asset`，并建议重新执行授权的 inspect，而不是隐式调用远端 API。

## 6. Tool Contract 边界

当前 `render_and_compare` 的模型可见输出契约在 `src/tools/contracts.ts` 中定义，`regionDiffs[].id` 只允许四类：

- `visual_assets`
- `text_regions`
- `form_controls`
- `button_icon_controls`

Generator Fidelity v1 默认不扩大这个模型可见 enum。v1 的细分区域诊断作为 M5/Generator Fidelity 报告层的 `RegionDiagnosis` 输出，可以映射到上述四类之一：

| 细分诊断区域 | 默认 contract bucket |
| --- | --- |
| `left_visual` | `visual_assets` |
| `modal_shell` | `visual_assets` |
| `dense_content` | `visual_assets` 或 `text_regions`，按主导节点决定 |
| `footer` | `text_regions` |
| `form_fields` | `form_controls` |
| `cta` | `button_icon_controls` |
| `social_buttons` | `button_icon_controls` |
| `mobile_canvas` | report-only canvas diagnostic，不写入 `regionDiffs[].id` |

如果实现者认为必须把细分区域直接暴露到 `RenderAndCompareOutput.regionDiffs[].id`，必须先通过 `GATE-TOOL-CONTRACT`：修改 `src/tools/contracts.ts`、更新 `src/validation/render-and-compare.ts` 类型、补 contract schema 测试，并确认这属于模型可见工具输出的 additive contract 变更。

## 7. 渲染模型

Generator Fidelity v1 使用双层渲染模型：

1. 结构化交互层
   - 节点：text、input、button、link-like text/button、section、stack、grid、image；
   - 目标：真实可编辑、可点击、可聚焦、可测试；
   - 输出：semantic DOM + deterministic CSS；
   - 限制：不得为了 diff 把结构化控件降级成像素截图。

2. 视觉保真层
   - 节点：vectorAsset、decorativeLayer、imageAsset、iconAsset、pixelOverlay；
   - 目标：表达 Figma 中复杂但不承担交互的视觉信号；
   - 输出：absolute positioned asset/image/overlay；
   - 默认：`pointer-events: none`，除非它被明确映射为 button icon 或结构化 image。

渲染顺序必须由 Figma z-order、coverage decision 和 UI node ownership 共同决定：

- background/decorative layer 在对应交互层后方；
- iconAsset 可以作为 button/input 的子视觉节点，不应成为遮挡控件的独立 overlay；
- pixelOverlay 只能覆盖非交互装饰区域；
- 若 overlay 与 input/button 可点击区域重叠，必须降低 overlay priority、设置 `pointer-events: none`，并在报告里暴露 overlap diagnostic。

## 8. 布局策略

### 8.1 Artboard-to-Viewport Mapping

每个 Figma page/frame 必须生成稳定的 canvas mapping：

```ts
type CanvasMapping = {
  sourcePageId: string;
  pageId: string;
  artboard: { width: number; height: number };
  viewport: { width: number; height: number; deviceScaleFactor: number };
  scale: number;
  origin: { x: number; y: number };
  renderMode: "fit_artboard" | "native_artboard" | "scroll_canvas" | "viewport_crop";
  crop?: { x: number; y: number; width: number; height: number };
};
```

v1 默认策略：

- mobile artboard 在 mobile viewport 下使用 native artboard；
- mobile artboard 在 desktop viewport 下不要拉伸成 desktop layout，应居中或按明确 preview mode 约束展示；
- desktop artboard 在 desktop viewport 下优先 native width，长页面使用 scroll/full-page capture；
- modal/design-system 样本保留 Figma artboard 尺寸，不把局部组件强行扩展成整页 app；
- 所有 mapping 写入 compare/report，避免 diff 由隐式缩放或裁切造成。

### 8.2 Absolute Geometry

对于 Figma-derived 节点，v1 优先使用 page-relative absolute geometry：

- `left/top/width/height` 来自 page-relative bounds；
- border radius、opacity、fills、stroke、shadow 按已支持字段映射；
- auto-layout 只作为 group/stack 语义增强，不应覆盖已知 absolute geometry；
- 若 DOM 文本实际高度与 Figma text box 不一致，应由 typography policy 处理，而不是整体移动后续节点。

### 8.3 Long Canvas

长页面必须使用 full-page expected/actual 对齐，或显式记录 `viewport_crop`。禁止把 Figma 1778px 高画板静默裁成 900px 后当作等价比较。

## 9. Typography 策略

Text fidelity 是 v1 的核心，因为 text boxes、line-height 和换行会放大区域 diff。

v1 需要建立 `TextMetricsMapper`：

```ts
type TextRenderStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number | string;
  lineHeightPx: number;
  letterSpacingPx: number;
  color: string;
  textAlign?: "left" | "center" | "right";
  width: number;
  minHeight?: number;
  whiteSpace: "normal" | "nowrap" | "pre-wrap";
  overflowWrap: "normal" | "break-word";
};
```

策略：

- 优先使用 Figma text style；缺失时使用 node style；仍缺失时使用项目默认字体 fallback；
- `lineHeightPx` 必须尊重 Figma explicit line-height；不得只依赖浏览器 normal；
- 单行按钮、footer、label、placeholder 优先 `nowrap`，除非 Figma text box 明显允许换行；
- 多行正文用 fixed width + Figma line-height；
- font fallback 需要记录 warning，但不应改变 layout ownership；
- letter spacing 默认为 Figma 值；缺失时为 0，不用负值猜测。

## 10. Asset Layering 策略

v1 的视觉 asset 渲染必须满足：

- asset 使用本地路径和 provenance，不保存远端 URL；
- `object-fit` 根据 Figma fill mode 决定：cover、contain、stretch、tile 暂不支持则进入 unsupported；
- vector/decorative SVG 优先按导出 asset 原始宽高渲染，再用 bounds 控制布局；
- iconAsset 在控件内要保持 Figma 尺寸，不因 button padding 被压缩；
- decorativeLayer 使用 page-relative zIndex 和 opacity；
- 需要 clip 的 layer 必须绑定 clip parent；暂不支持 clip/mask 时输出区域级 unsupported，而不是静默显示错位大图；
- 同一父 asset 已覆盖的子 vector 继续作为 `covered_by_parent_asset`，但 compare/report 要能看到 attribution。

## 11. Region Diagnosis

v1 采用两层区域诊断：

1. `RenderAndCompareOutput.regionDiffs` 保持当前四个 contract bucket，除非通过 `GATE-TOOL-CONTRACT`。
2. M5/Generator Fidelity report 可新增细分 `RegionDiagnosis`，用于排期和 markdown 展示。

细分 `RegionDiagnosis` 至少包含：

```ts
type RegionDiagnosis = {
  id:
    | "left_visual"
    | "form_fields"
    | "cta"
    | "social_buttons"
    | "footer"
    | "modal_shell"
    | "dense_content"
    | "mobile_canvas";
  contractBucket?: "visual_assets" | "text_regions" | "form_controls" | "button_icon_controls";
  bounds?: { x: number; y: number; width: number; height: number };
  diffPixelRatio?: number;
  diffPixels?: number;
  sourceNodeIds?: string[];
  uiSpecNodeIds?: string[];
  suspectedCauses: Array<"canvas_mapping" | "typography" | "asset_layering" | "clip_or_mask" | "renderer_reset" | "unsupported_feature">;
};
```

## 12. Report 与 Evidence

Generator Fidelity v1 的报告需要同时包含：

- coverage summary：继续引用 Coverage Engine 输出；
- visual summary：每页 diff、contract bucket diff、细分 region diagnosis、是否 `<5%`；
- canvas mapping：artboard、viewport、scale、origin、renderMode；
- typography diagnostics：缺字体、line-height fallback、nowrap/换行异常；
- asset diagnostics：缺 asset、clip/mask unsupported、zIndex overlap、pointer-events risk；
- regression table：6 样本当前值、baseline、delta。

正式 validation candidate 应引用报告路径和摘要指标，不粘贴敏感 URL、token、原始远端 payload。

## 13. 方案选择

本设计选择“保留模型可见 `render_and_compare` region contract，新增 report-level 细分诊断”作为 v1 默认方案。

- 备选 A：直接扩大 `RenderAndCompareOutput.regionDiffs[].id` enum。优点是工具输出更细；缺点是改变模型可见契约，影响 contract schema、工具消费者和现有测试，必须单独 gate。
- 备选 B：只保留四个粗粒度 region。优点是改动小；缺点是无法指导 LoginUIConcept、modal、mobile canvas 的后续修复。
- 选择原因：report-level 细分诊断能满足排期和视觉修复需要，同时避免无授权扩大模型可见工具契约。

## 14. 验收标准

Generator Fidelity v1 完成时必须满足：

1. 6 个 Community 样本全部可本地生成 UISpec、渲染、compare；脚本级无失败。
2. 至少 4/6 样本 `<5%` pixel diff；剩余失败样本必须有区域级原因归因。
3. LoginUIConcept 不使用整页截图 fallback，仍保留 input/button/social button/footer 的真实 DOM。
4. mobile profile 的 diff 不再由 artboard/viewport 缩放错配主导。
5. design-system modal 至少输出 modal shell、body、CTA/dismiss 控件的区域级 diff 和 ownership。
6. ecommerce 与 dashboard 的 icon/image/text 组合不因 zIndex/asset sizing 出现明显错位。
7. keyboard/focus/console 基础验证通过。
8. `npm run typecheck` 和相关 unit/integration/e2e 验证通过。
9. 严格 secret scan 无 Figma/OpenAI token、远端 signed image URL 或 `fuid` 泄露。

## 15. Residual Assumptions

- assumption：v1 默认不扩大模型可见 `render_and_compare` region enum。
  validation_method：实现 T04 时检查 `src/tools/contracts.ts`；若需要 enum 扩展，先执行 `GATE-TOOL-CONTRACT` 并补 contract 测试。
- assumption：6 样本 cached corpus 仍位于 `data/community-corpus-v21`，projectId 与当前 visual summary 一致。
  validation_method：GATE-00 使用 `jq` 从 `reports/community-corpus/20260726-m5-visual-v21-local-summary.json` 读取 projectId 列表并逐项检查 DesignBundle 存在。

## 16. 风险与后续

- 若 font availability 与 Figma 字体不一致，可能需要字体替代诊断或用户授权安装字体，但 v1 不默认新增依赖。
- 若复杂 mask/blend mode 是主要 diff 来源，v1 应输出 unsupported attribution，不强行用 CSS 猜测。
- 若 `<5%` 对高密 design-system modal 过严，v1 仍应把区域级原因证明清楚，再由后续目标调整阈值或拆分样本等级。
- 若现有 UISpec schema 无法表达必要 layering metadata，应单独触发 `GATE-UISPEC-SCHEMA`，不在实现中静默扩公共契约。
