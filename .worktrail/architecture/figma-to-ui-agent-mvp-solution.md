---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "architecture-figma-to-ui-agent-mvp-solution",
  "scope": "project",
  "type": "architecture",
  "title": "Figma-to-UI Agent MVP 技术方案",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent MVP 技术方案

## 1. 目标

构建一个可恢复、可审计、可盲测的本地 Figma-to-UI Agent：用户提供 Figma Design URL 和可选行为说明，Pi Coding Agent 通过恰好四个受控工具读取设计、生成多页面 `ui-spec.json`、在浏览器预览，并用 Playwright 进行功能和视觉比较。

MVP 优先证明完整垂直链路，不导出自由 React 源码，不依赖 Figma Desktop、Remote MCP、第三方 MCP、浏览器抓取或第二 Agent Loop。

## 2. 已确定技术栈

- Node.js + TypeScript
- Pi Coding Agent TUI
- OpenAI `gpt-5.4`
- 一个受控 TypeScript Extension
- Figma 官方 REST API，Node 原生 `fetch`
- Zod 负责运行时契约校验
- json-render 负责声明式 `ui-spec.json`
- React + Vite 提供 localhost Preview
- Playwright 提供交互、键盘、截图和视觉 Diff
- 本地 JSON、内容寻址资产和不可变修订历史

Figma 集成不增加第三方运行时依赖。

## 3. 系统组件

### 3.1 Controlled Launcher

- 固定 Pi provider、模型、Extension 和模型工具面。
- 关闭内置工具以及 Extension、Skill、Prompt、Context 自动发现。
- 拒绝缺少模型配置、工具漂移和非托管启动。
- 注入离线和版本检查关闭配置以及项目内 Playwright 浏览器路径。
- 转发退出信号并等待子进程清理。

### 3.2 TypeScript Extension

只注册：

- `inspect_figma`
- `load_ui_spec`
- `save_ui_spec`
- `render_and_compare`

Extension 在 provider 请求前校验活动工具名称集合恰好相等。托管模式下 `user_bash` 返回结构化拒绝，不调用进程执行 API。

### 3.3 Figma REST Adapter

建议模块：

```text
src/figma/
  url.ts
  client.ts
  schemas.ts
  normalize.ts
  screenshots.ts
  assets.ts
  variables.ts
  adapter.ts
```

分别负责 URL 解析、请求控制、最小响应 Schema、节点标准化、截图、资产、可选 Variables 和总编排。Adapter 不包含 Agent，也不向模型暴露端点级工具。

### 3.4 DesignBundle Store

由 `schema.ts`、`store.ts` 和 `provenance.ts` 负责 Schema 校验、项目路径推导、不可变版本、临时文件、fsync、原子 rename、旧版本保留和来源追踪。

### 3.5 UISpec Project Store

一个项目维护一个多页面 `ui-spec.json`。保存携带 `baseRevision`，依次执行输入校验、引用完整性检查、当前 revision 比较、不可变 history 写入和 current 原子更新。过期 revision、无效 Schema、悬空引用或写入失败不得改变当前有效 spec。

### 3.6 Preview Runtime

提供三栏工作区：Figma 参考、当前实现、Diff/检查结果。支持页面切换、Viewport、缩放、像素级查看和键盘操作。Preview 只读取已校验的项目数据和本地资产引用，不接收凭据和任意文件路径。

### 3.7 Playwright Validator

通过公开 API 执行页面加载、控制台错误、主要交互、键盘可达性、固定环境截图、expected/actual/diff 输出和阈值判定。不得调用私有 screenshot matcher 或篡改测试结果模拟通过。

## 4. 输入与 URL 安全

```ts
type InspectFigmaInput = {
  schemaVersion: "1";
  projectId: string;
  figmaUrl: string;
  targetNodes?: string[];
  viewports?: Array<{ name: string; width: number; height: number }>;
  behaviorNotes?: string[];
};
```

- URL 必须使用 HTTPS。
- 主机必须属于允许的 Figma 主机。
- 路径必须是 Design 文件形式并包含合法文件键。
- `node-id` 规范化为 Figma 节点 ID。
- URL 节点和 `targetNodes` 冲突时失败关闭。
- `projectId` 使用固定字符集和长度限制，不能直接作为任意路径。
- 普通日志只记录文件键哈希和节点数量，不记录原始 URL 查询串。

## 5. REST 读取流程

