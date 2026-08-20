# vite-multipage-agent 设计系统与 Catalog 文件级实施计划

- 状态：S1–S16 已在本地隔离环境实施并验收；不代表已上线或已推送
- 计划日期：2026-08-18
- 代码基线：1352685872efe17ebe6c251b2ef9f5ab4932414b
- 设计来源：docs/vite-multipage-agent-design-system-catalog-design.md
- 设计来源 SHA-256：7588e7a069a7ab145764de3ac2a8947bbbf5dd4aee88fc167f70f8f75385cf5f
- 数据库迁移基线：server/db/migrations/0004_0004_migration_plans.sql；下一迁移编号固定从 0005 开始
- 依赖基线：@json-render/core、@json-render/react、@json-render/shadcn 0.19.0；@mastra/core 1.51.0；zod 4.4.3；Playwright 1.61.1
- 计划范围：根应用、server、packages/next-app-runtime、测试与运维文档；legacy 不参与
- 独立性：本文是新的设计系统与 Catalog 增量计划，不追加或改写既有持久化发布平台实施计划

## 1. 计划结论

本计划的实施已完成：DS-GATE-00、S1 至 S15 及 S16 的隔离首次部署/恢复演练均有证据。DS-GATE-00 仍是任何后续变更进入 S1 至 S16 等价范围时的硬阻断门；生产上线、推送与外部部署仍须独立授权。

实施按四个可合并增量交付：

1. I1：DS-GATE-00、单一 Catalog/Bundle 合同、一次性 additive 数据库结构。
2. I2：RuntimeActionDispatcher、BundlePreviewController、P0 Catalog、Token/CSS 隔离。
3. I3：DesignAsset、受控业务数据存储、P0 Validation、受控 Mastra Runtime、生成 v2、恢复、发布与兼容迁移。
4. I4：全链路验收、P1 边界封存、切换与回退演练。

每个增量都必须可独立验证、可停止，不把“完整 build 通过”当作运行时、迁移或真实 transport 的替代证据。

## 2. 上游来源与漂移规则

| 来源 | 当前状态 | 本计划用法 | 漂移处理 |
| --- | --- | --- | --- |
| docs/vite-multipage-agent-design-system-catalog-design.md | 已确认方案；当前工作树文件 | 产品边界、合同、状态机、验收标准的唯一设计来源 | SHA-256 变化后先评审差异，再更新本计划；不得静默实施旧计划 |
| docs/persistence-release-platform-design.md | 已实施平台设计 | Session、Membership、业务数据、Draft/Published、ReleasePointer、迁移基础边界 | 仅复用；不重新设计 |
| docs/vite-multipage-agent-persistence-release-implementation-plan.md | 已完成的历史实施计划 | 用于确认现有文件和迁移约束 | 不向该文档追加本增量 |
| docs/vite-multipage-agent-ac-traceability.md | 现有平台 AC 追踪 | 防止新增能力破坏已实现平台验收 | 新增本计划的 DS AC，不覆盖旧 AC |
| AGENTS.md | 仓库规则 | 真相边界、MySQL、Mock/真实 LLM、安全和 Worktrail 约束 | 实施时重新读取 |
| ADR-DS-001 至 ADR-DS-025 | 全部 Proposed | 仅作设计候选索引 | 不是 Accepted 约束，不得以 ADR 已批准为实施依据 |
| 2026-08-18 项目所有者确认 | 已确认补充实施输入 | DesignAsset 提取任务使用独立持久表；任务状态与不可变 Extraction 分离 | 只解决表归属，不授权代码、迁移或自动重试 |

基线提交只锚定代码状态。设计文件在该提交之后存在工作树修改，因此实施输入必须同时匹配代码基线和设计 SHA；只匹配其中一个不算可复现输入。

补充确认的提取任务合同：

- design_asset_extraction_jobs 只拥有提取编排状态，不拥有 Source、Blob 或 structuredSummary。
- 状态闭合为 queued → running → succeeded|failed；running 租约到期由 reconciliation 条件更新为 failed/extraction_worker_lost，不自动重试。
- 重新提取必须由显式受权操作创建新 jobId 和新 extractionId；不得复用或覆盖历史 ready Extraction。
- queued/running job 及 succeeded 后尚未完成 Source ready CAS 的 job 都进入 GC 可达性。
- 任务表不保存原始 OCR、完整提取正文、绝对路径、凭据或模型上下文。

## 3. 授权边界

接受本文只表示接受实施顺序、文件落点、依赖关系、门禁和验收映射。它不授权：

- 修改生产代码、数据库 Schema、依赖或 lockfile。
- 执行 0005 迁移、回填、切换、发布、回滚或删除旧列。
- 启动真实 LLM、LiteLLM、厂商模型或生产相似 transport probe。
- 启用真实 P0 Validation Runner、ValidationSession 生产路由或 Preview Commit。
- 修改外部服务、部署、提交、推送、创建 PR。
- 实施 BusinessAttachment、完整质量状态矩阵、独立 Preview Origin 或 DesignAsset Capability。
- 清理旧 spec 列、旧兼容读面、历史数据或 Blob。

开始实施前至少需要一次明确的“按本计划实施”授权。以下动作仍需单独确认：

1. DS-GATE-00 的真实模型 transport probe。
2. 依赖删除与 package-lock.json 变更。
3. MySQL 0005 迁移及回填演练。
4. 联合 MySQL 与 VMA_ASSET_ROOT 的备份恢复演练。
5. compatibility release 切换。
6. 任何 commit、push、部署或真实发布。

## 4. 真相与所有权

| 事实 | 唯一 owner | 可重建投影或消费者 | 禁止成为事实 |
| --- | --- | --- | --- |
| Catalog 能力、Schema、Action 键、Prompt 投影 | CatalogContract | 浏览器 Registry、服务端 Model Catalog、测试夹具 | 第二份手写 Catalog、第二次 Link 过滤 |
| AppUiBundle | 不可变 DraftVersion/PublishedVersion；生成中由 GenerationRun 持有候选 | Browser active Bundle、编译 CSS、资源句柄 | DOM、SSE、聊天、Mock、runtime state |
| ApplicationCandidate | GenerationRun 协调记录 | Spec Agent、Validator、Preview Commit | 浏览器重建对象、聊天参数 |
| 当前可交互 Bundle | BundlePreviewController 的 active revision | NextAppRuntime current snapshot | 候选 Runtime、日志、Preview URL |
| 业务记录 | 既有 BusinessData Repository | DraftDataView/ActionResult 授权投影 | Bundle、Runtime 持久 state、幂等账本 |
| 业务 Action 单次终态 | RuntimeActionDispatcher；服务端写命令事务由 TransactionalBusinessActionExecutor 持有 | loading/result/error target | json-render 上游 resolve 即成功 handler |
| DesignAsset Blob | VMA_ASSET_ROOT 内容寻址 BlobStore | MySQL 元数据、Controller-private blob/FontFace handle | Bundle 派生 URL、公共静态目录 |
| DesignAssetSource/Extraction | DesignAsset Repository | GenerationRun 固定输入快照 | 原始 OCR、模型指令、业务附件 |
| DesignAssetExtractionJob | DesignAsset Extraction Repository | Scheduler/worker lease、GC 可达性 | structuredSummary、Source 状态、自动重试策略 |
| ValidationReport | GenerationRun | finish 摘要、发布 Gate | 浏览器自报结果、部分报告 |
| 当前发布版本 | ReleasePointer | published PreviewSelection 哨兵解析 | 浏览器选择、旧 Adapter |
| 成员预览偏好 | PreviewSelection Repository | bootstrap 响应 | 地址栏、runtime snapshot |
| 恢复决定 | Recovery Coordinator/RecoveryRecord | successor GenerationRun | 自由聊天文本、GET 副作用 |

## 5. 文件落点与共享写面

### 5.1 新增模块

| 目录 | 计划文件 | 职责 |
| --- | --- | --- |
| src/catalog | catalog-contract.ts、component-contracts.ts、action-contracts.ts、overlays.ts、derive-catalog.ts、app-ui-bundle.ts、token-contract.ts、bundle-gates.ts、canonical-json.ts | 无 React、server-safe 的单一合同和纯派生 |
| src/catalog | catalog-bindings.tsx、catalog.css | browser-only RendererBindings 与 Catalog 基础样式 |
| src/catalog/components | app-shell.tsx、navigation.tsx、data-display.tsx、forms.tsx、feedback.tsx、icons.tsx、legacy-overlays.tsx | P0 组件实现 |
| packages/next-app-runtime/src/actions | contracts.ts、dispatcher.ts、execution-gate.ts、target-leases.ts | 唯一 custom Action 执行边界 |
| src/runtime | bundle-preview-controller.ts、bundle-preview-store.ts、runtime-action-adapter.ts、asset-url-resolver.ts、css-compiler.ts、token-compiler.ts、download-intent.ts | Host Bundle 事务与浏览器 Adapter |
| server/bundle | digests.ts、validator.ts、prompt-projection.ts | Candidate/Bundle 服务端校验与模型最小投影 |
| server/actions | contracts.ts、unit-of-work.ts、executor.ts、csv-export.ts | Hono Action 合同、共享事务与 CSV |
| server/design-assets | contracts.ts、blob-store.ts、service.ts、extraction.ts、reconciliation.ts、gc.ts、read-resolver.ts | 资源写入、提取、读取与回收 |
| server/validation | profile.ts、resource-envelope.ts、session.ts、scheduler.ts、worker-protocol.ts、worker.ts、service.ts | P0 独立 worker 验证 |
| server/draft-data-view | service.ts | Draft 只读策略交集视图 |
| server 根目录 | agent-runtime.ts、model-policy.ts | 受控 Mastra Runtime、固定生产模型与重试策略 |
| server/routes | runtime-actions.ts、design-assets.ts、preview-selection.ts | 新 Hono 路由 |
| server/repositories | preview-selection-repository.ts、generation-recovery-repository.ts、design-asset-repository.ts、business-action-idempotency-repository.ts | 新持久化 owner |
| server/persistence | additive-migration-verifier.ts、protocol-mode.ts | 0005 step ledger/introspection 与兼容协议模式 |
| src/validation 与 __validation | main.tsx、validation-app.tsx、index.html | 不挂 BrowserShell/聊天的独立 __validation 多页入口 |
| tests/fixtures | catalog、bundles、validation、design-assets | 可版本化合同、边界和视觉夹具 |

