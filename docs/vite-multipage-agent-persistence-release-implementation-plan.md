# 实施计划：Vite Multipage Agent 持久化、发布与账号平台

- 状态：已审核；GATE-00 已关闭（存储决策修订为 MySQL 8.4 + Docker Compose，见《GATE-00 决策补充》），S1–S8 按序实施已获项目所有者授权
- 范围：仓库根目录（`vite-multipage-agent`）
- 设计来源：[持久化、发布与账号平台方案](./persistence-release-platform-design.md)
- 兼容策略：本地开发环境的受控迁移；不保留当前内存状态的兼容/双写路径。已有内存应用在首次升级后视为未保存内容，必须重新生成或创建。

## 来源与对齐

本计划落实已确认的 MySQL 8.4（本地开发经 Docker Compose）+ Drizzle、本地开发收件箱、邀请制账号、应用成员角色、显式发布/回滚、业务 Schema 迁移、30 天回收站和生成中断不恢复语义。

不做云部署、多数据库适配器、真实邮件投递、匿名访问、公开链接、JSON 导入、实时协作、自定义角色、离线 PWA 或中断生成重放。当前没有可约束本计划的已接受 ADR。

## 授权边界

- 本计划的接受仅授权后续按步骤评审实施；不自动授权代码、数据库迁移、依赖升级、真实邮件发送、部署、提交或推送。
- 任何真实邮箱投递、云数据库、部署、数据导入或不可逆数据清理，均须另行逐项授权。
- 数据库迁移、`package.json`/锁文件、`server/index.ts`、全局前端组合入口和共享测试配置各只能有一名实施者在同一变更中写入。

## Truth 与 Ownership

| 事实 | 唯一 owner | 非事实 surface |
| --- | --- | --- |
| 账号、邀请、会话、角色、创建资格 | `AuthRepository` / 成员服务 | Cookie、前端登录状态、开发收件箱 |
| 应用、草稿、发布指针、版本、生成运行 | `AppRepository` / 发布服务 | `GenerationCoordinator`、AG-UI 事件、预览 runtime |
| 聊天、问卷、计划、技术日志 | `WorkspaceRepository` | CopilotKit 当前 thread UI |
| Schema、数据访问策略、业务记录、查询/唯一投影、修订、回收站 | `BusinessDataRepository` | 草稿 `DraftDataView`、JSON 导出 |
| 可渲染预览 | 浏览器 `@next-app-runtime` runtime（服务端保存版本的投影） | 地址栏、Patch 缓冲、组件局部状态 |

现有 `GenerationCoordinator` 只保留为单次 AG-UI 流关联器；它不能再拥有问卷、计划、草稿或生成完成状态的唯一事实。

## 验收追溯

| ID | 验收条件 | 计划步骤 |
| --- | --- | --- |
| AC1 | 刷新页面或重启本地服务后，可恢复账号、会话、成员、应用、版本、工作数据和业务数据 | S1–S5b、S8 |
| AC2 | 未登录用户不能访问已发布应用、草稿或数据 API；角色矩阵生效 | S2、S3、S5a、S7 |
| AC3 | 生成或草稿不会自动发布；只有所有者可发布/回滚 | S3、S4、S7 |
| AC4 | 当前发布版本永不被剪枝；每应用最多保存十个成功版本 | S4、S8 |
| AC5 | 破坏性 Schema 变更无全量迁移验证不得发布 | S5b、S8 |
| AC6 | 并发写入返回 `409`，不静默覆盖 | S2、S5a、S8 |
| AC7 | 删除应用不可访问；30 天内授权恢复并原子恢复关联可见性 | S5b、S8 |
| AC8 | 断流、重启或 90 秒无心跳的生成标记 `incomplete`，不重放 | S3、S4、S8 |
| AC9 | 不同 Schema 的版本没有验证反向迁移即不可回滚 | S5b、S8 |
| AC10 | 本地收件箱可验收邀请、OTP 和魔法链接；非开发环境拒绝该投递器 | S2、S8 |
| AC11 | 只有浏览器预览提交成功才创建可发布草稿；失败候选不能发布 | S3、S4、S8 |
| AC12 | 非成员、无权记录或无权字段不能经读取、查询、分页游标或导出泄露；四种记录范围均由服务端执行 | S5a、S6、S7、S8 |
| AC13 | 应用/字段增加不增加 SQLite 物理索引定义；多字段 AND 查询走固定投影 | S5a、S8 |
| AC14 | `running`/`awaiting_preview` 在刷新、断流、重启或超时后变为 `incomplete`，迟到结果无效 | S3、S4、S8 |
| AC15 | 系统关系字段、固定脱敏、事务唯一投影和 30 天清理触发均满足受控契约 | S5a、S5b、S8 |
| AC16 | 记录、查询投影、principal、导出和迁移均执行已确认的资源上限，超限时不产生部分写入 | GATE-00、S5a、S5b、S8 |

