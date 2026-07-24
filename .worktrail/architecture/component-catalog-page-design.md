---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "component-catalog-page-design",
  "scope": "project",
  "type": "architecture",
  "title": "figma-to-ui-agent 组件预览页（Catalog Page）设计方案",
  "status": "complete",
  "lifecycle": "archived",
  "topic": "component-catalog-page"
}
---

# 组件预览页（Catalog Page）设计方案

## 来源与依据

- 需求澄清结果：独立 Vite 入口、AntD 式卡片网格总览、展示全部 UISpec 组件、每张卡片包含可渲染迷你示例和 props 控制面板、支持基础交互、使用内置 fixture 数据、复用现有 Preview 设计系统。
- 使用角色：设计师、开发者。
- 业务目标：快速查看当前 renderer 支持的 UISpec 组件，并作为对外文档。

## 需求摘要

为 figma-to-ui-agent 提供一个**独立 Vite 入口**的组件总览页面，以 Ant Design 式卡片网格展示当前 renderer 支持的全部 UISpec 组件。每张卡片包含可渲染的迷你示例、组件说明和 props 控制面板，支持基础交互。页面使用运行时生成的内置 fixture UISpec 数据，不依赖真实 Figma 项目。

## 设计备选方案

### 方案 A：独立 Catalog Vite 应用

新增 `catalog/` 目录作为独立 Vite 根目录，拥有 `index.html`、`main.tsx`、`catalog-app.tsx`、fixture 生成器和卡片组件。复用 `src/preview/catalog.ts` 中的 `previewCatalog` 定义和 `preview/src/catalog-registry.tsx` 中的 React 组件注册。

- **优点**：
  - 与现有 Preview 完全解耦，不污染三栏预览逻辑。
  - 独立演化，未来可扩展为对外文档站点。
  - 直接满足“单独 Vite 入口”的需求。
  - 复用已有的 catalog 和 renderer，避免重复实现组件渲染。
- **缺点**：
  - 需要新增一个 Vite 配置入口和 npm script。
  - 部分共享样式/工具需显式 import。
- **复杂度**：中
- **影响面**：新增目录 + package.json scripts + 可能共享 catalog 类型。

### 方案 B：在现有 Preview App 内增加路由/模式

在 `preview-app.tsx` 中通过 URL query（`?view=catalog`）或路径切换显示 Catalog 视图，共用同一个 Vite 入口和构建产物。

- **优点**：
  - 无需新增 Vite 入口，配置最少。
- **缺点**：
  - 与项目预览逻辑耦合。
  - 增加 Preview bundle 体积。
  - 与“单独 Vite 入口”需求相背。
- **复杂度**：低
- **影响面**：修改现有 preview 核心文件，风险较高。

### 方案 C：构建时静态生成

为每个组件预生成静态 HTML 示例和 JSON spec，运行时只渲染静态页面。

- **优点**：
  - 加载快，适合纯文档。
- **缺点**：
  - props 面板和交互需要在构建时枚举所有组合，不灵活。
  - 违背“需要交互”和“props 控制面板”需求。
- **复杂度**：高
- **影响面**：需要重写构建流程。

## 选定方案

**方案 A：独立 Catalog Vite 应用。**

### 决策理由

1. 直接满足“单独一个 Vite 入口”的明确需求。
2. 与现有 Preview 解耦，避免影响三栏预览的稳定性。
3. 复用已有的 `previewCatalog` 和组件注册，避免重复实现 renderer。
4. fixture 数据在运行时生成，能动态支持 props 面板和交互。
5. 新增代码集中在 `catalog/` 目录，便于后续扩展为对外文档站点。

## 接口契约

### 1. Catalog 入口

```typescript
// catalog/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CatalogApp } from "./catalog-app.tsx";
import "./catalog.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>,
);
```

### 2. Fixture 生成器

