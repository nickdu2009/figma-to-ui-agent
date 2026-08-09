---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "product-m9-restricted-live-mock-success-validation-19274ef",
  "scope": "project",
  "type": "validation",
  "title": "Product-M9 Restricted-Live Mock Success Validation 19274ef",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-product-m9-real-flowplan-agent-entry"
}
---

# Product-M9 Restricted-Live Mock Success Validation 19274ef

## 结论

Product-M9 T05 本地 mock restricted-live success 覆盖已补齐，并提交为 `19274ef Cover Product-M9 restricted-live mock success`。

本补丁修复了 Product-M9 restricted-live service 中 `figmaFetchImpl` 只注入 `FigmaRestClient`、未注入 `FigmaImageDownloader` 的测试性和一致性缺口。现在 mock REST success 会同时覆盖 Figma API 请求和 Figma 图片/截图下载请求，不会误触真实图片网络。

## 变更范围

- `src/runtime/product-m9-flow-service.ts`：将 `input.options.figmaFetchImpl` 传给 `FigmaImageDownloader`。
- `tests/unit/runtime/product-m9-flow-service.test.ts`：新增 restricted-live mock 200 success path，验证 DesignBundle、UISpec、FlowPlan artifact refs 生成，截图 URL 通过 mock fetch 下载，且结果不是 Figma 429/403/404 类错误。

## 验证命令

- `npm exec -- vitest run tests/unit/runtime/product-m9-flow-service.test.ts`：通过，8 tests passed。
- `npm exec -- vitest run tests/unit/runtime/product-m9-flow-contracts.test.ts tests/unit/runtime/product-m9-flow-service.test.ts tests/integration/runtime/product-m9-flow-cli.test.ts`：通过，3 files，15 tests passed。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- `git diff --check --cached`：提交前通过。

## Product-M9 覆盖影响

- 强化 AC3/T05：restricted-live Figma-only adapter 在本地 mock success 下可完成 artifact 生成链路。
- 强化 AC5/T05：429、403、404 错误映射仍由既有 parameterized tests 覆盖。
- 强化 AC6：mock success 验证 artifact refs 为相对可审计路径。
- 不改变 AC10 状态：真实 restricted-live Figma smoke 仍未执行，仍需显式 `GATE-PRODUCT-M9-FIGMA`。

## 外部调用边界

- Figma live REST：未调用。
- OpenAI：未调用。
- 新增依赖或 lockfile 修改：无。
- Pi 四工具边界修改：无。

## 残余风险

- mock success 使用本地 Figma fixture，只证明 adapter 和 artifact 生成路径，不等同于真实 Community Figma 样本验证。
- navigate-only mock success 当前返回 `partial_evidence`，因为 Product-M9 复用 Flow-M11 多步骤 submit 执行报告门槛；真实 AC10 仍应在明确 gate 后用真实 navigate/state-change 样本验证并记录结果。
