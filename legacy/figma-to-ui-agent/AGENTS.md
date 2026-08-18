# figma-to-ui-agent

> 面向 AI Coding Agent 的项目速查文档。若与代码、README 或 Worktrail 正式知识冲突，以当前可运行的代码和已落盘的证据为准。

## 1. 项目概述

本项目是一个**本地可运行、可恢复、可验证、可审计的 Figma-to-UI Agent MVP**。核心目标是：给定未知 Figma 文件，Agent 通过官方 Figma REST API 读取设计，生成本地受控的 `ui-spec.json`，在 localhost React 三栏 Preview 中渲染，并用 Playwright 完成功能、键盘、截图与视觉 Diff 验证。

当前已冻结 M3 基线：`data/baselines/m3/freeze.json`。三个未知输入盲测尚未执行完毕，但端到端 Flow 校准链路已通过。

明确排除的范围：源码导出、Tauri/Electron、A2UI、数据库、登录、队列、云部署、多租户、产品运行时 Multi Agent、真实后端、自动 PR/发布/部署。

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js（ES Modules，`type: "module"`） |
| 语言 | TypeScript 7.0.2，目标 ES2022，模块 NodeNext |
| Agent 宿主 | `@earendil-works/pi-coding-agent` 0.81.1 |
| LLM | OpenAI `gpt-5.4`（模型 ID 被硬编码校验，不可替换） |
| 官方通道 | Figma REST API v1（唯一生产通道） |
| Schema/校验 | Zod 4.4.3 + typebox 1.1.38（工具输入输出用 Zod，Preview Catalog 用 Zod） |
| UI 渲染 | React 19.2.7 + `@json-render/core` / `@json-render/react` 0.19.0 |
| 构建/预览 | Vite 8.1.5 + `@vitejs/plugin-react` 6.0.3 |
| 浏览器/验证 | Playwright 1.61.1（Chromium） |
| 测试框架 | Vitest 4.1.10 |

## 3. 架构与数据流

```text
Pi Coding Agent TUI（OpenAI gpt-5.4）
  -> 受控 TypeScript Extension（src/extension.ts）
  -> 模型可见工具恰好 4 个
       inspect_figma
       load_ui_spec
       save_ui_spec
       render_and_compare
  -> 项目自有 Figma REST Adapter（src/figma/）
  -> DesignBundle（src/design-bundle/schema.ts）
  -> 多页面 ui-spec.json（src/ui-spec/schema.ts）
  -> 本地 JSON Project Store（src/project-store/）
  -> localhost React 三栏 Preview（preview/）
  -> Playwright 功能、键盘、截图、视觉 Diff（src/validation/）
```

关键约束：

- 模型只能看到上述 4 个工具；Remote MCP、Desktop MCP、第三方 MCP、浏览器抓取、第二 Agent Loop 均不是生产默认或 fallback。
- Figma 正式通道只有官方 REST API。
- Variables 是可选增强能力；不可用时只允许使用带来源标记的推导设计值，不得伪造 Figma 变量语义。
- 受控启动会关闭 Pi 内置工具、Extension/Skill/Prompt/Context 自动发现，并拒绝 `user_bash`。

## 4. 目录结构

```text
src/
  design-bundle/    # DesignBundle Schema、标准化节点、变量处理
  figma/            # REST 客户端、URL 解析、节点标准化、图片下载、Variables
  media/            # 图片魔数/MIME/尺寸校验
  preview/          # Vite 插件、Preview 数据服务、json-render Catalog/适配器
  project-store/    # 本地项目存储、路径安全、写锁、历史、CAS
  runtime/          # Extension 运行时、工具边界、Provider 配置、冻结策略
  tools/            # 四工具输入输出契约、UISpec 服务、unsupportedFeatures
  ui-spec/          # UISpec Schema
  validation/       # Playwright 渲染比较、验证记录、基线
  extension.ts      # Pi Extension 入口
preview/            # React 三栏 Preview 应用
scripts/            # 启动脚本与 M0/M2/M3 探针/校准/冻结/盲测
tests/
  unit/             # Vitest 单元测试
  integration/      # Vitest 集成测试（含 mock REST 纵向）
  e2e/              # Playwright E2E
  probes/           # Playwright 公开 API 探针
  fixtures/         # 测试夹具
data/               # 本地数据（被 .gitignore 忽略）
reports/            # 人工可读报告（已纳入版本库）
docs/               # 仓库架构摘要、FlowPlan 讨论结论
```

## 5. 构建与常用命令

> 所有命令均在项目根目录执行。

不访问外部服务的本地验证：

