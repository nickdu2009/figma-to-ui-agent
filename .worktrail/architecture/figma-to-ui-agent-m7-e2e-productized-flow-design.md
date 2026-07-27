---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-m7-e2e-productized-flow-design",
  "scope": "project",
  "type": "architecture",
  "title": "Figma-to-UI Agent M7 端到端产品化主流程设计",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---
# Figma-to-UI Agent M7 端到端产品化主流程设计

## 1. 背景和定位

M6 已完成 Generator Fidelity v1.2 的收敛：Community corpus 6/6 低于 5% 视觉差异，平均 diff 约 2.36%，最大 diff 约 4.47%，extended smoke 8/8 通过，unsupported/warnings 为 0。M7 不再以单点视觉修补为主，而是把已验证的能力产品化为一个 coding agent 可自主调用、可诊断、可复跑的端到端主流程。

M7 的核心交付是：从 Figma 输入到 UI 生成、预览、验证、报告输出的一条统一入口。Agent 不应再手工串联 M3/M4/M5/M6 的零散脚本，而应调用稳定 CLI，并从机器可读结果判断下一步。

## 2. 修订说明

本版修订解决以下审核问题：
1. 当前 ProjectStore 没有明确 run record API，因此 M7 v1 不假设 ProjectStore 创建 run record，而是使用 `runId`、`reports/m7-e2e/<runId>/` 和 artifact refs 表示一次运行。
2. local 模式增加 `designBundleRevision`，避免默认 current bundle 造成验收漂移。
3. M7 v1 采用 CLI-first，不新增 PI tool，也不修改当前四工具 tool boundary；PI/coding agent 可通过命令调用。
4. Worktrail 验收记录必须通过 `worktrail draft create --type validation` 创建 pending candidate，不直接写正式 `.worktrail/validation` 知识文件。

## 3. 设计目标

1. 提供一个 agent-facing 统一 CLI，支持从 Figma URL 或 fileKey/nodeId 启动完整流程。
2. 复用现有 DesignBundle、UISpec、ProjectStore artifact 存储、static-generation、preview、render-and-compare 能力，不建立第二套持久状态系统。
3. 默认支持本地/缓存模式，避免实现阶段误触 Figma/OpenAI 外部服务。
4. 将 live Figma、OpenAI、asset backfill 等外部能力放入显式 gate，默认 fail-closed。
5. 输出稳定 JSON 结果和 Markdown 摘要，便于 coding agent、测试脚本和人工审查共同使用。
6. 保持 UISpec 为唯一中间产物，禁止整页 screenshot/backgroundSnapshot fallback。
7. 对失败原因做稳定分类，给出 recoverable 与 nextAction，避免 agent 盲目重试。

## 4. 非目标

1. M7 不追求新的视觉阈值突破；视觉保真继续沿用 M6 的 3% 到 5% perceptual fidelity 目标。
2. M7 不新增第三方依赖，除非后续单独 gate 授权。
3. M7 不默认调用 Figma live API 或 OpenAI。
4. M7 不实现全量 Figma 编辑能力，也不引入 Figma Desktop MCP 作为必选路径。
5. M7 不把整页截图作为最终 UI；局部 SVG、image、icon、decorative asset 仍允许作为视觉保真层。
6. M7 v1 不新增 PI tool，不修改 `EXACT_TOOL_NAMES`；如后续需要工具级集成，作为 M7.1 单独设计和测试。

## 5. 系统边界

M7 位于现有 pipeline 之上，是 orchestration 层，不替代底层模块。

主要输入：
- figmaUrl：Figma design/community URL。
- fileKey：从 URL 或参数解析出的 Figma file key。
- nodeId：可选，指定 artboard/page/root node。
- projectId：本地项目存储命名空间。
- designBundleRevision：可选，local 模式优先使用指定 DesignBundle revision；缺省时读取 current 并在报告中标记 `current`。
- mode：local、restricted-live、live。
- runLabel：可选的人类可读运行标签。
- viewportIds：可选，选择验证 viewport。
- threshold：可选，默认沿用 M6 视觉阈值。