src/catalog 只允许导入纯 TypeScript、Zod 和 @json-render definitions。若 server import graph 引入 React、DOM、Vite 或 shadcn component bindings，立即停止 S1；不得用 bundler alias 隐藏泄漏，也不得未经设计复审擅自新增 workspace 包。

### 5.2 单写者规则

| 共享文件/表面 | 单一写者步骤 | 规则 |
| --- | --- | --- |
| server/db/schema.ts、server/db/migrations/0005_*、meta/_journal.json、0005_snapshot.json、server/persistence/migrations.ts | S2 | 后续步骤只能使用 S2 创建的结构，发现缺列先回到 S2 评审 |
| package.json、package-lock.json | S10 | DS-GATE-00 probe 不通过增加临时依赖绕过 |
| server/index.ts | S13 | S7-S12 先以工厂和路由单测交付，S13 一次性组合 |
| src/runtime/bundle-preview-controller.ts、src/app.tsx、src/preview-panel.tsx、src/styles.css | Browser Host owner，按 S4→S6→S7→S8→S13 顺序 | 不并行修改；S7/S8 的服务端工作可并行，浏览器接线串行 |
| server/model-catalog.ts、src/runtime/catalog.tsx | Catalog owner，按 S1→S5 顺序 | 不保留第二份过滤/手写 actions |
| server/mastra-agent.ts、server/generate-spec-tool.ts、server/coordinated-mastra-agent.ts | Agent/Generation owner，按 S10→S11→S12 顺序 | 不并行修改 |
| server/repositories/release-repository.ts、server/release/service.ts、server/persistence/protocol-mode.ts | Release owner，按 S2→S11→S12→S13 顺序 | 每步先合并再继续 |
| playwright.mock.config.ts、vitest.config.ts | S14 | 前序步骤添加测试文件但不争抢总配置 |

## 6. 依赖图与并行策略

    DS-GATE-00
        |
        +--> S1 Catalog/Bundle 合同 --> S3 Runtime Action --> S4 Preview Controller
        |            |                    |                    |
        |            +--> S5 P0 Catalog --+------------------> S6 Token/CSS
        |            |
        |            +--> S10 Mastra Runtime --> S11 Generation v2
        |
        +--> S2 Additive 数据库 --> S7 DesignAsset --> S11
                     |              |
                     +--> S8 Business Action
                     |
                     +--> S9 Validation ----------------------> S11

    S2 + S11 --> S12 Recovery --> S13 Release/Migration composition
    S3-S13 complete --> S14 integrated acceptance --> S15 deferred-boundary gate
    S15 pass --> S16 v2 首次部署演练

允许并行的工作：

- S3 与 S5：S1 合并后可并行，文件所有权分离。
- S7 与 S8：S2 合并后服务端模块可并行，Browser Host 接线按 S7→S8 串行，server/index.ts 由 S13 统一接线。
- S10 与 S7/S8：可并行；package/agent 文件只由 S10 修改。
- 每个步骤的独立测试夹具可并行新增；共享测试配置只在 S14 修改。

必须串行的工作：

- S1 先于所有 Catalog、Prompt、Bundle、Action 键消费者。
- S2 先于所有 Repository 与数据迁移实现。
- S4、S6、S7、S8、S13 的 Browser Host 接线按单写者顺序。
- S10 先完成受控 Runtime 工厂，S11 再改生成 Agent，S12 最后改协调与恢复。
- S11、S12、S13 必须由同一 Generation/Release lane 串行完成。

## 7. Phase 0：DS-GATE-00

### 7.1 Goal

在不修改生产执行路径的前提下，把设计中的待校准上限、真实兼容性、transport 行为和浏览器能力变成版本化证据；只有所有 blocking 子门通过并由对应 owner 确认后，才允许 S1 至 S16 开始。

### 7.2 Prerequisites

- 代码基线和设计 SHA 与本文头部一致。
- MySQL 8.4、Node 24、Chromium 与当前 lockfile 可重建。
- Probe 使用隔离应用、隔离端口、隔离数据库前缀和临时 VMA_ASSET_ROOT。
- 真实 LiteLLM probe 已取得单独授权；未授权时该子门保持 unverified，DS-GATE-00 不得标记通过。

### 7.3 Owner

- 总 owner：Architecture/Platform owner。
- Catalog compatibility/performance：Catalog owner。
- ValidationResourceEnvelopeV1：Platform/Operations owner。
- Visual fatal fixture：Design system owner。
- SSE 2 MiB 与 Browser apply：Generation/Browser owner。
- DownloadIntent/CSV：Security/Browser owner。
- LiteLLM transport/retry/log redaction：Agent platform owner。

### 7.4 Blocking subgates

| ID | Owner | 必须产生的证据 |
| --- | --- | --- |
| DSG-01 | Catalog owner | Link/Slot 单次所有权、overlay 兼容、Catalog/Prompt 性能基线 |
| DSG-02 | Platform/Operations owner | ValidationResourceEnvelopeV1 八项批准值与逐项 limit/limit+1 |
| DSG-03 | Design system owner | 桌面/移动 fatal/non-fatal 视觉夹具与阈值 |
| DSG-04 | Generation/Browser owner | 接近 2 MiB finish、UTF-8/digest/apply/断流/413 与资源指标 |
| DSG-05 | Security/Browser owner | DownloadIntent、CSV、popup/abort/revoke/卸载/超限 Chromium 证据 |
| DSG-06 | Agent platform owner | Chat/Spec/repair transport、retry、无降级与日志 sentinel 证据 |
| DSG-07 | Architecture/Platform owner | 基线 commit/设计 SHA/依赖/环境复核及全部子门 evidence digest 汇总 |

DSG-01 至 DSG-07 是唯一 blocking 子门集合。Actions 中的“每个 limit”是各相关子门的横向测试要求，不形成第八个未命名子门。

### 7.5 Owns

- docs/vite-multipage-agent-design-system-catalog-gate-00-evidence.md
- tests/fixtures/catalog/ds-gate-00-baseline.json
- tests/fixtures/validation/resource-envelope.v1.json
- tests/fixtures/validation/fatal-visual-cases.v1.json
- scripts/ds-gate-00/catalog-contract-probe.ts
- scripts/ds-gate-00/generation-finish-probe.ts
- scripts/ds-gate-00/validation-runner-probe.ts
- scripts/ds-gate-00/download-intent-probe.ts
- scripts/ds-gate-00/litellm-transport-probe.ts

### 7.6 Must not touch

- server/db/schema.ts 和任何 migration。
- server/index.ts、生产路由、ReleasePointer、Draft/Published 数据。
- package.json 与 package-lock.json。
- 真实业务数据库、用户 VMA_ASSET_ROOT、生产凭据。
- 当前 active Preview 或真实应用数据。

### 7.7 Actions

1. 证明当前 @json-render/shadcn 0.19.0 definitions 为 36 项，单次移除 Link 后精确为 35；验证 Link/Slot runtime ownership、built-in Action 获取方式和 overlay 可确定性。
2. 记录完整 Catalog JSON Schema 字节、实际 Prompt 字节/token、派生耗时、峰值 RSS、校验耗时、构建耗时，形成批准基线。
3. 批准 ValidationResourceEnvelopeV1 的八个数值：
   - jobTimeoutMs
   - workerTerminationGraceMs
   - workerMaxRssBytes
   - workerStdoutStderrBytes
   - workerTemporaryArtifactBytes
   - ipcReportBytes
   - validationSessionTtlSeconds
   - validationSessionMaxRequests
4. 固定 P0 fatal visual fixtures、桌面/移动视口、每路由覆盖和 fatal/non-fatal 阈值。
5. 用接近 2 MiB 的真实 AppUiBundle 穿过当前 CopilotKit/AG-UI、Vite/Hono proxy 和 Chromium；记录 UTF-8 长度、首事件/finish/apply 延迟、服务端 RSS、浏览器 heap、断流与 413 行为。
6. 在 Chromium 验证同步 click/submit 栈内预开 target、成功下载、popup 阻止、abort、重复消费、phase revoke、页面卸载、60 秒 URL 撤销和 10 MiB 前置拒绝。
7. 经单独授权验证 Chat gpt-5.6-terra/medium、Spec gpt-5.6-sol/high、repair xhigh、maxRetries:1 的真实 LiteLLM transport；故障注入同时验证无跨模型降级、响应开始后不重放和日志 sentinel 不泄漏。
8. 对每个 limit 执行 limit 成功、limit+1 fail closed；所有失败只产生稳定代码和有界诊断。

### 7.8 Expected outputs

- 一份带环境、命令、版本、原始摘要、批准值、owner 和日期的 evidence 文档。
- 两份版本化批准 JSON：Catalog/performance baseline 与 ValidationResourceEnvelopeV1。
- 一份 P0 fatal visual fixture 清单。
- 每个 probe 的可重复运行脚本和脱敏结果摘要。
- 明确的 pass、fail 或 unverified 状态；不得使用 partial 表示通过。

### 7.9 Verify

- 对 evidence 中的每个命令从干净临时目录重跑一次。
- 对每个批准 JSON 做 strict Schema 校验和 canonical digest。
- 人工核对日志、stdout/stderr、HTTP/AG-UI 错误中不存在 probe sentinel、headers、原始正文、stack。
- 核对 close-to-limit 与 limit+1 两组结果没有部分 Preview、部分报告、部分下载或草稿。

### 7.10 Done conditions

- DSG-01 至 DSG-07 全部为 pass，没有 unverified；汇总记录逐项包含 owner、evidence digest、环境版本与日期。
- 八个资源预算数值、fatal fixtures、2 MiB 上限、Catalog 基线均有 owner 批准。
- 真实 transport 已单独授权并通过；或设计被正式修订为不再阻断。
- evidence 明确写出后续步骤可使用的版本号和 digest。

### 7.11 Stop/escalate conditions

- definitions/bindings 无法在不引入第二份手写清单时闭合。
- overlay 需要执行 effect/default/coerce 才能导出或兼容旧 Spec。
- 2 MiB payload 出现截断、代理缓冲不可控或浏览器 heap 超预算。
- Chromium 无法可靠实现 DownloadIntent。
- worker 预算无法 fail closed，或 child process 不能被可靠终止。
- LiteLLM/Mastra 当前版本不支持固定 reasoningEffort、retry 或工具流。
- 任何 probe 需要真实凭据但未取得授权。