```typescript
// catalog/src/fixtures.ts
import type { UISpec } from "../src/ui-spec/schema.ts";
import { previewCatalog } from "../src/preview/catalog.ts";

export interface PropControl {
  name: string;
  type: "enum" | "boolean" | "string" | "number";
  options?: string[];
  defaultValue: unknown;
}

export interface ComponentFixture {
  kind: string;
  title: string;
  description: string;
  initialSpec: UISpec;
  controllableProps: PropControl[];
}

export function generateComponentFixtures(): ComponentFixture[];
```

- `initialSpec` 为合法 UISpec，包含一个 root stack 和单个示例节点。
- 对交互组件（input、checkbox、radio、switch、select、textarea、tabs、button、link）生成对应 `state` 和 `actions`。
- `controllableProps` 采用**混合推导策略**：
  - 从 `previewCatalog.data.components[name].props` 自动读取 zod schema，推导 `enum`、`boolean`、`string`、`number` 类型的普通 prop。
  - `stateBinding` union 字段（`Input.value`、`Checkbox.checked`、`Switch.checked`、`Select.value`、`Textarea.value`、`Tabs.selectedTab`）视为状态绑定，不纳入 props 控制面板，由组件自身交互演示。
  - 数组/对象字段（`Select.options`、`Tabs.tabs`、`Image.fit` 等）第一版硬编码，不纳入 props 控制面板。
  - 显式跳过 `nodeId`、`designValueRefs`、`style`、`childIds`、`stateKey`、`actionId`、`value`、`checked`、`selectedTab` 等内部或绑定字段。
- `TabPanel` 不生成独立 fixture，仅在 `Tabs` 卡片中作为子元素展示。

### 3. Props 控制面板

```typescript
// catalog/src/prop-controls.tsx
export interface PropControlsProps {
  controls: PropControl[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}
```

- enum → `<select>`
- boolean → `<input type="checkbox">`
- string → `<input type="text">`
- number → `<input type="number">`

### Props 控制面板覆盖表

| 组件 | 可控制 props | 跳过/硬编码字段 |
|---|---|---|
| Button | `variant`, `disabled`, `label` | `leadingIconSrc`, `trailingIconSrc`（第一版不展示图标切换） |
| Input | `label`, `placeholder`, `disabled`, `inputType` | `value`（状态绑定） |
| Checkbox | `label`, `disabled` | `checked`（状态绑定） |
| Radio | `label`, `disabled`, `value` | `stateKey`（fixture 内部写死） |
| Switch | `label`, `disabled` | `checked`（状态绑定） |
| Select | `label`, `placeholder`, `disabled` | `value`（状态绑定）、`options`（硬编码） |
| Textarea | `label`, `placeholder`, `disabled` | `value`（状态绑定） |
| Tabs | `tabs` 硬编码两套示例 | `selectedTab`（状态绑定） |
| Text | `text`, `variant` | — |
| Image | `alt`, `fit` | `src`（解析到占位图） |
| Icon | `alt`, `decorative` | `src`（解析到占位图） |
| Avatar | `alt`, `initials` | `src`（解析到占位图） |
| Stack | `direction`, `gap`, `padding`, `align` | `childIds`（fixture 内部管理） |
| Grid | `columns`, `gap` | `childIds` |
| Section | `semantic` | `childIds` |
| Card | — | `childIds` |
| List | `ordered` | `childIds` |
| Badge | `label`, `tone` | — |
| Nav | `orientation` | `childIds` |
| Dialog | `title` | `openStateKey`（fixture 内部写死） |
| PixelOverlay | `width`, `height`, `alt` | `src`（解析到占位图）、`childIds` |
| Spacer | `width`, `height` | — |
| Divider | — | — |
| ListItem | — | `childIds` |
| TabPanel | 不独立展示 | — |

### 4. 组件卡片与渲染器复用

```typescript
// catalog/src/component-card.tsx
import { JSONUIProvider, Renderer, createStateStore } from "@json-render/react";
import { registry } from "../preview/src/catalog-registry.tsx";
import { toPreviewJsonSpec } from "../src/preview/json-render-adapter.ts";
```

