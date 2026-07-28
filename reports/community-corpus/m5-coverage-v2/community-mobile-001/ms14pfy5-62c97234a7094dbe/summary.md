# M5 受限 Live 生成报告

- runId: ms14pfy5-62c97234a7094dbe
- projectId: community-v2-mobile-001
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required
- variablesMode: disabled_restricted_live
- apiBoundary: openai=false, figmaMe=false, variables=false

## 页面摘要

### 6-11---a---profile (/6-11---a---profile)

- viewportRole: tablet
- nodes: {"text":24,"input":0,"button":0,"image":1,"pixelOverlay":5,"total":43}
- structuredCoverage: text=24, interactive=0
- visualLayerCoverage: candidate=5, rendered=5, unsupported=0

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
| I3186:4557;3096:2590;3071:2441 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2590-3071-2441 |
| I3186:4557;3189:4744;3189:4296 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3189-4744-3189-4296 |
| I3186:4557;3096:2594;3071:2439 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2594-3071-2439 |
| I3186:4557;3096:2596;3071:2445 | nav_icon | icon | true | vl-6-11---a---profile-I3186-4557-3096-2596-3071-2445 |
| 3186:4547 | large_visual | decorative_background | true | vl-6-11---a---profile-3186-4547 |

## 覆盖率摘要

- sourceNodeCount: 61
- visibleNodeCount: 61
- unsupportedCount: 18
- unmappedCount: 0

### 6-11---a---profile

- sourceNodeCount: 61
- visibleNodeCount: 61
- vector: total=23, rendered=5, ignoredSafe=0, unsupported=18, unmapped=0
- imageFill: total=1, rendered=1, missingAsset=0
- text: total=24, rendered=24, styleComplete=24
- budgetExceeded: 0
- pageSize: 393x1029 / 393x1029 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":18}
- byKind: {"vector":18}

- I3186:4557;3096:2568 (vector, unsupported_renderer_limit, area=23187): Rectangle 10
- 3250:4634 (vector, unsupported_renderer_limit, area=19380): Rectangle 186
- 3186:4649 (vector, unsupported_renderer_limit, area=14490): Rectangle 38
- 3186:4688 (vector, unsupported_renderer_limit, area=14490): Rectangle 187
- 3186:4749 (vector, unsupported_renderer_limit, area=14490): Rectangle 188
- 3186:4652 (vector, unsupported_renderer_limit, area=14490): Rectangle 135
- 3186:4656 (vector, unsupported_renderer_limit, area=14445): Rectangle 41
- 3186:4659 (vector, unsupported_renderer_limit, area=14445): Rectangle 37
- I3202:4758;2069:1252 (vector, unsupported_renderer_limit, area=729): Ellipse 12
- I3202:4758;2069:1253 (vector, unsupported_renderer_limit, area=213): Vector


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I3202:4758;2069:1252
- **unmapped_node_vector**: 未映射的节点类型 vector: I3202:4758;2069:1253
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4552
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4553
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4555
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4556
- **unmapped_node_vector**: 未映射的节点类型 vector: I3186:4557;3096:2566
- **unmapped_node_vector**: 未映射的节点类型 vector: I3186:4557;3096:2568
- **unmapped_node_vector**: 未映射的节点类型 vector: I3186:4559;3096:2694
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4649
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4688
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4749
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4652
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4656
- **unmapped_node_vector**: 未映射的节点类型 vector: 3186:4659
- **unmapped_node_vector**: 未映射的节点类型 vector: 3250:4634
- **unmapped_node_vector**: 未映射的节点类型 vector: 3250:4638
- **unmapped_node_vector**: 未映射的节点类型 vector: 3250:4639

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