## 开工 Gate

### GATE-00：认证、应用上下文与本地数据库依赖确认

- goal：在任何持久化代码或迁移落地前，固定可测试的会话安全边界、当前应用的服务端可信定位方式、业务数据资源上限，以及 Drizzle + MySQL 8.4（Docker Compose）的稳定版本组合。
- prerequisites：确认当前 Node 24 运行方式、Docker/Compose 可用性、现有包锁格式及本地浏览器同源代理行为。
- owner：项目所有者。
- owns：会话 Cookie 属性、会话失效/登出语义、CSRF 防护策略、用户在多个应用间选择/切换及刷新恢复的契约、数据库文件路径/备份策略、已验证的 Drizzle/Drizzle Kit 版本组合，以及单记录字节数、每集合记录量、每 Schema 可查询/唯一字段数、每记录 principal 数、导出批次/最大量、迁移批次/最大量和对应错误契约。
- must_not_touch：不创建生产账号、不发送真实邮件、不接入云服务、不迁移或删除真实用户数据。
- actions：以一次最小依赖探针验证 Drizzle 对 MySQL（mysql2 驱动）的迁移生成、事务与条件更新；确定开发环境的 HttpOnly 会话 Cookie、SameSite 策略和 API 防护；确定应用列表、选择和可信 `appId` 传递（包括刷新恢复及切换时未发布草稿的显示）；用代表性最小/边界/超限样本确定记录、投影、principal、导出与迁移资源上限及错误语义；记录为设计补充或 ADR。
- expected_outputs：依赖版本锁定、会话/CSRF 契约、应用上下文契约、开发数据库位置与清理规则、资源上限及错误契约、探针结果。
- verify：空库上执行建表、条件更新和事务回滚；浏览器跨站请求与同源登录/登出测试均有明确预期；刷新、切换应用和越权伪造 `appId` 均有明确预期；每项资源上限都有边界值、超限值和“无部分写入”的预期。
- done_conditions：所有输出经项目所有者确认；S1、S2、S3、S4、S5a、S5b、S6、S7、S8 才可开工。
- stop_escalate_conditions：Drizzle 不支持选定的 mysql2 路径、本地 Docker 不可用、Cookie 无法满足本地代理或测试要求、或需要新增未批准的认证/邮件依赖时停止并回到方案设计。
- handoff：确认的契约和版本作为 S1、S2 的唯一输入。
- outcome：已关闭并经项目所有者批准。全部已确认契约（依赖版本、会话/CSRF、appId、数据库生命周期、L1–L7 资源上限与错误契约）见《GATE-00 决策补充》（`docs/vite-multipage-agent-gate-00-decisions.md`）。探针证据：drizzle-orm@0.45.2 + drizzle-kit@0.31.10 + mysql2（均稳定版精确锁定）在 MySQL 8.4 上通过启动迁移（幂等）、事务回滚、条件更新 affectedRows 与 `utf8mb4_bin` collation 探针。

## 并行规划

```text
[parallelism:
- independent lanes: S6 前端工作台与 S7 服务端中间件可在 S5b 契约冻结后并行；S8 的测试用例可随各服务增量编写，但共享测试配置保持单一 writer。
- sequential blockers: GATE-00 -> S1 -> S2 -> S3 -> S4 -> S5a -> S5b -> (S6, S7) -> S8.
- shared write surfaces: package.json/lockfile、server/index.ts、server/contracts.ts、server/db/schema.ts、server/release/、src/app.tsx 和 Playwright 配置各有单一 writer；S4 与 S5b 的 server/release/ 由同一 owner 顺序修改。
- delegation: 当前不拆分 GATE-00 至 S5b；契约冻结后，S6 仅写前端工作台，S7 仅写服务端中间件与路由组合，可由不同执行者并行。
]
```

