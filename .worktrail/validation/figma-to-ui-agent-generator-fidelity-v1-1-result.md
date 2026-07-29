---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "validation-figma-to-ui-agent-generator-fidelity-v1-1-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Generator Fidelity v1.1 验证结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Generator Fidelity v1.1 验证结果

## 结论

Generator Fidelity v1.1 已完成当前计划的 T07、GATE-FIGMA-BACKFILL/T08、T09 和 T10 本地收口。

验收结论：达成。

- 固定六样本：4/6 个样本 `diff < 5%`。
- 必达目标样本：Mobile、Dashboard、Ecommerce、Landing 均 `diff < 5%`。
- Coverage guard：通过；未出现 source node 数量变化、unmapped、整页截图 fallback、vector/image/text rendered 回退。
- API 边界：最终 T09 全量运行未调用 Figma 或 OpenAI；T08 仅按授权对 Dashboard manifest 节点调用 Figma node image export。
- Git lifecycle：未执行 commit、push、promote、discard。

## 外部授权执行

### GATE-FONT-ASSET

已按用户授权导入 Google Fonts 官方来源字体，来源许可为 SIL Open Font License。导入后：

- `community-v21-mobile-001` DesignBundle revision 为 2，登记 7 个 font face。
- `community-v21-dashboard-001` DesignBundle revision 为 2，登记 2 个 font face。
- package/lock hash 未变化。

字体下载与导入摘要：

- `reports/community-corpus/20260726gf-v1-1-font-assets/download-summary.json`

### GATE-FIGMA-BACKFILL / T08

已按用户授权执行 Dashboard 节点级 backfill：

- projectId：`community-v21-dashboard-001`
- manifest：`reports/community-corpus/20260726gf-v1-1-gate-prep/dashboard-visual-backfill-manifest.json`
- manifest revision：2
- manifest node count：4
- request shape：Figma `/v1/images/<fileKey>`，`format=png`，`scale=1`
- excluded：未调用 `/v1/me`、Variables、OpenAI、完整 inspect、page/root/full-artboard
- apply result：DesignBundle revision `2 -> 3`，registeredImageCount=4

执行中发现并修复一个真实 Figma API 兼容问题：`/v1/images` 成功响应包含顶层 `err:null`，backfill 响应 schema 已调整为只接受该成功形状；非 null error 仍失败。

Dashboard targeted 结果：

- report：`reports/community-corpus/20260726gf-v1-1-backfill-dashboard/20260726gf-v1-1-backfill-dashboard/summary.json`
- diff：`0.04422810872395833`
- status：`partial`
- 结论：Dashboard `<5%` 达成

## T09 固定六样本结果

最终视觉 summary：

- JSON：`reports/community-corpus/20260726gf-v1-1-final-local-generator-fidelity-v1-summary.json`
- Markdown：`reports/community-corpus/20260726gf-v1-1-final-local-generator-fidelity-v1-summary.md`

结果：

| projectId | diff | passed |
| --- | ---: | --- |
| `community-v21-login-001` | `0.09233169129720854` | false |
| `community-v21-mobile-001` | `0.03525743267136008` | true |
| `community-v21-dashboard-001` | `0.04422810872395833` | true |
| `community-v21-ecommerce-001` | `0.020226600985221676` | true |
| `community-v21-landing-001` | `0.0365229139645482` | true |
| `community-v21-design-system-001` | `0.15637433461380973` | false |

Aggregate：

- `resultCount=6`
- `comparableCount=6`
- `threshold=0.05`
- `passed5PctCount=4`
- `failed5PctCount=2`
- `apiBoundary.figma=false`
- `apiBoundary.openai=false`

## Coverage Guard

Coverage guard summary：

- JSON：`reports/community-corpus/20260726gf-v1-1-final-local-coverage-guard-summary.json`
- Markdown：`reports/community-corpus/20260726gf-v1-1-final-local-coverage-guard-summary.md`

结果：通过。

关键指标：

- `sourceNodeCount=1430`，delta `0`
- `visibleNodeCount=1397`，delta `0`
- `unmapped=0`
- `fullPageScreenshotFallback=false`
- `vectorRendered=536`，delta `+6`
- `vectorUnsupported=204`，delta `-4`
- `imageFillRendered=8`，delta `0`
- `textRendered=228`，delta `0`

通过 gates：

- `sampleSetMatched=true`
- `sourceNodeCountMatched=true`
- `unmappedZero=true`
- `fullPageScreenshotFallbackFalse=true`
- `vectorRenderedNotRegressed=true`
- `imageFillRenderedNotRegressed=true`
- `textRenderedNotRegressed=true`

## 本地验证

已通过：

- `npx vitest run ...`：19 个文件，149 个测试通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- `npx playwright test --config playwright.e2e.config.ts tests/e2e/preview.spec.ts`：4 个测试通过。
- `npx playwright test --config playwright.catalog.config.ts tests/e2e/catalog.spec.ts`：8 个测试通过。
- package hash 未变化：
  - `package.json`: `f6282b18c5cf14b5d7f6aae29197862f5ed786a3ecbff2f2c622aeb0b7468d85`
  - `package-lock.json`: `4f6200391e507761caf071dc213c6157b7ee8c4d8df879b0407799a5635c6b35`
- final reports secret/source-path scan：6 个关键报告文件无命中。

## 剩余风险

- Login 与 Design System 仍未达 `<5%`，但它们不属于 v1.1 必达四样本；后续应进入独立的 Generator Fidelity v2 或更细粒度组件/variant/layout fidelity 设计。
- Dashboard 仍有 8 个 `visual_asset_budget_exceeded` fallback-ok 项；本次目标未要求清零，coverage guard 显示没有回退。
- T08 中曾出现一次图片下载取消，重试后成功；最终没有 429，且成功保存 revision 3。