### 7.12 Handoff

Architecture owner 在 evidence 中填写 DS-GATE-00=pass、批准 digest 与各子门 owner。S1 开始时必须重新验证该 digest；不匹配则回到 Gate，不允许局部绕过。

## 8. 实施步骤

### S1：冻结单一 CatalogContract、AppUiBundle 与派生合同

- 依赖：DS-GATE-00 pass。
- Owner：Catalog/Contract owner。
- 文件：
  - 新增 src/catalog/catalog-contract.ts
  - 新增 src/catalog/component-contracts.ts
  - 新增 src/catalog/action-contracts.ts
  - 新增 src/catalog/overlays.ts
  - 新增 src/catalog/derive-catalog.ts
  - 新增 src/catalog/app-ui-bundle.ts
  - 新增 src/catalog/token-contract.ts
  - 新增 src/catalog/bundle-gates.ts
  - 新增 src/catalog/canonical-json.ts
  - 新增 server/application-candidate.ts
  - 新增 server/bundle/digests.ts
  - 新增 server/bundle/prompt-projection.ts
  - 修改 server/model-catalog.ts
  - 修改 server/benchmark/spec-benchmark-runtime.ts
  - 新增 tests/contract/catalog-contract.test.ts
  - 新增 tests/contract/catalog-overlay-compatibility.test.ts
  - 新增 tests/contract/app-ui-bundle.test.ts
  - 新增 tests/contract/canonical-digest.test.ts
- 动作：
  1. 在唯一组合边界从 shadcnComponentDefinitions 单次移除 Link，派生 35 个 base definitions；Slot/Link 不进入 additions 或 RendererBindings。
  2. 声明 P0 component additions、现有组件 overlay 和 10 个 customActions；built-in actions 只从 runtime schema 读取。
  3. 强制 customActions、Catalog actions 和未来 Adapter handler 键精确闭合；禁止碰撞、缺失和多余键。
  4. 把 AppUiBundle、DesignSystem、AssetManifest、Catalog 版本、只允许 /ui 的持久 state 和上限固化为 strict Zod 合同。
  5. 定义 ApplicationCandidate 根与模型可写 Patch 路径；migrationEdge 仍由服务端拥有。
  6. 用 canonical-json.ts 统一 candidateDigest、uiBundleDigest、requestHash 和报告 digest 的稳定序列化。
  7. Prompt 只消费压缩的派生能力摘要，不发送完整 catalog-aware JSON Schema。
  8. overlay 合并只允许机械扩宽；覆盖 legacy/preferred 双夹具。
- 验证：
  - npm run typecheck
  - npx vitest run tests/contract/catalog-contract.test.ts tests/contract/catalog-overlay-compatibility.test.ts tests/contract/app-ui-bundle.test.ts tests/contract/canonical-digest.test.ts
  - 静态搜索确认除 derive-catalog.ts 外没有第二次 Link 过滤或手写 base 清单。
  - server-side import graph 不包含 React、DOM、Vite 或 browser bindings。
- 完成标准：
  - definitions=35，runtime-owned=Link/Slot，RendererBindings 期望键可派生。
  - 10 custom Action 键精确闭合，四个 built-in 不进入 Adapter。
  - 任一 UI Bundle、BusinessSchema 权限或迁移变化都会改变 candidateDigest；只改 UI 才按预期改变 uiBundleDigest。
  - JSON 派生物和 Prompt 未超过 DS-GATE-00 基线预算。
- 停止条件：
  - 需要第二份 schema、第二次过滤或执行 Zod effect 才能派生。
  - 当前 v1 legacy fixture 不能通过机械扩宽。
  - server-safe 模块出现 browser dependency。
- 回退点：只删除本步骤新增的纯合同文件并恢复三个薄消费者；无数据库或外部状态。
- 覆盖 AC：AC1、AC2、AC4、AC4a、AC4b、AC4c、AC4d、AC4k、AC4j、AC10、AC13a、AC13b、AC18、AC19b、AC20。

### S2：一次性 additive 数据库结构与 Repository 骨架

- 依赖：DS-GATE-00、S1。
- Owner：Persistence/Release owner。
- 文件：
  - 修改 server/db/schema.ts
  - 新增 server/db/migrations/0005_0005_design_system_catalog.sql
  - 新增 server/db/migrations/meta/0005_snapshot.json
  - 修改 server/db/migrations/meta/_journal.json
  - 修改 server/persistence/migrations.ts
  - 新增 server/persistence/additive-migration-verifier.ts
  - 修改 server/repositories/release-repository.ts
  - 新增 server/repositories/preview-selection-repository.ts
  - 新增 server/repositories/generation-recovery-repository.ts
  - 新增 server/repositories/design-asset-repository.ts
  - 新增 server/repositories/business-action-idempotency-repository.ts
  - 新增 tests/integration/persistence/design-system-schema.test.ts
  - 新增 tests/integration/persistence/design-system-migration.test.ts
  - 新增 tests/integration/persistence/design-system-partial-ddl.test.ts
- 动作：
  1. 0005 先创建 schema_migration_steps 账本，以 (migrationId,stepId) 唯一并保存 definitionDigest/appliedAt；每个后续 additive DDL step 使用固定 stepId 和 definitionDigest。0005 SQL 的每个 step 先以 information_schema 和账本判断状态，再通过条件化 SQL 只执行缺失的已知 additive 子步骤。
  2. additive-migration-verifier.ts 保存 0005 的期望结构和 step digest，在调用 Drizzle 前做 preflight、返回后做 postflight：Drizzle journal 尚无 0005 时，完整结构但账本缺失可由 0005 SQL 只补账本，已知部分结构可续跑缺失子步骤；journal 已标记 0005 完成但 step ledger 或结构不完整时一律 fail closed，不重写迁移历史。未知列型、nullable、default、索引、约束或 digest 差异同样 fail closed。
  3. runStartupMigrations 固定执行 preflight→Drizzle migrate→postflight；任一 step 未完整、definitionDigest 错或 Drizzle journal/step ledger/information_schema 不一致时服务拒绝启动。
  4. GenerationRun 增加设计 §13.2 固定的 nullable candidateBundle/catalogVersion/validationIssues/fatalVisualIssues/publishBlocked/digest/validation/migration/brand snapshot 字段，并把状态限制为闭合集合；不新增 validation_failed 状态。
  5. DraftVersion/PublishedVersion 增加设计 §13.2 固定的 nullable Bundle、Catalog、digest、validation 和 migration edge 字段，保留旧非空 spec 作为兼容投影；复用 draft_versions_run 唯一索引。
  6. preview_selections 以 (appId,membershipId) 唯一；CHECK 保证 empty/published 不保存 versionId/revision，只有 draft 保存二者。
  7. generation_recovery_records 使用设计固定表名，以 (appId,failedGenerationId,failedCandidateDigest) 唯一，并建立 (status,decisionExpiresAt) 与 (appId,status,decisionExpiresAt) 索引。
  8. design_asset_blobs/design_asset_sources/design_asset_extractions 按设计 §5.4/§13.2 建立字段、外键、ready 不可变约束和 GC 可达性索引。
  9. design_asset_extraction_jobs 至少保存 jobId/appId/sourceId/sourceContentHash/extractorProfileVersion/status/leaseOwner/leaseExpiresAt/resultExtractionId/stableErrorCode/createdAt/startedAt/completedAt/revision；状态只允许 queued/running/succeeded/failed。queued/running 不得有 resultExtractionId，succeeded 必须有 resultExtractionId，failed 只能保存有界稳定错误码；表中不保存原始或结构化提取正文。
  10. business_action_idempotency 使用设计固定唯一键和字段；不保存 RecordView、CSV、表单输入或业务数据副本。
  11. Repository 只暴露条件状态推进、数据库时间、CAS、共享 transaction/UoW 和 bounded projection。
  12. 不挂 server/index.ts，不回填旧行，不切换读写路径。
- 验证：
  - npm run db:up
  - npm run db:migrate
  - npx vitest run tests/integration/persistence/design-system-schema.test.ts tests/integration/persistence/design-system-migration.test.ts tests/integration/persistence/design-system-partial-ddl.test.ts
  - 从 0004 数据库升级一次；再次运行迁移验证幂等；在每个固定 stepId 后注入进程终止并验证 journal 未完成时的已知部分续跑；伪造 journal 已完成但 step/结构不完整，以及篡改列型、nullable、索引、约束和 definitionDigest 均 fail closed。
  - 验证 generation_recovery_records 精确表名、PreviewSelection CHECK、ExtractionJob 状态/结果约束和全部必需索引。
- 完成标准：
  - 0004→0005 与空库→0005 都可复现。
  - 旧 spec、Draft、Published、ReleasePointer 行不删除、不改义。
  - 后续步骤无需再次修改 schema；若需要，必须先修订 S2 与迁移评审。
  - 0005 journal、schema_migration_steps 与 information_schema 三者一致。
- 停止条件：
  - 迁移需要 destructive DDL、表重建或无界锁表。
  - 旧行无法保留只读兼容。
  - CAS/数据库时间语义无法由当前 MySQL 8.4 实现。
  - 当前 Drizzle MySQL migrator 或 SQL statement splitter 无法按固定 stepId 安全执行 0005 的条件化 SQL；此时返回迁移设计评审，不绕过 preflight/postflight verifier，也不改用人工补表。
- 回退点：0005 是 forward-only expand，任何阶段都不反向删除或“回退到 0004”。未写入新协议数据时只回退应用 binary/读写路径并保留 0005；新协议写入后只回退到理解 Bundle 且维护 spec 投影的 compatibility release。additive DDL 本身损坏时停止服务并从经授权的 MySQL+VMA_ASSET_ROOT 联合备份恢复，不执行 down migration。
- 覆盖 AC：AC11a、AC11b、AC11d、AC19d、AC19e、AC19g、AC19h、AC21。

### S3：实现 RuntimeActionDispatcher、ExecutionGate 与 target lease

