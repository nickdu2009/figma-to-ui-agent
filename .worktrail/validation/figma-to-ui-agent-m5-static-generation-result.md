---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "validation-figma-to-ui-agent-m5-static-generation-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent M5 多 Artboard 静态生成验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M5 多 Artboard 静态生成验收记录

## 结论

M5 多 Artboard 静态生成已在本地完成并通过验收。当前实现证明：在已有 `DesignBundle` 基础上，可以稳定地将多个 Figma artboard / page 映射为多个 `UISpec page`，保留真实 DOM 文本、图片、按钮、输入等结构化节点，并通过 `M5StaticReport` 追溯视觉层从 Figma source node 到 UISpec render node 的映射。

本记录只覆盖 M5：多 artboard 静态生成、逐页结构化节点映射、视觉层保留、报告追溯和本地逐页渲染比较。它不表示 M6 跨页面行为探索 / Flow 执行验证已经完成，也不表示 M7 复杂业务表单、状态机或后端业务流已经完成。

M4 正式 FlowPlan 验收记录仍是 pending candidate，因此本记录保留 `m4ValidationStatus: pending` 的治理说明。M5 可以按当前代码事实进入下一阶段计划，但正式知识链闭合仍需要后续处理 M4 validation candidate。

## 实现范围

- 新增 `M5StaticReportSchema` 与类型，严格约束 `scope: "static_generation_only"`、`behaviorFlowVerified: false`、page summary、visual layer provenance、unsupportedFeatures、warnings、residualRisks。
- 新增 M5 offline fixture，包含 Login、Dashboard、Mobile Onboarding 三页，覆盖表单、按钮、社交按钮、footer、装饰 vector、image fill、mobile viewport。
- 新增 page mapper：把 DesignBundle pages 稳定映射为 UISpec pages，处理重复名称 slug 后缀、隐藏/空根节点、viewportRole 检测。
- 新增 visual layer planner：复用 visual layer 分类逻辑，决定 `image` / `pixel_overlay` / unsupportedFeature，生成 report-owned `visualLayers[]`，不将 provenance 写入 UISpec 节点。
- 新增 node/style mapper：映射 text / input / button / image / container，保留 font、lineHeight、whiteSpace/nowrap 策略，图标按钮保留 button 语义。
- 新增 static generation service：组装合法 UISpec draft 与 M5 report draft，生成稳定 state key、region diagnostics、visual layer coverage。
- 新增 `run:m5:static` 离线 runner：支持 `--save-ui-spec`、可选 `--run-compare`，输出 `summary.json` 与派生 `summary.md`。
- 补齐 runner compare 测试：M5 fixture 项目现在会通过 ProjectStore 保存真实 PNG 资产，再执行 `--save-ui-spec --run-compare`，避免只登记 LocalImageRef 元数据导致参考截图文件缺失。

## 验证证据

本地验证已通过：

- `npm run typecheck`：passed。
- `npx vitest run tests/unit/static-generation tests/integration/static-generation/m5-static.test.ts`：6 files / 25 tests passed。
- `npx vitest run tests/unit/static-generation tests/integration/static-generation`：6 files / 25 tests passed。
- `npm run test:unit`：34 files / 172 tests passed。
- `npm run test:integration`：9 files / 44 tests passed。
- `npm run test:e2e`：6 tests passed。

定向覆盖包括：

- 多 page 稳定映射：3 pages、重复名 slug 后缀、mobile viewport 识别。
- 输入不足时 fail closed：无页面、隐藏根节点、零尺寸根节点产生 warning 且不生成伪页面。
- 不使用整页 screenshot fallback：ProjectStore 的 root 单截图拒绝规则仍生效；report 中 `fullPageScreenshotFallback: false`。
- 登录页保留真实 email/password input、Sign in CTA、社交按钮、footer nowrap。
- 视觉层追溯：blob vector 生成 `pixel_overlay`，并进入 `M5StaticReport.visualLayers[]`；结构化 image 节点不重复生成视觉层。
- UISpec 节点 schema 保持 strict，未新增 sourceNodeId / reason / layerRole 等字段。
- runner 输出 `summary.json` 通过 `M5StaticReportSchema.parse`，`summary.md` 仅从 JSON 派生。
- `--run-compare` 已由 integration test 覆盖：测试保存真实 screenshot / asset 文件，runner 生成 UISpec 后执行逐页 render-and-compare，并断言每个 page 都产生 comparison 与截图路径。

## 边界

- 未新增或升级 npm 依赖。
- 未调用真实 Figma API。
- 未调用 OpenAI。
- 未执行 live blind。
- 未修改模型可见工具数量或工具名称。
- 未修改 `src/ui-spec/schema.ts` 添加 provenance 字段。
- 未执行部署、push 或发布。
- 当前验收基于本地 fixture、ProjectStore、Preview、Playwright 和 Vitest；真实未知 Figma 文件泛化能力需要单独 `GATE-LIVE-M5` 授权验证。

## 残留风险与后续

- M5 静态能力已通过本地验收，但真实 Figma 文件盲测尚未执行。
- M4 validation candidate 仍是 pending；若要关闭正式知识链，需要单独 review/promote M4 validation。
- M6 应单独处理 route、navigate action、behavior fixture 和点击路径验证。
- M7 应单独处理复杂表单提交、条件分支、业务状态机和后端调用。
