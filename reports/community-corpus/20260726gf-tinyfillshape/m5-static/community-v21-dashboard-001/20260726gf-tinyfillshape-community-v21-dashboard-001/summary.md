# M5 静态生成报告

- runId: 20260726gf-tinyfillshape-community-v21-dashboard-001
- projectId: community-v21-dashboard-001
- designBundleRevision: 1
- uiSpecRevision: 48
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### light---dashboard---1 (/light---dashboard---1)

- viewportRole: desktop
- nodes: {"text":114,"input":0,"button":0,"image":4,"pixelOverlay":122,"total":363}
- structuredCoverage: text=114, interactive=0
- visualLayerCoverage: candidate=160, rendered=159, unsupported=23

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

- diffPixels: 104444
- diffPixelRatio: 0.07083062065972222
- screenshots: runs/ms1fl0is-f326738ad84a40ada5c334ca749c016b/screenshots/000-72e60729bf19-expected.png, runs/ms1fl0is-f326738ad84a40ada5c334ca749c016b/screenshots/000-72e60729bf19-actual.png, runs/ms1fl0is-f326738ad84a40ada5c334ca749c016b/diffs/000-72e60729bf19-diff.png

##### canvasMapping

- artboard: 1440x1024
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 7.08% | 104444 | 0,0,1440x1024 |
| text_regions | 7.98% | 99957 | 122,30,1288x972 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| footer | text_regions | 7.98% | 99957 | typography |
| left_visual | visual_assets | 7.08% | 104444 | asset_layering |
| dense_content | - | 7.08% | 104444 | renderer_reset |

## 视觉层追溯

| sourceNodeId | reason | layerRole | rendered | uiSpecNodeId |
|---|---|---|---|---|
| 0:8 | nav_icon | icon | true | vl-light---dashboard---1-0-8 |
| 0:69 | nav_icon | icon | true | vl-light---dashboard---1-0-69 |
| 0:68 | nav_icon | icon | true | vl-light---dashboard---1-0-68 |
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
| 0:23 | nav_icon | icon | true | vl-light---dashboard---1-0-23 |
| 0:314 | nav_icon | icon | true | vl-light---dashboard---1-0-314 |
| 0:313 | nav_icon | icon | true | vl-light---dashboard---1-0-313 |
| 0:334 | nav_icon | icon | true | vl-light---dashboard---1-0-334 |
| 0:333 | nav_icon | icon | true | vl-light---dashboard---1-0-333 |
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
| 0:61 | nav_icon | icon | true | vl-light---dashboard---1-0-61 |
| 0:60 | nav_icon | icon | true | vl-light---dashboard---1-0-60 |
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
| 0:65 | line_divider | line_or_divider | true | vl-light---dashboard---1-0-65 |
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
| 0:249 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-249 |
| 0:276 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-276 |
| 0:292 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-292 |
| 0:310 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-310 |
| 0:330 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-330 |
| 0:348 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-348 |
| 0:368 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-368 |
| 0:369 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-369 |
| 0:370 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-370 |
| 0:371 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-371 |
| 0:372 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-372 |
| 0:373 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-373 |
| 0:374 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-374 |
| 0:383 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-383 |
| 0:384 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-384 |
| 0:385 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-385 |
| 0:386 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-386 |
| 0:387 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-387 |
| 0:388 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-388 |
| 0:389 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-389 |
| 0:398 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-398 |
| 0:399 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-399 |
| 0:400 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-400 |
| 0:401 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-401 |
| 0:402 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-402 |
| 0:403 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-403 |
| 0:404 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-404 |
| 0:413 | structural_visual | decorative_background | true | vl-light---dashboard---1-0-413 |

## 覆盖率摘要

- sourceNodeCount: 496
- visibleNodeCount: 496
- unsupportedCount: 84
- unmappedCount: 0

### light---dashboard---1

- sourceNodeCount: 496
- visibleNodeCount: 496
- vector: total=262, rendered=178, ignoredSafe=0, unsupported=84, unmapped=0
- imageFill: total=4, rendered=4, missingAsset=0
- text: total=114, rendered=114, styleComplete=114
- budgetExceeded: 0
- pageSize: 1440x1024 / 1440x1024 (full_page)
- widthMatched: true
- heightMatched: true

### unsupported 诊断

- byReason: {"unsupported_renderer_limit":83,"unsupported_missing_asset":1}
- byKind: {"vector":84}

- 0:461 (vector, unsupported_missing_asset, area=22908): Combined Shape
- 0:414 (vector, unsupported_renderer_limit, area=900): Bg
- 0:415 (vector, unsupported_renderer_limit, area=900): Bg
- 0:416 (vector, unsupported_renderer_limit, area=900): Bg
- 0:417 (vector, unsupported_renderer_limit, area=900): Bg
- 0:418 (vector, unsupported_renderer_limit, area=900): Bg
- 0:419 (vector, unsupported_renderer_limit, area=900): Bg
- 0:428 (vector, unsupported_renderer_limit, area=900): Bg
- 0:429 (vector, unsupported_renderer_limit, area=900): Bg
- 0:430 (vector, unsupported_renderer_limit, area=900): Bg


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

## Warnings

- **unmapped_node_vector**: 未映射的节点类型 vector: 0:27
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:34
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:35
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:36
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:47
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:48
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:49
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:50
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:58
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:78
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:121
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:125
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:129
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:133
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:141
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:163
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:182
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:201
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:209
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:214
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:244
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:273
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:280
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:289
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:299
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:307
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:315
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:316
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:317
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:318
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:319
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:327
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:337
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:345
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:352
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:355
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:364
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
- **unmapped_node_vector**: 未映射的节点类型 vector: 0:455

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
