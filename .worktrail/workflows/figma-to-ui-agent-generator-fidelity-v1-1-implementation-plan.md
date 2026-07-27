---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-generator-fidelity-v1-1-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent Generator Fidelity v1.1 实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Generator Fidelity v1.1 实施计划

## 1. 来源与执行目标

正式来源：

- `architecture/figma-to-ui-agent-generator-fidelity-v1-1-closure-design.md`
- `architecture/figma-to-ui-agent-generator-fidelity-v1-design.md`
- `workflows/figma-to-ui-agent-generator-fidelity-v1-implementation-plan.md`
- `validation/figma-to-ui-agent-generator-fidelity-v1-result.md`
- `reports/community-corpus/20260726gf-final-local-v1-generator-fidelity-v1-summary.json`
- `reports/community-corpus/20260726gf-final-local-v1-coverage-guard-summary.json`

目标：通过字体资产登记、UISpec 数值字重和节点级 Figma asset backfill，将固定六样本从 `2/6 <5%` 提升到至少 `4/6 <5%`；Mobile、Dashboard、Ecommerce、Landing 四个明确样本必须各自 `<5%`。

## 2. Lifecycle 与授权边界

推荐知识 lifecycle 顺序：

1. 推广 v1 validation，使 `2/6` 基线成为正式验证事实。
2. 推广 v1.1 architecture。
3. 推广本 workflow。
4. 同目标未修订候选单独 discard，不与修订版一起 promote。

计划接受不自动授权：

- DesignBundle 或 UISpec schema 变更；
- 读取、复制或下载真实字体；
- 调用 Figma REST；
- 新增依赖或修改 package/lockfile；
- commit、push、promote、discard、删除文件或清理 dirty worktree。

不调用 OpenAI。Figma backfill 不调用 `/v1/me`、Variables 或完整 inspect。

## 3. 真相与兼容策略

- 兼容策略：additive compatibility。
- Figma 节点真相：当前 DesignBundle revision。
- 字体需求真相：DesignBundle 文本 family/weight。
- 字体文件：本地补充渲染资产。
- UISpec：唯一结构化中间产物。
- Preview、截图、diff、report、manifest：派生证据。
- 旧 DesignBundle/UISpec revision 与 fixture 必须继续 parse。
- 新字体和 backfill 通过新 revision 落地，旧 revision 可回滚。

## 4. 验收映射

- AC1：旧 DesignBundle/UISpec 兼容。
- AC2：数值字重从 Figma 到 CSS 不丢失。
- AC3：字体按哈希登记并在截图前 ready。
- AC4：字体缺失、加载失败和 fallback 有诊断。
- AC5：缺失 asset planner 不选择 page/root/full-artboard。
- AC6：节点 backfill 校验 fileKey hash、复用限流、原子保存 revision。
- AC7：Mobile `<5%`。
- AC8：Dashboard `<5%`。
- AC9：固定六样本至少 `4/6 <5%`，Ecommerce/Landing 继续 `<5%`。
- AC10：功能、键盘、console、typecheck、相关测试通过。
- AC11：coverage guard 不回退。
- AC12：严格 secret scan 通过。

## 5. 并行与所有权

[parallelism:
- independent lanes: schema/字体与 visual backfill 可并行只读调研；生产写入严格按 T01-T10 顺序
- sequential blockers: GATE-00/GATE-SCHEMA -> T01 -> T02 -> T03 -> T04 -> T05 -> T06；GATE-FONT-ASSET -> T07；GATE-FIGMA-BACKFILL -> T08；T07+T08 -> T09 -> T10
- shared write surfaces: `src/design-bundle/schema.ts`、`src/ui-spec/schema.ts`、`src/project-store/*`、`src/static-generation/*`、`src/preview/*`、`preview/src/*`、`src/validation/render-and-compare.ts` 由单一 coding agent 顺序拥有
- delegation: 0；dirty worktree 已包含 v1 实现，schema/store/preview/report 是共享写面
]

## 6. Pre-coding Gate

