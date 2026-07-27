---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-product-m7-smoke-addendum",
  "scope": "project",
  "type": "validation",
  "title": "Product-M7 Restricted-Live Smoke Addendum",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-product-m7-smoke"
}
---

# Product-M7 Restricted-Live Smoke Addendum

## 1. 结论

Product-M7 本地产品化主流程已补充完成 restricted-live Figma-only smoke test。该 smoke test 证明：在只授权 Figma 网络 gate、未授权 OpenAI gate 的情况下，M7 CLI 可以读取真实 Figma 文件，生成本地 DesignBundle / UISpec，并输出稳定 JSON 与 summary 报告。

该 addendum 补充此前 `M7 E2E Productized Flow Validation` 中未包含的 restricted-live 运行证据。

## 2. Gate 边界

本次 smoke test 的授权边界：

- 已授权：Figma REST 网络访问 gate。
- 未授权：OpenAI gate。
- 未执行：full live OpenAI path。
- 未执行：视觉 render-and-compare。
- 未执行：Git push。

## 3. 执行命令

```bash
source .envrc >/dev/null 2>&1
node scripts/run-figma-to-ui.mjs \
  --figma-url "https://www.figma.com/design/UaOVzXZynd9Ir8JZB8OcQ4/LoginUIConcept--Community-?node-id=0-1" \
  --project-id m7-restricted-live-login-smoke \
  --mode restricted-live \
  --allow-figma-network \
  --reportRoot reports/m7-e2e \
  --runId m7-restricted-live-login-smoke-r2 \
  --json
```

## 4. 结果摘要

- `ok: true`
- `runId: m7-restricted-live-login-smoke-r2`
- `projectId: m7-restricted-live-login-smoke`
- `mode: restricted-live`
- `fileKey: UaOVzXZynd9Ir8JZB8OcQ4`
- `nodeId: 0:1`
- `designBundleRevision: 2`
- `designBundleRevisionSource: generated`
- `designBundleRef: project:m7-restricted-live-login-smoke:designBundle:2`
- `uiSpecRef: project:m7-restricted-live-login-smoke:uiSpec:2`
- `summaryJson: reports/m7-e2e/m7-restricted-live-login-smoke-r2/summary.json`
- `summaryMarkdown: reports/m7-e2e/m7-restricted-live-login-smoke-r2/summary.md`
- `pages: 3`
- `passedPages: 3`
- `warnings: 0`
- `unsupported: 0`
- `validation.status: skipped`
- `validation.reason: render_compare_not_requested`

## 5. Step Trace

通过的步骤：

- `validate_input`
- `create_run_context`
- `acquire_design`
- `generate_ui_spec`
- `save_ui_spec`
- `write_report`

跳过的步骤：

- `render_compare`，原因：`render_compare_not_requested`。

## 6. 报告目录策略

`reports/m7-e2e/` 是本地运行报告目录，默认不作为 Git 提交对象。长期证据以 Worktrail validation 文档为入口；本地报告目录可按运行需要保留或清理。

当前应提交的正式知识是本 addendum promote 后生成的 `.worktrail/validation/...` 文件，不应顺带提交 `reports/m7-e2e/`。

## 7. 后续影响

Product-M7 现在具备两类正式验证证据：

- local mode：本地 DesignBundle revision 输入、生成 UISpec、输出 summary。
- restricted-live mode：真实 Figma 读取、生成本地 DesignBundle / UISpec、输出 summary，未调用 OpenAI。

仍未完成的范围：

- full live OpenAI path。
- Product-M8：PI / mono coding agent 使用闭环。
- Flow-M6 / Flow-M7：业务 flow、路由、状态、表单和简单业务交互。
