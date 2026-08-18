# Product-M9 样本矩阵收口报告 v2

生成时间：2026-08-09T22:05:00+08:00
Git HEAD：`e381dc1`

## 结论

当前状态仍是 **partial**，不能标记项目目标完成，但 Product-M9 的正向证据比上一版更明确：

- trusted navigate：Cake 样本通过，`trustedNavigate=66`，失败 fixture 为 0。
- CHANGE_TO / variant state change：Community mobile / Flow-M14 样本通过，`trustedStateChange=12`，失败 fixture 为 0。
- confirmed submit：Design System 样本有 1 个用户确认 submit fixture 执行成功，`confirmedSubmit=1`，失败 fixture 为 0。

仍未收口的部分：

- Design System 还有 4 个 submit-like 控件需要结构化确认；当前 `unsupported=0`。
- Booking 有 11 个 state-change 成功 fixture，但 6 个 Figma 交互缺少目标标识，只能归类为 missing evidence。
- Nexkart 在 decline-only 后不会重复询问，这是正确行为，但它没有留下正向可执行 flow 证据。

## 矩阵

| 样本 | 类型 | 状态 | trustedNavigate | trustedStateChange | confirmedSubmit | needsConfirmation | unsupported | missingEvidence | failedFixtures | 结论 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Cake navigation-only | trusted navigate | passed | 66 | 0 | 0 | 0 | 0 | 0 | 0 | passed; navigation-only non-submit evidence is sufficient for this artifact |
| Community mobile Flow-M14 | CHANGE_TO variant / set_state | passed | 0 | 12 | 0 | 0 | 0 | 0 | 0 | passed; Flow-M14 CHANGE_TO executable path is proven on this artifact |
| Nexkart ecommerce | declined ambiguous interactions | partial | 0 | 0 | 0 | 0 | 0 | 0 | 0 | partial; no repeated confirmation prompt, but no positive executable flow evidence remains |
| Booking reaction-first | mixed state-change plus missing target | partial | 0 | 11 | 0 | 0 | 0 | 6 | 0 | partial; executable state-change evidence exists, but six interactions lack target identifiers |
| Design System submit-like | confirmed submit plus remaining confirmation | partial | 0 | 0 | 1 | 4 | 0 | 1 | 0 | partial; confirmedSubmit=1 and failed fixtures=0, but four controls still require confirmation |

## 汇总指标

- 样本数：5
- passed：2
- partial：3
- trustedNavigate：66
- trustedStateChange：23
- confirmedSubmit：1
- submitLikeNeedsConfirmation：4
- unsupported：0
- missingEvidence：7
- successfulFixtures：90
- failedFixtures：0

## 下一步

1. 以 `confirmedSubmit` 作为 Product-M9 submit 正向证据指标，不再只靠 `successfulFixtureIds` 间接判断。
2. 对 Design System 剩余 4 个 submit-like question，收集结构化 confirmation answer 或替换为更干净的真实 submit/dialog 样本。
3. 对 Booking 这类 target-missing 样本，不从代码里猜目标；改为换样本或补充明确的外部语义证据。
4. 保留 Cake、Community mobile、Design System confirmed submit 作为 navigate / CHANGE_TO / submit 三条正向回归基线。

## 证据文件

- Cake navigation-only: `reports/product-m9/cake-navigation-only-passed-20260809t2146/summary.json`
- Community mobile Flow-M14: `reports/product-m9/product-m9-community-mobile-flow-m14-passed-local-20260809t2148/summary.json`
- Nexkart ecommerce: `reports/product-m9/product-m9-nexkart-declined-no-repeat-20260809t2152/summary.json`
- Booking reaction-first: `reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/summary.json`
- Design System submit-like: `reports/product-m9/product-m9-design-system-confirmed-submit-metric-20260809t2204/summary.json`
