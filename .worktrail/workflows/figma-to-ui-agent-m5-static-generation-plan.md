---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "workflow-figma-to-ui-agent-m5-static-generation-plan",
  "scope": "project",
  "type": "workflow",
  "title": "Figma-to-UI Agent M5 多 Artboard 静态生成实施计划",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M5 多 Artboard 静态生成实施计划

## 修订说明

本版修复计划审核发现的问题：

- 视觉层追溯不直接写入 `UISpec` 节点。M5 默认选择 report-owned provenance：`UISpec` 只保存当前 schema 可渲染字段，`StaticGenerationReport.visualLayers[]` 负责保存 `sourceNodeId`、`uiSpecNodeId`、bounds、zIndex、opacity、reason 和 coverage。
- 新增 `M5StaticReport` 契约，避免逐页诊断成为自由文本。
- 新增 `GATE-M4-VALIDATION`，区分“代码本地完成”和“Worktrail validation 已推广”。
- 新增 `GATE-WORKTRAIL-HYGIENE`，推广前必须解决同 target 重复 pending candidate。

## 来源与对齐

- 当前目标：在 M4 正式 FlowPlan 完成后，制定 M5 可执行计划，指导 coding agent 自主实现下一阶段能力。
- 事实基线：M4 正式 FlowPlan 代码已完成并通过本地 typecheck、unit、integration；M4 验收记录仍是 pending candidate，尚未 promote。因此 M5 可以按代码事实继续规划，但推广 M5 前必须通过 `GATE-M4-VALIDATION`。
- 正式知识来源：
  - `architecture/figma-to-ui-agent-mvp-solution.md`
  - `architecture/figma-to-ui-agent-flow-plan-conclusion.md`
  - `workflows/figma-to-ui-agent-m4-formal-flowplan-implementation-plan.md`
  - `workflows/figma-to-ui-agent-unsupported-features-backlog.md`
  - `validation/figma-to-ui-agent-m4-flowplan-spike-result.md`
- 代码基线：
  - `src/design-bundle/schema.ts` 已表达页面、节点、bounds、layout、text、visual、imageRefs、provenance。
  - `src/ui-spec/schema.ts` 已支持多页面、route、structured node、style、frame、button icon asset、`pixel_overlay`、`sourceFlowPlanRevision`；节点 schema 是 strict，不能随意塞入 `sourceNodeId` 或 `reason`。
  - `src/runtime/inspect-agent-context.ts` 已提取 `visualLayers`，包含 reason、layerRole、zOrder、bounds、pageRelativeBounds、localImageRefs、renderedAssetPath、recommendedUISpecUse。
  - `src/figma/inspector.ts` 已能把重要 visual layer 渲染为局部 PNG，保存到 DesignBundle screenshots/provenance。
  - `src/project-store/store.ts` 已拒绝 root 单截图 / root 单 overlay 伪通过，并校验 DesignBundle / UISpec / FlowPlan 引用。
  - `src/preview/json-render-adapter.ts` 已支持 `pixel_overlay` 和 button icon asset 渲染。
- 阶段定位：M5 是“多 artboard 静态生成与逐页验证”，不是 M6 路由和 Flow 执行验证，也不是 M7 状态、表单和业务交互。

## 目标

M5 要让 coding agent 在已有 DesignBundle 基础上，为多个 Figma artboard / page 生成结构化、可渲染、可逐页验证的 UISpec 草稿。

成功状态：

1. 多个目标 artboard 能稳定映射为多个 UISpec page。
2. 每个 page 保留真实 DOM 文本、图片、按钮、输入等结构化节点。
3. 大面积 vector、装饰层、插画、logo、icon、image fill 能以局部 asset / `pixel_overlay` / structured image 的方式保留关键视觉信号。
4. `StaticGenerationReport` 能追溯视觉层从 Figma source node 到 UISpec render node 的映射。
5. 不使用整页截图 fallback，也不通过 root overlay 伪造通过。
6. 逐页生成截图、视觉 diff、结构化覆盖率、unsupportedFeatures 和残余风险报告。
7. 默认不调用外部 Figma/OpenAI；live blind 只作为单独授权 gate。

## 非目标

