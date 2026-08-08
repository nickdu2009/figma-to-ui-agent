---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m11-m12-corpus-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Flow-M11/Flow-M12 corpus regression 验收结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m12"
}
---

# Figma-to-UI Agent Flow-M11/Flow-M12 corpus regression 验收结果

## 结论

本轮完成 Flow-M11 runner fixture-level 隔离修复、Flow-M11 restricted-live artifact supplemental 验证、Flow-M12 corpus/regression runner 与默认 5 样本矩阵实现。

当前 Flow-M12 结果是 `partial`，不是代码执行失败。原因是 Flow-M9 三个真实 restricted-live 样本历史报告只有 summary provenance，`flowPlanPath` 仍为 `ephemeral-flow-plan`，无法进入 Flow-M11 可执行链路。该缺口已被 Flow-M12 稳定分类为 `flow_plan_artifact_missing`。

## 本轮产物

- Flow-M11 restricted-live supplemental report：`reports/flow-m11-execution/flow-m11-restricted-live-fitness-supplement-20260808-r4/summary.json`
- Flow-M12 corpus report：`reports/flow-m12-corpus/flow-m12-corpus-20260808-r2/summary.json`
- Flow-M12 manifest：`tests/fixtures/flow-plan/m12-corpus/manifest.json`

## Flow-M11 结果

Fitness restricted-live artifact supplemental：

- status：`partial`
- mode：`restricted-live`
- figmaRestCalled：`false`
- openaiCalled：`false`
- fixtureCount：5
- successfulFixtureCount：5
- failedFixtureCount：0
- covered：真实 Figma `set_state` artifact 可执行
- partial reasons：缺少 trusted submit、多步骤 submit、select/radio/toggle 覆盖；该样本只适合作为 variant/state-change supplemental，不是 M11 完整 submit 样本。

## Flow-M12 结果

默认 corpus：

- status：`partial`
- sampleCount：5
- executableSampleCount：2
- passedExecutableSampleCount：1
- partialExecutableSampleCount：1
- failedExecutableSampleCount：0
- notExecutableSampleCount：3
- restrictedLiveSummarySampleCount：3
- coverage：navigate、setState、submit、stateMachine、selectRadioCheckbox、restrictedLiveSummary 全部为 true
- partial reason：`flow_m12_real_flowplan_artifacts_missing`

## 验证

已执行并通过：

- `npm run typecheck`
- `npm run test:unit`：60 files / 335 tests passed
- `PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm run test:integration`：19 files / 74 tests passed
- targeted：`PLAYWRIGHT_BROWSERS_PATH=data/playwright-browsers npm exec -- vitest run tests/integration/flow-plan/flow-m11-execution.test.ts tests/integration/flow-plan/flow-m12-corpus.test.ts --testTimeout=120000`：2 files / 3 tests passed

## 残留风险与下一步

- Flow-M12 已能稳定暴露真实样本的 artifact 缺口，但仍不能把 M9 summary-only 样本转为 M11 executable。
- 下一步应进入 Flow-M13 或 Flow-M12 follow-up：让 Flow-M9 restricted-live 在抽取时持久化 per-sample FlowPlan artifact，并让 M10 confirmation apply 输出可执行 FlowPlan artifact，随后重新跑 Flow-M12 corpus，使真实样本从 `not_executable` 变成 executable regression。
