# NextAppSpec 0.19.0 私有 CSR Runtime 与完整 Website Builder Example 实施计划

- 状态：Plan review 通过（`clean_with_assumptions`）；完整搬迁、CSR Store、独立 example 与 oracle 对比边界已确认
- 范围：私有 workspace 包 + 独立完整 example workspace；不接入当前应用
- 基线分支：`codex/next-app-runtime-plan`
- 基线提交：`7fcb928c3f38ccd7044a7ebf1c011feef9a8f94b`（`main`）
- 计划日期：2026-08-12
- 目标目录：`packages/next-app-runtime/`、`examples/next-app-runtime-website-builder/`
- 兼容目标：`@json-render/next@0.19.0` 的公开 `NextAppSpec` 客户端功能合同

[parallelism:
- independent lanes: Contract 冻结后，Router/Metadata characterization 与 Stream/RFC6902 characterization 可独立推进；完整 example 的 provenance/file mapping 可并行准备，但源码搬迁必须等待 React/Browser 公共合同冻结
- sequential blockers: GATE-00 -> workspace/package scaffold -> Contract -> Router/Stream -> Runtime Core -> React/Browser -> package consumer -> 完整 example 搬迁 -> 双实现对比
- shared write surfaces: 根 package.json/package-lock.json、包 public exports、RuntimeSnapshot/RuntimeError/SourceResult 公共合同、example package.json/app composition/Spec Store、对比基线均为单一所有者
- delegation: 0；包公共合同、example composition 与根 lockfile 存在顺序依赖，当前计划不委派并行写入
]

## 1. 目标与成功定义

在当前仓库内交付两个彼此隔离但可联合验证的 workspace：

1. 一个可独立构建、测试和消费的私有包，实现纯客户端 NextAppSpec 0.19.0 runtime。
2. 将上游 `examples/next-website-builder` 完整搬迁为 Vite + React CSR example，保留编辑器、分栏、路由标签、Catalog、registry、网站组件、样式、字体、图标、多页预览和编辑持久化流程；仅替换 Next.js 与服务端能力。

私有 runtime 包必须：

- 使用原生 Browser History API 和私有 NextAppSpec Router。
- 只使用 `NextAppSpec` 0.19.0 公共字段，不扩展、不缩小。
- 支持对象、完整 JSON、严格 JSONL RFC 6902 Patch 三种输入。
- 支持 routes、layouts/Slot、Link、metadata、staticParams、客户端 loader、loading/error/notFound。
- 复用 React 19、`@json-render/core@0.19.0`、`@json-render/react@0.19.0`。
- 不依赖 Next.js、Fastify、第三方 Router、数据请求库或额外状态库。
- 包内不得出现 UISpec 类型、UISpec adapter 或 UISpec Prompt。

完整 example 必须：

- 使用 `@next-app-runtime/client`，不得继续导入 `@json-render/next`。
- 用 `localStorage + storage event` 替代 `/api/spec` 与服务端 module store：同一浏览器、同源下支持刷新和新标签页读取最新 Spec；不承诺跨浏览器、跨用户共享。
- `/builder` 由 example shell 渲染完整 Builder；其他 pathname 交给 Browser History + 私有 NextAppSpec Router。
- 默认 Spec、Catalog 定义、registry、website components 和应用拥有的视觉内容与上游 v0.19.0 example 保持可追溯对应。
- example 的编辑器/UI 依赖只存在于 example workspace，不进入私有 runtime 的 direct/peer graph 或生产 bundle。

完成判定：第 8 节全部 `PKG-AC` 与 `EX-AC` 通过；最小 package consumer 能从已构建产物消费所有公开 subpath；完整 example 能构建并完成双实现行为与视觉对比；当前应用业务模块零修改。

## 2. 明确排除范围

本计划不包含：

- 当前应用对私有包的 dependency/import 接入。
- `src/ui-spec/`、`src/preview/`、`preview/`、`src/tools/`、`src/runtime/`、`src/project-store/`、`src/validation/`、`src/flow-plan/`、`src/static-generation/` 的迁移或删除。
- `load_ui_spec` / `save_ui_spec` 等工具名称、工具 Schema、Agent Prompt 或四工具边界修改。
- Host Artifact Envelope、Validation Plan、Validation Record 的应用侧实现。
- Fastify API、生产静态资源服务或生产部署验证；example 仅在 Vite dev/preview 中验证 CSR fallback 和深链接。
- UISpec 旧 artifact 数据迁移、双写、兼容 adapter 或 fallback。
- M3 freeze/refreeze、盲测、真实 OpenAI/Figma 调用。
- npm registry 发布、版本发布、Git commit/push/PR。
- Next.js SSR/RSC/SSG/ISR、Server Actions、middleware、rewrites。
- 对上游 example 的精简、重设计、换皮，或删除 Visual JSON、Resizable Panels、shadcn、Geist、route tabs、website components。
- 跨浏览器、跨用户或跨 origin 的 Spec 同步；服务端 Spec Store 的共享范围不在纯 CSR 替代合同内。

根仓库允许的结构性变化仅为：让 `packages/*` 与 `examples/*` 成为 npm workspaces，并记录对应锁文件变化。根应用本身不声明对私有包或 example 的消费依赖。

## 3. Sources and alignment

### 3.1 已复核设计来源

- 设计文档：`/Users/duxiaobo/workspaces/nickdu/figma-to-ui-agent/docs/architecture/next-app-spec-0.19-private-runtime-technical-selection.md`
- 文档 SHA-256：`5481d9d51884b970b1895ec73b7c85abbc713dbdd1e08d52d123258874de0921`
- 复核结论：`clean_with_assumptions`
- 已确认决策：D1—D6
- 注意：该设计文档当前不在本 worktree 的 `main` 基线内；本计划把与包实现有关的合同、验收项和门禁完整展开，实施时不得依赖未记录的口头补充。
- Active Accepted ADR artifact：未发现独立落盘的 Accepted ADR。设计文档中的 ADR-019-001 至 ADR-019-005 只是索引，不能按正式 ADR 生命周期引用；本计划实际受已确认的 D1—D6 约束。

### 3.2 上游 0.19.0 证据钉住

- 上游 checkout：`/Users/duxiaobo/workspaces/github/json-render`
- tag：`v0.19.0`
- tag commit：`0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7`
- `v0.19.0:packages/next/package.json` SHA-256：`eb0032c6d2988c9e7f31dd3577bc491e67ae8d8b043b5b2764234ea15a352174`
- 规范合同来源：
  - `packages/next/src/types.ts`
  - `packages/next/src/router.ts`
  - `packages/next/src/metadata.ts`
  - `packages/next/src/schema.ts`（仅缺陷证据和 fixture，不作为正式输入合同）
  - `packages/next/src/components/page-renderer.tsx`
  - `packages/next/src/components/link.tsx`
  - `packages/next/src/create-app.ts`

完整 example 的正式搬迁基线：

- 上游目录：`examples/next-website-builder/`
- 正式基线：tag `v0.19.0` / commit `0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7`
- 当前 checkout HEAD：`9d3dfc8917c1c6aa5568acbe0969523f3307376c`
- 已验证：当前 checkout 相对 `v0.19.0` 的 `examples/next-website-builder/` diff 为空；正式对比仍以 tag commit 为准，不随 checkout HEAD 漂移。
- 关键输入 hash：
  - `package.json`：`e23a422fd20109be5a899f01c541deebe371787f1ea34b4263a411eb82d14781`
  - `lib/default-spec.ts`：`e17830fb5332db4f7655b83f01b93fd9ec5d141fdda2435e72e10b694578b90d`
  - `components/editor.tsx`：`f04c910f33d5ae7740cc39ad8b23a16b08a32105cc954974880dedbf5f8af3e7`
  - `app/api/spec/route.ts`：`a9d20ad307a8d5b31a011220f2eccad5dcf23a3a71be4b8374d61a23224747e4`
  - `lib/spec-store.ts`：`0600b549f7a886ded70bd1d56fc80121915b0ea06840ab622aea1b962d867f83`
- 搬迁时必须为上游目录的全部 23 个文件建立 `provenance-manifest.json` 映射：`unchanged`、`ported`、`replaced` 或 `excluded-server-only`；不得只记录上述关键文件。

### 3.3 当前仓库事实

- 根 `package.json` 目前不是 workspace，且已有 Vite 8、TypeScript 7、Vitest 4、React 19、Zod 4 和 json-render 0.19.0。
- 根 `tsconfig.json` 的 `noEmit: true` 必须保持不变；私有包使用自己的 declaration 配置。
- 当前普通 json-render Catalog 在 `src/preview/catalog.ts`，UISpec adapter 在 `src/preview/json-render-adapter.ts`；两者都不进入新包。
- 当前四工具合同在 `src/runtime/tool-boundary.ts`，仍冻结为 UISpec 语义；本计划不触碰。
- `.npmrc` 已启用 exact save、ignore-scripts、无 audit/fund；实施不切换包管理器。

### 3.4 决策对齐

