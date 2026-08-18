# M5 静态生成报告

- runId: 20260727-residual-extended-smoke-r1-blind-case-a2-r8
- projectId: blind-case-a2-r8
- designBundleRevision: 1
- uiSpecRevision: 3
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### login-version-1 (/login-version-1)

- viewportRole: mobile
- nodes: {"text":14,"input":2,"select":0,"button":3,"image":0,"pixelOverlay":0,"total":71}
- structuredCoverage: text=14, interactive=5
- componentFidelity: sourceComponentNodes=19, families={"icon":3,"input":6,"button":7,"unknown":3}, states={"default":19}
- visualLayerCoverage: candidate=22, rendered=21, unsupported=1

#### regions

- **left_visual**: not_applicable
  - 无左侧视觉层
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

### sign-up-version-1 (/sign-up-version-1)

- viewportRole: mobile
- nodes: {"text":16,"input":5,"select":0,"button":1,"image":0,"pixelOverlay":0,"total":81}
- structuredCoverage: text=16, interactive=6
- componentFidelity: sourceComponentNodes=26, families={"icon":3,"input":14,"unknown":7,"button":2}, states={"default":26}
- visualLayerCoverage: candidate=23, rendered=22, unsupported=1

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

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 3:16684 | button_icon | button_icon | true | vl-login-version-1-3-16684 |
| I3:16736;3:6781 | button_icon | icon | true | vl-login-version-1-I3-16736-3-6781 |
| I28:4029;3:6135 | button_icon | button_icon | false | - |
| I3:16736;3:6770 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6770 |
| I3:16736;3:6781 | button_icon | icon | true | vl-login-version-1-I3-16736-3-6781 |
| I3:16736;3:6776 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6776 |
| I3:5133;3:6015;4:78000 | button_icon | button_icon | true | vl-login-version-1-I3-5133-3-6015-4-78000 |
| I3:5134;3:6015;4:78000 | button_icon | button_icon | true | vl-login-version-1-I3-5134-3-6015-4-78000 |
| I28:4029;3:6136 | button_icon | button_icon | true | vl-login-version-1-I28-4029-3-6136 |
| I3:5137;3:6044 | button_icon | icon | true | vl-login-version-1-I3-5137-3-6044 |
| I3:5133;3:6013 | button_icon | icon | true | vl-login-version-1-I3-5133-3-6013 |
| I3:5134;3:6013 | button_icon | icon | true | vl-login-version-1-I3-5134-3-6013 |
| I28:4028;3:6131;136:158 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-158 |
| I28:4028;3:6131;136:156 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-156 |
| I3:16736;3:6777 | button_icon | button_icon | true | vl-login-version-1-I3-16736-3-6777 |
| I28:4028;3:6131;136:155 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-155 |
| I28:4028;3:6131;136:157 | button_icon | button_icon | true | vl-login-version-1-I28-4028-3-6131-136-157 |
| I3:16755;3:6790 | line_divider | line_or_divider | true | vl-login-version-1-I3-16755-3-6790 |
| 28:4024 | line_divider | line_or_divider | true | vl-login-version-1-28-4024 |
| 28:4026 | line_divider | line_or_divider | true | vl-login-version-1-28-4026 |
| 3:16683 | structural_visual | decorative_background | true | vl-login-version-1-3-16683 |
| I3:5137;3:6046 | nav_icon | icon | true | vl-login-version-1-I3-5137-3-6046 |
| I37:855;3:6781 | button_icon | icon | true | vl-sign-up-version-1-I37-855-3-6781 |
| I42:1129;3:6100;3:7038;623:87453 | button_icon | button_icon | true | vl-sign-up-version-1-I42-1129-3-6100-3-7038-623-87453 |
| I42:1129;3:6100;3:7041;623:87495 | button_icon | button_icon | true | vl-sign-up-version-1-I42-1129-3-6100-3-7041-623-87495 |
| I42:1129;3:6100;3:7038;623:87455 | button_icon | button_icon | true | vl-sign-up-version-1-I42-1129-3-6100-3-7038-623-87455 |
| I37:855;3:6770 | button_icon | button_icon | true | vl-sign-up-version-1-I37-855-3-6770 |
| I37:855;3:6781 | button_icon | icon | true | vl-sign-up-version-1-I37-855-3-6781 |
| I37:855;3:6776 | button_icon | button_icon | true | vl-sign-up-version-1-I37-855-3-6776 |
| I37:839;3:6015;4:78000 | button_icon | button_icon | true | vl-sign-up-version-1-I37-839-3-6015-4-78000 |
| I42:1255;3:6015;4:78000 | button_icon | button_icon | true | vl-sign-up-version-1-I42-1255-3-6015-4-78000 |
| I42:1129;3:6101;1715:49005 | button_icon | button_icon | false | - |
| I37:840;3:6015;4:78000 | button_icon | button_icon | true | vl-sign-up-version-1-I37-840-3-6015-4-78000 |
| I42:1757;3:6015 | button_icon | icon | true | vl-sign-up-version-1-I42-1757-3-6015 |
| 37:2547 | button_icon | icon | true | vl-sign-up-version-1-37-2547 |
| I37:843;3:6044 | button_icon | icon | true | vl-sign-up-version-1-I37-843-3-6044 |
| I37:839;3:6013 | button_icon | icon | true | vl-sign-up-version-1-I37-839-3-6013 |
| I42:1255;3:6013 | button_icon | icon | true | vl-sign-up-version-1-I42-1255-3-6013 |
| I42:1757;3:6013 | button_icon | icon | true | vl-sign-up-version-1-I42-1757-3-6013 |
| I37:840;3:6013 | button_icon | icon | true | vl-sign-up-version-1-I37-840-3-6013 |
| I42:1129;3:6100;3:7039;623:87474 | button_icon | button_icon | true | vl-sign-up-version-1-I42-1129-3-6100-3-7039-623-87474 |
| I37:855;3:6777 | button_icon | button_icon | true | vl-sign-up-version-1-I37-855-3-6777 |
| I37:856;3:6790 | line_divider | line_or_divider | true | vl-sign-up-version-1-I37-856-3-6790 |
| I42:1129;3:6101;1715:49003 | nav_icon | icon | true | vl-sign-up-version-1-I42-1129-3-6101-1715-49003 |
| I37:843;3:6046 | nav_icon | icon | true | vl-sign-up-version-1-I37-843-3-6046 |

