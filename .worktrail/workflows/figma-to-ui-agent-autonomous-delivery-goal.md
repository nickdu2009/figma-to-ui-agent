---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-autonomous-delivery-goal",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent 自主交付 Goal",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent 自主交付 Goal

## 1. 最终目标

Coding Agent 必须自主完成一个本地可运行的 Figma-to-UI Agent MVP：

1. 用户输入 Figma Design URL 和可选行为说明。
2. `inspect_figma` 通过项目自有 Figma REST Adapter 读取节点、截图和图片资源。
3. Variables 可用时增强变量语义；不可用时明确降级但不阻塞。
4. Agent 基于 DesignBundle 生成或修订一个 Schema 校验的多页面 `ui-spec.json`。
5. React + json-render Preview 展示参考、实现和 Diff。
6. Playwright 验证功能、键盘操作和视觉结果。
7. DesignBundle、UISpec 和验证记录具备项目隔离、不可变历史、原子更新和崩溃恢复。
8. Flow test 校准完成后，对三个未知 Figma 输入执行可重复盲测。

完成不是“生成了代码”，而是上述链路可运行、可恢复、可测试、可审计，并有明确的失败证据。

## 2. 指令优先级

Coding Agent 按以下优先级处理冲突：

1. 用户当前回合的明确指令和授权边界。
2. 已推广的 Worktrail project scope 架构、实施计划、规则和本 Goal。
3. 当前 Worktrail state 中的事实、验证结果和下一步。
4. 仓库现有代码、README 和历史探针。
5. 未推广候选、旧文档和历史实现只作为参考，不得覆盖正式基线。

如果正式知识与代码冲突，以正式知识为目标，以当前代码为迁移起点；不得因为旧代码存在就恢复 Desktop/Remote MCP。

## 3. 已接受架构

- Figma 正式通道：官方 REST API。
- REST 实现：项目自有 TypeScript Adapter，使用 Node 原生 `fetch`。
- Variables：可选增强能力。
- Agent 运行时：Pi Coding Agent TUI + OpenAI `gpt-5.4`。
- Extension：单一受控 TypeScript Extension。
- 模型工具：恰好四个。
- UI 表示：json-render `ui-spec.json`。
- Preview：React + Vite localhost。
- 验证：Playwright 功能、键盘、截图和视觉 Diff。
- 持久化：本地 JSON、内容寻址资产、不可变历史、revision CAS 和原子更新。

禁止作为默认或 fallback：

- Figma Desktop MCP
- Figma Remote MCP
- 第三方 Figma MCP
- 浏览器抓取
- 第二 Agent Loop
- 自由 JSX/React 生成
- 样本专属生产分支
- 私有视觉 Diff API

## 4. 当前事实

- 精确依赖和 lockfile 已存在。
- `npm ci`、typecheck、本地 Pi 边界和 Playwright 探针已有通过证据。
- Figma REST Flow 探针已证明节点、截图和图片资源核心可用。
- Variables 端点返回 403，能力状态为 `unavailable_optional`。
- Figma 侧核心门已通过。
- OpenAI live probe 尚需单独授权，因此整体 M0 尚未完成。
- 仓库仍有 Desktop MCP、Framelink 和旧文档残留，只能作为历史迁移材料。
- 当前目录可能不是 Git 仓库；不得自行初始化 Git。

Agent 必须在每次开始阶段前重新加载 Worktrail context 和实际仓库状态，不能把本节当作永远不变的快照。

## 5. 自主执行权限

在已推广计划范围内，Agent 可以不额外询问地执行：

- 只读仓库探索。
- 创建或修改项目内源代码、测试、fixture 和运行文档。
- 运行无外部副作用的本地测试、typecheck、构建和离线探针。
- 使用已经锁定的依赖，不修改版本。
- 启动 localhost Preview 和本地 Playwright。
- 修复自己引入的缺陷并重复最小验证。
- 更新当前 Worktrail state，记录事实、验证和下一步。

