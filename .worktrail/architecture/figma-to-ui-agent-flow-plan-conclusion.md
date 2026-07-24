---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "architecture-figma-to-ui-agent-flow-plan-conclusion",
  "scope": "project",
  "type": "architecture",
  "title": "FlowPlan 计划层讨论结论",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# FlowPlan 计划层讨论结论

## 1. 结论

当前基于 Pi Coding Agent 的技术架构可以承载第三类多页面业务 Flow 的实现方向，但当前项目还没有正式的 `FlowPlan` / `InteractionPlan` 契约。

因此，项目不应直接承诺“任意 Figma 都能完整自动还原业务 Flow”。正确路线是先做一个小范围可行性验证，再把计划层正式纳入架构和验收。

推荐下一步：

```text
M4-spike：FlowPlan 可行性验证
```

验证通过后，再进入正式的 M4/M5/M6/M7。

## 2. 项目目标定位

项目最终目标是一个 chat-first Figma-to-UI Agent，而不是无条件像素级还原工具。

目标工作方式：

1. 用户给出 Figma 链接或节点。
2. Agent 通过 Figma REST API 读取设计数据。
3. Agent 提取页面、样式、组件、图片和部分交互。
4. 对不确定的页面关系、按钮跳转、表单行为和状态变化，通过 chat 询问用户。
5. 用户确认后，Agent 生成 UI。
6. 本地 Preview 渲染。
7. Playwright 执行视觉和功能验证。
8. 对无法支持或证据不足的内容明确报告，而不是静默猜测。

## 3. Figma 输入能力分级

### 第一类：单页面、结构清晰

一个主 Frame 对应一个页面，页面结构和视觉目标明确。

当前 M3 的单 artboard 端到端验证已经证明这类输入可行。

### 第二类：复杂单页面

仍然是单页面，但包含更复杂的布局、组件、素材、状态或响应式要求。

这类可以继续增强支持，但主要挑战在布局、组件映射、样式 token 和视觉校准。

### 第三类：多页面 / 多 artboard / 有业务 Flow

包含多个页面或状态，例如：

```text
landingpage -> quotation -> result
```

这类是下一阶段重点，但当前项目尚未完整支持。关键问题不是静态视觉还原，而是业务 Flow 的确认和执行。

### 第四类：复杂交互 / 动画 / 高级状态

包含复杂表单逻辑、条件分支、动画、拖拽、微交互或后端业务行为。

这类不能仅依赖 Figma 自动恢复，需要更强的规则、用户确认和后续增强。

## 4. 当前 Figma interaction 探测结论

对当前测试 Figma 做过只读探测，REST API 可读，并且文件中确实存在 `interactions` 数据。

该结果来自 2026-07-24 side conversation 中的一次临时只读探测，只作为本设计讨论依据，不作为正式 M3/M4 验收报告。若后续要作为验收证据，需要在正式授权的运行中落到 `reports/` 或 Worktrail 候选，并记录脱敏输入标识、运行时间、命令边界和验证结果。

探测到的交互概要：

```text
interactionCount = 32
triggerTypes:
  ON_HOVER = 28
  AFTER_TIMEOUT = 4
actionTypes:
  NODE = 32
```

关键判断：

- 当前文件有 prototype interaction 信息。
- 未发现明显的 `ON_CLICK` 页面跳转。
- 这些交互更像组件内部状态，例如 hover、input cursor、badge close 等。
- 这些数据不足以直接证明完整业务 Flow 已经在 Figma 中描述。

因此，Figma interactions 可以作为 FlowPlan 的输入之一，但不能作为唯一事实来源。

## 5. interactions 提取不出来时的处理规则

处理原则是 fail closed：提不出来就不能当成事实实现。

交互应分为四种可信度：

```text
figma
inferred
user_confirmed
missing
```

规则：

- `figma`：Figma REST 明确提供的交互，可以自动采用。
- `inferred`：Agent 根据页面名、按钮文案、节点结构推断出的交互，必须先问用户确认。
- `user_confirmed`：用户通过 chat 确认后的交互，可以实现。
- `missing`：既没有 Figma 数据，也无法可靠推断的交互，不能生成假逻辑，只能列为待确认项或保持静态。

示例：

```text
我没有在 Figma 中读到 Get quote 的点击目标。
它是否应该跳转到 Quotation 页面？
```

用户确认后，Agent 才能把该交互写入结构化计划并生成 UI。

## 6. 为什么需要 FlowPlan 计划层

当前 `DesignBundle` 主要表达 Figma 设计事实，`UISpec` 主要表达最终 UI 应该如何渲染。

第三类业务 Flow 还需要一个中间层：

```text
Figma REST
  -> DesignBundle
  -> FlowPlan / InteractionPlan
  -> 用户 chat 确认
  -> UISpec
  -> Preview + Validation
```

FlowPlan 负责回答：

- 哪些 Frame 是页面？
- 哪个页面是入口？
- 哪些节点只是组件或状态？
- 哪些按钮或元素可能触发页面跳转？
- 哪些交互来自 Figma？
- 哪些交互是 Agent 推断？
- 哪些交互缺失，需要用户确认？
- 用户确认后的 Flow 如何转换为 UISpec？

