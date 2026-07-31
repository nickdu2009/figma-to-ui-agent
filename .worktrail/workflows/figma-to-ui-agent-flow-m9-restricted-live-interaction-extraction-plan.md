---
id: figma-to-ui-agent-flow-m9-restricted-live-interaction-extraction-plan
status: draft
scope: project
topic: figma-to-ui-agent-flow-m9
kind: workflow
---

# Figma-to-UI Agent Flow-M9 restricted-live interaction 抽取实施计划

## 目标

Flow-M9 要把 Flow-M7/M8 已有的本地交互能力，向真实 Figma prototype 数据推进一步：从真实 Community 样本读取 prototype interactions，生成可审计的 interaction extraction report，并把可信交互转换为 FlowPlan 候选。

本阶段不追求完整业务语义自动推断；submit-like、checkout、auth 等缺少明确 Figma 目标节点或语义证据的行为必须标记为 `needs_confirmation`，交给 Flow-M10。

## 约束

- 默认本地实现，不调用 OpenAI。
- 默认不访问 Figma；restricted-live 必须显式设置 `FLOW_M9_RESTRICTED_LIVE_AUTHORIZED=1`、`FIGMA_API_KEY` 和 `--allow-figma-network`。
- 不新增依赖，不修改 package-lock，不执行 Git lifecycle，除非单独授权。
- 不改变四工具边界。
- Worktrail 中不写真实 Figma URL、file key、token、原始响应正文或 UI Spec 正文。

## 验收标准

- AC1：有版本化的 Flow-M9 extraction report schema，能表达样本、节点、interaction、分类、置信度、证据摘要和 unsupported reason。
- AC2：样本读取只接受 manifest 中 `rest_readable_node_selected` 的样本作为 primary restricted-live 输入。
- AC3：`CHANGE_TO` 能被分类为可信 `set_state` 候选，`NAVIGATE` 且目标明确时能分类为可信 `navigate` 候选。
- AC4：目标缺失、语义不足、不可访问节点、未知 navigation 类型必须进入可诊断分类，不得静默丢弃。
- AC5：restricted-live runner 具备硬门禁，未授权时 fail closed。
- AC6：本地 mock 测试覆盖 navigate、set_state、submit-like needs_confirmation、unsupported、missing evidence。
- AC7：报告输出不泄露 token、file key、原始 URL、原始 Figma 响应正文。
- AC8：至少准备 3 个 primary 样本，推荐扩展到 5 个，以覆盖 variant、auth、checkout、dashboard/landing 导航类场景。
- AC9：完成后生成 Worktrail validation 候选记录本地测试结果和 restricted-live 结果。
- AC10：任何真实 Figma 网络调用失败都必须保留诊断报告，不覆盖已有有效产物。

## 实施任务

1. T00 基线检查：检查 git 状态、Flow-M8 结果、Flow-M7 restricted-live 记录、四工具边界；只读，不修改文件。
2. T01 报告 Schema：新增或扩展 `src/flow-plan/m9-report.ts` 与单元测试。
3. T02 样本 Manifest Reader：新增 `src/flow-plan/m9-samples.ts`，筛选 primary 样本并记录 skip reason。
4. T03 Interaction 分类器：新增或扩展 `src/flow-plan/m9-extractor.ts`，复用 `interaction-candidates.ts`。
5. T04 本地 Mock Runner：新增 `scripts/run-flow-m9-restricted-live.mjs` 的 mock 模式和 integration 测试。
6. T05 Restricted-live Gate：加入授权变量、API key、CLI flag 三重门禁，缺任一条件 fail closed。
7. T06 样本矩阵首轮运行：先跑 `community-mobile-001`、`community-design-system-001`、`community-login-001`，再扩展 `community-ecommerce-001`、`community-dashboard-001`。
8. T07 回归门禁：运行 `npm run typecheck`、`npm run test:unit`、`npm run test:integration`；视变更面决定是否跑 e2e。
9. T08 Worktrail Validation：写入本地和 restricted-live 的 validation pending candidate，只记录脱敏摘要。

## 回滚策略

- Schema 或 runner 不稳定时，保持 Flow-M8 已提交能力不变。
- restricted-live 失败不得影响本地 mock 测试和已生成的上一个有效报告。
- 如真实样本权限变化，样本进入 `not_accessible`，不把权限失败解释成 FlowPlan 能力失败。

## 完成定义

Flow-M9 完成的最低标准是：本地 mock 全通过，restricted-live 至少跑通 3 个 primary 样本，报告能稳定区分可信 FlowPlan 候选、需确认候选和 unsupported/missing evidence，并有 Worktrail validation 记录。
