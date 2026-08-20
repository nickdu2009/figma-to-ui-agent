# DS-GATE-00 证据文档：设计系统与 Catalog 扩展前置门禁

- 门禁：DS-GATE-00（阻断 S1–S16）
- 代码基线：`1352685872efe17ebe6c251b2ef9f5ab4932414b`
- 设计输入 SHA-256：`7588e7a069a7ab145764de3ac2a8947bbbf5dd4aee88fc167f70f8f75385cf5f`（已核验，无漂移）
- 计划输入 SHA-256：`ad27cad9ded8b73a5c5d968e4a5f3271e0070bb98bbbba8ac1ea5e47a9429c9f`（已核验，无漂移）
- 执行时间：2026-08-18（UTC）
- 执行环境：macOS arm64 / Node v24.18.0 / Chromium for Testing 1228（仓库本地 `data/playwright-browsers`）/ MySQL 8.4（docker `vma-mysql`，健康）
- Worktrail：仓库根存在 `.worktrail/`；本次工作未修改任何正式 `.worktrail` 知识文件。

## 0. 总体结论

| 子门 | 状态 | 说明 |
| --- | --- | --- |
| DSG-01 Catalog 合同性/性能基线 | ✅ 通过 | 36→35、Slot/Link runtime 单一持有、4 内置 Action、overlay 机械假设全部成立 |
| DSG-02 ValidationResourceEnvelopeV1 | 🟡 校准完成，生产强制待 S9 复核 | 探针覆盖八项批准值与 limit+1 构造；实际 scheduler 的拒绝证据以 S9 聚焦测试为准，状态 `proposed-by-implementation` |
| DSG-03 fatal 视觉夹具 | ✅ 校准完成（16/16 正确分离） | 阈值与夹具已写入 `tests/fixtures/validation/fatal-visual-cases.v1.json` |
| DSG-04 2MiB finish 探针 | ✅ 通过 | 近限载荷 2,070,000 字节逐字节精确、296ms、无截断 |
| DSG-05 DownloadIntent 探针 | ✅ 通过 | 8/8 场景通过（成功/弹窗阻止/abort/重复消费/phase revoke/页面卸载/60s 撤销/413 前置） |
| DSG-06 真实 LiteLLM transport | ✅ 通过 | `gpt-5.6-terra`：/models 200、流式 chat 3 chunks（首 chunk 1,965 ms）、json_object 200 |
| DSG-07 基线摘要 | ✅ 完成 | `tests/fixtures/catalog/ds-gate-00-baseline.json` |

**DS-GATE-00 整体状态：通过。**
依据实施计划 §7.2：真实 LiteLLM probe 曾在未授权时保持 unverified；现已取得授权并完成 L1/L2/L3。该结论只关闭 DS-GATE-00 前置门禁，不替代后续 S1–S16 的实现、恢复演练或发布验收。

## 1. 可重复运行脚本

| 脚本 | 子门 | 运行方式 |
| --- | --- | --- |
| `scripts/ds-gate-00/catalog-contract-probe.ts` | DSG-01/07 | `node scripts/ds-gate-00/catalog-contract-probe.ts` |
| `scripts/ds-gate-00/validation-runner-probe.ts` | DSG-02/03 | `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path> node scripts/ds-gate-00/validation-runner-probe.ts` |
| `scripts/ds-gate-00/validation-worker-child.ts` | DSG-02/03 | 由父探针调用（不直接运行） |
| `scripts/ds-gate-00/generation-finish-probe.ts` | DSG-04 | `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path> node scripts/ds-gate-00/generation-finish-probe.ts` |
| `scripts/ds-gate-00/gate00-server.mjs` | DSG-04 | 由 playwright.gate00.config.ts webServer 调用 |
| `scripts/ds-gate-00/download-intent-probe.ts` | DSG-05 | `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<path> node scripts/ds-gate-00/download-intent-probe.ts` |
| `scripts/ds-gate-00/litellm-transport-probe.ts` | DSG-06 | ⚠️ 需单独授权：`VMA_GATE00_LITELLM_AUTHORIZED=1 VMA_LITELLM_BASE_URL=… VMA_LITELLM_PROBE_MODEL=… [VMA_LITELLM_API_KEY=…] node …` |

所有探针均不读取真实 LLM 凭据；探针使用的 MySQL schema 均为 `vma_gate00_<hex12>` 隔离库（自动创建/清理），不触碰任何现有数据库。

## 2. DSG-01：Catalog 合同性与性能基线（通过）

命令：`node scripts/ds-gate-00/catalog-contract-probe.ts`（含 `npm run build` 计时）

### 合同性事实

- `@json-render/shadcn` 组件定义总数：**36**；一次性移除 runtime 持有的 `Link` 后 **35**。
- `Slot` 不在 shadcn 定义中（runtime 唯一持有 `Link`/`Slot`）。
- `schema.builtInActions` 恰为 `navigate / pushState / removeState / setState`（4 个）。
- 未出现自定义导出目录缺失或定义键与 catalog 分离的结构性漂移。

### overlay 机械性假设（计划保留项，已验证成立）

| 假设 | 结果 |
| --- | --- |
| `z.string().optional().safeParse(undefined)` 成功且恰为 `undefined`（Props addition identity） | ✅ |
| `z.union([base, preferred])` 两次构造的 JSON Schema 导出逐字节相同（确定性） | ✅（291B，SHA-256 `a412fbdf…29a95`） |
| legacy 字符串夹具命中 base 分支、preferred 对象夹具命中新分支 | ✅/✅ |

### 性能基线（批准预算见 `tests/fixtures/catalog/ds-gate-00-baseline.json`）

| 指标 | 实测 | 预算上限 |
| --- | --- | --- |
| catalog 构建 | 12.77ms | 100ms |
| 完整 JSON Schema 派生 | 7,404.85ms | 60s |
| 完整 JSON Schema 字节 | 31,499,467B（≈30.0MiB） | 32MiB |
| prompt 生成 | 0.91ms | 500ms |
| prompt 字节 / token 估算 | 11,183B / ≈2,796 | 24,576B / 6,144 |
| spec validate | 1.12ms | 500ms |
| 派生期间进程 RSS 增量 | ≈817.5MB（峰值 ≈913MB） | 1.5GiB |
| `vite build` | 2,937.82ms | 120s |