### GATE-00：基线与工作树冻结

- goal：确认 `2/6` 基线并保护现有修改。
- actions：
  1. 运行 `git status --short`，保存只读快照；禁止 reset、checkout、clean 或删除 untracked 文件。
  2. 记录 `package.json` 与 `package-lock.json` 当前 hash，后续只比较本计划新增 delta。
  3. 用 `jq` 确认 final v1：`passed5PctCount=2`、Mobile `0.055260053857966306`、Dashboard `0.06101752387152778`。
  4. 用 `jq` 确认 coverage guard：样本匹配、`sourceNodeCount=1430`、`unmapped=0`、`fullPageScreenshotFallback=false`。
  5. 确认六个 cached DesignBundle 存在。
- verify：全部只读检查 exit code 0。
- stop：基线、样本集合或 DesignBundle 发生未说明变化。

### GATE-SCHEMA

- required confirmation：允许 additive DesignBundle `fonts`/font provenance/ProjectStore font path，以及 UISpec `fontWeight = old enum | 1..1000`。
- forbidden：破坏旧 fixture、修改模型可见 tool contract、引入 compound/variant/modal schema。
- stop：未明确授权。

### GATE-DEPENDENCY

- default：不修改 package/lockfile。
- stop：如需新依赖，先说明必要性、替代方案、验证和 rollback，等待授权。

## 7. 实施卡片

### T01：Additive Schema 与 ProjectStore 字体基础

- goal：建立兼容字体资产和数值字重契约。
- prerequisites：GATE-00、GATE-SCHEMA。
- must-read：v1.1 architecture；`src/design-bundle/schema.ts`；`src/ui-spec/schema.ts`；`src/project-store/path-safety.ts`；`src/project-store/store.ts`。
- owns：上述文件；新增 `src/media/font-format.ts`、`tests/unit/media/font-format.test.ts`、`tests/unit/design-bundle/schema.test.ts`；更新 `tests/unit/project-store/store.test.ts`、`tests/unit/contracts/ui-spec.test.ts`。
- must-not-touch：`src/tools/contracts.ts`、package/lockfile、live 数据。
- actions：
  1. 新增 `LocalFontRef`、`fonts=[]` 默认、font provenance 与 entity/origin 交叉校验。
  2. ProjectLayout 新增 `figma/fonts`，保持 containment/symlink 防护。
  3. 校验 WOFF2/WOFF/TTF/OTF magic、扩展名、MIME、大小、SHA-256。
  4. ProjectStore 增加内容寻址字体保存；face 冲突 fail closed。
  5. UISpec/相关 type 扩为旧 enum 或 1..1000 数值。
- expected outputs：additive schema、font storage、无新依赖。
- verify：
  - `npx vitest run tests/unit/media/font-format.test.ts tests/unit/design-bundle/schema.test.ts tests/unit/project-store/store.test.ts tests/unit/contracts/ui-spec.test.ts`
  - `npm run typecheck`
- done conditions：旧 fixture parse；非法 font/ref 被拒；非 font provenance 不能使用 font origin。
- stop/escalate：需要 schemaVersion bump、破坏性 migration 或新依赖。
- handoff：T02。
- covers：AC1-AC3。

### T02：数值字重端到端映射

- goal：Figma 300/400/500/600/700 等字重到 CSS 保持数值。
- prerequisites：T01。
- must-read：`src/static-generation/style-mapper.ts`、`src/static-generation/node-mapper.ts`、`src/preview/catalog.ts`、`src/preview/json-render-adapter.ts`、`preview/src/components/controlled-style.ts`、typography/form components。
- owns：上述文件；`tests/unit/static-generation/style-mapper.test.ts`、`tests/unit/static-generation/node-mapper.test.ts`、`tests/unit/preview/catalog.test.ts`、`tests/unit/preview/json-render-adapter.test.ts`。
- must-not-touch：tool contract、字体源、样本特化。
- actions：
  1. `MappedStyle.fontWeight` 支持旧 enum/number，有源数值不压缩。
  2. catalog/adapter/controlled style/text/form renderer 接受 union，number 原样交给 CSS。
  3. 保留旧 enum 行为，补 300/500/600/700 与旧四档测试。