| 决策 | 实施含义 |
|---|---|
| D1 | 公共 TypeScript `NextAppSpec`/`Spec` 类型是字段真相；上游有缺陷的 schema 仅作为 characterization fixture |
| D2 | 对齐公开功能合同，补齐 Slot、Link、loading/error/notFound 客户端接线，不做 bug-for-bug 缺陷复刻 |
| D3 | loader 由宿主注册并在客户端运行；missing/error/notFound/stale/retry 使用不同机器状态 |
| D4 | 保留 Link `prefetch` prop，但首版不调用 loader、不建立 cache |
| D5 | RFC 6902 严格顺序执行；非法 operation/test 失败终止事务并保留 current |
| D6 | 同仓库 workspace-first；独立 registry 发布另行授权 |
| 完整搬迁 | 上游 Website Builder 的应用拥有功能和视觉全部保留；最小 consumer 不能替代完整 example 验收 |
| CSR Store | `/api/spec` 与 module store 替换为 `localStorage + storage event`；同源浏览器内支持刷新和新标签页，不实现服务端共享 |
| Example 隔离 | example 位于独立 `examples/next-app-runtime-website-builder/` workspace；其 UI/tooling 依赖不得进入 runtime 包边界 |
| 对比策略 | 上游 v0.19.0 example 保持不修改并作为 oracle；对结构化语义、用户流程和视觉分别对比，框架拥有的 DOM/服务端输出列入显式允许差异 |

设计中的 ADR-019-001 至 ADR-019-005 仅是设计文档内索引，尚不是独立 Accepted ADR artifact。本计划不把它们作为正式 ADR 约束；对应架构内容通过已确认设计决策 D1—D6 和本计划验收项追踪。

## 4. Authorization boundaries

### 4.1 当前授权

- 已授权：创建本计划、新分支和新 worktree。
- 未授权：开始生产代码实施、安装新依赖、发布、提交、推送、应用接入、冻结变更、外部服务验证。

### 4.2 后续实施边界

- 用户明确要求开始编码后，才可执行本计划的本地、非破坏性步骤。
- 根 `package.json` 仅增加 `packages/*` 与 `examples/*` 的 npm workspaces；不得顺带修改根 scripts、现有依赖版本或根 `tsconfig.json` 语义。
- `package-lock.json` 仅接受 npm 因两个 workspace manifest 产生的机械变化，必须单独审查现有根依赖无意漂移。
- package name/scope 已固定为 `@next-app-runtime/client`；registry、发布访问策略和版本发布仍未确认，不得猜测或发布。
- 获取 npm dist integrity、安装依赖或访问 registry 需要在实施时按当时授权与网络策略执行；失败不得用未验证值代替。
- package consumer 验证仅使用本地 fixture；不启动当前项目 Preview/Fastify，不访问 OpenAI/Figma。
- 完整 example 会新增上游已有的 UI/tooling 依赖，但“计划获采纳”不等于安装授权；实际修改 manifest/lockfile 和执行 `npm ci` 仍需用户明确开始编码。
- 双实现对比可启动本地 Vite 与临时 oracle clone 中的 Next server，但不得在上游 checkout 内 build/start、使用 portless、访问外部服务或自动安装 oracle 依赖。

## 5. Truth ownership

| 真相 | 所有者 | 不得由谁解释/扩展 |
|---|---|---|
| NextAppSpec 字段、可选性、LoaderFn 签名 | 包 `/schema` 与公共 TypeScript 类型，钉住 0.19.0 | 宿主 Catalog、Stream wrapper、当前 UISpec |
| Catalog 可用组件/action 与 props | 宿主传入的 RuntimeCatalog | NextAppSpec Schema |
| root/children/layout/Slot 引用闭合 | 包 reference gate | Router 或 renderer 猜测修复 |
| current/candidate/source transaction | 包 runtime store | ProjectStore promotion 语义 |
| location 与浏览历史 | Browser History Driver | Router 数据层 |
| route 匹配与 params | 私有 Router | Fastify 或第三方 Router |
| loader 实现与数据源授权 | 宿主 loader registry | NextAppSpec 或 runtime 内置 fetch |
| loader 运行次序、stale 丢弃、状态合并 | Route Runtime Controller | React 组件各自临时判断 |
| DOM head ownership | Metadata Controller | 宿主原有无 marker head 节点 |
| CSR runtime fallback UI 文案与产品表现 | `RuntimeOptions.fallbacks` | 私有包为新增 runtime API 硬编码产品文案 |
| 0.19.0 兼容组件默认 UI | 精确保留上游 `NextErrorBoundary` / `NextLoading` / `NextNotFound` 行为 | 用宿主 fallback 改写兼容组件语义 |
| artifact revision/CAS/来源/验证记录 | 未来宿主集成层，当前不实现 | NextAppSpec 字段或私有包 |
| example 当前 Spec | 当前页面 React state；持久副本由同源 `localStorage` key 持有 | runtime package、当前项目 ProjectStore、上游 checkout |
| example 跨标签同步 | 浏览器原生 `storage` event | Fastify、BroadcastChannel、轮询或隐藏 fallback |
| 搬迁对应关系 | `provenance-manifest.json` + v0.19.0 tag | 实施者记忆或当前上游 main |
| 对比结论 | 结构化断言、同一 Playwright flow 和截图 diff 证据 | README 声明、人工印象或最小 consumer |

## 6. GATE-00：编码前门禁

GATE-00 的 G00-01 至 G00-11 必须先完成；任一阻断项未解决时不得创建生产源文件。对比校准项 EXG-01 在 Increment 8 前完成，不阻塞前置包与 example 搬迁，但阻塞“功能/视觉已对齐”的最终结论。

| ID | 检查/决策 | 当前状态 | 通过证据 |
|---|---|---|---|
| G00-01 | 确认正式 workspace package name 与私有 scope | 已确认 | package name 固定为 `@next-app-runtime/client`；目录仍为 `packages/next-app-runtime/` |
| G00-02 | 确认设计证据可追溯 | 部分；本计划已记录路径与 SHA，但设计未落入本分支 | 实施前验证文件 SHA 仍一致；若不一致，重新 design review，不静默采用新内容 |
| G00-03 | 固定上游 provenance | 已有 tag/commit/package hash；npm integrity 未取 | `THIRD_PARTY_NOTICES.md` 记录 tag、commit、上游文件和经验证的 npm integrity；无 integrity 时明确标记未验证，不伪造 |
| G00-04 | 确认 root workspace 修改范围 | 已由 D6 与完整 example 落点授权 | diff 仅增加 `workspaces: ["packages/*", "examples/*"]` 或等价配置；不得改变根依赖版本/scripts |
| G00-05 | 确认 public export map | 已确认 | 只有 `.`, `./schema`, `./router`, `./stream`, `./testing`；不得增加 `./server` |
| G00-06 | 确认依赖边界 | 已确认 | runtime peer 仅为 React、Zod、json-render core/react；runtime 不新增 Next/Fastify/Router/state/fetch 依赖；Visual JSON、shadcn、Geist、Radix/Resizable、Tailwind 等只能属于 example |
| G00-07 | 确认变更 allowlist | 已确认 | 除根 manifest/lock 与本计划外，仅允许 `packages/next-app-runtime/**`、`examples/next-app-runtime-website-builder/**`；当前应用目录零修改 |
| G00-08 | 确认两个私有 workspace 的 license metadata | 已确认 | runtime 与 example manifest 都使用 `license: "UNLICENSED"`；各自目录包含 `LICENSES/Apache-2.0.txt` 与 `THIRD_PARTY_NOTICES.md`，记录对应复制/修改来源，不依赖不存在的根许可证 |
| G00-09 | 冻结第一版 public API 命名与 union | 已确认 | 以 `@json-render/next@0.19.0` 实际 exports 为命名/签名基线；相同语义保持同名，服务端接口排除，CSR/stream 新能力使用独立名称；第 7.1 节以 type-only fixture 锁定 |
| G00-10 | 固定 example 搬迁基线与全文件映射 | 已确认基线；manifest 待实施生成 | tag/commit/hash 复核通过；23 个上游文件全部出现在 provenance manifest，任何遗漏阻断 example 开工 |
| G00-11 | 固定浏览器 Spec Store 合同 | 已确认 | missing key 使用原始 `defaultSpec`；编辑 state 即时更新；500ms 后序列化写入；reload/new tab 读取；其他同源标签由 `storage` event 更新；不增加服务端/BroadcastChannel/自动修复 |
| EXG-01 | 固定 comparison allowed-differences 与视觉判定 | 待 Increment 8 首次 oracle 运行校准 | 仅允许 Next/Vite 框架 DOM、server-only exports 和 Store 介质差异；不得以宽松像素阈值掩盖应用拥有区域差异；校准结果写入 example 内 comparison 文档后才可宣称对齐 |

GATE-00 验证命令（实施前只读）：

```bash
git status --short
git rev-parse HEAD
git -C /Users/duxiaobo/workspaces/github/json-render show v0.19.0:packages/next/src/types.ts >/dev/null
git -C /Users/duxiaobo/workspaces/github/json-render diff --quiet v0.19.0 -- examples/next-website-builder
shasum -a 256 /Users/duxiaobo/workspaces/nickdu/figma-to-ui-agent/docs/architecture/next-app-spec-0.19-private-runtime-technical-selection.md
```

## 7. 文件落点与模块边界

计划新增：

