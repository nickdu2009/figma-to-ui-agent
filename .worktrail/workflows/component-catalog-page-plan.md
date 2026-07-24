---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "component-catalog-page-plan",
  "scope": "project",
  "type": "workflow",
  "title": "figma-to-ui-agent 组件预览页（Catalog Page）实现计划",
  "status": "complete",
  "lifecycle": "archived",
  "topic": "component-catalog-page"
}
---

# 组件预览页（Catalog Page）实现计划

## 来源与依据

- 需求澄清结果：独立 Vite 入口、AntD 式卡片网格、全部 UISpec 组件、props 控制面板、基础交互、内置 fixture 数据、复用现有 Preview 设计系统。
- 设计方案：方案 A（独立 Catalog Vite 应用，使用 UISpec 作为数据模型）。
- 现有约束：不引入新依赖；样式白名单；组件渲染通过 `@json-render/react` + `preview/src/catalog-registry.tsx`。

## 授权边界

- 本计划不修改 `src/ui-spec/schema.ts`、`src/project-store`、`src/validation` 等核心契约。
- 新增文件集中在 `catalog/` 目录，少量修改 `package.json` 和 `tsconfig.json`（如需要路径别名）。
- 不调用外部服务、不提交 git、不部署。

## 真相所有权

- **真相来源**：`src/preview/catalog.ts` 中的 `previewCatalog` 定义了支持的组件和 props 契约。
- **非真相表面**：catalog fixture 数据是运行时生成的示例数据，不持久化，不代表真实项目。

## 验收标准映射

| 编号 | 验收标准 | 覆盖步骤 |
|---|---|---|
| AC1 | 页面可通过独立命令启动 | STEP-1, STEP-7 |
| AC2 | 列出所有 `previewCatalog` 组件 | STEP-3, STEP-4 |
| AC3 | 每张卡片可见渲染组件 | STEP-4, STEP-6 |
| AC4 | props 控制面板实时生效 | STEP-4, STEP-5 |
| AC5 | 交互组件支持基础交互 | STEP-4, STEP-6 |
| AC6 | 不引入新依赖 | GATE-00, STEP-1 |
| AC7 | typecheck 通过 | STEP-8 |
| AC8 | 新增 e2e 测试覆盖 | STEP-8 |
| AC9 | 不破坏现有 Preview | STEP-8 |

## 并行性与共享写表面

```text
[parallelism:
- independent lanes:
  - catalog/vite.config.ts + package.json scripts
  - catalog/src/fixtures.ts（fixture 生成器）
  - catalog/src/prop-controls.tsx（控制面板）
  - catalog/src/component-card.tsx + catalog-app.tsx（页面）
  - catalog/src/catalog.css
  - 测试文件
- sequential blockers:
  - fixtures.ts 必须在 component-card.tsx 之前完成
  - prop-controls.tsx 必须在 component-card.tsx 之前完成
  - catalog/vite.config.ts 完成后才能运行 dev/build
- shared write surfaces:
  - package.json（scripts）单 owner
  - tsconfig.json（若有路径别名调整）单 owner
- delegation: 0；步骤间强耦合且共享 catalog 定义，单线推进更稳
]
```

## 编码前门槛（GATE-00）

- [ ] 确认不引入新 npm 依赖。
- [ ] 确认 `catalog/` 目录结构与现有 `preview/` 目录对称。
- [ ] 确认 fixture 图片使用本地占位资源或 data URI，不依赖 Figma API。

## 实现步骤

### STEP-1：新增 Catalog Vite 入口和配置

**落地文件**：
- `catalog/index.html`
- `catalog/vite.config.ts`
- `catalog/src/main.tsx`
- `package.json`（新增 scripts）
- `tsconfig.json`（添加 `"catalog"` 到 `include`）