- expected outputs：numeric fontWeight 全链路。
- verify：
  - `npx vitest run tests/unit/static-generation/style-mapper.test.ts tests/unit/static-generation/node-mapper.test.ts tests/unit/preview/catalog.test.ts tests/unit/preview/json-render-adapter.test.ts tests/unit/contracts/ui-spec.test.ts`
  - `npm run typecheck`
- done conditions：Figma 300 最终 CSS 为 300；旧 `regular` 仍为 400。
- stop/escalate：需扩大非字体 style/tool contract。
- handoff：T03。
- covers：AC1、AC2、AC10。

### T03：字体导入、Preview 加载与诊断

- goal：已登记字体确定性加载，fallback 不得伪通过。
- prerequisites：T01、T02。
- must-read：`src/preview/project-data-plugin.ts`、`preview/src/preview-app.tsx`、`src/validation/render-and-compare.ts`、static report/markdown、preview e2e。
- owns：上述文件；新增 `preview/src/font-assets.ts`、`scripts/import-font-assets.mjs`；相关测试。
- must-not-touch：外部字体源、Figma/OpenAI、package/lockfile。
- actions：
  1. Import CLI 默认 dry-run；真实写入同时要求 `FONT_ASSET_IMPORT_AUTHORIZED=1` 与 `--apply --confirm`。
  2. Manifest 输入 family/weight/style/sourceKind/source file；持久数据不保留 source path。
  3. 扩展现有 `/api/projects/:id/files/...`，只服务 DesignBundle 已登记 font/image。
  4. Preview 注册 FontFace，设置 ready/error；compare 等待 readiness 与 `document.fonts.ready`，超时 fail closed。
  5. report/markdown 输出 registered/loaded/missing/failed/fallback diagnostics。
  6. 单测使用合成 header/loader mock；真实浏览器字体 fixture 需通过 GATE-FONT-ASSET 并附许可说明。
- expected outputs：双确认 import、受管文件服务、确定性加载、诊断。
- verify：
  - `npx vitest run tests/unit/project-store/store.test.ts tests/unit/preview/catalog.test.ts tests/integration/validation/render-and-compare.test.ts tests/unit/static-generation/report-schema.test.ts tests/unit/static-generation/report-markdown.test.ts`
  - `npx playwright test tests/e2e/preview.spec.ts`
  - `npm run typecheck`
- done conditions：未登记 font 404；ready 后才截图；失败有稳定错误码；无 source path 泄露。
- stop/escalate：必须新增 package 或 fixture 许可不明。
- handoff：T04。
- covers：AC3、AC4、AC10、AC12。

### T04：Missing Asset Planner 与 Compound Parent 优先级

- goal：通用识别 compound/stroke icon，生成无网络 manifest。
- prerequisites：T03。
- must-read：`src/static-generation/visual-asset-priority.ts`、`src/static-generation/visual-layer-planner.ts`、`src/static-generation/coverage.ts`、v1 Dashboard/Mobile report。
- owns：上述文件；新增 `src/figma/visual-asset-backfill-manifest.ts`、`tests/unit/figma/visual-asset-backfill-manifest.test.ts`；更新 visual planner tests。
- must-not-touch：固定 node/project/fileKey；不得联网。
- actions：
  1. 识别 compound：kind/子关系/effect 与通用名称 `Combined Shape`、union/subtract/intersect/exclude。
  2. parent 优先于 operands，成功 parent 覆盖 descendants。
  3. 扩充 back/edit/status 等通用小图标信号。
  4. 从 missing asset/stroke diagnostics 生成排序 manifest。
  5. 排除 page/root、已登记、隐藏和超限节点。