## 实施步骤

### S1：建立持久化基础设施与领域 Repository 边界

- 落地文件/模块：新增 `docker-compose.yml`、`server/persistence/`（连接、事务、迁移启动检查）、`server/repositories/`（`AuthRepository`、`AppRepository`、`WorkspaceRepository`、`BusinessDataRepository` 接口及 MySQL 实现）、`server/db/schema.ts`、`server/db/migrations/`；更新 `package.json`、锁文件、`server/index.ts`。
- 依赖：GATE-00 已关闭。
- 操作要点：以 Drizzle 和已验证的 mysql2 驱动建模平台表；每个可变聚合保存 revision；启动时执行或明确拒绝未完成的受管迁移。Repository 以事务 API 暴露，领域服务不得跨表直写。MySQL 经 docker-compose 本地运行（精确锁定镜像 tag、命名卷持久化）；唯一投影列使用 `utf8mb4_bin` collation；连接凭据只来自进程环境，不进入版本库。
- verify：迁移从空库可重复执行；Repository 单元测试覆盖事务回滚、`expectedRevision` 条件更新和重启后读回；`npm run typecheck`。
- stop_escalate_conditions：已确认的 Drizzle/mysql2 组合不能通过事务、条件更新或迁移探针时停止；不得在本步骤自行更换驱动或放宽事务边界。
- 覆盖：AC1、AC6。

### S2：实现邀请制认证、会话、成员与本地开发收件箱

- 落地文件/模块：新增 `server/auth/`（认证、Session、成员、邀请、创建资格、收件箱）、`server/routes/auth.ts`、`server/routes/apps-members.ts`、`src/auth/`；更新 `server/index.ts`、`server/contracts.ts`、`src/app.tsx`。
- 依赖：S1；GATE-00 的 Cookie/CSRF 契约。
- 操作要点：实现 `POST /auth/start`、`POST /auth/verify`、登出与当前会话查询，以及创建应用、应用列表和由 GATE-00 固化的当前应用上下文入口；未知邮箱仍返回通用接受结果但不投递凭据。仅邀请或 `ADMIN_EMAILS` 首次验证可建立身份。邀请码/认证令牌只保存摘要、原子单次消费。每次接受邀请创建新的 Membership ID；移除后重入不得复用旧 Membership。固定角色与创建资格在服务端校验；所有权转移未完成时拒绝管理员禁用所有者。开发投递器只把可测试邮件写进 SQLite 收件箱，非开发模式禁止启动。
- verify：认证/邀请/角色契约测试；OTP、魔法链接、过期、撤销、重复消费、未邀请邮箱及管理员转移前禁用的 API 测试；浏览器登录、登出与刷新恢复测试。
- stop_escalate_conditions：GATE-00 的 Cookie、CSRF 或应用上下文契约未冻结，或实现必须引入未批准的认证/邮件依赖时停止并回到 Gate。
- 覆盖：AC1、AC2、AC6、AC10。

### S3：把工作区和生成生命周期从内存迁入持久层

- 落地文件/模块：新增 `server/workspace/`、`server/generation/`；改造 `server/generation-coordinator.ts`、`server/coordinated-mastra-agent.ts`、`server/generate-spec-tool.ts`、`server/contracts.ts`；新增工作区/生成路由和测试。
- 依赖：S1、S2。
- 操作要点：按当前已授权 `appId` 持久化 `ChatThread`、消息、问卷、答案、`AppPlan`、日志、`GenerationRun` 和服务端累积的候选 Spec。候选在 Catalog/Spec 校验后进入 `awaiting_preview`，不是草稿。把 `questionSetId`、generation ID 和浏览器 `await_apply_result` 映射由持久层校验；`GenerationCoordinator` 仅转发当前 run 的 AG-UI CUSTOM 事件，不保存持久业务事实。浏览器在 `running` 和 `awaiting_preview` 期间每 30 秒更新心跳；断流、浏览器刷新、超过 90 秒或启动扫描发现这两种未完成状态时，事务性标记为 `incomplete`。不恢复 SSE、不重放工具、不恢复未完成 Patch，迟到结果拒绝。
- verify：服务重启后问卷/计划和已完成 GenerationRun 可读；人为中断流、刷新浏览器、伪造过期心跳和分别重启 `running`/`awaiting_preview` 进程后均产生 `incomplete`；陈旧、重复或错配 toolCallId/apply 结果仍 fail-closed。
- stop_escalate_conditions：持久 generation ID、toolCallId 与 apply 结果不能在不放宽 fail-closed 或重放未完成 run 的前提下可靠关联时停止。
- 覆盖：AC1、AC2、AC8、AC11、AC14。

