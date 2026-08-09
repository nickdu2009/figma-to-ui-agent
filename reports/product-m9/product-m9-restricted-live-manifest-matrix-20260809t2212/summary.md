# Product-M9 restricted-live manifest 样本矩阵

生成时间：2026-08-09T22:12:00+08:00
Git HEAD：`9d7bc02`

## 结论

当前 restricted-live manifest 六样本整体状态是 **partial**。这批运行证明了：Figma REST 读取、DesignBundle、UISpec、FlowPlan、Product-M9 report 的真实链路可运行，且不调用 OpenAI。

已成立的正向证据：

- `community-mobile-001` 通过，`trustedStateChange=12`，证明 Flow-M14 CHANGE_TO / variant state-change 在 restricted-live 下可执行。

未成立的证据：

- 当前 manifest 没有干净的正向 submit/dialog restricted-live 样本。
- `community-ecommerce-001` 是 checkout 视觉样本，但没有可执行 FlowPlan evidence，不能当 submit 证据。
- `community-login-001`、`community-landing-001`、`community-design-system-001` 只产生 submit-like confirmation questions，不能在没有结构化确认时自动当作通过。

## 矩阵

| sampleId | 类别 | 状态 | trustedStateChange | confirmedSubmit | needsConfirmation | unsupported | missingEvidence | successfulFixtures | failedFixtures | 说明 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| community-login-001 | login-register | partial | 0 | 0 | 3 | 0 | 0 | 0 | 0 | login sample: submit-like confirmation only |
| community-mobile-001 | mobile-app | passed | 12 | 0 | 0 | 0 | 0 | 12 | 0 | mobile sample: CHANGE_TO/state-change positive evidence |
| community-dashboard-001 | dashboard | partial | 0 | 0 | 0 | 0 | 0 | 0 | 0 | dashboard sample: no executable flow evidence |
| community-ecommerce-001 | ecommerce | partial | 0 | 0 | 0 | 0 | 0 | 0 | 0 | checkout sample: no executable flow evidence |
| community-landing-001 | landing-page | partial | 0 | 0 | 1 | 0 | 0 | 0 | 0 | landing sample: one submit-like confirmation |
| community-design-system-001 | design-system | partial | 0 | 0 | 5 | 0 | 1 | 0 | 0 | design-system sample: submit-like confirmation only |

## 汇总指标

- sampleCount：6
- passed：1
- partial：5
- trustedNavigate：0
- trustedStateChange：12
- confirmedSubmit：0
- submitLikeNeedsConfirmation：9
- unsupported：0
- missingEvidence：1
- successfulFixtures：12
- failedFixtures：0

## 下一步

1. 保留 `community-mobile-001` 作为 restricted-live Flow-M14 CHANGE_TO 回归样本。
2. 不把 `community-ecommerce-001` 或 dashboard 当作 submit 证据，因为它们没有可执行交互。
3. login / landing / design-system 只有在有结构化 confirmation answer 后才能作为 submit-like 证据。
4. 继续寻找或补入一个具有原生 prototype target evidence 的真实 submit/dialog Community 样本，再跑 Product-M9 restricted-live。

## 证据文件

- community-login-001: `reports/product-m9/product-m9-rl-community-login-001-20260809t2208/summary.json`
- community-mobile-001: `reports/product-m9/product-m9-rl-community-mobile-001-20260809t2210/summary.json`
- community-dashboard-001: `reports/product-m9/product-m9-rl-community-dashboard-001-20260809t2210/summary.json`
- community-ecommerce-001: `reports/product-m9/product-m9-rl-community-ecommerce-001-20260809t2207/summary.json`
- community-landing-001: `reports/product-m9/product-m9-rl-community-landing-001-20260809t2210/summary.json`
- community-design-system-001: `reports/product-m9/product-m9-rl-community-design-system-001-20260809t2208/summary.json`
