# M3 产品化结论

## 结论

当前 Figma-to-UI Agent MVP 在冻结基线
`1d45b3359769ddd39d072f343752cf93bd139df0d348a7aa008a9e2036a10d1b`
下达到 `productization_ready`。

本结论不包含 Figma 原始 URL、Token、Cookie、OpenAI 密钥或私有响应载荷。

## 冻结基线

- Freeze 文件：`data/baselines/m3/freeze.json`
- 冻结时间：`2026-07-24T04:39:21.343Z`
- Flow 校准项目：`m3-flow-20260724-h`
- Flow 结果：`data/calibration/m3/m3-flow-20260724-h/result.json`
- Flow validation：
  `data/projects/m3-flow-20260724-h/runs/mrygafpl-49354b3c260346258063c5f809f68922/validation.json`
- Flow validation SHA-256：
  `6a3cc896a6dc4d6018543801bf72ee66d9e159dd4e2ad934d2417e08acf79197`

`src/figma/rest-client.ts` 在冻结前已加入 Figma REST 客户端内部限流和
429 脱敏日志；因此本基线覆盖该客户端行为。

## 锁定运行时

- Node：`v26.5.0`
- npm：`11.17.0`
- Pi Coding Agent：`0.81.1`
- 模型：`gpt-5.4`
- Chromium：`149.0.7827.55`
- Chromium revision：`1228`
- Chromium binary SHA-256：
  `11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3`
- package-lock SHA-256：
  `4f6200391e507761caf071dc213c6157b7ee8c4d8df879b0407799a5635c6b35`

## 冻结受控面

- 工具面严格为四个：
  `inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`
- 冻结视口：`mobile-393`，`393x852`，DPR `1`
- 视觉阈值：`maxDiffPixelRatio=0.05`，`maxDiffPixels=50000`
- Diff 算法：`rgba_max_channel_delta_8`
- max channel delta：`8`
- Locale：`zh-CN`
- Timezone：`UTC`
- 动画：禁用 / reduced motion
- Service Worker：block
- 字体：`Arial, sans-serif`

## 盲测结果

最终摘要：`data/blind/m3/final-summary.json`

三份未知 Figma 文件均来自同一冻结基线，且 file key hash 互不相同。

| Case | 结果 | 迭代 | 页面 | 组件 | 图片 | Auto Layout | Bound Variables | 最大视觉差异 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `case-a2-r6` | 通过 | 1 | 2 | 27 | 0 | 52 | 30 | `742 / 0.002216` |
| `case-b-r6` | 通过 | 1 | 1 | 10 | 1 | 3 | 0 | `2539 / 0.007583` |
| `case-c-r6` | 通过 | 1 | 1 | 0 | 6 | 0 | 0 | `3140 / 0.009378` |

覆盖项全部通过：

- noVariables
- bindingsWithoutFullVariables
- fullVariablesOrExplicitNonLiveContractFixture
- multiplePages
- frozenViewports
- components
- images
- complexAutoLayout

## 本地验证

在当前工作树执行并通过：

```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:unit
npm run test:integration -- --testTimeout 30000
npm run test:e2e
```

补充验证：

```bash
M3_CASE_IDS='case-a2-r6,case-b-r6,case-c-r6' npm run finalize:m3
```

`finalize:m3` 输出 `productization_ready`。

## 运行方式

本地预览：

```bash
npm run preview:dev
```

M3 复现入口：

```bash
npm run prepare:m3
npm run run:m3:flow
npm run freeze:m3 -- --confirm --flow-record <validation.json>
npm run manifest:m3
npm run blind:m3
npm run finalize:m3
```

真实 Figma/OpenAI 运行需要本机 `.envrc` 中配置凭证，并显式设置对应授权环境变量。

## 限制与残余风险

- Variables live API 仍为可选增强能力；当前通过非 live 契约 fixture 覆盖。
- 当前产品化结论只覆盖冻结工具面和本地 JSON Project Store，不包含源码导出、
  桌面应用封装、数据库、云部署、多租户、自动 PR 或发布。
- Figma REST 429 会被客户端内部限流和脱敏日志记录；超长 `Retry-After` 不自动长时间等待。
- `case-a-r6` 是单页面通过证据；最终矩阵使用 `case-a2-r6` 以覆盖多页面。
- 旧 freeze 文件均保留为 `data/baselines/m3/freeze.superseded-*.json` 证据。
