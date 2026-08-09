# Alpha 使用说明

## 本地 readiness

```bash
npm run alpha:readiness
```

该命令只读取本地报告、文档和配置，不访问 Figma，不调用 OpenAI。输出位置：

- `reports/alpha/<runId>/summary.json`
- `reports/alpha/<runId>/summary.md`

## 发布前本地门禁

```bash
npm run alpha:gates
```

该命令会运行：

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `git diff --check`
- Alpha readiness 汇总

## 单样本 restricted-live

```bash
PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs \
  --project-id <project-id> \
  --figma-url "<figma-design-url>" \
  --mode restricted-live \
  --allow-figma-network \
  --runId <run-id> \
  --json
```

要求：

- `FIGMA_API_KEY` 已在环境中配置。
- Figma URL、file key、node id 不写入提交、报告正文或 Worktrail 正式知识。
- Product-M9 不调用 OpenAI。

## Preview

启动本地 Preview：

```bash
npm run preview:dev
```

Preview 用于查看 UISpec 渲染结果和基本交互状态。Alpha 范围内需要至少证明：

- 页面可加载。
- 导航 fixture 可执行。
- CHANGE_TO / variant 状态切换可执行。
- submit-like 行为在有 Figma 证据或用户确认时可执行。
- select/radio/checkbox/switch 等 DOM 控件可交互。

## 输出判读

- `status=passed`：可作为 Alpha 证据。
- `status=partial`：链路可运行但需要确认、补样本、修 target 或人工复核。
- `status=failed`：不可上线，先修复失败项。

Alpha 不要求未知 Figma 全量成功，但要求每个失败或 partial 都被清楚报告。