主要输出：
- runId。
- projectId。
- input 规范化结果。
- DesignBundle revision/reference。
- UISpec revision/reference。
- generated app/static artifact reference。
- preview URL 或静态产物路径。
- validation metrics。
- warnings/unsupported/error 分类。
- human report 与 machine report 路径。
- exitCode/category/nextAction。

## 6. 组件分解

### 6.1 CLI 入口

新增 `scripts/run-figma-to-ui.mjs`，并在 `package.json` 暴露 `run:m7:e2e`。

职责：
- 解析 CLI 参数。
- 调用 runtime orchestration service。
- 将结果写入 stdout JSON 或指定 report 目录。
- 根据错误分类返回稳定 exit code。

CLI 不直接实现 Figma 抽取、UISpec 生成或视觉比较逻辑。

### 6.2 Runtime Orchestration Service

新增 `src/runtime/e2e-flow-service.ts`。

职责：
- 接收 `M7RunRequest`。
- 调用 URL parser、ProjectStore artifact API、Figma acquisition、normalizer、static generation、preview/validation、report writer。
- 保持步骤级 trace。
- 汇总 `M7RunResult`。
- 保证外部服务 gate fail-closed。

### 6.3 输入解析和策略层

复用 `src/figma/url.ts` 解析 URL。新增或扩展轻量 contract：
- local：只读本地 ProjectStore/cache/fixtures；支持固定 `designBundleRevision`。
- restricted-live：允许 Figma REST，禁止 OpenAI，使用现有限流和 429 日志。
- live：允许 Figma REST 与 OpenAI，但必须由显式 gate 参数或环境配置开启。

### 6.4 数据获取层

复用：
- `src/figma/rest-client.ts`
- `src/figma/normalize.ts`
- `src/figma/assets.ts`
- `src/figma/visual-asset-backfill.ts`
- `src/figma/capability-policy.ts`

M7 只编排这些能力。遇到缺 token、权限不足、429、404、asset backfill 缺失时，返回结构化错误，不把错误压成 generic failure。

### 6.5 ProjectStore 和运行产物

复用 `src/project-store/store.ts` 作为 DesignBundle、FlowPlan、UISpec、local image、local font 等 artifact 的事实来源。当前 ProjectStore 没有 run record API，因此 M7 v1 不在 ProjectStore 内新增运行记录。

M7 v1 的一次运行由以下内容表示：
- `runId`：命令级唯一 ID。
- `reports/m7-e2e/<runId>/summary.json`：机器可读运行摘要。
- `reports/m7-e2e/<runId>/summary.md`：中文人工摘要。
- artifact refs：指向 ProjectStore 中的 DesignBundle revision、UISpec revision、validation artifacts 或生成产物。

如后续需要 ProjectStore 原生 run artifact，应作为独立 schema 变更和迁移任务，不混入 M7 v1。

### 6.6 UISpec 生成层

复用 `src/static-generation/service.ts` 及 page/node/visual layer mapper。M7 必须维持以下约束：
- UISpec 是唯一中间产物。
- 结构化交互层继续输出 input、button、link、text、section、stack。
- 视觉保真层继续输出 vectorAsset、decorativeLayer、imageAsset、iconAsset 或等效现有模型。
- 禁止整页 screenshot fallback。

### 6.7 预览和验证层

复用：
- `src/preview/server.ts`
- `src/validation/render-and-compare.ts`

M7 支持有参考截图时运行 diff，无参考截图时输出生成结果和 skip reason。视觉 diff 是诊断指标，不作为未知外部文件的唯一硬门禁；M6 corpus 仍保持 <5% 的 regression gate。

### 6.8 报告层

新增轻量 report writer，输出：
- `reports/m7-e2e/<runId>/summary.json`
- `reports/m7-e2e/<runId>/summary.md`
- 可选 step trace 和 validation artifacts。

默认只保留 final summary；详细中间产物以 artifact refs 指向 ProjectStore，避免报告目录继续膨胀。

### 6.9 Agent 调用方式

M7 v1 的 agent-facing 集成采用 CLI-first：PI/coding agent 通过 `node scripts/run-figma-to-ui.mjs ... --json` 或 `npm run run:m7:e2e -- ...` 调用。这样不修改当前 `EXACT_TOOL_NAMES` 四工具白名单，不影响 `scripts/start-agent.mjs` 的现有 tool boundary。

