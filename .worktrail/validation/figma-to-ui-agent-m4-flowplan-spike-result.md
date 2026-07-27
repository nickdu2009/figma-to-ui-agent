---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-m4-flowplan-spike-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent M4-spike FlowPlan 验证结论",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M4-spike FlowPlan 验证结论

## 结论

M4-spike FlowPlan 本地可行性链路已成立。当前实现证明：在已有 DesignBundle 与 UISpec 基础上，可以用 spike-only FlowPlanDraft 完成页面候选识别、interaction 分类、用户确认、UISpec action/behaviorFixture 转换，以及本地 Preview/Playwright 行为验证。

该结论不表示正式 M4 已完成，也不表示可以直接进入 M5/M6/M7。M4-spike 只证明链路可行，下一步应进入正式 M4 设计与实施计划。

## 已实现范围

- 新增 spike-only FlowPlanDraft 类型与 zod 校验。
- 支持 candidate page 识别，并在单页面输入时报告多页面验证条件不足。
- 支持 interaction 分类：figma、inferred、user_confirmed、missing。
- 支持 spike-only InteractionSupplement，作为 Figma prototype interaction 的临时输入载体。
- 支持对 inferred/missing interaction 生成中文确认问题。
- 支持用户确认结果应用，缺失或非法确认 fail closed。
- 支持将可信 interaction 转换为 UISpec actions 与 behaviorFixtures。
- 支持 navigate、可验证的 set_state、可验证的 open_dialog。
- 新增本地 runner scripts/run-m4-flowplan-spike.mjs。
- 新增 flow-plan fixtures、unit tests 和 integration test。

## 验证证据

本地验证通过：

- npm run typecheck
- npm run test:unit，结果为 27 files / 136 tests passed
- npm run test:integration -- tests/integration/flow-plan/m4-flowplan-spike.test.ts，结果为 7 files / 40 tests passed

关联提交：8dc48a3 Add M4 FlowPlan spike。

## 边界

- 未调用 Figma live API。
- 未调用 OpenAI live API。
- 未新增 npm 依赖。
- 未修改正式 DesignBundle schema。
- 未修改正式 UISpec schema。
- 未修改正式 ProjectStore schema。
- 未修改正式 Pi tool contract。
- FlowPlanDraft 仍是 spike-only，不是正式持久化产品契约。

## Go / No-go

Go：可以进入正式 M4 设计。

No-go：不能把该 spike 视为正式 FlowPlan 产品能力；不能据此直接跳 M5、M6 或 M7。

## 正式 M4 后续问题

正式 M4 需要单独设计并确认：

- FlowPlan 是否成为正式 schema / ProjectStore 对象。
- 是否新增 Pi tool，如 create_flow_plan 或 apply_flow_plan。
- InteractionSupplement 是否升级为正式输入或运行时 artifact。
- 用户确认如何跨回合保存和恢复。
- unresolved flow、validation report、behaviorFixture 如何进入标准工作流。
- live Figma prototype interaction probe 是否纳入正式能力，以及其授权、限流和失败语义。
