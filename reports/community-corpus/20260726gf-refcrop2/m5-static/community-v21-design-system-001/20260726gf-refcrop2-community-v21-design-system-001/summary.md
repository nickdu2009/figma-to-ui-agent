# M5 静态生成报告

- runId: 20260726gf-refcrop2-community-v21-design-system-001
- projectId: community-v21-design-system-001
- designBundleRevision: 1
- uiSpecRevision: 51
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### in-modals (/in-modals)

- viewportRole: desktop
- nodes: {"text":35,"input":9,"button":23,"image":0,"pixelOverlay":30,"total":249}
- structuredCoverage: text=35, interactive=32
- visualLayerCoverage: candidate=35, rendered=34, unsupported=1

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

- diffPixels: 264272
- diffPixelRatio: 0.15637433461380973
- screenshots: runs/ms1is568-e4be19ba07bf4f98878a982b3147af2b/screenshots/000-6fa923173131-expected.png, runs/ms1is568-e4be19ba07bf4f98878a982b3147af2b/screenshots/000-6fa923173131-actual.png, runs/ms1is568-e4be19ba07bf4f98878a982b3147af2b/diffs/000-6fa923173131-diff.png

##### canvasMapping

- artboard: 1829x924
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 4.24% | 47970 | 191,54,1441x785 |
| text_regions | 4.79% | 34745 | 236,77,1306x555 |
| form_controls | 18.11% | 16074 | 598,301,584x152 |
| button_icon_controls | 4.41% | 35188 | 192,70,1396x572 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| form_fields | form_controls | 18.11% | 16074 | typography, renderer_reset |
| modal_shell | - | 15.64% | 264272 | renderer_reset |
| footer | text_regions | 4.79% | 34745 | typography |
| cta | button_icon_controls | 4.41% | 35188 | asset_layering, renderer_reset |
| social_buttons | button_icon_controls | 4.41% | 35188 | asset_layering, renderer_reset |
| left_visual | visual_assets | 4.24% | 47970 | asset_layering |

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

## 覆盖率摘要

- sourceNodeCount: 329
- visibleNodeCount: 301
- unsupportedCount: 61
- unmappedCount: 0

### in-modals

- sourceNodeCount: 329
- visibleNodeCount: 301
- vector: total=95, rendered=37, ignoredSafe=2, unsupported=56, unmapped=0
- imageFill: total=3, rendered=3, missingAsset=0
- text: total=49, rendered=42, styleComplete=42
- budgetExceeded: 0
- pageSize: 1830x1037 / 1829x924 (full_page)
- widthMatched: false
- heightMatched: false

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":60,"unsupported_missing_asset":1}
- byKind: {"vector":56,"unsupported":1,"container":4}

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

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:36985
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:36986
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:36991
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37008;1:743;11:17029;11:17024
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37008;1:743;11:17029;11:17025
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37008;1:747;2:1773;11:17048
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37109
- **unmapped_node_unsupported**: 未映射的节点类型 unsupported: I21:2366;5:37110
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37158
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37159
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37149
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37142
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37143
- **unmapped_node_vector**: 未映射的节点类型 vector: I21:2366;5:37144
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2379
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2389
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2392
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2393
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2401
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2404
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2412
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2415
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2423
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2426
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2435
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2438
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2447
- **unmapped_node_vector**: 未映射的节点类型 vector: 21:2451
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4745
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4737
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4743
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4735
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4741
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:4739
- **unmapped_node_vector**: 未映射的节点类型 vector: 13:18319
- **unmapped_node_vector**: 未映射的节点类型 vector: 13:18320
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18111
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18112
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18113
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18114
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18115
- **unmapped_node_vector**: 未映射的节点类型 vector: I13:18321;2:1582;11:17029;13:18116
- **unmapped_node_component**: 未映射的节点类型 component: 14:4198

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