- 不实现 M6：不自动探索或验证跨页面点击路径，不把 inferred/missing interaction 生成 action。
- 不实现 M7：不做复杂表单提交、条件分支、业务状态机、后端调用或数据持久化。
- 不新增模型可见工具，四工具不变量仍保持：`inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`。
- 不新增 npm 依赖，不修改 package/lockfile，除非单独进入 `GATE-DEPENDENCY`。
- 不调用真实 Figma 或 OpenAI，除非单独进入 `GATE-LIVE-M5`。
- 不追求固定 `<1%` pixel diff，不用整页 screenshot fallback；目标是 perceptual fidelity，推荐诊断目标 `<5%`，高质量目标 `<3%`。
- 不在 M5 默认路径给 UISpec 节点新增 provenance 字段；追溯默认归 `StaticGenerationReport` 所有。若后续必须进入 UISpec schema，先过 `GATE-UISPEC-PROVENANCE`。

## 授权边界

接受本计划只表示可以把它作为 M5 实施来源；不自动授权：

- 修改依赖、package/lockfile 或运行时工具链。
- 调用外部 Figma/OpenAI、访问 live 文件、下载新远端资产。
- 新增模型可见工具名或改变 Pi provider 工具边界。
- commit、push、deploy、删除用户文件、promote / discard Worktrail candidate。
- 变更 M6/M7 的行为契约或业务 Flow 真相来源。

## Truth 与 Ownership

- 设计事实 owner：ProjectStore 中已校验并持久化的 `DesignBundle`。
- 静态生成 owner：M5 新增的静态页面规划器和 UISpec draft。
- 视觉追溯 owner：`StaticGenerationReport.visualLayers[]`，不是 `UISpec` 节点扩展字段。
- 视觉渲染 owner：UISpec 中的 `image`、`pixel_overlay`、button icon asset、受控 style 字段。
- 行为事实 owner：正式 FlowPlan 和用户确认；M5 不新增或猜测行为事实。
- 非 truth surfaces：agent prompt、diff 截图、临时 fixture、未推广 pending candidate。
- 共享写面单 owner：
  - 静态规划器：`src/static-generation/*`。
  - M5 报告契约：`src/static-generation/report.ts` 或 `src/validation/m5-static-report.ts`。
  - UISpec 契约兼容：`src/ui-spec/schema.ts`，仅在 `GATE-UISPEC-PROVENANCE` 后允许改 provenance 字段。
  - inspect context：`src/runtime/inspect-agent-context.ts`。
  - ProjectStore 校验：`src/project-store/store.ts`。
  - validation/report：`src/validation/*`、`scripts/run-m5-static.mjs`。
  - tests：`tests/unit/static-generation/*`、`tests/integration/static-generation/*`。

## 验收标准

- AC1：多 artboard/page selection 稳定；每个目标 Figma page/root frame 有唯一 UISpec page id、path、title、`sourcePageId`，重复名称不会冲突。
- AC2：输入不足时 fail closed；无目标页面、尺寸缺失、sourcePageId 悬空、根节点冲突时给出明确错误或 warning，不生成伪页面。
- AC3：生成结果不使用整页 screenshot fallback；root 单 `image` 或 root 单 `pixel_overlay` 继续被拒绝。
- AC4：每个 page 至少保留可解释的结构化文本层和主要容器层；登录/注册/搜索等明显表单元素生成真实 input/button/link。
- AC5：关键视觉层保留为可渲染 UISpec 节点；其 `sourceNodeId`、source bounds、pageRelativeBounds、zIndex/zOrder、opacity、reason、layerRole、assetRef、uiSpecNodeId 必须进入 `StaticGenerationReport.visualLayers[]`，不得直接塞入当前 strict UISpec 节点 schema。
- AC6：文本样式映射覆盖 font family、font size、font weight、line height、color、文本框宽度、nowrap/wrap 策略；footer 等短文案不因默认布局误换行。
- AC7：图标按钮保留真实 button 语义和 icon asset；图标缺失时降级为纯文本按钮并记录 warning。
- AC8：布局映射能处理 auto-layout、绝对定位视觉层、stack/grid/section、desktop viewport 下的 mobile canvas 对齐和缩放。
- AC9：`unsupportedFeatures` 标准化输出缺口，不把缺少业务说明、未进入 M6/M7 的行为能力误报为 M5 缺陷。
- AC10：逐页验证报告必须通过 `M5StaticReportSchema`，包含 page summary、visual diff、结构化覆盖率、visual layer coverage、文本/图标/CTA/表单区域诊断、unsupportedFeatures 和 residual risks。
- AC11：默认本地验证通过：`npm run typecheck`、`npm run test:unit`、`npm run test:integration`；M5 runner 可在 fixture 上离线执行。
- AC12：M5 报告必须明确“静态页面生成已验证 / 行为 Flow 未验证”，避免把静态还原误报为完整业务 Flow 支持。

