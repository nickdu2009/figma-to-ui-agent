---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-m7-e2e-productized-flow-validation",
  "scope": "project",
  "type": "validation",
  "title": "M7 E2E Productized Flow Validation",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-m7-e2e-productized-flow"
}
---

# M7 E2E Productized Flow Validation

## 验证结论

M7 CLI-first 端到端产品化主流程已完成本地实现与本地验证。验证范围不调用 Figma、OpenAI 或其他外部服务，不执行 Git lifecycle。

## 实现范围

- 新增本地可执行入口：`scripts/run-figma-to-ui.mjs`。
- 新增 package script：`npm run run:m7:e2e`。
- 新增 runtime 契约：`src/runtime/e2e-flow-contracts.ts`。
- 新增 runtime service：`src/runtime/e2e-flow-service.ts`。
- 新增 summary 报告写入：`src/runtime/e2e-flow-report.ts`。
- 支持 `local`、`restricted-live`、`live` 三种 mode。
- local mode 从本地 ProjectStore 读取 DesignBundle，不访问外部服务。
- restricted-live/live 对 Figma/OpenAI gate fail-closed。
- live 输入支持完整 Figma URL，也支持 `fileKey + nodeId`。
- 失败结果使用稳定错误分类，并保留已规范化的可诊断输入。
- mock 429 被映射为 `figma_rate_limited`，并通过 Figma REST rate-limit logger 记录事件。

## 本地样本证据

执行命令：

```bash
node scripts/run-figma-to-ui.mjs --project-id community-v2-login-001-retry --mode local --designBundleRevision 1 --dataRoot data/community-corpus-v2 --reportRoot reports/m7-e2e --runId m7-local-community-login-r2 --json
```

结果摘要：

- `ok: true`
- `runId: m7-local-community-login-r2`
- `projectId: community-v2-login-001-retry`
- `designBundleRevision: 1`
- `designBundleRevisionSource: explicit`
- `designBundleRef: project:community-v2-login-001-retry:designBundle:1`
- `uiSpecRef: project:community-v2-login-001-retry:uiSpec:2`
- `summaryJson: reports/m7-e2e/m7-local-community-login-r2/summary.json`
- `summaryMarkdown: reports/m7-e2e/m7-local-community-login-r2/summary.md`
- `pages: 1`
- `passedPages: 1`
- `warnings: 0`
- `unsupported: 0`
- `validation.status: skipped`
- `validation.reason: render_compare_not_requested`

## 自动化验证

通过项：

```bash
npm run typecheck
npx vitest run tests/unit/runtime/e2e-flow-contracts.test.ts tests/unit/runtime/e2e-flow-report.test.ts tests/unit/runtime/e2e-flow-service.test.ts tests/integration/runtime/e2e-flow-cli.test.ts
npm run test:unit
npm run test:integration
```

测试结果：

- typecheck 通过。
- M7 targeted tests：4 files，16 tests，通过。
- unit：42 files，260 tests，通过。
- integration：11 files，50 tests，通过。

备注：第一次全量 integration 中 `tests/integration/validation/render-and-compare.test.ts` 有一个 5s timeout；随后该文件单独重跑通过，全量 integration 再跑通过，判断为渲染/启动时序抖动，不是 M7 代码回归。

## 边界验证

- 未修改 `src/runtime/tool-boundary.ts`。
- 未修改 `scripts/start-agent.mjs`。
- 未修改 `package-lock.json`。
- 未新增依赖。
- 未调用 Figma REST live probe。
- 未调用 OpenAI。

## 尚未执行

- 未执行 live Figma/OpenAI 验证；需要单独授权 `GATE-M7-LIVE-FIGMA` / OpenAI gate。
- 未执行 Git commit/push；Git lifecycle 需单独授权。
