# M5 静态生成报告

- runId: m5-blind-b-20260725-193957
- projectId: blind-case-b-r8
- designBundleRevision: 1
- uiSpecRevision: 2
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

### checkout (/checkout)

- viewportRole: mobile
- nodes: {"text":12,"input":0,"button":0,"image":1,"pixelOverlay":1,"total":35}
- structuredCoverage: text=12, interactive=0
- visualLayerCoverage: candidate=1, rendered=1, unsupported=0

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

- diffPixels: 854547
- diffPixelRatio: 0.7148030112923462
- screenshots: runs/ms0arkl8-7c496b0413454a88944d863ca6db525e/screenshots/001-7f5fa9efe814-expected.png, runs/ms0arkl8-7c496b0413454a88944d863ca6db525e/screenshots/001-7f5fa9efe814-actual.png, runs/ms0arkl8-7c496b0413454a88944d863ca6db525e/diffs/001-7f5fa9efe814-diff.png

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| I861:3037;835:3093 | named_visual | decorative_background | true | vl-checkout-I861-3037-835-3093 |

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;544:734
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:630;94:1862
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:630;103:2
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:630;94:1863
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:634;94:1726
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;424:634;94:1727
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;425:656;425:649
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;425:656;425:650
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:887
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:888
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:889
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:890
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:891
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:892
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:893
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:894
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:895
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:896
- **unmapped_node_vector**: 未映射的节点类型 vector: I728:1891;658:707;651:897
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
- **unmapped_node_vector**: 未映射的节点类型 vector: I861:3037;835:3097;425:649
- **unmapped_node_vector**: 未映射的节点类型 vector: I861:3037;835:3097;425:650

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
