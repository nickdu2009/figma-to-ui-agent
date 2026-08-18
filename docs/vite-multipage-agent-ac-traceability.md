# vite-multipage-agent 持久化平台 AC1–AC16 测试可追溯性

> S8 交付物。每条验收标准映射到可执行的测试证据。全部命令在
> 仓库根目录下运行；浏览器测试需要
> `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 与 `npm run db:up`。

## 验证入口

| 命令 | 结果 |
| ------ | ------ |
| `npx tsc --noEmit` | ✅ 通过 |
| `npx vitest run` | ✅ 104 测试全绿 |
| `npm run build` | ✅ 通过 |
| `npx playwright test --config playwright.config.ts` | ✅ transport probe 通过 |
| `npx playwright test --config playwright.mock.config.ts` | ✅ 11 测试通过（含 S8 场景） |

## AC → 测试证据

| AC | 测试证据 |
| ---- | ---------- |
| AC1 重启/刷新恢复 | `tests/integration/persistence/migration-drill.test.ts`（空库升级、0002→最新升级、旧数据保留、幂等重跑）；`tests/integration/persistence/repositories.test.ts`；`tests/integration/persistence/generation-lifecycle.test.ts`（重连后状态完整）；`tests/browser/persistence.spec.ts` 场景一（发布后浏览器刷新，预览由已发布版本恢复） |
| AC2 未登录拒绝 + 角色矩阵 | `tests/contract/auth-flow.test.ts`（含评审回归：过期未撤销邀请不换取首次登录资格）；`tests/contract/role-guard.test.ts`（草稿 owner/editor、current 全员、发布历史 owner-only、viewer 404）；`tests/contract/business-data.test.ts`（角色上限矩阵）；`tests/browser/persistence.spec.ts` 场景二（owner/editor/viewer UI 矩阵 + viewer 绕过 UI 直接请求被 404） |
| AC3 不自动发布 + owner 发布/回滚 | `tests/contract/release-service.test.ts`（非 owner 404）；`tests/browser/persistence.spec.ts` 场景一（生成后 `versions-empty`，显式发布才出现版本） |
| AC4 当前版本永不剪枝 + 最多十版本 | `tests/contract/release-service.test.ts`（剪枝保留当前 + 最近 9 个，当前版本剪枝前后均存在） |
| AC5 破坏性变更必须全量迁移验证 | `tests/contract/schema-migration.test.ts`（`migration_plan_required` 409；计划不完整拒绝；副本全量验证失败则旧 Schema/数据/指针不变） |
| AC6 并发写入 409 | `tests/integration/persistence/repositories.test.ts`（revision CAS 冲突）；`tests/contract/business-data.test.ts`（`revision_conflict` 携带 currentRevision 与当前值） |
| AC7 删除不可访问 + 30 天授权恢复 | `tests/contract/role-guard.test.ts`（删除后全部正常路由 404、应用列表排除）；`tests/contract/schema-migration.test.ts`（恢复原子性、回收站清理）；`tests/browser/persistence.spec.ts` 场景三（UI 删除 → 路由 404 → 治理端点恢复 → 可重新进入） |
| AC8 断流/重启/超时 → incomplete 不重放 | `tests/integration/persistence/generation-lifecycle.test.ts`（启动扫描 `sweepOrphanRuns`、心跳超时扫描、abort 幂等） |
| AC9 无反向迁移不可跨 Schema 回滚 | `tests/contract/schema-migration.test.ts`（无反向计划回滚拒绝 `rollback_not_supported`；带反向计划可回滚并验证） |
| AC10 本地收件箱验收 + 非开发拒绝 | `tests/contract/auth-flow.test.ts`（OTP/魔法链接/邀请邮件经开发收件箱）；`server/auth/dev-mail.ts`（生产模式不挂载投递器与 `/api/dev/mail-inbox`） |
| AC11 仅 committed 成草稿 | `tests/integration/persistence/generation-lifecycle.test.ts`（committed 同事务建草稿；失败/迟到/重复 apply 拒绝且不留草稿）；`tests/contract/release-service.test.ts`（失败候选不可发布） |
| AC12 记录范围与字段权限服务端执行 | `tests/contract/business-data.test.ts`（shared/creator_only/subject_only/assignee 四种范围；字段脱敏；游标分页不越权；导出仅 owner；评审回归：脱敏/不可读字段不可作 where/orderBy —— 查询预言机门禁 400）；`tests/browser/persistence.spec.ts` 场景二（viewer 服务端 404） |
| AC13 固定投影，无动态索引 | `tests/contract/business-data.test.ts`（查询编译器白名单、最多 5 AND、单排序字段 + recordId 稳定收尾；评审回归「排序翻页回归」：类型化原生列排序、方向感知游标、同值平局不漏不重、排序查询仅含拥有该字段值的记录）；迁移集 `server/db/migrations/` 索引定义静态，无按应用/字段增长的 DDL |
| AC14 running/awaiting_preview 终态化 | `tests/integration/persistence/generation-lifecycle.test.ts`（刷新/断流/重启/超时后 `incomplete`；迟到 apply 被条件更新拒绝）；`tests/browser/agent-flow.spec.ts` abort 用例（中止后迟到结果无效） |
| AC15 关系字段/脱敏/唯一投影/30 天清理 | `tests/contract/business-data.test.ts`（Unicode NFC、邮箱规范化、normalizationVersion、唯一值与记录同事务）；`tests/contract/schema-migration.test.ts`（30 天回收站清理有界幂等，普通请求不触发永久清理） |
| AC16 资源上限且无部分写入 | `tests/contract/business-data.test.ts`（单记录字节、每集合记录数、principal 数超限 400/409 且无部分写入）；`tests/contract/schema-migration.test.ts`（导出/迁移批次与最大量上限，超限 `export_limit_exceeded`/`migration_limit_exceeded` 且旧数据不变） |

## 备注

- 浏览器 E2E 使用共享开发库（docker compose MySQL），应用名按时间戳唯一化；
  邀请顺序遵循 S2 授权（先邀请、后登录、再接受）。
- `playwright.mock.config.ts` 配置 `workers: 2, retries: 2` 以吸收并行冷启动抖动；
  重试只针对连接就绪竞态，不掩盖断言失败。
- mock Agent 现在与真实路径一致地为 `finishPatchStream` 提供权威候选 Spec
  （由 fixtures 的 add-only RFC 6902 ops 重建），否则持久层正确拒绝创建草稿。
- 评审加固（查询语义）：排序按字段类型走原生比较列（number/date/boolean 不再
  CHAR 字典序）；游标携带真实类型化排序值；同值平局的 recordId 收尾方向与排序
  方向一致；对调用方脱敏或不可读的字段作 where/orderBy 一律 400（防结果差异探测）。
- 评审加固（基础设施）：healthCheck 超时后迟到的池连接显式释放；连接池显式
  `connectTimeout`/`queueLimit`；启动迁移失败提示如实说明 DDL 不可回滚。
