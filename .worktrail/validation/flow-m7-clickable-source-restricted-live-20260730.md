---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "flow-m7-clickable-source-restricted-live-validation-20260730",
  "scope": "project",
  "type": "validation",
  "title": "Flow-M7 clickable-source restricted-live validation",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m7-restricted-live"
}
---

# Flow-M7 clickable-source restricted-live validation

## 结论

Flow-M7 clickable-source 覆盖修复后，Fitness restricted-live r4 验证通过。

本验证证明：真实 Figma REST prototype `CHANGE_TO` interaction 可以转换为 UISpec `set_state` action，并在本地 Preview 中完成真实 DOM 点击与显隐后置断言。验证过程未调用 OpenAI。

## 验证输入

- 样本：Fitness App UI Kit restricted-live 样本。
- 模式：restricted-live。
- 外部服务：仅 Figma REST。
- OpenAI：未调用。
- runId：`fitness-clickable-source-r4-20260730t104000z`。
- projectId：`flow-m7-fitness-clickable-source-r4`。
- 报告：`reports/flow-m7-restricted-live-extraction/fitness-clickable-source-r4-20260730t104000z/summary.json`。

## 关键结果

- `status`：`passed`。
- `trustedNonRouteConverted`：`5`。
- `scenarioOnlyFixtures`：`0`。
- `submitLikeVerified`：`0`。
- `unresolved`：`4`。
- `validation.passed`：`true`。
- `failedCheckCount`：`0`。
- 成功行为夹具数：`5`。
- 失败行为夹具数：`0`。

## 已验证能力

- Figma 子 `vector` 上的 prototype click 可以向上回溯到祖先结构化控件。
- `stack`、`switch` 等非 button/link 点击源可以绑定 `actionId` 并执行 `press -> dispatch`。
- `CHANGE_TO` 可以转换为可信 `set_state` action。
- 同一页面多个 independent variant state 不再互相隐藏父容器。
- Preview console、keyboard、visual、functional checks 均通过。

## 本轮修复摘要

- UISpec contract 允许 `stack`、`checkbox`、`radio`、`switch` 绑定 `actionId`。
- Preview adapter 为上述节点输出 action binding。
- Preview components 对 actionable stack 和表单控件发出 `press` 事件。
- FlowPlan interaction candidate 映射支持大小写不敏感 ID 查找和祖先节点回溯。
- FlowPlan apply 阶段支持把 action 写回 `stack` / form controls。
- Variant clone 边界修正：actionable `stack` 触发 variant 时只替换自身，不隐藏父容器。
- Preview HTML 添加空 favicon，避免浏览器默认 `/favicon.ico` 404 污染 console validation。

## 验证命令

```bash
npm run typecheck
npm run test:unit
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration
PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:e2e
FLOW_M7_RESTRICTED_LIVE_AUTHORIZED=1 PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers node scripts/run-flow-m7-restricted-live.mjs \
  --project-id flow-m7-fitness-clickable-source-r4 \
  --run-id fitness-clickable-source-r4-20260730t104000z \
  --figma-url '<redacted-figma-design-url>' \
  --allow-figma-network \
  --save-flow-plan \
  --save-ui-spec \
  --run-compare \
  --browser-executable-path 'data/playwright-browsers/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
```

## 残余风险

- 本验证仍不覆盖 submit-like 表单提交、checkout、登录等业务动作；这些应进入 Flow-M8。
- 有 `4` 个 Figma interaction 被保留为 unresolved，原因是对应目标仍无法安全表示为 UISpec action。
- restricted-live 样本覆盖 state switch / variant 切换，不代表所有 Figma prototype 类型均已覆盖。