**动作**：
1. 创建 `catalog/index.html`，结构与 `preview/index.html` 一致，标题改为 "Figma-to-UI Catalog"。
2. 创建 `catalog/vite.config.ts`：
   - `root: resolve(projectRoot, "catalog")`
   - 插件：仅 `@vitejs/plugin-react`，不需要 `projectDataPlugin`
   - `server.fs.allow: [projectRoot]`（允许从 `src/`、`preview/src/` import）
   - `build.outDir: resolve(projectRoot, "catalog/dist")`
3. 创建 `catalog/src/main.tsx`，挂载 `CatalogApp`。
4. 在 `tsconfig.json` 的 `include` 中追加 `"catalog"`，确保 catalog 代码被 typecheck 覆盖。
5. 在 `package.json` 新增：
   - `"dev:catalog": "vite --config catalog/vite.config.ts"`
   - `"build:catalog": "vite build --config catalog/vite.config.ts"`
   - `"preview:catalog": "vite preview --config catalog/vite.config.ts"`

**验证**：
- 运行 `npm run dev:catalog`，页面可在浏览器访问且无报错。
- `npm run typecheck` 通过。

**覆盖 AC**：AC1, AC6, AC7

### STEP-2：准备 fixture 图片资源

**落地文件**：
- `catalog/assets/placeholder.png`（或复用 `tests/fixtures` 中的图片）

**动作**：
1. 在 `catalog/assets/` 放置一张 256x256 的 PNG 占位图，用于 Image、PixelOverlay、Icon、Avatar 组件示例。可通过本地工具生成或提交一张小型透明/纯色 PNG。
2. 该图片通过 Vite 的静态资源处理引入，不占用 ProjectStore。

**验证**：
- 图片能被 `import placeholderPng from "../assets/placeholder.png"` 正常加载。

**覆盖 AC**：AC3

### STEP-3：实现 fixture 生成器

**落地文件**：
- `catalog/src/fixtures.ts`
- `catalog/src/fixture-types.ts`

**动作**：
1. 定义 `ComponentFixture` 类型：
   ```typescript
   export interface ComponentFixture {
     kind: string;
     title: string;
     description: string;
     initialSpec: UISpec;
     controllableProps: PropControl[];
   }
   ```
2. 实现 `generateComponentFixtures()`，遍历 `previewCatalog` 的组件名，为每个组件生成一个合法 UISpec：
   - root 节点为 `stack`，direction 为 `vertical`，padding 16。
   - 每个组件根据其 props schema 生成最小合法示例节点。
   - 交互组件（button、input、checkbox、link、radio、switch、select、textarea、tabs）生成对应 `state` 和 `actions`。
   - 图片类组件（image、pixel_overlay、icon、avatar）使用 `assetRef` 指向占位图路径。
   - `TabPanel` 不生成独立 fixture，仅在 `Tabs` fixture 中作为子元素展示。
3. 定义 `PropControl` 类型，描述可控制 prop 的名称、类型、选项和默认值。
4. 按设计文档的**混合推导策略**实现 `controllableProps` 生成：
   - 从 `previewCatalog.data.components[name].props` 读取 zod schema，自动推导 `enum`、`boolean`、`string`、`number` 普通字段。
   - 显式跳过 `nodeId`、`designValueRefs`、`style`、`childIds`、`stateKey`、`actionId`、`value`、`checked`、`selectedTab` 等内部或绑定字段。
   - 对 `Select.options`、`Tabs.tabs`、图片 `src` 等数组/对象字段使用硬编码覆盖。
   - 优先使用设计文档中的 **Props 控制面板覆盖表** 作为字段清单，确保与设计方案一致。
5. 单元测试覆盖覆盖表中每个组件的 `controllableProps` 与示例节点 `kind` 的正确性。

**验证**：
- `generateComponentFixtures()` 返回的每个 `initialSpec` 能被 `toPreviewJsonSpec` 成功转换。
- 单元测试：每个 fixture 至少包含一个页面、一个 root 节点、一个示例节点。

**覆盖 AC**：AC2