## M5StaticReport 契约

M5 必须新增 zod schema，建议落点 `src/static-generation/report.ts`，由 runner 和 integration test 共同使用。

最小结构：

```ts
type M5StaticReport = {
  schemaVersion: "1";
  runId: string;
  projectId: string;
  designBundleRevision: number;
  uiSpecRevision?: number;
  status: "passed" | "failed" | "partial";
  scope: "static_generation_only";
  behaviorFlowVerified: false;
  pages: Array<{
    pageId: string;
    sourcePageId: string;
    sourceRootNodeId?: string;
    path: string;
    viewportRole?: "desktop" | "mobile" | "tablet" | "unknown";
    nodeCounts: {
      text: number;
      input: number;
      button: number;
      image: number;
      pixelOverlay: number;
      total: number;
    };
    structuredCoverage: {
      textNodeCount: number;
      interactiveNodeCount: number;
      fullPageScreenshotFallback: false;
    };
    visualLayerCoverage: {
      candidateCount: number;
      renderedCount: number;
      unsupportedCount: number;
    };
    regions: Array<{
      id: "left_visual" | "form_fields" | "cta" | "social_buttons" | "footer" | "page";
      status: "passed" | "warning" | "failed" | "not_applicable";
      notes: string[];
    }>;
    comparison?: {
      diffPixelRatio: number;
      diffPixels: number;
      screenshotPaths: string[];
    };
  }>;
  visualLayers: Array<{
    sourceNodeId: string;
    uiSpecNodeId?: string;
    sourcePageId: string;
    reason: "large_visual" | "structural_visual" | "named_visual" | "image_visual";
    layerRole: string;
    zOrder: number;
    bounds: { x: number; y: number; width: number; height: number };
    pageRelativeBounds: { x: number; y: number; width: number; height: number };
    opacity?: number;
    assetRef?: string;
    rendered: boolean;
    blockedReason?: string;
  }>;
  unsupportedFeatures: UnsupportedFeature[];
  warnings: Array<{ code: string; detail: string }>;
  residualRisks: string[];
};
```

报告 schema 是 M5 验收的一等产物。`summary.md` 只能由该 JSON 派生，不能作为唯一证据。

## 并行规划

[parallelism:
- independent lanes: page selection mapper、visual layer classification、text/style mapping、report schema 可以先独立设计测试 fixture
- sequential blockers: GATE-M4-VALIDATION 先于 promote；page selection contract 先于 UISpec generation；visual asset contract 和 report-owned provenance 先于 renderer/report；ProjectStore 引用校验先于 runner 保存；runner 先于最终 validation candidate
- shared write surfaces: `src/ui-spec/schema.ts`、`src/project-store/store.ts`、`src/runtime/inspect-agent-context.ts`、`src/validation/*`、`src/static-generation/*`、`scripts/*` 需要单 owner 顺序提交
- delegation: 0；M5 仍是契约和生成管线工作，跨 agent 并写容易造成 schema / renderer / store 不一致
]

## Gate

### GATE-M4-VALIDATION：M4 验收状态确认

- goal：确认 M5 输入基线是已推广 M4 validation，或明确记录只以当前代码事实继续。
- prerequisites：M4 code commit 和本地验证证据存在。
- owns：M5 启动前的治理状态。
- actions：
  1. 检查 `validation/figma-to-ui-agent-m4-formal-flowplan-result.md` 是否已推广。
  2. 若未推广，implementation 可以继续本地编码，但 M5 validation/promote 前必须在报告中标记 `m4ValidationStatus: pending`。
  3. 若用户要求正式知识链闭合，先 review/promote M4 validation candidate。
- verify：`worktrail review plan --format json` 能解释 M4 validation candidate 状态。
- stop/escalate：用户要求在正式知识链未闭合时 promote M5。

### GATE-WORKTRAIL-HYGIENE：候选治理

