---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "architecture-figma-to-ui-agent-snapshot",
  "scope": "project",
  "type": "architecture",
  "title": "Figma-to-UI Agent 架构决策快照",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent 架构决策快照

## 状态与决策

- 决策状态：已接受；纯 Figma REST API 是当前正式基线。
- 运行时：Pi Coding Agent TUI + OpenAI `gpt-5.4`。
- Agent 扩展：一个受控 TypeScript Extension。
- 模型工具面：严格限定为四个工具。
- Figma 通道：项目自有 Figma REST Adapter，使用官方 `https://api.figma.com/v1`。
- UI 中间表示：json-render `ui-spec.json`。
- 可视运行时：localhost React + json-render。
- 验证方式：Playwright 功能、键盘、截图和视觉 Diff。
- 持久化：本地 JSON、不可变修订历史和项目资产。
- Variables：可选增强能力，不属于 Figma 侧 M0 硬门禁。

本快照已替换此前 Desktop MCP 基线以及未采用的 Remote MCP 提案。Remote MCP、Desktop MCP、第三方 MCP、浏览器抓取和第二 Agent Loop 均不得作为生产默认或静默 fallback。

## 采用 REST 的理由

1. Flow test 实测已证明节点、截图和图片资源可通过官方 REST API 只读获取。
2. REST Adapter 无需 Figma Desktop、Remote MCP 客户端准入、第三方 MCP 进程或第二 Agent Loop。
3. 请求、超时、重试、响应 Schema、凭据和审计边界均由项目代码直接控制。
4. Variables REST API 受 Figma 套餐、账号和 scope 限制，但 UI 生成可以继续使用节点解析值、Styles 和 `boundVariables` 关系。
5. 相比 Remote MCP，REST 缺少预生成的 Design Context，因此项目必须自行完成标准化、语义推导和可追溯降级，不能声称与 MCP 输出等价。

## 总体拓扑

```text
Pi Coding Agent TUI（OpenAI gpt-5.4）
  -> 受控 TypeScript Extension（模型可见工具恰好 4 个）
  -> inspect_figma
  -> Figma REST Adapter（同进程、非 Agent）
  -> https://api.figma.com/v1
  -> DesignBundle（能力状态 + 来源追踪）
  -> Schema 校验的多页面 ui-spec.json
  -> 本地 JSON Project Store 与不可变历史
  -> localhost React 三栏 Preview
  -> Playwright 功能、键盘、截图和视觉 Diff
```

## 模型工具边界

模型在每个回合只能看到：

1. `inspect_figma`
2. `load_ui_spec`
3. `save_ui_spec`
4. `render_and_compare`

Figma REST 请求是 `inspect_figma` 内部能力，不直接暴露为额外模型工具。受控启动器和 Extension 必须关闭 Pi 内置工具及 Extension、Skill、Prompt、Context 自动发现，拒绝 `user_bash`，并在 provider 请求前核验活动工具集恰好为上述四个。

`--no-builtin-tools` 不是操作系统沙箱。MVP 使用低权限账号、专用工作区、网络主机白名单和路径限制；若安全评审要求更强隔离，再单独设计系统沙箱或容器。

## inspect_figma 输入契约

输入至少包含：

- `schemaVersion`
- `projectId`
- `figmaUrl`
- `targetNodes`（可选）
- `viewports`（可选）
- `behaviorNotes`（可选）

`figmaUrl` 只接受 `https://www.figma.com/design/<fileKey>/...`。Adapter 解析文件键和可选 `node-id`，拒绝非 HTTPS、非 Figma 主机、非设计文件路径、非法编码、超长输入和节点冲突。文件键不得出现在普通日志和报告中，只记录哈希。

业务行为只来自 Figma 可观测信息、用户显式 `behaviorNotes` 或测试 fixture，不得根据截图猜测真实后端行为。

## REST 能力分级

### 核心硬门

Adapter 必须成功完成：

- `GET /v1/files/:file_key/nodes`：读取目标节点树、组件、Styles、最终解析视觉值和 `boundVariables` 关系。
- `GET /v1/images/:file_key`：生成至少一个目标节点截图，并验证下载结果和图片格式。
- `GET /v1/files/:file_key/images`：枚举图片填充；零图片是合法结果，端点不可读才失败。

以上任一能力不可用，`inspect_figma` 失败且不得替换上一个有效 DesignBundle。

### Variables 可选增强

在凭据和账号允许时调用：

- `GET /v1/files/:file_key/variables/local`

能力状态固定为：

- `available`：读取变量、集合、模式、别名和值，并用于生成语义 Token。
- `unavailable_optional`：接口因套餐、账号、scope 或文件条件不可用；记录脱敏原因，继续使用 `boundVariables` ID、Styles 和节点最终解析值。

