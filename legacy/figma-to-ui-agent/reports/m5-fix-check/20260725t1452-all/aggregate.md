# M5.1 Layout Frame Fix Aggregate

- reportRoot: reports/m5-fix-check/20260725t1452-all
- baselineReportRoot: reports/m5-live-blind-restricted/20260725t14271784989637z
- currentAggregateDiff: 12.47%
- baselineAggregateDiff: 38.16%
- aggregateRelativeImprovement: 67.33%

| case | diff | baseline | relative improvement | visual layers | unsupported | unmapped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| case-a | 12.66% | 14.12% | 10.34% | 16 | 7 | 0 |
| case-b | 5.09% | 71.44% | 92.87% | 16 | 25 | 0 |
| case-c | 19.65% | 28.92% | 32.07% | 36 | 53 | 0 |

## Notes

- This check reuses cached T08 DesignBundles and does not call Figma or OpenAI.
- The improvement comes from general Figma frame mapping and local visual-layer coordinate fixes, not case-specific styling.
- case-b remains at 5.09%, slightly above the 5% target, mainly due to small unsupported vector strokes/icons and text/font rendering residuals.