- goal：推广前解决同 target pending candidate 冲突。
- prerequisites：M5 plan review 完成。
- owns：Worktrail candidate lifecycle，不属于代码实现。
- actions：运行 `worktrail review plan --format json`，对同 target duplicate candidate 获取用户精确确认后 discard/保留。
- verify：目标 `workflows/figma-to-ui-agent-m5-static-generation-plan.md` 只剩一个待推广候选，或用户明确选择其中一个。
- stop/escalate：缺少用户对 discard/promote 的精确确认。

### GATE-00：M5 阶段边界

- goal：确认 M5 只做多 artboard 静态生成与逐页验证。
- prerequisites：M4 正式 FlowPlan 代码基线可用；四工具不变量仍有效。
- owns：M5 go/no-go、非目标、验收边界。
- must-not-touch：M6/M7 行为契约、模型可见工具列表、外部服务、依赖。
- actions：检查当前 Worktrail 正式知识和代码现状，确认 M5 不再重复设计 FlowPlan。
- verify：计划中所有 AC 都能映射到静态生成，不要求 live 或 behavior flow。
- done conditions：coding agent 可以进入 T01。
- stop/escalate：任何要实现 route click flow、自动行为探索、复杂表单状态或新增工具名的需求。

### GATE-01：页面与 artboard 选择契约

- goal：冻结 DesignBundle page/root frame 到 UISpec page 的映射规则。
- owns：`sourcePageId`、page id、path、title、entry page、duplicate name 处理。
- actions：定义 mapper 输入输出、错误语义和稳定排序。
- verify：unit tests 覆盖多 page、重复名称、隐藏根节点、无 rootNodeIds、mobile canvas in desktop viewport。
- stop/escalate：需要用户选择具体 artboard，或 DesignBundle 缺少足够 bounds/provenance。

### GATE-02：视觉保真层契约

- goal：冻结 vector/decorative/image/icon 局部 asset 的表达方式，并确认追溯归报告所有。
- owns：visual layer reason、sourceNodeId、assetRef、frame、zIndex、opacity、pointerEvents、report mapping。
- actions：确定何时用 structured image、何时用 `pixel_overlay`、何时只记录 unsupportedFeature；确定 `StaticGenerationReport.visualLayers[]` 字段。
- verify：LoginUIConcept 类 blob/image/icon 能进入 UISpec 或 diagnostic，不再被丢弃；`uiSpecDraftSchema.parse` 不接收未声明 provenance 字段。
- stop/escalate：需要新增资产导出 API、SVG asset 类型、或现有 image schema 无法表达必要 MIME。

### GATE-UISPEC-PROVENANCE：可选 UISpec provenance 扩展

- goal：只有 report-owned provenance 不够时，才允许扩展 UISpec schema。
- prerequisites：T03/T05 证明报告追溯不能满足 AC5。
- actions：停止实现，先制定 additive UISpec provenance 字段设计和测试矩阵。
- verify：旧 UISpec fixture 兼容，新字段被 renderer/store/tests 正确处理。
- stop/escalate：未经确认不得向 UINode strict schema 添加自由字段。

### GATE-LIVE-M5：可选 live 盲测

- goal：仅在本地 fixture M5 通过后，对真实 Figma 文件做授权盲测。
- prerequisites：用户明确授权 Figma/OpenAI live；限流、脱敏、报告路径已确认。
- owns：live input、run id、脱敏报告。
- verify：报告不含 token、原始 file key、远端资产 URL 或 raw payload。
- done conditions：live 结果作为 validation candidate，不作为默认本地门禁。

### GATE-DEPENDENCY / GATE-COMMIT

- 任何新增依赖、package/lockfile 修改、commit、push 都需要单独确认。

## 实施步骤

### T01：基线审计与 fixture 选择

- goal：确认 M5 可以复用的现有能力和缺口。
- prerequisites：GATE-00。
- must-read：`src/design-bundle/schema.ts`、`src/ui-spec/schema.ts`、`src/runtime/inspect-agent-context.ts`、`src/project-store/store.ts`、`src/figma/inspector.ts`、`tests/fixtures/*`、`workflows/figma-to-ui-agent-unsupported-features-backlog.md`。
- owns：M5 fixture 清单和缺口矩阵。
- must-not-touch：依赖、live credentials、pending unrelated catalog files。
- actions：
  1. 找出现有 multi-page fixture、LoginUIConcept 相关 fixture、visual layer fixture。
  2. 建立 M5 offline fixture：至少包含 2-3 pages、mobile artboard、decorative vector、image fill、social button icon、footer nowrap、basic form。
  3. 记录当前 schema/renderer/store 已支持和缺口。