### S4：实现草稿、发布、保留和回滚服务

- 落地文件/模块：新增 `server/release/`、`server/routes/releases.ts`；改造 `server/generate-spec-tool.ts`、`server/coordinated-mastra-agent.ts`、`src/runtime-apply-controller.tsx`、`src/generation-activity-card.tsx`、`src/preview-panel.tsx`。
- 依赖：S1、S2、S3。
- 操作要点：完整 Patch、Catalog/Spec 校验后只保存 `GenerationRun.awaiting_preview`。浏览器继续只在完整 Patch 到达后原子 `applySource`，不边流式渲染；匹配的 `await_apply_result=committed` 才事务性创建该 `appId` 的 `DraftVersion(ready)` 并把 run 转为 `succeeded`，`failed/aborted` 把 run 转为 `failed`、只保存有界诊断且不可发布。所有者的显式发布才创建不可变 `PublishedVersion` 并更新 `ReleasePointer`。没有当前发布版本时按固定空业务 Schema 比较，因此 S4 只允许首次发布空业务 Schema；首次非空业务 Schema 必须等待 S5b 的 Schema/迁移门禁完成。本步骤其他发布和回滚只允许候选 Schema 与当前已发布 Schema 相同；不同 Schema 一律拒绝。剪枝始终保留当前发布版本和最近九个其他版本。
- verify：生成成功但浏览器 apply 失败时不产生可发布草稿；只有 committed 草稿可发布；非所有者发布/回滚返回拒绝；第 11 个历史版本剪枝时当前版本仍可用；回滚后的预览以发布版本重新装载，不改浏览器宿主 URL。
- stop_escalate_conditions：浏览器 apply 结果不能被认证、幂等关联到唯一 run，或候选业务 Schema 超出 S4 的空/同 Schema 阶段边界时停止；不得提前实现迁移或直接移动发布指针。
- 覆盖：AC1、AC2、AC3、AC4、AC8、AC11、AC14。

### S5a：实现数据权限、CRUD 与固定查询投影