```text
packages/next-app-runtime/
  package.json
  tsconfig.json
  tsconfig.build.json
  vite.config.ts
  LICENSES/
    Apache-2.0.txt
  THIRD_PARTY_NOTICES.md
  src/
    index.ts
    schema.ts
    router.ts
    stream.ts
    testing.ts
    contract/
      types.ts
      json-value.ts
      schema.ts
      prompt.ts
    errors/
      runtime-error.ts
      route-not-found.ts
    router/
      match-route.ts
      static-params.ts
      metadata.ts
    validation/
      catalog-gate.ts
      reference-gate.ts
      limits.ts
    stream/
      source.ts
      json-pointer.ts
      json-patch.ts
      jsonl-compiler.ts
    runtime/
      snapshot.ts
      spec-store.ts
      events.ts
      loader-runner.ts
      route-controller.ts
      create-runtime.ts
    navigation/
      location.ts
      browser-history.ts
    react/
      runtime-provider.tsx
      app-renderer.tsx
      page-renderer.tsx
      slot.tsx
      link.tsx
      error-boundary.tsx
    metadata/
      head-controller.ts
    testing/
      memory-navigation.ts
      fixtures.ts
  tests/
    contract/
    router/
    stream/
    runtime/
    react/
    security/
    consumer/
      index.html
      src/main.tsx
      vite.config.ts
    browser/
      runtime.spec.ts
      link.spec.ts
      metadata.spec.ts
  playwright.config.ts

examples/next-app-runtime-website-builder/
  CHANGELOG.md
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  postcss.config.mjs
  LICENSES/
    Apache-2.0.txt
  THIRD_PARTY_NOTICES.md
  UPSTREAM.md
  provenance-manifest.json
  comparison/
    allowed-differences.md
    flow-matrix.md
  src/
    main.tsx
    app.tsx
    globals.css
    components/
      editor.tsx
      route-tabs.tsx
      ui/resizable.tsx
    lib/
      catalog.ts
      default-spec.ts
      registry.tsx
      spec-store.ts
      utils.ts
      website-catalog.ts
      website-components.tsx
    runtime/
      builder-preview.tsx
      website-app.tsx
  tests/
    contract/
      provenance.test.ts
      default-spec.test.ts
      dependency-boundary.test.ts
    browser/
      builder.spec.ts
      website.spec.ts
      persistence.spec.ts
      parity.spec.ts
  playwright.config.ts
```

文件名允许在实现评审中做不改变边界的机械调整；public subpath、公共类型语义、example workspace 边界、上游文件一一映射和依赖方向不可变。example 不得把完整应用塞入 `packages/next-app-runtime/tests/consumer/`，最小 consumer 与完整 example 承担不同验证职责。

### 7.1 第一版 public contract lock

Increment 1 必须用 type-only fixture 固定以下公开合同，不得在后续增量临时改名。

上游兼容命名基线：

| 上游 `@json-render/next@0.19.0` API | 私有 CSR 包处理 |
|---|---|
| `NextAppProvider` / `useNextApp` / `NextAppProviderProps` / `NextAppContextValue` | 保持名称和既有 registry/handlers/navigate 语义 |
| `PageRenderer` / `PageRendererProps` | 保持名称及 `spec`、`initialState?`、`layoutSpec?`、`loading?` props |
| `NextErrorBoundary` / `NextErrorBoundaryProps` | 保持名称、props 与 0.19.0 行为；优先 errorSpec，否则显示上游默认错误 UI、原始 `error.message` 与 reset 按钮 |
| `NextLoading` / `NextLoadingProps` | 保持名称、`loadingSpec?` 与 0.19.0 行为；当前上游忽略 loadingSpec 并显示默认 spinner |
| `NextNotFound` | 保持名称与 0.19.0 默认 404 UI |
| `Link` / `LinkProps` | 保持名称及 `href/replace/prefetch/className/style`；实现替换为 anchor + History，prefetch 不触发 loader/cache |
| `NextAppSpec` / `NextRouteSpec` / `NextMetadata` / `MatchedRoute` / `LoaderFn` / `PageData` | 保持名称和 0.19.0 类型语义 |
| Catalog/Core type re-exports、`Spec`、`StateStore`、`createStateStore` | 与上游客户端入口保持等价 re-export，避免消费者改写常用 import |
| `matchRoute` / `slugToPath` / `collectStaticParams` / `resolveMetadata` | 保持名称和行为，但从纯 `/router` subpath 导出，不建立 `/server` |
| 上游有缺陷的 `schema` | 不直接复用；`/schema` 的 `schema` 名称保留，但实现为 D1 确认的公共类型一致正式 Schema |
| `createNextApp` / `CreateNextAppOptions` / `NextAppExports` | 不导出；这些绑定 Next.js page/server 生命周期，属于明确排除的服务端能力 |

CSR 新增 API 使用与上游不冲突的独立名称：

- Root：`createNextAppRuntime`、`NextAppRuntime`、`NextAppRuntimeProvider`、`NextAppRenderer`、`RouteNotFound` 和公开 runtime types。
- `/schema`：正式 `schema`、Prompt builder、`NEXT_APP_SPEC_COMPATIBILITY = "0.19.0"`，并 re-export 上述公共 Spec 类型。
- `/router`：`matchRoute`、`slugToPath`、`collectStaticParams`、`resolveMetadata` 及结果类型。
- `/stream`：`NextAppSpecSource`、RFC 6902 operation types、source compiler 的纯 Web API。
- `/testing`：Memory Navigation、fixtures、characterization helpers；生产入口不得静态导入该 subpath。
- `NextAppSpecSource` 精确区分 `object`、`json`、`jsonl-patch`；Patch source 显式携带 `base: "empty" | "current"`。
- `SourceResult` 精确区分 `committed | rejected | cancelled`。
- `SpecStatus` 精确区分 `empty | streaming | ready | invalid | cancelled`。
- `RouteStatus` 精确区分 `idle | unmatched | loading | ready | not_found | error`；除 `idle` 外需要时显式标记 `source: "current" | "candidate"`。
- Runtime error code 固定为：`contract_invalid`、`catalog_invalid`、`references_invalid`、`base_spec_missing`、`source_busy`、`source_limit_exceeded`、`json_parse_failed`、`patch_invalid`、`patch_test_failed`、`reserved_name_conflict`、`catalog_registry_mismatch`、`layout_missing`、`slot_missing`、`loader_missing`、`loader_failed`、`route_not_found`、`render_failed`、`metadata_apply_failed`。
- `RuntimeOptions` 固定包含 `initialSource?`、`catalog`、`registry`、`handlers?`、`loaders?`、`limits`、`fallbacks`、`observer?`；registry/config 在一个 runtime 生命周期内不可变。
- `NextAppRuntime` 固定提供 `applySource(source, { signal? })`、`retryLoader()`、`getSnapshot()`、`subscribe(listener)`、`dispose()`；不增加 ProjectStore/publish/fetch 方法。
- `RuntimeFallbacks` 固定包含 `loading`、`error`、`notFound`、`unmatched`；每个 callback 只接收 `{ snapshot: RuntimeSnapshot; status: RouteStatus }` 并返回 React 可渲染值，不接收原始 loader 异常正文。
- Observer event 名称固定为：`source_received`、`source_validated`、`source_committed`、`source_rejected`、`source_cancelled`、`location_changed`、`route_matched`、`route_unmatched`、`loader_started`、`loader_succeeded`、`loader_failed`、`loader_stale`、`action_dispatched`、`action_settled`、`metadata_applied`、`metadata_apply_failed`、`render_failed`。公共 payload 在 Increment 1 type fixture 中一次冻结，只含机器状态与脱敏标识，不含 Spec/loader 正文或敏感 URL。

新增 CSR Runtime 的 fallback 回调必须按 `RouteStatus`/`RuntimeError` 接收结构化状态并返回 React 可渲染值；包不为该新增 API 提供默认产品文案。兼容导出的 `NextErrorBoundary`、`NextLoading`、`NextNotFound` 则精确保留上游 0.19.0 默认 UI，包括默认错误页显示原始 `error.message`；这是用户在实现审核中明确确认的官方兼容行为。结构化 runtime event/error payload 仍不得携带原始异常正文。若实现发现必须改变以上名称或 union，停止并回到设计复核，不得当作机械实现细节处理。

### 7.2 完整 example 搬迁合同

上游 23 个文件按下列规则处理，并由 `provenance-manifest.json` 逐文件记录 source path、source hash、target path、classification 和 reason：

| 分类 | 处理规则 |
|---|---|
| `unchanged` | 内容按源文件保持，仅允许 import path/format 的机械变化时改列为 `ported` |
| `ported` | 保留应用拥有的功能、文案、DOM 语义和样式；仅替换 Next/runtime/构建接线 |
| `replaced` | `/api/spec`、module Store、Next app composition 等由已确认 CSR 等价物替换，必须写明行为映射 |
| `excluded-server-only` | 仅限 `createNextApp` server glue、Next route handlers、RSC page/layout/static generation；不得借此排除 Builder/UI/Catalog/Spec/样式 |

搬迁后的 host composition 固定为：

- `pathname === "/builder"`：渲染完整 Editor。Editor 内部继续使用 `activeRoute` 驱动右侧嵌入预览，保留 AddressBar、链接拦截、Resizable Panels、sidebar toggle 与 Visual JSON。
- 其他 pathname：渲染 `NextAppRenderer`，由私有 Browser History driver 处理 Link、push/replace、back/forward 与 route matching。
- “View Website” 仍以新标签页打开 `/`；新标签从同源 storage 读取编辑后的最新 Spec。
- `defaultSpec` 的 route/layout/state/metadata/page tree 和可见内容不做重写；Catalog、registry、shadcn 与 website components 的 component/action 集合保持一致。
- Geist 字体变量、Tailwind theme、tw-animate-css 和原组件 className 保留；只把 Next root layout 和 Tailwind `@source` 改为 Vite/npm package 可解析路径。
- example 的静态 title/description 与 route metadata 都由客户端 head ownership 处理；不实现 Next `Metadata`、`generateMetadata` 或 `generateStaticParams` server exports。页面 body 中的 “Next Website Builder” 保留；静态 document title/description 的官方 `json-render`/Next.js attribution 必须改为私有 package 身份，并作为精确、非视觉 allowed difference 记录，避免暗示官方包身份。

