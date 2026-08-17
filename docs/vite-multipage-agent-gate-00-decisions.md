# GATE-00 决策补充：会话安全、应用上下文、数据库依赖与资源上限

- 状态：已关闭，经项目所有者确认
- 范围：`examples/vite-multipage-agent/`
- 上游文档：[持久化、发布与账号平台方案](./persistence-release-platform-design.md)、[实施计划](./vite-multipage-agent-persistence-release-implementation-plan.md)
- 补充说明：GATE-00 期间项目所有者将存储决策从"SQLite（node:sqlite）"修订为 **MySQL 8.4 + Docker Compose**；原目标中"本地数据库使用 SQLite + node:sqlite"与"不做 MySQL 实现"两条边界随之作废。设计与实施计划文档已同步修订。

## 1. 依赖版本（精确锁定，不带 `^`）

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| MySQL 镜像 | `mysql:8.4`（LTS，锁定 tag） | 本地开发经 Docker Compose 运行 |
| drizzle-orm | `0.45.2` | 稳定版；原生 `mysql2` 驱动支持 |
| drizzle-kit | `0.31.10` | 稳定版；mysql 方言迁移生成 |
| mysql2 | 锁定安装版本 | Drizzle 官方支持的驱动 |
| Node | 24.x（`engines` 钉住） | 现有运行时不变 |

### 探针证据（GATE-00 收尾）

在空 MySQL 8.4 库上以最小探针验证通过：

1. `drizzle-kit generate`（mysql 方言）生成显式迁移 SQL；启动时 `migrate` 应用成功，**重复执行幂等**（满足重启恢复语义）。
2. `db.transaction()` 内抛错整体回滚，主表行数不变。
3. 条件更新 `UPDATE ... WHERE id=? AND rev=?`：新鲜 revision `affectedRows=1`，陈旧 revision `affectedRows=0`（409 乐观并发的底层原语成立，mysql2 原生返回 affectedRows）。
4. Collation 探针：MySQL 默认 `utf8mb4` collation 大小写不敏感（`'Alice'='alice'` 冲突）——**唯一投影列必须显式使用 `utf8mb4_bin`**（已验证大小写敏感精确语义成立）。

## 2. 会话 Cookie 契约

| 项 | 值 |
| --- | --- |
| Cookie 名 | `vma_session` |
| 属性 | `HttpOnly; SameSite=Lax; Path=/`；不设 `Domain`（host-only）；本地 http 不加 `Secure`（HTTPS 部署时必须加，README 注明） |
| Session 存储 | 服务端不透明令牌：≥128 bit 随机，库中只存 SHA-256 摘要；行含 `userId / createdAt / expiresAt / lastSeenAt` |
| 有效期 | 绝对 7 天 + 滑动续期（剩余 < 50% 时更新 `expiresAt`） |
| 登出 | 服务端删除 Session 行 + 下发过期 Cookie；过期/登出/用户停用后立即 `401`；同用户其他会话不受影响 |

## 3. CSRF 防护

1. `SameSite=Lax`（跨站 POST 不携带 Cookie）；
2. 所有 Cookie 认证的 **mutation 路由校验 `Origin` 头**：必须匹配同源白名单（`http://127.0.0.1:3100`、`http://localhost:3100`、同源 3101），无 Origin 或非白名单一律 `403 csrf_rejected`；GET/HEAD 不做 Origin 校验。

验证预期：同源登录/登出/刷新恢复成功；伪造跨站 Origin 的 POST 一律 `403`；登出后旧 Cookie 一律 `401`。

## 4. 应用上下文与可信 appId 契约

- 可信 `appId` **只来自 URL path**（`/apps/:appId/...`）；每请求服务端执行 `Session → App 存在且未删除 → Membership 有效` 全链路授权；绝不信任 query/body/header/cookie 中的 appId。
- 非成员伪造 appId → `404`（不可见，不区分存在与否）；已删除应用 → `404`。
- 刷新恢复：浏览器路由携带 appId（如 `/apps/:appId`），进入时服务端重新授权加载；前端 `localStorage` 仅存"上次应用"作 UX 提示，不作为授权依据。
- 切换应用重新拉取该应用工作区与发布预览；未发布草稿为服务端持久状态，切换往返不丢失、不自动发布。