若后续确需在 PI agent 内新增工具，应另立 M7.1：新增 tool 名、schema、service method、tool inventory 测试和向后兼容验证。

## 7. 数据模型

### 7.1 M7RunRequest

```ts
type M7RunRequest = {
  figmaUrl?: string;
  fileKey?: string;
  nodeId?: string;
  projectId: string;
  designBundleRevision?: number;
  mode: "local" | "restricted-live" | "live";
  runLabel?: string;
  viewportIds?: string[];
  threshold?: {
    pixelDiffPercent?: number;
    warningDiffPercent?: number;
  };
  gates?: {
    allowFigmaNetwork?: boolean;
    allowOpenAI?: boolean;
    allowAssetBackfill?: boolean;
  };
};
```

### 7.2 M7RunResult

```ts
type M7RunResult = {
  ok: boolean;
  runId: string;
  projectId: string;
  input: {
    figmaUrl?: string;
    fileKey?: string;
    nodeId?: string;
    designBundleRevision?: number;
    designBundleRevisionSource: "explicit" | "current" | "generated";
    mode: "local" | "restricted-live" | "live";
  };
  artifacts: {
    designBundleRef?: string;
    uiSpecRef?: string;
    generatedAppRef?: string;
    validationRef?: string;
    summaryJson: string;
    summaryMarkdown: string;
  };
  metrics?: {
    pages: number;
    passedPages?: number;
    maxPixelDiffPercent?: number;
    averagePixelDiffPercent?: number;
    warnings: number;
    unsupported: number;
  };
  error?: M7RunError;
  nextAction?: string;
};
```

### 7.3 M7RunError

```ts
type M7RunError = {
  category:
    | "input_invalid"
    | "auth_missing"
    | "figma_permission_denied"
    | "figma_rate_limited"
    | "figma_not_found"
    | "bundle_generation_failed"
    | "static_generation_partial"
    | "render_compare_failed"
    | "validation_failed"
    | "internal_error";
  message: string;
  recoverable: boolean;
  nextAction: string;
  details?: Record<string, unknown>;
};
```

所有 error details 必须脱敏，不输出 token、完整 secret、私有 payload。

## 8. 关键流程

1. Validate Input：解析 URL 或 fileKey/nodeId，校验 projectId、designBundleRevision、mode、gate。
2. Create Run Context：创建 runId，准备 `reports/m7-e2e/<runId>/`；不写 ProjectStore run record。
3. Acquire Design：local 读取指定 revision 或 current bundle；restricted-live/live 调用 Figma REST 并保存 DesignBundle。
4. Normalize Bundle：生成或读取 DesignBundle。
5. Backfill Assets：按 gate 和能力策略补齐局部 vector/image/icon/decorative asset。
6. Generate UISpec：调用 static generation，保持结构化交互层和视觉保真层。
7. Save UISpec：通过 ProjectStore 保存 UISpec artifact。
8. Render Preview：生成静态 UI 并启动/复用 preview server。
9. Validate：有基准图则执行 render-and-compare；无基准图则记录 skip reason。
10. Report：写 summary.json 和 summary.md。
11. Exit：按 ok/error category 返回稳定退出码。

## 9. 外部服务 Gate

默认策略：
- local：禁止所有网络访问。
- restricted-live：允许 Figma REST；禁止 OpenAI；必须复用限流和 429 日志。
- live：Figma/OpenAI 需显式 allow gate；否则 fail-closed。

M7 实现期间默认只做 local 和 gated negative tests。真实 live 测试必须由用户单独授权。

## 10. 失败分类和恢复建议

- input_invalid：修正 URL、fileKey、nodeId、projectId 或 designBundleRevision。
- auth_missing：配置 FIGMA_API_KEY 或相应凭据。
- figma_permission_denied：检查 Figma token scope 或文件访问权限。
- figma_rate_limited：等待 retryAfter，降低并发，复用客户端限流。
- figma_not_found：检查 fileKey/nodeId 是否存在或 token 是否有文件访问。
- bundle_generation_failed：检查 Figma payload 或本地 cache 是否完整。
- static_generation_partial：检查 unsupported/warnings 和 UISpec 生成日志。
- render_compare_failed：检查 preview server、Playwright、截图尺寸。
- validation_failed：功能或视觉 gate 未过。
- internal_error：实现缺陷，需保留 step trace 便于定位。