- 落地文件/模块：新增 `server/business-data/`、`server/data-access-policy/`、`server/data-query/`、`server/routes/business-data.ts`；扩展 `server/db/schema.ts`；新增相应契约/集成测试。
- 依赖：S1、S2、S4。
- 操作要点：实现版本化 Schema 白名单和随发布固定的 `DataAccessPolicyVersion`。平台固定应用成员角色先形成不可突破的能力上限：所有者可执行全部动作，编辑者最多 `read/create/update`，查看者最多 `read`，成员侧的 `delete/restore/export` 仅所有者可用；集合、记录和字段策略只能收紧。管理员删除/恢复只经独立治理端点，不获得业务数据读取或导出权。记录范围只允许 `shared`、`creator_only`、`subject_only`、`assignee`；字段分别声明受控 read/write 与可选 `maskedRead`，脱敏模板仅允许 `last4`、`email`、`phone`，默认省略无权字段。`createdByUserId`/`updatedByUserId` 由服务端写入；`subjectMembershipId`/assignee 只能引用当前有效 Membership，并按设计中的所有者、编辑者、普通主体规则赋值和审计；成员移除后重入使用新 Membership ID，旧关系不自动复活。实现按应用/成员/字段隔离的 CRUD、默认 cursor 列表、按 ID 读取、`POST query`、单字段排序、cursor 分页与 JSON 导出；查询最多五个 AND 条件、默认 20/最大 100 条，只允许 `queryable`/`sortable` 字段。字符串/枚举只允许 `eq/in`，数字/日期只允许 `eq/gt/gte/lt/lte/in`，布尔只允许 `eq`；不支持 `null` 查询、模糊匹配或隐式转换。默认列表按 `createdAt desc, recordId asc`，自定义排序也以 `recordId` 稳定收尾；opaque cursor 绑定应用、集合、排序和最后位置并校验完整性，首版不返回 total。业务 JSON 是事实源，写入事务中维护固定 `BusinessIndexValue` 和 `BusinessUniqueValue` 投影；唯一字符串使用带版本的 Unicode NFC 大小写敏感精确规范化，邮箱沿用账号邮箱规范化，唯一投影与主记录同事务并由固定唯一约束执行，绝不动态创建应用/字段物理索引。写入按已发布 Schema、策略、GATE-00 资源上限与 `expectedRevision` 校验。
- verify：CRUD/RBAC/行级/字段级/脱敏/导出/分页测试；非成员、无权记录和无权字段不能通过 items、cursor 或导出泄露，篡改 cursor 返回 `400`；角色策略扩权被拒绝；系统字段不可伪造，失效成员立即失去记录权限且重新加入不恢复旧关系；操作符/类型/null/模糊查询矩阵被严格验证；NFC 等价字符串产生相同唯一键而大小写不同保持不同，邮箱遵循邮箱规范化；并发 PATCH/DELETE 返回 `409`；主记录或唯一投影任一步失败时整个事务回滚；多字段 AND 查询使用固定投影且新增字段不新增 SQLite 索引定义；记录、字段、principal 与导出边界值成功、超限值无部分写入。
- stop_escalate_conditions：查询编译器不能在所有路径强制加入应用、记录和字段授权谓词，主记录与投影不能保持单事务，或 GATE-00 资源上限/错误契约未冻结时停止。
- 覆盖：AC1、AC2、AC6、AC12、AC13、AC15、AC16。

### S5b：实现 Schema 迁移、跨 Schema 回滚与回收站

- 落地文件/模块：新增 `server/schema-migrations/`、`server/routes/recycle-bin.ts`；扩展 `server/release/`、`server/business-data/`、`server/db/schema.ts`；新增迁移与生命周期集成测试。
- 依赖：S5a；`server/release/` 和 `server/db/schema.ts` 延续同一 owner 顺序修改。
- 操作要点：破坏性变更先在内存副本按 GATE-00 的迁移批次/最大量全量验证 `DataMigrationPlan`，发布时在事务内应用迁移并更新版本/指针。`DraftDataView` 只读且采用当前与候选策略的更严格交集。支持回滚的破坏性版本必须保存并验证反向计划；否则不可回滚。应用/记录删除写入 30 天回收站；已删除应用关闭所有应用路由/API，恢复只经平台级端点并原子恢复冻结对象。到期永久清理由服务启动扫描和所有者/管理员显式端点以有界、幂等事务执行，普通请求不隐式清理。
- verify：每类破坏性 Schema 变更的成功与失败迁移测试；迁移边界值成功、超限或批次失败不移动发布指针且不产生部分写入；无反向迁移拒绝回滚，验证反向迁移原子恢复数据与发布指针；草稿策略不能扩权；删除/恢复测试；未到 30 天不得永久删除，到期启动扫描与显式清理重复执行保持幂等。
- stop_escalate_conditions：迁移/反向迁移不能先完整验证再原子提交，或永久清理不能按已确认上限做到有界、幂等时停止并保留旧 Schema、数据和发布指针。
- 覆盖：AC1、AC5、AC7、AC9、AC15、AC16。

### S6：接入账户、发布和回收站的前端工作台体验