- expected outputs：`tests/fixtures/m5-static/*` 或复用现有 fixture 的最小增量。
- verify：fixture 能通过 DesignBundle / UISpec 基础 schema 校验。
- done conditions：T02/T03/T04 可基于同一 fixture 写测试。
- stop/escalate：需要真实 Figma live 才能构造 fixture。
- ACs：AC1、AC3、AC5、AC6。

### T02：页面/artboard mapper

- goal：把 DesignBundle pages/root nodes 映射为稳定 UISpec pages。
- prerequisites：T01、GATE-01。
- must-read：`src/design-bundle/schema.ts`、`src/ui-spec/schema.ts`、`tests/unit/flow-plan/page-candidates.test.ts`。
- owns：`src/static-generation/page-mapper.ts`、`tests/unit/static-generation/page-mapper.test.ts`。
- must-not-touch：FlowPlan 行为转换逻辑。
- actions：
  1. 定义 `StaticPagePlan`：pageId、path、title、sourcePageId、sourceRootNodeId、bounds、viewportRole、warnings。
  2. 对重复名称生成稳定 slug 后缀。
  3. 隐藏节点、空 root、尺寸缺失 fail closed 或 warning。
  4. 入口页默认按 DesignBundle 顺序选第一个可渲染 page；不推断业务入口。
- expected outputs：稳定 page plan 和 diagnostics。
- verify：unit tests 覆盖重复名、单页、多页、空页、mobile artboard。
- done conditions：T05 可消费 `StaticPagePlan`。
- stop/escalate：需要用户选择目标节点或 Figma 文件中没有可渲染页面。
- ACs：AC1、AC2、AC8。

### T03：视觉层/局部资产规划器

- goal：把重要 vector/image/decorative layer 转成 UISpec 可表达的视觉保真层，同时生成报告追溯。
- prerequisites：T01、GATE-02。
- must-read：`src/runtime/inspect-agent-context.ts`、`src/ui-spec/schema.ts`、`src/preview/json-render-adapter.ts`、`src/project-store/store.ts`、`src/tools/unsupported-features.ts`。
- owns：`src/static-generation/visual-layer-planner.ts`、`tests/unit/static-generation/visual-layer-planner.test.ts`。
- must-not-touch：整页截图 fallback 规则、UISpec strict schema provenance 字段。
- actions：
  1. 复用或抽取 `visualLayers` 分类逻辑，保留 reason：large_visual、structural_visual、named_visual、image_visual。
  2. 对 imageRefs 或 renderedAssetPath 已存在的节点生成 `image` 或 `pixel_overlay`。
  3. 对 vector/decorative 节点：若已有局部 asset 则生成 overlay；若没有可用 asset，则记录 unsupportedFeature，不用 CSS 猜 blob。
  4. UISpec 节点只保存当前 schema 允许的渲染字段：assetRef、alt、width/height、style.left/top/width/height/zIndex/opacity/pointerEvents。
  5. `sourceNodeId`、reason、layerRole、source bounds、pageRelativeBounds、uiSpecNodeId 进入 `StaticGenerationReport.visualLayers[]`。
  6. 明确 root 单 overlay 仍非法。
- expected outputs：视觉层计划、UISpec render nodes、report visualLayers、unsupportedFeatures、coverage stats。
- verify：unit tests 覆盖 blob、logo、icon、image fill、无 asset vector、pointerEvents none，并断言 `uiSpecDraftSchema.parse` 不接收未声明 provenance 字段。
- done conditions：T05 可把视觉层插入 UISpec；T06 可输出 report visualLayers。
- stop/escalate：需要新增 SVG 导出、支持 `image/svg+xml`，或必须把 provenance 写入 UISpec。
- ACs：AC3、AC5、AC7、AC9、AC10。

### T04：文本、样式和基础组件映射

