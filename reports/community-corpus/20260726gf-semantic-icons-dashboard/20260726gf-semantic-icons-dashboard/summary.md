# M5 静态生成报告

- runId: 20260726gf-semantic-icons-dashboard
- projectId: community-v21-dashboard-001
- designBundleRevision: 1
- uiSpecRevision: 60
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### light---dashboard---1 (/light---dashboard---1)

- viewportRole: desktop
- nodes: {"text":137,"input":0,"button":0,"image":4,"pixelOverlay":96,"total":353}
- structuredCoverage: text=137, interactive=0
- visualLayerCoverage: candidate=160, rendered=159, unsupported=47

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

- diffPixels: 128235
- diffPixelRatio: 0.08696492513020833
- screenshots: runs/ms1jptk2-8ad929f7b44a496a9be5adebba1bee2b/screenshots/000-72e60729bf19-expected.png, runs/ms1jptk2-8ad929f7b44a496a9be5adebba1bee2b/screenshots/000-72e60729bf19-actual.png, runs/ms1jptk2-8ad929f7b44a496a9be5adebba1bee2b/diffs/000-72e60729bf19-diff.png

##### canvasMapping

- artboard: 1440x1024
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 8.70% | 128235 | 0,0,1440x1024 |
| text_regions | 9.44% | 126768 | 29,30,1381x972 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| footer | text_regions | 9.44% | 126768 | typography |
| left_visual | visual_assets | 8.70% | 128235 | asset_layering |
| dense_content | - | 8.70% | 128235 | renderer_reset |

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 0:8 | nav_icon | icon | true | vl-light---dashboard---1-0-8 |
| 0:69 | nav_icon | icon | true | vl-light---dashboard---1-0-69 |
| 0:68 | nav_icon | icon | true | vl-light---dashboard---1-0-68 |
| 0:55 | nav_icon | icon | true | vl-light---dashboard---1-0-55 |
| 0:22 | nav_icon | icon | true | vl-light---dashboard---1-0-22 |
| 0:24 | nav_icon | icon | true | vl-light---dashboard---1-0-24 |
| 0:54 | nav_icon | icon | true | vl-light---dashboard---1-0-54 |
| 0:53 | nav_icon | icon | true | vl-light---dashboard---1-0-53 |
| 0:40 | nav_icon | icon | true | vl-light---dashboard---1-0-40 |
| 0:41 | nav_icon | icon | true | vl-light---dashboard---1-0-41 |
| 0:45 | nav_icon | icon | true | vl-light---dashboard---1-0-45 |
| 0:46 | nav_icon | icon | true | vl-light---dashboard---1-0-46 |
| 0:31 | nav_icon | icon | true | vl-light---dashboard---1-0-31 |
| 0:33 | nav_icon | icon | true | vl-light---dashboard---1-0-33 |
| 0:250 | nav_icon | icon | true | vl-light---dashboard---1-0-250 |
| 0:23 | nav_icon | icon | true | vl-light---dashboard---1-0-23 |
| 0:349 | nav_icon | icon | true | vl-light---dashboard---1-0-349 |
| 0:352 | nav_icon | icon | true | vl-light---dashboard---1-0-352 |
| 0:354 | nav_icon | icon | true | vl-light---dashboard---1-0-354 |
| 0:277 | nav_icon | icon | true | vl-light---dashboard---1-0-277 |
| 0:280 | nav_icon | icon | true | vl-light---dashboard---1-0-280 |
| 0:281 | nav_icon | icon | true | vl-light---dashboard---1-0-281 |
| 0:311 | nav_icon | icon | true | vl-light---dashboard---1-0-311 |
| 0:314 | nav_icon | icon | true | vl-light---dashboard---1-0-314 |
| 0:313 | nav_icon | icon | true | vl-light---dashboard---1-0-313 |
| 0:331 | nav_icon | icon | true | vl-light---dashboard---1-0-331 |
| 0:334 | nav_icon | icon | true | vl-light---dashboard---1-0-334 |
| 0:333 | nav_icon | icon | true | vl-light---dashboard---1-0-333 |
| 0:293 | nav_icon | icon | true | vl-light---dashboard---1-0-293 |
| 0:296 | nav_icon | icon | true | vl-light---dashboard---1-0-296 |
| 0:298 | nav_icon | icon | true | vl-light---dashboard---1-0-298 |
| 0:38 | nav_icon | icon | true | vl-light---dashboard---1-0-38 |
| 0:39 | nav_icon | icon | true | vl-light---dashboard---1-0-39 |
| 0:253 | nav_icon | icon | true | vl-light---dashboard---1-0-253 |
| 0:254 | nav_icon | icon | true | vl-light---dashboard---1-0-254 |
| 0:257 | nav_icon | icon | true | vl-light---dashboard---1-0-257 |
| 0:258 | nav_icon | icon | true | vl-light---dashboard---1-0-258 |
| 0:332 | nav_icon | icon | true | vl-light---dashboard---1-0-332 |
| 0:30 | nav_icon | icon | true | vl-light---dashboard---1-0-30 |
| 0:312 | nav_icon | icon | true | vl-light---dashboard---1-0-312 |
| 0:29 | nav_icon | icon | true | vl-light---dashboard---1-0-29 |
| 0:10 | nav_icon | icon | true | vl-light---dashboard---1-0-10 |
| 0:351 | nav_icon | icon | true | vl-light---dashboard---1-0-351 |
| 0:52 | nav_icon | icon | true | vl-light---dashboard---1-0-52 |
| 0:64 | nav_icon | icon | true | vl-light---dashboard---1-0-64 |
| 0:63 | nav_icon | icon | true | vl-light---dashboard---1-0-63 |
| 0:43 | nav_icon | icon | true | vl-light---dashboard---1-0-43 |
| 0:72 | nav_icon | icon | true | vl-light---dashboard---1-0-72 |
| 0:294 | nav_icon | icon | true | vl-light---dashboard---1-0-294 |
| 0:237 | nav_icon | icon | true | vl-light---dashboard---1-0-237 |
| 0:61 | nav_icon | icon | true | vl-light---dashboard---1-0-61 |
| 0:60 | nav_icon | icon | true | vl-light---dashboard---1-0-60 |
| 0:209 | nav_icon | icon | true | vl-light---dashboard---1-0-209 |
| 0:337 | nav_icon | icon | true | vl-light---dashboard---1-0-337 |
| 0:336 | nav_icon | icon | true | vl-light---dashboard---1-0-336 |
| 0:251 | nav_icon | icon | true | vl-light---dashboard---1-0-251 |
| 0:255 | nav_icon | icon | true | vl-light---dashboard---1-0-255 |
| 0:350 | nav_icon | icon | true | vl-light---dashboard---1-0-350 |
| 0:213 | nav_icon | icon | true | vl-light---dashboard---1-0-213 |
| 0:78 | nav_icon | icon | true | vl-light---dashboard---1-0-78 |
| 0:141 | nav_icon | icon | true | vl-light---dashboard---1-0-141 |
| 0:214 | nav_icon | icon | true | vl-light---dashboard---1-0-214 |
| 0:364 | nav_icon | icon | true | vl-light---dashboard---1-0-364 |
| 0:455 | nav_icon | icon | true | vl-light---dashboard---1-0-455 |
| 0:65 | nav_icon | icon | true | vl-light---dashboard---1-0-65 |
| 0:58 | nav_icon | icon | true | vl-light---dashboard---1-0-58 |
| 0:57 | nav_icon | icon | true | vl-light---dashboard---1-0-57 |
| 0:252 | nav_icon | icon | true | vl-light---dashboard---1-0-252 |
| 0:256 | nav_icon | icon | true | vl-light---dashboard---1-0-256 |
| 0:101 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-101 |
| 0:99 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-99 |
| 0:159 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-159 |
| 0:105 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-105 |
| 0:103 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-103 |
| 0:158 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-158 |
| 0:177 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-177 |
| 0:196 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-196 |
| 0:115 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-115 |
| 0:113 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-113 |
| 0:178 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-178 |
| 0:110 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-110 |
| 0:108 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-108 |
| 0:230 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-230 |
| 0:231 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-231 |
| 0:232 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-232 |
| 0:233 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-233 |
| 0:234 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-234 |
| 0:197 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-197 |
| 0:95 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-95 |
| 0:96 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-96 |
| 0:137 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-137 |
| 0:138 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-138 |
| 0:460 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-460 |
| 0:264 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-264 |
| 0:478 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-478 |
| 0:473 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-473 |
| 0:466 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-466 |
| 0:488 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-488 |
| 0:462 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-462 |
| 0:472 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-472 |
| 0:476 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-476 |
| 0:485 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-485 |
| 0:493 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-493 |
| 0:487 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-487 |
| 0:459 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-459 |
| 0:475 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-475 |
| 0:481 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-481 |
| 0:492 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-492 |
| 0:484 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-484 |
| 0:491 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-491 |
| 0:465 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-465 |
| 0:467 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-467 |
| 0:489 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-489 |
| 0:479 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-479 |
| 0:471 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-471 |
| 0:486 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-486 |
| 0:494 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-494 |
| 0:474 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-474 |
| 0:477 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-477 |
| 0:490 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-490 |
| 0:468 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-468 |
| 0:463 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-463 |
| 0:482 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-482 |
| 0:90 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-90 |
| 0:91 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-91 |
| 0:92 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-92 |
| 0:93 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-93 |
| 0:94 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-94 |
| 0:469 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-469 |
| 0:483 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-483 |
| 0:464 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-464 |
| 0:470 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-470 |
| 0:480 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-480 |
| 0:44 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-44 |
| 0:62 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-62 |
| 0:14 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-14 |
| 0:15 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-15 |
| 0:16 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-16 |
| 0:17 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-17 |
| 0:18 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-18 |
| 0:4 | large_visual | decorative_background | true | vl-light---dashboard---1-0-4 |
| 0:204 | large_visual | decorative_background | true | vl-light---dashboard---1-0-204 |
| 0:262 | large_visual | decorative_background | true | vl-light---dashboard---1-0-262 |
| 0:135 | large_visual | decorative_background | true | vl-light---dashboard---1-0-135 |
| 0:75 | large_visual | decorative_background | true | vl-light---dashboard---1-0-75 |
| 0:242 | large_visual | decorative_background | true | vl-light---dashboard---1-0-242 |
| 0:6 | large_visual | decorative_background | true | vl-light---dashboard---1-0-6 |
| 0:451 | large_visual | decorative_background | true | vl-light---dashboard---1-0-451 |
| 0:461 | named_visual | decorative_shape | false | - |
| 0:241 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-241 |
| 0:12 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-12 |
| 0:238 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-238 |
| 0:236 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-236 |
| 0:152 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-152 |
| 0:151 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-151 |
| 0:171 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-171 |
| 0:170 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-170 |
| 0:190 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-190 |
| 0:189 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-189 |
| 0:245 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-245 |

