# Product-M8 Manual Test Guide

本手册说明如何手动验证 Product-M8 的 agent usage loop。所有步骤默认不需要调用 OpenAI；restricted-live 步骤仅访问 Figma REST，需单独授权。

## 1. 环境准备

```bash
npm ci --ignore-scripts --audit=false --fund=false
```

确认本地工具边界未被修改：

```bash
git diff --name-status -- src/runtime/tool-boundary.ts scripts/start-agent.mjs package-lock.json
# 预期输出为空
```

## 2. local smoke

local 模式不访问 Figma REST，也不调用 OpenAI。需要本地已存在一个 project 和 DesignBundle revision。

```bash
node scripts/run-figma-to-ui.mjs \
  --project-id demo \
  --designBundleRevision 1 \
  --mode local \
  --json
```

预期结果：

- stdout 输出 JSON，字段 `ok` 为 `true`。
- `input.mode` 为 `"local"`。
- `nextAction` 提示 local 完成。
- 报告写入 `reports/m7-e2e/<runId>/summary.json` 和 `summary.md`。

若 `demo` project 不存在，可参考 `tests/integration/runtime/e2e-flow-cli.test.ts` 中的 fixture 创建方式，用 ProjectStore 初始化并保存一个 DesignBundle。

## 3. restricted-live Figma-only smoke

restricted-live 模式通过 Figma REST 读取设计并生成本地产物，**不调用 OpenAI**。必须设置 `FIGMA_API_KEY` 并传入 `--allow-figma-network`，**不得**传入 `--allow-openai`。

```bash
export FIGMA_API_KEY=<your-figma-token>

node scripts/run-figma-to-ui.mjs \
  --project-id demo \
  --figma-url "https://www.figma.com/design/<file-key>/<name>?node-id=<node-id>" \
  --mode restricted-live \
  --allow-figma-network \
  --json
```

预期结果：

- stdout 输出 JSON，字段 `ok` 为 `true`（在文件可访问的情况下）。
- `input.mode` 为 `"restricted-live"`。
- `nextAction` 明确说明未调用 OpenAI。
- 命令行没有 `--allow-openai` 参数。

## 4. 确认未调用 OpenAI

同时满足以下三点即可确认本次运行未调用 OpenAI：

1. CLI 命令中**没有** `--allow-openai`。
2. 结果 JSON 中 `input.mode` 为 `"local"` 或 `"restricted-live"`（不是 `"live"`）。
3. restricted-live 成功时 `nextAction` 包含“未调用 OpenAI”。

验证示例：

```bash
node scripts/run-figma-to-ui.mjs \
  --project-id demo \
  --designBundleRevision 1 \
  --mode local \
  --json | grep -v OPENAI_API_KEY
```

## 5. 读取 summary 与 artifact refs

运行结束后，读取报告目录中的 summary：

```bash
ls reports/m7-e2e/<runId>/
cat reports/m7-e2e/<runId>/summary.md
```

关键字段：

- `artifacts.summaryJson` / `artifacts.summaryMarkdown`: 报告路径。
- `artifacts.designBundleRef`: DesignBundle revision 引用。
- `artifacts.uiSpecRef`: UISpec revision 引用。
- `artifacts.validationRef`: 仅在 `--run-compare` 通过时存在。
- `metrics.pages`: 生成页面数。
- `metrics.warnings` / `metrics.unsupported`: 需要人工 review 的项。

## 6. 失败路径快速验证

无需真实 Figma 即可验证失败 JSON 的 agent 决策：

```bash
# input_invalid
node scripts/run-figma-to-ui.mjs --json
# 预期 exit code 2

# auth_missing（restricted-live 未授权）
node scripts/run-figma-to-ui.mjs \
  --project-id demo \
  --figma-url "https://www.figma.com/design/abc12345/demo" \
  --mode restricted-live \
  --json
# 预期 exit code 3
```

## 7. Reports 策略

- 所有 M7/M8 本地报告默认写入 `reports/m7-e2e/`。
- 该目录已加入 `.gitignore`，不应提交到版本库。
- 需要保留的证据应复制到 `reports/` 下受控目录或 Worktrail candidate 中。

## 8. 检查清单

- [ ] local smoke 成功，`input.mode === "local"`。
- [ ] restricted-live smoke 命令未传 `--allow-openai`，`nextAction` 说明未调用 OpenAI。
- [ ] 报告正确写入 `reports/m7-e2e/<runId>/`。
- [ ] `git status --ignored --short reports/m7-e2e` 显示该目录被忽略，不会被提交。
- [ ] `src/runtime/tool-boundary.ts` 与 `scripts/start-agent.mjs` 无改动。
