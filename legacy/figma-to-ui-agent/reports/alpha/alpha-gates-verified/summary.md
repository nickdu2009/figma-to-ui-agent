# Alpha 可上线收口报告

- runId: `alpha-gates-verified`
- 结论: `passed`
- 口径: Alpha 可上线；未知真实 Figma 不保证 100% 成功，但 partial/failed 不伪装为 passed。
- Git HEAD: `acdbc56`
- Git 工作区: `M .env.example
 M package.json
 M tests/integration/figma/inspector.test.ts
?? docs/alpha-launch-plan.md
?? docs/alpha-release-notes.md
?? docs/alpha-sample-matrix.md
?? docs/alpha-troubleshooting.md
?? docs/alpha-user-guide.md
?? reports/alpha/
?? scripts/run-alpha-readiness.mjs`

## 清单

| ID | 状态 | 项目 | 原因 | 证据 |
| --- | --- | --- | --- | --- |
| AC1 | passed | Alpha 验收标准定义 passed / partial / failed，禁止假通过 |  | docs/alpha-launch-plan.md |
| AC2 | passed | 泛化样本证据覆盖至少 4-5 个真实 Community 样本和关键能力类型 |  | reports/product-m9/product-m9-trego-prototype-gap-declined-20260810t0020/summary.json<br>reports/product-m9/cake-navigation-only-passed-20260809t2146/summary.json<br>reports/product-m9/product-m9-rl-community-mobile-001-20260809t2210/summary.json<br>reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/summary.json<br>reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/summary.json<br>reports/product-m9/product-m9-rl-community-design-system-001-20260809t2208/summary.json |
| AC3 | passed | 目标级完成审计覆盖 Figma REST、DesignBundle、UISpec、FlowPlan、Preview、Playwright、confirmation、报告、失败口径、Git、Worktrail |  | reports/project-completion/current-corpus-closure-v7-20260810t0054/summary.json<br>reports/project-completion/final-goal-completion-audit-20260810t0056/summary.json |
| AC4 | passed | 稳定运行入口清晰，支持 projectId/runId/Figma URL 输入和稳定报告路径 |  | package.json<br>scripts/run-product-m9-flow.mjs<br>scripts/run-alpha-readiness.mjs |
| AC5 | passed | 配置和密钥管理完整，凭据只从环境读取，报告脱敏 |  | .env.example<br>docs/alpha-launch-plan.md<br>docs/alpha-user-guide.md<br>docs/alpha-troubleshooting.md<br>docs/alpha-sample-matrix.md<br>docs/alpha-release-notes.md |
| AC6 | passed | 错误诊断和恢复区分 rate limit、权限、不可访问、node missing、unsupported、missing target、needs confirmation |  | docs/product-m9-agent-usage.md<br>docs/alpha-troubleshooting.md |
| AC7 | passed | 固定回归样本矩阵包含 Trego、Cake、Nexkart、电商/Booking/Design system/component variant |  | docs/alpha-sample-matrix.md |
| AC8 | passed | 每次 run 有 summary.md 和 summary.json，报告可读且脱敏 |  | reports/product-m9/product-m9-trego-prototype-gap-declined-20260810t0020/summary.json<br>reports/product-m9/cake-navigation-only-passed-20260809t2146/summary.json<br>reports/product-m9/product-m9-rl-community-mobile-001-20260809t2210/summary.json<br>reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/summary.json<br>reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/summary.json<br>reports/product-m9/product-m9-rl-community-design-system-001-20260809t2208/summary.json |
| AC9 | passed | Preview 可启动、可查看、可交互，导航、状态切换、表单基本可验证 |  | reports/project-completion/ui-control-smoke-community-mobile-switch-20260810t0046/summary.json<br>reports/project-completion/state-machine-smoke-trego-navigation-20260810t0053/summary.json<br>docs/alpha-user-guide.md |
| AC10 | passed | 测试和安全门禁覆盖 typecheck、unit、integration、e2e、restricted-live matrix、secret scan、脱敏检查 |  | scripts/run-alpha-readiness.mjs |
| AC11 | passed | 发布与回滚说明存在，最终 commit/tag 在提交后确认 |  | docs/alpha-release-notes.md |
| AC12 | passed | Alpha 使用说明、验收报告、已知限制、故障排查、样本矩阵说明已落文档 |  | docs/alpha-launch-plan.md<br>docs/alpha-user-guide.md<br>docs/alpha-troubleshooting.md<br>docs/alpha-sample-matrix.md<br>docs/alpha-release-notes.md |

## 固定样本矩阵

| 样本 | 状态 | Alpha 接受度 | 覆盖类别 | 成功 fixture | unsupported | missing | 报告 |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| trego | passed | accepted | multi-page navigation + submit-like + target backfill | 49 | 0 | 0 | reports/product-m9/product-m9-trego-prototype-gap-declined-20260810t0020/summary.json |
| cake | passed | accepted | multi-page navigation | 66 | 0 | 0 | reports/product-m9/cake-navigation-only-passed-20260809t2146/summary.json |
| community-mobile | passed | accepted | CHANGE_TO / variant state | 12 | 0 | 0 | reports/product-m9/product-m9-rl-community-mobile-001-20260809t2210/summary.json |
| nexkart | partial | accepted | ecommerce / unsupported action boundary | 0 | 34 | 45 | reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/summary.json |
| booking | partial | accepted | form-like state change + missing target | 11 | 0 | 6 | reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/summary.json |
| design-system | partial | accepted | component variant + needs confirmation | 0 | 0 | 1 | reports/product-m9/product-m9-rl-community-design-system-001-20260809t2208/summary.json |

## 本地门禁

| 门禁 | 状态 | exitCode | durationMs |
| --- | --- | ---: | ---: |
| typecheck | passed | 0 | 1238 |
| unit | passed | 0 | 3278 |
| integration | passed | 0 | 22691 |
| e2e | passed | 0 | 9714 |
| diff-check | passed | 0 | 21 |

## 发布说明

Alpha 对应的最终发布身份以包含本报告的提交或 tag 为准。回滚方式见 `docs/alpha-release-notes.md`。
