# 实施计划：控制台与独立 Published Runtime 的功能发布闭环

- 状态：待计划评审；本文件只定义本地功能实现，不授权代码、迁移、依赖、部署、提交或推送。
- 计划日期：2026-08-21
- 基线提交：`e91576a`
- 工作树说明：制定计划时已有与本计划无关的修改；实施者不得覆盖或纳入这些修改。
- 设计输入：`docs/vite-multipage-agent-design-system-catalog-design.md`（SHA-256 `4369c293775501deaf42d0adbe3a9e8f9e1855c59a07f45a78027f61404adbd0`）、用户确认的“方案 A”。

## 1. 已确认范围与决策锁

### 1.1 目标

在本地完成功能闭环，而非部署闭环：控制台创建/生成/验收候选，显式发布后，终端用户从**独立 Published Runtime** 登录并使用当前 PublishedVersion；后续更新和回滚在控制台与 Runtime 之间保持一致。

### 1.2 已确认的行为

1. 控制台、作者 Preview、Published Runtime 是三个不同浏览器应用面。
2. Published Runtime 采用方案 A：用户在 Runtime 自行登录；该会话为 Runtime Origin 专属，不能复用控制台 Cookie 或通过无感登录转移。
3. Runtime 只读取当前 ReleasePointer 指向的 PublishedVersion，绝不读取 Draft、Generation 或管理面。
4. 已发布应用的业务数据继续由既有 MySQL、BusinessSchema、成员资格和服务端 Action Executor 作为唯一事实；浏览器 Runtime state、iframe 消息和 SSE 不是业务事实。
5. Preview 迁到独立 Origin 并通过 sandbox iframe 嵌入控制台；它不持有控制台会话，不能直接调用控制台管理 API。
6. 本计划不包含生产部署、域名注册、外部邮件投递、外部 LLM、提交、推送或高级 P1 Catalog/附件能力。

### 1.3 兼容策略

采用 additive + dual-read 的功能迁移：

- 现有控制台 `vma_session`、`/api/auth/*`、`/api/apps/*` 管理路径保持语义不变。
- 新增 Runtime 专属 Cookie、带 audience 的服务端 Challenge/Session 和 `/api/runtime/*` 受限路径；旧的 `NULL` audience 只按 console 兼容读取，Runtime 一律拒绝，旧会话或旧路径不得被 Runtime 接受。
- Published Runtime 首版使用既有不可变 `PublishedVersion`、`AppUiBundle` 和 `appId` 作为解析标识；不引入 slug、公开 URL 策略或第二份 Bundle/业务数据事实。
- Preview 迁移期间只允许受短期测试开关保护的旧同页 Surface；切换完成后不得长期双栈渲染同一 Bundle。

## 2. Truth 与 Ownership

| Truth | Owner | 非事实面 |
| --- | --- | --- |
| 当前可运行版本 | `ReleasePointer` + `PublishedVersion` / `MysqlReleaseRepository` | 控制台选择、Runtime 缓存、iframe 消息 |
| 用户、成员资格、角色、会话 | `users` / `memberships` / `sessions` 与 AuthService | 前端登录状态 |
| 业务数据与权限 | `BusinessDataRepository`、BusinessSchema、TransactionalBusinessActionExecutor | Runtime store、ActionResult |
| 作者候选、草稿与发布操作 | GenerationRun、DraftVersion、ReleaseService | Chat、SSE、Preview UI |
| Preview/Runtime 当前渲染状态 | 各自 BundlePreviewController | 不得反写上述持久事实 |
| 资源读取授权 | Runtime DesignAsset Read Resolver；F4 Preview Asset Capability | Blob URL、Asset handle |

## 3. 功能验收追溯

| AC | 验收条件 | 增量 |
| --- | --- | --- |
| AC1 | 控制台与 Published Runtime 可同时打开，运行时没有 Chat/草稿/发布管理 UI。 | F1、F2 |
| AC2 | Runtime 用户独立登录，Runtime Cookie 不能被控制台读取/使用，反之亦然。 | F1 |
| AC3 | Runtime 仅加载当前 PublishedVersion；无发布版本、错误 appId 与非成员均 fail-closed。 | F2 |
| AC4 | Runtime 中的受控业务 Action 按当前已发布 Schema 和成员角色执行，不能访问 Draft 或其他应用数据。 | F3 |
| AC5 | 控制台 Preview 由 sandbox iframe 承载，不能访问控制台 Cookie、管理 API 或任意网络。 | F4 |
| AC6 | 发布、二次发布、直接前驱回滚以及跨 Schema 反向迁移后，Runtime 在 G0 确认的版本可见性触发点与 ReleasePointer 一致。 | F5 |
| AC7 | 坏 Bundle、版本摘要不匹配、权限/会话/Bridge/资源失败均保留最后有效版本或稳定拒绝。 | F2–F5 |