- goal：把文本、样式、表单和按钮映射为结构化 UISpec 节点。
- prerequisites：T01。
- must-read：`src/design-bundle/schema.ts`、`src/ui-spec/schema.ts`、`src/preview/catalog.ts`、`src/preview/json-render-adapter.ts`。
- owns：`src/static-generation/node-mapper.ts`、`src/static-generation/style-mapper.ts`、`tests/unit/static-generation/node-mapper.test.ts`。
- must-not-touch：业务 action 生成。
- actions：
  1. 文本节点映射为 `text`，保留 variant、style、尺寸约束和 nowrap/wrap 策略。
  2. 明显 label/input/button/link/social button 生成真实控件；无行为时不写 actionId。
  3. icon asset 绑定到 `leadingIconAssetRef` / `trailingIconAssetRef`。
  4. style 映射到受控字段：颜色、字体、行高、border、shadow、frame、absolute positioning。
  5. 无法表达的特效进入 unsupportedFeatures。
- expected outputs：结构化节点树和 style diagnostics。
- verify：unit tests 覆盖 footer nowrap、placeholder/label/title 字体、social icon size、disabled 控件。
- done conditions：T05 可组装完整 UISpec。
- stop/escalate：需要任意 CSS 注入或新增 UI node kind。
- ACs：AC4、AC6、AC7、AC8、AC9。

### T05：静态 UISpec 生成服务

- goal：把 page plan、visual layer plan、node/style mapping 组装成合法 UISpec draft 和 M5 report draft。
- prerequisites：T02、T03、T04。
- must-read：`src/project-store/store.ts`、`src/tools/ui-spec-service.ts`、`src/ui-spec/schema.ts`、`src/tools/contracts.ts`。
- owns：`src/static-generation/service.ts`、`tests/unit/static-generation/service.test.ts`。
- must-not-touch：`applyFlowPlanToUISpec` 的行为转换语义。
- actions：
  1. 新增 `buildStaticUISpecFromDesignBundle`，输入 DesignBundle 和选项，输出 `{ uiSpecDraft, reportDraft }`。
  2. 写入 `sourceDesignBundleRevision`；仅在调用方显式提供正式 FlowPlan 时才写 `sourceFlowPlanRevision`。
  3. 为每页生成 root section/stack，插入结构化内容和视觉层。
  4. 所有 node id/action id/state key 稳定、去重、可追溯。
  5. 输出 generation report draft：pages、nodes、visualLayers、unsupportedFeatures、warnings、residualRisks。
- expected outputs：合法 multi-page UISpec draft 和符合 `M5StaticReportSchema` 的 report draft。
- verify：`uiSpecDraftSchema.parse`、`M5StaticReportSchema.parse`；ProjectStore save 成功；root 单截图拒绝测试仍通过。
- done conditions：T06 runner 可调用服务生成并保存 spec/report。
- stop/escalate：schema 不能表达必须保留的视觉层，需要回到 GATE-02 或 GATE-UISPEC-PROVENANCE。
- ACs：AC1-AC10。

### T06：M5 本地 runner 与逐页报告

- goal：提供可复现的离线 M5 验证入口。
- prerequisites：T05。
- must-read：`scripts/run-m4-flowplan.mjs`、`src/validation/render-and-compare.ts`、`tests/integration/flow-plan/m4-flowplan.test.ts`、`src/static-generation/report.ts`。
- owns：`scripts/run-m5-static.mjs`、`tests/integration/static-generation/m5-static.test.ts`。
- must-not-touch：live probe 脚本和 OpenAI/Figma token。
- actions：
  1. 支持参数：projectId、dataRoot、designBundleRevision、runId、reportRoot、save-ui-spec、run-compare。
  2. 读取 DesignBundle，生成 UISpec draft 和 report draft，可选保存 UISpec。
  3. 对每个 page 调用 render/compare 或输出待比较记录。
  4. 合并 render_and_compare 输出、unsupportedFeatures、visual layer coverage、region diagnostics。
  5. 写出 `summary.json` 并用 `M5StaticReportSchema.parse` 校验；`summary.md` 只能从 JSON 派生。
  6. 报告明确 M5 静态范围和 M6/M7 未验证。
- expected outputs：`reports/m5-static/<runId>/summary.json` 和 `summary.md`。
- verify：integration test 用 fixture 运行 runner，断言 report schema、page count、region diagnostics、visualLayers mapping、behaviorFlowVerified=false。
- done conditions：T07 可运行完整本地验证。
- stop/escalate：runner 需要外部服务或 browser 资源不可用。
- ACs：AC10、AC11、AC12。

### T07：验证矩阵和质量门