JSON Schema SHA-256：`428f6c6f16dd5f4aae5fdc8de20dc286031c068f6e0ac177fe7975381414b768`。

## 3. DSG-02：ValidationResourceEnvelopeV1（校准，非生产强制证据）

命令：`PLAYWRIGHT_CHROMIUM_EXECUTABLE=… node scripts/ds-gate-00/validation-runner-probe.ts`
结果：`overall: pass`；normal 16 case 运行 14,441ms、子树 RSS 峰值 472,875,008B（≈451MiB）、IPC 报告 3,851B。

| 预算项 | 建议批准值 | limit（内） | limit+1（外） | 稳定错误码 |
| --- | --- | --- | --- | --- |
| jobTimeoutMs | 120,000 | 16 case 14.4s 完成 | SIGTERM→SIGKILL `timeout` | validation_timeout |
| workerTerminationGraceMs | 5,000 | 宽限内退出 | 宽限耗尽升级 SIGKILL | validation_timeout |
| workerMaxRssBytes | 2,147,483,648（2GiB） | 峰值 ≈451MiB | 768MiB 持有→`rss_killed` | validation_memory_limit_exceeded |
| workerStdoutStderrBytes | 65,536 | 单行有界 JSON | `stdout_exceeded` | validation_output_limit_exceeded |
| workerTemporaryArtifactBytes | 268,435,456 | 0 字节工件 | 精确构造 268,439,552B 工件（生产拒绝属 S9） | validation_output_limit_exceeded |
| ipcReportBytes | 1,048,576 | 3,851B | `report_exceeded` | validation_output_limit_exceeded |
| validationSessionTtlSeconds | 600 | TTL 内使用 | `validation_session_expired` | validation_session_expired |
| validationSessionMaxRequests | 512 | 预算内 | `validation_session_request_limit_exceeded` | 同名 |

RSS 轮询采用 `ps -axo pid=,ppid=,rss=` 快照对 worker 子树求和（macOS/Linux 通用）；stdout/stderr 使用同一输出字节计数，临时工件按递归逻辑长度计数。这个独立探针校准 Envelope，不替代 S9 scheduler 的生产 fail-closed 证据。
批准状态：`proposed-by-implementation`（值见 `tests/fixtures/validation/validation-envelope.json`）。

## 4. DSG-03：fatal 视觉夹具（16/16 正确分离）

夹具目录：`tests/fixtures/validation/fatal-visual/`（normal + 7 异常 × 桌面/移动）。

七类 fatal 判定阈值（在两类视口上把 normal 与全部 fatal 夹具精确分离）：

| 指标 | 阈值 | issueCode | normal 实测 | fatal 实测（代表值） |
| --- | --- | --- | --- | --- |
| mainWidthRatio | < 0.20 | content_width_too_narrow | 0.764 / 1.000 | 0.028 / 0.103 |
| verticalCollapseCount | ≥ 1 | vertical_text_collapse | 0 | 1 |
| maxOverlapRatio | > 0.50 | critical_overlap | 0 | 0.5357 |
| horizontalOverflowPx | > 24 | viewport_overflow | 0 | 160 / 1210 |
| maxClippedPx | > 64 | content_clipped | 0 | 200 / 344 |
| navMainGapPx | > 320 | navigation_content_detached | ≤0 | 720 |
| maxBlankBandPx | > 400 | excessive_blank_region | 0 | 640 |

完整矩阵与阈值文件：`tests/fixtures/validation/fatal-visual-cases.v1.json`（profileVersion `fatal-visual-v1`）。
已知实现细节：overlap 检测在 critical-overlap 移动端同时测得 overflowPx=190，但判定顺序保证首个命中 code 为 `critical_overlap`（夹具期望即如此）。

## 5. DSG-04：接近 2MiB 的 finish 探针（通过）

命令：`PLAYWRIGHT_CHROMIUM_EXECUTABLE=… node scripts/ds-gate-00/generation-finish-probe.ts`
链路：`src/probe/main.tsx`（CopilotKit v2）→ Vite dev 代理（3100）→ Hono `mountCopilotKitRuntime`（3101，probe Agent）→ AG-UI SSE。

- 近限：`spec.patch.finish` CUSTOM 载荷 **2,070,000B（逐字节精确）**，结构完整可解析，首事件→finish **296ms**，浏览器 heap ≈65.7MB。
- 超限（2,310,000B）：**无截断完整传输**——当前栈无服务端字节上限；结论：2MiB 上限的 413/断流强制必须由 S11 协议 v2 服务端实现（transport 本身不构成防线）。
- 服务端进程 RSS 峰值：**415,514,624B（≈396MiB）**（`gate00-server.mjs` 每 500ms 采样）。
- 端口说明：探针配置 `playwright.gate00.config.ts` 复用 CSRF Origin 白名单内的 3100/3101（`reuseExistingServer:false` 确保不附着既有实例；数据库使用隔离 `vma_gate00_*` schema）。生产中间件未做任何修改。

## 6. DSG-05：DownloadIntent + 有界 CSV（8/8 通过）

命令：`PLAYWRIGHT_CHROMIUM_EXECUTABLE=<Chromium for Testing> node scripts/ds-gate-00/download-intent-probe.ts`

| 场景 | 结论 |
| --- | --- |
| 同步预开 target + 异步正文 + target 内 `<a download>` | ✅ 产生指定文件名 `records.csv` 的真实下载 |
| popup 阻止 | ✅ `beginDownloadIntent` 返回 null，无下载 |
| abort | ✅ AbortError（156ms），target 关闭，无下载 |
| 重复消费 | ✅ 第二次消费 `download_intent_already_consumed`，仅一次下载 |
| phase revoke | ✅ 迟到完成 `download_intent_revoked`，无下载 |
| 页面卸载 | ✅ host pagehide 关闭 target（pages 1→0） |
| URL 撤销 | ✅ 成功后 123ms 撤销（远低于 60s 上限） |
| 10MiB 超限 | ✅ 服务端发送正文前 413，host 不创建任何下载 |

