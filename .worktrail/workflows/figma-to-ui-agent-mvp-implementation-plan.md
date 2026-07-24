---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-mvp-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent MVP 实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent MVP 实施计划

## 1. 计划状态

- 架构前提：纯 Figma REST API 是唯一正式 Figma 通道。
- Variables：可选增强能力，不阻塞 Figma 侧核心门。
- 当前证据：Flow test 的节点、截图和图片资源已通过；Variables 返回 403，记录为 `unavailable_optional`。
- 外部边界：OpenAI live probe 尚未获本轮授权，整体 M0 仍不能宣称完成。
- P0 边界：最高优先级的 `project.md` 与架构快照必须先和纯 REST 正式基线一致；对应替换候选未推广前不得修改 M0/M1 生产入口。
- 依赖边界：现有精确版本和 lockfile 已建立；新增或升级依赖必须另行确认。
- 交付原则：每个阶段形成可运行、可恢复、可测试的纵向切片，不堆积无法执行的框架代码。

## 2. 全局不变量

1. 模型可见工具始终恰好为 `inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`。
2. Figma 访问只通过项目自有 REST Adapter，不使用 Remote/Desktop/第三方 MCP 或浏览器抓取。
3. Variables 不可用时继续核心流程，但不伪造变量名称、模式、别名和语义。
4. OpenAI 只由 Pi provider 调用，不建立第二 Agent Loop。
5. 任何失败不得覆盖上一份有效 DesignBundle 或 UISpec。
6. 凭据、原始文件键、远端资产 URL 和私有原始载荷不进入报告、Worktrail 或普通日志。
7. 所有项目文件读写受 `projectId` 路径隔离、Schema 校验、revision CAS 和原子写保护。
8. 样本文件键、节点 ID、页面名称和视觉常量不得写入生产代码。

## 3. 当前仓库基线

已存在：

- 精确版本 `package.json` 和 `package-lock.json`
- Pi 受控启动器
- 四工具边界与漂移检查
- 本地 Pi 和 Playwright 探针
- Figma Desktop 历史探针
- Framelink 可行性探针，但未执行第三方 MCP
- 纯 REST Flow 探针及脱敏报告
- 项目内 Playwright Chromium

需要替换或同步：

- `scripts/probe-m0.mjs` 仍把 Desktop MCP 当外部门
- `scripts/probe-figma.mjs` 仍是 Desktop MCP 探针
- `.env.example` 仍描述 Desktop MCP
- Worktrail `project.md` 仍保留“项目壳、Figma MCP”的旧状态与通道描述
- 正式架构快照仍保留“本候选等待 promote”的过期状态措辞
- `README.md` 和 `docs/architecture.md` 仍保留旧通道描述
- Extension 四个工具目前主要是边界骨架，尚未形成真实业务闭环

旧文件不能静默删除。先增加 REST 实现和测试，确认新入口后再把旧探针标记为历史或移除；删除属于明确的清理步骤。

## 4. M0：能力冻结

### M0.1 正式基线同步

目标：先完成最高优先级正式知识的一致性修复，再使运行文档与生产入口不再指向 Desktop/Remote MCP。

改动：

- 创建并推广 `project.md` 替换候选，准确记录当前依赖、REST 核心证据、Variables 可选状态和 OpenAI 待授权状态。
- 创建并推广架构快照替换候选，把候选阶段措辞改为已接受正式基线；不改变已接受的 REST 契约。
- 两个正式知识候选推广后重新运行 Worktrail context；只有 source priority 不再冲突，才开始项目文件修改。
- 更新 README 的当前状态、架构图、下一步和外部授权说明。
- 更新 `.env.example`，只保留变量名称和安全注释，不写真实值。
- 同步或明确退役 `docs/architecture.md`，避免与 Worktrail 正式架构冲突。
- 为纯 REST 探针增加 package script。
- `scripts/probe-m0.mjs` 汇总 REST 核心结果和 Variables capability。

验证：

- Worktrail context 中 `project.md`、架构快照、技术方案、实施计划和自主 Goal 对当前状态、REST 通道和 Variables 策略一致。
- 正式文档不再出现“本候选等待 promote”或把 Figma MCP 作为当前下一步。
- 文本搜索不再把 Desktop/Remote MCP 描述为正式默认或 fallback。
- 本地 M0 不访问 Figma 或 OpenAI。
- live 模式缺少授权标志时在网络前失败。

### M0.2 Figma REST 核心探针

