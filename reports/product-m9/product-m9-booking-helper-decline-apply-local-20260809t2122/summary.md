# Product-M9 Real FlowPlan Agent Entry 报告

- runId: product-m9-booking-helper-decline-apply-local-20260809t2122
- status: partial
- ok: false
- mode: local
- projectId: flow-m13-screening-reaction-booking-change-to-001
- uiSpecPath: data/projects/flow-m13-screening-reaction-booking-change-to-001/specs/current.json
- flowPlanPath: reports/product-m9/product-m9-booking-helper-decline-apply-local-20260809t2122/confirmed-flow-plan.json
- confirmedFlowPlanPath: reports/product-m9/product-m9-booking-helper-decline-apply-local-20260809t2122/confirmed-flow-plan.json
- validationPath: reports/product-m9/product-m9-booking-helper-decline-apply-local-20260809t2122/flow-m11-summary.json

## Metrics

- trustedNavigate: 0
- trustedStateChange: 11
- submitLikeNeedsConfirmation: 0
- unsupported: 12
- missingEvidence: 12
- successfulFixtureIds: flow-figma-02d0d9f901e987ae-fixture, flow-figma-f5faec37a5db849c-fixture, flow-figma-0ec1b5b1bb362b56-fixture, flow-figma-161878381df77c4a-fixture, flow-figma-73c539f332dce8d0-fixture, flow-figma-715e3964be5df74c-fixture, flow-figma-d81358602d6e0a23-fixture, flow-figma-0c844eb80beab5da-fixture, flow-figma-439a34bb2755161a-fixture, flow-figma-134b1fac692a2fee-fixture, flow-figma-12d1c2467aceebaa-fixture
- failedFixtureIds: none

## Stages

- inspect: passed - Product-M9 input validated
- staticGeneration: passed - Local UISpec artifact loaded
- flowPlanExtraction: passed - Local FlowPlan artifact loaded
- confirmation: partial - Flow-M10 confirmation answers applied=0 declined=6 rejected=0
- execution: partial - Flow-M11 execution partial
- report: passed - Product-M9 summary written

## Error

- category: unsupported_figma_action
- message: FlowPlan contains unsupported Figma actions
- recoverable: true
- retryPolicy: manual_review
- nextAction: 记录 unsupported Figma action，不猜测业务逻辑。

## Next Action

- 记录 unsupported Figma action，不猜测业务逻辑。
