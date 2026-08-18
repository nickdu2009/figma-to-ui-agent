# M5 静态生成报告

- runId: m5-blind-a-20260725-193950
- projectId: blind-case-a-r8
- designBundleRevision: 1
- uiSpecRevision: 4
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

### login-version-1 (/login-version-1)

- viewportRole: mobile
- nodes: {"text":14,"input":0,"button":0,"image":0,"pixelOverlay":0,"total":48}
- structuredCoverage: text=14, interactive=0
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

#### comparison

- diffPixels: 178180
- diffPixelRatio: 0.14628899835796388
- screenshots: runs/ms0arev3-dc603f2ce3a34a588e597af461b08807/screenshots/001-2a081ee3e777-expected.png, runs/ms0arev3-dc603f2ce3a34a588e597af461b08807/screenshots/001-2a081ee3e777-actual.png, runs/ms0arev3-dc603f2ce3a34a588e597af461b08807/diffs/001-2a081ee3e777-diff.png

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 3:16684
- **unmapped_node_vector**: 未映射的节点类型 vector: 3:16683
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:5134;3:6015;4:78000
- **unmapped_node_vector**: 未映射的节点类型 vector: 28:4024
- **unmapped_node_vector**: 未映射的节点类型 vector: 28:4026
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:155
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:156
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:157
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:158
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4029;3:6135
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4029;3:6136
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6770
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6776
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6782
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6783
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6784
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16755;3:6790

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
