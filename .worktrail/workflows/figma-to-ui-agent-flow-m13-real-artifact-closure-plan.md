---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m13-real-artifact-closure-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M13 real FlowPlan artifact closure plan",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m13"
}
---

# Figma-to-UI Agent Flow-M13 real FlowPlan artifact closure plan

## 目标

关闭 Flow-M12 corpus 当前 `partial` 的主因：真实 restricted-live 样本在 Flow-M9/M10 阶段只留下 summary provenance，没有留下 Flow-M11 可执行的 FlowPlan artifact。

## 范围

- 不新增依赖。
- 不调用 OpenAI。
- 默认本地执行；真实 Figma 刷新仍需显式授权。
- 不改变四工具边界。
- 不把 token、真实 Figma URL、file key 或原始响应写入报告。

## 实施项

1. Flow-M9 restricted-live runner 在生成每个 readable sample 后保存 `ProjectStore.saveFlowPlan`，并在 sample report 的 `artifactRefs.flowPlanPath` 写入 `data/projects/<projectId>/flow/current.json`。
2. Flow-M10 confirmation runner 在 apply 用户确认后可选保存 confirmed FlowPlan artifact，并输出 `flowPlanArtifactRef`，供 Flow-M11/M12 消费。
3. Flow-M12 corpus manifest 优先引用真实 project store artifact；summary-only 样本只作为 provenance fallback，不能替代 executable artifact。
4. 重新跑 Flow-M12 corpus，验收条件是当前 artifact 缺失类 reason 消失，或剩余不可执行原因变成明确不可表达/不可访问，而不是 `flow_plan_artifact_missing`。

## 验收

- M9 local/restricted-live runner 测试覆盖 saved FlowPlan artifact refs。
- M10 confirmation 测试覆盖 confirmed artifact 输出。
- Flow-M12 默认 corpus 重新运行并输出新报告。
- `npm run typecheck`、相关 FlowPlan integration 测试、必要时 full integration 通过。
