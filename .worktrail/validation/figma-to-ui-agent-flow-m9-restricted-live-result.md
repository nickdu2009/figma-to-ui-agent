---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m9-restricted-live-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M9 restricted-live 验收结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m9"
}
---

# Figma-to-UI Agent Flow-M9 restricted-live 验收结果

## 范围

本记录覆盖 Flow-M9 实施计划 T06/T08：在用户明确授权后，使用已配置的 `FIGMA_API_KEY` 对 3 个 primary Community 样本执行 restricted-live Figma REST 只读抽取，并生成脱敏 extraction report。

本次运行未调用 OpenAI，未新增依赖，未修改 package-lock，未改变四工具边界。运行前已显式 `unset OPENAI_API_KEY`，报告中的 `networkBoundary.openaiCalled=false`。

## 运行信息

- runId：`flow-m9-restricted-live-20260731t051320z`
- report：`reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.json`
- markdown report：`reports/flow-m9-restricted-live-extraction/flow-m9-restricted-live-20260731t051320z/summary.md`
- mode：`restricted-live`
- figmaRestCalled：`true`
- openaiCalled：`false`
- 样本清单：`tests/fixtures/figma/community-sample-manifest.json`

## 样本结果

| sampleId | accessStatus | interactionSource | trusted | needsConfirmation | unsupported | missingEvidence |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `community-mobile-001` | `readable` | `present` | 5 | 0 | 4 | 0 |
| `community-design-system-001` | `readable` | `present` | 0 | 5 | 0 | 1 |
| `community-login-001` | `readable` | `absent` | 0 | 3 | 0 | 1 |

## 聚合结果

- status：`passed`
- totalSamples：3
- readableSamples：3
- trustedNavigate：0
- trustedStateChange：5
- submitLikeNeedsConfirmation：8
- unsupported：4
- missingEvidence：2
- notAccessible：0
- reasons：无

## 验收判断

- AC1/Schema：已由 `src/flow-plan/m9-report.ts` 和本次 `summary.json` 证明。
- AC2/Samples：3 个 primary 样本均来自 manifest，且均为 `rest_readable_node_selected`。
- AC3/CHANGE_TO：`community-mobile-001` 抽取到 5 个可信 `trusted.set_state`。
- AC4/诊断分类：不可表达的 CHANGE_TO 进入 `unsupported`，缺目标/缺 prototype 进入 `missingEvidence`。
- AC5/Restricted-live gate：本次运行显式使用 `FLOW_M9_RESTRICTED_LIVE_AUTHORIZED=1`、`FIGMA_API_KEY` 和 `--allow-figma-network`。
- AC6/本地 mock：此前本地验收已覆盖 navigate、set_state、submit-like needs_confirmation、unsupported、missing evidence。
- AC7/脱敏：对 `summary.json` 扫描未发现 Figma token、OpenAI token、真实 Figma design URL、`fileKey`、`designUrl` 或 `rawResponse`。
- AC8/样本：3 个 primary 样本已完成 restricted-live 抽取。
- AC9/Validation：本记录作为 restricted-live 验收候选。
- AC10/失败保留：本次无失败；报告已作为独立 runId 产物保留，不覆盖其它 run。

## 残留风险

- Flow-M9 只证明真实 Figma interaction 抽取与分类；submit-like 业务语义仍需 Flow-M10 用户确认。
- Community 文件权限和结构可能随时间变化，后续复跑可能出现 `not_accessible` 或分类漂移。
- 本次 primary 样本没有产生 `trusted.navigate`，但完成定义要求的是至少 1 个可信 FlowPlan 候选；本次由 `trusted.set_state=5` 满足。

## 结论

Flow-M9 restricted-live 首轮通过。结合已推广的本地实现验收记录，Flow-M9 实施计划的最低完成定义已经满足。
