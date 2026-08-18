# M5 静态生成报告

- runId: 20260726-generator-fidelity-v1-pill-radius-community-v21-mobile-001
- projectId: community-v21-mobile-001
- designBundleRevision: 1
- uiSpecRevision: 11
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### 6-11---a---profile (/6-11---a---profile)

- viewportRole: tablet
- nodes: {"text":24,"input":0,"button":1,"image":1,"pixelOverlay":14,"total":53}
- structuredCoverage: text=24, interactive=1
- visualLayerCoverage: candidate=14, rendered=14, unsupported=0

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

- diffPixels: 37703
- diffPixelRatio: 0.09323264020257321
- screenshots: runs/ms1907nz-9cb32168bb454519bb3b825612c9cc57/screenshots/000-811630216a36-expected.png, runs/ms1907nz-9cb32168bb454519bb3b825612c9cc57/screenshots/000-811630216a36-actual.png, runs/ms1907nz-9cb32168bb454519bb3b825612c9cc57/diffs/000-811630216a36-diff.png

##### canvasMapping

- artboard: 393x1029
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 6.60% | 25919 | 0,30,393x999 |
| text_regions | 9.70% | 27741 | 35,9,310x923 |
| button_icon_controls | 20.27% | 1036 | 124,904,142x36 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| cta | button_icon_controls | 20.27% | 1036 | asset_layering, renderer_reset |
| social_buttons | button_icon_controls | 20.27% | 1036 | asset_layering, renderer_reset |
| footer | text_regions | 9.70% | 27741 | typography |
| mobile_canvas | - | 9.32% | 37703 | canvas_mapping |
| left_visual | visual_assets | 6.60% | 25919 | asset_layering |

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| I3186:4557;3096:2590;3071:2441 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2590-3071-2441 |
| I3186:4557;3189:4744;3189:4296 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3189-4744-3189-4296 |
| I3186:4557;3096:2594;3071:2439 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2594-3071-2439 |
| I3186:4557;3096:2596;3071:2445 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2596-3071-2445 |
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

## 覆盖率摘要

- sourceNodeCount: 61
- visibleNodeCount: 61
- unsupportedCount: 9
- unmappedCount: 0

### 6-11---a---profile

- sourceNodeCount: 61
- visibleNodeCount: 61
- vector: total=23, rendered=14, ignoredSafe=0, unsupported=9, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=24, rendered=24, styleComplete=24
- budgetExceeded: 0
- pageSize: 393x1029 / 393x1029 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":9}
- byKind: {"vector":9}

- I3202:4758;2069:1253 (vector, unsupported_renderer_limit, area=213): Vector
- 3186:4556 (vector, unsupported_renderer_limit, area=153): Vector (Stroke)
- 3186:4552 (vector, unsupported_renderer_limit, area=143): Vector
- 3186:4553 (vector, unsupported_renderer_limit, area=120): Vector
- 3186:4555 (vector, unsupported_renderer_limit, area=84): Vector (Stroke)
- I3186:4559;3096:2694 (vector, unsupported_renderer_limit, area=66): Vector
- I3186:4557;3096:2566 (vector, unsupported_renderer_limit, area=0): Line 3
- 3250:4638 (vector, unsupported_renderer_limit, area=0): Vector 165
- 3250:4639 (vector, unsupported_renderer_limit, area=0): Vector 166


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I3202:4758;2069:1253
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4552
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4553
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4555
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4556
- **unmapped_node_vector**: 未映射的节点类型 vector: I3186:4557;3096:2566
- **unmapped_node_vector**: 未映射的节点类型 vector: I3186:4559;3096:2694
- **unmapped_node_vector**: 未映射的节点类型 vector: 3250:4638
- **unmapped_node_vector**: 未映射的节点类型 vector: 3250:4639

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
