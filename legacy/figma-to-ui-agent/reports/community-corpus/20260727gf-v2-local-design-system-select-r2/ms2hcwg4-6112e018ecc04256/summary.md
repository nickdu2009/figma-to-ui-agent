# M5 静态生成报告

- runId: ms2hcwg4-6112e018ecc04256
- projectId: community-v21-design-system-001
- designBundleRevision: 4
- uiSpecRevision: 83
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: promoted

## 页面摘要

### in-modals (/in-modals)

- viewportRole: desktop
- nodes: {"text":18,"input":3,"button":5,"image":0,"pixelOverlay":3,"total":102}
- structuredCoverage: text=18, interactive=8
- visualLayerCoverage: candidate=42, rendered=41, unsupported=2

#### regions

- **left_visual**: passed
  - 检测到左侧视觉层
- **form_fields**: passed
  - 检测到表单输入域
- **cta**: not_applicable
  - 无明确 CTA
- **social_buttons**: not_applicable
  - 无社交按钮
- **footer**: not_applicable
  - 无页脚文案
- **page**: passed
  - 页面包含可渲染节点

#### comparison

- diffPixels: 21138
- diffPixelRatio: 0.012507721911767838
- screenshots: runs/ms2hcwgk-673a15fbc96f42dcab3e6df0a3bbb21b/screenshots/000-6fa923173131-expected.png, runs/ms2hcwgk-673a15fbc96f42dcab3e6df0a3bbb21b/screenshots/000-6fa923173131-actual.png, runs/ms2hcwgk-673a15fbc96f42dcab3e6df0a3bbb21b/diffs/000-6fa923173131-diff.png

##### canvasMapping

- artboard: 1829x924
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 1.48% | 21138 | 184,54,1645x870 |
| text_regions | 7.44% | 20943 | 598,215,675x417 |
| form_controls | 15.81% | 14033 | 598,301,584x152 |
| button_icon_controls | 4.05% | 3747 | 959,301,271x341 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| form_fields | form_controls | 15.81% | 14033 | typography, renderer_reset |
| dense_content | text_regions | 7.44% | 20943 | typography |
| cta | button_icon_controls | 4.05% | 3747 | asset_layering, renderer_reset |
| dense_content | visual_assets | 1.48% | 21138 | asset_layering |
| modal_shell | - | 1.25% | 21138 | renderer_reset |

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| I21:2366;5:36996 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-36996 |
| I21:2366;5:37146 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-37146 |
| 21:2450 | button_icon | button_icon | true | vl-in-modals-21-2450 |
| I21:2366;5:36990 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-36990 |
| 14:4767 | button_icon | button_icon | true | vl-in-modals-14-4767 |
| 14:4791 | button_icon | button_icon | true | vl-in-modals-14-4791 |
| 14:4779 | button_icon | button_icon | true | vl-in-modals-14-4779 |
| 21:2381 | button_icon | button_icon | true | vl-in-modals-21-2381 |
| 21:2405 | button_icon | button_icon | true | vl-in-modals-21-2405 |
| 21:2416 | button_icon | button_icon | true | vl-in-modals-21-2416 |
| 21:2427 | button_icon | button_icon | true | vl-in-modals-21-2427 |
| 21:2394 | button_icon | button_icon | true | vl-in-modals-21-2394 |
| 21:2439 | button_icon | button_icon | true | vl-in-modals-21-2439 |
| I21:2366;5:37154 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-37154 |
| I21:2366;5:37155 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-37155 |
| I21:2366;5:37148 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-37148 |
| 14:4769 | button_icon | button_icon | true | vl-in-modals-14-4769 |
| 14:4793 | button_icon | button_icon | true | vl-in-modals-14-4793 |
| 14:4781 | button_icon | button_icon | true | vl-in-modals-14-4781 |
| I21:2366;5:37008;1:747;2:1773;11:17049 | button_icon | button_icon | true | vl-in-modals-I21-2366-5-37008-1-747-2-1773-11-17049 |
| I13:18307;1630:17;5:2312 | button_icon | button_icon | true | vl-in-modals-I13-18307-1630-17-5-2312 |
| I14:4824;11:17049 | button_icon | button_icon | true | vl-in-modals-I14-4824-11-17049 |
| I14:4817;11:17049 | button_icon | button_icon | true | vl-in-modals-I14-4817-11-17049 |
| 21:2440 | button_icon | button_icon | true | vl-in-modals-21-2440 |
| 21:2372 | button_icon | button_icon | true | vl-in-modals-21-2372 |
| I13:18306;2189:34 | nav_icon | icon | true | vl-in-modals-I13-18306-2189-34 |
| I13:18308;1235:359;5:2381 | nav_icon | icon | true | vl-in-modals-I13-18308-1235-359-5-2381 |
| I21:2366;5:37108 | nav_icon | icon | true | vl-in-modals-I21-2366-5-37108 |
| I21:2366;5:37008;1:743;11:17029;11:17026 | nav_icon | icon | true | vl-in-modals-I21-2366-5-37008-1-743-11-17029-11-17026 |
| I13:18306;2189:36 | nav_icon | icon | true | vl-in-modals-I13-18306-2189-36 |
| I21:2366;5:37329 | line_divider | line_or_divider | true | vl-in-modals-I21-2366-5-37329 |
| 21:2534 | large_visual | decorative_background | true | vl-in-modals-21-2534 |
| 5:37656 | large_visual | decorative_background | true | vl-in-modals-5-37656 |
| I14:4591;2:27099 | structural_visual | decorative_background | false | - |
| I14:4586;2:27072 | structural_visual | decorative_background | true | vl-in-modals-I14-4586-2-27072 |
| 21:2365 | background_composite | decorative_background | true | vl-in-modals-21-2365 |
| 14:4745 | nav_icon | icon | true | vl-in-modals-14-4745 |
| 14:4737 | nav_icon | icon | true | vl-in-modals-14-4737 |
| 14:4743 | nav_icon | icon | true | vl-in-modals-14-4743 |
| 14:4735 | nav_icon | icon | true | vl-in-modals-14-4735 |
| 14:4741 | nav_icon | icon | true | vl-in-modals-14-4741 |
| 14:4739 | nav_icon | icon | true | vl-in-modals-14-4739 |