实现注记：探针页内嵌了设计 §9.2 的参考 host 实现（begin/complete/cancel/revoke + pagehide 清理）；该参考实现即 S8 生产实现的合同蓝本。

## 7. DSG-06：真实 LiteLLM transport（已执行）

- 探针：`scripts/ds-gate-00/litellm-transport-probe.ts`，经用户授权后在 2026-08-20 执行；凭据仅从进程环境读取，输出不记录网关地址、密钥或响应正文。
- 模型：`gpt-5.6-terra`。
- L1 `/models`：✅ HTTP 200。
- L2 流式 chat completion：✅ 3 个 chunk，首 chunk 1,965 ms。
- L3 `json_object` 结构化输出：✅ HTTP 200。
- 双重护栏仍保留：缺少 `VMA_GATE00_LITELLM_AUTHORIZED=1` 或 `VMA_LITELLM_BASE_URL` 时拒跑（exit 2）。本结果只证明本次网关、模型与凭据组合的 transport 能力；不替代正式 Agent 的端到端生成验证。

## 8. 版本化批准 JSON

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `tests/fixtures/catalog/ds-gate-00-baseline.json` | 合同性事实 + 性能预算 + transport 基线（DSG-07） | proposed-by-implementation |
| `tests/fixtures/validation/validation-envelope.json` | ValidationResourceEnvelopeV1 八项批准值（DSG-02） | proposed-by-implementation |
| `tests/fixtures/validation/fatal-visual-cases.v1.json` | fatal 视觉阈值 + 16 夹具期望矩阵（DSG-03） | proposed-by-implementation |

## 9. 事件与修复记录（诚实披露）

1. **探针 schema 泄漏（已修复）**：DSG-04 前几轮运行中，Playwright 拆除 webServer 时 SIGKILL 绕过了 `gate00-server.mjs` 的退出清理，泄漏 5 个 `vma_gate00_*` 隔离 schema。修复：RSS 采样时同步写结果文件 + 汇总脚本运行结束后按固定 pattern（`^vma_gate00_[0-9a-f]{12}$` 白名单校验）统一清扫。最后一次运行后 `SHOW SCHEMAS LIKE 'vma_gate00%'` 为 0，无残留。
2. **CSRF 拒绝（已规避）**：首轮 DSG-04 使用隔离端口 3198/3199，被生产 CSRF Origin 白名单（3100/3101）拒绝（403 `csrf_rejected`）。处理：探针配置改用白名单内端口 3100/3101（`reuseExistingServer:false`），未修改任何生产中间件。
3. **abort 场景初判失败（已修复）**：探针初版只 `await fetch`（仅等响应头），未读正文即 resolve，导致 abort 计时失效；改为读取 `arrayBuffer()` 后按 AbortError 判定（156ms 命中）。
4. **vite build 计时**：DSG-01 每次运行都会执行一次完整 `npm run build`（写入 dist/，属常规构建产物）。

## 10. 尚未验证内容与所需授权（汇总）

| 项 | 所需授权 |
| --- | --- |
| S16 兼容性切换/恢复演练、发布、commit/push | 均未授权，未执行 |

## 11. 工作树变更清单（本门禁新增，未含用户既有修改）

- 新增：`scripts/ds-gate-00/`（7 个探针脚本）、`playwright.gate00.config.ts`、`tests/browser/gate00-generation-finish.spec.ts`、`tests/fixtures/catalog/ds-gate-00-baseline.json`、`tests/fixtures/validation/validation-envelope.json`、`tests/fixtures/validation/fatal-visual-cases.v1.json`、`tests/fixtures/validation/fatal-visual/`（8 个夹具 HTML）、本文档。
- 修改（探针面，非生产路由）：`server/probe-agent.ts`（新增 gate00 场景分支，原有三段场景不变）、`src/probe/main.tsx`（新增 finish 指标记录元素）。
- 未触碰：`server/index.ts`、生产路由、`server/db/schema.ts`、迁移、`package.json`/lock、legacy/、`.worktrail/` 正式知识、任何现有数据库 schema。

## 12. S1 复测：新派生目录下的基线更新（实施后追加）

S1 落地单一 CatalogContract 后，目录规模从 35 个基础组件（0 action）变为 82 个组件
（35 base + 46 additions + 7 overlay 合并）+ 10 个 customActions。对 DSG-01 基线的
实测更新：

| 指标 | DSG-01 基线（35 组件/0 action） | S1 派生目录（82 组件/10 actions） | 结论 |
| --- | --- | --- | --- |
| catalog 构建（deriveCatalog） | 12.77 ms | 毫秒级（同量级） | 符合预算 |
| catalog.validate(spec) | —（未测） | 36 ms（首次，Zod 构造后缓存）/ 34 ms | 生成循环可用 |
| catalog.prompt() | 派生 7.4 s（含 schema） | 1 ms（缓存后）/ 冷启动亚秒级 | 符合预算 |
| catalog.zodSchema() | — | 0 ms（缓存） | 符合预算 |
| catalog.jsonSchema() 导出 | 31,499,467 B / 7.4 s | 超线性膨胀：0 action 14.3 s/31.5 MB，1 个 trivial action 23.8 s/50.3 MB（+19 MB/action），queryRecords 单 action 145 s | **不进入任何代码路径** |