当前状态：已通过。

已验证：

- 节点树、组件、Styles 和解析视觉值可读。
- 目标截图请求和 PNG 下载可用。
- 图片填充枚举和样本下载可用。
- Variables 403 被记录为可选能力不可用。
- 报告不含凭据、原始文件键和远端 URL。

补充工作：

- 将分类函数提取为可单元测试模块。
- 增加核心失败、Variables 403、零资产和非法图片响应 fixture。
- 把探针中的样本默认值隔离到 probe fixture，禁止进入生产 Adapter。

### M0.3 Pi + OpenAI live probe

前置：用户单独授权真实 OpenAI 调用。

验证：

- 当前 Pi 包可选择 `gpt-5.4`。
- 图像输入可用。
- 模型可见工具恰好四个。
- provider payload 没有额外工具。
- 模型只调用允许工具，Shell 仍被拒绝。
- 只保存模型名、请求类型、工具名、状态和脱敏错误，不保存敏感正文。

失败处理：停止 M1-M3，不更换模型、不旁路调用 OpenAI、不降低工具边界。

### M0.4 Playwright 与可复现基线

验证：

- Chromium revision、Node、npm、Pi、React、json-render、Zod 和 Playwright 版本可记录。
- 动态相同图片通过，已知偏移按预期失败并产生三图证据。
- 字体、Viewport、DPR、动画关闭方式、Diff 算法和阈值在 Flow 校准前可配置，在 M2 后冻结。

### M0 退出条件

- M0.1、M0.2、M0.3、M0.4 全部通过。
- Variables 可以是 `available` 或 `unavailable_optional`。
- 生成一份总体 M0 报告，明确每个硬门和可选能力状态。

## 5. M1：持久化 REST 垂直切片

### M1.1 契约与目录

新增建议：

```text
src/figma/
src/design-bundle/
src/project-store/
src/ui-spec/
tests/unit/figma/
tests/unit/store/
tests/integration/figma/
tests/fixtures/figma/
```

先实现 Zod 契约：

- `InspectFigmaInput`
- `VariablesCapability`
- `DesignBundle`
- `LocalImageRef`
- `UISpec`
- 四工具输入与输出

验证：有效 fixture 通过；未知字段、悬空引用、非法路径、非法 URL 和不兼容版本失败。

### M1.2 URL 与 REST Client

实现：

- Figma Design URL、文件键和节点 ID 解析。
- 主机、协议、路径和长度白名单。
- 30 秒默认超时、AbortSignal、响应大小上限。
- 429 退避和有限 5xx 重试。
- 状态码与错误清洗。
- 可注入 `fetch`，测试不访问真实网络。

验证：单元测试覆盖合法 URL、编码、冲突节点、非法主机、超时、429、5xx 和响应过大。

### M1.3 节点标准化

实现：

- 页面候选发现和显式节点优先。
- 页面、组件、实例、文本、布局、Styles、图片引用和 `boundVariables` 标准化。
- 不支持节点保留可追溯警告，不导致递归崩溃。
- 大树遍历有节点数量和深度保护。

验证：复杂 Auto Layout、组件实例、文本、空页面和超限 fixture。

### M1.4 截图与资产

实现：

- 截图请求和目标选择。
- HTTPS 地址校验、重定向限制、大小上限、MIME 与魔数检查。
- SHA-256 内容寻址、去重和项目内相对引用。
- 默认最多 4 个并发下载。
- 失败时清理临时文件。

验证：PNG/JPEG、零资产、重复资源、非法协议、超大文件、格式伪装、超时和重定向。

### M1.5 Variables 与设计值降级

实现：

- Variables 成功时解析集合、模式、别名和值。
- 401/403 安全分类为 `unavailable_optional`。
- `boundVariables` 关系和解析值保留。
- 推导设计值标记 `figma_variable`、`inferred_from_binding` 或 `inferred`。
- 禁止根据变量 ID 猜测名称。

验证：三种来源 fixture、别名链、模式、无权限、空变量和无法分类错误。

### M1.6 DesignBundle 原子存储

实现：

- revision、history、current 和 provenance。
- 临时文件、fsync、原子 rename。
- 核心全部成功后才发布。
- 崩溃恢复和旧版本保留。

验证：成功更新、核心中途失败、Schema 失败、rename 前崩溃、并发写冲突和恢复。

### M1 退出条件

- mock REST 可完成 inspect 到 DesignBundle 的完整切片。
- Variables 403 切片仍成功。
- 任一核心失败不覆盖旧版本。
- 真实 Figma 只在单独授权的集成探针中调用。