Spec Store 合同固定为：

1. storage key 缺失时，当前值为原始 `defaultSpec`。
2. Editor 每次变更立即更新本标签页 React state 和右侧预览；保持上游 500ms debounce 后写入 storage。
3. 页面刷新和同源新标签页从 storage 读取最后一次成功序列化的值；其他标签页通过原生 `storage` event 接收更新。
4. 不增加 BroadcastChannel、IndexedDB、Fastify/API、轮询、跨 origin 同步或跨用户共享。
5. 不静默修复或覆盖无法解析/无法通过 runtime gate 的持久值；由 example/runtime 的显式 error 状态暴露，最后一份 runtime current 不被失败 candidate 覆盖。
6. 测试必须清理其专用 origin 的 storage；不得清理用户其他 origin 或使用不受控全局 key。

上游 Next Store 的“同一 Node 进程内跨浏览器客户端共享”属于明确允许差异，因为纯 CSR 无服务器边界无法保留；除此之外，编辑、刷新和同浏览器新标签页的用户旅程必须保持。

## 8. 验收标准

### 8.1 Runtime 包验收

| ID | 验收标准 |
|---|---|
| PKG-AC-01 | 正式 Schema 接受公共类型允许的全部字段并拒绝未知字段；不因上游 schema bug 错删合法字段 |
| PKG-AC-02 | Spec 不含任何私有字段；source wrapper、limits、artifact metadata 均在 Spec 外 |
| PKG-AC-03 | Router corpus 对 `/`、静态、dynamic、catch-all、optional catch-all、冲突优先级和空 pathname 与上游 0.19.0 一致 |
| PKG-AC-04 | Router 不自行规范化 trailing slash、decode、大小写或 query/hash |
| PKG-AC-05 | object、JSON、等价 JSONL Patch 产生相同最终 NextAppSpec；重复 operation 不被去重 |
| PKG-AC-06 | 六种 RFC 6902 operation、JSON Pointer 转义、严格 replace/remove/test 和原型污染语料均有测试 |
| PKG-AC-07 | `base: empty/current`、`base_spec_missing`、`source_busy`、AbortSignal 和 limits 有确定事务结果 |
| PKG-AC-08 | candidate 一旦 renderable 即可观察；失败/取消保留可诊断 candidate，但不覆盖 current |
| PKG-AC-09 | contract/catalog/reference/renderable 四层门禁产生不同稳定错误码 |
| PKG-AC-10 | layouts/Slot、Link、navigate、json-render built-in actions 与 host actions 正常接线；保留名称冲突失败关闭 |
| PKG-AC-11 | loader 签名严格为 `LoaderFn(params)`；runtime 不增加参数、不绑定 Fastify/fetch/auth |
| PKG-AC-12 | state 浅合并顺序为 spec.state <- route.page.state <- loader result |
| PKG-AC-13 | loader missing、普通 error、RouteNotFound、retry、stale result 是不同机器状态；旧结果不能覆盖新 route |
| PKG-AC-14 | 仅 route identity/loader 名称变化或 retry 重跑 loader；query/hash、page/layout/metadata/state 普通 Patch 不重跑 |
| PKG-AC-15 | StateProvider 不因普通 render/Patch 意外重置用户 state；未变化 merged state 保持引用稳定 |
| PKG-AC-16 | Link 使用真实 anchor，正确处理 push/replace、修饰键、target、download、外链、hash、滚动和 back/forward；prefetch 不触发 loader/cache |
| PKG-AC-17 | metadata merge 与上游一致；只管理 owned tags，清理 stale tags，dispose 不覆盖宿主并发 title |
| PKG-AC-18 | staticParams 只枚举路径，不生成 HTML、不限制 Router 可达范围 |
| PKG-AC-19 | 所有输入必须由宿主显式提供五类 limits；不存在隐藏产品默认值 |
| PKG-AC-20 | 结构化 runtime 事件与 RuntimeError 不泄露 Spec/loader/异常正文、凭据或敏感 URL；0.19.0 兼容错误组件按官方行为显示 `error.message`；dispose 后无订阅/ownership 泄漏 |
| PKG-AC-21 | package build 产出 ESM 和 `.d.ts`；五个 subpath 可从 consumer fixture 导入，peer 不产生第二份 React/json-render Context |
| PKG-AC-22 | 依赖树中不存在 Next.js、Fastify、React Router、TanStack Router、Wouter、Redux/Zustand/XState |
| PKG-AC-23 | 包生产源码和 Prompt 中不存在 UISpec、UISpec adapter 或兼容双写逻辑 |
| PKG-AC-24 | Apache-2.0 License、attribution、复制/修改来源说明完整，不暗示官方包身份 |

架构验收 AC-18（Fastify 深链接）和 AC-22 的“最终应用集成无双写”部分不在本计划内；分别由未来宿主接入计划验证。包内的“无 UISpec”部分由 PKG-AC-23 覆盖。

### 8.2 完整 example 与对比验收

| ID | 验收标准 |
|---|---|
| EX-AC-01 | 上游 v0.19.0 `examples/next-website-builder` 的 23 个文件全部出现在 provenance manifest；每个文件都有可核验 source hash、target/classification/reason，零遗漏 |
| EX-AC-02 | `defaultSpec` 的 routes、layouts、state、metadata、page trees、可见文案与上游基线结构化等价；Spec 未加入 storage、router 或 example 私有字段 |
| EX-AC-03 | Catalog component/action 定义、registry component/action 实现、shadcn components 与 website components 集合和 props schema 与上游等价 |
| EX-AC-04 | Builder 保留 Visual JSON、可调整双栏、AddressBar/route tabs、sidebar toggle、右侧多页预览和 “View Website” 新标签页入口；不得用简化 textarea 或静态 fixture 替代 |
| EX-AC-05 | 编辑立即更新当前预览，500ms debounce 后持久化；刷新、新标签页和其他同源标签页可见最新成功写入值；测试确认不依赖 `/api/spec` |
| EX-AC-06 | `/builder` 与网站 routes 分工明确；`/`、`/about`、`/contact` 可直接访问、点击导航、replace、back/forward 和刷新，且均由私有 Browser History Router 驱动 |
| EX-AC-07 | 网站布局 Slot、Link、metadata/title、state、shadcn 和自定义 website components 在完整 example 中真实渲染，不以 mock registry 或最小 consumer 代替 |
| EX-AC-08 | example 生产源码、构建产物和依赖树不存在 Next.js、Fastify、`@json-render/next`、第三方 Router、服务端 route handler 或 UISpec adapter |
| EX-AC-09 | Visual JSON、Resizable Panels、Geist、Lucide、Radix、Tailwind、shadcn 等依赖只属于 example workspace；runtime package manifest、metafile 和 consumer bundle 不包含它们 |
| EX-AC-10 | 同一浏览器 flow matrix 同时运行上游 oracle 与搬迁 example；Builder 编辑/导航/持久化、网站导航/metadata/state 的可观察结果一致，除明确 allowed differences 外零未解释差异 |
| EX-AC-11 | 固定 viewport、DPR、font readiness、locale、color scheme、reduced motion 下生成同路由/同状态截图；应用拥有区域不存在未解释视觉差异，阈值和 masking 不得隐藏应用内容 |
| EX-AC-12 | example 独立完成 typecheck、build、browser E2E 和从已构建 `@next-app-runtime/client` 消费验证；manifest 为 `UNLICENSED`，Apache 全文/notice/provenance 完整；当前 `src/**`、`preview/**` 和工具边界零修改 |

## 9. 实施增量

### Increment 0：GATE-00 与 workspace/package scaffold

目标：建立不影响当前应用的 workspace 和独立包构建边界。

设计对齐：D6（同仓库 workspace-first）以及设计中的第三方许可要求；没有独立 Accepted ADR artifact。

文件：

- 修改根 `package.json`：仅增加 `packages/*`、`examples/*` npm workspace 声明；本增量只登记 runtime 包，example manifest 在 Increment 7 加入后再机械更新 lockfile。
- 机械更新根 `package-lock.json`：登记 workspace；检查无现有依赖版本漂移。
- 新增 `packages/next-app-runtime/package.json`：`private: true`，G00-01 确认的 name、G00-08 确认的 license、ESM、五个 subpath exports、peerDependencies 与 scripts。
- 新增 `packages/next-app-runtime/tsconfig.json`、`tsconfig.build.json`：继承当前 ES2022/NodeNext 风格，但声明产物独立 emit。
- 新增 `packages/next-app-runtime/vite.config.ts`：library mode 使用 `index/schema/router/stream/testing` 五入口，React、Zod、json-render core/react external；输出文件名必须与 exports 一致。
- 新增 `LICENSES/Apache-2.0.txt`、`THIRD_PARTY_NOTICES.md`；不得用第三方 license 文件隐式决定私有包自身许可。