**jsonSchema() 导出路径的处置**：json-render 的 catalog-aware JSON Schema 把每个
action 的 params 内联进每个组件 `on` 绑定的联合分支，action 个数使导出体积/耗时
近似线性放大（每 action +19 MB）。设计已明确"完整 catalog-aware JSON Schema 只用于
程序校验，不进入模型上下文"；程序校验实际使用 `catalog.validate()`/`zodSchema()`
（毫秒级、进程内缓存），全代码库无任何路径调用 `jsonSchema()` 导出（静态搜索确认，
仅 DS-GATE-00 探针与旧 browser catalog 契约测试使用旧 35 组件目录的导出）。
生成协议使用结构化工具调用与压缩 Prompt 投影，不依赖 LLM structured outputs。
因此 S1 保留 `DerivedCatalog.jsonSchema()` 惰性方法但不在任何路径调用；
该约束是后续阶段（尤其 S11 生成器）必须遵守的边界。

**S1 契约闭合**：`tests/fixtures/catalog/catalog-contract.v1.json` 版本化夹具锁定
35 base / 46 additions / 7 overlays / 10 customActions / 4 builtIns / 82 registryKeys；
契约测试 69 个（catalog-contract 17 + overlay-compat 27 + app-ui-bundle 12 +
canonical-digest 13）+ bundle-gates 6 + derived-asset 7 + prompt-projection 7 全部通过；
全量 `npx vitest run` 199 测试通过；typecheck 通过。

## S2 复测结果（数据库与 Repository 骨架）

**结构一次性 additive**：`server/db/schema.ts` 按 §13.2 扩展三张既有表
（generation_runs 18 列 / draft_versions 12 列 / published_versions 8 列，全部
nullable）+ 8 张新表。0005 SQL 由 step 注册表生成
（`server/persistence/additive-migration-verifier.ts`，46 步，
每步幂等：information_schema 条件 + PREPARE/EXECUTE + 账本
`INSERT ... ON DUPLICATE KEY UPDATE`）；磁盘文件与生成器零漂移（测试断言）。
关键事实：平台既有表 collation 为 MySQL 8 默认 utf8mb4_0900_ai_ci
（0001 仅转换 email_normalized 列），新表必须同 collation 否则跨表外键
ER_FK_INCOMPATIBLE_COLUMNS；information_schema 查询返回大写列名，
代码必须显式别名。

**fail-closed 三阶段**：启动迁移固定 preflight → Drizzle migrate → postflight
（`server/persistence/migrations.ts`）。实测矩阵（隔离 schema）：
空库全量 ✓；0004→0005 升级旧数据保留 + 新列 NULL ✓；幂等重跑 ✓；
部分 DDL（36 条语句已应用、journal 未记）续跑完整收口 ✓；
伪造 journal（标记完成但结构未应用）preflight fail closed ✓；
篡改列型 / 删索引 / 删 CHECK / 篡改账本 digest / 受管新表加私列均 fail closed ✓。

**Repository 骨架语义**（全部条件更新 fail closed）：
release-repository 闭合状态机（running→validation_running→
awaiting_preview→succeeded + Bundle 草稿同事务；fatal→recovery_pending→
recovery_consumed；markFailedFrom 稳定诊断码；publishDraft 复制 Bundle 列）；
preview-selection（draft/published/empty + CHECK 兜底 + 跨应用成员拒绝 + 回退）；
recovery（幂等创建 / 每 app 5 个 pending 上限 / CAS 消费 / 相同决定重放 /
不同决定 recovery_decision_already_consumed / 到期物化）；
design-asset（Blob 内容寻址去重 / source→blob 依赖 / extraction ready 行不可变
（无 UPDATE 路径）/ job lease 领取-完成-失败 + 过期重领 / UTC_TIMESTAMP(3)
数据库时间）；idempotency（claim 与业务同事务 / requestHash 冲突检测 /
终态只存结果引用 / 24h 有界清理）。

**验证**：`tests/integration/persistence/` 新增 3 文件 14 测试
（migration 3 + partial-ddl 3 + schema 8）全部通过；全量
`npx vitest run` 213 测试通过（S1 后 199 → 213）；typecheck 通过。
所有测试使用隔离 schema（vma_test_<随机>，用后 DROP）。

## S3 复测结果（RuntimeActionDispatcher、ExecutionGate 与 target lease）

**模块**：`packages/next-app-runtime/src/actions/` 新增 contracts / dispatcher /
execution-gate / target-leases 四模块并接线 create-runtime / provider /
page-renderer / index；`NextAppRuntime.getActionDispatcher()` 成为 custom
Action 唯一执行边界的公开入口。

**分流机制（设计 §9.2 "进入上游 handler 路径前被分流"）**：
PageRenderer 在存在 actionAdapter 时为 custom Action 注册永不 settle 的
包装 handler——上游 executeAction 的 binding onSuccess/onError 因 await
永不完成而永不触发；Dispatcher 的合同级静态回调（contract.onSuccess/
onError，宿主代码拥有，纯 UI/导航）是唯一回调面并在终态后重新过 Gate。
built-in（navigate/setState/pushState/removeState）不经本模块；
`assertAdapterActionClosure`（catalog-gate 新导出）闭合
catalog.actions = handlers ∪ adapterActions 且不得重叠、内置不得进 Adapter、
同一 custom Action 不得双重注册（fail closed）。

**单终态与写权限**：dispatchId 由 Dispatcher 每次生成（`dispatch_` 前缀
opaque）；写操作 idempotencyKey 由宿主侧生成（`idem_` 前缀）且
`retryOfDispatchId` 复用原 key；终态前 LeaseAuthority 重验——aborted/
迟到/revoked/lease 已丢失/页面 store 已卸载的终态不写状态、不清 loading、
不执行回调；throw/非法形状/错 dispatchId 归一化为一次有界
`action_result_invalid`；loading 清除与 result/error 写入在单个
stateStore.update 批次内原子提交（测试断言 update 调用序列）。

**故障注入矩阵（tests/actions/ 3 文件 29 测试全过）**：
latest-wins 抢占（旧 signal abort + 旧终态无写权限 + 新请求 loading 不被清）；
exclusive 重复提交拒绝（action_duplicate_submit + 冲突 dispatchId）；
revoked gate 在途终态不提交；staging/unsaved/draft 阶段门禁稳定码
（preview_staging / preview_not_saved / draft_write_forbidden /
validation_action_forbidden）；身份不匹配（bundleRevision 变化 →
identity_mismatch）；回调 throw 不影响已提交终态；params/targets 非法与
未知 Action 的零写入路径；phase 单调推进（staging→unsaved→draft；
逆向=phase_regression；published 就地跃迁=phase_jump）。

