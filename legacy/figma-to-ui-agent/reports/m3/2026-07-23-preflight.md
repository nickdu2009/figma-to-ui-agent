# M3 冻结与盲测本地预检报告

## 结论

2026-07-23，M3 的本地执行框架已完成并通过验证；该预检生成时状态为
`pending_flow_calibration`。2026-07-24 已在人工确认后生成冻结基线
`7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`。

已完成：

- 冻结候选预检和关键源码哈希；
- Flow 完整 Agent Loop 的受控运行入口；
- Flow 通过记录到不可变冻结清单的转换；
- 未知输入清单和开发样本污染检查；
- 三次盲测共用冻结配置的运行时强制；
- 三个盲测 case 的来源去重、通过状态和功能覆盖最终汇总门；
- Agent 进程超时、输出上限、信号转发和日志脱敏；
- 只含工具生命周期元数据和脱敏错误的 M3 本地诊断审计；
- 缺少授权、冻结清单或未知输入证明时的本地失败关闭；
- 安装后全量类型检查、测试、构建、M0、M2 和 M3 本地回归。

未完成：

- 已调用六次真实 OpenAI 和 Figma；首次因输出上限终止，第二次因 bounded-loop
  状态重置缺陷未进入比较，第三次正常退出但没有保存 UISpec、执行比较或输出最终
  文本，第四次由工具生命周期审计定位到 Figma REST HTTP `429` 限流，第五次确认
  加长重试后仍受 Figma REST `file` HTTP `429` 限流，且模型重复调用
  `inspect_figma`，第六次确认重复 inspect 已被本地失败关闭门拦截；六次有效验证
  迭代均为 0；
- 第四次后已把 Figma REST 限流重试窗口加长，并把 REST client 纳入 M3 受控哈希；
- 第五次后已增加同一请求内 inspect 失败关闭门，避免工具内部重试失败后重复请求
  Figma；
- 历史预检生成时尚未确定并确认最终 Viewport 和视觉阈值；当前已用
  `m3-flow-20260723-h` 冻结单 viewport 和视觉阈值；
- 历史预检生成时尚未生成 `data/baselines/m3/freeze.json`；当前已生成；
- 没有接收或执行三个未知 Figma 输入；
- 因而不能宣称 AC8、AC9、AC10 或整个项目完成。

本报告不包含 Figma URL、文件键、节点 ID、Token、Cookie、私有响应或未脱敏 Agent
输出。

## 冻结候选

`npm run prepare:m3` 生成
`data/probes/m3/preflight.json`，本次结果：

- `networkAccess: false`；
- Node `v26.5.0`；
- npm `11.17.0`；
- Pi `0.81.1`；
- OpenAI 模型要求 `gpt-5.4`；
- Chromium `149.0.7827.55`，revision `1228`；
- `package-lock.json` SHA-256：
  `4f6200391e507761caf071dc213c6157b7ee8c4d8df879b0407799a5635c6b35`；
- Chromium 二进制 SHA-256：
  `11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3`；
- 模型可见工具恰好为 `inspect_figma`、`load_ui_spec`、`save_ui_spec`、
  `render_and_compare`；
- Diff 算法为 `exact_rgba`；
- locale `zh-CN`、timezone `UTC`、浅色模式、reduced motion、Arial、
  service worker 禁用、动画与过渡禁用；
- 36 个生产源码文件完成扫描；
- Flow 样本标识匹配数为 0；
- 凭据模式匹配数为 0。

Prompt、工具 Schema、DesignBundle、UISpec、Catalog、Preview、验证器、冻结策略、
Flow/盲测脚本和依赖文件的独立哈希均保存在预检 JSON 中。冻结和真实运行入口会在
启动前重新计算这些哈希，任一漂移都会拒绝执行。

当前重新生成的预检包含 36 个受控文件哈希，其中明确覆盖 UISpec
Schema、Figma REST client、Catalog、JSON Adapter、React Registry、样式以及
Schema/Adapter/E2E/REST client 测试，也覆盖 M3 运行器和工具生命周期审计集成测试。

