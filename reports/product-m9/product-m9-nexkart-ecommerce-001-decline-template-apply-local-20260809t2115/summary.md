# Product-M9 Real FlowPlan Agent Entry 报告

- runId: product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115
- status: partial
- ok: false
- mode: local
- projectId: product-m9-nexkart-ecommerce-001
- uiSpecPath: data/projects/product-m9-nexkart-ecommerce-001/specs/current.json
- flowPlanPath: reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/confirmed-flow-plan.json
- confirmedFlowPlanPath: reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/confirmed-flow-plan.json
- validationPath: reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/flow-m11-summary.json

## Metrics

- trustedNavigate: 0
- trustedStateChange: 0
- submitLikeNeedsConfirmation: 0
- unsupported: 34
- missingEvidence: 45
- successfulFixtureIds: none
- failedFixtureIds: none

## Stages

- inspect: passed - Product-M9 input validated
- staticGeneration: passed - Local UISpec artifact loaded
- flowPlanExtraction: passed - Local FlowPlan artifact loaded
- confirmation: partial - Flow-M10 confirmation answers applied=0 declined=45 rejected=0
- execution: failed - Flow-M11 execution failed
- report: passed - Product-M9 summary written

## Error

- category: unsupported_figma_action
- message: FlowPlan contains unsupported Figma actions
- recoverable: true
- retryPolicy: manual_review
- nextAction: 记录 unsupported Figma action，不猜测业务逻辑。

## Next Action

- 记录 unsupported Figma action，不猜测业务逻辑。