- goal：把 M5 本地质量门固定下来。
- prerequisites：T06。
- must-read：`package.json`、`tests/unit/*`、`tests/integration/*`。
- owns：新增/调整 M5 unit/integration tests，不碰无关 catalog dirty files。
- must-not-touch：依赖和 lockfile。
- actions：
  1. Unit：page mapper、visual planner、node mapper、style mapper、service、report schema。
  2. Integration：runner、ProjectStore save/load、render compare smoke、unsupportedFeatures report、report schema parse。
  3. Regression：root single screenshot / overlay fallback rejection。
  4. 验证命令：`npm run typecheck`、`npm run test:unit`、`npm run test:integration`。
- expected outputs：M5 测试覆盖和命令结果。
- verify：所有本地命令通过。
- done conditions：可生成 M5 validation candidate。
- stop/escalate：测试需要 live Figma/OpenAI 或新增依赖。
- ACs：AC3、AC10、AC11、AC12。

### T08：M5 验收记录与后续分界

- goal：把 M5 执行结果记录成 Worktrail validation candidate。
- prerequisites：T07 通过、GATE-M4-VALIDATION 状态已记录。
- must-read：M5 report、git diff、Worktrail 当前 pending candidates。
- owns：`validation/figma-to-ui-agent-m5-static-generation-result.md` pending candidate。
- must-not-touch：formal Worktrail 知识、promote、discard、commit/push。
- actions：
  1. 汇总实现文件、测试证据、runner 报告、已知限制。
  2. 明确 M5 完成不代表 M6/M7 完成。
  3. 明确 M4 validation 状态。
  4. 创建 validation pending candidate 并等待用户 review/promote。
- expected outputs：M5 validation candidate id。
- verify：`worktrail review plan --format json` 能看到候选。
- done conditions：用户可决定 promote 或进入 M6 计划。
- stop/escalate：用户要求直接 promote、discard 或 commit，需要单独确认。
- ACs：AC10、AC11、AC12。

## 风险、缓解与回滚

- 风险：视觉层缺 asset，只能看到 vector metadata。缓解：记录 unsupportedFeature，不用 CSS 猜复杂形状；必要时单独设计 SVG/local asset 导出。回滚：关闭该 visual layer 输出，保留结构化 UI。
- 风险：mobile artboard 在 desktop viewport 下缩放/对齐错误。缓解：page plan 记录 canvas bounds 和 viewport role；runner 做逐页诊断。回滚：先固定原始 artboard 尺寸渲染，延后 responsive。
- 风险：为了降低 diff 重新引入整页截图 fallback。缓解：ProjectStore regression test 和 root 单截图拒绝规则保持。回滚：拒绝保存该 UISpec。
- 风险：M5 和 M6 行为边界混淆。缓解：M5 生成控件但不写未确认 action；报告声明 behavior 未验证。回滚：移除 action/fixture 生成，交给 FlowPlan/M6。
- 风险：新增 schema 字段破坏旧 spec。缓解：默认不新增 UISpec provenance；若必须新增，先过 `GATE-UISPEC-PROVENANCE` 并保持 additive optional。回滚：保持旧 schema，改为 report-only diagnostics。
- 风险：Worktrail 同 target 候选重复。缓解：推广前执行 `GATE-WORKTRAIL-HYGIENE`，只在用户精确确认后 discard/promote。

## 验证命令

```bash
npm run typecheck
npm run test:unit
npm run test:integration
node scripts/run-m5-static.mjs --projectId <project> --dataRoot data --designBundleRevision <n> --save-ui-spec --run-compare
```

live 盲测不属于默认验证命令；必须先进入 `GATE-LIVE-M5`。

## 覆盖检查

- AC1/AC2：T02。
- AC3：T03、T05、T07。
- AC4：T04、T05。
- AC5：T03、T05、T06。
- AC6/AC7/AC8：T04、T05。
- AC9：T03、T04、T06。
- AC10：M5StaticReport 契约、T05、T06、T08。
- AC11：T07。
- AC12：T06、T08。

## 下一步交接

推荐下一步先运行 plan review。若 review clean 或 clean_with_assumptions，再按 `GATE-M4-VALIDATION -> GATE-WORKTRAIL-HYGIENE -> GATE-00 -> T01 -> GATE-01/GATE-02 -> T02/T03/T04 -> T05 -> T06 -> T07 -> T08` 顺序实施。
