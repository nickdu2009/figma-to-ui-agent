# figma-to-ui-agent（Legacy）

> 历史 Figma-to-UI Agent，已从仓库顶层产品归档至本独立目录；当前顶层产品为
> `vite-multipage-agent`。本目录可独立安装、运行和维护，但不参与仓库根目录的
> 默认构建、测试或启动流程。

本项目实现一个本地可运行、可恢复、可验证、可审计的 Figma-to-UI Agent MVP。

## 当前状态

P0 计划复核和 M0 全部硬门已通过。已有证据：

- 精确版本依赖、`package-lock.json` 和可复现 `npm ci`；
- 项目内 Playwright Chromium；
- Pi 受控启动入口、四工具边界、工具漂移和 Shell 拒绝探针；
- Playwright 公开 API 动态图片 Diff；
- Figma REST Flow 探针的节点、截图和图片填充核心能力；
- Variables 当前为 `unavailable_optional`，不阻塞 Figma 侧核心门；
- OpenAI `gpt-5.4` 已确认图像输入、恰好四工具的 provider 请求和一次
  `inspect_figma` 工具回合。

M1 已完成：

- DesignBundle、Variables 能力和 LocalImageRef 使用严格 Zod Schema；
- UISpec 使用受控组件目录，并校验页面树、状态、动作、视口和行为夹具；
- `inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`
  具有严格 Zod 输入输出契约；
- Figma URL、文件键和节点 ID 采用允许列表与冲突校验；
- Figma REST 客户端支持注入式 `fetch`、超时、取消、响应大小上限、有限重试和
  清洗错误；
- 节点树会标准化页面、布局、文本、组件、Styles、图片来源和变量绑定；
- Variables 可用时保留集合、模式、代码语法和别名来源；401/403 时按
  `boundVariables` 实值回退，无可用绑定时才推导重复设计值；
- 图片下载只接受已知 Figma/CDN HTTPS 主机，通过 MIME、魔数、尺寸和字节上限
  后按内容哈希保存；
- DesignBundle 与 UISpec 的所有内部引用均要求闭合，UISpec 还必须引用当前
  DesignBundle 修订及其设计值、图片；
- 项目数据隔离在 `data/projects/<projectId>/`，使用 revision CAS、不可变历史、
  每项目写锁、`fsync` 和原子发布；
- 路径逃逸、符号链接、未知字段、不兼容版本、悬空引用和陈旧修订均失败关闭，
  不覆盖上一份有效 `current.json`；
- mock REST 集成测试已覆盖“检查 Figma -> 下载资产/截图 -> Variables 403 回退
  -> 发布 DesignBundle”，并证明后续核心 503 不覆盖旧修订。

M1 未重新调用真实 Figma；其结论来自注入式 mock REST 纵向测试，并复用了 M0
已有的脱敏 live 能力证据。

M2 已完成：

- `load_ui_spec` 和 `save_ui_spec` 已接入本地项目存储，支持 current、不可变历史、
  严格引用校验和 revision CAS；
- 受控 json-render Catalog 只包含固定布局、文本、图片、表单、对话框、按钮和
  已声明动作，不接受 JSX、脚本、任意 CSS、外部图片 URL 或未声明事件；
- localhost Preview 提供 Figma 参考、当前实现、检查与 Diff 三栏，支持页面、
  视口、缩放、像素模式、历史修订、加载/空/错误/过期状态和键盘焦点；
- `render_and_compare` 固定 Chromium、视口、DPR、locale、timezone、字体等待、
  动画和过渡，执行行为夹具、键盘、控制台与逐像素比较；
- 验证记录、expected、actual 和 diff 保存在项目隔离的 `runs/<runId>/`，Preview
  只读取验证记录中已登记的证据文件；
- Extension 四工具已接入 `FigmaInspector`、UISpec 服务和本地验证器；每轮只允许
  最多 3 次 `save_ui_spec -> render_and_compare`，重复候选被判定为无进展，
  通过后禁止继续修改，耗尽后报告证据；
- M2 本地探针通过双页、桌面/移动视口、输入、复选框、往返导航和 4 组验证结果，
  并完成桌面/移动截图目视检查。
- Preview Playwright E2E 通过 4 个场景，覆盖三栏交互、原生表单、键盘焦点、
  原生禁用语义、loading/empty/error/stale 和移动堆叠；验证器正常、异常和取消
  路径均验证端口释放。

