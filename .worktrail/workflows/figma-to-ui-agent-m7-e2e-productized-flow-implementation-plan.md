---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-m7-e2e-productized-flow-implementation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent M7 端到端产品化主流程执行计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---
# Figma-to-UI Agent M7 端到端产品化主流程执行计划

## 1. 计划目标

本计划用于指导 coding agent 自主完成 M7：将已有 Figma REST、DesignBundle、UISpec、static generation、preview、validation、report 能力串成一个产品化端到端主流程。M7 完成后，agent 可以通过一个稳定 CLI 从 Figma 输入生成 UI，并获得机器可读结果与人工摘要。

M7 以完成功能为前提，优先交付本地可复跑路径；真实 Figma/OpenAI live 调用不属于默认实现验证范围，必须单独授权。

## 2. 修订说明

本版修订解决审核问题：
1. 不再要求 ProjectStore 创建 run record；M7 v1 使用 `runId`、`reports/m7-e2e/<runId>/` 和 artifact refs 表示运行。
2. local 模式增加 `designBundleRevision`，本地验收优先固定 revision。
3. M7 v1 采用 CLI-first，不新增 PI tool，不修改当前 `EXACT_TOOL_NAMES` 四工具白名单。
4. T08 改为通过 `worktrail draft create --type validation` 创建 pending validation candidate，不直接写正式 `.worktrail/validation` 知识文件。

## 3. 对齐来源

- M7 设计候选：`architecture/figma-to-ui-agent-m7-e2e-productized-flow-design.md`。
- M6 最终结论：Generator Fidelity v1.2 已达成 community corpus 6/6 低于 5%，extended smoke 8/8 通过，unsupported/warnings 为 0。
- 已有核心模块：`src/figma/*`、`src/project-store/store.ts`、`src/static-generation/*`、`src/preview/server.ts`、`src/validation/render-and-compare.ts`、`src/runtime/*`、`src/tools/contracts.ts`。
- 已有入口脚本：`scripts/start-agent.mjs`、`scripts/run-m5-static.mjs`、`scripts/run-m5-live-restricted.mjs`、`scripts/run-generator-fidelity-corpus.mjs`。
- 现有测试目录：`tests/unit/*`、`tests/integration/*`、`tests/e2e/*`。
- 约束：不新增依赖、不调用外部服务、不执行 Git，除非用户后续明确授权。

## 4. 授权边界

默认允许：
- 修改本地源码、脚本、测试、报告输出逻辑、Worktrail pending validation candidate。
- 运行本地 typecheck、unit、integration、local fixture 验证。
- 读取本地 `.envrc` 中是否存在变量名，但不得输出 secret 值。

默认禁止：
- 调用 Figma live API。
- 调用 OpenAI。
- 安装依赖或修改 lockfile。
- 提交、推送、删除大量历史报告。
- 使用整页 screenshot/backgroundSnapshot fallback 作为最终 UI。
- 修改 PI tool boundary 或新增 agent tool；这属于 M7.1 或单独 gate。

需要单独 gate：
- `GATE-M7-LIVE-FIGMA`：真实 restricted-live/live Figma 测试。
- `GATE-M7-OPENAI`：任何 OpenAI 调用。
- `GATE-M7-DEPS`：新增依赖或改变工具链。
- `GATE-M7-PI-TOOL`：新增 PI tool 或修改 `EXACT_TOOL_NAMES`。
- `GATE-M7-GIT`：提交或推送。

## 5. 并行性

[parallelism:
- independent lanes: contract/schema 单测、CLI 参数解析、report schema 可在设计稳定后并行开发
- sequential blockers: T01 契约先于 T02/T03；T03 orchestration 先于 T06 local e2e；T06/T07 先于 T08 validation candidate
- shared write surfaces: `src/runtime/*`、`scripts/*`、`package.json`、`tests/unit/runtime/*`、`tests/integration/*`
- delegation: 0，首版 M7 涉及统一入口和共享契约，单 agent 顺序实施更安全
]

## 6. 验收映射

- AC1 本地一条命令：T02、T03、T06。
- AC2 输入契约：T01、T02、T07。
- AC3 输出契约：T01、T04、T06。
- AC4 外部服务 gate 和脱敏：T03、T04、T07。
- AC5 复用现有模块：T03、T05、自审。
- AC6 报告控制：T04、T06。
- AC7 测试覆盖：T01、T02、T06、T07。
- AC8 PI/coding agent 可调用 CLI：T02、T05、T08。

## 7. 实施任务

### T00：进入 M7 Gate 和基线确认

改动：无业务代码改动。

