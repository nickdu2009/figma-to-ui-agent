# Product-M8 Agent Usage Loop Validation

## 实现范围

- `docs/product-m8-agent-usage.md`：agent decision table 覆盖全部 10 个 `M7RunErrorCategory`，示例策略与 gate 说明。
- `docs/product-m8-manual-test.md`：local / restricted-live 手动流程、确认未调用 OpenAI 的方法、summary 读取、reports 策略。
- `scripts/run-figma-to-ui.mjs`：CLI help 增加 Product-M8 说明、local / restricted-live / live 最小示例、gate 说明与 summary path 提示。
- `tests/fixtures/product-m8/*.json`：7 个 JSON fixtures（2 成功 + 5 关键失败）。
- `tests/unit/runtime/product-m8-examples.test.ts`：schema parse、exit code、secret scan、decision table 覆盖测试。
- `tests/integration/runtime/e2e-flow-cli.test.ts`：扩展 help 断言并新增 unknown argument exit code 2 测试。

## 验证结果

```bash
npm run typecheck              # 通过
npm run test:unit              # 43 files, 263 tests 通过
npm run test:integration       # 11 files, 51 tests 通过
npm run test:e2e               # 6 tests 通过
npx vitest run tests/unit/runtime/product-m8-examples.test.ts      # 通过
npx vitest run tests/integration/runtime/e2e-flow-cli.test.ts      # 通过
```

## 未调用外部服务声明

本次实现与验证仅使用本地文件、mock 和已有 fixtures；未调用 Figma live API、OpenAI 或任何外部服务。未新增依赖，未修改 package-lock.json，未改动 src/runtime/tool-boundary.ts 和 scripts/start-agent.mjs。

## AC 覆盖

- AC1：CLI help 与 manual doc 给出 local 最小调用。
- AC2：manual doc 与 usage guide 说明 restricted-live Figma-only 调用方式和 gate。
- AC3：成功 fixtures 通过 `m7RunResultSchema` parse。
- AC4：失败 fixtures 覆盖 `input_invalid`、`auth_missing`、`figma_rate_limited`、`figma_permission_denied`、`figma_not_found`。
- AC5：decision table 覆盖所有 `M7RunErrorCategory`。
- AC6：manual doc 明确如何确认未调用 OpenAI。
- AC7：`.gitignore` 已忽略 `reports/m7-e2e/`，文档已明确。
- AC8：tool boundary 保持现有四工具不变。
- AC9：typecheck 与本地 targeted tests 通过。
- AC10：本 validation candidate 记录实现范围与结果。

## 仍需 gate 的验证

- `GATE-PRODUCT-M8-LIVE-FIGMA`：restricted/live 模式真实 Figma REST 端到端验证。
- `GATE-PRODUCT-M8-OPENAI`：live 模式真实 OpenAI 调用验证。
- `GATE-PRODUCT-M8-DEPS`：若后续需要新增依赖。
- `GATE-PRODUCT-M8-PI-TOOL`：若需要新增 PI tool。
- `GATE-PRODUCT-M8-GIT`：提交 / 推送。

## 推荐下一步

用户/审阅者确认后 promote 本 candidate；如需真实 Figma/OpenAI 验证，单独开启对应 gate。
