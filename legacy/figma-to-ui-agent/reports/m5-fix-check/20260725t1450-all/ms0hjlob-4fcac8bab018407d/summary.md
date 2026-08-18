# M5 静态生成报告

- runId: ms0hjlob-4fcac8bab018407d
- projectId: m5-live-restricted-case-a-20260725t14271784989637z
- designBundleRevision: 1
- uiSpecRevision: 2
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: promoted

## 页面摘要

### login-version-1 (/login-version-1)

- viewportRole: mobile
- nodes: {"text":14,"input":0,"button":0,"image":0,"pixelOverlay":1,"total":49}
- structuredCoverage: text=14, interactive=0
- visualLayerCoverage: candidate=16, rendered=16, unsupported=0

#### regions

- **left_visual**: not_applicable
  - 无左侧视觉层
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

- diffPixels: 154173
- diffPixelRatio: 0.12657881773399016
- screenshots: runs/ms0hjloj-bdef0220f8104465ad87cdc950417a6d/screenshots/000-2a081ee3e777-expected.png, runs/ms0hjloj-bdef0220f8104465ad87cdc950417a6d/screenshots/000-2a081ee3e777-actual.png, runs/ms0hjloj-bdef0220f8104465ad87cdc950417a6d/diffs/000-2a081ee3e777-diff.png

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 3:16684 | button_icon | button_icon | true | - |
| I3:16736;3:6782 | button_icon | button_icon | true | - |
| I28:4029;3:6135 | button_icon | button_icon | true | - |
| I3:16736;3:6770 | button_icon | button_icon | true | - |
| I3:16736;3:6784 | button_icon | button_icon | true | - |
| I3:16736;3:6776 | button_icon | button_icon | true | - |
| I3:5133;3:6015;4:78000 | button_icon | button_icon | true | - |
| I3:5134;3:6015;4:78000 | button_icon | button_icon | true | - |
| I28:4029;3:6136 | button_icon | button_icon | true | - |
| I3:5137;3:6044;4:76017 | button_icon | button_icon | true | - |
| I3:5133;3:6013;4:78376 | button_icon | button_icon | true | - |
| I3:5134;3:6013;4:78376 | button_icon | button_icon | true | - |
| I28:4028;3:6131;136:158 | button_icon | button_icon | true | - |
| I28:4028;3:6131;136:156 | button_icon | button_icon | true | - |
| I3:16736;3:6777 | button_icon | button_icon | true | - |
| I3:16755;3:6790 | line_divider | line_or_divider | true | vl-login-version-1-I3-16755-3-6790 |

## 覆盖率摘要

- sourceNodeCount: 82
- visibleNodeCount: 77
- unsupportedCount: 7
- unmappedCount: 0

### login-version-1

- sourceNodeCount: 82
- visibleNodeCount: 77
- vector: total=29, rendered=16, ignoredSafe=6, unsupported=7, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=14, rendered=14, styleComplete=14
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 3:16683
- **unmapped_node_vector**: 未映射的节点类型 vector: 28:4024
- **unmapped_node_vector**: 未映射的节点类型 vector: 28:4026
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:155
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:157
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6783

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
