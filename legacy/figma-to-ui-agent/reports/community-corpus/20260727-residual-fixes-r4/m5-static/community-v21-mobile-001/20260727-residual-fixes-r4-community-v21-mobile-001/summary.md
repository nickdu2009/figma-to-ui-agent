# M5 静态生成报告

- runId: 20260727-residual-fixes-r4-community-v21-mobile-001
- projectId: community-v21-mobile-001
- designBundleRevision: 2
- uiSpecRevision: 101
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### 6-11---a---profile (/6-11---a---profile)

- viewportRole: tablet
- nodes: {"text":24,"input":0,"select":0,"button":1,"image":1,"pixelOverlay":14,"total":61}
- structuredCoverage: text=24, interactive=4
- componentFidelity: sourceComponentNodes=14, families={"icon":1,"unknown":3,"switch":6,"avatar":2,"button":2}, states={"default":14}
- visualLayerCoverage: candidate=19, rendered=19, unsupported=0

#### regions

- **left_visual**: passed
  - 检测到左侧视觉层
- **form_fields**: not_applicable
  - 无表单输入域
- **cta**: not_applicable
  - 无明确 CTA
- **social_buttons**: not_applicable
  - 无社交按钮
- **footer**: not_applicable
  - 无页脚文案
- **page**: passed
  - 页面包含可渲染节点

#### comparison

- diffPixels: 6607
- diffPixelRatio: 0.01633790557298892
- screenshots: runs/ms2rfbds-1d1df7ad7c01487498e009baca4a7840/screenshots/000-811630216a36-expected.png, runs/ms2rfbds-1d1df7ad7c01487498e009baca4a7840/screenshots/000-811630216a36-actual.png, runs/ms2rfbds-1d1df7ad7c01487498e009baca4a7840/diffs/000-811630216a36-diff.png

##### canvasMapping

- artboard: 393x1029
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 1.45% | 5699 | 0,30,393x999 |
| text_regions | 1.10% | 3157 | 35,9,310x923 |
| form_controls | 0.00% | 0 | 45,984,305x31 |
| button_icon_controls | 1.41% | 2839 | 35,71,231x869 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| mobile_canvas | - | 1.63% | 6607 | canvas_mapping |
| dense_content | visual_assets | 1.45% | 5699 | asset_layering |
| cta | button_icon_controls | 1.41% | 2839 | asset_layering, renderer_reset |
| dense_content | text_regions | 1.10% | 3157 | typography |

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| I3186:4557;3096:2590;3071:2441 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2590-3071-2441 |
| I3186:4557;3189:4744;3189:4296 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3189-4744-3189-4296 |
| I3186:4557;3096:2594;3071:2439 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2594-3071-2439 |
| I3186:4557;3096:2596;3071:2445 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2596-3071-2445 |
| I3186:4557;3096:2566 | line_divider | line_or_divider | true | vl-6-11---a---profile-I3186-4557-3096-2566 |
| 3250:4638 | line_divider | line_or_divider | true | vl-6-11---a---profile-3250-4638 |
| 3250:4639 | line_divider | line_or_divider | true | vl-6-11---a---profile-3250-4639 |
| 3186:4547 | large_visual | decorative_background | true | vl-6-11---a---profile-3186-4547 |
| I3186:4557;3096:2568 | structural_visual | decorative_background | true | vl-6-11---a---profile-I3186-4557-3096-2568 |
| 3250:4634 | structural_visual | decorative_background | true | vl-6-11---a---profile-3250-4634 |
| 3186:4649 | structural_visual | decorative_background | true | vl-6-11---a---profile-3186-4649 |
| 3186:4688 | structural_visual | decorative_background | true | vl-6-11---a---profile-3186-4688 |
| 3186:4749 | structural_visual | decorative_background | true | vl-6-11---a---profile-3186-4749 |
| 3186:4652 | structural_visual | decorative_background | true | vl-6-11---a---profile-3186-4652 |
| 3186:4656 | structural_visual | decorative_background | true | vl-6-11---a---profile-3186-4656 |
| 3186:4659 | structural_visual | decorative_background | true | vl-6-11---a---profile-3186-4659 |
| I3202:4758;2069:1252 | structural_visual | decorative_background | true | vl-6-11---a---profile-I3202-4758-2069-1252 |
| 3202:4758 | nav_icon | icon | true | vl-6-11---a---profile-3202-4758 |
| 3186:4559 | nav_icon | icon | true | vl-6-11---a---profile-3186-4559 |

## 覆盖率摘要

- sourceNodeCount: 61
- visibleNodeCount: 61
- unsupportedCount: 6
- unmappedCount: 0

### 6-11---a---profile

- sourceNodeCount: 61
- visibleNodeCount: 61
- vector: total=23, rendered=17, ignoredSafe=0, unsupported=6, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=24, rendered=24, styleComplete=24
- budgetExceeded: 0
- pageSize: 393x1029 / 393x1029 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":6}
- byKind: {"vector":6}

- I3202:4758;2069:1253 (vector, unsupported_renderer_limit, area=213): Vector
- 3186:4556 (vector, unsupported_renderer_limit, area=153): Vector (Stroke)
- 3186:4552 (vector, unsupported_renderer_limit, area=143): Vector
- 3186:4553 (vector, unsupported_renderer_limit, area=120): Vector
- 3186:4555 (vector, unsupported_renderer_limit, area=84): Vector (Stroke)
- I3186:4559;3096:2694 (vector, unsupported_renderer_limit, area=66): Vector


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