### STEP-4：实现组件卡片

**落地文件**：
- `catalog/src/component-card.tsx`

**动作**：
1. 接收 `ComponentFixture` 作为 props。
2. 使用 `useMemo` 将 `initialSpec` 转换为 Preview JSON：
   ```typescript
   const previewSpec = useMemo(
     () => toPreviewJsonSpec(spec, pageId, { imageUrl: catalogImageUrl }),
     [spec, pageId],
   );
   ```
   其中 `catalogImageUrl` 将占位 `assetRef` 映射为 `import placeholderPng from "../assets/placeholder.png"` 的 URL。
3. 使用 `createStateStore(previewSpec.state)` 创建状态 store。
4. 渲染 `JSONUIProvider` + `Renderer`：
   ```typescript
   <JSONUIProvider registry={registry} store={store} handlers={handlers}>
     <Renderer spec={previewSpec as Spec} registry={registry} />
   </JSONUIProvider>
   ```
   `handlers.dispatch` 实现：
   - `setState`：依赖 `@json-render/react` 默认行为更新本地状态。
   - `navigate` 或无对应 action：忽略，避免页面跳转。
   - Button/Link fixture 中的 demo action（如 `demo-button-clicked`）通过 `setState` 更新卡片内 demo 状态，显示“已点击”或计数。
5. 卡片标题显示组件名和描述。
6. 错误边界：若 renderer 抛出错误，显示降级 UI。

**验证**：
- 每个组件卡片能独立渲染，无控制台错误。
- `npm run typecheck` 通过。

**覆盖 AC**：AC3

### STEP-5：实现 props 控制面板

**落地文件**：
- `catalog/src/prop-controls.tsx`

**动作**：
1. 根据 `PropControl` 渲染控件：
   - enum → `<select>`
   - boolean → `<input type="checkbox">` 或 switch 组件
   - string → `<input type="text">`
   - number → `<input type="number">`
2. 控件变化时调用 `onChange(name, value)`。
3. 在 `component-card.tsx` 中维护 `propValues` 状态；变化时重新生成包含新 prop 值的 UISpec，再转换为 Preview JSON 重新渲染。
4. 为避免状态丢失，props 变化时创建新的 state store（可接受；props 演示以展示静态变化为主）。

**验证**：
- 切换 Button 的 `variant` 或 `disabled` 后，按钮外观/状态实时变化。
- 切换 Text 的 `text` 后，文本内容更新。

**覆盖 AC**：AC4

### STEP-6：实现 Catalog 页面布局

**落地文件**：
- `catalog/src/catalog-app.tsx`
- `catalog/src/catalog.css`

**动作**：
1. `catalog-app.tsx`：
   - 调用 `generateComponentFixtures()` 获取所有组件 fixture。
   - 渲染页面标题、简介。
   - 使用 CSS Grid 渲染卡片网格（响应式：1 列 → 2 列 → 3 列）。
   - 每个网格单元渲染 `<ComponentCard fixture={fixture} key={fixture.kind} />`。
2. `catalog.css`：
   - 页面背景、卡片边框、阴影、hover 效果。
   - 控制面板区域样式。
   - 仅使用普通 CSS，不引入任意 CSS 或外部样式。

**验证**：
- 页面呈现 AntD 式卡片网格。
- 所有卡片可见。
- 响应式布局在不同视口下正常。

**覆盖 AC**：AC2, AC3

### STEP-7：验证独立入口可运行

**动作**：
1. 运行 `npm run dev:catalog`。
2. 在浏览器访问页面，确认所有卡片渲染。
3. 运行 `npm run build:catalog`，确认构建产物输出到 `catalog/dist/`（或配置的 `outDir`）。

**验证**：
- dev server 正常启动。
- build 无错误。

**覆盖 AC**：AC1

### STEP-8：测试与回归

**落地文件**：
- `tests/unit/catalog/fixtures.test.ts`
- `tests/e2e/catalog.spec.ts`