- 依赖：S1。
- Owner：NextAppRuntime owner。
- 文件：
  - 新增 packages/next-app-runtime/src/actions/contracts.ts
  - 新增 packages/next-app-runtime/src/actions/dispatcher.ts
  - 新增 packages/next-app-runtime/src/actions/execution-gate.ts
  - 新增 packages/next-app-runtime/src/actions/target-leases.ts
  - 修改 packages/next-app-runtime/src/contract/types.ts
  - 修改 packages/next-app-runtime/src/runtime/create-runtime.ts
  - 修改 packages/next-app-runtime/src/react/provider.tsx
  - 修改 packages/next-app-runtime/src/react/page-renderer.tsx
  - 修改 packages/next-app-runtime/src/index.ts
  - 新增 packages/next-app-runtime/tests/actions/dispatcher.test.ts
  - 新增 packages/next-app-runtime/tests/actions/target-leases.test.ts
  - 新增 packages/next-app-runtime/tests/actions/execution-gate.test.ts
- 动作：
  1. 保持 NextAppRuntime.applySource 的公开输入仍为 NextAppSpec。
  2. 把 custom Action 从 json-render 上游“handler resolve 即 onSuccess”路径分离，built-in 仍走上游。
  3. Dispatcher 每次生成 dispatchId；写操作的 idempotencyKey 由 Host 生成且 Spec 不可覆盖。
  4. 为 loading/result/error target 建立 lease，读操作 latest-wins，旧请求 abort，迟到/重复终态无写权限。
  5. success/error 静态 callback 至多执行一次，并在回调前重新通过 phase/lease Gate。
  6. phase 只允许 staging→unsaved→draft 单调推进；published 只能来自新 Runtime 构造。
  7. 复用 prototype-safe state store 的 batch update，把 loading/result/error 原子提交。
- 验证：
  - npm run build:runtime
  - npx vitest run packages/next-app-runtime/tests/actions
  - 故障注入 abort、迟到、重复 resolve/reject、revoked gate、callback 失败、target 被新 lease 占用。
  - 现有 runtime security/state tests 全部通过。
- 完成标准：
  - custom Action 只有 Dispatcher 一个执行边界和一个可消费终态。
  - built-in 没有进入 custom handler map。
  - revoked/迟到/重复终态不写 state、不清新 loading、不执行 callback。
- 停止条件：
  - 必须 fork @json-render 才能避免 custom onSuccess。
  - ActionProvider 无法保持 built-in 兼容。
  - Runtime state 原子 batch 会破坏现有 snapshot 合同。
- 回退点：恢复现有 raw handlers 路径；本步骤无数据库写入。
- 覆盖 AC：AC4d、AC6、AC8f、AC8g、AC8h、AC13b、AC22。

### S4：把现有 Apply 路径演进为唯一 BundlePreviewController

- 依赖：S1、S3。
- Owner：Browser Host owner。
- 文件：
  - 新增 src/runtime/bundle-preview-controller.ts
  - 新增 src/runtime/bundle-preview-store.ts
  - 新增 src/runtime/runtime-action-adapter.ts
  - 修改 src/runtime-apply-controller.tsx
  - 修改 src/preview-panel.tsx
  - 修改 src/release/published-preview-loader.tsx
  - 修改 src/app.tsx
  - 新增 tests/contract/bundle-preview-controller.test.ts
  - 新增 tests/browser/bundle-preview.spec.ts
- 动作：
  1. 保留一个 active Runtime/Preview；候选 Runtime 只在有界 staging 生命周期存在。
  2. finish 前浏览器不重建 Candidate；收到权威完整 Bundle 后核对 run、sequence、count 和 digest。
  3. 候选 Runtime 只调用一次 runtime.applySource(bundle.spec)，hidden smoke 不调用真实 Hono。
  4. Runtime、root、style、asset handle 全部 ready 后一次原子切换；任何失败销毁候选并保留旧 revision。
  5. committed 后执行现有 180ms 淡入；reduced-motion 时关闭。Preview Commit 响应不重复动画。
  6. Preview Route 保持内存导航，不改宿主 URL。
  7. staging、unsaved、draft、published gate 与 appId/candidateDigest/bundleRevision 绑定；dispose 即 revoke。
- 验证：
  - npx vitest run tests/contract/bundle-preview-controller.test.ts
  - npx playwright test tests/browser/bundle-preview.spec.ts --config playwright.mock.config.ts
  - 故障注入摘要错配、apply 失败、smoke 失败、swap 中断、dispose 后回调、旧 finish、重复 finish。
- 完成标准：
  - 页面从不观察到半套 Runtime/CSS/Assets。
  - 旧 revision 在任何候选失败时继续可用。
  - applySource 公共合同未扩展为 Bundle。
- 停止条件：
  - 原子切换要求同时长期维护两个交互 Renderer。
  - runtime disposal 无法撤销旧 Adapter/回调。
  - 实现引入第二个 Apply Controller 或新订阅协议。
- 回退点：恢复旧 RuntimeApplyController 与 PublishedPreviewLoader；未接 Preview Commit 前无持久化副作用。
- 覆盖 AC：AC14、AC15、AC16、AC18、AC19、AC22。

### S5：实现 P0 Catalog 组件、overlay 与 Registry 键闭合

- 依赖：S1；可与 S3 并行，接入 S4 时合并。
- Owner：Catalog/UI owner。
- 文件：
  - 新增 src/catalog/catalog-bindings.tsx
  - 新增 src/catalog/catalog.css
  - 新增 src/catalog/components/app-shell.tsx
  - 新增 src/catalog/components/navigation.tsx
  - 新增 src/catalog/components/data-display.tsx
  - 新增 src/catalog/components/forms.tsx
  - 新增 src/catalog/components/feedback.tsx
  - 新增 src/catalog/components/icons.tsx
  - 新增 src/catalog/components/legacy-overlays.tsx
  - 修改 src/runtime/catalog.tsx
  - 新增 tests/contract/catalog-bindings.test.ts
  - 新增 tests/browser/catalog-components.spec.ts
  - 新增 tests/fixtures/catalog/legacy-v1
  - 新增 tests/fixtures/catalog/p0-components
- 动作：
  1. 实现设计清单中的 App/navigation、Icon、Data、Feedback、Forms 组件。
  2. ToastViewport 只由 Host 内部装配，不进入 Catalog；BusinessAttachment/FileUpload 不实现。
  3. 升级 Table、Select、Accordion、Popover、Carousel、Button、Image，严格复用 S1 overlay。
  4. 每个 P0 组件补 Props、children/compound、Event、public style part、loading/empty/error 和可访问性夹具。
  5. Form 不接受模型 defaultValues；实现 hydration epoch、dirty CAS、AlertDialog 切换保护和确定性空值。
  6. DataTable 生命周期只发 requestData，不直接访问网络。
  7. Registry 实际键与 Catalog definitions 精确闭合；Link/Slot 只由 runtime 装配。
- 验证：
  - npm run typecheck
  - npx vitest run tests/contract/catalog-bindings.test.ts tests/contract/catalog-overlay-compatibility.test.ts
  - npx playwright test tests/browser/catalog-components.spec.ts --config playwright.mock.config.ts
  - 键盘、focus、ARIA、loading/empty/error、旧 v1 Spec 和 compound 非法结构夹具。
- 完成标准：
  - P0 组件清单全部有合同、实现和夹具。
  - 旧 v1 fixture 不经修改可渲染。
  - Link/Slot 无重复注册；unknown/missing binding 启动失败。
- 停止条件：
  - 组件必须直接 fetch 或持有业务事实。
  - overlay 破坏 legacy fixture。
  - portal 无法受 Host containment 控制。
- 回退点：移除 P0 additions 与 browser bindings，恢复现有 35+runtime-owned Catalog。
- 覆盖 AC：AC1、AC2、AC3、AC4a、AC4d、AC4k、AC5、AC6、AC8f、AC9、AC16、AC19b。

### S6：Token/CSS 编译、Preview containment 与资源句柄骨架

- 依赖：S4、S5。
- Owner：Browser Host/Design System owner。
- 文件：
  - 新增 src/runtime/token-compiler.ts
  - 新增 src/runtime/css-compiler.ts
  - 新增 src/runtime/asset-url-resolver.ts
  - 修改 src/runtime/bundle-preview-controller.ts
  - 修改 src/preview-panel.tsx
  - 修改 src/styles.css
  - 新增 tests/contract/token-css-gates.test.ts
  - 新增 tests/browser/design-system-isolation.spec.ts
  - 新增 tests/fixtures/bundles/css-escape
- 动作：
  1. 编译 primitive→semantic→component token，只接受 allowlist 值和无环引用。
  2. CSS selector 全部绑定带 revision 的 Preview root；keyframes、font-family 和自定义标识符命名空间化。
  3. 拒绝宿主选择器、固定宿主 overlay、未知 at-rule、外部 URL、脚本、危险 SVG 和 portal 逃逸。
  4. 为 Controller-private ResolvedAssetHandle 建立候选/active/dispose 生命周期；本步骤使用 fixture resolver，不接真实 BlobStore。
  5. 两个 Bundle 同屏/顺序切换时验证 Token/CSS/字体/资源不互相污染。
- 验证：
  - npx vitest run tests/contract/token-css-gates.test.ts
  - npx playwright test tests/browser/design-system-isolation.spec.ts --config playwright.mock.config.ts
  - 恶意 selector、keyframes、font、url、SVG、portal、悬空/循环 token、limit+1。
- 完成标准：
  - 任何 CSS/Token/G0 失败保留旧 Preview。
  - Host 聊天页与另一 Bundle 的可观察样式不变化。
  - 所有 handle 只存在 Controller 内存，未写入 state/Bundle/log。
- 停止条件：
  - CSS 重写不能覆盖设计定义的 selector/identifier 表面。
  - portal 仍可脱离 Preview root。
  - 资源失败会先污染 active revision。
- 回退点：关闭 Bundle designSystem 应用，保留旧固定样式；不改变持久 Bundle。
- 覆盖 AC：AC9、AC11、AC11f、AC12、AC13a、AC14、AC15、AC17。

### S7：DesignAsset Blob、Source、Extraction、读取与 GC