```bash
npm ci --ignore-scripts --audit=false --fund=false
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run probe:m0:local
npm run probe:m2:local
npm run prepare:m3
npm run probe:m3:local
npm exec -- vite build --config vite.config.ts
```

启动 Agent（需要本机环境配置 OpenAI 凭据）：

```bash
npm run start:agent
# 干跑查看实际命令
npm run start:agent -- --dry-run
```

Preview 开发服务器：

```bash
npm run preview:dev
```

外部探针（需要显式授权环境变量，详见 `.env.example`）：

```bash
npm run probe:openai
npm run probe:openai:live
npm run probe:figma:rest
npm run probe:figma:rate-limit
FIGMA_RATE_LIMIT_PROBE_AUTHORIZED=1 npm run probe:figma:rate-limit:live
```

M3 工作流：

```bash
# 1. 冻结前预检
npm run prepare:m3

# 2. Flow 校准（需 M3_FLOW_EXTERNAL_AUTHORIZED=1 等）
npm run run:m3:flow

# 3. 人工审阅通过后冻结
M3_FLOW_CALIBRATION_CONFIRMED=1 M3_VISUAL_THRESHOLD_CONFIRMED=1 \
  npm run freeze:m3 -- --confirm \
  --flow-record data/projects/<flow-project>/runs/<run-id>/validation.json

# 4. 未知输入清单
M3_UNKNOWN_INPUT_CONFIRMED=1 npm run manifest:m3

# 5. 盲测
npm run blind:m3

# 6. 最终汇总
M3_CASE_IDS=case-a,case-b,case-c npm run finalize:m3
```

> `prepare:m3` 和 `probe:m3:local` 是冻结前门禁。生成 `freeze.json` 后不要再把 `prepare:m3` 作为例行步骤运行。

## 6. 代码风格与开发约定

- **模块系统**：ES Modules，`*.ts` / `*.mjs` 文件使用显式扩展名导入（`allowImportingTsExtensions: true`）。
- **类型**：启用 `strict: true`；所有外部输入必须经过 Zod Schema 解析。
- **路径安全**：任何受管文件路径必须经过 `safeRelativePathSchema` 与 `project-store/path-safety.ts` 校验，禁止绝对路径、`..`、符号链接、路径逃逸。
- **错误处理**：按领域定义错误类（如 `FigmaRestError`、`ProjectStoreError`、`RenderValidationError`），并携带机器可读 `code`。
- **资源上限**：代码中大量存在明确的数值上限（节点数、图片字节、请求重试、上下文条目、审计长度等），修改时需同步检查对应测试和 Schema。
- **审计与日志**：所有外部调用、工具调用、M3 运行都写入脱敏审计；不得把凭据、文件键、Token、原始 URL、响应正文写入普通日志、报告或版本库。
- **失败关闭（fail closed）**：核心能力失败、Schema 不兼容、引用悬空、路径逃逸、修订冲突均不得覆盖上一份有效 `current.json`。

## 7. 测试策略

- **单元测试**：`tests/unit/`，用 Vitest，覆盖 Schema、URL 解析、标准化、Catalog、Project Store、运行时策略等。
- **集成测试**：`tests/integration/`，覆盖 mock REST 纵向流程、Extension 工具接线、Preview 服务、render-and-compare。
- **E2E 测试**：`tests/e2e/`，用 Playwright 覆盖 Preview 三栏交互、原生表单、键盘焦点、loading/empty/error/stale 状态、移动堆叠。
- **探针测试**：`tests/probes/` 用于 Playwright 公开 API 动态 Diff 能力验证。

运行方式：

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

M3 真实 Flow/盲测是“运行即证据”，其输出目录受版本化 Schema 校验并可能成为审计材料；本地模式探针不访问网络。

## 8. 安全与合规

- **凭据**：只从进程环境读取，见 `.env.example`。不要创建 `.env`、`.envrc` 或把凭据写入命令参数、报告、Worktrail、浏览器或版本库。
- **Figma 输入校验**：URL 必须属于 `https://www.figma.com/design/...`，拒绝非标准端口、用户信息、hash、非法 file key / node id、冲突 node-id。
- **图片下载**：只接受已知 Figma/CDN HTTPS 主机（`figma.com`、`figmausercontent.com`、`amazonaws.com`、`cloudfront.net`），通过 MIME、魔数、尺寸、字节上限校验，按内容哈希命名保存。
- **数据隔离**：项目数据隔离在 `data/projects/<projectId>/`，使用 revision CAS、不可变历史、每项目写锁、`fsync`、原子发布。
- **文件权限**：敏感文件（如 Pi 配置、M3 审计）强制 `0600`。
- **外部授权**：真实 OpenAI/Figma 探针、Flow 校准和盲测必须设置对应 `*_AUTHORIZED=1` 开关。未经授权不得调用外部服务。
- **冻结策略**：M3 冻结后，`frozenRunPolicy` 会锁定 viewport、比较参数和关键源码哈希；盲测入口会在缺少冻结文件或授权时失败关闭。