Variables 的 `available` 完整元数据和 `boundVariables` 回退另由明确标记为
`nonLive` 的契约 fixture 覆盖；其测试源码和 fixture 哈希进入冻结面。本次单元测试
已经执行该契约，但它不被表述为真实 Figma Variables 权限证据。

## Flow 校准入口

`npm run run:m3:flow` 只接受：

- 已登记为开发样本的 Flow 文件；
- 一个不存在的本地项目 ID；
- 至少一个候选 Viewport；
- 一组候选 `maxDiffPixelRatio`、`maxDiffPixels` 和 `timeoutMs`；
- `gpt-5.4`、当前四工具和当前源码；
- 明确的 Flow 输入确认和外部执行授权。

候选 Viewport 与比较参数通过 `M3_FROZEN_POLICY_JSON` 注入 Extension。模型若保存
不同视口，或比较时遗漏、调序、更改阈值，均在访问存储或浏览器前被拒绝。

运行从空项目开始，只允许最多三次
`save_ui_spec -> render_and_compare`。一次通过后立即停止；相同 UISpec 重复保存
被判定为无进展。有效验证记录保存在项目 `runs/` 目录，脱敏 Agent 日志和校准摘要
保存在 `data/calibration/m3/<projectId>/`。

首次真实执行证明 Pi `--mode json` 的完整事件流会在大工具参数下重复携带增长中的
AssistantMessage，触发 20 MiB 输出上限。Flow 与 blind 已统一改为
`--print --mode text --no-session`：仍由机器验证记录决定通过状态，但不再把完整
流式工具参数写入 stdout，也不再持久化包含原始输入的 Pi session。

第二次真实执行成功保存了包含 101 个节点的 UISpec，但证明 Pi 内部每次模型继续
生成都会触发 `turn_start`。bounded-loop 状态原先在该事件重置，导致保存后的比较
被误拒绝，重复 UISpec 也未触发无进展门。状态现改为只在新的用户 `input` 时重置，
真实事件顺序已进入集成测试。

第三次真实执行正常退出并成功抽取 Figma DesignBundle，但没有保存 UISpec、创建
`runs/` 或输出最终文本。旧 provider 审计没有工具开始/结束和错误信息，不能确定
最后失败点。现已增加独立的 `tool-events.redacted.jsonl`：

- 不保存工具参数、设计输入、图片、UISpec、provider payload 或助手正文；
- 只保存工具名、项目 ID、状态和脱敏截断的错误，以及 Assistant 结束元数据；
- Figma URL、单独文件键和两类 Token 均在写入前替换；
- 路径只能位于 `data/`，文件权限强制为 `0600`。

第四次真实执行使用该审计后，明确定位到 Figma REST 限流：首次
`inspect_figma` 在 `image_renders` 返回 HTTP `429`，随后两次 `inspect_figma`
在 `file` 返回 HTTP `429`。本地项目没有创建，`save_ui_spec` 和
`render_and_compare` 没有被调用。已把 REST client 默认重试次数从 2 次提高到
5 次，并把 `Retry-After` 等待上限从 5 秒提高到 30 秒；该修复不改变外部工具契约
或视觉候选策略。

第五次真实执行继续定位为 Figma REST 限流：三次 `inspect_figma` 均在 `file`
返回 HTTP `429`，且每次都已经经过约 155 秒内部重试等待。随后模型又调用
`load_ui_spec`，因项目尚未创建失败。Extension 现已在同一用户请求内记录失败的
inspect 项目；同 projectId 再次调用会立即返回 `bounded_loop_inspect_failed`，
不再访问 Figma。新的 `input` 事件会清空该状态。

第六次真实执行验证了该失败关闭门：首次 `inspect_figma` 仍在 `file` 返回 HTTP
`429`，第二次 `inspect_figma` 立即返回 `bounded_loop_inspect_failed`，没有再次
访问 Figma。随后 `load_ui_spec` 因项目未创建失败。

