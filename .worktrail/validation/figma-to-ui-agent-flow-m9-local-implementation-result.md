---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m9-local-implementation-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M9 本地实现验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m9"
}
---

# Figma-to-UI Agent Flow-M9 本地实现验收记录

## 范围

本记录覆盖 Flow-M9 实施计划的本地实现部分：report schema、Community sample manifest reader、interaction extraction classifier、local/mock runner、restricted-live gate 和本地回归验证。

本次未执行真实 Figma restricted-live 样本运行，未调用 OpenAI，未新增依赖，未修改 package-lock，未改变四工具边界。

本记录修订并取代较早的 pending validation candidate `figma-to-ui-agent-flow-m9-20260731t031846z`，因为后续补充了 `trusted.navigate` 与 restricted-live 三重 gate 测试，验证计数已更新。

## 已实现内容

- 新增 `src/flow-plan/m9-report.ts`：Flow-M9 extraction report schema、aggregate 复算、passed/partial/failed 状态规则、redaction check。
- 新增 `src/flow-plan/m9-samples.ts`：Community sample manifest 解析、primary 样本筛选、显式 sampleId 选择和 skip reason。
- 新增 `src/flow-plan/m9-extractor.ts`：基于 DesignBundle prototypeInteractions 与 FlowPlan interaction 的分类器。
- 新增 `scripts/run-flow-m9-restricted-live.mjs`：支持 local 模式和 restricted-live gate；local 模式不访问网络，restricted-live 需要 `FLOW_M9_RESTRICTED_LIVE_AUTHORIZED=1`、`FIGMA_API_KEY` 和 `--allow-figma-network`。
- runner 对进入 report 的异常诊断做脱敏，避免真实 Figma URL、token 或 OpenAI token 出现在报告中。
- 新增单元测试：M9 report、sample reader、extractor。
- 新增集成测试：M9 runner local 多样本报告、报告脱敏、restricted-live gate fail-closed。

## 分类覆盖

- `trusted.navigate`：Figma `NAVIGATE` 且目标可映射到 FlowPlan page。
- `trusted.set_state`：Figma `CHANGE_TO` 且目标可映射为 UISpec state。
- `needs_confirmation.submit_like`：login/register/checkout/pay/save/continue 等 submit-like 线索只进入需确认，不生成业务 submit action。
- `unsupported`：当前 FlowPlan/UISpec 无法安全表达的 interaction。
- `missing_evidence`：样本可读但缺 prototype interaction、目标缺失或目标页面不可映射。
- `not_accessible`：样本无法读取、权限/locator/runner 加载失败。

## 验证命令与结果

- `npm run typecheck`：通过。
- `npm exec -- vitest run tests/unit/flow-plan/m9-report.test.ts tests/unit/flow-plan/m9-samples.test.ts tests/unit/flow-plan/m9-extractor.test.ts tests/integration/flow-plan/flow-m9-restricted-live-runner.test.ts`：4 个测试文件通过，14 个测试通过。
- `npm run test:unit`：52 个测试文件通过，313 个测试通过。
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm exec -- vitest run tests/integration --testTimeout=30000`：16 个测试文件通过，69 个测试通过。

## 额外观察

默认 `npm run test:integration` 仍可能因本机 Playwright 默认 cache 路径或浏览器集成测试 5s 超时波动失败。使用项目内 `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers` 并设置 30s test timeout 后完整 integration 通过。该问题不是 Flow-M9 代码变更导致。

## 未完成内容

Flow-M9 计划中的 T06 restricted-live 首轮真实样本运行尚未执行，因为真实 Figma 网络调用需要显式 gate。待用户授权后，首轮样本应按已 promote 的样本清单执行：`community-mobile-001`、`community-design-system-001`、`community-login-001`，必要时扩展 `community-ecommerce-001`、`community-dashboard-001`。

## 结论

Flow-M9 本地实现部分通过验收；真实 restricted-live 样本运行仍是后续门禁项，不能把当前结果宣称为完整 Flow-M9 最终收口。
