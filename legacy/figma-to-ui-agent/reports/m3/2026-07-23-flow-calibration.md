# M3 Flow 真实校准执行报告

## 结论

2026-07-23 至 2026-07-24，在八次独立明确授权后，使用八个空项目执行了真实
Figma REST + OpenAI `gpt-5.4` Flow 校准。前七次均不能作为阈值冻结或 AC8 通过
证据；第八次 `m3-flow-20260723-h` 已形成 1 次有效通过验证，可进入冻结候选审阅：

- 首次因 Pi JSON 输出放大触发 20 MiB 上限，Agent 退出码为 `143`；
- 第二次 Agent 正常退出，退出码为 `0`，但 bounded-loop 状态被错误重置；
- 第三次 Agent 正常退出，退出码为 `0`，但最终文本为空，未保存 UISpec 或执行比较；
- 第四次通过新增审计定位到 Figma REST HTTP `429` 限流；
- 第五次在加长 REST 重试窗口后仍被 Figma REST `file` HTTP `429` 限流，且模型重复
  调用 `inspect_figma`；
- 第六次确认同请求 inspect 失败关闭门生效：重复 `inspect_figma` 被本地拒绝，没有
  再访问 Figma；
- 第七次更换 Figma token 后越过 429，形成 2 次有效 validation，但目标为三画板复合
  大画布，候选视口不匹配，视觉差异超过 92%；
- 第八次改用 `landingpage` 单画板和 `440x996` viewport，1 次迭代通过，功能、键盘、
  console 和视觉检查均通过；
- 当时没有执行冻结、未知输入盲测或 Git；2026-07-24 已在人工确认后执行冻结，
  但仍未执行未知输入盲测或 Git。

当前项目状态为已生成冻结基线
`7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`，等待三个未知输入盲测。

本报告不包含 Figma URL、文件键、节点明文、API Key、私有响应或未脱敏 Agent
输出。

## 授权与候选策略

每次授权只覆盖一个已登记开发输入的真实 Flow 校准，不覆盖冻结或盲测。

前六次候选策略包含桌面和移动两个 Viewport；第七次证明该策略不适用于三画板复合
大画布。第八次候选策略改为 `landingpage` 单画板和 `440x996` 单 viewport，比较参数
保持既定候选值。通过记录中的 `candidatePolicyHash` 为：

`c145f11dbf297733c5bc950f3590e0dbc20787ec5b4187a52cae9b4342b4c1dd`

业务行为说明明确为：没有额外行为，只验证 Figma 明确呈现的页面结构、控件语义和
视觉，不推测未声明业务交互。

## 首次执行证据

失败发生前，Figma REST 抽取已经完成：

- 本地项目 `m3-flow-20260723-a` 已创建；
- DesignBundle 当前 revision 为 `2`，不可变 history 共 2 份；
- 目标节点数为 1，参考截图文件数为 2，本地图片资源文件数为 3；
- Variables 能力为 `unavailable_optional`，原因码为 `unknown`；
- 模型依次调用了 `inspect_figma` 和 `load_ui_spec`，并开始生成首次
  `save_ui_spec` 参数；
- 没有成功保存 UISpec，也没有进入 `render_and_compare`；
- 项目 `runs/` 下没有有效验证记录。

因此本次只能证明真实 Figma 抽取和 Agent 工具回合已经启动，不能证明生成、渲染、
功能、键盘或视觉比较可行。

## 首次根因

Pi `--mode json` 会把所有会话事件作为 JSON Lines 输出。`message_update` 不只包含
本次增量，还包含不断增长的完整 AssistantMessage。首次 `save_ui_spec` 的大 JSON
工具参数被重复写入多个流式事件，形成输出放大：

- 脱敏输出共约 20 MiB、1408 个可解析事件；
- 其中 `message_update` 1374 条；
- `toolcall_delta` 406 条，约 12.6 MiB；
- 包含 `save_ui_spec` 的更新 114 条；
- 总输出超过运行器的 20 MiB 安全上限后，子进程被 `SIGTERM` 终止。

这不是视觉阈值失败，也不是 Figma 权限或 Variables 可选降级失败。

## 首次通用修复

Flow 和 blind 两条 M3 路径现在共用同一个 Pi 启动参数构造器：

- 使用 `--print --mode text`，只收集最终助手文本和 stderr；
- 使用 `--no-session`，避免 Pi 把包含原始 Figma URL 的提示持久化到本地 session；
- 保留 20 MiB 输出上限、30 分钟超时、信号转发和日志脱敏；
- 不修改四工具边界、最多三轮、UISpec Schema、Catalog、验证器或视觉候选值。