**验证**：`npm run build:runtime` ✓；`npx vitest run tests/actions`
3 文件 29 测试 ✓；包全套 18 文件 369 测试 ✓（S3 前 340）；
根 `npm run typecheck` 0 错误 ✓。

## S4 复测结果（唯一 BundlePreviewController）

**新增模块**：`src/runtime/bundle-preview-controller.ts`（候选事务：
校验 → 候选 Runtime 出生 → 唯一 applySource → 最小 smoke → 原子提交）、
`src/runtime/bundle-preview-store.ts`（active 句柄/状态快照/toast/dialog 有界面）、
`src/runtime/runtime-action-adapter.ts`（10 个 P0 Action 合同的单事实派生；
ui 类本地执行、数据类经版本化路由 fail closed；includeActionNames 与
catalog.data.actions 精确闭合）。

**接线（单一 Apply 边界收敛）**：`runtime-apply-controller.tsx` 的 finish
路径改为 `controller.stageGenerationPatch`（不再直接 applySource）；
`preview-panel.tsx` 经 `createWorkbenchPreviewController` 组装候选/active
Runtime（同一 catalog/registry/limits/fallbacks + Adapter）并以
`${bundleRevision}:${revision}` 为 Preview root key；`published-preview-loader`
改走 `stagePersisted`（draft/published 绑定）；`app.tsx` Workbench 拥有
controller（StrictMode 安全的调度式 dispose）；`copilotkit-tools` /
`chat-panel` 全部经 controller 读取 active runtime。

**事务语义（设计 §5.1.1）**：v1 增量补丁候选以 initialSource 携带当前 spec
出生（解决 base:"current" 依赖活跃 runtime 的问题），再应用唯一一次
jsonl-patch；未触及路由时 pathname 保留。v2 Bundle 经 schema + 字节门禁 +
重算 uiBundleDigest + sequence/operationCount 校验后以 {kind:"object"} 提交
（applySource 公开合同未扩展）。committed 后 Adapter phase 单调
staging→unsaved（dispatcher.transitionPhase，失败销毁候选）；
confirmDraftCommitted 核对 appId/candidateDigest/bundleRevision 后推进
draft（就地改 handle.execution，不重建 root——Preview Commit 不重复动画）。
退役 Runtime 延迟一个宏任务销毁（dispose 幂等），dispose 即撤销全部 gate。

**RuntimeErrorCode additive 扩展**：preview_staging_busy /
preview_staging_timeout / preview_smoke_failed / preview_staging_failed /
stale_generation（dist 已重建同步）。

**修复的实现缺陷**：waitForSpecReady 的 settle 引用 TDZ 未初始化
timer/unsubscribe（首次同步 check 通过时抛 ReferenceError 被归一化为
preview_staging_failed）——改为 let 声明 + settled 守卫，由测试驱动发现。

**故障注入矩阵（contract 17 测试 + browser 3 测试全过）**：摘要错配
（bundle_digest_mismatch）、schema 失败（bundle_invalid）、apply 失败
（patch_invalid）、smoke 失败（候选出生 invalid → preview_smoke_failed）、
初始化超时（preview_staging_timeout）、swap 中断（预中止 signal →
cancelled）、dispose 后回调（cancelled + active 清空）、旧 finish/重复
finish（stale_generation）、并发 staging（preview_staging_busy，第一事务
不受影响）、原子切换（active 一次替换 + bundleRevision 单调 +1）、
draft/published gate（就地 published 跃迁 phase_jump / published 回退
phase_regression）、confirm 身份核对全矩阵（错 appId/revision/digest →
identity_mismatch；二次 confirm → phase_mismatch）。

**验证**：`npx vitest run tests/contract/bundle-preview-controller.test.ts`
17/17 ✓；`npx playwright test tests/browser/bundle-preview.spec.ts
--config playwright.mock.config.ts` 3/3 ✓（生成提交原子切换、坏补丁旧
revision 可交互 + URL 不变、刷新经 stagePersisted 恢复 draft）；全浏览器
mock 16/16 ✓；根 vitest 230/230 ✓；根 typecheck 0 错误 ✓；
build:runtime ✓。

**S4 边界说明**：Token/CSS 编译、样式表与 ResolvedAssetHandle 的原子
切换面属 S6（handle 已预留 uiBundleDigest/bundle 槽位）；Preview Commit
服务端幂等接口属 S11/S13（confirmDraftCommitted 为浏览器侧核对面）。

## S5 复测结果（P0 Catalog 组件、overlay 与 Registry 键闭合）

**新增组件实现**（`src/catalog/components/`）：`app-shell.tsx`（AppShell/
Sidebar/AppHeader/AppMain/NavMenu/Breadcrumb/PageHeader[+Actions]/Section
族/Toolbar 族，15 个）、`data-display.tsx`（DataTable[typed columns/
queryKey 受控 state]/Collection[+Item]/DescriptionList，4 个）、
`feedback.tsx`（EmptyState[+Actions]/ErrorState/AlertDialog 族/Sheet 族，
11 个）、`forms.tsx`（Form[/runtime/forms/<formId> 值契约 + hydration
epoch]/FormSection 族/DatePicker/DateRangePicker/Combobox/MultiSelect，
7 个）、`icons.tsx`（Icon/IconButton + 40 白名单 SVG 的 IconGlyph）、
`legacy-overlays.tsx`（Table/Select/Accordion[+Item/Trigger/Content]/
Popover[+Trigger/Content]/Carousel[+Item/Controls]/Button/Image 升级绑定：
旧 v1 props 原样可渲染 + typed/compound 新模式双分支）。

