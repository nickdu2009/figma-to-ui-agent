---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m13-three-sample-closure-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M13 三样本 restricted-live 收口结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m13"
}
---

# Figma-to-UI Agent Flow-M13 三样本 restricted-live 收口结果

## 结论

- Flow-M13 三样本 restricted-live 收口已通过。
- 本次运行访问 Figma REST；未调用 OpenAI。
- 三个样本全部 `readable`，覆盖 Flow-M13 需要的三类能力：
  - `trusted.navigate`：Cake Ordering Home 替代 navigate 样本。
  - `trusted.set_state`：Fitness mobile state-change 样本。
  - `needs_confirmation.submit_like`：Login submit-like confirmation 样本。
- Trego 仍保留为 `prototype_target_missing` 诊断样本，不作为 trusted navigate primary。

## 运行信息

- run：`reports/flow-m13/three-sample-closure/20260809t0604/summary.json`
- sample manifest：临时 `/tmp` manifest，未写入正式 seed fixture。
- mode：`restricted-live`
- figmaRestCalled：`true`
- openaiCalled：`false`
- status：`passed`
- reasons：空

## 聚合结果

| 指标 | 数值 |
| --- | ---: |
| totalSamples | 3 |
| readableSamples | 3 |
| trustedNavigate | 36 |
| trustedStateChange | 5 |
| submitLikeNeedsConfirmation | 51 |
| unsupported | 5 |
| missingEvidence | 15 |
| notAccessible | 0 |

## 样本结果

| sampleId | 覆盖类别 | accessStatus | trustedNavigate | trustedStateChange | needsConfirmation | unsupported | missingEvidence |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `community-mobile-001` | mobile-app / state-change | readable | 0 | 5 | 0 | 4 | 0 |
| `community-login-001` | login-register / submit-like | readable | 0 | 0 | 3 | 0 | 1 |
| `reaction-cake-ordering-home-navigate-001` | food-ordering / navigate | readable | 36 | 0 | 48 | 1 | 14 |

## 关键判断

- Cake 样本在 Canvas 上下文回填后，三样本 run 中 `trustedNavigate` 达到 36，说明 destination 回填和后续目标页补抓链路有效。
- Cake 样本仍有 `missingEvidence = 14` 和 `unsupported = 1`，主要来自目标页面缺失或不支持的 Figma action；这不阻断 Flow-M13 收口，因为可信 navigate artifact 已产生。
- Login 样本没有 Figma prototype interaction，但继续作为 submit-like confirmation 样本有效：它能证明缺少业务 postcondition 时不会猜提交行为。
- Fitness 样本继续作为真实 `CHANGE_TO -> set_state` 样本有效。

## 已执行验证

```bash
FLOW_M9_RESTRICTED_LIVE_AUTHORIZED=1 npm exec -- node scripts/run-flow-m9-restricted-live.mjs \
  --mode restricted-live \
  --allow-figma-network \
  --sampleManifest /tmp/flow-m13-three-sample-closure-20260809.json \
  --sampleIds community-mobile-001,community-login-001,reaction-cake-ordering-home-navigate-001 \
  --projectIdPrefix flow-m13-closure \
  --reportRoot reports/flow-m13/three-sample-closure \
  --runId 20260809t0604
```

结果：

- restricted-live：passed
- Figma REST：called
- OpenAI：not called

## 后续动作

1. 再进入 `ui_node_not_clickable` / `prototype_target_page_missing` 泛化修复，目标是降低 Cake 样本剩余 unsupported 和 missingEvidence。
2. 修完后用同一三样本组合复跑，确认 `trustedNavigate`、`trustedStateChange` 和 submit-like confirmation 不回退。
