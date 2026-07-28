# M5 静态生成报告

- runId: 20260727gf-v2-final-r2-community-v21-design-system-001
- projectId: community-v21-design-system-001
- designBundleRevision: 4
- uiSpecRevision: 100
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### in-modals (/in-modals)

- viewportRole: desktop
- nodes: {"text":18,"input":3,"select":6,"button":5,"image":0,"pixelOverlay":3,"total":106}
- structuredCoverage: text=18, interactive=14
- componentFidelity: sourceComponentNodes=52, families={"modal":4,"icon":16,"input":6,"select":12,"button":11,"unknown":3}, states={"default":52}
- visualLayerCoverage: candidate=45, rendered=45, unsupported=0

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

- diffPixels: 20619
- diffPixelRatio: 0.012200620593184835
- screenshots: runs/ms2owzxe-6308bc8b1f2640b291b7695da28f4daa/screenshots/000-6fa923173131-expected.png, runs/ms2owzxe-6308bc8b1f2640b291b7695da28f4daa/screenshots/000-6fa923173131-actual.png, runs/ms2owzxe-6308bc8b1f2640b291b7695da28f4daa/diffs/000-6fa923173131-diff.png

##### canvasMapping

- artboard: 1829x924
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 1.44% | 20619 | 184,54,1645x870 |
| text_regions | 7.26% | 20424 | 598,215,675x417 |
| form_controls | 15.45% | 13711 | 598,301,584x152 |
| button_icon_controls | 8.75% | 18617 | 606,301,624x341 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| form_fields | form_controls | 15.45% | 13711 | typography, renderer_reset |
| cta | button_icon_controls | 8.75% | 18617 | asset_layering, renderer_reset |
| dense_content | text_regions | 7.26% | 20424 | typography |
| dense_content | visual_assets | 1.44% | 20619 | asset_layering |
| modal_shell | - | 1.22% | 20619 | renderer_reset |

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
| 14:4591 | structural_visual | icon | true | vl-in-modals-14-4591 |
| I14:4586;2:27072 | structural_visual | decorative_background | true | vl-in-modals-I14-4586-2-27072 |
| 21:2365 | background_composite | decorative_background | true | vl-in-modals-21-2365 |
| 14:4745 | nav_icon | icon | true | vl-in-modals-14-4745 |
| 14:4737 | nav_icon | icon | true | vl-in-modals-14-4737 |
| 14:4743 | nav_icon | icon | true | vl-in-modals-14-4743 |
| 14:4735 | nav_icon | icon | true | vl-in-modals-14-4735 |
| 14:4741 | nav_icon | icon | true | vl-in-modals-14-4741 |
| 14:4739 | nav_icon | icon | true | vl-in-modals-14-4739 |
| 13:18317 | nav_icon | icon | true | vl-in-modals-13-18317 |
| I13:18321;2:1582;11:17029 | nav_icon | icon | true | vl-in-modals-I13-18321-2-1582-11-17029 |
| 14:4199 | nav_icon | icon | true | vl-in-modals-14-4199 |

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

- byReason: {"unsupported_renderer_limit":55}
- byKind: {"vector":50,"unsupported":1,"container":4}

- 14:4422 (container, unsupported_renderer_limit, area=7560): border
- I14:4591;2:27099 (vector, unsupported_renderer_limit, area=5625): Vector
- 21:2375 (container, unsupported_renderer_limit, area=3920): space
- 21:2385 (container, unsupported_renderer_limit, area=1568): space
- 21:2431 (container, unsupported_renderer_limit, area=1568): space
- I14:4591;2:27096 (vector, unsupported_renderer_limit, area=225): Vector
- 14:4201 (vector, unsupported_renderer_limit, area=186): Vector
- 14:4202 (vector, unsupported_renderer_limit, area=105): Vector
- 14:4204 (vector, unsupported_renderer_limit, area=91): Vector
- I13:18321;2:1582;11:17029;13:18116 (vector, unsupported_renderer_limit, area=76): Vector (Stroke)


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
