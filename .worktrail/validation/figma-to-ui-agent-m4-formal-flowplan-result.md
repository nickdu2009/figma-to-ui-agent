---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "validation-figma-to-ui-agent-m4-formal-flowplan-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent M4 正式 FlowPlan 验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M4 正式 FlowPlan 验收记录

## 结论

M4 正式 FlowPlan 实施计划已在本地完成并通过验证。当前实现证明：FlowPlan 已从 spike-only 草案升级为正式 schema、ProjectStore artifact、跨回合确认记录、受控 UISpec 转换输入、inspect_figma 结构化输出，以及本地 runner/report 验证链路。

该结论只覆盖 M4：FlowPlan 契约、持久化、确认和受控转换。它不表示 M5 多 artboard 静态生成、M6 多页面行为自动探索或 M7 复杂业务流已经完成。

## 实现范围

- 新增正式 FlowPlan schema 和 service。
- ProjectStore 支持 flow/current.json 与 flow/history/*.json，并复用 revision CAS、history/current、atomic publish。
- FlowPlan 保存前校验当前 DesignBundle 引用；若声明 sourceUISpecRevision，则校验对应 UISpec history 存在且 projectId 匹配。
- UISpec 支持可选 sourceFlowPlanRevision，并在 ProjectStore 保存时校验引用的 FlowPlan revision 存在且 projectId 匹配。
- FlowPlan builder 支持 DesignBundle、可选 UISpec 和可选 InteractionSupplement；无 supplement 时记录 figmaInteractionSource: absent。
- 用户确认通过 flowConfirmations 进入 inspect_figma，合法答案可转为 user_confirmed，非法或缺失答案保持未决并 fail closed。
- FlowPlan 到 UISpec 只转换 source 为 figma 或 user_confirmed 且 confirmed 为 true 的 interaction；inferred 和 missing 不生成 action。
- 受控转换支持 navigate、set_state、open_dialog 三类 intent。
- inspect_figma 输出 FlowPlan revision、summary、pending confirmationQuestions 和 unresolvedInteractionCount。
- 模型可见工具集合保持不变：inspect_figma、load_ui_spec、save_ui_spec、render_and_compare。
- 新增正式本地 runner scripts/run-m4-flowplan.mjs；保留 spike runner 作为迁移参考。

## 验证证据

本地验证通过：

- npm run typecheck：passed。
- npm run test:unit：29 files / 150 tests passed。
- npm run test:integration：8 files / 41 tests passed。

定向覆盖包括：

- FlowPlan schema：正式 schemaVersion 为 1，拒绝 m4-spike 被当成正式 FlowPlan；拒绝 unknown source / intent / figmaInteractionSource；inferred/missing 不能被标记为 confirmed。
- FlowPlan service：无 supplement 时生成 pending questions；有 supplement 时生成可信 figma interaction；合法确认变成 user_confirmed；非法确认记录 invalid 且不生成 trusted interaction。
- ProjectStore：FlowPlan current/history/CAS、revision conflict、缺失或陈旧 DesignBundle/UISpec 引用、UISpec sourceFlowPlanRevision 引用校验。
- Converter：正式 FlowPlan 写入 sourceFlowPlanRevision；只转换已确认可信 interaction；未确认 inferred/missing 留在 unresolved。
- Tool contract：inspect_figma 接受 flowConfirmations，输出 FlowPlan summary/questions；TypeBox 参数包含 flowConfirmations。
- Extension wiring：active tools 仍等于 EXACT_TOOL_NAMES，inspect result 保留 FlowPlan 字段。
- Flow integration：正式 runner 在无 supplement 时 partial 且不保存虚假行为；有 supplement 时保存 FlowPlan revision、保存带 sourceFlowPlanRevision 的 UISpec，并通过 Preview/Playwright behaviorFixture 验证。

## 边界

- 未新增或升级 npm 依赖。
- 未调用真实 Figma API。
- 未调用 OpenAI。
- 未修改模型可见工具数量或工具名称。
- 未执行部署、push 或发布。
- 未把 full-page screenshot fallback 作为 FlowPlan 方案。

## 残留风险与后续

- M4 正式能力仍基于本地 fixtures 和 ProjectStore 验证；live Figma prototype interaction probe 需要单独 gate 和授权。
- M5 应单独处理多 artboard / 多页面静态生成稳定化。
- M6 应单独处理多页面行为探索和跨页面状态。
- M7 应单独处理复杂业务流、条件流和更高阶业务规则。