- 依赖：S2、S6。
- Owner：Asset Pipeline owner。
- 文件：
  - 新增 server/design-assets/contracts.ts
  - 新增 server/design-assets/blob-store.ts
  - 新增 server/design-assets/service.ts
  - 新增 server/design-assets/extraction.ts
  - 新增 server/design-assets/reconciliation.ts
  - 新增 server/design-assets/gc.ts
  - 新增 server/design-assets/read-resolver.ts
  - 修改 server/repositories/design-asset-repository.ts
  - 新增 server/routes/design-assets.ts
  - 修改 src/runtime/asset-url-resolver.ts
  - 修改 src/runtime/bundle-preview-controller.ts
  - 新增 tests/integration/persistence/design-assets.test.ts
  - 新增 tests/integration/persistence/design-asset-extraction-jobs.test.ts
  - 新增 tests/integration/persistence/design-asset-gc.test.ts
  - 新增 tests/browser/design-assets.spec.ts
  - 新增 tests/fixtures/design-assets
- 动作：
  1. 用 SHA-256 内容寻址写 VMA_ASSET_ROOT：临时文件→长度/hash/MIME 验证→原子 rename→ready 元数据。
  2. 实现 DesignAssetSource、独立 DesignAssetExtractionJob、immutable ready Extraction 和 strict DesignAssetStructuredSummaryV1；job 只按 queued→running→succeeded|failed 条件推进。
  3. worker 以有界租约 claim queued job；成功事务创建新 immutable Extraction、写 resultExtractionId 并以 Source CAS 切换 readyExtractionId。租约到期由 reconciliation 标记 failed/extraction_worker_lost，不自动重试；任何重新提取都创建新 jobId/extractionId。
  4. 执行 per-app source 20 项/100 MiB、单次 generation 8 refs、单份摘要 64 KiB、合计 256 KiB 等边界。
  5. GenerationRun 创建事务重验 app/Membership/source/hash/extraction，固定 brandSourceSnapshot 和 generationContextDigest。
  6. generation/draft/published GET/HEAD 读取面重新授权并核对 Manifest、元数据和 Blob hash；响应 private,no-store、nosniff、精确 MIME/ETag。
  7. generation→draft→published→rollback 每次重新 fetch/decode/load，原子替换 ResolvedAssetHandle。
  8. reconciliation/GC 以 source、queued/running job、成功但 Source CAS 未完成的 job、run、recovery、Draft/Published、回收站可达性为权威；数据库时间、双快照复核、每批有界。
- 验证：
  - npx vitest run tests/integration/persistence/design-assets.test.ts tests/integration/persistence/design-asset-extraction-jobs.test.ts tests/integration/persistence/design-asset-gc.test.ts
  - npx playwright test tests/browser/design-assets.spec.ts --config playwright.mock.config.ts
  - 故障注入根目录不可写、rename 前后崩溃、hash/MIME/length 错、缺 Blob、worker 租约到期、Extraction 创建与 Source CAS 之间崩溃、并发提取/GC、recovery successor、no-store 刷新。
  - 联合 MySQL+VMA_ASSET_ROOT 备份恢复演练需单独授权。
- 完成标准：
  - 不存在公开 hash/path 静态路由和持久派生 URL。
  - 原始 PDF/截图/OCR/路径不进入模型、Patch、AG-UI 或日志。
  - GC 不误删有效 source、非终态 run、恢复候选或历史有效版本资产。
  - job 表不保存提取正文；租约丢失不自动重试、不覆盖历史 ready Extraction。
- 停止条件：
  - 文件系统原子 rename/权限语义无法证明。
  - 备份恢复不能形成同一恢复点。
  - 读取授权会泄露资源存在性。
- 回退点：停止新上传/提取与 GC；保留 Blob/元数据只读，不删除任何资源。
- 覆盖 AC：AC8b、AC11、AC11a、AC11b、AC11c、AC11d、AC11e、AC11f、AC12、AC13a、AC21。

### S8：生成应用受控业务数据存储、共享 UoW 与 DownloadIntent

- 依赖：S2、S3、S5；服务端模块可在 S7 服务端模块旁并行，Browser Host 接线在 S7 的资源接线合并后进行。
- Owner：Business Action owner；Browser adapter 由 Browser Host owner 配合。
- 文件：
  - 新增 server/actions/contracts.ts
  - 新增 server/actions/unit-of-work.ts
  - 新增 server/actions/executor.ts
  - 新增 server/actions/csv-export.ts
  - 新增 server/draft-data-view/service.ts
  - 新增 server/routes/runtime-actions.ts
  - 修改 server/repositories/business-data-repository.ts
  - 修改 server/business-data/service.ts
  - 修改 server/data-query/compiler.ts
  - 修改 src/runtime/runtime-action-adapter.ts
  - 新增 src/runtime/download-intent.ts
  - 修改 src/runtime/bundle-preview-controller.ts
  - 修改 src/app.tsx
  - 新增 tests/contract/runtime-action-contract.test.ts
  - 新增 tests/integration/persistence/business-actions.test.ts
  - 新增 tests/integration/persistence/draft-data-view.test.ts
  - 新增 tests/integration/persistence/business-data-uow-regression.test.ts
  - 新增 tests/integration/persistence/recycle-bin-uow-regression.test.ts
  - 新增 tests/browser/runtime-actions.spec.ts
  - 新增 tests/browser/download-export.spec.ts
- 动作：
  1. POST /apps/:appId/runtime-actions/dispatch 只信 path appId 和服务端 Session/Membership；body 不接受身份、角色或替代 appId。
  2. published 请求由 Host 附加 X-VMA-Published-Version；事务内锁 ReleasePointer 后核对。
  3. 写命令固定锁序 ReleasePointer→ledger→record；Repository 增加接收传入 UoW 的 transaction-aware primitives，既有 public 方法保留为开启自身 transaction 的兼容 wrapper，供 /data 与 RecycleBinService 继续使用；executor 只能调用 UoW primitives，禁止嵌套事务。
  4. 幂等账本与业务 mutation/resultRef 在同一事务完成；重放前重新鉴权。
  5. submitForm 只解析为一个 create/update opcode，不递归 dispatch、不生成第二 key/lease/transaction。
  6. DraftDataView 先做当前/候选 Schema 最严策略交集，再编译 bounded query；draft 的写入/导出稳定拒绝。
  7. 实现 Form hydration epoch、recordKey/lease/dirty CAS 与冲突返回。
  8. CSV 严格执行公式中和、RFC 4180、10,000 行、完整 UTF-8 10 MiB、正文前 413。
  9. DownloadIntent 只在真实同步 click/submit 栈创建单次 Host handle 和同源空白 target；异步完成后一次消费。
- 验证：
  - npx vitest run tests/contract/runtime-action-contract.test.ts tests/integration/persistence/business-actions.test.ts tests/integration/persistence/draft-data-view.test.ts tests/integration/persistence/business-data-uow-regression.test.ts tests/integration/persistence/recycle-bin-uow-regression.test.ts tests/integration/persistence/repositories.test.ts
  - npx playwright test tests/browser/runtime-actions.spec.ts tests/browser/download-export.spec.ts --config playwright.mock.config.ts
  - 故障注入 appId/role/record 篡改、expectedRevision 冲突、相同 key/hash 并发、错 hash、提交前崩溃、提交后丢响应、权限/版本变化、迟到 load。
  - CSV 覆盖直接前缀、Unicode 空白/控制前缀、已有 apostrophe、普通文本、逗号、双引号、多行、limit+1。
- 完成标准：
  - 10 个 customActions 都经唯一 Dispatcher；没有组件或 Spec 直连网络。
  - 写入没有自动重试、双 mutation、孤立 pending 或嵌套事务。
  - draft 只读；unsaved/staging 不发 Hono 业务请求。
  - 既有 /data CRUD、记录软删除/恢复、唯一值冲突和回收站清理行为保持不变。
  - Blob、URL、导出正文不进入 Runtime state、Bundle、ActionResult、模型或日志。
- 停止条件：
  - BusinessData Repository 不能接受共享 transaction。
  - current ReleasePointer 无法在授权/Schema/mutation 同一事务快照核对。
  - DS-GATE-00 Chromium DownloadIntent 子门未通过。
- 回退点：禁止 Catalog customActions 并卸载新 dispatch 路由；保留既有 /data 路由服务 legacy 客户端。
- 覆盖 AC：AC6、AC7、AC8、AC8c、AC8f、AC8g、AC8h、AC8i、AC8j、AC13b、AC21、AC22。

### S9：P0 Validation Scheduler、独立 worker 与 __validation 页面

- 依赖：DS-GATE-00 资源预算批准、S2、S4、S5、S6。
- Owner：Validation Platform owner。
- 文件：
  - 新增 server/validation/profile.ts
  - 新增 server/validation/resource-envelope.ts
  - 新增 server/validation/session.ts
  - 新增 server/validation/scheduler.ts
  - 新增 server/validation/worker-protocol.ts
  - 新增 server/validation/worker.ts
  - 新增 server/validation/service.ts
  - 新增 __validation/index.html
  - 新增 src/validation/main.tsx
  - 新增 src/validation/validation-app.tsx
  - 修改 vite.config.ts
  - 新增 tests/contract/validation-profile.test.ts
  - 新增 tests/integration/persistence/validation-scheduler.test.ts
  - 新增 tests/browser/validation-runner.spec.ts
  - 新增 tests/fixtures/validation
- 动作：
  1. P0 profile 覆盖全部静态路由、每个动态路由至少一个 staticParams、桌面/移动默认态；case 总数≤512。
  2. Vite 多页入口 /__validation 使用独立 HTML 与 main.tsx，不导入或挂载 BrowserShell、主 App、聊天和正常 Preview；页面只接受短期单次 capability。
  3. Scheduler 全局 1 active/4 waiting；第 5 个 waiting 在启动浏览器前失败。
  4. worker 作为独立子进程运行，按批准的 ValidationResourceEnvelopeV1 限制 timeout、grace、RSS、输出、临时文件、IPC、session TTL/request。
  5. 报告绑定 candidateDigest/profileVersion，G1-fatal、G1 和 G2 分离；任何检查不得改 Candidate。
  6. worker crash/timeout/restart 只形成 failed/validation_failed，不形成部分报告、finish、草稿或 recovery；只有完整报告里的 fatal issue 才允许 recovery_pending。