依赖：G00-01 至 G00-11 全部通过；EXG-01 尚不要求完成。

验证：

```bash
npm install --package-lock-only --ignore-scripts --audit=false --fund=false
npm ci --ignore-scripts --audit=false --fund=false
npm query .workspace --json
git diff -- package.json package-lock.json packages/next-app-runtime
```

本增量尚未创建 production entry，不运行 package build；第一次 typecheck/build 必须在 Increment 1 public entry 创建后执行。`npm ci` 只安装 lockfile 已声明的本地验证依赖，不授权新增未在本计划中的 dependency。

验收：PKG-AC-21、PKG-AC-22、PKG-AC-24 的 scaffold 部分。

回滚：删除新增包目录，恢复根 manifest/lock；没有数据迁移。

### Increment 1：Contract 019、正式 Schema 与 Prompt

目标：先冻结公共合同，后续模块只依赖这一份真相。

设计对齐：D1（公共 TypeScript 类型优先）和 G00-09（v1 public contract lock）；没有独立 Accepted ADR artifact。

文件：

- `src/contract/types.ts`：等价导出 NextMetadata、NextRouteSpec、NextAppSpec、MatchedRoute、LoaderFn、PageData。
- `src/contract/json-value.ts`：验证 object 输入为可传输 JSON 数据图，拒绝 undefined/function/symbol/bigint/cycle/class instance。
- `src/contract/schema.ts`：Zod 4 strict schema，与公共类型字段精确一致。
- `src/contract/prompt.ts`：基于同一合同和宿主 Catalog 生成 NextAppSpec prompt；不引用有缺陷上游 schema。
- `src/errors/*`、`src/runtime/snapshot.ts`、`src/runtime/events.ts`：按第 7.1 节冻结 RuntimeError code、SourceResult、RuntimeSnapshot 与 observer event union。
- `src/schema.ts`、`src/index.ts`：建立公共出口。
- `tests/contract/*`：最小/完整/非法/上游 schema conflict fixtures。

关键测试：

- 最小 `{ routes: {} }` 可通过正式 Schema。
- `on`、`repeat`、`watch` 等 `Spec` 公共字段不会被缩小。
- 未知 NextAppSpec/route/metadata 字段被拒绝。
- source wrapper 与 runtime 配置无法混入 Spec。
- Catalog invalid 与 reference invalid 不误报 `contract_invalid`。
- public `.d.ts` 不出现 Fastify、Next、UISpec。
- type-only public API fixture 对第 7.1 节所有 export 名称、status/error union 和 callback 参数做编译期断言。

验证：

```bash
npm run --workspace packages/next-app-runtime typecheck
npm run --workspace packages/next-app-runtime test -- tests/contract
npm run --workspace packages/next-app-runtime build
```

验收：PKG-AC-01、02、09、20、23。

回滚：只移除本增量合同/fixture；不得临时改用上游有缺陷 schema 以绕过测试。

### Increment 2：Router、Metadata resolve 与 Static Params characterization

目标：把上游 0.19.0 的纯函数行为作为可执行 compatibility corpus 固定下来。

设计对齐：D1（0.19.0 公共合同优先）及已确认的 Browser History + 私有 Router 选择；没有独立 Accepted ADR artifact。

文件：

- `src/router/match-route.ts`：移植并标记修改来源，保持排序和 params 行为。
- `src/router/static-params.ts`：移植 collect/build 行为。
- `src/router/metadata.ts`：移植 resolveMetadata 纯函数。
- `src/router.ts`：纯模块公开出口，不导入 DOM/React。
- `tests/router/*`：上游 characterization、冲突、稳定顺序、边界 corpus。

关键测试：

- 同一 fixture 同时运行上游基线函数快照与私有实现，比较结构化结果。
- `pathname === ""` 只转为 `/`；trailing slash 不自动修复。
- query/hash 不传入 matcher。
- 同 specificity 使用稳定 insertion order，不自行增加 tie-breaker。

验证：

```bash
npm run --workspace packages/next-app-runtime test -- tests/router
npm run --workspace packages/next-app-runtime typecheck
```

验收：PKG-AC-03、04、17 的 resolve 部分、18。

回滚：恢复到 Increment 1；不得用第三方 Router 替代。

### Increment 3：严格 Source、JSON Pointer 与 RFC 6902 Transaction

目标：在独立 candidate 上实现三类 source 和失败关闭事务。

设计对齐：D5（非法 Patch/test 失败终止并保留 current）；没有独立 Accepted ADR artifact。

文件：

- `src/stream/source.ts`：`object | json | jsonl-patch` 可辨识联合、base 与 signal plumbing。
- `src/stream/json-pointer.ts`：安全 JSON Pointer 解析；不沿 prototype chain。
- `src/stream/json-patch.ts`：六种 operation 严格顺序执行，无去重/宽松 replace/路径修复。
- `src/stream/jsonl-compiler.ts`：任意 chunk、UTF-8、末行无换行、bytes/operations limits。
- `src/validation/limits.ts`：maxBytes/maxOperations/maxDepth/maxRoutes/maxElementsPerTree，必须由宿主提供。
- `src/runtime/spec-store.ts`：current/candidate 深拥有、可观察、commit/reject/cancel。
- `src/stream.ts`：纯 Web API subpath 出口。
- `tests/stream/*`、`tests/security/*`。

关键测试：

- 同一 operation 重复出现仍执行两次。
- add/remove/replace/move/copy/test 和 `~0`/`~1`。
- replace/remove 目标不存在立即失败。
- test deep equality 失败返回 `patch_test_failed`。
- `__proto__`/`constructor`/`prototype` corpus 不污染全局对象原型。
- source_busy 不取消当前事务；AbortSignal 不改变 current。
- candidate renderable 后发布 snapshot；最终 gate 失败不 commit。

验证：

```bash
npm run --workspace packages/next-app-runtime test -- tests/stream tests/security
npm run --workspace packages/next-app-runtime typecheck
```

验收：PKG-AC-05、06、07、08、19、20。

回滚：恢复到 Increment 2；current 数据只在内存，无持久化回滚。

### Increment 4：Reference/Catalog Gates 与 Route Runtime Core

目标：完成与 React/DOM 无关的路由运行控制、loader 竞态和 state merge。

设计对齐：D2（公开功能合同接线）和 D3（客户端 loader、stale/error/notFound 语义）；没有独立 Accepted ADR artifact。

文件：

- `src/validation/catalog-gate.ts`：Catalog/registry/action 名称集合一致性与 reserved names。
- `src/validation/reference-gate.ts`：root/children/layout/Slot 闭合验证。
- `src/runtime/loader-runner.ts`：run id、sync/async、stale、retry、RouteNotFound sentinel。
- `src/runtime/route-controller.ts`：route identity、loader trigger、state merge/memoization、状态机。
- `src/runtime/create-runtime.ts`：不可变 registries/config、source/router/controller 组装、subscribe/dispose。
- `tests/runtime/*`。

关键测试：

- route identity 精确为 pattern + params；query/hash 不触发 loader。
- page/layout/metadata/state patch 更新 render data 但不重跑 loader。
- route.loader 名称变化触发 loader。
- 快速 A -> B 后 A 的迟到结果产生 stale event，不能覆盖 B。
- loader missing、普通异常、RouteNotFound sentinel、retry 输出不同状态。
- state merge 顶层浅覆盖顺序正确，未变化结果保持引用稳定。
- registry/catalog 和 Slot/Link/navigate、setState/pushState/removeState 冲突失败关闭。

验证：

```bash
npm run --workspace packages/next-app-runtime test -- tests/runtime
npm run --workspace packages/next-app-runtime typecheck
```

验收：PKG-AC-09—15、19、20。

回滚：恢复到 Increment 3；不得用 silent skip 处理 missing loader/reference。

### Increment 5：Browser History、React Renderer、Link 与 Head Ownership

目标：把 Runtime Core 接入浏览器和 `@json-render/react@0.19.0`，完成公开 CSR 功能。

设计对齐：D2（Slot/Link/loading/error/notFound 接线）和 D4（prefetch 首版不触发 loader/cache）；没有独立 Accepted ADR artifact。

文件：

- `src/navigation/location.ts`、`browser-history.ts`：useSyncExternalStore-compatible snapshot/subscription、push/replace/popstate。
- `src/react/runtime-provider.tsx`：runtime 生命周期与稳定 context。
- `src/react/page-renderer.tsx`、`slot.tsx`：layout 注入 page，复用 json-render providers。
- `src/react/link.tsx`：真实 anchor、可访问点击判定、History 导航、hash/scroll；prefetch no-op contract。
- `src/react/app-renderer.tsx`：loading/error/notFound/unmatched 与宿主 fallback。
- `src/react/error-boundary.tsx`：render_failed 边界。
- `src/metadata/head-controller.ts`：owned keyed tags、title guard、cleanup/retry diagnostic。
- `src/index.ts`：browser-only root export。
- `src/testing/memory-navigation.ts`、`fixtures.ts`、`src/testing.ts`：确定性测试设施。
- `tests/react/*`：只覆盖不需要 DOM 的组件结构、类型和纯状态组装。
- `tests/consumer/*`、`tests/browser/*`、`playwright.config.ts`：使用现有 Vite + Playwright 在真实 Chromium 覆盖 History、anchor、scroll 与 DOM head；不新增 jsdom/happy-dom。

关键测试：