## 覆盖率摘要

- sourceNodeCount: 496
- visibleNodeCount: 496
- unsupportedCount: 89
- unmappedCount: 0

### light---dashboard---1

- sourceNodeCount: 496
- visibleNodeCount: 496
- vector: total=262, rendered=173, ignoredSafe=0, unsupported=89, unmapped=0
- imageFill: total=4, rendered=4, missingAsset=0
- text: total=114, rendered=114, styleComplete=114
- budgetExceeded: 0
- pageSize: 1440x1024 / 1440x1024 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":88,"unsupported_missing_asset":1}
- byKind: {"vector":89}

- 0:461 (vector, unsupported_missing_asset, area=22908): Combined Shape
- 0:249 (vector, unsupported_renderer_limit, area=1600): Bg
- 0:276 (vector, unsupported_renderer_limit, area=1600): Bg
- 0:292 (vector, unsupported_renderer_limit, area=1600): Bg
- 0:310 (vector, unsupported_renderer_limit, area=1600): Bg
- 0:330 (vector, unsupported_renderer_limit, area=1600): Bg
- 0:348 (vector, unsupported_renderer_limit, area=1600): Bg
- 0:368 (vector, unsupported_renderer_limit, area=900): Bg
- 0:369 (vector, unsupported_renderer_limit, area=900): Bg
- 0:370 (vector, unsupported_renderer_limit, area=900): Bg


## unsupportedFeatures

- **visual_layer_no_asset** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer
- **visual_asset_budget_exceeded** (fallback_ok): defer

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 0:27
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:34
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:35
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:36
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:47
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:48
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:49
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:50
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:121
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:125
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:129
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:133
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:163
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:182
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:201
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:244
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:249
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:273
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:276
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:289
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:292
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:299
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:307
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:310
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:315
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:316
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:317
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:318
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:319
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:327
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:330
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:345
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:348
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:355
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:368
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:369
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:370
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:371
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:372
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:373
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:374
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:383
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:384
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:385
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:386
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:387
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:388
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:389
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:398
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:399
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:400
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:401
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:402
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:403
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:404
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:413
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:414
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:415
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:416
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:417
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:418
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:419
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:428
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:429
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:430
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:431
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:432
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:433
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:440

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
