# M5 静态生成报告

- runId: 20260727-residual-fixes-r5-community-v21-landing-001
- projectId: community-v21-landing-001
- designBundleRevision: 1
- uiSpecRevision: 74
- status: passed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### home (/home)

- viewportRole: desktop
- nodes: {"text":13,"input":0,"select":0,"button":1,"image":0,"pixelOverlay":15,"total":123}
- structuredCoverage: text=13, interactive=1
- componentFidelity: sourceComponentNodes=23, families={"button":2,"icon":21}, states={"default":23}
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

- diffPixels: 67277
- diffPixelRatio: 0.03635808473843493
- screenshots: runs/ms2ro88k-7565d432d98d49eeaf93bcd4543ea05d/screenshots/000-f96ca2270afe-expected.png, runs/ms2ro88k-7565d432d98d49eeaf93bcd4543ea05d/screenshots/000-f96ca2270afe-actual.png, runs/ms2ro88k-7565d432d98d49eeaf93bcd4543ea05d/diffs/000-f96ca2270afe-diff.png

##### canvasMapping

- artboard: 1440x1285
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 3.84% | 44256 | 148,96,1153x999 |
| text_regions | 4.25% | 67246 | 0,161,1440x1100 |
| button_icon_controls | 2.75% | 19647 | 144,385,1018x702 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| dense_content | text_regions | 4.25% | 67246 | typography |
| dense_content | visual_assets | 3.84% | 44256 | asset_layering |
| dense_content | - | 3.64% | 67277 | renderer_reset |
| cta | button_icon_controls | 2.75% | 19647 | asset_layering, renderer_reset |

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 10:917 | named_visual | decorative_shape | true | vl-home-10-917 |
| 12:633 | structural_visual | decorative_background | true | vl-home-12-633 |
| 14:958 | structural_visual | decorative_background | true | vl-home-14-958 |
| 14:1003 | structural_visual | decorative_background | true | vl-home-14-1003 |
| 211:825 | structural_visual | decorative_background | true | vl-home-211-825 |
| 211:853 | structural_visual | decorative_background | true | vl-home-211-853 |
| 211:819 | structural_visual | decorative_background | true | vl-home-211-819 |
| 13:637 | structural_visual | decorative_background | true | vl-home-13-637 |
| 211:822 | structural_visual | decorative_background | true | vl-home-211-822 |
| 211:846 | structural_visual | decorative_background | true | vl-home-211-846 |
| 14:976 | structural_visual | decorative_background | true | vl-home-14-976 |
| 211:826 | structural_visual | decorative_background | true | vl-home-211-826 |
| 211:854 | structural_visual | decorative_background | true | vl-home-211-854 |
| 211:849 | structural_visual | decorative_background | true | vl-home-211-849 |
| 211:850 | structural_visual | decorative_background | true | vl-home-211-850 |
| 14:959 | nav_icon | icon | true | vl-home-14-959 |
| 14:1004 | nav_icon | icon | true | vl-home-14-1004 |

## 覆盖率摘要

- sourceNodeCount: 396
- visibleNodeCount: 396
- unsupportedCount: 33
- unmappedCount: 0

### home

- sourceNodeCount: 396
- visibleNodeCount: 396
- vector: total=291, rendered=258, ignoredSafe=0, unsupported=33, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=13, rendered=13, styleComplete=13
- budgetExceeded: 0
- pageSize: 1440x1291 / 1440x1285 (full_page)
- widthMatched: true
- heightMatched: false

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":33}
- byKind: {"vector":33}

- 14:1006 (vector, unsupported_renderer_limit, area=214): Vector
- 14:1008 (vector, unsupported_renderer_limit, area=207): Vector
- 14:1007 (vector, unsupported_renderer_limit, area=207): Vector
- 211:842 (vector, unsupported_renderer_limit, area=113): Vector
- 211:833 (vector, unsupported_renderer_limit, area=108): Vector
- 211:835 (vector, unsupported_renderer_limit, area=107): Vector
- 211:836 (vector, unsupported_renderer_limit, area=101): Vector
- 211:834 (vector, unsupported_renderer_limit, area=101): Vector
- 211:839 (vector, unsupported_renderer_limit, area=76): Vector
- 211:840 (vector, unsupported_renderer_limit, area=66): Vector


## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