首次失败产生的 Pi session 文件没有包含 API Key，但包含原始 Figma URL 和文件键。
该文件权限已从 `0644` 收紧为 `0600`。脱敏校准日志经过精确扫描，不包含原始 URL、
文件键、Figma API Key、OpenAI API Key 或常见 Token 模式。

## 第二次执行证据

修复输出模式后，使用空项目 `m3-flow-20260723-b` 重新执行：

- Agent 正常退出，未触发输出上限、超时或信号终止；
- 脱敏最终日志为 2318 bytes，没有产生新的 Pi session 文件；
- DesignBundle 抽取成功；
- UISpec 成功保存到 revision `1`，包含 1 个页面、101 个节点、2 个 Viewport；
- 节点包括 section、stack、image、text、button 和 input；
- 未声明业务行为，因此 behavior fixture 数量为 0；
- 随后的 `render_and_compare` 连续被同一个 bounded-loop 错误拒绝；
- Agent 为恢复顺序又保存了 revision `2`，但两个 UISpec 除 revision 字段外完全
  相同；
- 没有进入 Playwright 渲染，项目仍无 `runs/` 或 `validation.json`。

第二次执行证明真实 Figma 抽取和大 UISpec 生成/保存可行，但仍不能证明 Preview、
功能、键盘或视觉比较通过。

## 第二次根因

Pi 的 `turn_start` 会在每次模型继续生成时触发，包括工具结果返回后的下一次模型
调用。Extension 原先在每个 `turn_start` 重置：

- 已保存、等待比较状态；
- save/render 次数；
- 上次 UISpec 指纹；
- 当前循环是否已通过。

因此 `save_ui_spec` 成功后，下一次模型调用开始时 `savedSinceLastRender` 已被清零，
紧随其后的 `render_and_compare` 被错误报告为“必须紧跟保存”。同一错误重置还清除
了上次指纹，使内容完全相同的 revision `2` 没有触发无进展拒绝。

新增集成测试按真实事件顺序在 save 和 render 之间发出 `turn_start`，旧实现稳定
复现相同错误。

## 第二次通用修复

bounded-loop 状态现在只在 Pi `input` 事件，即新的用户请求开始时重置。
`turn_start` 继续执行四工具边界检查，但不再重置 Agent 内部循环状态。

保持不变：

- `save_ui_spec -> render_and_compare` 顺序；
- 每个用户请求最多三轮；
- 重复 UISpec 的无进展拒绝；
- 比较通过后禁止继续修改；
- 四工具、Schema、Catalog、阈值、超时和输出上限。

## 第三次执行证据

修复 bounded-loop 事件边界后，使用空项目 `m3-flow-20260723-c` 重新执行：

- Agent 正常退出，退出码为 `0`，没有信号终止、输出超限或超时；
- Figma DesignBundle 抽取成功，当前 revision 为 `2`；
- 抽取结果包含 3 个页面、652 个标准化节点和 3 个本地图片资产；
- Variables 仍为允许的 `unavailable_optional`；
- 脱敏最终文本只有一个换行，没有模型最终说明；
- 没有创建 UISpec `specs/`、验证 `runs/` 或 `validation.json`；
- 没有产生新的 Pi session 文件；
- 运行结束后没有残留 Flow、Pi 或 Chromium 进程。

现有 provider 边界审计只证明第三次发生了 5 次带图像上下文的 provider 请求，并只
记录工具名称和输入内容类型。它没有记录具体工具开始、结束或错误，因此不能从现有
证据判断最后一次工具调用、失败点或模型停止原因。

## 第三次诊断结论

第三次的精确根因保持为“未知”。`--mode text --no-session` 正确避免了大 JSON
输出放大和原始输入 session 持久化，但当模型没有最终文本时，只保留 stdout/stderr
不足以定位工具错误。不能在没有事件证据的情况下把本次失败归因于模型、
`save_ui_spec`、`render_and_compare` 或其他组件。

为下一次运行新增了最小工具生命周期审计：

- 只记录工具名、合法项目 ID、开始/结束、`isError` 和脱敏后最多 1000 字符的错误；
- Assistant 结束事件只记录停止原因、内容类型、工具名和是否有文本；
- 不记录工具参数、Figma 输入、图片、UISpec、provider payload、思考或助手正文；
- Figma URL、单独文件键、Figma/OpenAI Token 在写入前统一替换；
- 审计路径强制位于项目 `data/` 下，文件权限每次写入后强制为 `0600`；
- Flow 和 blind 分别写入自己的校准或盲测 case 目录；
- 原第三次运行没有该文件，新增能力不能追溯补造旧事件。