**动作**：
1. 单元测试：
   - `generateComponentFixtures()` 返回的 fixture 数量等于 `previewCatalog` 组件数量。
   - 每个 fixture 的 `initialSpec` 能被 `toPreviewJsonSpec` 转换。
   - 每个 fixture 的示例节点 `kind` 与 `fixture.kind` 一致。
2. E2E 测试：
   - 新增 `playwright.catalog.config.ts`（或在现有 `playwright.e2e.config.ts` 中增加 project/webServer 配置），通过 `webServer` 自动启动 `npm run dev:catalog`。
   - 访问 catalog 页面，断言页面标题和卡片数量。
   - 断言 Button 卡片可见且可点击。
   - 断言 Input 卡片可输入。
   - 断言 Tabs 卡片可切换。
   - e2e 命令建议：`"test:e2e:catalog": "playwright test --config playwright.catalog.config.ts"`。
3. 回归测试：
   - 运行 `npm run typecheck`。
   - 运行 `npm run test:unit`。
   - 运行 `npm run test:integration`。
   - 运行 `npm run test:e2e`。

**验证**：
- 新增测试通过。
- 现有测试矩阵无回归。

**覆盖 AC**：AC5, AC7, AC8, AC9

## 风险、缓解与回滚

| 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|
| fixture 生成器遗漏组件必填字段 | 某些卡片渲染失败 | 单元测试覆盖每个 fixture 的 schema 合法性；错误边界兜底显示降级 UI |
| 图片类组件无合适占位资源 | Image/Icon/Avatar 卡片空白 | 使用本地 PNG 占位图 + catalog 专用 `imageUrl` 解析器 |
| props 面板与 renderer 状态不同步 | 交互后切换 props 状态重置 | 可接受；props 面板用于演示 prop 变化，非保持交互状态 |
| catalog 与 preview 共享 registry 路径脆弱 | 目录重构时 import 断裂 | STEP-4 优先从 `src/preview/catalog-renderer.ts` 等共享入口引入 registry；如时间有限，可先用 `../preview/src/catalog-registry.tsx` 并在风险中记录 |
| 新增 e2e 配置与现有 Playwright 配置冲突 | catalog e2e 无法启动 | 使用独立 `playwright.catalog.config.ts`；不修改现有 `playwright.e2e.config.ts` |
| 现有 Preview 测试受影响 | 回归失败 | catalog 不修改 preview 文件；回归测试验证 |

## 覆盖检查

- [x] AC1：独立命令启动
- [x] AC2：列出所有组件
- [x] AC3：卡片可见渲染
- [x] AC4：props 面板实时生效
- [x] AC5：交互组件基础交互
- [x] AC6：不引入新依赖
- [x] AC7：typecheck 通过
- [x] AC8：新增 e2e 测试
- [x] AC9：不破坏现有 Preview

## 残余假设

- 【假设】`@json-render/react` 的 `Renderer` 支持在 props 变化时重新渲染（依据：`preview-app.tsx` 中 `previewSpec` 变化会创建新 store；若不支持，需调整组件卡片状态管理）。
- 【假设】`previewCatalog.data.components[name].props` 运行时可访问原始 zod schema，用于推导简单 props 控制面板；复杂字段采用硬编码覆盖（验证方法：STEP-3 单元测试断言 schema 读取与覆盖表正确性）。
- 【假设】props 变化时创建新的 state store 是可接受的，交互状态会在 prop 切换后重置（验证方法：STEP-5 手动验证 Button variant 切换后仍可点击）。
- 【假设】新增 `catalog/` 目录不影响 M3 冻结的源码哈希校验（验证方法：实现后运行 `npm run blind:m3` 本地预检，或确认冻结策略只校验 `src/`、`preview/`、`scripts/` 等既有目录）。

## 下一步

本计划可直接进入实现。建议按 STEP-1 → STEP-8 顺序执行，每步完成后验证对应 AC。