## 6. M2：UISpec、Preview 与 Agent 闭环

### M2.1 UISpec 与 Catalog

实现受控 Catalog 和多页面 UISpec：

- 页面、路由、布局、文本、图片、交互、状态和设计值引用。
- 禁止任意 JSX、脚本、外部 URL、任意 CSS 和未声明事件。
- 保存使用 `baseRevision` CAS、不可变 history 和原子 current。

### M2.2 三栏 Preview

实现：

- 左栏 Figma 截图参考。
- 中栏 json-render 当前实现。
- 右栏检查结果、actual/diff 和错误。
- 页面、Viewport、缩放和像素查看控制。
- 明确 loading、empty、error、stale revision 状态。
- 键盘可达性和焦点可见。

### M2.3 render_and_compare

实现：

- 启动或复用本地 Preview。
- 固定页面、Viewport、DPR、字体和动画策略。
- 执行行为 fixture。
- 捕获控制台和页面错误。
- 生成 expected、actual、diff 和 validation.json。
- 返回结构化结果，不返回任意本地路径。

### M2.4 四工具真实闭环

完成：

1. `inspect_figma` 生成 DesignBundle。
2. `load_ui_spec` 读取当前 revision。
3. Agent 生成或修订完整 UISpec。
4. `save_ui_spec` 原子保存。
5. `render_and_compare` 验证。
6. Agent 根据结构化差异有限迭代。

设置每轮最大迭代次数和停止条件，避免无限循环。

### M2 退出条件

- Flow test 多页面可浏览。
- 主要行为 fixture 通过。
- 键盘检查通过。
- 视觉结果达到校准阈值或留下明确未通过证据。
- 中断后可以从最近有效 DesignBundle 和 UISpec 继续。

## 7. M3：冻结与未知文件盲测

### M3.1 冻结基线

冻结：

- Node、npm 和依赖 lockfile
- Pi 包和 `gpt-5.4`
- Prompt 和四工具 Schema
- Chromium revision
- 字体、Viewport、DPR 和动画策略
- Diff 算法、阈值、重试和迭代上限

### M3.2 三次盲测

使用三个此前未用于开发和 Prompt 调整的 Figma 输入，至少覆盖：

- 无 Variables
- 有 `boundVariables` 但完整 Variables 不可用
- 完整 Variables 可用，若当前账号条件无法提供则使用契约 fixture 并明确非 live 证据
- 多页面和不同 Viewport
- 组件、图片和复杂 Auto Layout

记录每次：

- 是否一次完成
- Agent 迭代次数
- 人工输入内容
- 功能与键盘结果
- 视觉差异
- 能力降级和失败原因

### M3 退出条件

- 三次结果可重复。
- 没有样本专属生产分支。
- 已知限制有复现步骤和后续决策条件。
- README 与 Worktrail 正式知识反映最终边界。

## 8. 提交与验证节奏

建议按以下独立可审查增量实施：

1. M0 文档与探针同步。
2. URL、REST Client 和响应契约。
3. 节点标准化与 Variables 降级。
4. 截图、资产和 DesignBundle Store。
5. UISpec Store 与 Catalog。
6. Preview。
7. Playwright Validator。
8. 四工具闭环。
9. Flow 校准和盲测。

每个增量必须先运行最窄单元或集成测试，再运行 typecheck；只有跨越真实页面链路时才运行 E2E。不得自动提交、推送、发布或部署。

## 9. 回滚策略

- 单个代码增量通过独立提交回滚，但提交动作由用户授权。
- DesignBundle 和 UISpec 使用不可变 history，可将 current 指回最后一个有效 revision。
- 新 REST 实现稳定前保留旧探针作为历史诊断，不作为生产 fallback。
- 任何 M0 硬门重新失败时停止 M1-M3，不以关闭测试或放宽安全边界解决。

## 10. AC1-AC10 验收追踪矩阵

