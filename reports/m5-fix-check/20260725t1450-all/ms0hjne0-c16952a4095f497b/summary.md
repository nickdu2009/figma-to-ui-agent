# M5 静态生成报告

- runId: ms0hjne0-c16952a4095f497b
- projectId: m5-live-restricted-case-b-20260725t14271784989637z
- designBundleRevision: 1
- uiSpecRevision: 4
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: promoted

## 页面摘要

### checkout (/checkout)

- viewportRole: mobile
- nodes: {"text":12,"input":0,"button":0,"image":1,"pixelOverlay":15,"total":49}
- structuredCoverage: text=12, interactive=0
- visualLayerCoverage: candidate=16, rendered=16, unsupported=0

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

- diffPixels: 60902
- diffPixelRatio: 0.050942701798410706
- screenshots: runs/ms0hjneb-368d92bdca264ce68bc1aa43a0aca4d9/screenshots/000-7f5fa9efe814-expected.png, runs/ms0hjneb-368d92bdca264ce68bc1aa43a0aca4d9/screenshots/000-7f5fa9efe814-actual.png, runs/ms0hjneb-368d92bdca264ce68bc1aa43a0aca4d9/diffs/000-7f5fa9efe814-diff.png

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| I861:3037;835:3097;425:649 | button_icon | button_icon | true | - |
| I728:1891;425:656;425:649 | nav_icon | icon | true | vl-checkout-I728-1891-425-656-425-649 |
| I728:1891;658:707;651:894 | nav_icon | icon | true | vl-checkout-I728-1891-658-707-651-894 |
| I728:1891;424:634;94:1726 | nav_icon | icon | true | vl-checkout-I728-1891-424-634-94-1726 |
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
| I728:1891;425:656;425:650 | nav_icon | icon | true | vl-checkout-I728-1891-425-656-425-650 |
| I861:3037;835:3093 | named_visual | decorative_shape | true | vl-checkout-I861-3037-835-3093 |

## 覆盖率摘要

- sourceNodeCount: 75
- visibleNodeCount: 75
- unsupportedCount: 25
- unmappedCount: 0

### checkout

- sourceNodeCount: 75
- visibleNodeCount: 75
- vector: total=41, rendered=16, ignoredSafe=0, unsupported=25, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=12, rendered=12, styleComplete=12
- budgetExceeded: 0
- pageSize: 375x797 / 375x797 (full_page)
- widthMatched: true
- heightMatched: true


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;544:734
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:630;94:1862
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:630;103:2
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:630;94:1863
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:634;94:1727
- **unmapped_node_vector**: 未映射的节点类型 vector: 728:1917
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1926;94:1742
- **unmapped_node_vector**: 未映射的节点类型 vector: 728:2177
- **unmapped_node_vector**: 未映射的节点类型 vector: 728:2180
- **unmapped_node_vector**: 未映射的节点类型 vector: 728:2183
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1940;94:1742
- **unmapped_node_vector**: 未映射的节点类型 vector: 728:1947
- **unmapped_node_vector**: 未映射的节点类型 vector: 728:1951
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1971;700:1463
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1971;700:1467
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1971;700:1473
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1971;700:1468;94:1750
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1971;700:1468;94:1751
- **unmapped_node_vector**: 未映射的节点类型 vector: I861:3037;835:3097;425:650

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
