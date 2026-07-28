# M5 静态生成报告

- runId: 20260727-residual-extended-smoke-r5-blind-case-b-r8
- projectId: blind-case-b-r8
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

### checkout (/checkout)

- viewportRole: mobile
- nodes: {"text":12,"input":0,"select":0,"button":1,"image":1,"pixelOverlay":1,"total":62}
- structuredCoverage: text=12, interactive=1
- componentFidelity: sourceComponentNodes=12, families={"unknown":9,"icon":1,"button":2}, states={"default":12}
- visualLayerCoverage: candidate=37, rendered=37, unsupported=0

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
| I728:1891;544:734 | structural_visual | decorative_background | true | vl-checkout-I728-1891-544-734 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:1917 | structural_visual | decorative_background | true | vl-checkout-728-1917 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| I728:1971;700:1463 | structural_visual | decorative_background | true | vl-checkout-I728-1971-700-1463 |
| I728:1971;700:1467 | structural_visual | decorative_background | true | vl-checkout-I728-1971-700-1467 |
| 728:2176 | structural_visual | icon | true | vl-checkout-728-2176 |
| I728:1926;94:1742 | nav_icon | icon | true | vl-checkout-I728-1926-94-1742 |
| I728:1940;94:1742 | nav_icon | icon | true | vl-checkout-I728-1940-94-1742 |
| I728:1971;700:1471 | nav_icon | icon | true | vl-checkout-I728-1971-700-1471 |
| I728:1971;700:1468 | nav_icon | icon | true | vl-checkout-I728-1971-700-1468 |

## 覆盖率摘要

- sourceNodeCount: 75
- visibleNodeCount: 75
- unsupportedCount: 21
- unmappedCount: 0

### checkout

- sourceNodeCount: 75
- visibleNodeCount: 75
- vector: total=41, rendered=20, ignoredSafe=0, unsupported=21, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=12, rendered=12, styleComplete=12
- budgetExceeded: 0
- pageSize: 375x797 / 375x797 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":21}
- byKind: {"vector":21}

- 728:2177 (vector, unsupported_renderer_limit, area=1669): Left
- 728:2178 (vector, unsupported_renderer_limit, area=1012): Oval
- 728:2179 (vector, unsupported_renderer_limit, area=1012): Oval Copy
- 728:2181 (vector, unsupported_renderer_limit, area=1012): Oval
- 728:2182 (vector, unsupported_renderer_limit, area=1012): Oval
- 728:2184 (vector, unsupported_renderer_limit, area=1012): Oval
- 728:2185 (vector, unsupported_renderer_limit, area=1012): Oval
- 728:2180 (vector, unsupported_renderer_limit, area=834): Right
- I728:1891;425:656;425:649 (vector, unsupported_renderer_limit, area=334): Rectangle 319
- I728:1891;424:634;94:1726 (vector, unsupported_renderer_limit, area=324): Vector


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