Agent 必须停下并请求明确确认：

- 新增、删除或升级依赖。
- 变更公开工具契约、DesignBundle/UISpec 持久化 Schema 或迁移策略。
- 改变四工具集合、Agent 数量、Figma 通道或 Variables 可选策略。
- 调用真实 OpenAI、Figma 或其他外部服务，除非当前授权明确覆盖该次调用。
- 使用真实用户数据或生产式环境。
- 批量移动或删除文件。
- 初始化 Git、提交、推送、创建 PR、部署、发布或修改远端状态。
- promote、merge、discard、restore 或 retire Worktrail 候选。

授权按具体动作和范围解释，不自动延伸到后续阶段。

## 6. 工作循环

每个阶段执行同一闭环：

1. 运行 `worktrail context --semantic=auto "<当前任务>"`。
2. 读取 active state、正式架构、实施计划、规则和维护提示。
3. 检查仓库状态，保护所有非本任务改动。
4. 将阶段目标转为可验证的最小增量。
5. 先写或确定失败用例，再实现最小代码。
6. 运行最窄验证，失败时定位根因，不盲目扩大测试范围。
7. 自我审查 correctness、scope、秘密泄漏、调试残留和文档漂移。
8. 运行阶段验收测试。
9. 更新 Worktrail state，记录完成内容、命令、结果、残余风险和下一步。
10. 只在用户明确要求跨会话或切换 Agent 时创建 handoff。

不得为展示进度而创建空模块、未使用抽象或无法执行的占位实现。

## 7. M0 自主任务

### 7.1 同步 REST 基线

- 更新 M0 汇总以使用 REST 核心探针。
- 更新 package script、README 和本机配置示例。
- 同步或明确退役旧仓库架构入口。
- 将 Desktop 和 Framelink 探针标记为历史诊断，不进入生产路径。
- 保证本地探针无网络，live 探针缺少授权时失败关闭。

### 7.2 固化 Figma 核心证据

- 节点、截图和图片填充是硬门。
- Variables 只输出 `available` 或 `unavailable_optional`。
- 增加 mock fixture，覆盖 Variables 403 仍通过以及核心失败不通过。
- 报告只保留状态、数量、字节数、哈希和能力状态。

### 7.3 完成 OpenAI 门

只有获得明确授权后：

- 验证当前 Pi 包选择 `gpt-5.4`。
- 验证图像输入和工具回合。
- 验证模型可见工具恰好四个。
- 验证 provider payload 没有工具漂移。

未授权时保持 `pending_authorization`，不得伪造或推断通过。

### 7.4 M0 完成标准

- Figma REST 核心通过。
- Variables 状态已记录。
- Pi/OpenAI live 通过。
- Playwright 和运行时版本基线通过。
- 整体报告逐项区分已通过、可选降级、待授权和失败。

## 8. M1 自主任务

按实施计划依次完成：

1. 输入、Variables capability、DesignBundle、UISpec 和四工具 Zod 契约。
2. URL 解析和安全校验。
3. 可注入 fetch 的 REST Client。
4. 节点标准化和页面候选发现。
5. 截图、资产下载、格式校验、内容寻址和去重。
6. Variables 读取与三种设计值来源。
7. DesignBundle revision、history、原子 current 和崩溃恢复。

M1 必须以 mock REST 的完整纵向切片结束。真实 Figma 只用于单独获授权的集成验证。

## 9. M2 自主任务

1. 实现受控组件 Catalog 和多页面 UISpec。
2. 实现 UISpec revision CAS、history 和原子保存。
3. 实现三栏 Preview、页面/Viewport/缩放控制以及 loading、empty、error、stale 状态。
4. 实现键盘可达性和可见焦点。
5. 实现 `render_and_compare` 的公开 Playwright 流程。
6. 将四个 Extension 工具连接到真实服务。
7. 让 Agent 完成 inspect、load、save、render/compare 的有限迭代。

