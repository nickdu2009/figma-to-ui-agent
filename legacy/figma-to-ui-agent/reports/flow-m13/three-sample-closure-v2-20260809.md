# Flow-M13 three-sample restricted-live closure v2

## 结论

- Flow-M13 三样本 restricted-live v2 收口已通过。
- 本次运行访问 Figma REST；未调用 OpenAI。
- v2 在 v1 的 Canvas 上下文回填基础上，增加受控多轮 prototype destination 补抓。
- 相比 v1，真实 FlowPlan artifact 覆盖显著提升：
  - `trustedNavigate`：36 -> 65
  - `trustedStateChange`：5 -> 12
  - `unsupported`：5 -> 1
  - `missingEvidence`：15 -> 1

## 运行信息

- run：`reports/flow-m13/three-sample-closure-v2/20260809t0621/summary.json`
- sample manifest：临时 `/tmp` manifest，未写入正式 seed fixture。
- mode：`restricted-live`
- figmaRestCalled：`true`
- openaiCalled：`false`
- status：`passed`
- reasons：空

## 聚合结果

| 指标 | v1 | v2 |
| --- | ---: | ---: |
| totalSamples | 3 | 3 |
| readableSamples | 3 | 3 |
| trustedNavigate | 36 | 65 |
| trustedStateChange | 5 | 12 |
| submitLikeNeedsConfirmation | 51 | 104 |
| unsupported | 5 | 1 |
| missingEvidence | 15 | 1 |
| notAccessible | 0 | 0 |

## 样本结果

| sampleId | 覆盖类别 | accessStatus | trustedNavigate | trustedStateChange | needsConfirmation | unsupported | missingEvidence |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `community-mobile-001` | mobile-app / state-change | readable | 0 | 12 | 0 | 0 | 0 |
| `community-login-001` | login-register / submit-like | readable | 0 | 0 | 3 | 0 | 1 |
| `reaction-cake-ordering-home-navigate-001` | food-ordering / navigate | readable | 65 | 0 | 101 | 1 | 0 |

## 本次修复

- `src/figma/inspector.ts`
  - 将 prototype target 补抓从单跳改为受控多轮扩展。
  - 上限：最多 4 轮，最多 160 个 target node。
  - 每轮只基于已规范化 DesignBundle 中真实存在的 prototype interaction 继续补抓 destination，避免全文件无界读取。
- `tests/integration/figma/inspector.test.ts`
  - 新增二跳 prototype destination 测试：`1:1 -> 2:1 -> 3:1`。
  - 保持 `source.targetNodeIds` 只记录用户原始目标，扩展节点只进入 bundle 内容和规范化目标上下文。

## 关键判断

- `ui_node_not_clickable` 在三样本 v2 结果中为 0；当前不再是 Flow-M13 收口 blocker。
- `prototype_target_page_missing` 在 Cake 样本中降为 0；原先缺失的二跳详情页已能进入 FlowPlan page 映射。
- 剩余 `missingEvidence = 1` 来自 Login 样本没有 Figma prototype interaction，这是预期的 submit-like confirmation 边界。
- 剩余 `unsupported = 1` 来自 Cake 样本中的一个不支持 Figma action，未阻断可信 navigate artifact。

## 已执行验证

```bash
npm exec -- vitest run tests/integration/figma/inspector.test.ts
npm run typecheck
git diff --check

FLOW_M9_RESTRICTED_LIVE_AUTHORIZED=1 npm exec -- node scripts/run-flow-m9-restricted-live.mjs \
  --mode restricted-live \
  --allow-figma-network \
  --sampleManifest /tmp/flow-m13-three-sample-closure-20260809.json \
  --sampleIds community-mobile-001,community-login-001,reaction-cake-ordering-home-navigate-001 \
  --projectIdPrefix flow-m13-closure-v2 \
  --reportRoot reports/flow-m13/three-sample-closure-v2 \
  --runId 20260809t0621
```

结果：

- integration：1 file，8 tests passed
- typecheck：passed
- diff check：passed
- restricted-live v2：passed
- Figma REST：called
- OpenAI：not called

## 后续动作

1. 将 v2 收口结果沉淀为 Worktrail validation candidate，等待 review/promote。
2. 下一阶段可单独处理剩余 `unsupported_figma_action`，但它不是 Flow-M13 收口 blocker。
