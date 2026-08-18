# M5 静态生成报告

- runId: 20260727-residual-invalid-cache-check-login-r2
- projectId: login-ui-concept-perceptual-20260724a
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

### page-1 (/page-1)

- viewportRole: desktop
- nodes: {"text":21,"input":0,"select":0,"button":0,"image":3,"pixelOverlay":4,"total":43}
- structuredCoverage: text=21, interactive=0
- componentFidelity: sourceComponentNodes=3, families={"icon":3}, states={"default":3}
- visualLayerCoverage: candidate=4, rendered=4, unsupported=0

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
| 2:3 | large_visual | decorative_background | true | vl-page-1-2-3 |
| 4:4 | large_visual | decorative_background | true | vl-page-1-4-4 |
| 4:3 | large_visual | decorative_background | true | vl-page-1-4-3 |
| 4:2 | large_visual | decorative_background | true | vl-page-1-4-2 |

## 覆盖率摘要

- sourceNodeCount: 88
- visibleNodeCount: 88
- unsupportedCount: 9
- unmappedCount: 6

### page-1

- sourceNodeCount: 88
- visibleNodeCount: 88
- vector: total=19, rendered=4, ignoredSafe=0, unsupported=9, unmapped=6
- imageFill: total=7, rendered=7, missingAsset=0
- text: total=34, rendered=34, styleComplete=34
- budgetExceeded: 0
- pageSize: 1447x3165 / 1440x1024 (full_page)
- widthMatched: false
- heightMatched: false

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":9}
- byKind: {"vector":9}

- 10:12 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:31 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:28 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:24 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:17 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:14 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:5 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:7 (vector, unsupported_renderer_limit, area=3600): Frame
- 10:46 (vector, unsupported_renderer_limit, area=0): Line 1


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
