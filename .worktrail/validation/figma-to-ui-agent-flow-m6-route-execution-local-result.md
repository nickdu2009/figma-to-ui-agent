---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m6-route-execution-local-validation",
  "scope": "project",
  "type": "validation",
  "title": "Flow-M6 route_execution_only 本地实现验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m6"
}
---

# Flow-M6 route_execution_only 本地实现验收记录

## 范围

本记录验收 Flow-M6 local 实现，范围限定为 `route_execution_only`：读取项目内已持久化 FlowPlan，将可信 `navigate` interaction 转换为 UISpec action 和 behavior fixture，并通过本地 Preview/Playwright 验证路由执行。

明确未做：不调用 Figma live，不调用 OpenAI，不新增依赖，不修改 package scripts，不修改模型可见四工具边界，不覆盖 M7 的状态、表单、submit 或业务状态切换。

## 实现落点

- `src/flow-plan/m6-report.ts`：新增 Flow-M6 独立报告 schema、验证摘要和解析入口。
- `src/flow-plan/route-execution.ts`：新增 M6 route-only 转换包装；非 `navigate` interaction 标记为 `flow_m6_non_navigate_out_of_scope`，不计入 Flow-M6 成功。
- `scripts/run-flow-m6.mjs`：新增本地 runner，读取 DesignBundle、UISpec、FlowPlan，按条件保存 UISpec、运行 render-and-compare，并输出 `summary.json` / `summary.md`。
- `tests/unit/flow-plan/m6-report.test.ts`：覆盖报告 schema 与验证摘要。
- `tests/unit/flow-plan/to-ui-spec.test.ts`：覆盖 M6 只转换 navigate、排除 set_state。
- `tests/integration/flow-plan/flow-m6-route-execution.test.ts`：覆盖通过路径和 partial 路径。

## 验证结果

- `npm run typecheck`：通过。
- `npx vitest run tests/unit/flow-plan/m6-report.test.ts tests/unit/flow-plan/to-ui-spec.test.ts tests/integration/flow-plan/flow-m6-route-execution.test.ts`：3 个测试文件通过，12 个用例通过。
- `npx vitest run tests/unit/flow-plan tests/integration/flow-plan/m4-flowplan.test.ts tests/integration/flow-plan/flow-m6-route-execution.test.ts`：11 个测试文件通过，29 个用例通过。
- `npm run test:unit`：44 个测试文件通过，267 个用例通过。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration`：12 个测试文件通过，53 个用例通过。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e`：6 个用例通过。

补充说明：未设置 `PLAYWRIGHT_BROWSERS_PATH` 时，完整 integration 中既有 M5 静态生成用例会尝试使用用户缓存中的 Playwright 浏览器并失败；设置项目内浏览器路径后通过。Flow-M6 聚焦测试自身已显式传入项目内 Chromium 路径。

## 验收结论

Flow-M6 local 的 route_execution_only 能力已具备本地闭环：可以读取已持久化 FlowPlan，转换可信 navigate，保存新的 UISpec revision，生成行为夹具，执行 Preview/Playwright 路由验证，并写出独立报告。非 navigate interaction 不会被算作 Flow-M6 成功。

## 残留风险

- Flow-M6 仍不覆盖状态切换、表单填写、submit、dialog 或复杂业务状态；这些属于 M7 后续范围。
- 当前验收为 local-only，未执行 restricted-live 或 live blind。
- 真实未知样本的 FlowPlan 质量仍依赖前置 Figma coverage、Generator fidelity 与 interaction extraction 能力。