- expected outputs：确定性、可审查、无秘密 manifest。
- verify：
  - `npx vitest run tests/unit/figma/visual-asset-backfill-manifest.test.ts tests/unit/static-generation/visual-asset-priority.test.ts tests/unit/static-generation/visual-layer-planner.test.ts tests/unit/static-generation/service.test.ts`
  - cached Dashboard plan 包含 compound parent；Mobile plan 包含诊断支持的缺失 icon；均不含 page/root。
- done conditions：无网络可 plan；规则无固定样本标识。
- stop/escalate：planner 本身要求 compound UISpec schema。
- handoff：T05。
- covers：AC5、AC11、AC12。

### T05：节点级 Figma Backfill 与模拟验证

- goal：实现受控、限流、原子、可回滚 backfill；本卡不调用真实 Figma。
- prerequisites：T04。
- must-read：`src/figma/rest-client.ts`、`src/figma/assets.ts`、`src/figma/inspector.ts`、`src/figma/url.ts`、ProjectStore revision API。
- owns：新增 `src/figma/visual-asset-backfill.ts`、`scripts/backfill-figma-visual-assets.mjs`、`tests/integration/figma/visual-asset-backfill.test.ts`；必要时最小抽取 inspector helper。
- must-not-touch：`/v1/me`、Variables、OpenAI、full inspect、page/root fallback。
- actions：
  1. CLI 默认 `--plan`；真实 apply 同时要求 `FIGMA_VISUAL_BACKFILL_AUTHORIZED=1` 与 `--apply --confirm`。
  2. 校验 project、manifest、fileKey hash、node ownership、已有 provenance。
  3. 每批最多 100，`png/scale=1`，复用 rate-limit logger/downloader。
  4. 任一失败不保存新 revision；已写 blob 为未登记 orphan，不可由 preview 服务。
  5. 全部成功后追加 screenshot/provenance，保存一个新 revision，输出脱敏摘要。
- expected outputs：先 plan、后双确认 apply 的 CLI/service。
- verify：
  - `npx vitest run tests/integration/figma/rest-client.test.ts tests/integration/figma/assets.test.ts tests/integration/figma/inspector.test.ts tests/integration/figma/visual-asset-backfill.test.ts`
  - 覆盖 mock 429、null URL、hash mismatch、partial、重复 node、page/root rejection。
  - `npm run typecheck`
- done conditions：模拟成功仅一个 revision；失败无 revision；429 脱敏。
- stop/escalate：需绕过限流、安全 URL 或 revision 边界。
- handoff：T06。
- covers：AC5、AC6、AC10、AC12。

### T06：本地实现总验证

- goal：真实资产/服务前确认代码路径完整。
- prerequisites：T01-T05。
- must-read：本计划全部 verify。
- owns：仅修复 T01-T05 自身问题。
- must-not-touch：真实 token/font/Figma、Git lifecycle。
- actions：运行全部 targeted tests、typecheck、Playwright、`git diff --check`；比较 package/lockfile 与 GATE-00 hash，确认本计划未新增 delta。
- expected outputs：外部 Gate 前本地验证记录。
- verify：T01-T05 命令全通过；strict scan 不命中 secret/source path。
- done conditions：无 blocking，外部动作仍为零。
- stop/escalate：只能靠真实服务解释的代码失败。
- handoff：GATE-FONT-ASSET、GATE-FIGMA-BACKFILL。
- covers：AC1-AC6、AC10-AC12 的本地部分。

## 8. 外部 Gate 与目标样本

### GATE-FONT-ASSET

- required confirmation：允许读取/复制明确字体文件并确认来源/许可。
- static normal faces：League Spartan 300/400/500/600；Poppins 300/600/700。
- v1.1 不假定 variable font；只有 variable 文件时先修订 contract，不伪装多个静态 face。
- 未通过：停止真实导入，不能完成 AC7。

### T07：真实字体导入与 Mobile Targeted 诊断

