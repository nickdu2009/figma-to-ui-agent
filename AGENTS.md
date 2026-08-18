# vite-multipage-agent

本仓库的顶层产品是本地多页面应用生成平台：Vite + React 前端、Hono/Mastra
服务端、CopilotKit/AG-UI 协议，以及 `@next-app-runtime/client` 运行时。

## 边界

- 当前不实现 Figma 输入适配；历史 Figma-to-UI Agent 位于
  `legacy/figma-to-ui-agent/`，不参与顶层应用的构建、测试或运行。
- 应用的唯一真相是服务端持久化状态和
  `runtime.getSnapshot().current`；聊天状态、SSE、日志与 Mock 都不是业务真相。
- 浏览器不读取或存储 API Key。真实模型凭据只从服务端进程环境读取。
- MySQL 8.4（Docker Compose）是本地运行与集成测试前置；不可用时服务必须失败关闭。
- Mock 测试不得调用真实 LLM；真实 LLM 验证须获得单独授权。

## 常用命令

```bash
npm run db:up
npm run typecheck
npm run test
npm run build
npm run test:browser:mock
```

`packages/next-app-runtime` 是本地 workspace 包。不要将 `legacy/` 加入 npm
workspace，也不要把其依赖、数据或环境文件混入顶层应用。

## Worktrail

仅当仓库根目录存在 `.worktrail/` 时启用 Worktrail。正式知识变更使用候选与审阅
流程；不得直接编辑正式 `.worktrail` 知识文件。