- 落地文件/模块：新增 `src/auth/`、`src/release/`、`src/business-data/`、`src/recycle-bin/`；改造 `src/app.tsx`、`src/chat-panel.tsx`、`src/preview-panel.tsx`、`src/copilotkit-tools.tsx`、`src/ask-question-card.tsx`、`src/generation-activity-card.tsx`、`src/styles.css`。
- 依赖：S2、S3、S4、S5a、S5b 的 HTTP 契约冻结。
- 操作要点：未登录时只显示认证流程；提供由 GATE-00 确认的应用列表/选择体验，并在切换后重新加载该应用的持久工作区和发布预览。按角色隐藏无权限操作但始终以服务端结果为准。所有者可查看工作数据、草稿、发布历史、回滚可用性和回收站；编辑者只见草稿和可写业务数据；查看者只见已发布只读应用。数据列表只显示服务端已授权字段；无权写字段展示不可编辑状态且服务端仍拒绝绕过请求。保存冲突提供刷新、放弃或基于最新值重试的显式操作。草稿数据不可预览时显示指定状态，而不是回填假数据。
- verify：浏览器角色、记录范围和字段权限矩阵测试；主应用 URL 在预览导航、刷新、发布与回滚后保持不变；无权限入口不可操作且绕过 UI 的 API 请求被拒绝；冲突和保存失败保留最后成功显示数据。
- stop_escalate_conditions：依赖的 HTTP/错误契约尚未冻结，或 UI 必须把客户端判断作为授权事实才能工作时停止；不得以隐藏控件替代服务端授权。
- 覆盖：AC1、AC2、AC3、AC6、AC7、AC9、AC10、AC12。

### S7：收紧路由中间件与运行时隔离

- 落地文件/模块：新增或改造 `server/middleware/`、全部 `server/routes/`；改造 `server/index.ts`、`server/copilotkit-runtime.ts`、`server/mastra-agent.ts`。
- 依赖：S2–S5b。
- 操作要点：将 Session、成员角色、应用未删除、工作区 owner-only、草稿 owner/editor、已发布应用与业务数据分别作为明确中间件。CopilotKit/AG-UI 请求以持久 Session 和应用授权加载上下文；日志/AG-UI 错误统一截断且脱敏，不输出令牌、完整 Spec 或完整记录。服务启动的恢复扫描须在路由对外提供前完成。
- verify：路由授权矩阵集成测试；删除应用后所有应用路径均不可访问，而回收站恢复端点按冻结关系可用；日志快照断言不含敏感令牌或完整 payload。
- stop_escalate_conditions：任一路由能绕过 Session、应用、成员或角色中间件，或启动恢复扫描完成前必须开放业务路由时停止并收紧组合入口。
- 覆盖：AC1、AC2、AC7、AC8、AC10、AC11、AC12。

### S8：迁移演练、端到端回归与文档交付

- 落地文件/模块：`README.md`、`.env.example`（若存在）、`tests/contract/`、`tests/browser/`、新增 `tests/integration/` 与数据库 fixture；必要时更新 `playwright*.config.ts`。
- 依赖：S1–S7。
- 操作要点：为每个测试创建隔离的 MySQL schema（per-test database，用完 DROP）与本地收件箱；建立“创建资格 → 登录 → 创建 → 问卷/草稿 → 显式发布 → 邀请成员 → 业务数据编辑 → 新草稿/发布或回滚 → 删除/恢复”的端到端场景。保留原 mock/probe 语义，迁移为显式测试模式，不能依赖真实 LLM 或真实邮件。
- verify：`npm run typecheck`、`npm run test`、`npm run build`、`npm run test:browser`、`npm run test:browser:mock` 全绿；新增持久化 E2E 在重启 Hono 与刷新浏览器后验证 AC1–AC16；对数据库迁移执行空库升级和上一个测试 schema 升级演练。
- stop_escalate_conditions：测试需要真实 LLM/真实邮件、不同用例不能隔离 SQLite/共享配置，或任一超限测试会留下部分数据时停止；先修测试隔离或实现边界，不降低验收条件。
- 覆盖：AC1–AC16。

## 风险与回滚

