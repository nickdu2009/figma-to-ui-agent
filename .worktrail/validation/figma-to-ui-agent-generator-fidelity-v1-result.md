---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "validation-figma-to-ui-agent-generator-fidelity-v1-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Generator Fidelity v1 验证结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Generator Fidelity v1 验证结果

## 1. 结论

Generator Fidelity v1 已完成 T01-T08 的实现与本地验证流程，但视觉目标未完全达成。

- 固定 Community corpus：6/6 均完成 static generation、preview 和 render-and-compare。
- `<5%` pixel diff：2/6 通过，未达到计划目标 4/6。
- T07 按计划的替代验收成立：剩余 4 个失败样本均有明确 region 归因，并已证明继续修复需要独立的字体、局部 asset 或 UISpec 复合视觉表达授权。
- 功能、键盘、console、coverage guard 均通过。
- 未使用整页 screenshot fallback，未调用 Figma/OpenAI。

本候选记录的是“实现完成但视觉门禁部分通过”，不得解释为 4/6 目标已达成。

## 2. 最终 Corpus 结果

证据：

- `reports/community-corpus/20260726gf-final-local-v1-generator-fidelity-v1-summary.json`
- `reports/community-corpus/20260726gf-final-local-v1-generator-fidelity-v1-summary.md`

汇总：

- `resultCount = 6`
- `comparableCount = 6`
- `passed5PctCount = 2`
- `averageDiff = 7.0289%`
- `minDiff = 2.0227%`
- `maxDiff = 15.6374%`
- `apiBoundary.figma = false`
- `apiBoundary.openai = false`

| 样本 | diff | 结果 |
|---|---:|---|
| ecommerce | 2.0227% | 通过 |
| landing | 3.6523% | 通过 |
| mobile profile | 5.5260% | 未通过 |
| dashboard | 6.1018% | 未通过 |
| login | 9.2332% | 未通过 |
| design system | 15.6374% | 未通过 |

## 3. Coverage Guard

证据：

- `reports/community-corpus/20260726gf-final-local-v1-coverage-guard-summary.json`
- `reports/community-corpus/20260726gf-final-local-v1-coverage-guard-summary.md`

结果：

- 固定样本集合匹配。
- `sourceNodeCount = 1430`，与 coverage baseline 一致。
- `unmapped = 0`。
- `fullPageScreenshotFallback = false`。
- vector rendered：`530 -> 533`。
- vector unsupported：`208 -> 205`。
- image fill rendered：`8 -> 8`。
- text rendered：`228 -> 228`。
- coverage guard 全部门禁通过。

## 4. 保留的通用改进

- 明确记录 viewport/artboard mapping、scale、origin、renderMode 与 scroll/crop 策略。
- 继续以 UISpec 为唯一中间产物，保留真实 DOM 控件。
- 映射字体、字号、字重、行高、letter spacing、white-space 和控件文字样式。
- 视觉层按 page-relative bounds、zIndex、opacity、intrinsic size 和 pointer safety 渲染。
- 增加 simple shape fallback、assetless stroke icon 诊断、report-level region diagnosis 和固定 6 样本 harness。
- stroke-only effect screenshot 采用顶部对齐，dashboard 从约 6.2890% 降到 6.1018%。
- corpus harness 强制清空 Figma/OpenAI key，并只写仓库相对报告路径。

未保留的 probe：无收益的 Boolean operand 去重、node screenshot 替换、Helvetica/Avenir/Futura 字体 fallback 调整均已回退。

## 5. 剩余失败归因

### 5.1 Mobile profile

- 当前 diff：5.5260%，距离门槛约 0.526 个百分点。
- dense text region 占主要差异；20/24 个文本节点使用 League Spartan，其余使用 Poppins。
- 当前验证环境未安装 League Spartan/Poppins，字体匹配落到 Verdana；Avenir Next、Helvetica Neue 和 Futura probe 均使 diff 劣化。
- 页面还缺少 back/status/edit 等局部 stroke icon asset。
- 继续降低差异需要嵌入原始字体文件或授权字体资产获取，而不是继续猜系统 fallback。

### 5.2 Dashboard

- 当前 diff：6.1018%。
- stroke-only chart effect 对齐已获得可量化改善。
- `Combined Shape` 等复合 vector 的父级局部 asset 缺失，子 operand 截图不能表达父级组合 paint/effect；当前 UISpec visual layer 也不能在一个复合层中携带多组 operand geometry。
- 继续修复需要补采父级局部 asset，或通过独立 UISpec additive schema 设计表达 boolean/compound visual。

### 5.3 Login

- 当前 diff：9.2332%。
- 主要差异集中在 social buttons、dense text、form fields 和 visual assets。
- 样本使用 Inter 与 Plus Jakarta Sans；当前环境未提供对应原始字体资产。
- 继续修复需要字体嵌入，以及 social icon/局部视觉 asset 的完整采集与合成，不能退回整页截图。

### 5.4 Design system

- 当前 diff：15.6374%。
- 最大差异是 modal shell，form fields、CTA 与视觉层次为次要区域。
- 样本大量使用未安装的 Apercu Pro，并包含组件变体、modal shell 和复合层关系；当前静态 UISpec 会丢失部分 variant/overlay/compound semantics。
- 继续修复需要独立 schema 设计与字体/asset 能力，不属于 Generator Fidelity v1 的无授权小修范围。

## 6. 测试结果

- `npm run typecheck`：通过。
- static generation 相关 unit：43/43 通过。
- `tests/integration/validation/render-and-compare.test.ts` 与 `tests/integration/static-generation/m5-static.test.ts`：9/9 通过。
- preview e2e：4/4 通过。
- catalog e2e：8/8 通过。
- 6 个 corpus 样本的 functional、keyboard、console 检查均通过。
- `git diff --check`：通过。
- 严格 secret scan：0 命中。

## 7. 后续门禁

若继续追求至少 4/6 `<5%`，必须先单独确认以下一个或多个范围：

1. 字体资产：允许获取并嵌入 League Spartan、Poppins、Inter、Plus Jakarta Sans、Apercu Pro 等原始字体。
2. 局部 Figma asset：允许补采缺失的 compound vector、icon 和 effect layer，不允许整页截图。
3. UISpec additive schema：设计 boolean/compound visual、variant/modal overlay 和复合 clip/effect 表达，并通过 `GATE-UISPEC-SCHEMA`。
4. 完成上述能力后，重新运行同一固定 corpus，目标仍为至少 4/6 `<5%`。

## 8. Lifecycle

- 本 validation 仅创建 pending candidate。
- 不自动 promote、merge、discard、commit 或 push。
- 由用户基于本候选决定后续 lifecycle。