- goal：关闭 Mobile 字体主因，并决定是否需要 icon backfill。
- prerequisites：T06、GATE-FONT-ASSET。
- must-read：import help、Mobile DesignBundle/font diagnostics。
- owns：Mobile 新 DesignBundle revision 与 targeted report。
- must-not-touch：未授权字体、Figma/OpenAI、其他项目。
- actions：dry-run manifest；双确认导入完整 face；生成 UISpec；运行 Mobile static/preview/compare；记录 face 命中和 diff delta。
- expected outputs：Mobile 字体后 targeted summary/revision。
- verify：required face 全 loaded；功能/键盘/console 通过；无 fallback。
- done conditions：
  - 路径 A：Mobile `<5%`，直接完成 AC7；
  - 路径 B：Mobile 仍 `>=5%`，但 region/source evidence 明确剩余差距仅来自 T04 manifest 覆盖的缺失 icon，允许交给 T08；
  - 其他情况：停止并回到 design review。
- stop/escalate：缺 face、许可不明、fallback、或剩余差距无法归因到 manifest。
- handoff：GATE-FIGMA-BACKFILL。
- covers：AC3、AC4、AC7（路径 A）或 AC7 前置证据（路径 B）、AC10、AC12。

### GATE-FIGMA-BACKFILL

- required confirmation：对 manifest 明确的 project/file/node 运行 node image export。
- scope：Dashboard compound parent；T07 路径 B 时加入 Mobile icons。
- excluded：`/v1/me`、Variables、OpenAI、完整 inspect、page/root/full-artboard。
- 未通过：不能完成 AC8/AC9；路径 B 时也不能完成 AC7。

### T08：节点 Backfill 与 Dashboard/Mobile Targeted Gate

- goal：关闭 Dashboard，并在需要时关闭 Mobile icon 差距。
- prerequisites：T06、GATE-FIGMA-BACKFILL；Mobile 是否加入由 T07 决定。
- must-read：已审阅 manifest、429 策略、目标 current revision。
- owns：授权项目的新 revision 与 targeted reports。
- must-not-touch：manifest 外节点、完整 inspect、其他项目、compound schema。
- actions：
  1. 先 plan 并核对 file hash、node count、page/root exclusion。
  2. 每个 project 单独双确认原子 apply。
  3. 重新 static generation，确认 parent 渲染且 operands 不重复。
  4. 跑 Dashboard；T07 路径 B 再跑 Mobile。
- expected outputs：backfill summary、revision、targeted diff/coverage delta。
- verify：Dashboard `<5%`；Mobile `<5%`；功能与 targeted coverage 通过。
- done conditions：AC7、AC8 均通过。
- stop/escalate：Dashboard 仍 `>=5%` 时停止样本特化并进入 v2 compound design；不在本计划扩 UISpec。
- handoff：T09。
- covers：AC5-AC8、AC10-AC12。

## 9. 全量收口

### T09：固定六样本 Visual/Coverage Gate

- goal：证明 4/6 且既有通过样本未回退。
- prerequisites：T07、T08。
- must-read：`scripts/run-generator-fidelity-corpus.mjs`、v1 final visual/coverage baseline。
- owns：corpus harness 最小 coverage guard 增量和新 reports；样本集合不变。
- must-not-touch：threshold、projectIds、API boundary。
- actions：
  1. Harness 接受/固定 v1 coverage baseline，输出 visual + coverage guard JSON/Markdown。
  2. 固定六 projectId、本地 cached DesignBundle、新 runLabel 全量运行。
  3. 比较每样本 diff、passed count、sourceNodeCount、unmapped、fallback、核心 rendered/unsupported。
  4. 跑 functional、keyboard、console、strict secret scan。
