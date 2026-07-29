---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-generator-fidelity-v1-2-m6-final-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Generator Fidelity v1.2 M6 最终验收结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Generator Fidelity v1.2 M6 最终验收结果

## 结论

当前代码已完成 Generator Fidelity v1.2 到 M6 restricted live 的收口验收。

- 固定 6 样本本地 corpus：`6/6` 达到 `<5%`，不调用 Figma，不调用 OpenAI。
- M6 restricted live：`6/6` 可比较，`6/6` 达到 `<5%`；其中 Mobile 和 Dashboard 已在当前代码下重新调用 Figma live 验证。
- LoginUIConcept live：`4.9678%`，`warnings=0`，`unsupportedFeatures=0`。
- Design System live：`1.2615%`，`warnings=0`，`unsupportedFeatures=0`。
- 当前本地 corpus 中 LoginUIConcept 进一步降至 `2.2220%`，Design System 为 `1.2201%`。
- 未使用整页 screenshot/background fallback；结构化 UISpec/真实 DOM 控件仍保留。
- OpenAI 未调用；Figma `/v1/me` 未调用；Variables 未调用。

## 本地 Corpus 结果

证据：

- `reports/community-corpus/20260727gf-v2-final-r2-generator-fidelity-v1-summary.json`
- `reports/community-corpus/20260727gf-v2-final-r2-generator-fidelity-v1-summary.md`

汇总：

- `resultCount = 6`
- `comparableCount = 6`
- `threshold = 0.05`
- `passed5PctCount = 6`
- `failed5PctCount = 0`
- `averageDiff = 0.023306525021193403`
- `minDiff = 0.009073891625615763`
- `maxDiff = 0.044342041015625`
- `apiBoundary.figma = false`
- `apiBoundary.openai = false`

| 样本 | diff | warnings | unsupported | 结果 |
|---|---:|---:|---:|---|
| LoginUIConcept | `2.2220%` | 0 | 0 | 通过 |
| Mobile Profile | `1.6105%` | 0 | 0 | 通过 |
| Dashboard | `4.4342%` | 0 | 0 | 通过 |
| Ecommerce | `0.9074%` | 0 | 0 | 通过 |
| Landing | `3.5897%` | 0 | 0 | 通过 |
| Design System | `1.2201%` | 0 | 0 | 通过 |

## M6 Restricted Live 结果

证据：

- Login：`reports/m6-live-blind/20260727gf-v2-restricted-r1/community-login-001/ms2mv70x-8c762fe8f04044c3/summary.json`
- Mobile：`reports/m6-live-blind/20260727gf-v2-final-live/community-mobile-001/ms2p00gx-ae38c4085b154695/summary.json`
- Dashboard：`reports/m6-live-blind/20260727gf-v2-final-live/community-dashboard-001/ms2p0f32-f8a860f8ce854ea6/summary.json`
- Ecommerce：`reports/m6-live-blind/20260727gf-v2-restricted-r1/community-ecommerce-001/ms2mx7vn-126119d3cf704938/summary.json`
- Landing：`reports/m6-live-blind/20260727gf-v2-restricted-r1/community-landing-001/ms2mxq9v-9546627375924138/summary.json`
- Design System：`reports/m6-live-blind/20260727gf-v2-restricted-r1/community-design-system-001/ms2myaxr-0592a2cb60374839/summary.json`

| 样本 | diff | warnings | unsupported | 状态 | 说明 |
|---|---:|---:|---:|---|---|
| LoginUIConcept | `4.9678%` | 0 | 0 | passed | 目标样本达标 |
| Mobile Profile | `1.1222%` | 6 | 1 | partial | 剩余 `visual_stroke_icon_no_asset`，可解释且未阻塞 diff 目标 |
| Dashboard | `4.8327%` | 36 | 1 | partial | 剩余 `visual_layer_no_asset`，可解释且未阻塞 diff 目标 |
| Ecommerce | `0.9189%` | 6 | 0 | partial | warning 为未映射 vector 诊断，无 unsupported |
| Landing | `3.5882%` | 33 | 0 | partial | warning 为未映射 vector 诊断，无 unsupported |
| Design System | `1.2615%` | 0 | 0 | passed | 目标样本达标 |

## T04 Backfill Manifest

本轮不能再笼统写作“两个 T04 manifest 都为空”。当前事实是：

- Login manifest：`reports/community-corpus/20260727gf-v1-2-gate-prep/login-visual-backfill-manifest.json`，`entries=[]`。
- Design System manifest：`reports/community-corpus/20260727gf-v2-gate-prep/design-system-visual-backfill-manifest.json`，`entries.length=2`，但最终 Design System local/live 均已 `warnings=0`、`unsupportedFeatures=0` 且 diff 达标。

## 本轮修复

- `scripts/run-m5-live-restricted.mjs`：增加 `--fontSourceDataRoot`，允许从本地 corpus 缓存按字体族/字重/样式回填 live 项目字体资产，并打印 `fontBackfill` 统计。
- `preview/src/components/controlled-style.ts`：将 visual border 渲染为 inset `box-shadow`，避免 CSS border 改变绝对定位子节点坐标系。
- `preview/src/components/typography.tsx`：文本截图 overlay 改用绝对 `left/top` 偏移，保持 Figma 坐标对齐。
- `preview/src/font-assets.ts` 与 `preview/src/preview-app.tsx`：初始化浏览器字体状态，避免无字体 fixture 下 render-and-compare 等待超时。
- `src/static-generation/visual-layer-planner.ts`：预算溢出的小型可 CSS 表达视觉 shape 不再直接变成 unsupported，而是作为 decorative stack 渲染。
- `tests/unit/static-generation/visual-layer-planner.test.ts`：覆盖预算溢出小型 painted vector 作为 CSS shape 渲染。

## 验证命令

已通过：

```bash
node scripts/run-generator-fidelity-corpus.mjs --dataRoot data/community-corpus-v21 --reportRoot reports/community-corpus --runLabel 20260727gf-v2-final-r2 --threshold 0.05 --viewportIds desktop
npm run test:unit
npm run typecheck
npx vitest run tests/integration/figma/visual-asset-backfill.test.ts tests/integration/static-generation/m5-static.test.ts tests/integration/validation/render-and-compare.test.ts --testTimeout=30000 --maxWorkers=1
npm run test:e2e
```

验证摘要：

- unit：`39 files / 242 tests` 通过。
- typecheck：通过。
- integration：`3 files / 11 tests` 通过。
- e2e：`6 tests` 通过。
- e2e 输出仅有 `NO_COLOR` 被 `FORCE_COLOR` 覆盖的环境提示，不影响结果。

## 边界与剩余风险

- M6 restricted live 中 Mobile、Dashboard、Ecommerce、Landing 仍有 warnings；这些 warnings 已作为诊断呈现，没有静默丢失，但后续应继续降低 warning 数量。
- Mobile/Dashboard 各剩余 1 个 unsupported，属于可解释视觉层缺口；当前 diff 已小于 5%。
- 本记录不声明 Figma Variables 支持已完成；Variables 仍是可选增强能力。
- 本记录不声明任意未知 Community 文件都能小于 5%；结论范围是当前 6 样本 corpus 与本轮 M6 restricted live 样本。
