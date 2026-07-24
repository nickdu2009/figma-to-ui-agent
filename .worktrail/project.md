---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "project-figma-to-ui-agent",
  "scope": "project",
  "type": "project",
  "title": "Figma-to-UI Agent 项目概览",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent 项目概览

## 项目目标

构建一个本地可运行、可恢复、可验证、可审计的 Figma-to-UI Agent MVP。用户提供 Figma Design URL 和可选行为说明，Pi Coding Agent 通过四个受控工具读取设计、维护多页面 `ui-spec.json`，在浏览器预览，并由 Playwright 执行功能、键盘和视觉验证。

## 当前事实

- Node、npm、精确依赖、`package-lock.json` 和项目内 Playwright Chromium 已存在。
- `npm ci`、TypeScript typecheck、Pi 本地边界探针和 Playwright 动态 Diff 已有通过证据。
- Figma REST Flow 探针已证明节点、截图和图片填充核心能力可读。
- Variables 接口当前返回 403，能力状态为 `unavailable_optional`，不阻塞 Figma 侧核心门。
- OpenAI `gpt-5.4` live 图像与四工具回合尚未授权，整体 M0 尚未完成。
- 四个 Extension 工具目前仍是 M0 边界骨架，M1-M3 生产闭环尚未实现。
- 仓库仍有 Desktop MCP、Framelink 和旧文档残留，只能作为历史迁移材料，不是生产默认或 fallback。
- 当前目录不是 Git 仓库；不得自行初始化 Git。

任何阶段开始前都必须重新加载 Worktrail context 和实际仓库状态，不能把本节当作永久不变的运行快照。

## 已接受架构

```text
Pi Coding Agent TUI（OpenAI gpt-5.4）
  -> 受控 TypeScript Extension（模型可见工具恰好 4 个）
  -> inspect_figma
  -> 项目自有 Figma REST Adapter
  -> DesignBundle
  -> Schema 校验的多页面 ui-spec.json
  -> 本地 JSON Project Store 与不可变历史
  -> localhost React 三栏 Preview
  -> Playwright 功能、键盘、截图和视觉 Diff
```

模型只能使用：

1. `inspect_figma`
2. `load_ui_spec`
3. `save_ui_spec`
4. `render_and_compare`

Figma 正式通道只有官方 REST API。Remote MCP、Desktop MCP、第三方 MCP、浏览器抓取和第二 Agent Loop 均不得作为生产默认或静默 fallback。

Variables 是可选增强能力。完整 Variables 不可用时，系统可以使用 Styles、`boundVariables` 关系和节点最终解析值生成带来源标记的项目设计值，但不得伪造 Figma 变量名称、模式或别名链。

## 数据与安全边界

- 凭据只从本机进程环境读取，不进入命令参数、项目文件、报告、Worktrail、浏览器或普通日志。
- 模型可见工具集在启动和 provider 请求前都必须恰好为四个。
- 受控启动关闭 Pi 内置工具及 Extension、Skill、Prompt、Context 自动发现，并拒绝 `user_bash`。
- 项目数据限制在 `data/projects/<projectId>`，拒绝绝对路径、`..` 和符号链接逃逸。
- DesignBundle 和 UISpec 使用 Schema、revision CAS、不可变 history、临时文件、fsync 和原子 rename。
- 核心读取、校验、保存或验证失败时，不得覆盖上一份有效数据。
- 报告只保留状态、数量、版本、字节数、哈希、能力分类和脱敏错误。

## MVP 范围

必须交付：

- 未知 Figma 的多页面识别和标准化 DesignBundle。
- Schema 校验的多页面 json-render UISpec。
- 本地 JSON Project Store、不可变历史和崩溃恢复。
- React + Vite 三栏工作区。
- Playwright 功能、键盘、截图和视觉 Diff。
- Flow test 校准、冻结基线和三个未知输入盲测。

明确排除：

- React/Next.js 源码导出
- Tauri/Electron
- A2UI
- 数据库、登录、队列、云部署和多租户
- 产品运行时 Multi Agent
- 真实后端集成
- 自动 commit、PR、发布和部署

不得为延期能力建立占位目录、空接口或依赖。

## 当前阶段

P0 正在复核正式实施计划与实际仓库。完成正式知识一致性修复后，按顺序执行：

1. M0.1 同步 README、环境示例、旧架构入口、package scripts 和 M0 汇总。
2. M0.2 固化 Figma REST 核心分类和离线 fixture。
3. 获得单独授权后执行 Pi + OpenAI live probe。
4. 全部 M0 硬门通过后进入 M1 持久化 REST 垂直切片。
5. 完成 M2 Flow 校准并冻结基线。
6. 到达 M3 后再索取三个未知 Figma 输入执行盲测。

未经单独授权，不调用真实 OpenAI/Figma，不新增或升级依赖，不下载浏览器，不改变公共契约，不执行 Git 或远端操作。

## 正式资料

- [架构决策快照](architecture/figma-to-ui-agent-architecture-snapshot.md)
- [MVP 技术方案](architecture/figma-to-ui-agent-mvp-solution.md)
- [MVP 实施计划](workflows/figma-to-ui-agent-mvp-implementation-plan.md)
- [自主交付 Goal](workflows/figma-to-ui-agent-autonomous-delivery-goal.md)