M2 没有重新调用真实 Figma 或 OpenAI。真实 Flow 校准、配置冻结确认及三个未知输入
盲测仍属于 M3。

M3 本地准备已完成。三次真实校准已执行但都没有形成有效验证迭代，盲测
尚未执行：

- `prepare:m3` 记录 Node、npm、锁文件、Pi、模型、Chromium、Prompt、Schema、
  Catalog、验证器和关键源码哈希；
- 生产源码扫描拒绝 Flow 样本标识和密钥模式；
- `run:m3:flow` 从空项目执行受控 Flow 完整循环，强制候选视口和比较阈值，
  最多三轮，并限制运行时间和日志大小；
- `freeze:m3` 只接受已通过的真实 Flow 验证记录，复核运行时和源码未漂移后，
  以不可覆盖方式生成冻结清单；
- `manifest:m3` 只保存未知输入、目标节点和行为说明的哈希，并拒绝开发阶段已经
  使用的 Figma 文件；
- `blind:m3` 在 Extension 内强制冻结视口和视觉阈值，运行前复核 Node、npm、
  锁文件、Chromium 二进制和源码哈希；
- `finalize:m3` 只在三个来源互异的 case 均于三轮内通过，且合计覆盖 Variables
  降级、绑定回退、多页面、组件、图片和复杂 Auto Layout 时生成最终摘要；
- Agent 使用紧凑文本输出和内存 session，最终输出会脱敏；进程限制为 30 分钟和
  20 MiB，异常、超时或输出超限时终止；
- Extension 为 Flow/盲测写入只含工具名、项目 ID、状态和脱敏错误的最小生命周期
  审计，不保存工具参数、设计输入、图片、UISpec 或助手正文，文件权限强制为
  `0600`；
- `probe:m3:local` 已在冻结前证明 Flow、冻结、未知输入和盲测入口在授权或前置
  证据缺失时均于外部调用前失败关闭；冻结后，AC9 入口已用直接命令验证仍会在缺少
  未知输入或外部授权时失败关闭。

当前 M3 状态为已生成冻结基线 `7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`。
这证明真实 Flow 校准结果和视觉阈值已按人工确认冻结，但不代表三个未知输入已经
通过。首次真实 Flow 在 Pi JSON
流式事件放大到 20 MiB 后终止，有效迭代数为 0；运行器已改为
`--mode text --no-session`。第二次成功抽取并保存 101 个节点的 UISpec，但
bounded-loop 状态被 Pi 内部 `turn_start` 错误清零，比较未执行；状态重置现已移到
用户 `input` 边界，并通过真实事件顺序集成测试。第三次正常退出且 Figma 抽取
成功，但没有保存 UISpec、执行比较或输出最终文本；旧审计无法确定精确失败点。
最小脱敏工具生命周期审计现已补齐。第四次使用空项目 `m3-flow-20260723-d` 后，
审计明确定位到 Figma REST HTTP `429` 限流；REST client 已加长默认 429/5xx
重试窗口，并纳入 M3 受控哈希。第五次使用空项目 `m3-flow-20260723-e` 后，
审计确认 Figma REST `file` 端点仍持续返回 HTTP `429`，且模型重复调用
`inspect_figma`；Extension 现已在同一请求内阻止重复 inspect 失败后继续请求
Figma。第六次使用空项目 `m3-flow-20260723-f` 后，审计确认重复 inspect 已被
`bounded_loop_inspect_failed` 本地拦截，没有再次访问 Figma，但首次真实请求仍被
Figma REST `file` HTTP `429` 拒绝。REST client 现已在最终 429 错误中追加脱敏
诊断头：`retryAfterSeconds`、`planTier`、`rateLimitType` 和
`upgradeLinkPresent`，但不记录 Figma URL、文件键、Token、响应正文或升级链接
URL。下一步如获新的外部授权并等待 Figma 限流冷却后，应使用空项目
`m3-flow-20260723-g` 重新校准，并优先用这些诊断头判断是席位/资源计划限流还是
短时每分钟配额耗尽。2026-07-24 的单请求 rate-limit live 探针未调用 OpenAI，
只请求一次 Figma REST `file` 端点；结果仍为 HTTP `429`，诊断为
`planTier=org`、`rateLimitType=low`、`retryAfterSeconds=358399`。这说明文件
不在 Starter 计划下，但当前 token 对该资源被 Figma 归入低额度限流类别；在调整
文件权限/席位/授权主体前，不建议继续完整 Flow。随后更换 Figma token 后，单请求
rate-limit live 探针返回 HTTP `200`，证明新 token 可以读取该文件；下一步可在单次
明确外部授权下使用空项目 `m3-flow-20260723-g` 重跑真实 Flow 校准。第七次真实
Flow 使用 `m3-flow-20260723-g` 后，Figma 抽取、UISpec 保存和
`render_and_compare` 均已执行，证明 429 阻塞已解除；但结果仍为 `failed`：
两轮 validation 均为功能、键盘和 console 通过，视觉比较失败。根因转为目标输入
与当前 M3 验证假设不匹配：Figma 目标是一个 `1832x3079` 的三手机画板复合容器，
而候选校准视口是 `1440x900` 与 `390x844`，验证器会把每个 viewport 的实际截图
与同一张复合大画布截图做 exact RGBA 比较，导致 92% 到 99% 像素差异。采纳单画板
校准路径后，M3 冻结策略已允许 1 个 viewport/page 的校准结果；第八次真实 Flow 使用
空项目 `m3-flow-20260723-h`、`landingpage` 单画板和 `440x996` viewport 后通过：
1 次迭代内完成 Figma 抽取、UISpec 保存、Preview 渲染和 exact RGBA validation，
最终视觉差异为 `1512` 像素、比例 `0.003450`，低于确认阈值。随后已生成
`data/baselines/m3/freeze.json`，固定模型、Prompt、Catalog、Schema、工具、Pi、
浏览器、字体、Viewport、DPR、Diff 算法、阈值和 37 个受控源码哈希。

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