第六次后补强了 429 诊断输出：REST client 会在最终 429 错误中追加脱敏的
`retryAfterSeconds`、`planTier`、`rateLimitType` 和 `upgradeLinkPresent`。
其中升级链接只记录是否存在，不记录 URL；仍不记录 Figma URL、文件键、Token、
响应正文或外部 payload。该补强不增加请求量，不改变工具契约或视觉候选策略。

2026-07-24，单请求 rate-limit live 探针只调用一次 Figma REST `file` 端点，
未调用 OpenAI，结果仍为 HTTP `429`。脱敏诊断为 `planTier=org`、
`rateLimitType=low`、`retryAfterSeconds=358399`。这说明当前阻塞更像是当前
PAT/账号在该 org 文件上的低额度访问类别，而不是 Starter 文件计划或短时完整
Flow 请求量过大。更换 Figma token 后，同一个单请求 live 探针返回 HTTP `200`，
证明新 token 可以读取目标文件，当前 Figma REST `file` 429 阻塞已解除。

第七次真实 Flow 使用空项目 `m3-flow-20260723-g` 后，Figma 抽取、UISpec 保存和
`render_and_compare` 均已执行，证明 429 不再阻塞 M3。Flow 仍为 failed：两轮
validation 的功能、键盘和 console 检查通过，但视觉 exact RGBA 失败。expected
截图是 `1832x3079` 的三手机画板复合大画布，而候选视口是 `1440x900` 与
`390x844`；该输入与当前两视口页面校准假设不匹配。下一次不应复用
`m3-flow-20260723-g`，也不应继续用同一复合容器配 desktop/mobile 盲目重跑。

采纳单画板路径后，M3 冻结策略已允许 1 个 page 和 1 个 viewport 的校准结果。
第八次真实 Flow 使用空项目 `m3-flow-20260723-h`、`landingpage` 单画板和 `440x996`
viewport 后通过：1 次迭代内完成 Figma 抽取、UISpec 保存、Preview 渲染和 exact
RGBA validation，视觉差异为 `1512` 像素、比例 `0.003450`。该结果证明端到端链路
可行，但仅覆盖单画板页面呈现，不覆盖三画板复合 Flow。

## 冻结清单

`npm run freeze:m3` 不调用外部服务，只处理已存在的 Flow 验证记录。它要求：

- Flow 最终记录为通过；
- 至少一个页面和一个 Viewport；
- 运行时、Chromium 和验证策略与预检一致；
- 关键源码哈希未漂移；
- 对 Flow 结果和视觉阈值分别明确确认。

通过后以 `wx` 不可覆盖方式创建 `data/baselines/m3/freeze.json`，其中包含运行时、
固定 Viewport、比较阈值、Prompt/Schema/Catalog/验证器源码哈希、开发输入哈希和
Flow 证据哈希。

## 未知输入与盲测

`npm run manifest:m3` 在冻结后为每个 case 创建
`data/blind/m3/<case>/source-manifest.json`。它不访问网络，只保存：

- Figma 文件键哈希；
- 完整 URL 哈希；
- 目标节点哈希和数量；
- 行为说明哈希；
- 冻结基线 ID。

如果文件键在开发输入哈希中出现，清单创建会失败，避免把已见样本伪装为盲测。

`npm run blind:m3` 在任何网络调用前验证：

- 冻结清单存在且格式有效；
- 关键源码、`package-lock.json` 和 Chromium 二进制哈希未变化；
- Node、npm 和模型与冻结值一致；
- case 与未知输入清单一致；
- 项目目录不存在；
- Figma 和 OpenAI 凭据已在本机环境配置；
- 已明确允许本次外部执行。

盲测运行同样强制固定 Viewport、比较阈值、四工具和最多三轮。结果记录迭代次数、
功能/键盘/视觉检查、Variables 能力状态、人工行为说明是否存在、页面/组件/图片/
Auto Layout/绑定/不支持节点数量、残余 Diff 和最终 revision，不保存原始 Figma
输入。目标节点也必须与未知输入清单中的哈希逐项一致。