## 第四次执行证据

使用空项目 `m3-flow-20260723-d` 重新执行后，Agent 正常退出，Flow 机器结果仍为
`failed`：

- Agent 退出码为 `0`，没有信号终止、输出超限或超时；
- 有效验证迭代数为 `0`；
- 未创建 `data/projects/m3-flow-20260723-d`；
- 未保存 DesignBundle、UISpec、`runs/` 或 `validation.json`；
- `result.json`、`pi-output.redacted.log` 和 `tool-events.redacted.jsonl` 权限均为
  `0600`。

新增审计明确记录了失败路径：

- 第一次模型消息并行请求 `inspect_figma` 和 `load_ui_spec`；
- `inspect_figma` 在 Figma REST `image_renders` 端点返回 HTTP `429`；
- 同一轮的 `load_ui_spec` 因项目尚未创建返回“项目不存在”；
- 后续两次 `inspect_figma` 都在 Figma REST `file` 端点返回 HTTP `429`；
- 最终 Assistant 以 `stop` 结束，没有调用 `save_ui_spec` 或
  `render_and_compare`。

因此第四次根因已确认：Figma REST 被限流，且现有默认重试窗口不足以跨过真实
限流周期。这不是 Variables 权限、UISpec Schema、Preview 或 Playwright 比较失败。

## 第四次通用修复

Figma REST client 已做最小修复：

- 默认重试次数从 2 次提高到 5 次，即单个 429/5xx 请求最多 6 次总尝试；
- `Retry-After` 等待上限从 5 秒提高到 30 秒；
- 保持只对 HTTP `429` 和 `5xx` 状态重试；
- 不记录响应正文、Token、Figma URL 或文件键；
- 不增加依赖，不改变工具契约、UISpec、Catalog、阈值或 Agent Loop。

同时把 `src/figma/rest-client.ts` 和 `tests/integration/figma/rest-client.test.ts`
纳入 M3 受控哈希清单，避免后续 freeze/blind 漂移保护漏掉真实 Figma 请求路径。

## 第五次执行证据

使用空项目 `m3-flow-20260723-e` 重新执行后，Flow 仍为 `failed`：

- Agent 退出码为 `0`，没有信号终止、输出超限或超时；
- 有效验证迭代数为 `0`；
- 未创建 `data/projects/m3-flow-20260723-e`；
- 未保存 DesignBundle、UISpec、`runs/` 或 `validation.json`；
- `result.json`、`pi-output.redacted.log` 和 `tool-events.redacted.jsonl` 权限均为
  `0600`。

审计显示加长重试窗口已经生效，但 Figma 限流仍未解除：

- 三次 `inspect_figma` 均在 Figma REST `file` 端点返回 HTTP `429`；
- 每次 `inspect_figma` 约等待 155 秒后失败，符合内部多次重试后的耗时特征；
- 随后模型调用 `load_ui_spec`，因项目尚未创建返回“项目不存在”；
- 最终 Assistant 以 `stop` 结束，没有调用 `save_ui_spec` 或
  `render_and_compare`。

因此第五次确认：当前阻塞是 Figma REST 持续限流；同时模型在工具已经完成内部重试
后仍重复请求 `inspect_figma`，会放大外部调用压力。

## 第五次通用修复

Extension 已增加同一用户请求内的 inspect 失败关闭门：

- `inspect_figma` 成功时行为不变；
- `inspect_figma` 在完成内部重试后失败时，记录对应 `projectId`；
- 同一用户请求内再次检查同一项目会立即返回
  `bounded_loop_inspect_failed`，不再调用 Figma；
- 新的 `input` 事件会清空该状态，不影响下一次用户请求或下一次 Flow；
- 不改变四工具名称、Schema、UISpec、Catalog、视觉阈值或依赖。

## 第六次执行证据

2026-07-24，使用空项目 `m3-flow-20260723-f` 重新执行后，Flow 仍为 `failed`：

- Agent 退出码为 `0`，没有信号终止、输出超限或超时；
- 有效验证迭代数为 `0`；
- 未创建 `data/projects/m3-flow-20260723-f`；
- 未保存 DesignBundle、UISpec、`runs/` 或 `validation.json`；
- `result.json`、`pi-output.redacted.log` 和 `tool-events.redacted.jsonl` 权限均为
  `0600`。

审计显示：