- 验证：
  - npx vitest run tests/contract/validation-profile.test.ts tests/integration/persistence/validation-scheduler.test.ts
  - npx playwright test tests/browser/validation-runner.spec.ts --config playwright.mock.config.ts
  - 八项资源预算逐项 limit/limit+1；capability 过期/重复/越权；worker kill、父进程重启、错 digest/profile、缺 case。
- 完成标准：
  - 全部报告完整、不可变、digest 匹配。
  - 资源失败稳定终止 worker，释放队列名额和 capability。
  - Candidate 在 G1-fatal/G1/G2 前后 digest 相同。
- 停止条件：
  - DS-GATE-00 未批准资源数值。
  - worker 无法可靠收集 RSS/终止或 IPC 可被绕过。
  - __validation 会挂载正常应用或可调用真实业务 Action。
- 回退点：Validation production route 和 Preview Commit 保持关闭；静态 G0 仍可单独测试但不能宣称完整生成成功。
- 覆盖 AC：AC13、AC13c、AC13d、AC13e、AC14a、AC19a、AC20、AC21。

### S10：先建立受控 Mastra Runtime 与 LiteLLM 单一路径

- 依赖：DS-GATE-00、S1；在 S11 之前完成，可与 S7/S8 并行。
- Owner：Agent Platform owner。
- 文件：
  - 新增 server/agent-runtime.ts
  - 新增 server/model-policy.ts
  - 修改 server/mastra-agent.ts
  - 修改 server/copilotkit-runtime.ts
  - 修改 server/benchmark/spec-benchmark-model-options.ts
  - 修改 server/benchmark/spec-model-benchmark.ts
  - 修改 server/benchmark/spec-benchmark-runtime.ts
  - 修改 package.json
  - 修改 package-lock.json
  - 新增 tests/contract/agent-runtime-policy.test.ts
  - 新增 tests/integration/mastra-runtime.test.ts
- 动作：
  1. 用 @mastra/core 的 OpenAICompatibleConfig 统一 Chat、Spec、repair、benchmark 到 LiteLLM。
  2. 生产固定 Chat=gpt-5.6-terra/medium、Spec=gpt-5.6-sol/high、repair=xhigh；客户端模型/provider/endpoint/reasoning/retry 字段不参与选择。
  3. 建立 logger:false 的受控 Runtime 工厂；静态 Chat Agent 常驻，动态 Spec/benchmark 使用唯一 registry key 并在完整流终态后注销。
  4. maxRetries:1 只放 Agent 构造器顶层；响应/Patch 开始后不重放，不跨模型降级。
  5. benchmark CLI 允许受控候选模型/推理强度，但不能修改生产策略。
  6. 移除直接 @ai-sdk/openai、@ai-sdk/anthropic、createOpenAI/createAnthropic；不创建自定义 MastraModelGateway。
  7. 错误和日志只输出 allowlist ID/稳定码，过滤 system/user/tool、headers、upstream body 和 stack。
- 验证：
  - npm install 后 npm ls 核对唯一依赖树
  - npm run typecheck
  - npx vitest run tests/contract/agent-runtime-policy.test.ts tests/integration/mastra-runtime.test.ts
  - 静态搜索确认源码/直接依赖无被禁 API。
  - 真实 Chat/Spec/retry/log probe 只有在单独授权后运行；未运行时 S10 不完成。
- 完成标准：
  - 生产与 benchmark 都经过 Mastra+LiteLLM。
  - 并发动态 Agent 终态后 registry 回到静态集合。
  - sentinel 不出现在 stdout/stderr、应用日志、HTTP/AG-UI 错误。
- 停止条件：
  - 当前 Mastra 版本无法表达固定 reasoningEffort/retry/tool stream。
  - 需要自定义 gateway 或保留直接 AI SDK 才能工作。
  - 真实 probe 未授权或未通过。
- 回退点：在生成 v2 接入前可恢复当前 direct provider；接入后不得形成双 transport，回退必须整体恢复 compatibility release。
- 覆盖 AC：AC4e、AC4f、AC4g、AC4h、AC4i、AC21、AC22。

### S11：生成 v2、ApplicationCandidate、权威 finish 与 Preview Commit

- 依赖：S1、S2、S4、S7、S9、S10。
- Owner：Generation/Release owner。
- 文件：
  - 修改 server/prompt.ts
  - 修改 server/generate-spec-tool.ts
  - 修改 server/mastra-agent.ts
  - 修改 server/generation-coordinator.ts
  - 修改 server/coordinated-mastra-agent.ts
  - 修改 server/contracts.ts
  - 修改 server/generation/lifecycle.ts
  - 修改 server/repositories/release-repository.ts
  - 修改 server/release/service.ts
  - 修改 server/routes/generation.ts
  - 新增 server/routes/preview-selection.ts
  - 修改 src/runtime-apply-controller.tsx
  - 修改 src/runtime/bundle-preview-controller.ts
  - 新增 tests/contract/bundle-prompt.test.ts
  - 新增 tests/contract/generation-protocol-v2.test.ts
  - 新增 tests/integration/persistence/preview-commit.test.ts
  - 新增 tests/browser/generation-v2.spec.ts
- 动作：
  1. generate_spec 内部 Patch 根升级为 ApplicationCandidate；浏览器只接收连续有界 delta，不重建 Candidate。
  2. 服务端私有 base 由 PreviewSelection/baseRef 解析，不信任聊天或浏览器回传 current Bundle/Schema。
  3. 生成时固定 brandSourceSnapshot、migration anchor、Catalog/Prompt/extractor/validation profile 和 generationContextDigest。
  4. G0/BusinessSchema/Migration/Visual 完整通过后才发送一次 v2 finish：operationCount、candidateDigest、uiBundleDigest、reportDigest、权威 AppUiBundle≤批准上限。
  5. 删除 await_apply_result 协议；浏览器只回传 strict PreviewResult。
  6. Preview Commit 同一事务校验 run/digest/report/result，幂等创建一个 DraftVersion、完成 GenerationRun、更新发起者 PreviewSelection。
  7. G1 普通问题保存 publishBlocked；G1-fatal 不创建草稿。
  8. published 选择只保存哨兵，不保存历史版本 id；viewer 永远解析 ReleasePointer。
- 验证：
  - npx vitest run tests/contract/bundle-prompt.test.ts tests/contract/generation-protocol-v2.test.ts tests/integration/persistence/preview-commit.test.ts
  - npx playwright test tests/browser/generation-v2.spec.ts --config playwright.mock.config.ts
  - 近 2 MiB、超限、断流、operation gap、摘要错、浏览器伪造 Bundle/issues、重复/迟到 PreviewResult、G1/G1-fatal。
- 完成标准：
  - 浏览器没有 Candidate 重建逻辑。
  - finish 前不 apply，不创建 Draft。
  - 相同 generationId+digests 只创建一个 Draft 并返回同一结果。
  - Preview Commit 与 Agent interrupt/resume 完全解耦。
- 停止条件：
  - 当前 AG-UI/CopilotKit 不能可靠传权威 finish。
  - 2 MiB Gate evidence 不再匹配当前依赖/代理。
  - Candidate/Bundle/report digest 不能在事务中绑定。
- 回退点：关闭 v2 generation mutation，compatibility release 只读旧 Spec；不得同时允许旧 await_apply_result 与新 Preview Commit 写入。
- 覆盖 AC：AC4b、AC4c、AC5、AC10、AC13c、AC13d、AC14、AC14a、AC18、AC19、AC19a、AC19c、AC19d、AC19e、AC20、AC21、AC22。

### S12：闭合 GenerationRun 状态机与显式 fatal recovery

- 依赖：S2、S9、S11。
- Owner：Generation/Recovery owner。
- 文件：
  - 修改 server/generation/lifecycle.ts
  - 修改 server/generation-coordinator.ts
  - 修改 server/coordinated-mastra-agent.ts
  - 修改 server/routes/generation.ts
  - 修改 server/repositories/generation-recovery-repository.ts
  - 修改 server/repositories/release-repository.ts
  - 新增 server/generation/recovery-coordinator.ts
  - 新增 server/generation/recovery-expiry-maintenance.ts
  - 新增 tests/integration/persistence/generation-state-machine.test.ts
  - 新增 tests/integration/persistence/recovery.test.ts
  - 新增 tests/contract/recovery-command.test.ts
- 动作：
  1. 状态精确闭合为 running、validation_running、awaiting_preview、recovery_pending、recovery_consumed、succeeded、failed、incomplete。
  2. 短时开放只含 running/validation_running/awaiting_preview；90 秒扫描不碰 recovery_pending。
  3. 完整 fatal 报告事务性创建 RecoveryRecord 并进入 recovery_pending；容量第 6 个直接 failed/recovery_capacity_exceeded。
  4. 每个 pending 只消费一次 repair_candidate、regenerate_quality 或 keep_current；repair 创建新的 successor run、模型 xhigh 且最多一次。
  5. Hono 删除客户端 __vma*，只接受 strict forwardedProps.__vmaRecoveryCommand，Coordinator 在 inner Agent 前消费并剥离。
  6. RecoveryExpiryMaintenance 在启动、每 15 分钟、每批≤100，以及 GET/创建/决定/GC 前复用数据库时间 CAS；30 天过期。
  7. GET 只恢复投影，不启动模型；断开/失败/取消不重放已消费决定。
- 验证：
  - npx vitest run tests/integration/persistence/generation-state-machine.test.ts tests/integration/persistence/recovery.test.ts tests/contract/recovery-command.test.ts
  - 故障注入第 6 个 pending、过期边界、多实例 CAS、决定/expiry 竞争、successor 创建崩溃、断开、重复命令、自由消息/模型 sentinel。
- 完成标准：
  - 非法状态边不存在；终态不可恢复。
  - 原 run 决定与 successor 绑定可证明幂等。
  - recovery 状态与 GC 保护使用数据库时间，不依赖陈旧内存状态。
- 停止条件：
  - recovery 与 successor 不能原子或可证明幂等绑定。
  - 客户端字段无法在模型调用前完全剥离。
  - GET 或重连会隐式启动模型。
- 回退点：关闭 recovery command，只允许 keep_current/expiry 管理既有 pending；不把 pending 误扫为 incomplete。
- 覆盖 AC：AC13c、AC19f、AC19h、AC20、AC21、AC22。