## 4. 开工 Gate（GATE-00）

### G0：本地三 Origin 与 Runtime 会话合同

- goal：锁定 Runtime 专属登录、同机多 Origin 开发拓扑与受限 API 合同。
- prerequisites：本计划、既有 AuthService/Session/CSRF 合同、Preview Origin 设计 §12。
- owner：产品/架构决策者；实施 owner 为 Auth + Runtime 单一负责人。
- owns：本地 host/port 常量、Cookie 名、`sessionAudience` 枚举、Runtime API 前缀、Origin allowlist、iframe `targetOrigin`、Runtime/console Magic Link 返回地址。
- must_not_touch：现有控制台 Cookie 语义、成员/业务数据真相、现有 `/api/apps/*` 管理路由、生产部署配置。
- actions：
  1. 固定本地控制台、Runtime、Preview 三个 hostname/port；hostname 必须不同，端口不同不能替代 hostname 不同。
  2. 固定 `console | runtime` 两种 Challenge/Session audience；Runtime OTP / magic-link 只消费 runtime Challenge，并只签发 runtime audience 的独立 Session。
  3. 固定 Runtime 只使用 `appId` 路由解析，首版不增加 slug。
  4. 产品 owner 在两种版本可见性中明确选择其一：Runtime 仅在首次加载/用户显式刷新解析 ReleasePointer，或 Runtime 必须自动发现 Pointer 更新；若选择自动发现，必须同时确认轮询/推送机制、延迟上界和离线失败显示。无此决定，F2/F5 不得编码版本更新 UX；无论选择何者，服务端 Action 始终核对版本头与当前 Pointer。
- expected_outputs：版本化 Origin/Cookie/API/Bridge 常量表和相应 Zod 合同。
- verify：浏览器 cookie/origin 探针、Auth route/challenge audience contract test、CSRF allowlist test。
- done_conditions：AC2 的 Cookie 与 API 边界可由自动化测试表达；G0 输出经计划评审确认。
- stop_escalate_conditions：若需要共享 Domain Cookie、跨 audience 消费 Challenge、隐式 token 转移、Runtime 匿名访问、slug/自定义域策略或 Preview 直接调用业务 mutation，停止 F1–F5 并返回架构设计。
- handoff：G0 确认后，F1 的 Auth/路由 writer 开始；其他增量不得先行修改 session、Vite host 或 API 前缀。

## 5. 并行规划

```text
[parallelism:
- independent lanes: F5 的验收夹具和测试矩阵可在 F3/F4 合同稳定后准备；其余核心步骤串行。
- sequential blockers: G0 -> F1 -> F2 -> F3 -> F4 -> F5。
- shared write surfaces: server/index.ts、server/middleware/session.ts、server/auth/*、Vite 配置、package.json、BundlePreviewController/RuntimeActionAdapter、Playwright 配置和迁移账本均为单一 writer。
- delegation: 0；上述 shared surfaces 和认证/运行时状态机强耦合，不拆分并行写入。
]
```

## 6. 五个功能增量

### F1：Runtime 独立登录与本地入口

- 依赖：G0 关闭。
- 落地文件/模块：
  - `server/db/schema.ts`、`server/db/migrations/0007_*`、`server/db/migrations/meta/0007_snapshot.json`、`server/db/migrations/meta/_journal.json`、`server/persistence/migrations.ts`、`server/persistence/additive-migration-verifier.ts`、迁移测试；
  - `server/auth/service.ts`、`server/repositories/auth-repository.ts`、`server/contracts.ts`、`server/middleware/session.ts`、`server/routes/auth.ts`、`server/index.ts`；
  - 新建 Runtime Vite root/配置、Runtime `index.html`、`src/published-runtime/main.tsx`、`src/published-runtime/runtime-app.tsx`、Runtime 专属 session client；
  - `vite.config.ts`、`package.json`、认证 contract/browser 测试。
