# M5 静态生成报告

- runId: 20260726-generator-fidelity-v1-local-community-v21-login-001
- projectId: community-v21-login-001
- designBundleRevision: 1
- uiSpecRevision: 4
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### login-version-1 (/login-version-1)

- viewportRole: mobile
- nodes: {"text":14,"input":0,"button":0,"image":0,"pixelOverlay":2,"total":50}
- structuredCoverage: text=14, interactive=0
- visualLayerCoverage: candidate=17, rendered=17, unsupported=0

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

- diffPixels: 36844
- diffPixelRatio: 0.1209983579638752
- screenshots: runs/ms17qcxf-93411ebf3a124355a549adfdacfccc2a/screenshots/000-fcb44a3d7f33-expected.png, runs/ms17qcxf-93411ebf3a124355a549adfdacfccc2a/screenshots/000-fcb44a3d7f33-actual.png, runs/ms17qcxf-93411ebf3a124355a549adfdacfccc2a/diffs/000-fcb44a3d7f33-diff.png

##### canvasMapping

- artboard: 375x812
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: native_artboard

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 15.74% | 24755 | 48,69,214x735 |
| text_regions | 14.93% | 36516 | 24,14,327x748 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| left_visual | visual_assets | 15.74% | 24755 | asset_layering |
| footer | text_regions | 14.93% | 36516 | typography |
| mobile_canvas | - | 12.10% | 36844 | canvas_mapping |

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
| 3:16683 | structural_visual | decorative_background | true | vl-login-version-1-3-16683 |

## 覆盖率摘要

- sourceNodeCount: 82
- visibleNodeCount: 77
- unsupportedCount: 6
- unmappedCount: 0

### login-version-1

- sourceNodeCount: 82
- visibleNodeCount: 77
- vector: total=29, rendered=23, ignoredSafe=0, unsupported=6, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=14, rendered=14, styleComplete=14
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":6}
- byKind: {"vector":6}

- I3:5137;3:6046;4:70831 (vector, unsupported_renderer_limit, area=63): Vector
- I28:4028;3:6131;136:155 (vector, unsupported_renderer_limit, area=57): vector
- I28:4028;3:6131;136:157 (vector, unsupported_renderer_limit, area=25): vector
- I3:16736;3:6783 (vector, unsupported_renderer_limit, area=5): Combined Shape
- 28:4024 (vector, unsupported_renderer_limit, area=0): Line
- 28:4026 (vector, unsupported_renderer_limit, area=0): Line


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 28:4024
- **unmapped_node_vector**: 未映射的节点类型 vector: 28:4026
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:155
- **unmapped_node_vector**: 未映射的节点类型 vector: I28:4028;3:6131;136:157
- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6783

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
