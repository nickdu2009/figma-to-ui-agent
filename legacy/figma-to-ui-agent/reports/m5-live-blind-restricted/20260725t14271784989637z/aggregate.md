# M5.1 T08 Live Blind Aggregate

- reportRoot: reports/m5-live-blind-restricted/20260725t14271784989637z
- baselineReport: reports/m5-live-blind-restricted/20260725t122808/aggregate.json
- currentAggregateDiff: 38.16%
- baselineAggregateDiff: 40.05%
- aggregateRelativeImprovement: 4.70%
- totalVisualLayers: 68
- totalUnsupportedCoverageCount: 85
- totalUnmappedCount: 0
- apiBoundary: openai=false, figmaMe=false, variables=false
- ac12Passed: true
- caveat: AC12 passes only by the no-unmapped/attributed fallback; pixel-diff improvement thresholds are not met.

| case | status | diff | baseline | relative improvement | visual layers | unsupported coverage | unmapped |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| case-a | partial | 14.12% | 14.12% | 0.00% | 16 | 7 | 0 |
| case-b | partial | 71.44% | 71.44% | 0.00% | 16 | 25 | 0 |
| case-c | partial | 28.92% | 34.58% | 16.35% | 36 | 53 | 0 |

## AC12 Evaluation

- any case improved by >=30%: false
- aggregate improved by >=20%: false
- no unmapped and all runs non-failed: true

Note: This aggregate intentionally omits raw Figma URLs and credentials.