## 覆盖率摘要

- sourceNodeCount: 191
- visibleNodeCount: 176
- unsupportedCount: 27
- unmappedCount: 0

### login-version-1

- sourceNodeCount: 82
- visibleNodeCount: 77
- vector: total=29, rendered=21, ignoredSafe=0, unsupported=8, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=14, rendered=14, styleComplete=14
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true

### sign-up-version-1

- sourceNodeCount: 109
- visibleNodeCount: 99
- vector: total=37, rendered=17, ignoredSafe=1, unsupported=19, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=16, rendered=16, styleComplete=16
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":25,"unsupported_missing_asset":2}
- byKind: {"vector":27}

- I3:16736;3:6782 (vector, unsupported_renderer_limit, area=325): Rectangle
- I37:855;3:6782 (vector, unsupported_renderer_limit, area=325): Rectangle
- I28:4029;3:6135 (vector, unsupported_missing_asset, area=322): Vector
- I3:16736;3:6784 (vector, unsupported_renderer_limit, area=168): Rectangle
- I37:855;3:6784 (vector, unsupported_renderer_limit, area=168): Rectangle
- I42:1129;3:6101;1715:49005 (vector, unsupported_missing_asset, area=144): Vector
- I42:1757;3:6015;3:14914 (vector, unsupported_renderer_limit, area=128): Vector
- I37:2547;4:70829 (vector, unsupported_renderer_limit, area=112): Vector
- I3:5137;3:6044;4:76017 (vector, unsupported_renderer_limit, area=110): Vector
- I37:843;3:6044;4:76017 (vector, unsupported_renderer_limit, area=110): Vector


## unsupportedFeatures

- **visual_layer_no_asset** (fallback_ok): defer
- **visual_layer_no_asset** (fallback_ok): defer

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