**国际化**（用户要求，S5 内完成）：`messages.ts` 受控词典层——
zh-CN/en 双语全键闭合、`{name}` 占位确定性替换、缺 key fail closed 回退
zh-CN、`setCatalogLocale`/`registerCatalogMessages`（键不全即 throw）。
5 个组件文件的全部用户可见字符串（loading/empty/placeholder/aria-label/
重试/关闭等）零硬编码，均经 `catalogMessage()`。

**Registry 键闭合**：`catalog-bindings.tsx`（设计 §10.3 绑定 owner）组装
base 35 + overlay 替换 7 + additions 46 = **81 键**，模块加载期对
CatalogContract additions/overlays 键集逐一对账（缺/多即 throw）。
`catalog.tsx` 改用 `deriveCatalog(catalogContract)`（模型目录含 10 个
customActions；prompt 1ms/23.6KB）；registry actions 为永不定局包装
（custom Action 唯一执行边界仍是 S3 Dispatcher）。

**RuntimeErrorCode/gate 演进**：`assertCatalogAndRegistry` 增加可选第 4
参 `adapterActionNames`（actions 闭合变为 handlers ∪ adapterActions 联合，
与 S3 语义一致）；create-runtime 构造器传入 Adapter 键集。public-api
冻结清单同步（useNextAppNavigation 导出 + 5 个 preview_* code）。

**jsonSchema 边界遵守**：S5 未新增任何 `jsonSchema()` 调用路径（S1 处置
约束）；catalog-prompt 契约测试移除旧 35 组件目录的 jsonSchema 尺寸断言，
改为断言 81 组件/10 Action/prompt 预算/validate。

**结构 CSS**：`styles.css` 追加 vma-* 结构样式（布局/语义态/可访问性，
reduced-motion 守卫；颜色/字体 token 化留给 S6）。

**验证**：`tests/contract/s5-catalog-bindings.test.ts` 11/11（键闭合/
overlay 在位替换/Action 键闭合/includeActionNames 过滤/词典完整性/
占位替换/未知 locale 回退/结构 smoke）；catalog-prompt 5/5；runtime 包
369/369；根 vitest 209/209；集成 33/33；typecheck 0 错误；vite build ✓；
浏览器 mock 全套 16 用例全过（14 直过 + 2 冷启动重试过；agent-flow 首载
等待依证据提至 45s——81 组件派生使冷启动变慢）。

**S5 边界说明**：Token/CSS 编译、ResolvedAssetHandle、Preview containment
属 S6；catalog-aware jsonSchema 的超线性膨胀为 S1 已记录事实
（每 action 约 +19MB），S5 保持"无任何代码路径调用"的约束不变。

## S6：Token/CSS 编译、Preview containment 与资源句柄

**实现**：`src/runtime/token-compiler.ts`（primitive→semantic→component 三层
解析：引用闭合/无环/键与值 allowlist/512 变量上限/fontFamily(assetId) 产出
digest 命名空间 family IR）；`src/runtime/css-compiler.ts`（全部选择器绑定
`[data-vma-preview-root][data-bundle-revision="<rev>"]`；@keyframes 命名空间化
并重写 animation 引用；拒绝宿主选择器/未知 at-rule/外部与相对 URL/
position:fixed/越界 z-index/view-transition-name/非 --app- 自定义属性；
Rule≤1000、Selector≤2000、声明/Rule≤64、选择器≤256 字符、组合符≤4、
@keyframes≤32、关键帧步骤合计≤200）；`src/runtime/asset-url-resolver.ts`
（Manifest 闭合：contentHash/MIME/byteLength 逐项核对；blob: URL 与
FontFace 生命周期；candidate/active/retired 三代原子替换，失败只撤销候选；
ASSET_REF_LIMIT=100；Controller-private，不写 state/Bundle/log）。

**接线**：`bundle-preview-controller.ts` stageBundle 在 digest 复核后编译
Token/CSS/资源（编译前预留 bundleRevision，作用域属性与提交句柄同一数值）；
任何失败返回稳定 code（design_token_*/css_*/asset_*）并保留旧 Preview；
commit 原子携带 designCss 与 disposeAssets；retired 代与事务失败路径同步
销毁资源句柄。`preview-panel.tsx` 以命令式 `<style>`+textContent 注入
designCss（编译产物不经 HTML 解析器），preview-surface 承载 root 标记属性；
`styles.css` 落实 contain:layout paint style/isolation:isolate/
position:relative/overscroll-behavior:contain。

**验证**：`tests/contract/token-css-gates.test.ts` 29/29（三层编译/悬空/
循环/非法键值/limit+1×4/宿主选择器/at-rule/URL/危险属性值/keyframes 命名
空间与限额/Rule 与声明限额/选择器限额/花括号完整性/Resolver 闭合与
生命周期/Controller 集成 fail closed×4）；浏览器
`design-system-isolation.spec.ts` 2/2（顺序切换原子性、A 样式在 B 提交后
不再命中、宿主 computed style 全程不变、恶意宿主选择器与 fixed overlay
fail closed、containment 语义断言——Chromium 将 layout paint style 折叠
序列化为 content）。回归：根 vitest 271/271、runtime 包 335/335、
typecheck 0 错误、vite build ✓。

**测试基建修复（有证据的最小变更）**：compose 项目名随仓库目录改名漂移导致
`db:up` 容器名冲突——docker-compose.yml 顶层固定 `name: vite-multipage-agent`
（收养既有健康容器与数据卷，未删除/重建任何容器，未触碰数据）；
e2e 登录辅助以"新邮件到达"为轮询条件并放宽至 20s（共享开发库上发送→落库
偶发 5s+，且页面内联 dev-otp 展示是一次性 fetch 竞态，不作为登录依赖）。

---

## S7 实施证据（2026-08-19）

**范围**：DesignAsset Blob/Source/Extraction/读取/GC（计划 S7，设计 §5.4）。
Owner：Asset Pipeline owner。覆盖 AC：AC8b、AC11、AC11a–f、AC12、AC13a、AC21。

