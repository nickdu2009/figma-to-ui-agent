# Flow-M13 Trego generalization fix validation

## 结论

- `cornerRadius` 通用容错已实现：非有限值、负值、超过 DesignBundle Schema 上限的圆角值会被忽略，并写入 `figma_corner_radius_ignored` warning。
- Trego full-screen restricted-live 已从 `not_accessible` 解锁为 `readable`，说明读取失败的第一层 blocker 已移除。
- Trego 仍不能作为 `trusted.navigate` 样本：官方 Figma REST 在当前样本的 5 个 `NAVIGATE` action 中返回 `destinationId: null`，`transition` 也不包含目标节点引用。
- 因此不能把 Trego 猜测成可信路由。它应保留为 `prototype_target_missing` 诊断样本。
- 已找到并验证替代 navigate 样本：Cake Ordering Home 样本在 Canvas 上下文回填后得到 `trustedNavigate = 10`，可作为 Flow-M13 的真实 navigate artifact 入口。

## 本次修改

- `src/figma/normalize.ts`
  - 新增受控圆角上限 `MAX_NORMALIZED_CORNER_RADIUS = 10000`。
  - `cornerRadius` / uniform `rectangleCornerRadii` 仅在有限、非负、未超过上限时进入 `visual.cornerRadius`。
  - 非法值进入 warning，不进入 DesignBundle。
- `tests/unit/figma/normalize.test.ts`
  - 覆盖 `cornerRadius > 10000`、负值、`NaN`、非 number。
  - 覆盖正常圆角值仍原样保留。
  - 覆盖修复后的 DesignBundle Schema 解析不失败。
- `src/figma/rest-client.ts`
  - `getFile` 支持受控 `depth` 参数，用于读取浅层 Canvas 上下文。
- `src/figma/inspector.ts`
  - 当目标节点存在 `prototype_target_missing` 时，追加一次 depth=3 的文件浅扫，定位包含目标节点的 Canvas。
  - 再按 Canvas 节点读取上下文，并只在 prototype target 证据数量变多时采用该上下文，避免无收益地扩大 bundle。
- `tests/integration/figma/inspector.test.ts`
  - 覆盖直接节点响应丢失 `destinationId`、Canvas 上下文响应保留 `destinationId` 时，检查器能回填并继续抓取 destination 节点。

## 真实样本验证

Trego full-screen restricted-live 复跑结果：

- sample status：`partial`
- accessStatus：`readable`
- prototypeInteractionCount：`5`
- flowPlanInteractionCount：`6`
- trustedNavigate：`0`
- trustedStateChange：`0`
- submitLikeNeedsConfirmation：`1`
- missingEvidence：`5`
- blockedReasons：`prototype_target_missing`、`interaction_target_missing`

脱敏 REST 字段探针结果：

- 5 个 Figma `NAVIGATE` action 均返回 `destinationId: null`。
- `transition` 只包含动效信息或为 `null`，没有目标节点 id。
- 未观察到 429。

现有 6 个种子样本复跑结果：

- run：`reports/flow-m13/existing-seed-navigation/20260809t0533/summary.json`
- status：`passed`
- readableSamples：`6`
- trustedNavigate：`0`
- trustedStateChange：`5`
- submitLikeNeedsConfirmation：`9`
- missingEvidence：`7`
- 结论：现有种子集可以继续覆盖 state-change / submit-like confirmation，但不能证明真实 navigate。

Cake Ordering Home 替代 navigate 样本复跑结果：

- run：`reports/flow-m13/replacement-navigate/20260809t0545/summary.json`
- status：`partial`
- partial 原因：该 run 只包含 1 个样本，触发 Flow-M9 的三样本数量门禁；单样本能力验证本身成功。
- accessStatus：`readable`
- prototypeInteractionCount：`51`
- flowPlanInteractionCount：`56`
- trustedNavigate：`10`
- trustedStateChange：`0`
- submitLikeNeedsConfirmation：`5`
- missingEvidence：`0`
- blockedReasons：`ui_node_not_clickable`、`interaction_target_missing`
- 结论：Canvas 上下文回填已证明真实 Figma `NAVIGATE destinationId` 可以进入 FlowPlan artifact；未可信的剩余 interaction 是当前 UISpec clickable 映射能力不足或 submit-like 需要确认，不是 Figma REST 读取失败。

## 已执行验证

```bash
npm exec -- vitest run tests/unit/figma/normalize.test.ts
npm exec -- vitest run tests/integration/figma/inspector.test.ts
npm run typecheck
```

结果：

- unit：1 file，12 tests passed
- integration：1 file，7 tests passed
- typecheck：passed

## 后续动作

1. 将 Trego 从 `trusted.navigate` primary 预期中移出，保留为缺目标导航诊断样本。
2. 将 Cake Ordering Home 纳入 Flow-M13 的 navigate primary 样本候选。
3. 后续做三样本 restricted-live 收口时，组合应至少包含：state-change 样本、submit-like confirmation 样本、Cake navigate 样本。
4. 若要降低 Cake 样本的 unsupported 数量，下一步应修 `ui_node_not_clickable` 的映射泛化，而不是再扩大 REST 抓取范围。
