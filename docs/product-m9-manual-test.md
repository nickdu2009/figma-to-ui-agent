# Product-M9 Manual Test

本文档用于人工或 coding agent 手动验证 Product-M9。默认流程不访问外部服务。

## 1. Local Smoke

```bash
node scripts/run-product-m9-flow.mjs \
  --project-id demo-project \
  --mode local \
  --flow-plan tests/fixtures/flow-plan/m8-form-submit-state-machine/flow-plan.json \
  --ui-spec tests/fixtures/flow-plan/m8-form-submit-state-machine/ui-spec.json \
  --reportRoot reports/product-m9 \
  --runId manual-local \
  --json
```

预期：

- 命令不需要 `FIGMA_API_KEY`。
- 命令不访问 Figma。
- 命令不调用 OpenAI。
- 输出 JSON 可被 `productM9RunResultSchema` 解析。
- `reports/product-m9/manual-local/summary.json` 存在。

注意：当前 fixture 包含一个 `inferred` submit 负例，因此 local smoke 可能返回 `partial / needs_confirmation`。这证明 fail-closed 边界生效，不代表 CLI 不可用。

## 2. Local Trusted Smoke

如需验证 `passed`，使用只包含可信 `figma` / `user_confirmed` interaction 的 FlowPlan fixture，或在测试中删除 `inferred-submit` 负例后运行。

预期：

- `ok=true`
- `status=passed`
- `metrics.successfulFixtureIds` 非空
- `error` 不存在

## 3. Restricted-Live Figma-Only Smoke

只有在明确授权 Figma REST 后运行。

```bash
PRODUCT_M9_FIGMA_AUTHORIZED=1 node scripts/run-product-m9-flow.mjs \
  --project-id product-m9-live-smoke \
  --figma-url "https://www.figma.com/design/<file-key>/<name>?node-id=<node-id>" \
  --mode restricted-live \
  --allow-figma-network \
  --reportRoot reports/product-m9 \
  --runId manual-restricted-live \
  --json
```

预期：

- 只调用 Figma REST。
- 不传任何 OpenAI gate。
- 不调用 OpenAI。
- 生成 DesignBundle、UISpec、FlowPlan artifact refs。
- 若真实样本缺少 prototype evidence，应返回 `partial`、`needs_confirmation` 或 `partial_evidence`，不得静默生成成功业务流。

## 4. Missing Gate Check

```bash
node scripts/run-product-m9-flow.mjs \
  --project-id product-m9-live-smoke \
  --file-key abcdefgh \
  --mode restricted-live \
  --json
```

预期：

- exit code 为 `3`。
- `error.category=auth_missing`。
- 不发生 Figma 网络访问。

## 5. Report Check

检查：

```bash
jq '{ok, status, mode, artifactRefs, metrics, error, nextAction}' \
  reports/product-m9/<runId>/summary.json
```

通过标准：

- `artifactRefs.summaryJson` 和 `artifactRefs.summaryMarkdown` 是相对路径。
- 若 `error.category=needs_confirmation`，`artifactRefs.confirmationQuestionsPath` 应指向可读取的 `confirmation-questions.json`。
- 若 `error.category=needs_confirmation`，`artifactRefs.confirmationAnswerTemplatePath` 应指向可读取的 `confirmation-answer-template.json`；该模板默认全部 `decline`，必须经确认后再改成业务答案。
- 报告不包含 token、真实 Figma URL、file key、raw REST payload 或本机绝对路径。
- `nextAction` 能指导下一步：修输入、补授权、等待限流、请求确认、人工复核或停止。

生成结构化确认答案时，优先使用 helper，而不是手写 JSON：

```bash
node scripts/write-product-m9-answers.mjs \
  --questions reports/product-m9/<runId>/confirmation-questions.json \
  --out reports/product-m9/<runId>/answers.json \
  --all \
  --kind decline \
  --reason "未确认业务行为，保持 fail-closed"
```

得到 `answers.json` 后，用原始 FlowPlan / UISpec 加 `--answers` 重跑 Product-M9。若要确认真实 submit 行为，必须显式提供 `--effect` 和至少一个 `--postcondition`。

## 6. 本地验证命令

```bash
npm exec -- vitest run \
  tests/unit/runtime/product-m9-flow-contracts.test.ts \
  tests/unit/runtime/product-m9-flow-service.test.ts \
  tests/integration/runtime/product-m9-flow-cli.test.ts

npm run typecheck
git diff --check
```