- expected outputs：v1.1 final visual/coverage guard summaries。
- verify：
  - `node scripts/run-generator-fidelity-corpus.mjs --dataRoot data/community-corpus-v21 --reportRoot reports/community-corpus --runLabel <v1-1-label> --threshold 0.05 --viewportIds desktop`
  - `npx vitest run tests/unit/media/font-format.test.ts tests/unit/design-bundle/schema.test.ts tests/unit/project-store/store.test.ts tests/unit/contracts/ui-spec.test.ts tests/unit/static-generation/style-mapper.test.ts tests/unit/static-generation/node-mapper.test.ts tests/unit/static-generation/visual-asset-priority.test.ts tests/unit/static-generation/visual-layer-planner.test.ts tests/unit/static-generation/report-schema.test.ts tests/unit/static-generation/report-markdown.test.ts tests/unit/figma/visual-asset-backfill-manifest.test.ts tests/unit/preview/catalog.test.ts tests/unit/preview/json-render-adapter.test.ts`
  - `npx vitest run tests/integration/figma/rest-client.test.ts tests/integration/figma/assets.test.ts tests/integration/figma/inspector.test.ts tests/integration/figma/visual-asset-backfill.test.ts tests/integration/validation/render-and-compare.test.ts tests/integration/static-generation/m5-static.test.ts`
  - `npx playwright test tests/e2e/preview.spec.ts tests/e2e/catalog.spec.ts`
  - `npm run typecheck`
  - `git diff --check`
- done conditions：Mobile、Dashboard、Ecommerce、Landing 均 `<5%`；`passed5PctCount>=4`；功能/console/coverage/secret gates 通过。
- stop/escalate：保护样本 `>=5%`、coverage 回退、API boundary true 或秘密命中。
- handoff：T10。
- covers：AC7-AC12。

### T10：Worktrail Validation 收口

- goal：把实际结果形成待审验证事实。
- prerequisites：T09 完成或有明确失败归因。
- must-read：v1 validation 与 v1.1 final reports。
- owns：`validation/figma-to-ui-agent-generator-fidelity-v1-1-result.md` pending candidate。
- must-not-touch：正式知识、candidate lifecycle、Git。
- actions：创建中文 validation candidate，准确区分达成/部分达成/阻塞；运行 `worktrail review plan --format json`。
- expected outputs：一个待审 validation candidate。
- verify：redaction clean、相对报告路径、review plan 可见。
- done conditions：不自动 promote/discard/commit/push。
- stop/escalate：报告含敏感信息或不可复现。
- handoff：用户 lifecycle 决策。
- covers：AC9-AC12。

## 10. 风险与回滚

| 风险 | 缓解 | 回滚 |
| --- | --- | --- |
| 字体来源/许可不明 | GATE-FONT-ASSET | 不导入 |
| 数值字重破坏旧消费者 | additive union + 旧 fixture | 恢复旧 mapper/schema，使用旧 revision |
| 字体时序不稳定 | readiness + fail closed | 使用前一 DesignBundle revision |
| parent/operands 重复 | ownership/coverage 测试 | 回退规则或 bundle revision |
| 429/部分下载 | 分 project 原子 apply、脱敏日志 | 不保存 revision；orphan 不可服务 |
| 通过样本回退 | 固定六样本保护 | 回退具体通用规则/revision |
| Dashboard 未达标 | 明确停止条件 | 转 v2 compound design |

## 11. Residual Assumptions

- assumption：可获得所需静态 normal face 且许可明确。
  validation_method：GATE-FONT-ASSET 按 family/weight/hash 登记；缺 face 不执行 T07。
- assumption：Dashboard compound parent PNG 足以复现 paint/effect。
  validation_method：T08 targeted compare；失败转 v2。
- assumption：`png/scale=1` 与 CSS pixel bounds 一致。
  validation_method：fixture 与授权节点比较 intrinsic/rendered bounds；不一致先修 density contract。
- assumption：当前 dirty v1 代码是继续基础。
  validation_method：GATE-00 保存 status/diff/hash；只追加明确范围，不回退用户修改。

## 12. Coding Agent 起始指令

1. `worktrail context --semantic=auto "Generator Fidelity v1.1"`。
2. 读取正式 v1.1 architecture/workflow、v1 validation 和 final reports。
3. 执行 GATE-00，失败则停止。
4. 确认 GATE-SCHEMA 后从 T01 开始。
5. T01-T06 不访问外部服务；之后分别等待 GATE-FONT-ASSET 与 GATE-FIGMA-BACKFILL。
6. 不自动改依赖、不执行 Git lifecycle、不处理无关 dirty 文件。