- 操作要点：
  1. 对 `auth_challenges` 与 `sessions` 同时增加受控 `audience`（console/runtime）。0007 只做 additive nullable 列和可重复 backfill：既有 `NULL` 行仅作为 console 兼容行读取，Runtime 必须拒绝 `NULL`；新 Challenge/Session 一律显式写 audience。
  2. 将 Auth route、Challenge 创建/消费、Session 签发/解析和 session middleware 参数化为 Cookie 名 + expected audience；控制台继续 `vma_session`，Runtime 使用不同 Cookie 名，二者不得互认。
  3. Runtime OTP / Magic Link 只创建 runtime Challenge；verify 必须核对 Challenge audience 后才消费。Magic Link 返回 URL 从 audience→Origin 固定映射生成，禁止继续使用当前硬编码的控制台 `127.0.0.1:3100/login/verify`。
  4. 新建独立 Runtime Vite root，不通过控制台 `src/app.tsx` 或 BrowserShell 挂载；复用 OTP/magic-link 凭据校验逻辑，但 Runtime 登录只创建 runtime Session。
  5. 在本地以不同 hostname 运行控制台、Runtime 和 Preview；Vite proxy 保持 Runtime 的同源 `/api` 调用，以便 Runtime Cookie 不跨 Origin 泄漏。
- verify：
  - 0007 migration journal/ledger verifier、空库/0006/部分状态验证，以及 `migration-drill.test.ts` 回归；
  - AuthService、route 和 CSRF contract tests：同一用户可有两个独立 Session；Runtime 不能消费 console Challenge 或 Magic Link，反之亦然；错误 Cookie/audience 为 401；控制台登出不删除 Runtime Session，反之亦然；
  - 浏览器：Runtime 未登录进入登录页，完成 Runtime 登录后仅 Runtime Origin 获得 Cookie。
- 覆盖：AC1、AC2、AC7。
- stop/escalate：任何方案要求把 `Domain` 扩到共享子域、从 URL 读取 Session token 或让 Runtime 接受控制台 Cookie 时停止。

### F2：Published Runtime 只读启动与当前版本解析

- 依赖：F1。
- 落地文件/模块：
  - 新建 `server/routes/published-runtime.ts`（或同等独立受限 route tree）、`server/index.ts`；
  - `server/repositories/release-repository.ts`、必要的 read-only repository 接口；
  - `src/published-runtime/bootstrap-client.ts`、`published-app.tsx`、`published-runtime-shell.tsx`；
  - 复用但参数化 `src/runtime/bundle-preview-controller.ts`、`src/runtime/preview-navigation.ts`、`packages/next-app-runtime` React provider；
  - 只读 Runtime route/browser/integration tests。
- 操作要点：
  1. `GET /api/runtime/apps/:appId/bootstrap` 在 runtime audience、active Membership 和 app status 下读取 ReleasePointer + 当前 PublishedVersion；不复用返回 Draft 的控制台加载器。
  2. 返回最小 bootstrap：已发布版本 ID、Bundle/spec 兼容投影、已发布 BusinessSchema/Catalog 版本以及受控资源描述；不返回 Draft、GenerationRun、validation 正文、成员管理信息或发布历史。
  3. Runtime 将 bootstrap 以 `phase: published` 交给独立 BundlePreviewController；摘要、Catalog、Bundle 或版本状态不合法时不渲染候选，保留最后有效 Runtime。
  4. Runtime 路由使用现有 `appId`；无发布版本为受控空态，错误/非成员/删除应用使用不可枚举的拒绝。Runtime 在 G0 确认的版本可见性触发点重新读取 ReleasePointer，不以 URL/localStorage 推断版本事实。
- verify：
  - repository/route tests：当前指针、无指针、历史版本、跨 app、viewer/editor/owner、非成员、删除状态；
  - 浏览器：控制台草稿修改后 Runtime 不变化；发布后的 Runtime 更新行为符合 G0 确认的可见性合同；Runtime 页面无管理组件。
- 覆盖：AC1、AC3、AC7。
- stop/escalate：若 bootstrap 需要返回 Draft、Session 跨 audience、或引用浏览器 URL/localStorage 作为发布事实，停止并回到 truth 设计。

### F3：Published Runtime 的业务 Action 与受控资源

- 依赖：F2。
- 落地文件/模块：
  - `server/routes/runtime-actions.ts`、`server/routes/business-data.ts`、`server/actions/executor.ts`、`server/business-data/*`、`server/design-assets/read-resolver.ts`、`server/routes/design-assets.ts`、`server/index.ts`；
  - `src/runtime/runtime-action-adapter.ts`、`src/runtime/asset-url-resolver.ts`、新建 Runtime action/resource client；
  - `tests/contract/runtime-action-contract.test.ts`、业务 Action/资源 integration tests、Runtime browser tests。
