# M5 静态生成报告

- runId: 20260726-generator-fidelity-v1-t03t05-community-v21-login-001
- projectId: community-v21-login-001
- designBundleRevision: 1
- uiSpecRevision: 6
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### login-version-1 (/login-version-1)

- viewportRole: mobile
- nodes: {"text":1,"input":1,"button":1,"image":0,"pixelOverlay":1,"total":13}
- structuredCoverage: text=1, interactive=2
- visualLayerCoverage: candidate=17, rendered=17, unsupported=0

#### regions

- **left_visual**: not_applicable
  - 无左侧视觉层
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

#### comparison

- diffPixels: 39949
- diffPixelRatio: 0.13119540229885057
- screenshots: runs/ms1881wf-bbbf2efd48e44b6182c058cd7595661b/screenshots/000-fcb44a3d7f33-expected.png, runs/ms1881wf-bbbf2efd48e44b6182c058cd7595661b/screenshots/000-fcb44a3d7f33-actual.png, runs/ms1881wf-bbbf2efd48e44b6182c058cd7595661b/diffs/000-fcb44a3d7f33-diff.png

##### canvasMapping

- artboard: 375x812
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: native_artboard

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 0.00% | 0 | 114,799,148x5 |
| text_regions | 46.97% | 248 | 30,14,33x16 |
| form_controls | 16.56% | 33799 | 24,68,327x624 |
| button_icon_controls | 96.06% | 5340 | 24,745,327x17 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| cta | button_icon_controls | 96.06% | 5340 | asset_layering, renderer_reset |
| social_buttons | button_icon_controls | 96.06% | 5340 | asset_layering, renderer_reset |
| footer | text_regions | 46.97% | 248 | typography |
| form_fields | form_controls | 16.56% | 33799 | typography, renderer_reset |
| mobile_canvas | - | 13.12% | 39949 | canvas_mapping |

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

- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6783

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