### 5.1 核心读取

1. 解析并校验输入。
2. 读取目标节点树。
3. 校验 HTTP、Content-Type、响应体大小和最小 Schema。
4. 标准化页面、组件、Styles、文本、布局、图片引用和 `boundVariables`。
5. 根据显式节点或可解释规则选择页面候选，不能写死样本节点。
6. 请求目标截图并验证 HTTPS、下载状态、大小、Content-Type 和图片魔数。
7. 枚举图片填充并下载去重，以内容哈希命名。
8. 核心通过后尝试 Variables。
9. 组装、校验并原子保存 DesignBundle。

节点、截图和图片填充端点全部成功才允许更新当前 DesignBundle。图片填充数量可以为零，但端点必须可读。

### 5.2 Variables 可选读取

```ts
type VariablesCapability =
  | {
      status: "available";
      variableCount: number;
      collectionCount: number;
    }
  | {
      status: "unavailable_optional";
      reasonCode:
        | "plan_limited"
        | "account_type"
        | "invalid_scope"
        | "file_unsupported"
        | "unauthorized"
        | "unknown";
    };
```

不得把 Figma 原始错误正文写入报告。无法从安全字段准确分类时使用 `unknown`，不能猜测。

### 5.3 设计值来源优先级

1. Variables 可用：保留变量名称、集合、模式、别名、值和代码语法，`origin: figma_variable`。
2. Variables 不可用但节点含 `boundVariables`：保留变量 ID 的脱敏稳定映射，结合 Styles 和解析值生成项目设计值，`origin: inferred_from_binding`。
3. 无绑定：按重复视觉值和使用位置推导项目设计值，`origin: inferred`。

推导名称只能表达项目内部用途，例如 `color.surface.1`，不得冒充无法读取的 Figma 语义名称。不同来源不得无痕合并。

## 6. DesignBundle 数据契约

```ts
type DesignBundle = {
  schemaVersion: "1";
  projectId: string;
  revision: number;
  source: {
    provider: "figma_rest";
    fileKeyHash: string;
    targetNodeIds: string[];
    inspectedAt: string;
  };
  capabilities: {
    variables: VariablesCapability;
  };
  pages: NormalizedPage[];
  components: NormalizedComponent[];
  styles: NormalizedStyle[];
  designValues: NormalizedDesignValue[];
  screenshots: LocalImageRef[];
  assets: LocalImageRef[];
  provenance: ProvenanceEntry[];
};
```

`LocalImageRef` 只保存项目内相对路径、SHA-256、字节数、MIME 和尺寸，不保存临时 CDN URL。生产 DesignBundle 保留实现所需的标准化设计数据，探针报告只保留统计和哈希。

## 7. ui-spec.json 契约

MVP UISpec 支持多页面和路由、受控组件 Catalog、布局、文本、图片、交互、设计值引用、Viewport、行为 fixture、稳定组件 ID、Schema 版本和 revision。

Agent 只能输出 Catalog 允许的组件和属性。未知组件、任意 JSX、脚本、外部 URL、任意 CSS 注入和未声明事件处理器必须被 Schema 拒绝。

## 8. 四工具契约

### inspect_figma

输入经过校验的 Figma URL、项目和可选节点；输出 DesignBundle revision、页面摘要、能力状态和警告。只有核心全部通过后原子更新 DesignBundle，失败时保留上一版本。

### load_ui_spec

输入 `projectId` 和可选 revision；返回当前或指定不可变 UISpec，不得读取项目外路径。

### save_ui_spec

输入完整 UISpec、`baseRevision` 和保存说明；返回新 revision 和校验摘要。过期 revision、Schema 错误或悬空引用不改变当前版本。

### render_and_compare

输入项目、页面、Viewport、行为 fixture 和比较配置；返回 Preview URL、功能检查、截图和 Diff 摘要。只访问 localhost Preview 和项目内资产。

## 9. 本地持久化

```text
data/
  pi-sessions/
  projects/<projectId>/
    project.json
    figma/
      current.json
      history/<revision>.json
      assets/<content-hash>.<ext>
      screenshots/<content-hash>.png
    specs/
      current.json
      history/<revision>.json
    runs/<runId>/
      run.json
      validation.json
      screenshots/
      diffs/
```

写入顺序：校验、临时文件、fsync 文件、rename、fsync 目录、更新索引。进程崩溃后忽略未完成临时文件，以最后一个通过校验的 current 为准。

