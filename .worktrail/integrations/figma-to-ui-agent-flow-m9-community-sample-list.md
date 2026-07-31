---
id: figma-to-ui-agent-flow-m9-community-sample-list
status: draft
scope: project
topic: figma-to-ui-agent-flow-m9
kind: integration
---

# Figma-to-UI Agent Flow-M9 Community 样本清单

## 来源与边界

样本来源是仓库内 `tests/fixtures/figma/community-sample-manifest.json`。Worktrail 只记录 sampleId、分类、用途和预期覆盖，不复制真实 Figma URL、file key、token 或原始 REST 响应。

Flow-M9 首轮 restricted-live 只使用 manifest 中已标记为可通过 REST 读取、且已有 selected node 的样本。权限变化或节点不可访问时，样本应记录为 `not_accessible`，不得解释为功能失败。

## 选择标准

- 必须具备 `rest_readable_node_selected` 或等价证据。
- 优先覆盖真实 prototype interaction：`CHANGE_TO`、`NAVIGATE`、缺目标导航、未知交互。
- 覆盖业务形态：移动 App、设计系统、登录注册、支付/checkout、dashboard。
- 首轮至少 3 个样本，扩展到 5 个样本后再判断 Flow-M9 是否收口。

## Primary 样本

| 顺序 | sampleId | 类别 | Flow-M9 用途 | 预期结论 |
| --- | --- | --- | --- | --- |
| 1 | `community-mobile-001` | mobile-app / fitness | 验证真实 `CHANGE_TO` / variant state 到 `set_state` 候选 | 应产生可信 `set_state` 或清晰 unsupported reason |
| 2 | `community-design-system-001` | design-system | 验证组件/variant 样本里的 interaction 读取、分类和 unsupported 诊断 | 应覆盖组件态变体、导航缺失或需确认分类 |
| 3 | `community-login-001` | login-register | 验证 auth/login 页面中按钮、输入、submit-like 行为的证据边界 | 缺少明确 Figma 目标时应进入 `needs_confirmation` |

## 扩展样本

| 顺序 | sampleId | 类别 | Flow-M9 用途 | 预期结论 |
| --- | --- | --- | --- | --- |
| 4 | `community-ecommerce-001` | ecommerce / checkout | 验证支付、checkout、CTA 的 submit-like 或 navigate-like 候选 | 明确目标则 trusted，否则 `needs_confirmation` |
| 5 | `community-dashboard-001` | dashboard | 验证 desktop dashboard 侧栏、tab、页面跳转类候选 | 应产生 navigate 候选或 missing-evidence 诊断 |

## 暂不进入首轮的样本

- 只有 Community 页面链接、缺 designUrl 或 selected node 的样本不进入 Flow-M9 首轮 restricted-live。
- 视觉保真专用样本不作为 Flow-M9 首轮核心样本，除非它同时具备 prototype interaction 证据。
- LoginUIConcept 可继续作为视觉/表单页面参考，但若 interactions 为 0，只能证明静态读取和生成，不能证明 Flow-M9 行为链路。

## 执行顺序

1. 先在 mock fixture 中覆盖 5 类分类，不访问外部服务。
2. restricted-live 首轮跑 3 个 primary 样本：`community-mobile-001`、`community-design-system-001`、`community-login-001`。
3. 若首轮缺少 checkout 或 desktop navigate 证据，再跑 2 个扩展样本：`community-ecommerce-001`、`community-dashboard-001`。
4. 对每个样本输出 extraction report，并在 Worktrail validation 中只记录 sampleId、分类统计、报告相对路径和脱敏结论。

## 成功判断

- 至少 3 个 primary 样本完成 restricted-live 抽取或产生可解释 skip/not_accessible 记录。
- 至少覆盖一种可信 FlowPlan 候选和一种 `needs_confirmation` 候选。
- 所有失败都有机器可读 reason。
- 无 token、真实 URL、file key、原始响应正文泄露。