| 风险 | 步骤 | 影响 | 缓解与最后安全点 |
| --- | --- | --- | --- |
| 本地 Docker/MySQL 不可用或 Drizzle 与 mysql2 不兼容 | GATE-00、S1 | 无法建立本地持久化基础 | 兼容性探针已在 GATE-00 通过（见决策补充）；启动健康检查失败即停止并给出清晰错误，不降级为内存模式 |
| Cookie/CSRF 策略不完整 | GATE-00、S2、S7 | 认证或跨站写请求存在风险 | 未确认不得写认证路由；以 GATE-00 中确认的同源测试作为放行条件 |
| 迁移中断或转换失败 | S5b、S8 | Schema 与业务数据不一致 | 所有迁移先在副本验证，发布时单事务提交；失败保留旧 `ReleasePointer`、旧 Schema、旧数据 |
| 版本剪枝删除当前可用版本 | S4 | 已发布应用失效 | 先计算保留集合再删除，强制包含当前指针；执行前后断言当前版本存在 |
| 进程重启造成生成状态悬挂 | S3、S7 | 用户无法重新生成 | 启动扫描将 running/awaiting_preview 原子改为 incomplete；不尝试重放并拒绝迟到结果，最后安全点是上一有效草稿/发布版本 |
| 删除/恢复产生越权或部分恢复 | S5b、S7 | 数据泄露或无法使用的恢复状态 | 删除后关闭应用路由；恢复端点只读冻结授权信息并事务恢复；事务失败维持删除状态 |
| 权限关系或唯一投影与主记录不一致 | S5a、S8 | 越权读取或重复业务值 | 系统关系字段与主记录同事务校验/写入；唯一投影使用固定唯一约束；失败整体回滚 |
| 记录、导出或迁移没有资源上限 | GATE-00、S5a、S5b、S8 | 单应用耗尽本地内存、CPU 或磁盘并造成部分写入 | Gate 固定数值和错误契约；写入前校验，导出/迁移按有界批次执行，边界与超限测试断言无部分写入 |

## 覆盖检查

- AC1 → S1/S2/S3/S4/S5a/S5b/S6/S7/S8 → 重启与刷新端到端测试。
- AC2 → S2/S5a/S6/S7/S8 → API 与浏览器角色矩阵。
- AC3 → S4/S6/S8 → 发布指针与权限测试。
- AC4 → S4/S8 → 保留集合与回滚测试。
- AC5 → S5b/S8 → 全量迁移副本验证测试。
- AC6 → S1/S2/S5a/S6/S8 → 条件写入和冲突 UX 测试。
- AC7 → S5b/S6/S7/S8 → 删除封闭与原子恢复测试。
- AC8 → S3/S4/S7/S8 → 心跳、断流和启动扫描测试。
- AC9 → S5b/S6/S8 → 反向迁移回滚测试。
- AC10 → S2/S6/S7/S8 → 开发收件箱与生产模式拒绝测试。
- AC11 → S3/S4/S8 → 候选、浏览器 apply 结果和草稿发布资格测试。
- AC12 → S5a/S6/S7/S8 → 应用、集合、记录、字段授权矩阵以及导出/分页泄露测试。
- AC13 → S5a/S8 → 固定索引数量和多字段 AND 查询投影测试。
- AC14 → S3/S4/S8 → 未完成状态、刷新/重启和迟到结果测试。
- AC15 → S5a/S5b/S8 → 系统关系、固定脱敏、唯一事务和回收站清理测试。
- AC16 → GATE-00/S5a/S5b/S8 → 记录、字段、principal、导出和迁移的边界/超限及无部分写入测试。

## 待确认 / 残留假设

- 【已关闭】会话 Cookie、CSRF 保护、登出/会话有效期、多应用选择/刷新恢复、数据库生命周期，以及记录、索引字段、principal、导出和迁移的具体资源上限与错误契约，均已在 GATE-00 经项目所有者确认（见 GATE-00 决策补充）。
- 【已关闭】Drizzle 以稳定版组合（drizzle-orm@0.45.2 + drizzle-kit@0.31.10 + mysql2）接入 MySQL 8.4（Docker Compose）；GATE-00 最小探针已通过。
- 【机械假设】既有 mock/probe 测试可以改为使用 per-test MySQL schema fixture；验证方法是 S8 的全量回归。若 AG-UI mock 固有单例阻止隔离，先隔离测试启动器，不修改生产授权语义。

## 下一步

GATE-00 已关闭并经项目所有者批准（含存储决策修订为 MySQL 8.4 + Docker Compose）；S1–S8 按序实施已获授权。
