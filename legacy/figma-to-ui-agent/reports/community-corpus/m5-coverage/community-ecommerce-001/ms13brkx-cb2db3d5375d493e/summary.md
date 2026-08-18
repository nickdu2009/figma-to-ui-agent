# M5 受限 Live 生成报告

- runId: ms13brkx-cb2db3d5375d493e
- projectId: community-ecommerce-001
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required
- variablesMode: disabled_restricted_live
- apiBoundary: openai=false, figmaMe=false, variables=false

## 页面摘要

### featured (/featured)

- viewportRole: mobile
- nodes: {"text":21,"input":0,"button":0,"image":0,"pixelOverlay":9,"total":35}
- structuredCoverage: text=21, interactive=0
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

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 0:349 | line_divider | line_or_divider | true | vl-featured-0-349 |
| 0:340 | large_visual | decorative_background | true | vl-featured-0-340 |
| 0:326 | large_visual | decorative_background | true | vl-featured-0-326 |
| 0:341 | large_visual | decorative_background | true | vl-featured-0-341 |
| 0:308 | large_visual | decorative_background | true | vl-featured-0-308 |
| 0:309 | large_visual | decorative_background | true | vl-featured-0-309 |
| 0:307 | large_visual | decorative_background | true | vl-featured-0-307 |
| 0:305 | large_visual | decorative_background | true | vl-featured-0-305 |
| 0:306 | large_visual | decorative_background | true | vl-featured-0-306 |

## 覆盖率摘要

- sourceNodeCount: 66
- visibleNodeCount: 66
- unsupportedCount: 28
- unmappedCount: 0

### featured

- sourceNodeCount: 66
- visibleNodeCount: 66
- vector: total=40, rendered=9, ignoredSafe=3, unsupported=28, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=21, rendered=21, styleComplete=21
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 0:304
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:333
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:338
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:339
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:345
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:351
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:356
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:363
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:364
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:368

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
