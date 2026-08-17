# vite-multipage-agent

本地示例：Agent 通过 `@next-app-runtime/client` 生成与编辑多页面应用。
Vite + React 外壳，CopilotKit v2 聊天 UI，Mastra Agent，经 AG-UI 连接本地
Hono 服务器；默认模型 `gpt-5.6-luna`（服务端固定，可用服务端环境变量
`VMA_OPENAI_MODEL` 覆盖，但不接受请求体透传）。

本示例同时是一个**本地可持久化的多应用平台**（设计见
`docs/persistence-release-platform-design.md`，AC 映射见
`docs/vite-multipage-agent-ac-traceability.md`）：

- 邀请制账号：邮箱 OTP / 魔法链接，开发环境经本地收件箱（不发送真实邮件）；
- 多应用与成员角色（owner / editor / viewer，角色是能力上限）；
- 生成工作区、草稿、显式发布、历史保留与回滚；
- 业务数据 API（集合/字段权限、固定查询投影、乐观并发、唯一值事务）；
- Schema 迁移计划（破坏性变更全量验证后原子发布）；
- 30 天回收站与平台治理恢复。

持久层为 MySQL（docker compose 本地实例）+ Drizzle ORM；服务启动时执行
启动迁移与孤儿运行扫描，失败即拒绝启动（fail closed）。

## 架构

```text
浏览器（src/）                          Hono 服务器（server/）
┌────────────────────────────┐        ┌──────────────────────────────┐
│ CopilotChat（左栏）         │  AG-UI │ CopilotKit Runtime            │
│ CopilotKitTools            │◄──────►│ CoordinatedMastraAgent        │
│  useFrontendTool           │  SSE   │  └ MastraAgent（聊天 Agent）  │
│  useRenderTool             │        │    └ generate_spec 工具       │
│  useInterrupt              │        │       └ 生成器 LLM            │
│ RuntimeApplyController     │ CUSTOM │ GenerationCoordinator         │
│  spec.patch.* → applySource│◄───────│  spec.patch.* / interrupt     │
│ PreviewPanel（右栏）        │        └──────────────────────────────┘
│  @next-app-runtime/client  │
└────────────────────────────┘
```

- 浏览器侧**不承载任何 LLM 编排代码**：Mastra Agent、全部工具定义
  （含前端工具的服务器侧声明）与 Prompt 统一在 `server/`。
- 应用的唯一事实来源是 `runtime.getSnapshot().current`，不是聊天状态。
- 应用修改的唯一入口是 `generate_spec` 服务器工具产出的 JSONL Patch
  （RFC 6902），经 `spec.patch.*` CUSTOM 事件流到浏览器，由
  `RuntimeApplyController` 交给 `runtime.applySource` 提交；聊天文本中
  从不携带 Patch。
- `runtime.applySource` 被拒绝/中止时保留最后一份有效预览。
- API Key 只在服务器进程环境读取（`OPENAI_API_KEY`），浏览器永不持有。

## 工具协议（恰四工具 + 协议内部收尾）

| 工具 | 位置 | 说明 |
| --- | --- | --- |
| `get_current_spec` | 前端 | 返回 `{ hasCurrentSpec, spec, revision }`（编辑前必调） |
| `summarize_current_app` | 前端 | 结构化摘要（页面/导航/主要元素），问答路径使用 |
| `request_user_decision` | interrupt | 澄清 / 计划确认；`decisionId` 一律由服务端签发 |
| `generate_spec` | 服务器 | 唯一应用修改入口；返回 `{ status: "patch_streaming", generationId }` |
| `await_apply_result` | 协议内部 | 由协调器在 Patch 流结束后确定性发出；浏览器等 `applySource` 落定后 resolve（`committed / failed / aborted`） |

`threadId / runId / toolCallId / decisionId / generationId` 的关联校验全部在
`GenerationCoordinator` 完成；不匹配一律按 `aborted` 处理（fail closed），
不恢复、不重放。刷新页面或服务器重启后，未完成协调状态全部作废。

## 运行

前置：Node 24（server/ 使用原生 TypeScript 类型剥离）；本地 MySQL：

```bash
npm run db:up               # docker compose up -d --wait（MySQL :3317）
```