- push/replace 主动通知，popstate 响应 back/forward。
- 同源站内点击才拦截；修饰键、非主按钮、download、非 `_self`、外链保持原生。
- route change 的 hash/scroll 行为，back/forward 交给原生 restoration。
- Slot 精确注入；loading/error/notFound Spec 使用相同 Catalog/providers。
- StateProvider mounted 稳定，普通 rerender 不重置用户 state。
- metadata stale owned tag 清理，宿主原有 tags 不动，title 并发保护。
- 兼容组件精确保留 0.19.0 默认错误页、spinner 与 404；新增 CSR runtime 的无 Spec 路径仍使用宿主 fallbacks。
- dispose 清理 popstate、runtime、observer、metadata ownership。

验证：

```bash
npm run --workspace packages/next-app-runtime test -- tests/react
npm run --workspace packages/next-app-runtime test:browser
npm run --workspace packages/next-app-runtime typecheck
```

验收：PKG-AC-10、15、16、17、20。

回滚：恢复到 Increment 4；纯函数 `/schema`、`/router`、`/stream` 仍保持可用。

### Increment 6：Public exports、Consumer Fixture 与全包门禁

目标：证明包从构建产物而非源码路径可被独立消费。

设计对齐：D1—D6 的包内部分；没有独立 Accepted ADR artifact。

文件：

- 收口 `package.json` exports/files/sideEffects/peerDependencies。
- `tests/consumer/`：最小 Vite React consumer，分别导入 root、schema、router、stream；`testing` 由独立测试入口导入并断言未进入 production consumer bundle。
- package-level dependency/provenance assertions：只检查私有包 manifest、exports、构建 metafile/产物 import，不检查整个根仓库依赖树。
- 仅在发现声明生成问题时机械调整 package tsconfig/Vite config，不改变公共合同。

验证：

```bash
npm run --workspace packages/next-app-runtime clean
npm run --workspace packages/next-app-runtime typecheck
npm run --workspace packages/next-app-runtime test
npm run --workspace packages/next-app-runtime build
npm run --workspace packages/next-app-runtime test:consumer
npm run --workspace packages/next-app-runtime test:dependencies
test -x "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:?set an explicit Chromium executable for package browser tests}"
npm run --workspace packages/next-app-runtime test:browser
rg -n "UISpec|ui-spec|load_ui_spec|save_ui_spec" packages/next-app-runtime/src packages/next-app-runtime/package.json
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm exec -- vite build --config vite.config.ts
git status --short
```

说明：

- `rg` 应零命中；测试 fixture 若需要说明“不接受 UISpec”，也应以结构断言表达，避免引入 adapter。
- `test:dependencies` 只判定私有包自己的 direct/peer graph 与构建产物 import；根宿主将来即使合法使用 Fastify，也不能导致包边界测试误报。
- Package Playwright config 从 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 读取浏览器路径并在路径缺失时失败关闭，不硬编码另一个 worktree，也不自动下载浏览器。当前机器已有可复用 Chromium，但复用/复制/安装动作在实施时单独确认。
- 当前根 `playwright.e2e.config.ts` 仍要求本 worktree 的 `data/playwright-browsers/...`。执行根 `test:e2e` 前必须只读检查该路径；缺失时停止并确认复用现有本地浏览器或授权安装，不把未运行写成通过。
- 根项目门禁只用于证明 workspace/lock 变化未回归当前基线，不代表完成应用接入。
- 不运行外部 probe、M3 flow、freeze 或 blind。

验收：PKG-AC-01—24 全部通过。

回滚：恢复到 Increment 5 或整个包变更；无应用调用方、无数据迁移、无 registry 发布。

### Increment 7：完整 Website Builder Example 搬迁

目标：把上游 v0.19.0 `examples/next-website-builder` 的完整应用拥有能力搬入独立 Vite workspace，只替换 Next.js/server/runtime 接线。

设计对齐：用户确认的“完整搬迁”、`localStorage + storage event`、独立 example workspace，以及第 7.2 节合同；没有独立 Accepted ADR artifact。

前置：Increment 6 全部通过；`@next-app-runtime/client` public exports 已冻结；G00-10/G00-11 仍与实施证据一致。

文件与动作：

- 新增 `examples/next-app-runtime-website-builder/package.json`：`private: true`、`license: "UNLICENSED"`；依赖 `@next-app-runtime/client: workspace:*`、`@json-render/core/react/shadcn@0.19.0` 和上游 example 的 Visual JSON、CVA、clsx、Geist、Lucide、Radix/Resizable、Tailwind 工具链；React/React DOM、TypeScript、Vite 与根锁定版本对齐。不得包含 Next、portless、Fastify、第三方 Router。
- 新增 Vite/React 入口、tsconfig、PostCSS/Tailwind 与 `index.html`；更新根 lockfile，仅接受新增 example workspace 与明确 allowlist 依赖。
- 原样搬迁或机械 port `default-spec.ts`、`website-catalog.ts`、`website-components.tsx`、`route-tabs.tsx`、`resizable.tsx`、`utils.ts`；所有非机械变化必须在 provenance manifest 解释。
- `catalog.ts` 改从 `@next-app-runtime/client/schema` 取得正式 schema；`registry.tsx` 保持相同 component/action 集合。
- `editor.tsx` 保留完整 UI 与 500ms debounce；仅把 `/api/spec` fetch 替换为 `spec-store.ts` 的浏览器读写/订阅接口，把 `@json-render/next` imports 换成私有包 exports。
- `app.tsx` 作为 example host shell：`/builder` 渲染 Editor；其余 pathname 渲染 `website-app.tsx`，后者只通过 `NextAppRenderer`/Browser History runtime 消费 Spec。
- `builder-preview.tsx` 保持上游 Editor 的内嵌 `activeRoute`、layout/state merge 与 PageRenderer 行为，不把 Builder 自身 route 写入 NextAppSpec。
- `spec-store.ts` 严格实现第 7.2 节六项合同；storage key 为 example 私有、版本化、同源 key，不成为 runtime public API。
- `globals.css` 保留上游 theme/class 行为，将 `@source` 改为已安装 `@json-render/shadcn` 可解析内容路径；Geist 字体变量继续应用在 app root。
- `LICENSES/Apache-2.0.txt`、`THIRD_PARTY_NOTICES.md`、`UPSTREAM.md` 与 `provenance-manifest.json` 固定 tag/commit/hash/许可和 23 文件映射；`comparison/*.md` 先记录 flow 与允许差异草案，不提前宣称 parity。

关键验证：

```bash
npm install --package-lock-only --ignore-scripts --audit=false --fund=false
npm ci --ignore-scripts --audit=false --fund=false
npm run --workspace examples/next-app-runtime-website-builder typecheck
npm run --workspace examples/next-app-runtime-website-builder test -- tests/contract
npm run --workspace examples/next-app-runtime-website-builder build
npm run --workspace examples/next-app-runtime-website-builder test:browser
npm run --workspace packages/next-app-runtime test:dependencies
git diff -- package.json package-lock.json examples/next-app-runtime-website-builder packages/next-app-runtime
```

浏览器 flow：

- 首次 `/builder` 使用原始 defaultSpec，三个 route tabs 和完整双栏可见。
- 通过 Visual JSON UI 修改可见文案，不直接注入 storage；当前右侧预览立即变化，等待 500ms 后刷新仍在。
- 点击 “View Website” 打开新标签页，`/` 显示新文案；随后导航 `/about`、`/contact`，再 back/forward/refresh。
- 保持两个同源标签页，第二个标签通过 `storage` event 观察后续编辑。
- invalid persisted candidate 不覆盖 runtime current，不发生 silent default repair。

验收：EX-AC-01—09、EX-AC-12；并持续验证 PKG-AC-16、17、21—24。

回滚：删除独立 example workspace 并恢复根 lockfile；runtime 包保持 Increment 6 完成态。storage 仅存在于测试 origin，测试 teardown 清理该专用 key，无业务数据迁移。

### Increment 8：上游 Oracle 双实现对比与最终门禁

目标：用同一套可观察用户 flow 和固定浏览器条件，对未修改的上游 v0.19.0 Next example 与搬迁后的 Vite example 做结构化、行为与视觉三层对比。

设计对齐：用户要求“改造为我们包的 example，然后再对比”；上游 checkout 只读、tag `v0.19.0` 为 oracle，当前上游 main 不作为浮动真相。

前置：Increment 7 通过；上游 checkout/commit/hash 重验一致。以 `mktemp -d` 创建本次验证专用目录，用本地 `git clone --no-hardlinks` 克隆上游 repository 并 detached checkout `v0.19.0`；所有 `.next`、安装与构建写入只发生在该临时 clone。若临时 clone 需要从网络补齐 pnpm 依赖，停止并取得单独授权；原上游 checkout 始终只读。

文件与动作：

