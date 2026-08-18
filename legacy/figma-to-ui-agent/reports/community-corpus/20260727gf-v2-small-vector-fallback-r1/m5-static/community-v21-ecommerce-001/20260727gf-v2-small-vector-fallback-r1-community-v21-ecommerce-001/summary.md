# M5 静态生成报告

- runId: 20260727gf-v2-small-vector-fallback-r1-community-v21-ecommerce-001
- projectId: community-v21-ecommerce-001
- designBundleRevision: 1
- uiSpecRevision: 84
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### featured (/featured)

- viewportRole: mobile
- nodes: {"text":21,"input":0,"select":0,"button":0,"image":0,"pixelOverlay":13,"total":47}
- structuredCoverage: text=21, interactive=0
- componentFidelity: sourceComponentNodes=0, families={}, states={}
- visualLayerCoverage: candidate=25, rendered=25, unsupported=0

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

- diffPixels: 2856
- diffPixelRatio: 0.009379310344827587
- screenshots: runs/ms2ny3yf-f9beac2f3c6342d18f380aa39b0a8267/screenshots/000-d57a47154c16-expected.png, runs/ms2ny3yf-f9beac2f3c6342d18f380aa39b0a8267/screenshots/000-d57a47154c16-actual.png, runs/ms2ny3yf-f9beac2f3c6342d18f380aa39b0a8267/diffs/000-d57a47154c16-diff.png

##### canvasMapping

- artboard: 375x812
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: native_artboard

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 0.94% | 2856 | 0,0,375x812 |
| text_regions | 1.20% | 2677 | 24,65,327x684 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| dense_content | text_regions | 1.20% | 2677 | typography |
| dense_content | visual_assets | 0.94% | 2856 | asset_layering |
| mobile_canvas | - | 0.94% | 2856 | canvas_mapping |

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
| 0:304 | structural_visual | decorative_background | true | vl-featured-0-304 |
| 0:356 | structural_visual | decorative_background | true | vl-featured-0-356 |
| 0:368 | structural_visual | decorative_background | true | vl-featured-0-368 |
| 0:367 | structural_visual | decorative_background | true | vl-featured-0-367 |
| 0:345 | structural_visual | decorative_background | true | vl-featured-0-345 |
| 0:343 | structural_visual | decorative_background | true | vl-featured-0-343 |
| 0:361 | structural_visual | decorative_background | true | vl-featured-0-361 |
| 0:360 | structural_visual | decorative_background | true | vl-featured-0-360 |
| 0:333 | structural_visual | decorative_shape | true | vl-featured-0-333 |
| 0:331 | structural_visual | decorative_shape | true | vl-featured-0-331 |
| 0:335 | structural_visual | decorative_shape | true | vl-featured-0-335 |
| 0:338 | structural_visual | decorative_shape | true | vl-featured-0-338 |
| 0:336 | structural_visual | decorative_shape | true | vl-featured-0-336 |
| 0:337 | structural_visual | decorative_shape | true | vl-featured-0-337 |
| 0:339 | structural_visual | decorative_shape | true | vl-featured-0-339 |
| 0:364 | structural_visual | decorative_shape | true | vl-featured-0-364 |

## 覆盖率摘要

- sourceNodeCount: 66
- visibleNodeCount: 66
- unsupportedCount: 4
- unmappedCount: 0

### featured

- sourceNodeCount: 66
- visibleNodeCount: 66
- vector: total=40, rendered=36, ignoredSafe=0, unsupported=4, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=21, rendered=21, styleComplete=21
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":4}
- byKind: {"vector":4}

- 0:351 (vector, unsupported_renderer_limit, area=576): Rectangle
- 0:363 (vector, unsupported_renderer_limit, area=529): Rectangle
- 0:332 (vector, unsupported_renderer_limit, area=11): Path
- 0:334 (vector, unsupported_renderer_limit, area=11): Path 2


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 0:351
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:363

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