Agent 循环必须有最大轮次、无进展检测和结构化停止原因。

## 10. M3 自主任务

1. 冻结依赖、模型、Prompt、工具 Schema、Chromium、字体、Viewport、DPR、动画和 Diff 配置。
2. 确认生产代码不包含 Flow 文件键、固定节点、页面名或样本视觉常量。
3. 执行三个未知输入盲测。
4. 记录功能、键盘、视觉、迭代次数、人工干预和能力降级。
5. 修复通用缺陷后重新从头运行受影响盲测。
6. 汇总已知限制、复现步骤和重访条件。

如果完整 Variables live 条件不可得，可以用契约 fixture 验证该分支，但必须明确其不是 live 证据。

## 11. 工程质量要求

### 代码

- TypeScript 严格模式。
- 输入和持久化边界使用 Zod。
- 单用途代码优先，只有真实重复或复杂度才抽象。
- 不修改无关文件或格式。
- 只对复杂、不直观的逻辑写简短注释。
- 所有外部请求可取消、有限重试并有大小限制。

### 数据

- `projectId` 不能造成路径逃逸。
- 当前版本更新使用 CAS 和原子 rename。
- history 不可变。
- 失败不覆盖旧版本。
- 资产以内容哈希去重。
- 普通报告不保存原始私有设计载荷。

### UI

- 第一屏是实际工作区，不做营销落地页。
- 三栏布局适合持续比较和重复操作。
- 使用图标按钮、工具提示、分段控制、复选框和数值输入等合适控件。
- 无嵌套卡片和装饰性大圆角堆叠。
- 桌面与移动 Viewport 无文本溢出和控件重叠。
- 交互、空态、错误态、加载态和禁用态完整。

### 测试

- 单元测试覆盖解析、Schema、分类、路径和恢复。
- 集成测试覆盖 REST、存储、四工具和 Preview 边界。
- E2E 覆盖 Flow、键盘和视觉。
- 优先最窄有效验证，只有跨模块行为才扩大。
- 失败测试不能通过删除断言、放宽安全条件或更新期望图掩盖。

## 12. 证据规则

每个结论必须标记为：

- `confirmed`：当前本地或 live 证据直接证明。
- `selected`：用户明确选择但尚未实现。
- `proposed`：设计建议，等待选择。
- `unverified`：尚未运行验证。
- `pending_authorization`：需要外部调用或状态变更授权。
- `blocked`：同一外部阻塞重复出现且无法继续。

架构选择、候选、探针和生产实现不能混为一谈。测试 fixture 不能冒充 live 证据，候选不能冒充正式知识。

## 13. 停止条件

Agent 在以下情况停止当前实现链并报告：

- M0 硬门失败。
- 正式文档之间存在无法自行消解的冲突。
- 需要改变公开契约或持久化 Schema。
- 需要依赖、外部服务或远端状态授权。
- 非本任务用户改动与目标文件产生不可安全合并的冲突。
- 同一方案连续两次没有新证据。
- 测试显示当前架构不能满足目标。

报告必须给出证据、影响、已尝试动作和一个明确下一步，不得只说“无法完成”。

## 14. 最终完成定义

只有同时满足以下条件才能宣称项目完成：

- M0-M3 全部退出条件满足。
- 四工具真实闭环可运行。
- Flow test 与三个未知输入结果可重复。
- Variables 可选状态在 UI、DesignBundle、报告和测试中一致。
- Preview 功能、键盘和视觉验证达到冻结标准。
- 项目隔离、CAS、原子写和恢复测试通过。
- 没有凭据、私有原始载荷和远端临时 URL 泄漏。
- 没有 Remote/Desktop/第三方 MCP fallback 或第二 Agent Loop。
- 没有样本专属生产代码。
- README、运行配置示例和 Worktrail 正式知识一致。
- 所有未完成项有明确状态，不能把待授权或未验证项记为完成。

项目完成不自动授权提交、推送、PR、部署或发布。