- 完成 `comparison/flow-matrix.md`：同一 flow step 分别列出 oracle selector/action/expected 与 candidate selector/action/expected。
- 完成 `comparison/allowed-differences.md`：只允许 Next hydration/framework DOM、server-only export、端口/构建容器、静态 document title/description 的 package attribution，以及 Node module Store 对浏览器 localStorage 的介质与共享范围差异；应用 body 的可见文案、组件、布局、样式、导航和 Builder 功能不在允许列表。
- `tests/browser/parity.spec.ts` 只连接两个显式 base URL；oracle 目录由 `JSON_RENDER_ORACLE_DIR` 注入，不把用户绝对路径写入脚本或产物。不得启动 portless、改写 host、调用外部网络或修改原上游 checkout。
- 在临时 clone 内用 frozen pnpm lockfile 安装/复用依赖并执行上游 production build/start；candidate 使用 Vite build/preview。两者使用显式、非冲突 localhost 端口，禁止 dev overlay。
- 结构化比较：defaultSpec、route keys、layout names、Catalog/registry 名称集合、metadata、页面 state merge 与可见 DOM landmarks。
- 行为比较：Builder 首次加载、route tabs、Visual JSON 编辑、500ms 持久化、刷新、新标签页、三页面导航、back/forward、metadata/title、Slot/Link/state。
- 视觉比较：固定同一个 Chromium process、viewport、DPR、locale、timezone、light color scheme、reduced motion；等待两边 `document.fonts.ready`；每个 flow checkpoint 依次取得 oracle/candidate PNG buffer，默认要求字节完全相等，并把两份 buffer 作为 Playwright attachments 保留以供诊断。
- EXG-01 校准：不 mask 应用区域、不设置像素阈值或 ratio；若 PNG 编码差异但解码像素可证明完全相同，可在 parity test 内用浏览器 Canvas 解码并逐 RGBA channel 精确比较，仍要求零像素差；不得导入当前应用 `src/validation/**`。任何非零像素容差都必须经 plan/design review，不能由实施者自行放宽。
- 机器结果写入 example 自身 `test-results/`（ignored）并在命令输出汇总；不得把绝对用户路径、环境信息或上游响应正文写入版本库。

验证：

```bash
git -C /Users/duxiaobo/workspaces/github/json-render diff --quiet v0.19.0 -- examples/next-website-builder
test "$(git -C /Users/duxiaobo/workspaces/github/json-render rev-parse v0.19.0)" = "0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7"
test -n "${JSON_RENDER_ORACLE_DIR:?set the disposable v0.19.0 oracle clone path}"
test "$(git -C "$JSON_RENDER_ORACLE_DIR" rev-parse HEAD)" = "0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7"
JSON_RENDER_ORACLE_DIR="$JSON_RENDER_ORACLE_DIR" npm run --workspace examples/next-app-runtime-website-builder test:parity
npm run --workspace examples/next-app-runtime-website-builder test:browser
npm run --workspace examples/next-app-runtime-website-builder build
npm run --workspace packages/next-app-runtime test:consumer
npm run --workspace packages/next-app-runtime test:dependencies
npm run --workspace packages/next-app-runtime test:browser
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm exec -- vite build --config vite.config.ts
git status --short
```

验收：EX-AC-10、11，并复验 PKG-AC-01—24、EX-AC-01—12 全覆盖。

回滚：对比失败不修改原上游 checkout、不删除诊断 candidate；修复仅允许落在 runtime 包或独立 example 的责任文件。验证结束后只清理本轮明确创建的临时 clone 路径；若差异需要改变 NextAppSpec/public contract、增加服务器或扩展允许差异，停止并回到设计复核。

## 10. 风险、控制与残余假设

| 风险/假设 | 控制/验证 | 阻断点 |
|---|---|---|
| 上游公共类型与 schema 冲突 | D1；双 fixture 证明正式 Schema 以类型为准 | Contract 实施 |
| 复制上游代码造成许可遗漏 | License、notice、来源文件修改标记、provenance assertion | 全包验收 |
| root workspace 造成锁文件漂移 | lock diff allowlist；现有版本不得变化 | Increment 0 |
| React/json-render 出现双实例 | peerDependencies + consumer bundle/dependency tree 检查 | Increment 6 |
| Browser API 支持矩阵尚未确认 | package tests 使用当前 Playwright Chromium；正式支持声明/发布前另行确认矩阵 | 不阻塞本地实现，阻塞发布 |
| 正式 registry 与发布访问策略尚未确认 | package name 已固定为 `@next-app-runtime/client`；本计划保持 `private: true` 且排除发布 | 不阻塞包实现，阻塞未来发布 |
| 首个宿主是否根路径部署未知 | 包本身仅接受 root-relative same-origin URL，不实现 basename；由未来接入设计验证 | 不阻塞包，实现后接入前阻断 |
| 设计文档不在本分支 | 以 SHA 钉住；变化则重新 review | G00-02 |
| 候选可见与 current 安全存在张力 | snapshot 同时暴露 current/candidate；commit gate 与 Preview 展示分离测试 | Increment 3/4 |
| loader 无 AbortSignal 参数无法主动取消请求 | D3 保持精确签名；run id 只丢弃 stale result，不暗示已取消数据源 | Increment 4 |
| “完整搬迁”被最小 consumer 或静态 fixture 偷换 | 独立 EX-AC、23 文件 provenance、真实 Builder UI flow；最小 consumer 与完整 example 分开验收 | Increment 7/8 |
| example UI/tooling 依赖污染 runtime 包 | 独立 workspace manifest；runtime dependency/metafile/consumer bundle 反向断言 | Increment 7/8 |
| localStorage 与原 server store 共享范围不同 | 已确认同源浏览器合同；allowed-differences 明确仅接受跨客户端共享范围差异 | Increment 7/8 |
| Visual JSON 编辑的中间无效值覆盖最后可用网站 | Editor state/candidate 可见与 runtime current commit 分离；不做 silent repair，invalid candidate 有明确状态 | Increment 7 |
| 上游 main 后续变化导致 oracle 漂移 | 只认 v0.19.0 tag commit/hash；当前 main diff 仅作一次性验证 | Increment 7/8 |
| Next/Vite 框架 DOM 导致伪差异 | 结构、行为、视觉分层；只列明确 framework-owned differences，应用区域不 mask | Increment 8 |
| 字体/动画/抗锯齿导致截图不稳定 | 同一 Chromium process、production server、固定 viewport/DPR/locale/color/reduced-motion、等待 fonts；默认 PNG buffer 严格相同，切换像素比较器或放宽必须重新 review | Increment 8 |
| 上游 oracle 本地依赖不可用 | 先只读检查；安装/修改上游环境需单独授权，缺失时 parity 状态为 blocked 而不是伪造通过 | Increment 8 |

### 10.1 Residual Assumptions

| assumption | validation_method |
|---|---|
| 首版包只支持站点根路径 `/` 下的 same-origin route，不提供 basename/basePath | 包内 Router/Link tests 固定该合同；未来宿主接入前核对 Vite base、服务前缀和部署 URL，任一不是根路径则重新设计，不在接入层暗补转换 |
| 正式发布浏览器矩阵尚未确认，但实现依赖 History API、ReadableStream、TextDecoder、AbortSignal、useSyncExternalStore | 本地先在显式 Chromium executable 上完成 browser suite；发布前由独立发布计划确认浏览器矩阵并逐项运行 consumer E2E，未覆盖环境不得宣称支持 |
| 设计文档在本分支外保持 SHA-256 不变 | 每次开始实施/复核前重新计算 SHA；不一致则停止并重新运行 design-review-loop |
| 当前机器可提供 Playwright Chromium，但新 worktree 默认没有 browser artifact | 执行 browser/root E2E 前检查显式 executable 和根配置路径；缺失则停止并请求复用现有本地 artifact 或安装授权，不自动下载、不跳过 |
| 上游 v0.19.0 是否能在临时 clone 内使用本机 pnpm store 完成 frozen install/build/start 尚未动态验证 | Increment 8 先建立 detached 临时 clone 并尝试无网络复用；缺包时停止请求网络/安装授权，不修改原 checkout，也不把 candidate-only E2E 当作 parity |
| `@json-render/shadcn@0.19.0` npm 包内 Tailwind source glob 的实际发布布局尚未验证 | Increment 7 安装获授权后检查 package `exports/files` 与产物；只做路径机械适配，若 npm 产物缺失必要组件源码则停止并回到依赖/打包设计，不从上游 checkout 建隐式绝对路径 |

## 11. Traceability matrix

| 需求/决策 | 增量 | 验收 |
|---|---|---|
| D1 精确字段合同 | 1 | PKG-AC-01、02、09 |
| D2 公开功能接线 | 4、5 | PKG-AC-10、13—18 |
| D3 loader 客户端语义 | 4 | PKG-AC-11—15 |
| D4 prefetch no-op | 5 | PKG-AC-16 |
| D5 严格 Patch | 3 | PKG-AC-05—08 |
| D6 workspace-first | 0、6 | PKG-AC-21、22、24 |
| Browser History + private Router | 2、5 | PKG-AC-03、04、16 |
| 无 UISpec | 全增量 allowlist + 6 | PKG-AC-23 |
| 无服务端/第三方 Router | 0、6 | PKG-AC-21、22 |
| 安全/limits/脱敏/dispose | 3—5 | PKG-AC-06、19、20 |
| 完整 example 全文件搬迁 | 7 | EX-AC-01、EX-AC-02、EX-AC-03、EX-AC-04、EX-AC-07、EX-AC-12 |
| CSR Store 同源刷新/新标签同步 | 7 | EX-AC-05 |
| `/builder` host 与网站 Browser Router 分工 | 7 | EX-AC-04、EX-AC-06、EX-AC-07 |
| example dependency isolation | 7、8 | EX-AC-08、EX-AC-09、EX-AC-12；PKG-AC-21、PKG-AC-22 |
| 上游 oracle 结构化/行为对比 | 8 | EX-AC-02、EX-AC-03、EX-AC-10 |
| 上游 oracle 视觉对比 | 8 | EX-AC-11 |