- AC1 运行时唯一性：项目使用当前锁定的 Pi Coding Agent TUI 和 OpenAI `gpt-5.4`，不存在自研 TUI、第二 OpenAI SDK Agent Loop、Claude Agent SDK 或旧 badlogic 包。证据：依赖清单、代码依赖扫描、M0 Pi/OpenAI 报告。
- AC2 四工具边界：Extension 只注册并激活四个正式工具，启动、输入、turn 和 provider 请求前均失败关闭；内置工具与资源自动发现关闭，`user_bash` 不执行进程。证据：Pi 单元/集成探针、provider 工具名审计和 Shell 拒绝测试。
- AC3 Figma REST 能力：`inspect_figma` 只通过项目自有 REST Adapter 读取节点、截图和图片填充；核心任一失败不发布 DesignBundle；Variables 可为 `available` 或 `unavailable_optional`。证据：live 脱敏报告、mock REST fixture 和核心失败回归测试。
- AC4 领域契约：DesignBundle、UISpec、Catalog、Action 和四工具输入输出均通过版本化 Zod Schema；未知组件、脚本、外部网络 Action、悬空引用和不兼容版本失败。证据：Schema 单元测试和四工具集成测试。
- AC5 持久化安全：所有数据限制在 `data/projects/<projectId>`；拒绝绝对路径、`..` 和符号链接逃逸；DesignBundle 与 UISpec 使用 revision CAS、不可变 history、fsync 和原子 rename，失败保留上一有效版本。证据：路径、并发、崩溃恢复和旧 revision 测试。
- AC6 Preview 完整性：React + json-render 三栏工作区支持页面、状态、Viewport、缩放和像素检查，具备 loading、empty、error、stale 和禁用状态；关键路径使用原生语义、Label、键盘和可见焦点。证据：组件测试、Playwright 键盘 E2E 和桌面/移动截图。
- AC7 验证器可重复：`render_and_compare` 只使用 Playwright 公开 API，在固定 Chromium、字体、Viewport、DPR 和动画策略下执行行为、控制台检查、截图和视觉 Diff；正常、异常和取消均清理项目拥有的进程。证据：相同/偏移图片探针、功能 E2E、三图附件和端口/进程清理检查。
- AC8 Flow 校准：从空项目完成 Flow test 全循环，最多三轮 UISpec 修订，只修改通用 Prompt、Catalog、解析或验证能力；生产代码不含 Flow 文件键、节点、页面名、文案、资产 ID 或样本分支；冻结后从空目录复跑。证据：run records、源码扫描、Prompt/Schema 哈希和复跑报告。
- AC9 未知输入盲测：到达 M3 后使用三个未知 Figma 输入，在完全相同冻结配置下独立运行，期间不修改源码、UISpec、Prompt、Catalog、Schema、工具、模型、浏览器、字体或阈值。证据：三个 source manifest、冻结哈希和归一化结果比较。
- AC10 审计与交付：凭据、原始文件键、远端临时 URL 和私有载荷不进入项目知识、报告、浏览器或普通日志；README、运行手册和最终报告使用中文，并列出实现、锁定版本、命令结果、运行方式、限制、残余风险和未执行事项。证据：秘密扫描、脱敏报告、文档核对和最终完成审计。

每个 AC 只有在列出的实现证据和相应自动化验证均存在时才能标记为完成；候选、fixture 或单次探针不能替代生产闭环证据。

## 11. 残余假设

- assumption: 未知 Figma 文件的 REST 节点数据足以生成 MVP 所需 UISpec。
  validation_method: Flow test 校准后，使用冻结配置执行三个未知输入盲测并记录 unsupportedFeatures。
- assumption: 完整 Variables 不可用时，Styles、boundVariables 关系和节点解析值仍能维持可接受视觉保真度。
  validation_method: 对无 Variables、仅绑定关系和完整 Variables 三类 fixture 执行语义与视觉测试，并在 M3 记录能力降级。
- assumption: `gpt-5.4` 在当前 Pi 包中支持所需图像和四工具回合。
  validation_method: 获得单独授权后执行 M0.3 live probe；失败时停止 M1-M3，不更换运行拓扑或降低工具边界。
- assumption: Figma 返回的临时资产地址可在严格 HTTPS、重定向、大小和 MIME 限制下安全下载。
  validation_method: M1 集成测试覆盖合法下载、非法协议、跨主机重定向、超时、超限和格式伪装。

## 12. 完成定义

- 四工具闭环端到端可运行。
- Figma REST 核心能力稳定，Variables 可选状态透明。
- 数据持久化具备隔离、CAS、原子性和崩溃恢复。
- Preview 功能完整且键盘可用。
- Playwright 功能和视觉证据可重复。
- Flow test 和三次盲测完成。
- 凭据与私有原始载荷没有进入项目知识或报告。
- 无 Remote/Desktop/第三方 MCP fallback、无第二 Agent Loop、无样本专属生产代码。
