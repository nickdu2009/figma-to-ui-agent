# M5 静态生成报告

- runId: 20260727gf-v2-small-vector-fallback-r1-community-v21-mobile-001
- projectId: community-v21-mobile-001
- designBundleRevision: 2
- uiSpecRevision: 94
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### 6-11---a---profile (/6-11---a---profile)

- viewportRole: tablet
- nodes: {"text":24,"input":0,"select":0,"button":1,"image":1,"pixelOverlay":14,"total":63}
- structuredCoverage: text=24, interactive=4
- componentFidelity: sourceComponentNodes=14, families={"icon":1,"unknown":3,"switch":6,"avatar":2,"button":2}, states={"default":14}
- visualLayerCoverage: candidate=21, rendered=21, unsupported=1

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

- diffPixels: 38777
- diffPixelRatio: 0.0958884462545469
- screenshots: runs/ms2nxz6d-a2f08d7bb1ff413abb31246baa70b27b/screenshots/000-811630216a36-expected.png, runs/ms2nxz6d-a2f08d7bb1ff413abb31246baa70b27b/screenshots/000-811630216a36-actual.png, runs/ms2nxz6d-a2f08d7bb1ff413abb31246baa70b27b/diffs/000-811630216a36-diff.png

##### canvasMapping

- artboard: 393x1029
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 9.60% | 37672 | 0,30,393x999 |
| text_regions | 11.42% | 32669 | 35,9,310x923 |
| form_controls | 11.27% | 1066 | 45,984,305x31 |
| button_icon_controls | 24.28% | 1241 | 124,904,142x36 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| cta | button_icon_controls | 24.28% | 1241 | asset_layering, renderer_reset |
| dense_content | text_regions | 11.42% | 32669 | typography |
| form_fields | form_controls | 11.27% | 1066 | typography, renderer_reset |
| dense_content | visual_assets | 9.60% | 37672 | asset_layering |
| mobile_canvas | - | 9.59% | 38777 | canvas_mapping |

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
| 3186:4552 | structural_visual | decorative_shape | true | vl-6-11---a---profile-3186-4552 |
| 3186:4553 | structural_visual | decorative_shape | true | vl-6-11---a---profile-3186-4553 |
| 3186:4555 | structural_visual | decorative_shape | true | vl-6-11---a---profile-3186-4555 |
| I3186:4559;3096:2694 | structural_visual | decorative_shape | true | vl-6-11---a---profile-I3186-4559-3096-2694 |

## 覆盖率摘要

- sourceNodeCount: 61
- visibleNodeCount: 61
- unsupportedCount: 2
- unmappedCount: 0

### 6-11---a---profile

- sourceNodeCount: 61
- visibleNodeCount: 61
- vector: total=23, rendered=21, ignoredSafe=0, unsupported=2, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=24, rendered=24, styleComplete=24
- budgetExceeded: 0
- pageSize: 393x1029 / 393x1029 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":2}
- byKind: {"vector":2}

- I3202:4758;2069:1253 (vector, unsupported_renderer_limit, area=213): Vector
- 3186:4556 (vector, unsupported_renderer_limit, area=153): Vector (Stroke)


## unsupportedFeatures

- **visual_stroke_icon_no_asset** (fallback_ok): defer

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I3202:4758;2069:1253
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4556

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
