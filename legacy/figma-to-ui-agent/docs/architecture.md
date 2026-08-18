# 仓库架构摘要

> 本文件是便于代码阅读的仓库摘要。正式架构事实位于 project scope 的 Worktrail：
> `architecture/figma-to-ui-agent-architecture-snapshot.md` 和
> `architecture/figma-to-ui-agent-mvp-solution.md`。发生冲突时以 Worktrail 正式知识
> 和当前运行证据为准。

## 当前基线

```text
Pi Coding Agent TUI（OpenAI gpt-5.4）
  -> 受控 TypeScript Extension（模型可见工具恰好 4 个）
  -> inspect_figma
  -> 项目自有 Figma REST Adapter
  -> DesignBundle
  -> 多页面 ui-spec.json
  -> 本地 JSON Project Store 与不可变历史
  -> localhost React 三栏 Preview
  -> Playwright 功能、键盘、截图和视觉 Diff
```

模型只能看到：

1. `inspect_figma`
2. `load_ui_spec`
3. `save_ui_spec`
4. `render_and_compare`

Figma 正式通道只有官方 REST API。Remote MCP、Desktop MCP、第三方 MCP、浏览器
抓取和第二 Agent Loop 均不是生产默认或 fallback。仓库中的旧 MCP 探针只用于
历史诊断，不进入 M0 汇总和生产调用链。

## Figma 能力分级

核心硬门：

- 目标节点树可读；
- 至少一个目标节点截图可生成并下载为有效图片；
- 图片填充端点可读，图片数量可以为零。

Variables 是可选增强能力：

- `available`：保留变量、集合、模式、别名和值；
- `unavailable_optional`：继续使用 Styles、`boundVariables` 关系和最终解析值，
  但所有推导设计值必须标记来源，不能冒充 Figma 变量名称或语义。

核心能力全部成功后才能发布新的 DesignBundle。失败、取消、超时或 Schema
不兼容不得覆盖上一份有效版本。

## 数据边界

```text
data/projects/<projectId>/
  project.json
  figma/
    current.json
    history/
    assets/
    screenshots/
  specs/
    current.json
    history/
  runs/<runId>/
    run.json
    validation.json
    screenshots/
    diffs/
```

- `projectId` 不能造成绝对路径、`..` 或符号链接逃逸。
- DesignBundle 和 UISpec 使用版本化 Schema、revision CAS、不可变 history、
  同目录临时文件、fsync 和原子 rename。
- 浏览器只读取已校验的项目数据和本地资产引用。
- 凭据、原始文件键、远端临时 URL 和私有原始载荷不进入普通日志、报告、
  Worktrail 或浏览器。

## M0 状态

- Pi 本地工具边界与 Shell 拒绝：已验证。
- Playwright 公开 API 动态 Diff：已验证。
- Figma REST 节点、截图和图片填充：已有获授权的通过证据。
- Variables：当前为 `unavailable_optional`。
- OpenAI `gpt-5.4` 图像输入、恰好四工具 provider 请求和一次
  `inspect_figma` 工具回合：已验证。

因此 M0 整体已完成，当前已进入 M1。

## M1 当前状态

已完成本次授权的合约与本地项目存储子范围：

- `DesignBundle`：标准化页面、节点、组件、样式、设计值、图片引用、来源追溯、
  Variables 能力状态和警告；
- `UISpec`：受控组件目录、多页面路由、状态、动作、视口和行为夹具；
- 两类文档均采用严格 Schema，拒绝未知字段、不兼容版本、非法路径和悬空引用；
- UISpec 通过 `sourceDesignBundleRevision` 固定到同项目的当前 DesignBundle，
  并校验设计值和图片跨文档引用；
- Project Store 实现每项目写锁、revision CAS、不可变 history、同目录临时文件、
  文件与目录 `fsync`、原子 current 发布、已退出进程锁回收和孤立历史恢复；
- 所有受管目录和读取文件拒绝符号链接，项目标识不能逃逸
  `data/projects/<projectId>/`。

当前尚未完成：

- Figma REST Adapter、节点标准化和真实图片写入；
- 四个工具的业务实现与 Agent Loop 接线；
- React 三栏 Preview、功能验证和视觉 Diff 闭环；
- 未知输入盲测。

因此这里只表示 M1 合约与存储子范围通过，不表示整个 M1 或 MVP 完成。

## 延期范围

- React/Next.js 源码导出
- Tauri/Electron
- A2UI
- 数据库、登录、队列、云部署和多租户
- 产品运行时 Multi Agent
- 真实后端集成
- 自动 PR、发布和部署

不得为这些延期能力建立占位目录、空接口或依赖。