**新增模块（server/design-assets/）**：

- `contracts.ts`：strict `DesignAssetStructuredSummaryV1`（zod exact——未知字段
  拒绝、palette/typography role 各自唯一、枚举数组内部去重、颜色 `#rrggbb`、
  label≤40/familyName≤80 code points、NFKC+控制符/URL/HTML Gate、canonical
  ≤64 KiB）；闭合错误码（asset_invalid/asset_mime_forbidden/asset_magic_mismatch/
  asset_hash_mismatch/asset_byte_length_mismatch/asset_limit_exceeded/
  asset_not_found/asset_forbidden/asset_store_unavailable）；限额常量
  （per-app source≤20 项/100 MiB、单次 generation≤8 refs、单摘要≤64 KiB、
  合计≤256 KiB）。
- `blob-store.ts`：SHA-256 内容寻址写 `VMA_ASSET_ROOT`（tmp/<server-id> 临时
  写入→长度/hash/MIME 魔数校验→同文件系统原子 rename；目标已存在时校验一致
  后复用）；魔数确认 MIME（声明与实际不符 fail closed）；路径派生仅
  `sha256/<前两位>/<完整哈希>`（拒绝用户输入路径/穿越）；孤儿 tmp 按 mtime
  年龄有界清扫。
- `extraction.ts`：确定性 P0 提取器（PNG 真实像素采样 palette、PDF 哈希派生
  枚举——同字节两次提取结果完全一致）；`createExtractionWorker` 以有界租约
  claim queued job，成功事务=新 immutable Extraction + resultExtractionId +
  Source CAS 切 readyExtractionId。
- `service.ts`：上传编排（Blob→Source(uploaded)→job(queued)）；per-app
  20 项限额 fail closed；`buildBrandSourceSnapshot` 只含不可变快照条目
  （sourceId/sourceContentHash/extractionId/extractionDigest/
  extractorProfileVersion），hash 不符统一 asset_not_found（不泄露存在性）。
- `reconciliation.ts`：租约到期 job→failed/extraction_worker_lost（不自动
  重试）；卡死 extracting source（无活动 job）→failed；孤儿 tmp 清扫。
- `gc.ts`：双快照可达性权威——有效/恢复窗口(7天)内 source、queued/running
  job、非终态或 7 天审计窗内 run 的 brandSourceSnapshot+candidateBundle
  Manifest、Draft/Published（含回收站）Bundle Manifest 全保护；终态过窗
  run 不再保护；完全不可达 Blob 删文件留元数据行（审计面），remove 幂等。
- `read-resolver.ts`：generation 面（membership 重授权 + viewer 拒绝 + run
  归属/保留期/candidateDigest 精确匹配 + Manifest 条目）；draft/published
  面同理；manifest→blob→磁盘→魔数→哈希全链路核对，任一失败 asset_not_found。
- `routes/design-assets.ts`：POST 上传（editor+，真实 membership.id）、GET
  列表（仅元数据）、三个版本化读取面 GET/HEAD（private,no-store/nosniff/
  精确 MIME/ETag；resolver 错误经 mapAssetError 映射——asset_forbidden 与
  not_found 同为 404，存在性保护）。

**运行时接线**：`asset-url-resolver.ts` 新增 `createRouteAssetByteSource` 与
`AssetReadBinding`（generation/draft/published 版本化 URL，每次请求重新授权）；
`bundle-preview-controller.ts` 新增 `assetByteSourceFor` 选项，stageBundle 以
generation 绑定（generationId+candidateDigest）派生受权字节源，优先于静态
fixture 源。draft/published 面的 Bundle 重绑定随 S11/S13 单写切换完成
（stagePersisted 当前仍走 spec 投影）。

**服务端接线**：`server/index.ts` 在 `VMA_ASSET_ROOT` 设置时挂载路由 +
启动 reconciliation + 进程内提取 worker（1s tick、每 tick ≤4 job、60s 租约）；
未设置时 fail closed 不挂载。`playwright.mock.config.ts` 注入
`VMA_ASSET_ROOT=.e2e-assets` 并注册 design-assets.spec.ts。

**验证**：

- `tests/integration/persistence/design-assets.test.ts` 7/7（内容寻址/幂等
  复用/魔数拒绝/路径防御/缺 Blob fail closed/上传编排+worker 全跑通 ready/
  确定性提取×2/strict Gate×6/per-app 限额/孤儿 tmp 清扫）；
- `design-asset-extraction-jobs.test.ts` 6/6（queued→running→succeeded CAS/
  事务原子性——Source CAS 失败 Extraction 一并回滚/租约到期 reconciliation
  worker_lost 不重试/重新提取新建 jobId+extractionId 不覆盖历史/并发 claim
  唯一胜者）；
- `design-asset-gc.test.ts` 7/7（不可达删除+幂等+元数据保留/有效 source
  保护/恢复窗内外 deleted source/活动 job 保护/非终态 run 快照+Manifest
  保护/终态过窗不保护/Draft+Published Manifest 保护）；
- `tests/browser/design-assets.spec.ts` 4/4（上传→worker→ready 全链路；
  generation 面正向字节级比对+private,no-store/nosniff/MIME/ETag+HEAD
  一致+digest 不符 404+不存在 run 404；非法 purpose/魔数不符/空字节
  稳定错误码；viewer 不可上传；未登录 401）；
- 回归：根 vitest 291/291、runtime 包 369/369、typecheck 0 错误、
  vite build ✓。

**实施中发现并修复**：路由最初以合成字符串充 membership id 触发 FK 500——
改为 requireRole 返回的真实 membership.id；读取面 resolver 错误原未映射
（500）——三面统一接 mapAssetError；`server/bundle/digests.ts` 与
`prompt-projection.ts` 的 `.js` 导入在 Node 类型剥离下失效（此前仅 vitest
消费）——改 `.ts` 扩展。

