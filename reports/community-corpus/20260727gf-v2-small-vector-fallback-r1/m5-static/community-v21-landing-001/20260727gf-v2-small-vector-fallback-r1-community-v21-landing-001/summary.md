# M5 静态生成报告

- runId: 20260727gf-v2-small-vector-fallback-r1-community-v21-landing-001
- projectId: community-v21-landing-001
- designBundleRevision: 1
- uiSpecRevision: 66
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### home (/home)

- viewportRole: desktop
- nodes: {"text":13,"input":0,"select":0,"button":1,"image":0,"pixelOverlay":15,"total":134}
- structuredCoverage: text=13, interactive=1
- componentFidelity: sourceComponentNodes=23, families={"button":2,"icon":21}, states={"default":23}
- visualLayerCoverage: candidate=28, rendered=28, unsupported=0

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

- diffPixels: 66627
- diffPixelRatio: 0.0360068093385214
- screenshots: runs/ms2ny5nu-7f37664562d24930800440215e4cac51/screenshots/000-f96ca2270afe-expected.png, runs/ms2ny5nu-7f37664562d24930800440215e4cac51/screenshots/000-f96ca2270afe-actual.png, runs/ms2ny5nu-7f37664562d24930800440215e4cac51/diffs/000-f96ca2270afe-diff.png

##### canvasMapping

- artboard: 1440x1285
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 3.79% | 43606 | 148,96,1153x999 |
| text_regions | 4.20% | 66596 | 0,161,1440x1100 |
| button_icon_controls | 12.00% | 814 | 144,385,128x53 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| cta | button_icon_controls | 12.00% | 814 | asset_layering, renderer_reset |
| dense_content | text_regions | 4.20% | 66596 | typography |
| dense_content | visual_assets | 3.79% | 43606 | asset_layering |
| dense_content | - | 3.60% | 66627 | renderer_reset |

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
| 211:833 | structural_visual | decorative_shape | true | vl-home-211-833 |
| 211:834 | structural_visual | decorative_shape | true | vl-home-211-834 |
| 211:835 | structural_visual | decorative_shape | true | vl-home-211-835 |
| 211:836 | structural_visual | decorative_shape | true | vl-home-211-836 |
| 211:837 | structural_visual | decorative_shape | true | vl-home-211-837 |
| 211:838 | structural_visual | decorative_shape | true | vl-home-211-838 |
| 211:839 | structural_visual | decorative_shape | true | vl-home-211-839 |
| 211:840 | structural_visual | decorative_shape | true | vl-home-211-840 |
| 211:841 | structural_visual | decorative_shape | true | vl-home-211-841 |
| 211:842 | structural_visual | decorative_shape | true | vl-home-211-842 |
| 14:1006 | structural_visual | decorative_shape | true | vl-home-14-1006 |
| 14:1007 | structural_visual | decorative_shape | true | vl-home-14-1007 |
| 14:1008 | structural_visual | decorative_shape | true | vl-home-14-1008 |

## 覆盖率摘要

- sourceNodeCount: 396
- visibleNodeCount: 396
- unsupportedCount: 20
- unmappedCount: 0

### home

- sourceNodeCount: 396
- visibleNodeCount: 396
- vector: total=291, rendered=271, ignoredSafe=0, unsupported=20, unmapped=0
- imageFill: total=0, rendered=0, missingAsset=0
- text: total=13, rendered=13, styleComplete=13
- budgetExceeded: 0
- pageSize: 1440x1291 / 1440x1285 (full_page)
- widthMatched: true
- heightMatched: false

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":20}
- byKind: {"vector":20}

- 211:832 (vector, unsupported_renderer_limit, area=9): Vector
- 211:830 (vector, unsupported_renderer_limit, area=8): Vector
- 211:829 (vector, unsupported_renderer_limit, area=6): Vector
- 211:831 (vector, unsupported_renderer_limit, area=6): Vector
- 211:845 (vector, unsupported_renderer_limit, area=4): Vector
- 14:975 (vector, unsupported_renderer_limit, area=2): Vector
- 14:961 (vector, unsupported_renderer_limit, area=2): Vector
- 14:963 (vector, unsupported_renderer_limit, area=2): Vector
- 14:970 (vector, unsupported_renderer_limit, area=2): Vector
- 14:972 (vector, unsupported_renderer_limit, area=2): Vector


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 211:829
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:830
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:831
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:832
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:845
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:961
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:962
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:963
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:964
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:965
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:966
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:967
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:968
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:969
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:970
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:971
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:972
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:973
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:974
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:975

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
