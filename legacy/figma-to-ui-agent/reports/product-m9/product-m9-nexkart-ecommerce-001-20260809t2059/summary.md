# Product-M9 Real FlowPlan Agent Entry 报告

- runId: product-m9-nexkart-ecommerce-001-20260809t2059
- status: partial
- ok: false
- mode: restricted-live
- projectId: product-m9-nexkart-ecommerce-001
- designBundlePath: data/projects/product-m9-nexkart-ecommerce-001/figma/current.json
- uiSpecPath: data/projects/product-m9-nexkart-ecommerce-001/specs/current.json
- flowPlanPath: data/projects/product-m9-nexkart-ecommerce-001/flow/current.json
- validationPath: reports/product-m9/product-m9-nexkart-ecommerce-001-20260809t2059/flow-m11-summary.json

## Metrics

- trustedNavigate: 0
- trustedStateChange: 0
- submitLikeNeedsConfirmation: 45
- unsupported: 34
- missingEvidence: 45
- successfulFixtureIds: none
- failedFixtureIds: none

## Stages

- inspect: passed - Product-M9 input validated
- staticGeneration: passed - UISpec generated from restricted-live DesignBundle
- flowPlanExtraction: passed - FlowPlan generated and saved from Figma evidence
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
