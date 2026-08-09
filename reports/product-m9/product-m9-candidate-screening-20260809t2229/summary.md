# Product-M9 candidate screening 报告

- runId：product-m9-candidate-screening-20260809t2229
- status：change_to_only
- sourceRef：tests/fixtures/figma/community-sample-manifest.json
- sampleCount：6
- submitDialogCandidates：0
- changeToOnly：1
- noSubmitDialogCandidate：4
- notScreenable：1

## Samples

| sampleId | category | status | submitDialogCandidates | changeToCandidates | attempts |
| --- | --- | --- | ---: | ---: | --- |
| community-login-001 | login-register | not_screenable | 0 | 0 | d1:i0, d2:i0, d3:i0, d4:i0, d5:error |
| community-mobile-001 | mobile-app | change_to_only | 0 | 20 | d1:i0, d2:i0, d3:i581, d4:i899, d5:i983, d6:i984, d7:i984, d8:i984 |
| community-dashboard-001 | dashboard | no_submit_dialog_candidate | 0 | 0 | d1:i0, d2:i0, d3:i0, d4:i0, d5:i0, d6:i0, d7:i0, d8:i0 |
| community-ecommerce-001 | ecommerce | no_submit_dialog_candidate | 0 | 0 | d1:i0, d2:i0, d3:i0, d4:i0, d5:i0, d6:i0, d7:i0, d8:i0 |
| community-landing-001 | landing-page | no_submit_dialog_candidate | 0 | 0 | d1:i0, d2:i0, d3:i0, d4:i0, d5:i0, d6:i0, d7:i0, d8:i0 |
| community-design-system-001 | design-system | no_submit_dialog_candidate | 0 | 0 | d1:i0, d2:i0, d3:i1, d4:i3, d5:i10, d6:i23, d7:i23, d8:i26 |

## Next Actions

- 不要把本批样本当作 confirmed submit/dialog 正向证据。
- 继续新增 checkout/payment/booking/contact/form Community 样本后重跑 screening。
