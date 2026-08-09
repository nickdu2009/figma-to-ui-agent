# Product-M9 Agent Usage

Product-M9 是面向 PI / mono coding agent 的真实 FlowPlan 交付入口。它把本地或 restricted-live Figma 读取结果转成可审计的 FlowPlan artifact、执行摘要、稳定 JSON result 和下一步建议。

Product-M9 不调用 OpenAI，不新增 Pi 模型可见工具，不改变四工具边界。

## Local Smoke

本地模式不访问外部服务，适合 coding agent 做最小可用性验证。

```bash
node scripts/run-product-m9-flow.mjs \
  --project-id demo-project \
  --mode local \
  --flow-plan tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json \
  --ui-spec tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json \
  --json
```

成功或 partial 都会写入：

- `reports/product-m9/<runId>/summary.json`
- `reports/product-m9/<runId>/summary.md`
- `reports/product-m9/<runId>/flow-m11-summary.json`

## Restricted-Live Figma-Only

restricted-live 只允许 Figma REST，不允许 OpenAI。必须同时提供 CLI gate 和环境 gate。

```bash
PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs \
  --project-id demo-project \
  --figma-url "https://www.figma.com/design/<file-key>/<name>?node-id=<node-id>" \
  --mode restricted-live \
  --allow-figma-network \
  --json
```

运行前本地环境必须有 `FIGMA_API_KEY`。不要把 token、真实 Figma URL、file key 或原始 REST payload 写入报告、Worktrail 或提交信息。

## JSON Result

coding agent 应读取这些字段：

- `ok`：只有 `status=passed` 时为 `true`。
- `status`：`passed`、`partial` 或 `failed`。
- `mode`：`local` 或 `restricted-live`。
- `stages`：inspect、staticGeneration、flowPlanExtraction、confirmation、execution、report 的阶段状态。
- `artifactRefs`：DesignBundle、UISpec、FlowPlan、confirmation questions、answer template、confirmed FlowPlan、validation 和 summary 路径。
- `metrics`：trusted navigate/state-change、needs confirmation、unsupported、missing evidence、fixture ids。
- `error.category`：失败或 partial 的稳定分类。
- `nextAction`：agent 下一步动作。

## Error Categories

| category | Agent 行为 |
| --- | --- |
| `input_invalid` | 修正参数、URL、projectId 或 artifact ref 后重试。 |
| `auth_missing` | 补齐 Figma gate/token，或改用 local 模式。 |
| `figma_rate_limited` | 等待 Retry-After 或降低请求频率后重试。 |
| `figma_permission_denied` | 检查 Figma token 权限和文件访问权限。 |
| `figma_not_found` | 检查 Figma URL、fileKey 或 nodeId 后重试。 |
| `artifact_missing` | 先生成缺失 artifact，或指定正确 FlowPlan / UISpec 路径。 |
| `needs_confirmation` | 向用户展示 confirmation questions，等待结构化答案后重跑。 |
| `unsupported_figma_action` | 记录 unsupported，不猜测业务逻辑。 |
| `flow_execution_failed` | 查看 validation artifact，修复行为 fixture 或生成结果后重跑。 |
| `partial_evidence` | 查看 partial reasons，补样本、补确认或人工复核。 |
| `internal_error` | 上报实现缺陷，修复代码后再运行。 |

## Passed 与 Partial

`passed` 表示有可信 `figma` 或 `user_confirmed` FlowPlan 行为进入执行摘要，且没有阻断性 partial evidence。

`partial` 不是系统崩溃。它通常表示真实设计证据不足、需要用户确认、存在 unsupported Figma action，或只有部分 FlowPlan 可以安全执行。agent 不应把 partial 当成功交付，也不应自动编造业务逻辑。

当 `error.category=needs_confirmation` 时，优先读取 `artifactRefs.confirmationQuestionsPath`。该文件包含 `questionCount` 和 `questions[]`。同时读取 `artifactRefs.confirmationAnswerTemplatePath`，它是 schema-valid 的默认 `decline` 答案模板。agent 应把问题展示给用户，或在有明确授权的情况下生成结构化答案后用 `--answers <path>` 重跑；不要从按钮文案自行生成业务后置条件。

推荐用本地 helper 生成答案文件，避免手改 JSON：

```bash
node scripts/write-product-m9-answers.mjs \
  --questions reports/product-m9/<runId>/confirmation-questions.json \
  --out reports/product-m9/<runId>/answers.json \
  --all \
  --kind submit \
  --effect set_state \
  --state-key follow-status \
  --value true \
  --postcondition expect_visible:follow-success \
  --reason "用户确认该控件提交后显示 follow-success"
```

该 helper 只校验问题 id、允许的 answerKind 和 Flow-M10 answer schema；它不会推断业务语义。`--postcondition` 支持 `expect_page:<pageId>`、`expect_visible:<nodeId>`、`expect_text:<nodeId>:<text>`、`expect_value:<nodeId>:<value>`、`expect_checked:<nodeId>:true|false`、`expect_selected:<nodeId>:<value>`。

## Reports

`reports/product-m9/` 是运行证据目录。长期结论应通过 Worktrail validation 保存；不要把临时报告当作正式知识来源。