没有 FlowPlan，Agent 容易直接从静态设计跳到代码生成，在多页面业务流上产生猜测。

## 7. 当前 Pi 架构是否能实现

可以。

当前架构已经具备关键底座：

```text
Pi Coding Agent TUI
  -> 受控 TypeScript Extension
  -> inspect_figma
  -> DesignBundle
  -> UISpec
  -> Preview
  -> Playwright 验证
```

现有能力包括：

- Pi chat 交互入口；
- Figma REST 读取；
- 本地 DesignBundle；
- 多页面 UISpec；
- 路由和 navigate action；
- Preview 渲染；
- Playwright 视觉和功能验证；
- 本地项目存储和不可变历史。

所以问题不是 Pi 架构不能承载，而是项目还缺少正式的 FlowPlan/InteractionPlan 契约。

## 8. 推荐实现路线

不要直接大改架构。先验证，再正式做。

### M4-spike：FlowPlan 可行性验证

目标：

1. 从当前 Figma / DesignBundle 中识别候选页面。
2. 提取已有 Figma interactions。
3. 找出缺失的 click/navigation。
4. 自动生成 chat 确认问题。
5. 根据用户回答形成结构化 FlowPlan。
6. 把 FlowPlan 转换成多页面 UISpec 草稿。

不做：

- 不新增正式 Pi 工具。
- 不改依赖。
- 不承诺任意 Figma 自动还原。
- 不直接实现完整第三类支持。

#### M4-spike 状态边界

M4-spike 不新增正式 Pi 工具，因此不能把 `FlowPlan` 当成已经持久化的一等生产对象。

Spike 阶段允许使用临时的 `FlowPlanDraft`，但它必须满足以下边界：

- `FlowPlanDraft` 只能作为当前 agent 回合的结构化上下文、`inspect_figma` supplement、run artifact 或报告内容存在。
- `FlowPlanDraft` 不得冒充正式 `DesignBundle` 或正式 `UISpec` 字段。
- 用户通过 chat 确认后的结果必须在同一轮生成中被结构化记录，至少记录页面、交互、来源可信度和确认状态。
- 未确认的 `inferred` interaction 不得直接转换为 `navigate`、`set_state` 或 `open_dialog`。
- `missing` interaction 只能进入待确认问题或验证报告，不得生成业务行为。
- 转换到 `UISpec` 的 action 只能来自 `figma` 或 `user_confirmed` interaction。

如果 spike 需要跨回合恢复 `FlowPlanDraft`，则必须先把正式 M4 的存储和 Schema 问题提前纳入设计，不应继续沿用“无正式工具、无正式存储”的 spike 边界。

#### M4-spike 通过标准

M4-spike 只有同时满足以下条件，才算通过：

1. 能从目标 Figma / DesignBundle 中识别至少两个候选页面，或在单页面输入中明确报告“不满足多页面 Flow 验证条件”。
2. 能区分已从 Figma 读取的 interactions、Agent 推断的 interactions 和缺失 interactions。
3. 能为每个 `inferred` 或 `missing` interaction 生成用户可读的 chat 确认问题。
4. 用户确认后，能形成结构化 `FlowPlanDraft`，并为每个 interaction 标记 `figma`、`inferred`、`user_confirmed` 或 `missing`。
5. 生成 `UISpec` 时，只把 `figma` 和 `user_confirmed` interaction 转换为 action。
6. 至少生成一个 `behaviorFixture` 验证确认后的页面跳转或状态行为。
7. Preview 和 Playwright 验证能证明该 `behaviorFixture` 执行通过，或明确报告失败原因。
8. 运行报告能列出未实现的 `inferred` / `missing` interaction，避免把静态还原误报为完整 Flow 支持。

### 正式 M4：FlowPlan 契约

在 spike 成功后，正式定义：

- FlowPlan Schema；
- InteractionPlan Schema；
- 可信度字段；
- 待确认问题结构；
- 用户确认结果如何落入计划；
- FlowPlan 如何约束 UISpec 生成。

### 正式 M5：多 artboard 静态生成与逐页验证

支持多个页面分别生成和验证：

- 每个页面单独截图；
- 每个页面单独视觉 diff；
- 不再把多个 artboard 当成一个 composite canvas 比较。

### 正式 M6：路由与 Flow 执行验证

支持用户确认后的页面跳转：

- route 生成；
- button navigate；
- behavior fixture 中验证页面流转；
- Playwright 执行点击路径。

### 正式 M7：状态、表单与简单业务交互

支持更明确的状态行为：

- input；
- checkbox；
- submit；
- set_state；
- 简单表单路径；
- 用户确认后的业务状态切换。

## 9. 最终判断

当前项目方向正确，Pi 架构能承载 chat-first FlowPlan 计划层。

但第三类多页面业务 Flow 的完整支持不能直接从当前 M3 推导出来。当前 M3 主要证明了单 artboard 端到端链路可行。

下一步应先做 M4-spike，验证：

```text
Figma 信息 + Agent 推断 + chat 确认 + FlowPlan + UISpec
```

这条链是否能稳定跑通。

只有 M4-spike 成功后，才应把 FlowPlan 正式纳入架构、Schema、工具边界和验收标准。
