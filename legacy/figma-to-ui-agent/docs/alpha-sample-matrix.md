# Alpha 样本矩阵

Alpha 固定矩阵用于证明真实 Community 样本的泛化能力。矩阵接受 `partial`，但必须解释 partial 原因。

| 样本 | 覆盖目标 | 当前证据 | Alpha 口径 |
| --- | --- | --- | --- |
| Trego ride hailing | 多页面导航、submit-like、target backfill | `reports/product-m9/product-m9-trego-prototype-gap-declined-20260810t0020/summary.json` | `passed` |
| Cake / food app | 多页面导航 | `reports/product-m9/cake-navigation-only-passed-20260809t2146/summary.json` | `passed` |
| Community mobile controls | CHANGE_TO、visual node action、控件 smoke | `reports/product-m9/product-m9-rl-community-mobile-001-20260809t2210/summary.json` | `passed` |
| Nexkart ecommerce | 电商/visual node action/unsupported 边界 | `reports/product-m9/product-m9-nexkart-ecommerce-001-decline-template-apply-local-20260809t2115/summary.json` | `partial`，unsupported 与 missing evidence 必须保留 |
| Booking / form-like | 表单类状态切换、missing target | `reports/product-m9/product-m9-booking-target-missing-classified-20260809t2154/summary.json` | `partial`，missing target 不伪装成功 |
| Design system component variants | component variant、submit-like needs confirmation | `reports/product-m9/product-m9-rl-community-design-system-001-20260809t2208/summary.json` | `partial`，需要确认的问题保留 |

## 覆盖断言

- 多页面导航：Trego、Cake。
- CHANGE_TO / variant：Community mobile、Design system。
- submit-like：Trego confirmed submit、Design system needs confirmation。
- visual node action：Community mobile、Nexkart。
- target backfill：Trego。
- missing/partial：Nexkart、Booking、Design system。

## 发布前要求

发布前运行：

```bash
npm run alpha:gates
```

若矩阵中任何 `partial` 缺少原因，Alpha readiness 必须保持 partial 或 failed。
