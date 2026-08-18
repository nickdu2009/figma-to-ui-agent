# M5 静态生成报告

- runId: ms2g9v21-e016b97751bd4ce7
- projectId: community-v21-login-001
- designBundleRevision: 4
- uiSpecRevision: 未保存
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: promoted

## 页面摘要

### login-version-1 (/login-version-1)

- viewportRole: mobile
- nodes: {"text":14,"input":2,"button":3,"image":0,"pixelOverlay":16,"total":69}
- structuredCoverage: text=14, interactive=5
- visualLayerCoverage: candidate=21, rendered=21, unsupported=0

#### regions

- **left_visual**: passed
  - 检测到左侧视觉层
- **form_fields**: passed
  - 检测到表单输入域
- **cta**: not_applicable
  - 无明确 CTA
- **social_buttons**: passed
  - 检测到社交登录按钮
- **footer**: not_applicable
  - 无页脚文案
- **page**: passed
  - 页面包含可渲染节点

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 3:16684 | button_icon | button_icon | true | vl-login-version-1-3-16684 |
| I3:16736;3:6782 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6782 |
| I28:4029;3:6135 | button_icon | button_icon | true | vl-login-version-1-I28-4029-3-6135 |
| I3:16736;3:6770 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6770 |
| I3:16736;3:6784 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6784 |
| I3:16736;3:6776 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6776 |
| I3:5133;3:6015;4:78000 | button_icon | button_icon | true | vl-login-version-1-I3-5133-3-6015-4-78000 |
| I3:5134;3:6015;4:78000 | button_icon | button_icon | true | vl-login-version-1-I3-5134-3-6015-4-78000 |
| I28:4029;3:6136 | button_icon | button_icon | true | vl-login-version-1-I28-4029-3-6136 |
| I3:5137;3:6044;4:76017 | button_icon | button_icon | true | vl-login-version-1-I3-5137-3-6044-4-76017 |
| I3:5133;3:6013;4:78376 | button_icon | button_icon | true | vl-login-version-1-I3-5133-3-6013-4-78376 |
| I3:5134;3:6013;4:78376 | button_icon | button_icon | true | vl-login-version-1-I3-5134-3-6013-4-78376 |
| I28:4028;3:6131;136:158 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-158 |
| I28:4028;3:6131;136:156 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-156 |
| I3:16736;3:6777 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6777 |
| I28:4028;3:6131;136:155 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-155 |
| I28:4028;3:6131;136:157 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-157 |
| I3:16755;3:6790 | line_divider | line_or_divider | true | vl-login-version-1-I3-16755-3-6790 |
| 28:4024 | line_divider | line_or_divider | true | vl-login-version-1-28-4024 |
| 28:4026 | line_divider | line_or_divider | true | vl-login-version-1-28-4026 |
| 3:16683 | structural_visual | decorative_background | true | vl-login-version-1-3-16683 |

## 覆盖率摘要

- sourceNodeCount: 82
- visibleNodeCount: 77
- unsupportedCount: 2
- unmappedCount: 0

### login-version-1

- sourceNodeCount: 82
- visibleNodeCount: 77
- vector: total=29, rendered=27, ignoredSafe=0, unsupported=2, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=14, rendered=14, styleComplete=14
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":2}
- byKind: {"vector":2}

- I3:5137;3:6046;4:70831 (vector, unsupported_renderer_limit, area=63): Vector
- I3:16736;3:6783 (vector, unsupported_renderer_limit, area=5): Combined Shape


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: I3:16736;3:6783

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
