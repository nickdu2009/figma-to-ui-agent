---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m13-reaction-first-sample-candidates",
  "scope": "project",
  "type": "integration",
  "title": "Figma-to-UI Agent Flow-M13 reaction-first Community sample candidates",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m13"
}
---

# Figma-to-UI Agent Flow-M13 reaction-first Community sample candidates

## 结论

Flow-M13 样本选择应采用 reaction-first 策略：先用 Figma REST 确认目标节点子树存在可解析 prototype interaction，再决定是否进入 restricted-live / FlowPlan artifact 验证。仅凭 Community 页面类别、UI 外观或静态 frame 数量不能作为 Flow-M13 primary 样本依据。

## 当前推荐样本

| 样本 | 类别 | Flow-M13 用途 | restricted-live 结果 | 处理建议 |
| --- | --- | --- | --- | --- |
| Fitness App UI Kit | mobile state change | 已知控制样本；证明真实 CHANGE_TO 到 set_state 链路 | readable；trusted.set_state=5；unsupported=4 | 保留为 control / regression 样本 |
| Modern Service Booking | booking / appointment | 新增 primary 样本；覆盖 booking 类 state-change chips 和 submit-like confirmation 信号 | readable；trusted.set_state=11；submit-like needs_confirmation=6；missing_evidence=6 | 纳入 Flow-M13 reaction-first 样本候选 |
| Trego Ride Hailing | onboarding / booking / payment | 候选 navigate 样本；原始 Figma 中存在跨 screen NAVIGATE destination | full screen 被 extreme cornerRadius 拒绝；小节点可读但 destination 不在同一 target bundle，classification 为 missing_evidence | 暂缓收录，先走通用修复计划 |

## 本轮拒绝作为 Flow-M13 primary 的样本类型

- 静态 checkout / cart / payment 样本：NexKart 与 Mobile Credit Card Check Out 可用于视觉或静态覆盖，但目标节点没有足够可执行 FlowPlan 证据。
- 静态 settings 样本：User Profile Settings 可读但没有 prototype interaction，不适合作为 Flow-M13 primary。
- 仅有 NAVIGATE 但 destination 缺失的局部节点：可作为诊断输入，不应直接当作 trusted route sample。

## 收录规则

1. 进入 Flow-M13 primary 的样本必须至少满足一个条件：trusted.navigate > 0、trusted.set_state > 0，或明确产生 needs_confirmation.submit_like 且有 artifact path。
2. 样本 locator、file key、原始 Figma URL、token 与 REST payload 不写入正式 Worktrail 知识；需要执行时放在受控 manifest / fixture / 本地报告中。
3. 若样本只能证明静态视觉或布局覆盖，应进入 visual/static corpus，不进入 Flow-M13 real FlowPlan artifact closure。
4. Trego 类跨 sibling destination route 应等待 target expansion 和 cornerRadius normalization 修复后再重新验证。

## 下一步

- 将 Modern Service Booking 加入 Flow-M13 restricted-live 候选清单或后续 manifest。
- 保留 Fitness 作为 regression control。
- 先实施 Trego 通用修复计划，再重新跑 Trego navigate restricted-live。
