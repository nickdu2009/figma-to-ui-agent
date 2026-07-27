---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-m5-1-live-blind-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent M5.1 T08 Frame 修复后验证结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M5.1 T08 Frame 修复后验证结果

## 结论

在 T08 受限 live blind 之后，已针对高 diff 的通用根因完成两项修复，并使用 T08 缓存下来的三个 DesignBundle 执行本地 static compare 回归。该回归不访问 Figma，也不调用 OpenAI。

修复后的 aggregate diff 从 38.16% 降到 12.47%，相对改善 67.33%，已满足 AC12 的 aggregate 改善 >= 20% 门槛。case-b 从 71.44% 降到 5.09%，主要视觉结构已经恢复，但仍略高于 5% 目标线。

## 修复内容

- 将 Figma `bounds` 映射为 UISpec frame style：root 使用 `position: relative` 和页面宽高，子节点使用相对父节点的 `position: absolute`、`left`、`top`、`width`、`height`、`zIndex`。
- 修复局部 `pixel_overlay`：局部 Figma 节点截图不再使用 pageRelativeBounds 作为 `frame` 裁剪，改为直接通过 style 的 `left/top/width/height` 放置。
- 修复 visual layer 插入非 root 父容器时的坐标：被插入父节点时按父节点 bounds 重新计算 left/top，避免 page-relative 坐标被父容器二次叠加。
- 对 0 宽/0 高节点保持 left/top/zIndex，但不写非法 width/height，避免 UISpec schema 拒绝。

## 证据

- 修复后汇总：`reports/m5-fix-check/20260725t1452-all/aggregate.json`
- 修复后汇总 Markdown：`reports/m5-fix-check/20260725t1452-all/aggregate.md`
- 对比基线：`reports/m5-live-blind-restricted/20260725t14271784989637z`
- 回归方式：复用已缓存 T08 DesignBundle，本地 static generation + render compare；无 Figma/OpenAI 网络调用。

## Case 结果

| case | 当前 diff | 修复前 diff | 相对改善 | visual layers | unsupported | unmapped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| case-a | 12.66% | 14.12% | 10.34% | 16 | 7 | 0 |
| case-b | 5.09% | 71.44% | 92.87% | 16 | 25 | 0 |
| case-c | 19.65% | 28.92% | 32.07% | 36 | 53 | 0 |

## 验证

- `npm run typecheck`：通过
- `npx vitest run tests/unit/static-generation/node-mapper.test.ts tests/unit/static-generation/visual-layer-planner.test.ts tests/integration/static-generation/m5-static.test.ts`：通过
- `npm run test:unit`：35 files / 182 tests 通过
- `npm run test:integration`：9 files / 45 tests 通过
- `npm run test:e2e`：6 tests 通过

## 剩余风险

- case-b 仍为 5.09%，略高于 5% 建议目标；剩余差异集中在小 vector stroke/icon、Mastercard 图形、数量加减按钮和字体渲染细节。
- case-a 与 case-c 仍高于 5%，但已经满足 M5.1 当前 AC12 的 aggregate 改善门槛；后续应进入更细的 vector stroke / icon / text metrics 覆盖，而不是回退整页截图 fallback。
