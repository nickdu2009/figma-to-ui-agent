# M5 静态生成报告

- runId: 20260727-residual-extended-smoke-r1-blind-case-b-r8
- projectId: blind-case-b-r8
- designBundleRevision: 1
- uiSpecRevision: 3
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### checkout (/checkout)

- viewportRole: mobile
- nodes: {"text":12,"input":0,"select":0,"button":1,"image":1,"pixelOverlay":1,"total":59}
- structuredCoverage: text=12, interactive=1
- componentFidelity: sourceComponentNodes=12, families={"unknown":9,"icon":1,"button":2}, states={"default":12}
- visualLayerCoverage: candidate=35, rendered=32, unsupported=5

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

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| I861:3037;835:3097 | button_icon | icon | true | vl-checkout-I861-3037-835-3097 |
| I728:1891;425:656 | nav_icon | icon | true | vl-checkout-I728-1891-425-656 |
| I728:1891;658:707;651:894 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-894 |
| I728:1891;424:634 | nav_icon | icon | true | vl-checkout-I728-1891-424-634 |
| I728:1891;658:707;651:895 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-895 |
| I728:1891;658:707;651:890 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-890 |
| I728:1891;658:707;651:887 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-887 |
| I728:1891;658:707;651:892 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-892 |
| I728:1891;658:707;651:896 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-896 |
| I728:1891;658:707;651:888 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-888 |
| I728:1891;658:707;651:897 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-897 |
| I728:1891;658:707;651:893 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-893 |
| I728:1891;658:707;651:889 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-889 |
| I728:1891;658:707;651:891 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-891 |
| I728:1891;425:656 | nav_icon | icon | true | vl-checkout-I728-1891-425-656 |
| I728:1891;424:630 | line_divider | icon | true | vl-checkout-I728-1891-424-630 |
| I728:1891;424:630 | line_divider | icon | true | vl-checkout-I728-1891-424-630 |
| 728:1947 | line_divider | line_or_divider | true | vl-checkout-728-1947 |
| 728:1951 | line_divider | line_or_divider | true | vl-checkout-728-1951 |
| I861:3037;835:3093 | named_visual | decorative_shape | true | vl-checkout-I861-3037-835-3093 |
| I728:1891;544:734 | structural_visual | decorative_background | false | - |
| 728:2177 | structural_visual | decorative_background | true | vl-checkout-728-2177 |
| 728:1917 | structural_visual | decorative_background | true | vl-checkout-728-1917 |
| 728:2178 | structural_visual | decorative_background | true | vl-checkout-728-2178 |
| 728:2179 | structural_visual | decorative_background | true | vl-checkout-728-2179 |
| 728:2181 | structural_visual | decorative_background | true | vl-checkout-728-2181 |
| 728:2182 | structural_visual | decorative_background | true | vl-checkout-728-2182 |
| 728:2184 | structural_visual | decorative_background | true | vl-checkout-728-2184 |
| 728:2185 | structural_visual | decorative_background | true | vl-checkout-728-2185 |
| 728:2180 | structural_visual | decorative_background | true | vl-checkout-728-2180 |
| I728:1971;700:1463 | structural_visual | decorative_background | false | - |
| I728:1971;700:1467 | structural_visual | decorative_background | false | - |
| 728:2183 | structural_visual | decorative_background | true | vl-checkout-728-2183 |
| I728:1971;700:1471 | nav_icon | icon | true | vl-checkout-I728-1971-700-1471 |
| I728:1971;700:1468 | nav_icon | icon | true | vl-checkout-I728-1971-700-1468 |

## 覆盖率摘要

- sourceNodeCount: 75
- visibleNodeCount: 75
- unsupportedCount: 17
- unmappedCount: 0

### checkout

- sourceNodeCount: 75
- visibleNodeCount: 75
- vector: total=41, rendered=24, ignoredSafe=0, unsupported=17, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=12, rendered=12, styleComplete=12
- budgetExceeded: 0
- pageSize: 375x797 / 375x797 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_missing_asset":3,"unsupported_renderer_limit":14}
- byKind: {"vector":17}

- I728:1891;544:734 (vector, unsupported_missing_asset, area=22500): Rectangle 331
- I728:1971;700:1463 (vector, unsupported_missing_asset, area=576): Ellipse 68
- I728:1971;700:1467 (vector, unsupported_missing_asset, area=576): Ellipse 69
- I728:1891;425:656;425:649 (vector, unsupported_renderer_limit, area=334): Rectangle 319
- I728:1891;424:634;94:1726 (vector, unsupported_renderer_limit, area=324): Vector
- I861:3037;835:3097;425:649 (vector, unsupported_renderer_limit, area=232): Rectangle 319
- I728:1891;425:656;425:650 (vector, unsupported_renderer_limit, area=77): Vector
- I728:1926;94:1742 (vector, unsupported_renderer_limit, area=67): Forward
- I728:1940;94:1742 (vector, unsupported_renderer_limit, area=67): Forward
- I861:3037;835:3097;425:650 (vector, unsupported_renderer_limit, area=54): Vector


## unsupportedFeatures

- **visual_layer_no_asset** (fallback_ok): defer
- **visual_layer_no_asset** (fallback_ok): defer
- **visual_layer_no_asset** (fallback_ok): defer
- **visual_stroke_icon_no_asset** (fallback_ok): defer
- **visual_stroke_icon_no_asset** (fallback_ok): defer

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
