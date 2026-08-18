# Product-M9 Real FlowPlan Agent Entry 报告

- runId: product-m9-nexkart-declined-no-repeat-20260809t2152
- status: partial
- ok: false
- mode: local
- projectId: product-m9-nexkart-ecommerce-001
- uiSpecPath: data/projects/product-m9-nexkart-ecommerce-001/specs/current.json
- flowPlanPath: reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/confirmed-flow-plan.json
- validationPath: reports/product-m9/product-m9-nexkart-declined-no-repeat-20260809t2152/flow-m11-summary.json

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
- staticGeneration: passed - Local UISpec artifact loaded
- flowPlanExtraction: passed - Local FlowPlan artifact loaded
- execution: failed - Flow-M11 execution failed
- report: passed - Product-M9 summary written

## Error

- category: partial_evidence
- message: FlowPlan evidence is not executable
- recoverable: true
- retryPolicy: manual_review
- nextAction: 查看 partial reasons，补样本、补确认或人工复核。

## Next Action

- 查看 partial reasons，补样本、补确认或人工复核。