## 11. 非功能要求

- 可复跑：local 模式应优先使用显式 `designBundleRevision`；使用 current 时必须在报告中标记。
- 可诊断：每个阶段有 step trace 和 artifact ref。
- 可控成本：默认 local；live 需要 gate；不额外扩展 API 请求量。
- 可维护：复用现有模块；M7 orchestration 不复制底层逻辑。
- 可测试：核心 service 单元测试、CLI 参数测试、local integration 测试、gate negative tests。
- 安全：日志和报告不得泄露 token 或 secret。

## 12. 验收标准

AC1：一条本地命令可在现有 fixture/cache 上完成 Figma-to-UI 端到端流程，无需外部服务。

AC2：输入契约稳定验证 Figma URL、fileKey、nodeId、projectId、designBundleRevision、mode，并对非法输入输出 `input_invalid`。

AC3：输出契约包含 projectId、DesignBundle ref/revision、UISpec ref/revision、报告路径、页面数、视觉指标、warnings、unsupported 和 nextAction。

AC4：live Figma/OpenAI 默认关闭；缺 token、未授权 gate、权限错误、429 均返回稳定分类并脱敏。

AC5：M7 复用现有 ProjectStore artifact API、Figma REST client、normalizer、static-generation、preview、validation，不引入第二套持久状态系统。

AC6：报告默认输出 summary.json 和 summary.md；详细产物通过 artifactRefs 串联，避免无界报告膨胀。

AC7：测试覆盖 local explicit revision happy path、local current 标记、invalid URL、missing token/live gate、禁止整页 screenshot fallback、report schema。

AC8：PI/coding agent 可通过一个 CLI 命令调用 M7，并能仅凭 JSON 结果判断下一步。

## 13. ADR 索引

M7-ADR-001 proposed：M7 作为 orchestration 层，复用现有 ProjectStore artifact API 和 static-generation，不引入新持久状态系统。

M7-ADR-002 proposed：外部服务默认 fail-closed；local 是默认验收路径，restricted-live/live 必须显式 gate。

M7-ADR-003 proposed：UISpec 保持唯一中间产物；禁止整页 screenshot fallback，允许局部 asset 作为视觉保真层。

M7-ADR-004 proposed：M7 v1 采用 CLI-first；不新增 PI tool，不修改现有四工具 tool boundary。

## 14. 风险和缓解

风险：M7 入口变成脚本堆叠，难以维护。
缓解：CLI 只负责参数和退出码，业务编排放入 runtime service。

风险：local、restricted-live、live 混在一起导致误触外部服务。
缓解：mode 和 gates 双重校验，默认 fail-closed，并加入 negative tests。

风险：local current bundle 漂移导致复跑不稳定。
缓解：支持 `designBundleRevision`；验收样本使用显式 revision；current 仅作为便利模式并在报告中标记。

风险：报告继续膨胀。
缓解：默认只写 final summary，详细数据通过 artifactRefs 指向 ProjectStore 或显式 run 目录。

风险：agent 无法理解失败。
缓解：稳定 error category、recoverable、nextAction 和脱敏 details。

风险：M7 误把视觉 diff 当唯一目标。
缓解：沿用 M6 结论，将功能、键盘、console、unsupported/warnings 和 perceptual fidelity 共同作为验收。

## 15. 残余假设

1. M7 的默认实现不新增依赖。
   - validation_method：实施前检查 `package.json` 和 lockfile diff，确认无依赖变化。
2. M7 第一阶段不调用 Figma/OpenAI live 服务。
   - validation_method：local 和 negative tests 断言 gate fail-closed，运行记录声明未调用外部服务。
3. M7 以现有 M6 corpus 和本地 cache 作为初始验收样本。
   - validation_method：T06 使用显式 DesignBundle revision 和固定 projectId 输出报告。
