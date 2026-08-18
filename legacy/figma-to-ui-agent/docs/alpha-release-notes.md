# Alpha Release Notes

## 发布范围

Alpha 发布范围是本地可运行的 Figma-to-UI Agent MVP：

- 官方 Figma REST 读取。
- DesignBundle、UISpec、FlowPlan artifact 生成。
- 本地 Preview 渲染和 Playwright 验证。
- Product-M9 agent-facing CLI。
- Alpha readiness 和本地门禁报告。

不包含云部署、真实后端、多租户、自动 PR/发布、第二 Agent Loop、Figma Desktop MCP 或 OpenAI 生成链路扩展。

## 发布身份

发布时使用包含 Alpha 文档、readiness 脚本和报告的最终 commit hash 或 tag 作为 Alpha 身份。

推荐记录：

```bash
git rev-parse HEAD
git status --short --branch
```

## 回滚

回滚到上一可用版本：

```bash
git switch main
git pull --ff-only
git revert <alpha-commit>
```

如果使用 tag 发布：

```bash
git switch main
git pull --ff-only
git reset --hard <previous-alpha-tag>
```

第二条命令会重写本地工作区，只能在明确确认没有未保存工作时使用。

## 已知限制

- 未知 Figma 文件可能返回 `partial`，尤其是 prototype target 缺失、unsupported action、submit-like 语义需要用户确认时。
- Alpha 不追求未知文件 100% 通过，不允许把 partial 或 failed 当作 passed。
- 视觉保真仍以已有 Generator Fidelity / Preview 能力为基础，不引入整页截图 fallback。
- Product-M9 restricted-live 不调用 OpenAI；OpenAI 相关配置只保留给 Pi Agent 入口和已授权探针。
