# M5 静态生成报告

- runId: 20260726-generator-fidelity-v1-font-fallback-community-v21-landing-001
- projectId: community-v21-landing-001
- designBundleRevision: 1
- uiSpecRevision: 14
- status: partial
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: not_required

## 页面摘要

### home (/home)

- viewportRole: desktop
- nodes: {"text":13,"input":0,"button":1,"image":0,"pixelOverlay":15,"total":121}
- structuredCoverage: text=13, interactive=1
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

- diffPixels: 74660
- diffPixelRatio: 0.04016051295292194
- screenshots: runs/ms19vtfj-38fcb7d4a5604a869a04901c4b7d0187/screenshots/000-f96ca2270afe-expected.png, runs/ms19vtfj-38fcb7d4a5604a869a04901c4b7d0187/screenshots/000-f96ca2270afe-actual.png, runs/ms19vtfj-38fcb7d4a5604a869a04901c4b7d0187/diffs/000-f96ca2270afe-diff.png

##### canvasMapping

- artboard: 1440x1291
- viewport: desktop 1440x900 @1x
- scale: 1
- origin: 0,0
- renderMode: scroll_canvas

##### regionDiffs

| bucket | diff | pixels | bounds |
|---|---:|---:|---|
| visual_assets | 3.74% | 43130 | 148,96,1153x999 |
| text_regions | 4.60% | 72893 | 0,161,1440x1100 |
| button_icon_controls | 12.00% | 814 | 144,385,128x53 |

##### top failing regions

| region | bucket | diff | pixels | suspectedCauses |
|---|---|---:|---:|---|
| cta | button_icon_controls | 12.00% | 814 | asset_layering, renderer_reset |
| social_buttons | button_icon_controls | 12.00% | 814 | asset_layering, renderer_reset |
| footer | text_regions | 4.60% | 72893 | typography |
| mobile_canvas | - | 4.02% | 74660 | canvas_mapping |
| left_visual | visual_assets | 3.74% | 43130 | asset_layering |

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

- **unmapped_node_vector**: 未映射的节点类型 vector: 9:624
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:625
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:626
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:628
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:631
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:632
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:633
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:634
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:635
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:636
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:637
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:638
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:639
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:640
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:645
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:646
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:647
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:649
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:650
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:651
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:652
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:653
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:654
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:655
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:657
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:659
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:660
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:661
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:662
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:663
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:664
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:665
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:666
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:667
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:668
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:669
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:670
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:671
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:672
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:673
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:674
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:675
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:676
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:677
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:678
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:679
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:680
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:681
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:682
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:683
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:684
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:685
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:686
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:687
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:688
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:689
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:690
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:691
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:692
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:693
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:694
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:695
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:696
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:697
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:698
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:699
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:700
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:701
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:702
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:703
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:704
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:705
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:706
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:707
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:708
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:709
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:710
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:711
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:712
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:713
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:714
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:715
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:716
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:717
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:718
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:719
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:720
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:721
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:722
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:723
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:724
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:725
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:726
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:727
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:728
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:729
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:730
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:731
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:734
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:735
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:737
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:738
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:739
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:741
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:742
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:743
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:744
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:745
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:746
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:748
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:749
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:750
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:751
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:752
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:753
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:754
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:755
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:756
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:757
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:758
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:759
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:760
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:761
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:762
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:763
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:764
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:765
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:766
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:767
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:768
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:769
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:770
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:771
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:772
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:773
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:774
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:775
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:776
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:777
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:778
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:779
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:780
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:781
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:782
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:783
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:784
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:785
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:786
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:787
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:788
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:789
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:790
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:791
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:792
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:793
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:794
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:795
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:798
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:799
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:800
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:801
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:803
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:804
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:805
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:810
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:811
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:812
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:813
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:815
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:816
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:817
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:818
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:823
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:824
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:825
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:826
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:828
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:829
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:830
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:831
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:832
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:837
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:838
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:839
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:840
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:842
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:843
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:844
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:845
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:849
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:850
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:851
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:852
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:853
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:854
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:855
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:859
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:860
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:861
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:862
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:863
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:864
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:865
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:866
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:868
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:869
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:870
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:871
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:872
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:873
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:874
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:875
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:876
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:877
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:878
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:879
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:880
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:881
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:882
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:883
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:884
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:885
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:886
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:888
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:890
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:891
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:893
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:894
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:896
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:897
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:898
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:900
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:901
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:903
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:905
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:906
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:908
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:909
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:911
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:912
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:913
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:914
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:915
- **unmapped_node_vector**: 未映射的节点类型 vector: 9:916
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
