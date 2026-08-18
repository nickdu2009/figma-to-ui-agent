# Product-M9 submit/dialog candidate screening 报告

生成时间：2026-08-09T22:21:00+08:00

## 结论

现有 seed corpus 尚未提供 confirmed submit/dialog 正向 restricted-live 样本。

已成立：

- `community-mobile-001` 仍可作为 Flow-M14 CHANGE_TO / variant state-change restricted-live 回归样本。

未成立：

- `community-login-001`、`community-ecommerce-001`、`community-design-system-001` 不能直接作为 Product-M9 submit/dialog 正向证据。

## 只读筛选结果

| sampleId | 结果 | 证据 | 建议 |
| --- | --- | --- | --- |
| community-mobile-001 | change_to_only | full-file depth=8 找到大量 NODE/CHANGE_TO target，包括 Log in/check out 命名按钮组件；仍是 variant state-change。 | 保留为 Flow-M14 回归样本。 |
| community-login-001 | not_confirmed_submit_candidate | depth=4 没有 interaction nodes；depth=5 超过 Figma REST 响应大小上限。 | 换更窄子节点或补 confirmation answer。 |
| community-ecommerce-001 | not_confirmed_submit_candidate | depth=4 到 depth=8 均为 interactionNodes=0。 | 换 checkout/payment 样本。 |
| community-design-system-001 | not_confirmed_submit_candidate | depth=4 到 depth=8 有 interaction nodes，但 submit-like target candidates 均为 0。 | 保留为 confirmation/组件诊断样本。 |

## 下一步

1. 不继续在当前 six-sample seed corpus 上强跑 confirmedSubmit。
2. 新增或替换真实 Community checkout/payment/booking/contact/form 样本。
3. 新样本先通过只读筛选：source node 命名接近 submit/dialog，action 为 NODE，且带 destinationId。
4. 通过筛选后再跑 Product-M9 restricted-live，验收目标是 `confirmedSubmit > 0` 且 fixture 成功。

## 网络边界

- Figma REST：已调用。
- OpenAI：未调用。
- 原始 Figma 响应：未落盘。
