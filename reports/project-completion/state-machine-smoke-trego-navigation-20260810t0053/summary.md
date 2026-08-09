# StateMachine smoke 验证报告

- runId：state-machine-smoke-trego-navigation-20260810t0053
- status：passed
- sourceRef：reports/product-m9/product-m9-trego-prototype-gap-declined-20260810t0020/summary.json
- sourceMode：restricted-live
- transitionCount：2
- successfulFixtureCount：2
- failedFixtureCount：0

## Transitions

- transition-figma-d5e7fe5be3195937：login -> home-screen passed
- transition-figma-79f7f3f27a0bff85：login -> forgot-password passed

## 结论

真实 restricted-live Figma prototype navigation graph 已派生为临时 stateMachine，并通过 Preview/Playwright transition fixture 验证。