- 第一次 `inspect_figma` 在 Figma REST `file` 端点返回 HTTP `429`；
- 第二次 `inspect_figma` 立即返回 `bounded_loop_inspect_failed`，未再次访问 Figma；
- 随后模型调用 `load_ui_spec`，因项目尚未创建返回“项目不存在”；
- 最终 Assistant 以 `stop` 结束，没有调用 `save_ui_spec` 或
  `render_and_compare`。

因此第六次确认：重复 inspect 的本地失败关闭门已生效；当前剩余外部阻塞仍是
Figma REST `file` 端点持续 HTTP `429`。

## 第六次后限流诊断补强

根据 Figma 官方 REST 限流说明，HTTP `429` 会返回 `Retry-After`、
`X-Figma-Plan-Tier`、`X-Figma-Rate-Limit-Type` 和 `X-Figma-Upgrade-Link`
等诊断头。前六次本地审计只保存了脱敏错误文本，没有保存这些头，因此现有证据只能
确认 Figma REST 限流，不能继续判断是 Viewer/Collab 低额度、资源所在计划额度、
同一 PAT 被多处共享消耗，还是短时每分钟额度耗尽。

REST client 现已补强最终 429 错误诊断：

- 记录 `retryAfterSeconds`、`planTier` 和 `rateLimitType` 的短安全值；
- 只记录 `upgradeLinkPresent=true`，不记录升级链接 URL；
- 继续禁止记录 Figma URL、文件键、Token、响应正文或外部 payload；
- 不改变 REST 调用次数、重试策略、工具契约、UISpec、Catalog、视觉阈值或依赖。

新增 `probe:figma:rate-limit` / `probe:figma:rate-limit:live` 单请求探针，用于在不调用
OpenAI、不运行完整 Flow 的前提下读取一次 `file` 端点状态。live 模式要求显式
`FIGMA_RATE_LIMIT_PROBE_AUTHORIZED=1`，且最多发起一次 Figma REST 请求。

2026-07-24 使用该单请求探针执行 live 诊断，结果如下：

- 只请求一次 Figma REST `file` 端点；
- 不调用 OpenAI，不运行完整 Flow，不执行第三方 MCP，不尝试修改 Figma；
- HTTP 状态仍为 `429`；
- 脱敏诊断头为 `retryAfterSeconds=358399`、`planTier=org`、
  `rateLimitType=low`、`upgradeLinkPresent=true`；
- 结果文件只保存文件键哈希、HTTP 状态和脱敏诊断，不保存 Figma URL、文件键、
  Token、响应正文或升级链接 URL。

该结果排除了 Starter 资源计划这个方向，但说明当前 PAT/账号对该 org 文件仍被
Figma 判定为低额度类别。后续优先方向应是让文件 owner 确认该账号在该文件所在
org/team/project 下是否具备 Full/Dev 或等价开发访问权限，或者改用具备正确资源
权限的授权主体；不建议在该状态下继续完整 Flow。

随后更换 Figma token 并重新执行同一个单请求 live 探针，结果返回 HTTP `200`：

- 只请求一次 Figma REST `file` 端点；
- 不调用 OpenAI，不运行完整 Flow，不执行第三方 MCP，不尝试修改 Figma；
- 结果文件只保存文件键哈希、HTTP 状态和脱敏诊断字段；
- 该结果证明新 token 可以读取目标文件，当前 429 阻塞已解除。

## 第七次执行证据

使用空项目 `m3-flow-20260723-g` 重新执行真实 Flow 后，Flow 机器结果仍为
`failed`：

- Agent 退出码为 `0`，没有信号终止、输出超限或超时；
- 有效验证迭代数为 `2`；
- `sourceMatched=true`，说明 DesignBundle 来源与登记开发输入匹配；
- `inspect_figma` 成功，DesignBundle revision 为 `1`；
- 初始 `load_ui_spec` 因空项目不存在而失败，随后按 revision 0 新建；
- `save_ui_spec` revision 1 成功，`render_and_compare` 执行成功但视觉未通过；
- Agent 尝试第二轮修订时曾产生重复 page id 和未声明 designValueRefs，工具按 Schema
  失败关闭；
- `save_ui_spec` revision 2 成功，第二次 `render_and_compare` 执行成功但视觉仍未
  通过；
- 最终 Assistant 按“无进展时停止并报告证据”结束。

第七次不再受 Figma REST `429` 阻塞；新的失败类别是视觉校准目标不匹配。
两轮 validation 的功能、键盘和 console 检查均通过，但视觉差异极大：