Figma 正式通道只有官方 REST API。Remote MCP、Desktop MCP、第三方 MCP、
浏览器抓取和第二 Agent Loop 均不是生产默认或 fallback。Variables 是可选增强能力；
不可用时只允许使用带来源标记的推导设计值，不得伪造 Figma 变量语义。

受控启动关闭 Pi 内置工具、Extension/Skill/Prompt/Context 自动发现，并拒绝
`user_bash`。项目、DesignBundle、UISpec 修订和验证记录保存在项目隔离的本地目录。

## MVP 范围

- 输入未知 Figma，识别并标准化多个页面。
- 生成和修订一个 Schema 校验的多页面 `ui-spec.json`。
- 通过三栏工作区查看 Figma 参考、实现和 Diff。
- 使用 Playwright 验证功能、键盘和视觉结果。
- 完成 Flow test 校准后冻结配置，再执行三个未知输入盲测。

明确排除源码导出、Tauri/Electron、A2UI、数据库、登录、队列、云部署、多租户、
产品运行时 Multi Agent、真实后端和自动 PR/发布/部署。项目不为这些延期能力创建
占位代码。

## 本地验证

以下命令不调用 OpenAI 或 Figma：

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

注意：`prepare:m3` 和 `probe:m3:local` 是冻结前门禁。生成 `freeze.json` 后不要
再运行 `prepare:m3` 作为例行步骤；它会重新生成预检材料，容易造成审计口径混淆。
冻结后应使用 `manifest:m3`、`blind:m3` 和 `finalize:m3` 的直接失败关闭结果验证
AC9 入口。

本地报告生成到 `reports/m0/`，机器可读证据保存在被忽略的 `data/probes/`。
M0 live 总体报告为 `reports/m0/2026-07-23-live.md`。
M1 本地实现与 mock REST 纵向验证报告为 `reports/m1/2026-07-23-local.md`。
M2 Preview、验证器与四工具接线报告为 `reports/m2/2026-07-23-local.md`。
M3 本地冻结与盲测执行框架报告为 `reports/m3/2026-07-23-preflight.md`。
M3 下一硬门和候选运行参数为 `reports/m3/2026-07-23-next-gates.md`。
M3 真实 Flow 校准执行报告为 `reports/m3/2026-07-23-flow-calibration.md`。
M3 freeze 候选审阅报告为 `reports/m3/2026-07-24-freeze-candidate.md`。
M3 未知输入盲测运行手册为 `reports/m3/2026-07-24-blind-runbook.md`。
M3 未知输入盲测证据台账为 `reports/m3/2026-07-24-blind-evidence-ledger.md`。
M3 未知输入请求包为 `reports/m3/2026-07-24-blind-input-request.md`。
AC1-AC10 当前证据矩阵为 `reports/acceptance/2026-07-23-ac1-ac10.md`。
完成度缺口审计为 `reports/acceptance/2026-07-24-completion-gap-audit.md`。
AC10 最终审计模板为 `reports/acceptance/2026-07-24-final-audit-template.md`。
已授权产生的 Figma REST 脱敏证据可以离线重分类：

