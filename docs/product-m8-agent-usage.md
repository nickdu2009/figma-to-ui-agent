# Product-M8 Agent Usage Guide

本指南面向 PI / mono coding agent，说明如何以 CLI 调用 Figma-to-UI Agent 的 Product-M7 流程，并依据稳定的 JSON 结果与 `nextAction` 自主决定下一步。

> Product-M8 是 agent-facing 使用闭环，不新增 Figma 视觉保真阶段，也不扩展 FlowPlan 业务交互阶段。

## 1. 最小 CLI 调用

### 1.1 local 模式（默认，无外部服务）

```bash
node scripts/run-figma-to-ui.mjs \
  --project-id <project-id> \
  --designBundleRevision <revision> \
  --mode local \
  --json
```

local 模式仅读取本地 `data/projects/<project-id>/figma/` 中的 DesignBundle，不访问 Figma REST，也不调用 OpenAI。

### 1.2 restricted-live 模式（仅 Figma REST，无 OpenAI）

```bash
node scripts/run-figma-to-ui.mjs \
  --project-id <project-id> \
  --figma-url <https://www.figma.com/design/...> \
  --mode restricted-live \
  --allow-figma-network \
  --json
```

restricted-live 模式通过 Figma REST API 拉取设计并生成本地 DesignBundle / UISpec，**不会**调用 OpenAI。如需启用 OpenAI（full live），必须额外传入 `--allow-openai` 并单独授权 `GATE-PRODUCT-M8-OPENAI`。

### 1.3 live 模式（需要额外 gate）

```bash
node scripts/run-figma-to-ui.mjs \
  --project-id <project-id> \
  --figma-url <figma-url> \
  --mode live \
  --allow-figma-network \
  --allow-openai \
  --json
```

live 模式需要同时授权 Figma 网络与 OpenAI。未经授权不得默认启用。

## 2. 读取结果

当 `--json` 存在时，CLI 在 stdout 输出符合 `m7RunResultSchema` 的 JSON。关键字段：

- `ok`: `true` 表示流程成功完成。
- `error`: 失败时存在，包含 `category`、`message`、`recoverable`、`nextAction`。
- `nextAction`: agent 可直接执行的下一步建议。
- `artifacts.summaryJson` / `artifacts.summaryMarkdown`: 本地报告路径（相对于运行目录）。
- `input.mode`: 本次运行模式，可用于确认未误调用外部服务。

示例成功摘要：

```json
{
  "ok": true,
  "runId": "m7-run-001",
  "input": { "mode": "local", "designBundleRevision": 1 },
  "artifacts": {
    "summaryJson": "reports/m7-e2e/m7-run-001/summary.json",
    "summaryMarkdown": "reports/m7-e2e/m7-run-001/summary.md"
  },
  "nextAction": "M7 local 端到端流程完成；如需 live 验证，请单独授权 GATE-PRODUCT-M8-LIVE-FIGMA。"
}
```

## 3. Agent Decision Table

| `error.category` | 默认 `recoverable` | Retry Policy | Agent 下一步动作 |
|---|---|---|---|
| `input_invalid` | `true` | `retry_after_fix` | 修正 `figmaUrl`、`fileKey`、`nodeId`、`projectId`、`mode` 或 `designBundleRevision` 后重试。 |
| `auth_missing` | `true` | `retry_after_fix` | 检查环境变量 `FIGMA_API_KEY` 或 CLI gate（`--allow-figma-network`、`--allow-openai`）；补齐后重试，或改用 local 模式。 |
| `figma_permission_denied` | `true` | `retry_after_fix` | 检查 Figma token 权限和文件访问权限后重试。 |
| `figma_rate_limited` | `true` | `retry_after_wait` | 等待 `Retry-After` 或指数退避后重试；降低并发请求频率。 |
| `figma_not_found` | `true` | `retry_after_fix` | 核对 Figma URL、fileKey、nodeId 或 token 可访问的文件权限后重试。 |
| `bundle_generation_failed` | `true` | `manual_review` | 检查本地 ProjectStore 中是否存在对应 `projectId` 和 DesignBundle revision；修正后重试。 |
| `static_generation_partial` | `true` | `manual_review` | 查看 summary 中的 `warnings` / `unsupported`，补齐缺失能力后重跑 M7。 |
| `render_compare_failed` | `true` | `manual_review` | 查看 validation artifact 和 diff，修复视觉或渲染问题后重跑。 |
| `validation_failed` | `true` | `manual_review` | 查看 validation artifact 和 diff，修复视觉或渲染问题后重跑。 |
| `internal_error` | `false` | `do_not_retry` | 查看 `summary.md` 和 step trace，定位实现缺陷；不可自动重试，需人工介入或修复代码。 |

说明：

- `do_not_retry`：立即停掉当前自动循环，转人工/代码修复。
- `retry_after_fix`：agent 可在同一轮内根据 `error.message` 修正输入后重试。
- `retry_after_wait`：需要等待外部状态（Figma rate limit）恢复后再试。
- `manual_review`：建议 agent 把结果和 artifact refs 呈现给用户，等待确认后再继续。

## 4. Example Policy

所有示例与 fixtures 必须遵守：

1. **不得包含真实 token / secret**：示例中禁止出现 `figd_...`、`sk-...`、`OPENAI_API_KEY` 等实际值；所有占位符用 `<...>` 表示。
2. **必须能被 schema parse**：`tests/unit/runtime/product-m8-examples.test.ts` 会读取每个 fixture 并用 `m7RunResultSchema` 校验。
3. **保持最小化**：只包含足以说明该类结果的字段，不附加私有 payload 或 `.envrc` 内容。
4. **报告目录约定**：`reports/m7-e2e/` 为本地报告目录，已加入 `.gitignore`，不应提交。

## 5. Gate 与授权

| Gate | 含义 | 默认 |
|---|---|---|
| `GATE-PRODUCT-M8-LIVE-FIGMA` | 允许 live / restricted-live 模式调用 Figma REST | 关闭 |
| `GATE-PRODUCT-M8-OPENAI` | 允许 live 模式调用 OpenAI | 关闭 |
| `GATE-PRODUCT-M8-DEPS` | 允许新增依赖或修改 `package-lock.json` | 关闭 |
| `GATE-PRODUCT-M8-PI-TOOL` | 允许新增 PI tool 或修改 tool boundary | 关闭 |
| `GATE-PRODUCT-M8-GIT` | 允许提交、推送 | 关闭 |

默认实现边界：本地、无外部服务、无依赖变更、保持现有四 tool boundary、无 Git lifecycle。