步骤：
1. 运行 Worktrail context，确认 M7 设计和计划已 promote 或用户明确采用。
2. 检查 `git status --short`，记录 unrelated untracked/dirty 文件，不清理。
3. 读取 `package.json` scripts、`src/runtime/*`、`src/tools/contracts.ts`、`src/runtime/tool-boundary.ts`、`scripts/start-agent.mjs`、`scripts/run-m5-static.mjs`、`src/static-generation/service.ts`、`src/project-store/store.ts` 的当前形态。
4. 记录当前 `EXACT_TOOL_NAMES` 为四个工具，M7 v1 不修改。

验证：
- 输出基线记录，说明不会调用外部服务、不会改依赖、不会执行 Git、不会改 tool boundary。

### T01：定义 M7 契约和错误分类

建议文件：
- `src/runtime/e2e-flow-contracts.ts`
- `tests/unit/runtime/e2e-flow-contracts.test.ts`

实现：
1. 定义 `M7RunRequest`、`M7RunResult`、`M7RunError`。
2. 定义 mode：`local | restricted-live | live`。
3. 定义 `designBundleRevision?: number` 和 `designBundleRevisionSource: explicit | current | generated`。
4. 定义 error categories：`input_invalid`、`auth_missing`、`figma_permission_denied`、`figma_rate_limited`、`figma_not_found`、`bundle_generation_failed`、`static_generation_partial`、`render_compare_failed`、`validation_failed`、`internal_error`。
5. 定义脱敏 helper，保证 error details 不包含 token/secret。

验证：
- 单测覆盖合法 request、非法 mode、缺 projectId、非法 revision、错误分类、脱敏。
- `npm run typecheck` 通过。

### T02：实现统一 CLI 入口

建议文件：
- `scripts/run-figma-to-ui.mjs`
- `package.json`
- `tests/integration/runtime/e2e-flow-cli.test.ts` 或项目既有 integration 测试位置。

实现：
1. 支持参数：`--figma-url`、`--file-key`、`--node-id`、`--project-id`、`--designBundleRevision`、`--mode`、`--run-label`、`--viewport`、`--threshold`、`--json`、`--reportRoot`。
2. 默认 `--mode local`。
3. CLI 只做参数解析、调用 service、stdout JSON、exit code 映射。
4. 非法输入返回 `input_invalid`，不抛未处理异常。
5. 在 `package.json` 增加 `run:m7:e2e` script；不改 dependencies 和 lockfile。

验证：
- invalid URL、缺 projectId、非法 mode、非法 designBundleRevision 的 CLI 测试。
- `node scripts/run-figma-to-ui.mjs --help` 输出可读帮助。
- `git diff package.json package-lock.json` 确认未改依赖和 lockfile。

### T03：实现 Runtime Orchestration Service

建议文件：
- `src/runtime/e2e-flow-service.ts`
- `src/runtime/e2e-flow-errors.ts`，仅当错误映射拆分后更清晰时新增。
- `tests/unit/runtime/e2e-flow-service.test.ts`

实现：
1. `runM7E2EFlow(request): Promise<M7RunResult>`。
2. Validate Input：复用 `src/figma/url.ts`，校验 projectId、revision、mode、gate。
3. Create Run Context：创建 runId，准备 `reports/m7-e2e/<runId>/`；不得调用不存在的 ProjectStore run record API。
4. Acquire Design：local 读取指定 revision 或 current bundle；restricted-live/live 检查 gate 后再进入 Figma REST path。
5. Normalize：复用 `src/figma/normalize.ts`。
6. Asset Backfill：复用 visual asset/backfill 能力；无 gate 时跳过并记录 skip reason。
7. Generate UISpec：复用 `src/static-generation/service.ts`。
8. Save UISpec：使用 `ProjectStore.saveUISpec`，以现有 DesignBundle revision 作为引用来源。
9. Render/Validate：复用 preview 和 render-and-compare；缺参考图时输出 skip，不失败。
10. Report：调用 T04 report writer。

验证：
- 单元测试用 fake store/fake generation service 覆盖 happy path 和每个主要错误分类。
- local 模式 mock 禁止网络调用。
- 固定 `designBundleRevision` 时结果报告标记 `explicit`；未传时标记 `current`。

### T04：实现报告 writer 和 exit code 映射

建议文件：
- `src/runtime/e2e-flow-report.ts`
- `tests/unit/runtime/e2e-flow-report.test.ts`
- 运行输出：`reports/m7-e2e/<runId>/summary.json`、`reports/m7-e2e/<runId>/summary.md`

实现：
1. 输出固定 schema 的 `summary.json`。
2. 输出中文 `summary.md`，包含输入、产物、指标、warnings、unsupported、错误分类、nextAction、revision source。
3. 默认只写 summary；step trace 和截图通过 artifact refs 引用。
4. exit code：成功 0；输入错误 2；认证/权限 3；限流 4；验证失败 5；内部错误 1。
5. 报告不得包含 token、secret 或完整私有 payload。

验证：
- report schema 单测。
- error details 和 markdown 脱敏测试。
- summary 中包含 `designBundleRevisionSource`。

### T05：验证 CLI-first Agent 边界兼容

