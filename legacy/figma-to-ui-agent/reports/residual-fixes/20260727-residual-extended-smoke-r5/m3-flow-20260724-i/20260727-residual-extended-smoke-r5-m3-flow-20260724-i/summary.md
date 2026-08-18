# M5 静态生成报告

- runId: 20260727-residual-extended-smoke-r5-m3-flow-20260724-i
- projectId: m3-flow-20260724-i
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

### projectdata (/projectdata)

- viewportRole: desktop
- nodes: {"text":21,"input":0,"select":0,"button":0,"image":3,"pixelOverlay":0,"total":48}
- structuredCoverage: text=21, interactive=0
- componentFidelity: sourceComponentNodes=3, families={"icon":3}, states={"default":3}
- visualLayerCoverage: candidate=9, rendered=9, unsupported=0

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

### loginpage (/loginpage)

- viewportRole: desktop
- nodes: {"text":13,"input":6,"select":0,"button":3,"image":3,"pixelOverlay":4,"total":47}
- structuredCoverage: text=13, interactive=9
- componentFidelity: sourceComponentNodes=11, families={"button":3,"input":8}, states={"default":11}
- visualLayerCoverage: candidate=10, rendered=10, unsupported=0

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

### thumbnail (/thumbnail)

- viewportRole: desktop
- nodes: {"text":0,"input":0,"select":0,"button":0,"image":1,"pixelOverlay":0,"total":2}
- structuredCoverage: text=0, interactive=0
- componentFidelity: sourceComponentNodes=0, families={}, states={}
- visualLayerCoverage: candidate=0, rendered=0, unsupported=0

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

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 10:46 | line_divider | line_or_divider | true | vl-projectdata-10-46 |
| 10:12 | structural_visual | decorative_background | true | vl-projectdata-10-12 |
| 10:31 | structural_visual | decorative_background | true | vl-projectdata-10-31 |
| 10:28 | structural_visual | decorative_background | true | vl-projectdata-10-28 |
| 10:24 | structural_visual | decorative_background | true | vl-projectdata-10-24 |
| 10:17 | structural_visual | decorative_background | true | vl-projectdata-10-17 |
| 10:14 | structural_visual | decorative_background | true | vl-projectdata-10-14 |
| 10:5 | structural_visual | decorative_background | true | vl-projectdata-10-5 |
| 10:7 | structural_visual | decorative_background | true | vl-projectdata-10-7 |
| 2:3 | large_visual | decorative_background | true | vl-loginpage-2-3 |
| 4:4 | large_visual | decorative_background | true | vl-loginpage-4-4 |
| 4:3 | large_visual | decorative_background | true | vl-loginpage-4-3 |
| 4:2 | large_visual | decorative_background | true | vl-loginpage-4-2 |
| 2:14 | structural_visual | decorative_background | true | vl-loginpage-2-14 |
| 2:19 | structural_visual | decorative_background | true | vl-loginpage-2-19 |
| 2:5 | structural_visual | decorative_background | true | vl-loginpage-2-5 |
| 2:20 | structural_visual | decorative_background | true | vl-loginpage-2-20 |
| 2:26 | structural_visual | decorative_background | true | vl-loginpage-2-26 |
| 2:32 | structural_visual | decorative_background | true | vl-loginpage-2-32 |

## 覆盖率摘要

- sourceNodeCount: 88
- visibleNodeCount: 88
- unsupportedCount: 0
- unmappedCount: 6

### projectdata

- sourceNodeCount: 48
- visibleNodeCount: 48
- vector: total=9, rendered=9, ignoredSafe=0, unsupported=0, unmapped=0
- imageFill: total=3, rendered=3, missingAsset=0
- text: total=21, rendered=21, styleComplete=21
- budgetExceeded: 0
- pageSize: 1440x1024 / 1440x1024 (full_page)
- widthMatched: true
- heightMatched: true

### loginpage

- sourceNodeCount: 38
- visibleNodeCount: 38
- vector: total=10, rendered=4, ignoredSafe=0, unsupported=0, unmapped=6
- imageFill: total=3, rendered=3, missingAsset=0
- text: total=13, rendered=13, styleComplete=13
- budgetExceeded: 0
- pageSize: 1440x1024 / 1440x1024 (full_page)
- widthMatched: true
- heightMatched: true

### thumbnail

- sourceNodeCount: 2
- visibleNodeCount: 2
- vector: total=0, rendered=0, ignoredSafe=0, unsupported=0, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=0, rendered=0, styleComplete=0
- budgetExceeded: 0
- pageSize: 1440x1024 / 1440x1024 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {}
- byKind: {}



## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
