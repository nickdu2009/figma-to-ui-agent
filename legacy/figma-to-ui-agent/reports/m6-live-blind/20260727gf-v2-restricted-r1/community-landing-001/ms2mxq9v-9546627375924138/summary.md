# M5 受限 Live 生成报告

- runId: ms2mxq9v-9546627375924138
- projectId: m6-live-community-landing-001
- designBundleRevision: 1
- uiSpecRevision: 1
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required
- variablesMode: disabled_restricted_live
- apiBoundary: openai=false, figmaMe=false, variables=false

## 页面摘要

### home (/home)

- viewportRole: desktop
- nodes: {"text":13,"input":0,"select":0,"button":1,"image":0,"pixelOverlay":15,"total":121}
- structuredCoverage: text=13, interactive=1
- componentFidelity: sourceComponentNodes=23, families={"button":2,"icon":21}, states={"default":23}
- visualLayerCoverage: candidate=15, rendered=15, unsupported=0

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

- diffPixels: 66396
- diffPixelRatio: 0.035881971465629055
- screenshots: runs/ms2mxqaa-fec96fe215e64eacb82e824cc8ff36a5/screenshots/000-f96ca2270afe-expected.png, runs/ms2mxqaa-fec96fe215e64eacb82e824cc8ff36a5/screenshots/000-f96ca2270afe-actual.png, runs/ms2mxqaa-fec96fe215e64eacb82e824cc8ff36a5/diffs/000-f96ca2270afe-diff.png

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


## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 211:829
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:830
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:831
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:832
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:833
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:834
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:835
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:836
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:837
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:838
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:839
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:840
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:841
- **unmapped_node_vector**: 未映射的节点类型 vector: 211:842
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
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:1006
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:1007
- **unmapped_node_vector**: 未映射的节点类型 vector: 14:1008

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
