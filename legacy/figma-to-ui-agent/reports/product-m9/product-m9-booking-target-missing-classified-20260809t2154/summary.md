# Product-M9 Real FlowPlan Agent Entry 报告

- runId: product-m9-booking-target-missing-classified-20260809t2154
- status: partial
- ok: false
- mode: local
- projectId: flow-m13-screening-reaction-booking-change-to-001
- uiSpecPath: data/projects/flow-m13-screening-reaction-booking-change-to-001/specs/current.json
- flowPlanPath: reports/product-m9/product-m9-booking-helper-decline-apply-local-20260809t2122/confirmed-flow-plan.json
- validationPath: reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/flow-m11-summary.json

## Metrics

- trustedNavigate: 0
- trustedStateChange: 11
- submitLikeNeedsConfirmation: 0
- unsupported: 0
- missingEvidence: 6
- successfulFixtureIds: flow-figma-02d0d9f901e987ae-fixture, flow-figma-f5faec37a5db849c-fixture, flow-figma-0ec1b5b1bb362b56-fixture, flow-figma-161878381df77c4a-fixture, flow-figma-73c539f332dce8d0-fixture, flow-figma-715e3964be5df74c-fixture, flow-figma-d81358602d6e0a23-fixture, flow-figma-0c844eb80beab5da-fixture, flow-figma-439a34bb2755161a-fixture, flow-figma-134b1fac692a2fee-fixture, flow-figma-12d1c2467aceebaa-fixture
- failedFixtureIds: none

## Stages

- inspect: passed - Product-M9 input validated
- staticGeneration: passed - Local UISpec artifact loaded
- flowPlanExtraction: passed - Local FlowPlan artifact loaded
- execution: partial - Flow-M11 execution partial
- report: passed - Product-M9 summary written

## Error

- category: partial_evidence
- message: FlowPlan validation completed with partial evidence
- recoverable: true
- retryPolicy: manual_review
- nextAction: 查看 partial reasons，补样本、补确认或人工复核。

## Next Action

- 查看 partial reasons，补样本、补确认或人工复核。
