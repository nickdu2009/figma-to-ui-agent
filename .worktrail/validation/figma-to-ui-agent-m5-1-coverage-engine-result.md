---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "validation-figma-to-ui-agent-m5-1-coverage-engine-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent M5.1 Coverage Engine T01-T07 本地验收记录",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent M5.1 Coverage Engine T01-T07 本地验收记录

## 验收范围

- 验收对象：`workflows/figma-to-ui-agent-m5-1-coverage-engine-implementation-plan.md` 中的 T01 到 T07。
- 验收时间：2026-07-25 22:14 到 22:19 CST。
- 验收类型：本地验证，不调用 Figma、不调用 OpenAI、不执行 T08 live blind。
- 结论：本地硬门通过，T01-T07 可以视为本地完成；T08 仍需单独授权后执行。

## 已覆盖任务

- T01：Coverage schema、report 兼容与 classifier。
- T02：Visual asset priority 共享契约。
- T03：Inspect-time asset export 与 restricted Variables mode 的本地接口验证。
- T04：Static generation 接入 coverage。
- T05：Overlay、DOM 与 renderer 保真。
- T06：Full-page capture 与 height diagnostic。
- T07：Runner/report markdown 派生与 validation。

## 关键实现证据

- 新增或使用的核心模块：
  - `src/static-generation/coverage.ts`
  - `src/static-generation/visual-asset-priority.ts`
  - `src/static-generation/report.ts`
  - `src/static-generation/report-markdown.ts`
  - `src/static-generation/service.ts`
  - `src/static-generation/visual-layer-planner.ts`
  - `src/static-generation/node-mapper.ts`
  - `src/static-generation/page-mapper.ts`
  - `src/figma/inspector.ts`
  - `src/figma/normalize.ts`
  - `src/validation/render-and-compare.ts`
- 新增或使用的 runner：
  - `scripts/run-m5-static.mjs`
  - `scripts/run-m5-live-restricted.mjs`
- 新增或使用的测试：
  - `tests/unit/static-generation/report-schema.test.ts`
  - `tests/unit/static-generation/report-markdown.test.ts`
  - `tests/unit/static-generation/coverage-classifier.test.ts`
  - `tests/unit/static-generation/visual-asset-priority.test.ts`
  - `tests/unit/static-generation/visual-layer-planner.test.ts`
  - `tests/unit/static-generation/node-mapper.test.ts`
  - `tests/unit/static-generation/page-mapper.test.ts`
  - `tests/unit/static-generation/service.test.ts`
  - `tests/integration/static-generation/m5-static.test.ts`
  - `tests/integration/figma/inspector.test.ts`
  - `tests/integration/validation/render-and-compare.test.ts`

## 本轮补齐项

复核 T01-T07 时发现 T07 有两个验收缺口，并已补齐：

1. `scripts/run-m5-static.mjs` 和 `scripts/run-m5-live-restricted.mjs` 改为使用 `m5StaticCoverageReportSchema`，runner 输出必须包含 `coverageVersion: "1"` 和完整 `coverage`。
2. 受限 live report 增加 `apiBoundary: { openai: false, figmaMe: false, variables: false }`，用于 T08 证明接口边界。
3. `summary.md` 增加 vector/image/text 覆盖细项和 `budgetExceeded` 计数。
4. 测试补上旧 M5 report 兼容、M5.1 required coverage、markdown 派生字段、runner 输出 coverage 的断言。

## 本地验证命令与结果

### Focused validation

- 命令：`npm run typecheck`
- 结果：通过。

- 命令：`npx vitest run tests/unit/static-generation/report-schema.test.ts tests/unit/static-generation/report-markdown.test.ts tests/integration/static-generation/m5-static.test.ts`
- 结果：通过，3 test files / 15 tests passed。

### Full local gates

- 命令：`npm run typecheck`
- 结果：通过。

- 命令：`npm run test:unit`
- 结果：通过，35 test files / 181 tests passed。

- 命令：`npm run test:integration`
- 结果：通过，9 test files / 45 tests passed。

- 命令：`npm run test:e2e`
- 结果：通过，6 tests passed。

## 验收标准覆盖

- AC1：通过 coverage classifier 与 `CoverageRecord` 测试覆盖 visible node 不静默丢失。
- AC2：通过 vector/icon/logo/line/decorative/image fill 的分类、visual planner 和 report 测试覆盖。
- AC3：通过 visual asset priority、budget cutoff 和 report reason 测试覆盖。
- AC4：通过 static-time 只消费 DesignBundle/assets/provenance 的 service/integration 测试覆盖。
- AC5：通过 preview e2e 验证 DOM 控件可编辑、可点击、可聚焦，overlay 不遮挡交互。
- AC6：通过 visual layer planner、renderer adapter 和 e2e 验证 page-relative bounds、zIndex、opacity 与 button icon 策略。
- AC7：通过 render-and-compare integration 覆盖 full-page / height diagnostic。
- AC8：通过 `m5StaticReportSchema` 兼容 schema、`m5StaticCoverageReportSchema` required schema、coverage matrix 与 `summary.md` 派生测试覆盖。
- AC9：ProjectStore root screenshot fallback guard 保持在本地测试范围内。
- AC10：四类本地验证命令全部通过。
- AC11：本地层面已通过 restricted Variables mode fake/rest spy 测试；真实受限 live 仍属于 T08。
- AC12：本地 report/coverage/diagnostic 能产出归因；真实 diff 改善需要 T08 live blind 验证。

## 未执行范围

- 未执行 T08 受限 live blind。
- 未访问真实 Figma 文件。
- 未调用 OpenAI。
- 未 commit、push、deploy。
- 未 promote 本 validation candidate。

## 残留风险

- T08 仍需用户明确授权后才能验证真实 Figma 文件上的 diff 改善、`apiBoundary` 报告和 redaction。
- 当前仓库仍有大量 modified/untracked 文件，提交前需要单独做 staged allowlist 和 diff 审核。
- 本记录是本地验收结果，不代表 live blind 已达到 `<5%` perceptual fidelity 目标。

## 下一步

- 如需进入 T08：请求用户明确授权访问 Figma，并运行 `scripts/run-m5-live-restricted.mjs` 或对应批量 wrapper。
- 如需固化本验收记录：在 Worktrail review 中 promote 本 validation candidate。