- revision 1：desktop `diffPixelRatio=0.925020`，mobile `diffPixelRatio=0.984181`；
- revision 2：desktop `diffPixelRatio=0.937899`，mobile `diffPixelRatio=0.997601`。

进一步检查显示，Figma expected 截图尺寸为 `1832x3079`，是一个包含三个手机画板的
复合大画布；当前候选校准视口是 `1440x900` 和 `390x844`。验证器会把每个 viewport
的实际截图与同一张 Figma expected 截图放到 `max(expected, actual)` 画布中做 exact
RGBA 比较，因此该输入在当前候选视口下天然产生 92% 到 99% 像素差异。

DesignBundle 中该目标顶层为 `Quote` 复合容器，尺寸 `1832x3079`；其直接子画板为
`landingpage` `440x996`、`quotation` `440x2552` 和 `quotation` `440x2857`。这说明
后续应优先使用单个独立画板作为校准输入，或显式调整验证模型以支持多画板复合流；
不应继续用同一个复合容器配 `desktop/mobile` 候选视口盲目重跑。

## 第八次执行证据

采纳单画板校准路径后，M3 冻结策略已做最小契约调整：允许 1 个 page 和 1 个
viewport 的校准结果进入后续冻结流程；盲测最终覆盖矩阵仍可在后续 case 中补齐多页、
多视口等能力。

使用空项目 `m3-flow-20260723-h`、`landingpage` 单画板和 `440x996` viewport 重新执行
真实 Flow 后，Flow 机器结果为 `passed`：

- Agent 退出码为 `0`，没有信号终止、输出超限或超时；
- 有效验证迭代数为 `1`；
- `sourceMatched=true`；
- `firstPassPassed=true`，`finalPassed=true`；
- `inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare` 按顺序执行；
- `variablesCapability.status=unavailable_optional`，仍按可选增强能力处理；
- 最终 validation 使用 `landingpage` viewport，尺寸 `440x996`；
- 功能、键盘、console 和视觉检查均通过；
- 视觉差异为 `1512` 像素，`diffPixelRatio=0.003450`，低于当前候选阈值
  `maxDiffPixelRatio=0.05` 和 `maxDiffPixels=50000`。

第八次证明当前端到端链路可行：Figma 抽取、UISpec 生成、Preview 渲染和 exact RGBA
validation 可以在真实 OpenAI/Figma Flow 中一次通过。该通过仅覆盖单个 landingpage
画板，不代表三画板复合 Flow、报价页、表单状态或多页拆分能力已经完成。

下一次真实 Flow 如仍遇到 429，应先根据这些脱敏诊断头判断限流类别，再决定等待、
换用正确计划/席位下的文件、切换授权方式，或继续校准。

## 诊断修复后验证

- 工具生命周期集成测试先以 `ENOENT` 复现审计缺口，修复后 2/2 通过；
- 测试覆盖参数不落盘、Figma URL、单独文件键、Figma/OpenAI Token 脱敏和既有
  宽权限文件收紧为 `0600`；
- 完整单元测试：17 个文件、81 项通过；
- 完整集成测试：6 个文件、29 项通过；
- TypeScript 类型检查通过；
- M0 保持 `local_pass_m0_live_confirmed`；
- M2 保持 `passed`；
- M3 预检重新生成，36 个受控文件哈希有效；
- 36 个生产源码文件的样本标识和秘密模式扫描均为 0；
- M3 本地门禁为 `local_pass_external_gates_closed`；
- 没有残留 Flow、Pi 或 Chromium 进程；项目自己的 4173 Preview 服务保持运行。

## 限流诊断补强验证

- Figma REST client 集成测试新增 429 诊断头覆盖；
- 完整集成测试：6 个文件、30 项通过；
- TypeScript 类型检查通过；
- M3 预检重新生成，36 个受控文件哈希有效；
- M3 本地门禁为 `local_pass_external_gates_closed`。

## 下一硬门

下一步不应直接重复 `m3-flow-20260723-h`；该项目已经保存通过证据，不能覆盖或复用。
新的硬门是审阅第八次通过证据，并决定是否把 `landingpage` 单画板、`440x996`
viewport 和当前视觉阈值作为 M3 calibration freeze 候选。冻结仍需要独立的校准结果
确认与视觉阈值确认。

若不冻结该单画板结果，下一次真实重试应使用空项目 ID `m3-flow-20260723-i`，并明确
选择新的单画板目标或新的复合 Flow 契约；再次访问 Figma 和 OpenAI 仍需要单次明确
授权。