```bash
npm run probe:figma:rest:reassess
```

429 诊断使用更窄的单请求探针，不调用 OpenAI、不跑完整 Flow、只请求一次 Figma
REST `file` 端点：

```bash
npm run probe:figma:rate-limit
FIGMA_RATE_LIMIT_PROBE_AUTHORIZED=1 npm run probe:figma:rate-limit:live
```

live 结果写入被忽略的 `data/probes/figma-rate-limit/latest.json`，只保存文件键哈希、
HTTP 状态和脱敏限流诊断头。

`npm run probe:figma` 和 `npm run probe:figma:rest` 均是无网络的 REST 本地入口。
旧 `scripts/probe-figma.mjs` 与 `scripts/probe-framelink.mjs` 仅保留为历史诊断，
不进入 M0 汇总或生产路径。

`npm run start:agent` 优先使用 `PI_OPENAI_MODEL`，并兼容已有的
`OPENAI_MODEL`。配置 `OPENAI_BASE_URL` 时，入口会在被忽略的
`data/pi-config/` 生成不含真实凭据的 Pi provider 配置；密钥仍只从进程环境读取。

## M3 执行顺序

真实 M3 必须按以下顺序执行，不能跳过冻结或在盲测间修改源码：

1. 冻结前运行 `npm run prepare:m3`，要求结果为 `pending_flow_calibration`。
2. 在本机设置 Flow URL、空项目 ID、候选视口和候选比较参数，明确授权后
   运行 `npm run run:m3:flow`。
3. 审阅通过记录、阈值和视口；明确确认后执行：

```bash
M3_FLOW_CALIBRATION_CONFIRMED=1 \
M3_VISUAL_THRESHOLD_CONFIRMED=1 \
npm run freeze:m3 -- --confirm \
  --flow-record data/projects/<flow-project>/runs/<run-id>/validation.json
```

4. 当前已完成上述冻结。对每个未知输入先设置独立 `M3_CASE_ID`、`M3_FIGMA_URL`、
   `M3_TARGET_NODES` 和最小 `M3_BEHAVIOR_NOTES`；确认该输入未用于开发后设置
   `M3_UNKNOWN_INPUT_CONFIRMED=1`，再运行 `npm run manifest:m3`。
5. 在不修改冻结文件或关键源码的前提下，明确授权并运行 `npm run blind:m3`。
6. 三个不同 case 都完成后设置逗号分隔的 `M3_CASE_IDS`，运行
   `npm run finalize:m3`。该命令比较各 case 的迭代、功能/键盘/视觉检查、
   Variables 降级、功能覆盖和人工行为说明，仅在最终门通过时写入
   `data/blind/m3/final-summary.json`。

Flow 和盲测命令读取的 URL、Token 与行为说明只存在于本机环境和被忽略的
`data/` 目录。正式报告只能引用哈希、能力状态和脱敏证据。

## 外部授权

真实 OpenAI/Figma 探针、Flow 校准和盲测会访问外部服务，必须获得明确授权。
凭据只在本机进程环境中配置，不进入命令参数、报告、Worktrail、浏览器或版本库。
变量名称和授权开关见 `.env.example`。

重新执行 M0 live 仍需单独授权。后续任一硬门失败时保存脱敏证据并回到设计评审，
不得切换 MCP、增加第二 Agent Loop、放宽四工具边界或写入样本专属代码。

## 正式项目知识

正式项目概览、架构、技术方案、自主交付 Goal 和实施计划均位于 project scope
的 Worktrail。Coding Agent 开始实质工作前必须运行 `worktrail context
--semantic=auto "<任务>"`，以正式知识和实际证据为准。