```bash
# 真实模式（需要服务端 OPENAI_API_KEY）
ADMIN_EMAILS=you@example.com npm run dev:server   # Hono + CopilotKit Runtime，:3101
npm run dev                 # Vite 开发服务器，:3100（/api 代理到 :3101）

# Mock 模式（不调 LLM，浏览器验收用）
ADMIN_EMAILS=you@example.com npm run dev:server:mock

# Transport 探针模式（G1 门禁复现，无账号体系）
npm run dev:server:probe    # 探针页面 http://127.0.0.1:3100/probe.html
```

`ADMIN_EMAILS` 中的邮箱首次完成邮箱验证即取得管理员角色（可授予应用创建
资格、执行平台治理恢复）。登录验证码与邀请邮件写入开发收件箱，可通过
`GET /api/dev/mail-inbox?email=...` 读取（仅非生产模式挂载）。

## 验证

```bash
npm run typecheck
npm run test                # Vitest：契约 + 集成（每文件独立 MySQL schema，需 db:up）
npm run build

# 浏览器测试（需要 Playwright Chromium 可执行文件路径与 db:up）
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chromium 路径>
npm run test:browser        # transport 探针 + 预览壳（probe 模式）
npm run test:browser:mock   # 全链路验收（mock 模式：创建/导航/编辑/坏补丁/问答
                            # + S8 持久化场景：发布/回滚/角色矩阵/回收站）
```

## 安全与查询语义要点（评审加固后）

- **邀请时效**：过期未撤销的邀请不再换取首次登录资格（`expiresAt` 参与资格判定）。
- **查询门禁（防探测）**：对调用方脱敏或不可读的字段不能作为 `where`/`orderBy`，
  一律 400；防止通过结果差异探测无权字段值。
- **排序/游标语义**：排序按字段类型走原生比较列（数值/日期/布尔不按字典序）；
  游标携带真实类型化排序值；同值记录以 `recordId` 按排序方向稳定收尾，翻页
  不漏不重；排序查询仅包含拥有该字段值的记录。
- **连接池**：显式 `connectTimeout`/`queueLimit`；healthCheck 超时后迟到的
  连接会被释放；启动迁移失败提示如实说明 MySQL DDL 不可回滚、可能存在部分应用。

## Spec 生成模型对比

模型对比默认只打印计划，不调用网关。真实调用必须显式增加
`--confirm-spend`：

```bash
# 无花费 dry-run
npm run benchmark:spec-models -- \
  --models claude-opus-4-8,gpt-5.6-terra \
  --cases todo,insurance-portal \
  --repeats 1

# 付费生成；仍从服务端环境读取 OPENAI_API_KEY/VMA_OPENAI_BASE_URL
npm run benchmark:spec-models -- \
  --models claude-opus-4-8,gpt-5.6-terra \
  --repeats 3 \
  --confirm-spend
```

生成阶段对每个候选记录 Catalog 校验、真实 NextAppRuntime 静态路由提交、
需求词项覆盖、页面/导航/事件/state 结构指标、耗时、Token 与成本。输出位于
`data/spec-model-benchmarks/`：

- `*.jsonl`：逐次完整结果；
- `*.summary.json`：按模型汇总；
- `*.review.json`：不带模型名称的盲评候选清单；
- `specs/candidate-*.json`：匿名候选 Spec。

生成结束后可重复执行浏览器复核，不再次调用模型：

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=<chromium 路径>
export VMA_SPEC_BENCHMARK_REVIEW=<绝对路径>/<run>.review.json
npm run benchmark:spec-models:browser
```

浏览器复核使用独立的 `3110/3111` 端口，逐个提交候选、渲染所有静态路由、
触发第一个可定位的事件按钮，并按匿名 candidate ID 保存截图与
`*.browser.jsonl`。截图供人工盲评视觉层级、布局一致性和完成度；自动词项覆盖
只是可重复的需求代理指标，不能替代人工视觉判断。

## 明确排除

云部署与真实后端、真实邮件发送、匿名访问与公开链接、JSON 导入、实时协作、
自定义角色、离线 PWA、源文件导出、恢复或重放中断的生成任务。测试不依赖
真实 LLM 与真实邮件。
