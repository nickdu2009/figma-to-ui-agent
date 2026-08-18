# M5 静态生成报告

- runId: 20260727-residual-extended-smoke-r3-blind-case-d-r3
- projectId: blind-case-d-r3
- designBundleRevision: 1
- uiSpecRevision: 4
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### 01 (/01)

- viewportRole: tablet
- nodes: {"text":2,"input":0,"select":0,"button":0,"image":1,"pixelOverlay":0,"total":5}
- structuredCoverage: text=2, interactive=0
- componentFidelity: sourceComponentNodes=0, families={}, states={}
- visualLayerCoverage: candidate=0, rendered=0, unsupported=0

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

## 覆盖率摘要

- sourceNodeCount: 6
- visibleNodeCount: 6
- unsupportedCount: 1
- unmappedCount: 0

### 01

- sourceNodeCount: 6
- visibleNodeCount: 6
- vector: total=1, rendered=0, ignoredSafe=0, unsupported=1, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=2, rendered=2, styleComplete=2
- budgetExceeded: 0
- pageSize: 685x492 / 685x492 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":1}
- byKind: {"vector":1}

- 1:4 (vector, unsupported_renderer_limit, area=337020): Background


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
