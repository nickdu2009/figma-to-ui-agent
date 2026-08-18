# Product-M9 evidence classification 报告

- runId：product-m9-evidence-classification-20260809t2217
- status：partial
- sourceRef：reports/product-m9/product-m9-restricted-live-manifest-matrix-20260809t2212/summary.json

## 结论

Product-M9 evidence 尚未同时覆盖 CHANGE_TO / variant 和 confirmed submit 正向样本；当前仍需补 submit/dialog 正向证据。

## 汇总

- sampleCount：6
- changeToVariantPositive：1
- confirmedSubmitPositive：0
- submitLikeNeedsConfirmation：3
- noExecutableEvidence：2
- missingEvidence：1
- unsupported：0
- failedFixture：0

## 样本分类

| sampleId | status | classifications | recommendedUse |
| --- | --- | --- | --- |
| community-login-001 | partial | pending.submit_like_confirmation | 保留为 submit-like confirmation 样本；补结构化确认后再重跑。 |
| community-mobile-001 | passed | positive.change_to_variant | 用作 Flow-M14 CHANGE_TO / variant state-change restricted-live 回归样本。 |
| community-dashboard-001 | partial | gap.no_executable_evidence | 不用于当前交付正向证据；换样本或选择包含 prototype interaction 的节点。 |
| community-ecommerce-001 | partial | gap.no_executable_evidence | 不用于当前交付正向证据；换样本或选择包含 prototype interaction 的节点。 |
| community-landing-001 | partial | pending.submit_like_confirmation | 保留为 submit-like confirmation 样本；补结构化确认后再重跑。 |
| community-design-system-001 | partial | pending.submit_like_confirmation, gap.missing_evidence | 保留为 submit-like confirmation 样本；补结构化确认后再重跑。 |

## 下一步

- 保留已有 CHANGE_TO / variant state-change 正向样本作为 Flow-M14 回归。
- 继续寻找或确认一个 confirmedSubmit > 0 且 fixture 成功的 submit/dialog 样本。
- 对 submit-like confirmation 样本补结构化 confirmation answer；没有确认前不要当作正向 submit 证据。
