# M5 静态生成报告

- runId: 20260727-residual-extended-smoke-r2-m3-flow-20260723-c
- projectId: m3-flow-20260723-c
- designBundleRevision: 2
- uiSpecRevision: 2
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### landingpage (/landingpage)

- viewportRole: tablet
- nodes: {"text":11,"input":0,"select":0,"button":1,"image":4,"pixelOverlay":0,"total":39}
- structuredCoverage: text=11, interactive=1
- componentFidelity: sourceComponentNodes=9, families={"unknown":6,"button":2,"icon":1}, states={"default":9}
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

### quotation (/quotation)

- viewportRole: unknown
- nodes: {"text":79,"input":0,"select":1,"button":1,"image":3,"pixelOverlay":0,"total":183}
- structuredCoverage: text=79, interactive=8
- componentFidelity: sourceComponentNodes=41, families={"unknown":14,"input":1,"select":4,"radio":12,"button":2,"tag":7,"icon":1}, states={"default":33,"selected":8}
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

### quotation-1 (/quotation-2)

- viewportRole: unknown
- nodes: {"text":89,"input":0,"select":1,"button":2,"image":3,"pixelOverlay":0,"total":207}
- structuredCoverage: text=89, interactive=9
- componentFidelity: sourceComponentNodes=45, families={"unknown":16,"input":1,"select":4,"radio":12,"button":4,"tag":7,"icon":1}, states={"default":37,"selected":8}
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

- sourceNodeCount: 652
- visibleNodeCount: 600
- unsupportedCount: 86
- unmappedCount: 0

### landingpage

- sourceNodeCount: 61
- visibleNodeCount: 59
- vector: total=11, rendered=3, ignoredSafe=0, unsupported=8, unmapped=0
- imageFill: total=4, rendered=4, missingAsset=0
- text: total=14, rendered=14, styleComplete=14
- budgetExceeded: 0
- pageSize: 440x996 / 440x996 (full_page)
- widthMatched: true
- heightMatched: true

### quotation

- sourceNodeCount: 281
- visibleNodeCount: 257
- vector: total=36, rendered=0, ignoredSafe=0, unsupported=36, unmapped=0
- imageFill: total=3, rendered=3, missingAsset=0
- text: total=95, rendered=91, styleComplete=91
- budgetExceeded: 0
- pageSize: 440x2552 / 440x2552 (full_page)
- widthMatched: true
- heightMatched: true

### quotation-1

- sourceNodeCount: 310
- visibleNodeCount: 284
- vector: total=40, rendered=0, ignoredSafe=0, unsupported=40, unmapped=0
- imageFill: total=3, rendered=3, missingAsset=0
- text: total=105, rendered=101, styleComplete=101
- budgetExceeded: 0
- pageSize: 440x2857 / 440x2857 (full_page)
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