## 9. 数据布局

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

data/baselines/m3/freeze.json       # M3 冻结基线
data/blind/m3/                      # 盲测输入与证据
data/calibration/m3/                # Flow 校准运行记录
data/audit/                         # 工具生命周期审计
data/probes/                        # 探针机器可读证据
data/pi-config/                     # Pi provider 配置（不含密钥）
data/pi-sessions/                   # Pi session 目录
data/playwright-browsers/           # 项目内 Playwright Chromium
data/preview-dist/                  # Vite 构建输出
data/e2e/                           # E2E 测试结果
```

`data/` 整个目录被 `.gitignore` 忽略；只有 `reports/` 中的脱敏人工可读报告会进入版本库。

## 10. 关键模块速查

| 文件 | 职责 |
|------|------|
| `src/extension.ts` | Pi Extension 入口；实现四工具、受控 Prompt、迭代限制、审计脱敏 |
| `src/runtime/tool-boundary.ts` | 硬编码“恰好四工具”边界校验 |
| `src/runtime/tool-services.ts` | 本地四工具服务组装（FigmaInspector、UISpecToolService、RenderAndCompareService） |
| `src/tools/contracts.ts` | 四工具输入输出 Zod Schema |
| `src/figma/inspector.ts` | Figma 检查主流程：REST 读取、节点标准化、变量处理、图片下载、DesignBundle 发布 |
| `src/figma/rest-client.ts` | 可注入 `fetch`、超时、取消、响应大小上限、有限重试、429 诊断的 Figma REST 客户端 |
| `src/figma/assets.ts` | 图片下载器：主机白名单、字节上限、格式校验、内容哈希命名 |
| `src/figma/url.ts` | Figma URL / file key / node id 解析与校验 |
| `src/design-bundle/schema.ts` | DesignBundle、LocalImageRef、VariablesCapability 等 Schema |
| `src/ui-spec/schema.ts` | 多页面 UISpec、受控组件目录、动作、状态、视口、行为夹具 Schema |
| `src/project-store/store.ts` | ProjectStore：写锁、CAS、历史、引用闭合校验 |
| `src/project-store/path-safety.ts` | 路径安全、符号链接拒绝、项目布局初始化 |
| `src/validation/render-and-compare.ts` | Playwright 渲染、行为夹具、像素比较、验证记录保存 |
| `src/validation/baseline.ts` | 固定的验证基线参数（viewport、DPR、locale、diff 算法等） |
| `src/preview/catalog.ts` | `@json-render` 受控 Catalog 定义 |
| `src/preview/json-render-adapter.ts` | UISpec -> JSON Render Spec 转换 |
| `src/preview/server.ts` | Preview 本地数据服务 |
| `preview/src/preview-app.tsx` | 三栏 Preview UI |

## 11. 给 Agent 的注意事项

1. **不要改模型**：`REQUIRED_OPENAI_MODEL = "gpt-5.4"`，任何替换都会触发启动失败。
2. **不要改四工具边界**：`EXACT_TOOL_NAMES` 是硬契约，新增/删除/重命名都会触发 `tool_boundary_violation`。
3. **不要改冻结源码**：M3 冻结后，关键源码哈希已被记录；修改会导致 `blind:m3` 在校验源码哈希时失败关闭。
4. **不要为排除范围创建占位代码**：README 已明确排除的能力不要新建目录、空接口或依赖。
5. **所有外部输入都要 Schema 化**：不要直接透传 Figma 响应或用户输入给模型/文件系统。
6. **路径必须经 path-safety 校验**：禁止自行拼接 `data/projects/...`。
7. **失败关闭优先**：不确定时选择报错并保留旧版本，而不是静默覆盖或猜测。
8. **保持审计脱敏**：不要在审计、日志、报告中写入 URL、文件键、Token、图片内容、UISpec 正文或助手正文。
9. **变更后跑全本地验证**：`typecheck` + `test:unit` + `test:integration` + `test:e2e` 是默认门禁。
10. **正式项目知识在 Worktrail**：Coding Agent 开始实质工作前，应运行 `worktrail context --semantic=auto "<任务>"` 以正式知识和实际证据为准。