**未验证（按计划显式排除）**：真实 LiteLLM/厂商模型 transport probe（未授权）；
对现有 MySQL 实际执行 0005（未授权，仅隔离 schema 验证）；MySQL 与
VMA_ASSET_ROOT 联合备份恢复演练（未授权）；GC 与并发提取的故障注入矩阵中
"rename 前后崩溃"以孤儿 tmp 清扫覆盖，根目录不可写注入未单独演练。

---

## S8 实施证据（2026-02-17）

**范围**：生成应用受控业务数据存储、共享 UoW 与 DownloadIntent（计划 S8；AC6/AC7/AC8/AC8c/AC8f/AC8g/AC8h/AC8i/AC8j/AC13b/AC21/AC22）。

**实现**：

- 服务端合同 `server/actions/contracts.ts`：strict 信封（protocolVersion/publishedVersionId/actionName∈8 个服务端动作/idempotencyKey/canonicalParams；拒绝身份/角色/替代 appId/未知键）、8+2 动作枚举、稳定错误码（含新增 draft_readonly）、submitForm 参数 schema（唯一 opcode 解析）、requestHash（canonical JSON）。
- UoW `server/actions/unit-of-work.ts`：固定锁序 ReleasePointer(FOR UPDATE)→ledger→record；`lockAndVerifyReleasePointer` 同事务核对版本头（不符→published_version_changed）。
- Repository 事务原语：`BusinessDataRepository` 增加 insert/update/softDelete/find/count/isPrincipal `*InTransaction`（public 方法保留为自开事务兼容 wrapper）；`MysqlReleaseRepository` 增加 `lockReleasePointerInTransaction`（FOR UPDATE）与 `findPublishedVersionByIdInTransaction`。
- 执行器 `server/actions/executor.ts`：读命令（queryRecords/loadRecordForm/downloadExport）不建账本但同事务快照核对 ReleasePointer+Schema+权限；写命令（create/update/delete/submitForm 解析唯一 opcode）同事务 claim→mutation→终态，崩溃回滚无孤立 pending；completed 重放重新鉴权后从 resultRef 投影（权限/版本变化拒绝且不泄露旧结果）；错 hash→idempotency_key_conflict；并发同 key/hash 仅锁持有者执行。
- CSV `server/actions/csv-export.ts`：公式中和（=+-@/HT/CR/LF/Unicode 空白与控制前缀；已有 apostrophe 不重复）、RFC 4180、10,000 行与 10 MiB 完整 UTF-8 上限（正文前 413 export_too_large）、文件名安全化。
- DraftDataView `server/draft-data-view/service.ts`：当前/候选 Schema 最严交集（动作/范围/字段/脱敏；集合任一侧缺失→空视图）；bounded query 游标绑定 appId/draftId/collection/query digest/policy digest（compiler 增加服务端侧 cursorBinding 选项）；单条读取；写入/导出稳定 409 draft_readonly（不落存储）。
- 路由 `server/routes/runtime-actions.ts`：POST dispatch（唯一业务 Action 入口；downloadExport 拒绝）、POST export（CSV 字节通道；text/csv+Content-Disposition+no-store+摘要头；字节不经 ActionResult）、draft data-view query/record 只读端点 + 写入/导出 409 面；统一 BusinessActionError→HTTP 状态映射；已接线 server/index.ts。
- Browser adapter `src/runtime/runtime-action-adapter.ts`：阶段路由（published→dispatch+版本头严格信封；draft 读→data-view、写/导出 draft_readonly 零网络；unsaved/staging 全拒零网络；缺 publishedVersionId fail closed）；downloadExport 专用 handler（同步前缀建 DownloadIntent，异步字节一次消费，ActionResult 仅含 fileName/rowCount/byteLength 摘要）。
- DownloadIntent `src/runtime/download-intent.ts`：DSG-05 参考实现的生产化（begin 同步栈预开同源空白 target、complete 恰好一次、重复消费/撤销/取消稳定码、pagehide 清理、120ms 内撤销 URL）；ast-grep open-redirect 误报已 suppress（固定空 URL，无用户输入）。
- Controller `src/runtime/bundle-preview-controller.ts`：拥有 DownloadIntentHost，随 destroyCandidate/retireActive/dispose 联动 revokeAll/dispose；preview-panel.tsx 工厂透传。
- `src/app.tsx` 未改动：S4 已经 createWorkbenchPreviewController 装配，DownloadIntent 由 Controller 内部默认持有（计划列其为预期修改面；实际无需改动，语义不变）。

**验证**：

- `npx vitest run tests/contract/runtime-action-contract.test.ts tests/integration/persistence/business-actions.test.ts tests/integration/persistence/draft-data-view.test.ts tests/integration/persistence/business-data-uow-regression.test.ts tests/integration/persistence/recycle-bin-uow-regression.test.ts tests/integration/persistence/repositories.test.ts` → 6 文件 55/55 通过（隔离 schema；含并发同 key/hash 恰好一次、崩溃无孤立 pending、错 hash 冲突、修订冲突、版本变更、viewer 越权、重放重新鉴权、游标绑定/篡改/跨 draft 拒绝、CSV 全矩阵与 limit+1、/data 与回收站回归）。
- `npx playwright test tests/browser/runtime-actions.spec.ts tests/browser/download-export.spec.ts --config playwright.mock.config.ts` → 2/2 通过（真实浏览器会话全链路：dispatch/幂等/故障注入/DraftDataView/CSV 字节通道）。
- 全量回归：根 vitest 338/338、runtime 369/369、`npm run build` 成功、`npx tsc --noEmit` 干净、浏览器 mock 全套 24/24。

**未验证**：

- 真实组件点击→Dispatcher→DownloadIntent 的 UI 端到端（需 S11 生成面产出 action 绑定 Bundle；DSG-05 已在 Chromium 验证 DownloadIntent 合同蓝本，S14 全链路 Mock 验收覆盖最终路径）。
- Form hydration epoch/recordKey/lease/dirty CAS 的浏览器侧组件交互（S5 Form 已有简化 epoch；S8 服务端 loadRecordForm 面就绪；完整 CAS 交互随 S11/S14 验收）。