- 操作要点：
  1. 把 Runtime API 与控制台管理 API 分开挂载；Runtime Action 仅接受 runtime audience，会话解析后仍通过既有 Membership、BusinessSchema、Action policy、ReleasePointer 和版本头授权。
  2. 复用 TransactionalBusinessActionExecutor，禁止在 Runtime 创建旁路 CRUD、旁路鉴权或第二数据存储；DraftDataView 永不暴露到 Runtime。
  3. 将 Adapter 的 API base/受信 Origin 参数化；UI action 在 Runtime 本地执行，数据 action 和 export 只能走 Runtime 受限端点。
  4. 已发布 Bundle 的资源读取只由 Runtime 受权 resolver 解析；拒绝 Draft/其他 app/错误版本/错误 asset。Preview Capability 不在本增量提前实现。
- verify：
  - action executor regression：版本头不匹配、发布版本已变更、viewer 写入、非成员、跨 app、Schema 变更和幂等重放均稳定拒绝；
  - browser：成员 CRUD 成功、viewer 只读、Runtime 不可访问 DraftDataView；资源在当前 published binding 下可加载。
- 覆盖：AC4、AC7。
- stop/escalate：若 action 需要将角色、appId、session 或任意 URL 交给 Bundle 控制，停止；这些必须由服务端路径/会话决定。

### F4：作者 Preview iframe 与受限 Bridge

- 依赖：F1–F3 的 Runtime/Action 合同稳定。
- 落地文件/模块：
  - 新建 Preview Vite root/配置和 `src/preview-runtime/*`；
  - `src/preview-panel.tsx`、`src/runtime/bundle-preview-controller.ts`、`src/runtime/runtime-action-adapter.ts`；
  - 新建共享 Bridge contract（Zod schema、版本、message types）、独立 Preview listener/route tree、Preview bootstrap、`server/design-assets/read-resolver.ts`、新的 Preview Asset Capability issuer/验证器、`server/index.ts`；
  - `server/validation/service.ts`、`server/validation/worker-protocol.ts`、`src/validation/*`；
  - CSS isolation、Bridge、Preview 浏览器/安全探针配置与测试。
- 操作要点：
  1. 控制台 PreviewPanel 仅管理 iframe 生命周期、地址栏 UI 和 Bridge；NextAppRenderer 移到 Preview Runtime，不再在控制台 DOM 渲染。
  2. iframe 固定 sandbox，精确校验 `targetOrigin/event.origin/event.source`、protocolVersion、sessionNonce、appId、bundleRevision、requestId 和有界 Zod payload。
  3. Preview 以独立 listener 下发 `default-src 'none'` 为基线的 CSP、HostOnly 无 Cookie 响应和只读 route tree；不挂载登录/生成/发布/成员/业务 mutation 路由，也不得用 Vite proxy/CORS 绕过这些边界。
  4. 实现短时 Preview Asset Capability：由控制台受权后绑定 appId、bundleRevision、candidateDigest、sessionNonce 与 assetId allowlist；Preview 仅可 GET/HEAD 当前 Bundle 资源。
  5. Host 通过版本化 `asset-binding` Bridge 消息只交付 `assetId → 派生 GET URL` 的有界映射；原始签发 capability/manifest 不进入 Bundle、普通 Bridge payload、日志或持久事实。派生 URL 只存于 Preview Controller 私有 handle，切换/失效后立即撤销，不能传递或复用控制台 Blob URL。
  6. Preview 只能消费 Host 发送的受验证 Bundle 与受限 UI/导航结果；资源一律经上述 capability 获取。
  7. 保持现有 Preview execution gate：staging/draft 阶段不能执行真实业务写入；不得借 Bridge 绕过该门禁。
  8. Validation Runner 改为对 Preview Origin 的受控 validation entry 运行，继续使用现有 ValidationSession，不建立第二套 commit 或验证语义。
- verify：
  - Bridge schema/负向 tests：错 origin/source/nonce/revision、重放和超限 payload，以及过期 asset-binding 拒绝；
  - 浏览器安全探针：Preview 无控制台 Cookie、CSP 拒绝非能力网络请求、Capability 过期/错 bundle/错 asset 拒绝、不能访问管理 API、不能 top-navigation/form/download 任意逃逸；
  - 回归：生成、验证、Preview Commit、导航、坏补丁保留旧版本。
- 覆盖：AC5、AC7。
- stop/escalate：若需要 `allow-popups`、`allow-top-navigation`、共享 Cookie 或允许 iframe 直连业务 mutation，停止；这改变已确认安全模型。

### F5：发布/更新/回滚贯通与三应用验收