建议文件：
- `src/runtime/tool-boundary.ts` 只读验证，不修改。
- `scripts/start-agent.mjs` 只读验证，不修改。
- `tests/integration/extension/tool-wiring.test.ts` 如需增加断言，只确认现有四工具未变。

实现：
1. 确认 M7 v1 不新增 agent tool。
2. 确认 `EXACT_TOOL_NAMES` 保持 `inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`。
3. 在文档或 validation 中说明 PI/coding agent 通过 CLI 调用 M7。
4. 若发现现有 tool-wiring 测试已覆盖四工具白名单，不需要新增测试。

验证：
- `npm run test:integration -- tests/integration/extension/tool-wiring.test.ts` 或等效 targeted validation。
- `git diff src/runtime/tool-boundary.ts scripts/start-agent.mjs` 为空，除非后续明确授权 `GATE-M7-PI-TOOL`。

### T06：本地端到端验证

建议命令：
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `node scripts/run-figma-to-ui.mjs --mode local --project-id <existing-local-project> --designBundleRevision <revision> --json`

实现：
1. 选择一个已存在本地 fixture/cache 样本作为 M7 smoke。
2. 优先使用显式 `designBundleRevision`，避免 current 漂移。
3. 运行一条命令完成 local e2e。
4. 检查 summary.json、summary.md、artifact refs。
5. 确认 unsupported/warnings、diff、skip reason 均可解释。

验证：
- AC1、AC3、AC6、AC8 通过。
- 报告中 `designBundleRevisionSource=explicit`。

### T07：Gate Negative Tests

实现：
1. local 模式下传入 live-only 参数，不应发网络请求。
2. restricted-live/live 缺 gate 返回稳定错误。
3. 缺 token 返回 `auth_missing`。
4. mock 429 返回 `figma_rate_limited`，包含 retryAfter/nextAction。
5. 确认 OpenAI 默认禁止。

验证：
- negative tests 通过。
- 日志和 reports 脱敏。

### T08：最终验收记录和 Worktrail 更新

建议方式：
- 使用 `worktrail draft create --scope project --type validation --target validation/figma-to-ui-agent-m7-e2e-productized-flow-validation.md ...` 创建 pending validation candidate。
- 不直接编辑正式 `.worktrail/validation` 知识文件。

内容：
1. 记录实现范围、命令、测试结果、未调用外部服务声明。
2. 记录 local e2e 输出摘要和 report paths。
3. 记录 `designBundleRevision` 与 `designBundleRevisionSource`。
4. 记录仍需 gate 的 live 验证项。
5. 若需要 promote，等待用户明确确认。

验证：
- `worktrail review plan --format json` 能看到 M7 validation candidate。

## 8. 推荐实施顺序

1. T00：基线确认。
2. T01：契约和错误分类。
3. T02：CLI 入口。
4. T03：orchestration service。
5. T04：report writer。
6. T05：CLI-first agent 边界兼容验证。
7. T06：local e2e 验证。
8. T07：gate negative tests。
9. T08：Worktrail validation draft。

不要先做 live blind test。M7 的首要风险是入口和契约不稳定，而不是视觉 diff 不足。

## 9. 回滚策略

- 若 CLI 集成失败，可保留 service 和 tests，暂不暴露 package script。
- 若 report schema 需要调整，保持 `M7RunResult` 向后兼容，新增字段不删除字段。
- 若 local fixture 数据不稳定，改用显式 `designBundleRevision` 固定样本；current 仅保留便利模式。
- 若后续要新增 PI tool，先暂停 M7 v1，另开 `GATE-M7-PI-TOOL` 设计与测试，不在本计划内隐式修改 tool boundary。

## 10. 完成定义

M7 视为完成必须同时满足：
1. 存在一个本地可执行的一条命令入口。
2. 存在 runtime service 和稳定 request/result/error contract。
3. local 模式不触发 Figma/OpenAI 网络请求。
4. 至少一个本地样本通过显式 `designBundleRevision` 端到端完成，并生成 summary.json/summary.md。
5. invalid input、missing auth/live gate、mock rate limit 有自动化测试。
6. typecheck、unit、integration 或等效 targeted validation 通过。
7. PI/coding agent 可从单个 CLI JSON 结果判断成功、失败类别和 nextAction。
8. 现有四工具 tool boundary 未被 M7 v1 破坏。
9. Worktrail 有 pending validation candidate，promote 需要用户另行确认。

## 11. 残余假设

1. 不新增 PI tool 足以满足 M7 v1 的 agent-facing 要求。
   - validation_method：T05 通过 CLI 使用说明和 tool boundary 测试确认；如用户要求 PI 内置 tool，转入 M7.1。
2. 本地样本存在可用 DesignBundle revision。
   - validation_method：T00/T06 查询 ProjectStore 当前样本；若没有，先生成本地 fixture，不调用 live 服务。
