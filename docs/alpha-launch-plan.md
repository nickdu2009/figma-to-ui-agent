# Alpha Launch Plan

本文档定义 Alpha 可上线收口标准。Alpha 目标不是保证所有未知 Figma 文件 100% 成功，而是把未知真实 Figma 到可交互 UI / FlowPlan / Preview / Playwright validation 的闭环固定成可运行、可解释、可审计的交付形态。

## 验收口径

- `passed`：有真实 Figma REST 或用户确认来源的证据进入 DesignBundle、UISpec、FlowPlan、Preview/Playwright 验证和报告；失败/partial 没有被伪装为成功。
- `partial`：链路可运行，但样本存在 unsupported action、missing target、needs confirmation、权限/限流、或证据不足；报告必须给出原因和下一步。
- `failed`：输入、配置、运行时、Schema、Preview、验证或报告任一关键环节不可恢复失败；不得发布为 Alpha。

## Alpha 上线清单

1. 定义 Alpha passed / partial / failed 口径。
2. 固定 4-5 个以上 Community 样本矩阵，覆盖多页面导航、CHANGE_TO、submit-like、visual node action、target backfill、missing/partial。
3. 目标级完成审计覆盖 Figma REST、DesignBundle、UISpec、FlowPlan、Preview、Playwright、confirmation、报告、失败口径、Git、Worktrail。
4. 提供稳定入口：`npm run alpha:readiness`、`npm run alpha:gates`、`node scripts/run-product-m9-flow.mjs`。
5. 配置与密钥只从环境读取；报告和文档脱敏。
6. 错误诊断区分 rate limit、权限、文件不可访问、node 不存在、unsupported action、missing target、needs confirmation。
7. 回归矩阵固定包含 Trego、Cake、Nexkart、电商/Booking、Design system/component variant。
8. 每次 run 输出 `summary.json` 和 `summary.md`。
9. Preview 可启动、可查看、可交互，基本导航、状态切换、表单可验证。
10. 发布前跑 typecheck、unit、integration、e2e、Alpha readiness、secret scan、脱敏检查。
11. 发布时记录最终 commit hash 或 tag，并保留回滚方法。
12. 使用说明、验收报告、限制、故障排查、样本矩阵说明已落文档。

## 执行顺序

1. 运行 `npm run alpha:readiness`，确认文档、样本和既有证据齐全。
2. 运行 `npm run alpha:gates`，执行本地测试门禁并生成 Alpha readiness 报告。
3. 检查 `reports/alpha/<runId>/summary.md` 和 `summary.json`。
4. 执行脱敏扫描，确认没有 token、真实 Figma URL、file key 或原始 REST payload。
5. 提交并推送，记录最终 commit hash。

## 不变边界

- Product-M9 restricted-live 只调用 Figma REST，不调用 OpenAI。
- Preview 和 Playwright 验证在本地执行。
- `partial` 是可解释状态，不是失败伪装成功。
- 不引入整页截图 fallback，不缩小未知真实 Figma 到可交互 UI/FlowPlan/验证闭环范围。
