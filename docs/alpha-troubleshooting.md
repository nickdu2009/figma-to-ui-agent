# Alpha 故障排查

## 常见错误分类

| 分类 | 含义 | 下一步 |
| --- | --- | --- |
| `auth_missing` | 缺少 Figma gate 或 `FIGMA_API_KEY` | 配置环境变量，并显式设置授权 gate 后重跑 |
| `figma_rate_limited` | Figma REST 返回限流 | 等待 Retry-After，降低请求频率后重跑 |
| `figma_permission_denied` | token 无文件权限 | 检查 Figma 文件访问权限或换有权限的 token |
| `figma_not_found` | file key 或 node id 不存在 | 检查输入 URL、node id 和文件可访问性 |
| `unsupported_figma_action` | Figma prototype action 当前无法安全表达 | 记录 unsupported，不猜测业务逻辑 |
| `needs_confirmation` | submit-like 或业务语义缺少可信证据 | 向用户展示 confirmation questions，确认后用 answers 重跑 |
| `partial_evidence` | 有部分 FlowPlan 可执行，但证据不完整 | 保留 partial，补样本、补 target 或人工复核 |
| `flow_execution_failed` | Playwright 或 behavior fixture 验证失败 | 查看 validation artifact，修 UISpec/FlowPlan/fixture 后重跑 |

## 恢复原则

- 任何凭据、真实 Figma URL、file key、node id 不进入提交、报告正文或 Worktrail 正式知识。
- `partial` 不自动升级为 `passed`。
- `needs_confirmation` 必须来自用户确认或显式结构化答案，不从按钮文案自动编造业务结果。
- `unsupported_figma_action` 保留诊断，不用 CSS、截图或推断逻辑强行通过。

## 快速定位

```bash
jq '{status, metrics, error, nextAction, artifactRefs}' reports/product-m9/<runId>/summary.json
```

若 Alpha readiness 失败：

```bash
jq '.checklist[] | select(.status != "passed")' reports/alpha/<runId>/summary.json
```