## 覆盖率摘要

- sourceNodeCount: 329
- visibleNodeCount: 301
- unsupportedCount: 55
- unmappedCount: 0

### in-modals

- sourceNodeCount: 329
- visibleNodeCount: 301
- vector: total=95, rendered=43, ignoredSafe=2, unsupported=50, unmapped=0
- imageFill: total=3, rendered=3, missingAsset=0
- text: total=49, rendered=42, styleComplete=42
- budgetExceeded: 0
- pageSize: 1830x1037 / 1829x924 (full_page)
- widthMatched: false
- heightMatched: false

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":54,"unsupported_missing_asset":1}
- byKind: {"vector":50,"unsupported":1,"container":4}

- 14:4422 (container, unsupported_renderer_limit, area=7560): border
- I14:4591;2:27099 (vector, unsupported_missing_asset, area=5625): Vector
- 21:2375 (container, unsupported_renderer_limit, area=3920): space
- 21:2385 (container, unsupported_renderer_limit, area=1568): space
- 21:2431 (container, unsupported_renderer_limit, area=1568): space
- I14:4591;2:27096 (vector, unsupported_renderer_limit, area=225): Vector
- 14:4201 (vector, unsupported_renderer_limit, area=186): Vector
- 14:4202 (vector, unsupported_renderer_limit, area=105): Vector
- 14:4204 (vector, unsupported_renderer_limit, area=91): Vector
- I13:18321;2:1582;11:17029;13:18116 (vector, unsupported_renderer_limit, area=76): Vector (Stroke)


## unsupportedFeatures

- **visual_layer_no_asset** (fallback_ok): defer
- **visual_stroke_icon_no_asset** (fallback_ok): defer

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 13:18319
- **unmapped_node_vector**: 未映射的节点类型 vector: 13:18320
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18111
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18112
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18113
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18114
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18115
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18116
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4201
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4202
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4203
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4204

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