## 10. 网络、凭据和资源限制

- Figma 和 OpenAI 凭据只从进程环境读取。
- 错误清洗必须覆盖当前凭据值。
- Figma API 请求默认 30 秒超时，批量节点按 URL 和响应大小上限分片。
- 并发下载使用固定小上限，默认不超过 4。
- 单响应、单图片和单项目总资产设置硬上限。
- 只允许 HTTPS，拒绝带用户信息的 URL、非公网协议和非法重定向。
- 资产下载完成后不保留远端临时 URL。
- OpenAI 仅能由 Pi provider 调用，不得从其他脚本旁路调用。

## 11. 失败语义

| 场景 | 处理 |
| --- | --- |
| 核心 Figma 401/403/404 | `inspect_figma` 失败，保留旧 DesignBundle |
| Variables 401/403 | `unavailable_optional`，继续核心流程 |
| Figma 429 | 尊重退避响应，有限重试 |
| Figma 5xx/网络超时 | 有限重试，失败后保留旧版本 |
| 响应过大/Schema 不兼容 | 失败关闭，记录脱敏契约错误 |
| 资产格式或哈希失败 | 核心失败，不发布半成品 |
| UISpec revision 冲突 | 拒绝保存，要求重新加载 |
| Preview 启动失败 | 当前 run 失败，不修改 UISpec |
| 视觉 Diff 超阈值 | 保存证据并进入迭代，不伪造通过 |
| 用户取消/进程退出 | 取消请求并清理子进程、浏览器和临时文件 |

## 12. M0-M3

### M0 能力冻结

完成 Pi/OpenAI、四工具边界、Figma REST 核心、Variables 降级、Playwright 和可复现版本探针。任一硬门失败停止后续阶段。

### M1 持久化垂直切片

实现 URL 解析、REST Client、DesignBundle、UISpec Store 和最小三栏 Preview。使用 fixture 和 mock REST 完成离线失败路径验证。

### M2 Agent 闭环

实现四工具真实契约，让 Agent 能 inspect、load、save、render/compare 迭代，完成 Flow test 功能与视觉校准。

### M3 冻结与盲测

冻结模型、依赖、浏览器、字体、Viewport、DPR、Diff 阈值和 Prompt。对三个此前未用于开发的 Figma 输入执行盲测，记录成功率、人工干预、视觉差异和已知限制。

## 13. 测试策略

### 单元测试

- Figma URL 和节点 ID 解析
- 路径隔离和 `projectId` 校验
- 重试、超时、大小上限和错误清洗
- Variables capability 分类
- 设计值来源和不可伪造规则
- DesignBundle/UISpec Schema
- revision CAS 和原子写入恢复

### 集成测试

- mock REST 核心成功且 Variables 403 仍成功
- 核心 403、429、5xx、超时失败关闭
- 截图和资产 HTTPS、重定向、格式、大小和哈希
- DesignBundle 失败不覆盖旧版本
- 四工具注册和 provider payload 恰好四个
- Preview 路由、状态、资产和行为 fixture

### E2E

- Flow test 完整 Agent 闭环
- 多页面、桌面和移动 Viewport
- 键盘可达性
- expected/actual/diff 完整产物
- 三次未知 Figma 盲测

## 14. 可观测性与报告

每个 run 记录 run ID、项目、revision、时间、依赖版本、模型和 Prompt 版本、Figma 端点类别、状态码、耗时、重试、字节数、Variables capability、设计统计、工具顺序和 Playwright 结果。

不记录凭据、原始文件键、完整私有设计正文、远端资产 URL、用户浏览器身份数据或认证头。

## 15. 方案复核结论

该方案在已确认的纯 REST 边界内可实施。Variables 可选不会阻止核心页面生成，但会降低变量语义、模式和别名还原能力；方案通过来源标记和盲测显式管理该损失。无需引入 MCP fallback，因为它会扩大认证、工具发现和运行时复杂度，并破坏单一通道的可审计性。

## 16. 残余假设

- REST 节点数据对复杂 Auto Layout、组件覆盖和原型行为的表达足以支持 MVP；通过 Flow test 和三次盲测验证。
- `gpt-5.4` 在当前 Pi 包中的图像和工具回合兼容性尚需获授权 live probe 证明。
- 视觉 Diff 阈值、字体基线和运行时 Viewport 需在 M0/M2 校准后冻结，不能预设结果。