Variables 不可用时不得伪造 Figma 变量名称、模式或别名链。可以生成项目内部推导 Token，但必须标记 `origin: inferred`，与 `origin: figma_variable` 区分。

## DesignBundle 契约

DesignBundle 至少包含：

- `schemaVersion`
- `source` 与脱敏文件标识
- 目标节点及标准化页面树
- 组件、Styles、文本和布局摘要
- 截图与资产的项目内引用、哈希和来源
- `capabilities.variables`
- Figma Variable Token 或推导 Token
- 请求版本、时间、状态码摘要和 provenance

只在全部核心能力和 Schema 校验成功后，通过临时文件、fsync 和原子 rename 替换当前 DesignBundle。失败、取消、超时或部分返回不得破坏上一个有效版本。

## 凭据与数据边界

- PAT 仅从进程环境读取，不进入命令参数、项目文件、报告、Worktrail、审计日志或浏览器。
- 网络白名单只允许 Figma API 主机以及 Figma 响应返回的 HTTPS 资产地址。
- REST 请求设置超时、有限重试和响应体大小上限；不得无限并发或重试。
- 原始私有设计 JSON 不写入探针报告；生产 DesignBundle 只保留实现所需的标准化数据。
- 日志只记录阶段、端点类别、状态码、耗时、重试次数、字节数、哈希和脱敏错误码。
- 所有项目路径从 `projectId` 推导到 `data/projects/<projectId>`，拒绝绝对路径、`..`、符号链接逃逸和项目根外写入。

## M0 停损门

M0 分为四组独立证据：

1. Pi + OpenAI：`gpt-5.4` 图像输入和四工具回合可运行，provider payload 无工具漂移。
2. Figma REST 核心：节点、截图和图片资源端点通过；Variables 只记录可选能力状态。
3. Preview + Playwright：公开 API 可完成功能检查、键盘操作、截图和视觉 Diff。
4. 可复现基线：Node、npm、Pi、模型、json-render、React、Zod、Playwright、Chromium、字体、Viewport、DPR、Diff 算法和阈值可记录并冻结。

任一硬门失败时停止 M1-M3。Variables 为 `unavailable_optional` 不构成硬门失败。

## 故障与恢复

- 核心端点 `401/403/404`：失败关闭，不生成半成品；提示检查凭据、文件权限或文件类型。
- Variables `401/403`：记录 `unavailable_optional`，不重试绕过，不阻塞核心流程。
- `429`：遵守 `Retry-After`，使用有上限的指数退避。
- 网络错误和 `5xx`：有限次数重试；仍失败则保留旧 DesignBundle。
- 响应过大或 Schema 漂移：停止并记录端点类别与 Schema 哈希，回到设计评审。
- 用户取消或进程退出：中止 fetch、关闭浏览器和子进程，不遗留临时文件。

## 延期与排除范围

- React/Next.js 源码导出
- Tauri/Electron 桌面包装
- A2UI
- 数据库、登录、队列、云部署、多租户
- 产品运行时 Multi Agent
- 真实后端集成
- 自动 PR、发布和部署

未来导出器必须通过固定模板从同一份 `ui-spec.json` 确定性转换，不得回到自由 JSX 生成。

## 验收条件

- AC-R1：正式 Figma 通道只有项目自有 REST Adapter。
- AC-R2：模型工具面始终恰好四个，REST 内部能力不直接暴露给模型。
- AC-R3：Flow test 的节点、截图和图片资源核心探针通过并保存脱敏证据。
- AC-R4：Variables 不可用时 M0 仍可通过，并输出 `unavailable_optional`。
- AC-R5：Variables 不可用时不伪造变量语义，推导 Token 有明确来源标记。
- AC-R6：PAT、原始文件键、私有响应和资产 URL 不进入报告、Worktrail 或普通日志。
- AC-R7：核心失败、取消和超时不破坏上一个有效 DesignBundle。
- AC-R8：Remote/Desktop/第三方 MCP 和第二 Agent Loop 均不是默认或 fallback。
- AC-R9：本地 JSON、不可变历史、路径隔离和延期范围保持不变。

## 残余假设

- 假设：未知 Figma 文件的 REST 节点数据足以生成 MVP 所需 UISpec。
  - 验证：Flow test 校准后执行三次未知文件盲测。
- 假设：没有完整 Variables 时，Styles、`boundVariables` 和解析值足以维持可接受视觉保真度。
  - 验证：分别对无 Variables、存在绑定但接口不可用、完整 Variables 可用三类 fixture 执行视觉与语义测试。
- 假设：Figma 返回的资产下载地址可通过严格 HTTPS 校验安全获取。
  - 验证：集成测试覆盖协议、重定向、超时、大小上限和非法地址拒绝。

## 规范关系

本快照是正式架构入口。与技术方案、实施计划或历史候选冲突时，以本快照为准；配套计划和自主 Goal 必须与本快照保持一致。
