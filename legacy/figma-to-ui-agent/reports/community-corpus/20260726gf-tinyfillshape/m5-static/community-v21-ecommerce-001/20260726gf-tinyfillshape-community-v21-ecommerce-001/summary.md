# M5 静态生成报告

- runId: 20260726gf-tinyfillshape-community-v21-ecommerce-001
- projectId: community-v21-ecommerce-001
- designBundleRevision: 1
- uiSpecRevision: 58
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### featured (/featured)

- viewportRole: mobile
- nodes: {"text":21,"input":0,"button":0,"image":0,"pixelOverlay":13,"total":39}
- structuredCoverage: text=21, interactive=0
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

- diffPixels: 6159
- diffPixelRatio: 0.020226600985221676
- screenshots: runs/ms1fl2cj-adf8b20f8ed247b7bfb64b79ba4500eb/screenshots/000-d57a47154c16-expected.png, runs/ms1fl2cj-adf8b20f8ed247b7bfb64b79ba4500eb/screenshots/000-d57a47154c16-actual.png, runs/ms1fl2cj-adf8b20f8ed247b7bfb64b79ba4500eb/diffs/000-d57a47154c16-diff.png

##### canvasMapping

- artboard: 375x812
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: native_artboard

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 2.02% | 6159 | 0,0,375x812 |
| text_regions | 2.67% | 5971 | 24,65,327x684 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| footer | text_regions | 2.67% | 5971 | typography |
| left_visual | visual_assets | 2.02% | 6159 | asset_layering |
| mobile_canvas | - | 2.02% | 6159 | canvas_mapping |

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

## 覆盖率摘要

- sourceNodeCount: 66
- visibleNodeCount: 66
- unsupportedCount: 12
- unmappedCount: 0

### featured

- sourceNodeCount: 66
- visibleNodeCount: 66
- vector: total=40, rendered=28, ignoredSafe=0, unsupported=12, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=21, rendered=21, styleComplete=21
- budgetExceeded: 0
- pageSize: 375x812 / 375x812 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":12}
- byKind: {"vector":12}

- 0:351 (vector, unsupported_renderer_limit, area=576): Rectangle
- 0:363 (vector, unsupported_renderer_limit, area=529): Rectangle
- 0:338 (vector, unsupported_renderer_limit, area=145): filter-alternative
- 0:337 (vector, unsupported_renderer_limit, area=145): Path
- 0:364 (vector, unsupported_renderer_limit, area=144): Oval
- 0:333 (vector, unsupported_renderer_limit, area=111): Combined Shape
- 0:336 (vector, unsupported_renderer_limit, area=87): Path
- 0:339 (vector, unsupported_renderer_limit, area=36): bottom
- 0:331 (vector, unsupported_renderer_limit, area=17): Path
- 0:335 (vector, unsupported_renderer_limit, area=17): Path 3


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 0:333
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:338
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:339
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:351
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:363
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:364

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