- 依赖：F2–F4。
- 落地文件/模块：
  - `server/repositories/release-repository.ts`、`server/release/service.ts`、`server/routes/releases.ts`、`server/routes/preview-selection.ts`；
  - `src/release/release-panel.tsx`、`src/release/published-preview-loader.tsx`、`src/published-runtime/bootstrap-client.ts`；
  - `tests/integration/persistence/preview-commit.test.ts`、`bundle-migration.test.ts`、`release-bundle.test.ts`、`tests/browser/persistence.spec.ts`、新建 Runtime/iframe 功能验收套件。
- 操作要点：
  1. 确保 GenerationRun 的 migration edge、migration plans/reverse plans 在 Preview Commit 时完整复制到 DraftVersion，并由 PublishedVersion 保留；浏览器永不提交这些字段。
  2. 发布、二次发布和直接前驱回滚后，控制台 published 视图与独立 Runtime 按 G0 确认的版本可见性合同解析同一 Pointer。
  3. UI-only 回滚只移动 Pointer；跨 Schema 回滚只使用当前版本服务端封存且验证过的 reverse plan；失败保持旧 Pointer/Runtime。
  4. 增加三应用场景：控制台创建成员与应用、Runtime 独立登录、发布 V1、Runtime CRUD、生成 V2、发布、Runtime 刷新、回滚、Runtime 刷新；并覆盖坏 Bundle、坏迁移、会话失效和 Preview Bridge 拒绝。
- verify：
  - 聚焦 migration/preview commit/release repository tests；
  - Mock 浏览器 E2E 覆盖三 Origin；
  - 手工本地验收仅在单独授权真实 LLM 后执行，默认 Mock 不调用真实模型。
- 覆盖：AC1–AC7。
- stop/escalate：回滚不能证明 Runtime Bundle、Pointer、BusinessSchema 与业务数据一致时，禁止宣称功能可发布；先修复前驱/迁移事务边界。

## 7. 风险、回滚与恢复边界

| 风险 | 步骤 | 缓解 | 回滚/恢复 |
| --- | --- | --- | --- |
| 控制台 Challenge/Session 被 Runtime 接受，或反向消费 | F1 | Challenge/Session audience + 独立 Cookie + expected audience middleware + audience return URL | 关闭 Runtime route/entry；既有 `NULL` 行只继续按 console 兼容读取 |
| 迁移部分完成 | F1 | additive migration、ledger/verifier、空库/既有库/部分状态测试 | 停止服务并从联合备份恢复；不执行未经验证的 down migration |
| Runtime 看到 Draft 或历史版本 | F2 | 专属 bootstrap route 只经 ReleasePointer | 禁用 Runtime bootstrap；旧控制台发布事实不变 |
| Action 越权或版本漂移写入 | F3/F5 | membership + schema + pointer + version header 在同一服务器路径核对 | 关闭 Runtime action route；数据以现有事务/幂等账本审计和恢复 |
| iframe Bridge 或资源读取逃逸 | F4 | strict schema/origin/source/nonce + sandbox/CSP + 短时 Asset Capability | 关闭新 Preview entry 与 Capability issuer；短期恢复旧 Preview 仅用于诊断，修复后移除双栈 |
| 发布/回滚与 Runtime 不一致 | F5 | 直接前驱 edge、正反迁移验证、三应用 E2E | 保持上一个有效 Pointer；跨 Schema 仅使用已验证 reverse plan，否则进入 readonly recovery |

## 8. 覆盖检查

- AC1 → F1/F2/F5 → 独立入口、无管理 UI、控制台与 Runtime 并行浏览器测试。
- AC2 → F1 → audience/Cookie/CSRF contract 与浏览器 cookie 探针。
- AC3 → F2 → ReleasePointer bootstrap repository/route/browser tests。
- AC4 → F3 → Action/role/schema/version integration 与 Runtime CRUD browser tests。
- AC5 → F4 → iframe/Bridge/CSP/Origin 负向探针。
- AC6 → F5 → Preview Commit → Draft → Published → Runtime 版本链、迁移与回滚 E2E。
- AC7 → F1–F5 → 全部 fail-closed 负向夹具与旧有效版本保留断言。

## 9. 授权边界与下一步

- 本计划的接受仅授权后续逐步骤评审，不自动授权生产代码、数据库迁移、依赖/脚本变更、真实 LLM、浏览器真实邮件、部署、提交或推送。
- 编码前先执行 G0，并由单一 owner 接管迁移/session/Vite/route 共享面；不得将 F1–F5 并行写入。
- 首次实施建议：先对本计划执行 `artifact-review-loop`（artifact_type: plan），关闭 G0 后才授权 F1。