- 每张卡片拥有独立的 `JSONUIProvider` 和 `createStateStore`。
- `dispatch` 处理 `navigate` action 和 `setState`（或依赖默认行为）。
- Button/Link 的 fixture 使用一个 demo action（如 `demo-button-clicked`），点击后通过 `setState` 更新卡片内的 demo 状态（显示“已点击”或计数），不触发真实页面跳转。
- 图片 URL 通过自定义 `imageUrl` 解析器映射到本地占位图：fixture 中 `assetRef` 使用合法形式（如 `figma/assets/0000...0000.png`），解析器将其映射为 `catalog/assets/placeholder.png` 的 Vite URL。

### 5. 页面布局

```typescript
// catalog/src/catalog-app.tsx
export function CatalogApp(): JSX.Element {
  const fixtures = useMemo(() => generateComponentFixtures(), []);
  return (
    <main className="catalog-page">
      <header>...</header>
      <section className="catalog-grid">
        {fixtures.map((fixture) => (
          <ComponentCard key={fixture.kind} fixture={fixture} />
        ))}
      </section>
    </main>
  );
}
```

## 数据模型 / 迁移策略

无数据迁移。Catalog 使用运行时生成的 fixture UISpec，不依赖 ProjectStore 或真实项目数据。

## 架构约束

- **不引入新依赖**：继续使用 `@json-render/react`、React、Vite。
- **样式白名单**：Catalog 自身样式使用普通 CSS，不引入任意 CSS/外部样式；组件渲染仍走现有白名单 `controlledStyle`。
- **可访问性**：卡片标题使用 heading 层级；props 控件使用原生 label + input；交互组件保持原生焦点和键盘行为。
- **外部资源**：组件示例中的图片使用项目内 fixture 图片路径或 data URI，禁止外部 URL。
- **TypeScript**：所有新增文件为 `.ts`/`.tsx`；将 `"catalog"` 加入 `tsconfig.json` 的 `include`，确保 `npm run typecheck` 覆盖 catalog 代码。
- **共享边界**：`catalog/` 可引用 `src/` 和 `preview/src/` 中的 catalog/registry/fixtures；避免反向依赖。推荐在 `src/preview/` 中新增可共享的 renderer 组装入口，减少 `catalog/` 对 `preview/src/` 内部路径的直接依赖。

## 验收标准

- 页面可通过独立命令启动并正常访问。
- 以卡片网格列出所有当前 `previewCatalog` 组件（`TabPanel` 不独立展示，仅在 `Tabs` 卡片中演示）。
- 每张卡片可见渲染对应组件。
- 每个卡片包含 props 控制面板，切换后组件实时响应。
- 交互组件（input、checkbox、radio、switch、select、textarea、tabs、button、link）支持基础交互。
- 不引入新的 npm 依赖。
- `npm run typecheck` 通过。
- 新增至少一个 e2e 测试：访问 catalog 页面并断言关键卡片渲染和交互。
- 不破坏现有 Preview 三栏页面和测试矩阵。

## 仍待确认

- 无。

## 暂定假设

- 【假设】使用 `catalog/index.html` 作为新 Vite 根目录，通过独立 `catalog/vite.config.ts` 启动（依据：项目已有 `vite.config.ts` 和 `preview/` 入口，最小改动是新增一个对称配置）。
- 【假设】fixture 图片使用本地占位 PNG，不新增真实 Figma 图片（依据：独立文档不应依赖外部服务）。
- 【假设】`@json-render/react` 的 `Renderer` 支持在 spec props 变化时重新渲染（依据：`preview-app.tsx` 中 `previewSpec` 变化会创建新 store；若不支持，需在实现中调整状态管理）。
- 【假设】`previewCatalog.data.components[name].props` 可在运行时访问原始 zod schema，用于推导简单 props 控制面板；复杂字段采用硬编码覆盖（验证方法：实现 STEP-3 时写一个单元测试断言 schema 读取与覆盖表正确性）。

## ADR 候选

无。本方案为局部 UI 扩展，未引入跨模块或长期架构决策。

## 下游建议

进入 `implementation-planning` 制定具体执行步骤和文件清单。