## 5. 数据库生命周期（Docker 边界）

- `docker-compose.yml` 位于 example 根目录：`mysql:8.4` 精确锁定、命名卷持久化、端口映射 **3317→3306**（3307 被本机其他项目占用，故改 3317）、healthcheck；dev/E2E 脚本以 `docker compose up -d --wait` 为前置。
- Docker/MySQL 不可用时服务 **fail-closed 拒绝启动并给出清晰错误**，不降级为内存模式。
- 连接凭据只来自进程环境；本地开发使用专用弱凭据并在 `.env.example` 标注"仅本地开发"；不提交任何真实凭据。
- 测试隔离：同一容器内**每个测试文件创建独立 schema**（`vma_test_<随机>`），用完 DROP；支持并行；不引入 testcontainers。
- 清理边界：仅回收站到期清理（启动扫描 + 显式端点，有界批次、幂等）与测试 schema DROP；普通请求绝不隐式清理。
- 本期不做自动备份；命名卷持久化已满足 AC1 的"重启本地服务可恢复"。

## 6. 资源上限（L1–L7）与错误契约

统一错误格式：`400 { error: { code, limit, actual? } }`（发布门禁类错误在发布请求上返回）。**所有上限在写入前校验，超限不产生任何部分写入。**

| # | 上限 | 数值 | 错误 code |
| --- | --- | --- | --- |
| L1 | 单条业务记录 JSON 字节数（UTF-8 canonical JSON） | 65,536 B | `record_size_limit_exceeded` |
| L2 | 每集合最大记录数 | 10,000 | `collection_record_limit_exceeded` |
| L3 | 每 Schema queryable 字段数 | 16 | `schema_queryable_limit_exceeded`（发布门禁） |
| L4 | 每 Schema unique 字段数 | 8 | `schema_unique_limit_exceeded`（发布门禁） |
| L5 | 每记录最大 principal 数 | 8 | `record_principal_limit_exceeded` |
| L6 | JSON 导出：批次 / 最大量 | 500 条/批；≤ 10,000 条 | `export_limit_exceeded` |
| L7 | Schema 迁移：批次 / 应用级最大量 | 500 条/批验证；≤ 50,000 条 | `migration_record_limit_exceeded`（发布整体失败） |

### 边界测试方法（AC16 追溯）

每项上限：① 边界值（恰好 = limit）成功；② limit+1 按上述契约拒绝；③ 拒绝后断言主记录表、revision、`BusinessIndexValue`、`BusinessUniqueValue`、`RecordPrincipal` 行数与内容全部不变（无部分写入）；④ 发布门禁类上限断言发布失败且 `ReleasePointer`、旧数据不变。

设计层面已固定、不重复列入的数值：分页默认 20 / 最大 100；查询条件 ≤ 5 个 AND；每应用保留 10 个发布版本；心跳 30s / 超时 90s；回收站 30 天。

## 7. 风险登记

- R1：MySQL 默认 collation 大小写不敏感 → 唯一投影列强制 `utf8mb4_bin`，S1 建表时落实并由测试验证。
- R2：本地 http 下 Cookie 无 `Secure`，仅适用 localhost 开发，README 注明。
- R3：Docker 成为本地开发硬前置 → 启动健康检查 + 清晰报错；README 说明。
- R4：测试并发写同一容器 → per-test schema 隔离解决。
- R5：上限数值是对外错误契约，未来调整需修订本文档并更新边界测试（小 Gate），不得隐式变更。

## 8. 确认记录

- 依赖版本（稳定版 drizzle-orm/drizzle-kit + mysql2）：项目所有者确认"要稳定版本"，后修订为 MySQL 方案。
- MySQL 8.4 + Docker Compose 修订及 M1–M7（镜像 tag、端口 3317（3307 被占用，实施时调整）、开发凭据、per-test schema、fail-closed 启动、容器化测试前置）：项目所有者"批准"。
- 第 2–6 节全部契约与 L1–L7 数值：随上述批准一并确认。