### S13：发布/回滚、兼容回填、路由组合与单写切换

- 依赖：S2、S7、S8、S11、S12。
- Owner：Release/Composition owner。
- 文件：
  - 修改 server/repositories/release-repository.ts
  - 修改 server/release/service.ts
  - 新增 server/persistence/protocol-mode.ts
  - 修改 server/routes/generation.ts
  - 修改 server/routes/runtime-actions.ts
  - 修改 server/routes/releases.ts
  - 修改 server/schema-migrations/service.ts
  - 修改 server/index.ts
  - 新增 src/runtime/protocol-mode.ts
  - 修改 src/app.tsx
  - 修改 src/release/published-preview-loader.tsx
  - 新增 scripts/backfill-app-ui-bundles.ts
  - 新增 tests/contract/protocol-mode.test.ts
  - 新增 tests/integration/persistence/protocol-mode-mutations.test.ts
  - 新增 tests/integration/persistence/bundle-backfill.test.ts
  - 新增 tests/integration/persistence/release-bundle.test.ts
  - 新增 tests/integration/persistence/bundle-migration.test.ts
  - 新增 tests/browser/protocol-mode-compatibility.spec.ts
  - 新增 tests/browser/release-bundle.spec.ts
- 动作：
  1. server/index.ts 一次性组合 S7-S12 的 Repository、service、route、scheduler 和 maintenance；启动失败必须 fail closed。
  2. protocol-mode.ts 只保留 v2（默认）与 readonly_recovery 两种状态；所有宿主 mutation 显式声明 protocolVersion:2，readonly_recovery 仅允许受权读取与导出。
  3. 服务端 bootstrap 返回 protocolMode、serverProtocolVersion 与 compatibilityDigest；浏览器只在 mode/version/digest 匹配时启用对应消费者，错配显示稳定不可变错误并保持最后有效 Preview，不做猜测降级。
  4. scripts/backfill-app-ui-bundles.ts 每批≤100，重复扫描 bundle IS NULL 行，按 row revision CAS 写默认 AppUiBundle 与旧 spec 一致性摘要；冲突行留待下一批，任一 Catalog 校验失败停止。首次部署前完成最终零缺口扫描，不持有全表锁。
  5. 新写 Repository 只接受 Bundle，并在同一事务派生旧 spec 投影；两者不一致 fail closed。历史 spec-only 行仅由离线回填处理，不接受新的 legacy 输入，也不能伪造 migration edge。
  6. Draft/Published 保存 catalogVersion、Bundle、Schema、validation/publishBlocked、migrationEdge/plan。
  7. 新 Bundle 发布不接受客户端迁移覆盖；锁 ReleasePointer，核对 from version/schema/to schema，stale base 无 DDL/数据/指针变化。
  8. 跨 Schema 回滚只允许直接前驱并使用当前版本 reversePlan；多跳逐跳显式确认。
  9. publish/rollback 均重新 bootstrap 新 published Runtime、Catalog、Schema、Assets，不原地提升旧 Adapter。
  10. PublishedViewer 永远使用 ReleasePointer；owner/editor 恢复 PreviewSelection。
- 验证：
  - npx vitest run tests/contract/protocol-mode.test.ts tests/integration/persistence/protocol-mode-mutations.test.ts tests/integration/persistence/bundle-backfill.test.ts tests/integration/persistence/release-bundle.test.ts tests/integration/persistence/bundle-migration.test.ts
  - npx playwright test tests/browser/protocol-mode-compatibility.spec.ts tests/browser/release-bundle.spec.ts --config playwright.mock.config.ts
  - v2 写请求、缺失或未知 protocolVersion、readonly_recovery 写请求逐一验证；不存在隐式协议降级。
  - 未执行/完整/已知部分 migration、并发回填 CAS、最终零缺口、未知 drift、stale base、直接前驱/多跳、投影不一致、发布/回滚资源失败、viewer 篡改。
- 完成标准：
  - 旧 v1 Published fixture 全部由当前 v1 Renderer 渲染。
  - Catalog 2.x 发布在多 Renderer 前稳定拒绝。
  - 新写入后 spec-only binary 只读，所有 mutation fail closed。
  - 启动迁移、maintenance 和路由无重复 owner。
  - protocol mode 默认 v2；没有配置时进入 v2，浏览器/服务端版本错配时 fail closed。
- 停止条件：
  - 任一旧 Spec 无法确定性回填。
  - 新/旧投影可能独立更新。
  - stale migration anchor 仍可能执行 DDL。
  - 任一 mutation 路由无法由同一 protocol mode fence 覆盖。
- 回退点：切回 compatibility release；不删新列、Bundle 或 Asset。联合备份恢复按单独授权执行。
- 覆盖 AC：AC10、AC11b、AC11c、AC11f、AC13、AC13b、AC18、AC19、AC19a、AC19b、AC19d、AC19e、AC19g、AC21、AC22。

### S14：全链路 Mock 验收、性能门禁与失败恢复

- 依赖：S1-S13 全部完成。
- Owner：Integration/Quality owner。
- 文件：
  - 修改 vitest.config.ts
  - 修改 playwright.mock.config.ts
  - 新增 tests/browser/p0-crud-generated-app.spec.ts
  - 新增 tests/browser/p0-failure-recovery.spec.ts
  - 新增 tests/contract/ac-design-system-catalog-coverage.test.ts
  - 新增 tests/fixtures/bundles/p0-crud
  - 新增 docs/vite-multipage-agent-design-system-catalog-test-evidence.md
- 动作：
  1. 用 Mock Agent 生成并运行一个包含 AppShell、导航、DataTable、CRUD 表单、详情、空/错态、Toast 的多页面应用。
  2. 覆盖 generation→validation→finish→staging→unsaved→Preview Commit→draft→publish→rollback。
  3. 串联 Action 权限、revision 冲突、idempotency、form hydration、DraftDataView、CSV、资源重新 fetch 和发布版本 header。
  4. 对所有 limit 执行 limit/limit+1；对所有异步边界注入 abort、迟到、重复、重启和断流。
  5. 重新采集 Catalog Schema/Prompt/派生/校验/build/RSS 指标；相对批准基线增长>25% 或单一 JSON>64 MiB 失败。
  6. 把 AC1 至 AC22 含所有字母后缀映射到自动测试或明确的 P1 封存检查。
- 验证：
  - npm run typecheck
  - npm run test
  - npm run build
  - npm run test:browser:mock
  - 文档证据逐项记录命令、版本、结果、未验证项；Mock 不宣称真实 LLM transport。
- 完成标准：
  - 所有 P0 AC 有可重复证据；无 skipped blocking test。
  - 全链路失败后可立即开始下一次普通问答或新 generation。
  - 无 pending interrupt、隐式 retry、已消费 recovery 重放或渲染循环。
- 停止条件：
  - 任一 blocking AC 只有人工推断、Mock 或组件测试而缺少相应层级证据。
  - 性能基线漂移超过阈值。
  - 浏览器测试需要真实 LLM 才能稳定。
- 回退点：不进入 S15；保持新路径禁用，修复对应 owner 步骤。
- 覆盖 AC：所有 P0 AC；重点 AC5、AC8j、AC14a、AC22。

### S15：封存 P1 边界并形成切换负向门禁

- 依赖：S1、S5、S7、S9、S14。
- Owner：Architecture owner。
- 文件：
  - 新增 tests/contract/deferred-capabilities.test.ts
  - 修改 docs/vite-multipage-agent-design-system-catalog-test-evidence.md
- 动作：
  1. 断言 uploadAttachment、BusinessAttachment、asset/assets 业务字段未进入 P0 Catalog、Prompt、Action、Bundle 或路由。
  2. 断言完整 focus/open/loading/empty/error 质量矩阵未被伪装成 P0 报告。
  3. 断言独立 Preview Origin、Bridge、Capability 未建立半实现路径。
  4. 断言 DesignAsset 读取仍为 Session route，不声称 asset capability。
  5. 为未来扩展保留现有 candidateDigest、ValidationReport、PreviewResult、Dispatcher 合同，不创建第二套协议。
- 验证：
  - npx vitest run tests/contract/deferred-capabilities.test.ts
  - 静态搜索不存在 uploadAttachment、BusinessAttachment public route、Preview Bridge 或 capability token 生产接线。
- 完成标准：
  - P1 能力在用户/模型/浏览器可见面均不可发现、不可调用。
  - 文档证据明确标记 deferred，而不是 pass。
  - deferred-capabilities.test.ts 是 S16 切换的 blocking preflight，不允许 skip。
- 停止条件：
  - P0 实现无意暴露任何 P1 键、路由或模型提示。
- 回退点：移除误暴露表面；不把 P1 纳入本期。
- 覆盖 AC：AC8a、AC8b、AC8d、AC8e、AC13f、AC17a、AC18a。

### S16：v2 首次部署与恢复演练

- 依赖：S15；首次部署和 MySQL+VMA_ASSET_ROOT 备份恢复须获得单独授权。
- Owner：Release/Operations owner。
- 动作：
  1. 固化 preflight：DS-GATE-00 digest、S15 negative gate、迁移 journal/step ledger、Catalog digest、Blob root 可写和资源一致性。
  2. 以默认 v2 部署浏览器和服务端；bootstrap 的 mode/version/digest 必须完全一致，所有宿主 mutation 显式携带 protocolVersion:2。
  3. 执行生成、Preview Commit、受控业务数据写入、发布、直接前驱回滚和资源重新 bootstrap 验证。
  4. 验证缺失、旧版或未知 protocolVersion 均 fail closed；进入 readonly_recovery 后全部 mutation 返回稳定 423 错误。
  5. 执行 MySQL+VMA_ASSET_ROOT 联合恢复演练并重新验证 migration ledger、Bundle/spec 投影和 Blob hash。
- 完成标准：
  - 首次部署前 S15 负向门禁、Bundle 缺口、投影错配和 Blob 健康全部通过。
  - 服务端与浏览器均以 v2 运行，且没有隐式协议降级。
  - 联合恢复演练不会丢 MySQL 或 Asset root 数据，也不会允许 spec-only 写入。
- 停止条件：
  - S15 任一负向检查失败或被 skip。
  - 联合恢复点不一致，或任一写入可在 readonly_recovery 中绕过门禁。
