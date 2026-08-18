# Product-M9 candidate screening 报告

- runId：product-m9-known-candidate-screening-20260809t2240
- status：candidate_found
- sourceRef：data/product-m9-candidate-screening/known-candidates-manifest.json
- sampleCount：2
- submitDialogCandidates：1
- changeToOnly：0
- noSubmitDialogCandidate：1
- notScreenable：0

## Samples

| sampleId | category | status | submitDialogCandidates | changeToCandidates | attempts |
| --- | --- | --- | ---: | ---: | --- |
| known-trego-ride-hailing-001 | booking-ride-hailing | submit_dialog_candidate | 11 | 0 | d1:i0, d2:i0, d3:i1, d4:i26 |
| known-nexkart-ecommerce-001 | ecommerce-checkout | no_submit_dialog_candidate | 0 | 0 | d1:i0, d2:i0, d3:i0, d4:i0, d5:i0, d6:i0 |

## Next Actions

- 选择 submit_dialog_candidate 样本中的 nodeId 跑 Product-M9 restricted-live。
- 验收 confirmedSubmit > 0、successfulFixtureIds > 0、failedFixtureIds = 0。
