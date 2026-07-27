# M5 静态生成报告

- runId: 20260727-residual-invalid-cache-check-m3b-r2
- projectId: m3-flow-20260723-b
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

### page-1 (/page-1)

- viewportRole: desktop
- nodes: {"text":179,"input":0,"select":2,"button":4,"image":10,"pixelOverlay":0,"total":430}
- structuredCoverage: text=179, interactive=18
- componentFidelity: sourceComponentNodes=95, families={"unknown":36,"button":8,"icon":3,"input":2,"select":8,"radio":24,"tag":14}, states={"default":79,"selected":16}
- visualLayerCoverage: candidate=0, rendered=0, unsupported=0

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

## 覆盖率摘要

- sourceNodeCount: 653
- visibleNodeCount: 601
- unsupportedCount: 86
- unmappedCount: 0

### page-1

- sourceNodeCount: 653
- visibleNodeCount: 601
- vector: total=87, rendered=3, ignoredSafe=0, unsupported=84, unmapped=0
- imageFill: total=10, rendered=10, missingAsset=0
- text: total=214, rendered=206, styleComplete=206
- budgetExceeded: 0
- pageSize: 1832x3079 / 1832x3079 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":86}
- byKind: {"vector":84,"container":2}

- 3:6529 (vector, unsupported_renderer_limit, area=1162920): bg
- 3:6494 (vector, unsupported_renderer_limit, area=1028720): bg
- 3:6477 (vector, unsupported_renderer_limit, area=344080): bg
- I3:6490;5022:28762 (vector, unsupported_renderer_limit, area=104448): bg
- I3:6505;2677:20097;5148:8221 (container, unsupported_renderer_limit, area=1260): Optional
- I3:6540;2677:20335;5148:8221 (container, unsupported_renderer_limit, area=1260): Optional
- I3:6492;5029:4572;2536:3622 (vector, unsupported_renderer_limit, area=484): Vector
- I3:6527;5029:4572;2536:3622 (vector, unsupported_renderer_limit, area=484): Vector
- I3:6583;5029:4572;2536:3622 (vector, unsupported_renderer_limit, area=484): Vector
- I3:6490;5022:28810;7334:29313;2538:3681 (vector, unsupported_renderer_limit, area=400): Vector


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