## 12. 计划完成后的下一步

本轮 `plan-review-loop` 结果为 `clean_with_assumptions`：没有未解决的 blocking、warning 或 low-risk issue；第 10.1 节保留六项环境/发布假设，每项都有具体验证方法。复核已纠正上游文件总数、只读 oracle 执行方式、视觉比较机制和 example 独立许可覆盖。

下一步只有在用户明确授权开始编码和依赖变更后，才进入 Increment 0。实施开始时先重新执行 GATE-00 动态检查（设计 SHA、runtime/example provenance、workspace diff allowlist 和依赖边界）；不得从本计划自动继续实施，不得顺带接入当前应用，也不得自动安装/修改原上游 checkout。

## 13. Increment 9：再次审核问题修复

来源：2026-08-13 `code-review-loop` 再次审核结论 `issues_found`，用户已明确要求“修复”。本增量只修复已确认的 7 个 blocking、3 个 warning 和 2 个 low-risk，不改变 D1—D6、包名、依赖、client-only 边界或 Example 范围；不接入当前 UISpec 项目，不 commit/push/publish，不调用外部服务。

### 13.1 验收标准

- R-AC-01：Catalog 校验接受 `@json-render/core@0.19.0` 的全部公开 prop/action expression 与结构化 JSON literal，同时仍拒绝未知组件、动作和可静态判定的非法 literal。
- R-AC-02：旧 current loader 的成功或失败结果不得覆盖正在展示的 renderable candidate；current/candidate 缓存和 stale 语义保持分离。
- R-AC-03：metadata 始终来自同一 presentation source 的 spec 与 route；无 current 的 candidate 也可应用 metadata。
- R-AC-04：所有公开 snapshot、loader data 和 RuntimeError 均由 runtime 深度拥有并冻结，宿主引用不能改变既有 revision。
- R-AC-05：Link、navigate action 和 Example anchor 共用危险协议拒绝规则；relative/hash/http/https 及既有安全原生外链行为保持不变。
- R-AC-06：Builder 对 parse error、storage error 和 contract-invalid candidate 给出明确诊断，保留最后有效 preview，不 silent repair，并允许 candidate 继续编辑和持久化。
- R-AC-07：provenance 的 `unchanged` 必须与目标文件字节哈希一致；修改后的 registry 标为 `ported`。
- R-AC-08：Prompt 恢复官方 0.19.0 的 JSONL 示例、Patch 顺序和 built-in action 参数说明，且保持 client-only 文案。
- R-AC-09：Example 根 composition 订阅 History/runtime navigation，`/builder` 与网站视图可双向切换。
- R-AC-10：同文档多 runtime 的 head/action observer 所有权隔离，dispose 不移除其他实例资源。
- R-AC-11：storage 访问异常被合同化；maxDepth 在递归 Zod 解析前以非递归方式失败关闭。

### 13.2 并行与任务卡

[parallelism:
- independent lanes: T09-A Contract/Prompt；T09-B Runtime/metadata/ownership；T09-C Navigation/Example
- sequential blockers: 三 lane 先添加直接复现测试；主 Agent 合并后完成 depth-limit、跨 lane 校验和全门禁
- shared write surfaces: `src/index.ts`、root manifests/lock、计划文件、最终验证由主 Agent 单一所有
- delegation: 3 个 write-capable Agent，禁止越过各自 owns
]

#### T09-A：Contract 与 Prompt

- owns：`src/contract/zod-schema.ts`、`src/validation/catalog-gate.ts`、`src/contract/schema.ts` 及对应 contract tests。
- actions：用 0.19.0 公开表达式合同修复 catalog-aware validation；补齐 Prompt；先写失败测试再修复。
- must-not-touch：runtime、React、navigation、Example、public exports、依赖。
- verify：contract/schema focused Vitest；覆盖所有 expression family、nested literal、非法 literal、Prompt action shapes。
- stop：若必须改公开 NextAppSpec 字段或依赖，停止交回主 Agent。

#### T09-B：Runtime、Metadata 与实例所有权

- owns：`src/runtime/create-runtime.ts`、`src/contract/types.ts`、`src/react/app-renderer.tsx`、`src/metadata/head-controller.ts` 及对应 runtime/browser tests。
- actions：修复 loader/candidate race、presentation metadata source、深度所有权、head/action observer 实例隔离。
- must-not-touch：contract schema/Prompt、navigation、Example、public exports、依赖。
- verify：deferred-loader、base-empty candidate metadata、nested mutation、双 runtime/dispose focused tests。
- stop：若需要改变公开 Runtime API/事件 shape，停止交回主 Agent。

#### T09-C：Navigation 安全与完整 Example

- owns：`src/navigation/**`、`src/react/link.tsx`、Example `main.tsx`、Spec Store、Editor、website anchor、provenance manifest 及对应 tests。
- actions：统一危险协议拒绝；修复根 composition；分离 candidate 与 last-valid preview；修复 provenance 与测试。
- must-not-touch：contract/runtime/metadata、public exports、依赖、root manifests。
- verify：危险协议 Chromium tests、invalid persisted candidate Builder tests、History `/builder` 切换、provenance hash test。
- stop：若需要新增依赖或扩大允许协议策略，停止交回主 Agent。

### 13.3 主 Agent 集成、风险与回滚

- 主 Agent owns `src/validation/limits.ts`、必要的 pre-Zod 调用点和最终冲突处理；使用迭代 depth walk，保持 `source_limit_exceeded` 错误码。
- 每条 lane 的最小复现先通过，再运行 package unit/browser、Example unit/browser/build、consumer/dependency、root typecheck/unit/integration/E2E/build。
- 回滚以 lane 为单位；任何修复若要求新增 NextAppSpec 字段、公开 API、第三方 Router、服务端能力或依赖，则停止，不以兼容别名或 silent fallback 绕过。
- 现有 `@json-render/next` parity 只覆盖默认路径；本增量新增异常、安全、并发和所有权探针，不能用旧像素记录替代。

### 13.4 覆盖

- R-AC-01、08 → T09-A
- R-AC-02、03、04、10 → T09-B
- R-AC-05、06、07、09、storage 部分 R-AC-11 → T09-C
- depth 部分 R-AC-11、跨 lane 回归 → 主 Agent

### 13.5 修复结果与最终证据

状态：2026-08-13 的再次审核问题已全部修复；最后一轮补充审查发现的 commit/navigation snapshot 非原子、candidate 期间 `retryLoader()` 切回 current、source/loader terminal event 重入乱序、invalid source error 所有权和旧 route loader failure 误归属等 blocking，也已逐项先建立失败复现再修复。未改变 NextAppSpec 0.19.0、五个公开入口、包名、依赖、client-only 边界或 Example 范围。

主要结果：

- Catalog 的表达式、结构化 action 参数、链式 action 名与静态 literal/refine 校验对齐 0.19.0；Prompt 恢复官方 JSONL、Patch 顺序与 built-in 参数说明。
- runtime 的 current/candidate、loader settle/retry、metadata、head ownership 与 action observer 均按实例和 presentation source 隔离；spec/location 与 route presentation 原子发布，source/loader terminal event 在 subscriber 重入前绑定对应 snapshot/revision，invalid source 与 route error 采用显式所有权和优先级。
- snapshot、loader data 与 RuntimeError 深度拥有 ownership-safe structured data；危险 URL、source limits、storage 访问、超深 candidate 与 Catalog 异常均失败关闭。
- Builder 保留 editable candidate 与 last-valid preview，完整走 runtime limits/catalog/reference gate；History 入口切换、跨标签同步和 provenance 校验已修复。

最终本地门禁：

- `@next-app-runtime/client`：11 files / 114 unit tests；typecheck；build；11/11 Chromium；consumer 2/2；dependency boundary 3/3。
- 完整 Example：2 files / 14 unit tests；typecheck；production build；5/5 Chromium。
- 根项目回归：typecheck；65 files / 379 unit tests；22 files / 87 integration tests；Vite production build；6/6 E2E。
- manifests JSON parse、workspace dependency tree、tracked/untracked whitespace、调试语句/未完成标记、敏感信息模式和 `git diff --check` 均通过；无 staged 文件，无 commit/push/publish。
- Zod expression adapter 已动态验证当前 4.4.3 与上游本地 4.3.6。更广的 `zod ^4.0.0` peer 范围未逐版本验证，发布前仍需兼容矩阵。

本轮修复后未重新启动上游 Oracle；最近一次 Oracle 记录仍是 2026-08-12，在 `/`、`/about`、`/contact`、`/builder` 与 edited Builder checkpoint 上为零 RGB 像素差。该历史记录不能替代本轮 candidate 门禁，故本轮结论只使用上面的 unit/build/browser/E2E 证据。

与官方有意不一致且必须保留披露：服务端 API/RSC/SSR 不实现；loader snapshot 改为深 ownership，无法安全拥有的值 fail-closed；core 0.19.0 无 runtime identity 的 unscoped/watch/chained action lifecycle 不上报但动作照常执行；malformed JSON 原文保留在 storage，但 Visual JSON AST editor 只能继续编辑可解析 candidate；Next SSG 与浏览器 localStorage 的读取点/共享范围不同。完整边界见 Example 的 `comparison/allowed-differences.md`。