`npm run finalize:m3` 要求恰好三个来源互异的 case，且三次都使用同一基线、在
1-3 轮内通过。三个 case 合计必须证明：

- 一个没有 Variables 或绑定的输入；
- 一个存在绑定但完整 Variables 不可用的输入；
- 一个完整 Variables 输入，或使用已冻结并明确标记为 non-live 的契约 fixture；
- 多页面和已冻结 Viewport；
- 组件、图片和复杂 Auto Layout。

只有所有条件满足时才以不可覆盖方式写入
`data/blind/m3/final-summary.json`，状态为 `productization_ready`。

## 进程与信息安全

Flow 和盲测运行器：

- 提示词通过 stdin 传入，不出现在进程参数；
- Pi 使用 `--no-session`，原始提示不写入本地 session；
- Pi 使用 `--mode text`，只收集最终助手文本和 stderr，不收集重复增长的 JSON
  全事件流；
- Extension 另写最小脱敏工具生命周期审计，供最终文本为空时定位失败边界；
- 输出总量上限为 20 MiB；
- 运行上限为 30 分钟；
- 超时、输出超限或父进程信号会先发送 `SIGTERM`，必要时再发送 `SIGKILL`；
- Extension 的 `session_shutdown` 负责关闭 Preview 与 Chromium；
- 日志写入前替换 Figma URL、文件键和进程环境中的两类 API Key，并再次扫描常见
  Token 模式；
- 机器证据只写入被忽略的 `data/` 目录。

## 本地失败关闭证据

`npm run probe:m3:local` 在清除所有 `M3_*` 授权变量后验证：

- Flow 入口返回 `m3_flow_external_execution_not_authorized`；
- 冻结入口返回 `m3_freeze_confirmation_missing`；
- 无冻结清单时，未知输入和盲测入口返回 `m3_freeze_manifest_missing`；
- 生成冻结清单后，它们仍分别要求未知输入证明和外部执行授权；当前冻结基线已直接
  验证 `manifest:m3` 缺输入返回 `m3_case_id_invalid`、`blind:m3` 缺授权返回
  `m3_external_execution_not_authorized`；
- 最终汇总要求冻结清单和三个有效 case；
- 整个探针标记 `networkAccess: false`。

冻结前探针结果为 `local_pass_external_gates_closed`。冻结后 `probe:m3:local` 的
manifest 断言会因 freeze 已存在而先遇到 `m3_case_id_invalid`；该脚本已纳入冻结
source hash，当前冻结基线不再修改它。

## 安装后回归

执行：

```bash
npm ci --ignore-scripts --audit=false --fund=false
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm exec -- vite build --config vite.config.ts
npm run probe:m0:local
npm run probe:m2:local
npm run prepare:m3
npm run probe:m3:local
```

结果：

- 可复现安装通过；唯一警告是传递依赖 `node-domexception@1.0.0` 已弃用；
- TypeScript 类型检查通过；
- AC6 完整回归时 16 个单元测试文件、80 个测试通过；
- M3 运行器修复后 17 个单元测试文件、81 个测试通过；
- 6 个集成测试文件、29 个测试通过；
- 4 个 Playwright E2E 场景通过；
- Vite 生产构建通过，104 个模块完成转换；
- M0 保持 `local_pass_m0_live_confirmed`；
- M2 保持双页、双视口和 4 个验证结果通过；
- M3 预检在冻结前为 `pending_flow_calibration`；
- M3 本地外部门探针在冻结前通过；
- 当前已生成冻结基线
  `7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`。

## 下一硬门

下一步是提供三个真正未用于开发的 Figma URL、目标节点、Viewport 适配判断和最小
behaviorNotes，并在明确外部授权后按冻结基线执行三次独立盲测。盲测期间不得修改
源码、Prompt、Catalog、Schema、工具、模型、浏览器、viewport 或视觉阈值。
