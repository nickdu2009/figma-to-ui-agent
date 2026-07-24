---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "architecture/requirements-to-ui-support",
  "scope": "project",
  "type": "architecture",
  "title": "从需求到 UI 的支持策略",
  "status": "active",
  "lifecycle": "current",
  "topic": "requirements-to-ui"
}
---

# 从需求到 UI 的支持策略

## 背景

当前 Figma-to-UI Agent MVP 的主链路是：

`Figma -> DesignBundle -> UISpec -> Preview/验证`

后续如果要支持“从需求出发到 UI”，不应把需求生成强行塞进 Figma 读取链路，而应新增一条上游链路，并复用现有 UISpec、Project Store、三栏 Preview、不可变历史和 Playwright 验证能力：

`需求 -> RequirementBundle -> UXSpec -> UISpec -> Preview/验证`

## 输入成熟度

系统必须支持从一句话开始，而不是要求用户一次性提供事无巨细的 PRD。需求输入按成熟度分为三档：

| 成熟度 | 示例 | 系统行为 |
| --- | --- | --- |
| L0 一句话需求 | “写一个 todo web 应用” | 自动生成最小产品假设，进入可编辑需求草案。 |
| L1 简要需求 | “给团队用，支持优先级、截止日期” | 补齐缺口，标记假设和需要确认的风险点。 |
| L2 完整需求 | PRD、用户故事、验收标准 | 结构化为 RequirementBundle，尽量不新增假设。 |

## 关键原则

一句话需求可以直接启动，但系统必须把隐含假设显式化。模型可以为低风险缺口采用保守默认值，但不得把默认值伪装成用户确认的需求。

需求字段按来源分为：

- `confirmed`：用户明确说过的需求；
- `assumed`：系统为了继续原型而采用的保守默认；
- `unknown`：会影响架构、权限、合规、成本、数据安全或核心业务正确性的缺口；
- `outOfScope`：明确排除或本轮不做的范围。

低风险缺口可以默认，高风险缺口必须澄清。所有默认都必须进入可审计的假设列表。

## Todo 示例

用户只说“写一个 todo web 应用”时，系统可以生成类似需求草案：

```json
{
  "productGoal": "个人任务管理 Web 应用",
  "confirmed": ["用户想要一个 todo web 应用"],
  "assumed": [
    "单用户本地使用",
    "无需登录",
    "任务包含标题和完成状态",
    "支持新增、完成、删除、筛选"
  ],
  "unknown": [
    "是否需要截止日期",
    "是否需要分类或标签"
  ],
  "outOfScope": [
    "团队协作",
    "云同步",
    "通知提醒",
    "权限管理"
  ]
}
```

如果用户说“给公司财务审批用”，则不能直接默认，应停下来澄清权限、流程、审计、数据留存和审批规则。

## 中间产物

### RequirementBundle

RequirementBundle 表达需求来源和确认状态，至少包含：

- 产品目标；
- 目标用户和主要角色；
- 已确认需求；
- 系统假设；
- 必须澄清的问题；
- 明确排除范围；
- 验收标准；
- 风险标记。

### UXSpec

UXSpec 将需求转为体验结构，至少包含：

- 页面清单；
- 用户流程；
- 页面状态：loading、empty、error、success、stale；
- 表单字段和校验规则；
- 禁用规则；
- 交互行为和跳转；
- 内容优先级；
- 需求覆盖映射。

### UISpec

UISpec 仍然作为当前渲染与验证链路的落地点。模型根据 UXSpec 生成 `ui-spec.json`，然后继续使用现有 `save_ui_spec`、Preview 和 Playwright 验证。

## 两种运行模式

### 快速模式

用户不回答澄清问题也能继续。系统采用保守默认值，适合 demo、原型、小工具。输出必须展示假设和未确认项。

### 确认模式

用户先确认或修改需求草案，再生成 UXSpec 和 UISpec。适合正式业务系统、复杂流程和高风险场景。

## 验证方式

没有 Figma 视觉真值时，不应使用像素 Diff 作为主要成功标准。需求到 UI 的验证应改为：

- 需求覆盖验证；
- 组件合法性验证；
- 布局规则验证；
- 可访问性验证；
- 键盘路径验证；
- 交互验收验证；
- 人工视觉 review。

如果后续需要“需求 -> 可编辑 Figma -> UI”，应另行设计 Figma 写入或生成链路。Figma REST API 主要适合读取文件，不适合作为完整创建复杂设计稿的主方案。

## 工具和模式边界

当前冻结的 Figma-to-UI MVP 工具面不应被直接破坏。建议后续建立两个模式：

- `figma-to-ui`：从设计稿还原 UI，目标是视觉一致；
- `requirements-to-ui`：从需求生成 UI，目标是需求覆盖和交互正确。

后续工具可以另行设计，例如 `load_requirements`、`save_ux_spec`、`load_ux_spec` 或独立 Agent Profile。改变工具数量、工具名称或公共契约时，必须先回到设计评审。

## 最小可行路径

第一阶段建议只做：

`requirements.md -> requirement-bundle.json -> ux-spec.json -> ui-spec.json -> preview`

这样可以复用当前 MVP 的 Project Store、UISpec Schema、Preview、不可变历史和 Playwright 验证，同时让模型生成过程可审计。
