# Product-M9 Real FlowPlan Agent Entry 报告

- runId: product-m9-ac10-community-mobile-001-20260809t2000
- status: failed
- ok: false
- mode: restricted-live
- projectId: product-m9-ac10-community-mobile-001

## Metrics

- trustedNavigate: 0
- trustedStateChange: 0
- submitLikeNeedsConfirmation: 0
- unsupported: 0
- missingEvidence: 0
- successfulFixtureIds: none
- failedFixtureIds: none

## Stages

- inspect: passed - Product-M9 input validated
- staticGeneration: passed - UISpec generated from restricted-live DesignBundle
- flowPlanExtraction: passed - FlowPlan generated and saved from Figma evidence
- report: passed - Product-M9 failure summary written

## Error

- category: input_invalid
- message: Product-M9 input is invalid
- recoverable: true
- retryPolicy: retry_after_fix
- nextAction: 修正参数、URL、projectId 或 artifact ref 后重试。

## Next Action

- 修正参数、URL、projectId 或 artifact ref 后重试。
