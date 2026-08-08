---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-flow-m13-trego-generalization-fix-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Flow-M13 Trego generalization fix plan",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent-flow-m13"
}
---

# Figma-to-UI Agent Flow-M13 Trego generalization fix plan

## 目标

让 Trego 类真实 Figma prototype route 样本能够进入 restricted-live / FlowPlan artifact 验证，而不是因为视觉归一化边界或 target bundle 过窄被误判为不可用。

该计划解决两个通用能力缺口：

1. Figma 极端 `cornerRadius` 值导致 DesignBundle Schema 拒绝，阻断整个样本读取。
2. `NAVIGATE` source node 与 destination frame 位于 sibling frame / 同一 section 下时，局部 target bundle 只包含 source 子树，导致 destination 缺失并分类为 `prototype_target_missing`。

## 非目标

- 不引入新依赖。
- 不调用 OpenAI。
- 不改变四工具边界。
- 不把 raw Figma URL、file key、token 或 REST payload 写入正式知识。
- 不把缺少 destination 的 navigate 猜测为 trusted route。

## 实施步骤

### T01：cornerRadius 归一化边界

- 在 Figma node normalization 层处理极端 radius：对非有限值、负值、超过 Schema 上限的值进行安全归一化或降级为 unsupported visual diagnostic。
- 归一化必须保留 fail-closed 语义：不能让非法数值进入 DesignBundle；不能静默制造 Figma 不存在的语义。
- 测试：新增 fixture 覆盖 `cornerRadius > 10000`、负值、非数值，以及正常 radius 不变。

验收：Trego full screen 不再因 single visual scalar 阻断整个 inspect；非法 radius 有明确 diagnostic 或 bounded value。

### T02：prototype destination target expansion

- 在 restricted-live inspect / FlowPlan extraction 前，识别目标节点子树中的 prototype actions。
- 当 action 是 `NAVIGATE` 且存在 destinationId，但 destination 不在当前 target subtree 时，按受控规则扩展 target：
  - 优先补 destination frame 本身；
  - 若 source 与 destination 共享同一 canvas/section，允许以最小 sibling frame set 读取 source frame + destination frame；
  - 不读取整文件作为 fallback；
  - 扩展节点数量、深度和响应大小继续受现有限制保护。
- 若 destination 仍不可读，继续返回 `prototype_target_missing`，不得猜测路由。

验收：Trego 小节点 route 可以看到 destination frame，至少一个 navigate candidate 从 missing_evidence 晋级为 trusted.navigate 或明确 unsupported reason。

### T03：artifact / report 闭合

- rerun restricted-live：Fitness control、Modern Service Booking、Trego navigate。
- 期望：至少三个 readable 样本；Modern 保持 trusted.set_state；Trego 不再因 cornerRadius 或 target bundle 缺失成为 not_accessible。
- 若 Trego 仍不能 trusted.navigate，报告必须指出新的精确 blocker。

### T04：回归验证

- 本地验证：typecheck、targeted unit tests、targeted integration tests。
- 若修改 normalization 或 inspector shared path，再跑相关 full unit/integration 子集。
- 不默认跑 OpenAI；Figma restricted-live 只在用户授权后运行。

## 风险与边界

- target expansion 可能增加 Figma REST 请求数；必须使用既有限流和 429 日志。
- sibling expansion 不能退化为 whole-file fallback，否则会增加成本并污染样本边界。
- cornerRadius clamp 需要在报告中可追踪，避免视觉 fidelity 问题被掩盖。

## 完成定义

- Trego 类跨 sibling route 样本可以被 restricted-live runner 读入并生成 FlowPlan artifact。
- Flow-M13 样本矩阵至少包含：Fitness control、Modern Booking state-change、Trego navigate 或其明确替代 navigate 样本。
- 所有新增行为有测试和报告证据。