- 回退点：只进入 readonly_recovery 以保护事实数据；任何恢复不执行 destructive cleanup/down migration。
- 覆盖 AC：AC11b、AC19e、AC19g、AC21、AC22。
- 执行证据（2026-08-20）：`scripts/s16-v2-first-deployment-rehearsal.mjs --confirm` 在两套随机隔离 schema 与 OS 临时资产目录中执行。29 项 Mock 浏览器验收通过；恢复库以完整 `SHOW CREATE TABLE` DDL 与数据克隆后重新通过迁移 preflight/postflight，源/恢复逐表计数一致，Draft/Published Bundle 均无 NULL，1 个 ready Blob SHA-256/长度一致；两套 schema 与目录均已清理。该演练不触碰默认开发库，不构成真实生产部署。

## 9. 合并增量与每增量验收

| 增量 | 包含步骤 | 合并前最低验证 | 禁止混入 |
| --- | --- | --- | --- |
| I1 Foundation | DS-GATE-00、S1、S2 | Gate evidence、合同测试、0004→0005/空库迁移 | UI 组件、真实路由接线、新 mutation |
| I2 Runtime/Catalog | S3、S4、S5、S6 | runtime tests、Catalog/browser component、原子切换、CSS 隔离 | Asset 生产路由、业务写入、生成 v2 |
| I3 Platform flow | S7、S8、S9、S10、S11、S12、S13 | 资源/受控业务存储/Validation/Agent/Generation/Recovery/Release 分层测试 | 切换授权、destructive cleanup、P1 |
| I4 Acceptance/Cutover | S14、S15、S16 | 全 Mock suite、性能、恢复与切换 runbook | 真实发布、commit/push、P1 实现 |

每个增量的 commit/push 仍需用户单独授权。计划不规定分支或 PR 操作。

## 10. AC 完整覆盖矩阵

| AC | 主步骤 | 证据类型 |
| --- | --- | --- |
| AC1、AC2、AC3 | S1、S5 | 合同、键闭合、组件/旧夹具浏览器 |
| AC4、AC4a、AC4b、AC4c、AC4d、AC4k、AC4j | S1、S5、S11、S14 | Schema/Prompt/digest/overlay/performance |
| AC4e、AC4f、AC4g、AC4h、AC4i | DS-GATE-00、S10 | 受控策略测试与单独授权的真实 transport probe |
| AC5、AC6 | S5、S8、S14 | 完整生成应用与生命周期浏览器测试 |
| AC7、AC8 | S8 | 授权、revision、篡改和并发集成测试 |
| AC8a、AC8b、AC8d、AC8e | S7、S15 | 域隔离；P1 不可发现/不可调用 |
| AC8c、AC8f、AC8g、AC8h、AC8i、AC8j | S3、S5、S8、S14 | DraftDataView、Form、Dispatcher、UoW、CSV/Chromium |
| AC9、AC10 | S6、S11、S13 | 双 Bundle 隔离、不可变 Draft/Published |
| AC11、AC11a、AC11b、AC11c、AC11d、AC11e、AC11f | S6、S7、S13、S16 | 资源边界、读取授权、GC、恢复和原子句柄 |
| AC12 | S6、S7 | CSS/SVG/外链/脚本恶意夹具 |
| AC13、AC13a、AC13b、AC13c、AC13d、AC13e | S1、S6、S9、S11、S13 | G0/G1/G2、worker、digest、不持久化 runtime data |
| AC13f | S15 | 明确 deferred；未建立第二 Runner |
| AC14、AC14a、AC15、AC16 | DS-GATE-00、S4、S11、S14 | finish、2 MiB、原子切换、动效、内存导航 |
| AC17 | S6、S14 | CSS/root/portal 隔离浏览器夹具 |
| AC17a | S15 | 独立 Origin 明确 deferred |
| AC18 | S1、S4、S11、S13 | revision/digest/PreviewResult fail closed |
| AC18a | S15 | Asset Capability 明确 deferred |
| AC19、AC19a、AC19b、AC19c、AC19d、AC19e | S2、S4、S11、S13 | Commit、发布阻断、v1 兼容、幂等、选择、迁移边 |
| AC19f、AC19h | S12 | strict recovery、CAS、DB time、容量/到期 |
| AC19g | S2、S13、S16 | additive migration、部分续跑、兼容回退 |
| AC20 | S1、S9、S11、S12 | 有界脱敏错误 |
| AC21 | S7、S8、S9、S10、S11、S12、S16 | 因果 ID 与日志 sentinel |
| AC22 | S3、S4、S11、S12、S14、S16 | 失败后新 run、无 interrupt/retry/loop |

覆盖规则：

- P0 AC 必须至少有一个与其风险层级一致的自动化或运行证据。
- P1 AC 的通过含义仅为“本期未暴露且边界未污染”，不是功能已实现。
- Mock 浏览器证据不能替代 AC4g 的真实 LiteLLM transport，也不能替代 S16 的备份恢复演练。

## 11. 横向风险、故障注入与回退

| 风险 | 最早检测步骤 | 必须注入的故障 | 回退 |
| --- | --- | --- | --- |
| Catalog 双真相或 Link 重复 | DS-GATE-00/S1 | 键缺失、多余、双 binding、第二过滤 | 恢复当前 35+runtime-owned 组合 |
| overlay 破坏旧 Spec | S1/S5 | required/default/effect、旧 children/event/style/token | 移除 overlay，旧 v1 fixture 继续 |
| 候选污染 active Preview | S4/S6/S7 | apply/smoke/resource/decode/swap 任一点失败 | 销毁 candidate，保留旧 revision |
| custom Action 多终态/迟到写 | S3/S8 | abort、迟到、重复 resolve、revoked lease | 禁用 customActions |
| 权限/版本绕过 | S8 | appId/role/header/record 篡改、ReleasePointer 移动 | 卸载 dispatch 路由 |
| 重复业务 mutation | S8 | 并发 key、提交前崩溃、提交后丢响应、错 hash | 停写，保留 ledger 审计 |
| CSV 注入/部分下载 | DS-GATE-00/S8 | 公式前缀、limit+1、popup/abort/重复消费 | 不上线 downloadExport |
| Blob/DB 不一致 | S7/S16 | rename 崩溃、缺 Blob、错 hash、恢复点不一 | 停写/停 GC，只读保留 |
| Extraction job 成为第二事实或隐式重试 | S2/S7 | 租约到期、Source CAS 前崩溃、重复显式提取 | job 终态失败、保留 Source/Extraction、禁止自动重试 |
| GC 误删恢复资产 | S7/S12 | pending/consumed successor、并发 source、跨快照 | 关闭 GC |
| worker 泄漏/部分报告 | DS-GATE-00/S9 | timeout、OOM、stdout/IPC/temp 超限、父重启 | 关闭 Runner/Commit |
| finish 截断或伪造 | DS-GATE-00/S11 | 2 MiB、断流、digest/count/sequence 错 | 关闭 v2 mutation |
| 恢复重放/隐式模型调用 | S12 | 重复决定、GET、重连、expiry 竞争 | 关闭 repair/regenerate |
| 迁移 drift/回退写入 | S2/S13/S16 | 已知部分、未知差异、spec-only mutation | compatibility 只读 |
| 协议版本或浏览器版本错配 | S13/S16 | 缺失/旧/未知 protocolVersion、readonly_recovery 绕过 | 拒绝 mutation，保持事实数据只读 |
| P1 半实现表面随 P0 上线 | S15/S16 | Action/Prompt/route/capability 静态与运行探针 | 阻断切换并移除误暴露表面 |
| 模型策略被客户端覆盖 | DS-GATE-00/S10 | provider/model/reasoning/retry 注入 | 停真实 transport |
| 敏感内容泄漏日志 | DS-GATE-00/S10 | system/user/tool/header/body/stack sentinel | fail closed，禁止上线 |

## 12. 计划完成、实施完成与上线完成的区别

### 12.1 本计划文档完成

- 文件落点、单写者、依赖图、Gate、验收、故障注入和回退均完整。
- AC1 至 AC22 以及 AC4k、所有字母后缀均有主步骤。
- P0/P1 边界无混淆。
- 不代表 DS-GATE-00 已执行或实施已授权。

### 12.2 实施完成

- S1 至 S15 完成，所有 P0 AC 和 P1 不可暴露负向门禁有证据。
- S10 的真实 transport probe 已单独授权并通过。
- 不代表已切换 compatibility release 或执行真实发布。

### 12.3 可上线

- S16 已单独授权并完成。
- MySQL+VMA_ASSET_ROOT 联合恢复、回退 binary 只读、回填和资源健康均通过。
- 项目所有者显式批准上线；commit/push/deploy 仍是独立生命周期动作。

## 13. 剩余假设与开工前检查

1. src/catalog 可以作为 server-safe 纯合同目录；若 import graph 失败，先修订设计决定共享包位置，不在实施中临时分叉。
2. 当前 MySQL 8.4 能支持所需条件更新、锁序、数据库时间和 additive DDL；由 S2 实测。
3. 当前 Drizzle MySQL migrator 能在 0005 的 statement breakpoint 下执行带固定 stepId 的条件化 SQL；S2 必须分别从空库、0004、每个已知部分 DDL 状态验证。若不成立，停止 S2 并返回迁移设计，不绕过 verifier。
4. Playwright 1.61.1 能支持 worker/Chromium DownloadIntent probe；由 DS-GATE-00 实测。
5. @mastra/core 1.51.0 的 OpenAICompatibleConfig、reasoningEffort 和动态 registry 行为以真实 probe 为准。
6. 0005 必须一次容纳设计所需字段/表；后续发现遗漏先回到 S2，不连续追加补丁迁移掩盖计划缺口。
7. 现有 180ms Preview 淡入保留；不新增第二动画状态机。
8. P0 不实现任意网络、任意代码、业务附件、独立 Origin 或完整质量矩阵。

开工检查：

- 重新读取 AGENTS.md。
- git status 明确区分用户现有修改；不覆盖设计文档工作树变更。
- 核对 HEAD、设计 SHA、0004 journal 和 package-lock 依赖。
- 获得“按本计划实施”授权。
- 执行且通过 DS-GATE-00。
- 为 I1 创建窄范围任务，不同时打开共享单写者文件。
