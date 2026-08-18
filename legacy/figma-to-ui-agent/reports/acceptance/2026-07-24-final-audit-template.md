# Figma-to-UI Agent MVP 最终审计模板

## 使用时机

本模板只能在以下条件全部满足后填写最终结论：

- AC8 已冻结；
- AC9 三个未知输入盲测均在同一 baseline 下完成；
- `data/blind/m3/final-summary.json` 已由 `finalize:m3` 生成；
- 没有修改 frozen source、Prompt、Catalog、Schema、工具、模型、浏览器、viewport 或
  视觉阈值；
- 完成本地可复现命令、权限扫描和泄漏扫描。

当前不能把本模板当作完成报告。它只是 AC10 的待填审计骨架。

## 最终结论

- 审计日期：待填；
- 结论：待填，允许值为 `productization_ready` / `not_ready`；
- baselineId：`7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`；
- AC1-AC10：待填；
- 是否执行 Git：否，除非用户另行明确授权；
- 是否调用外部服务：待填，只能列出已授权的 Figma/OpenAI 盲测调用。

## 实现范围审计

| 项 | 要求 | 证据 | 结论 |
| --- | --- | --- | --- |
| Pi Agent Loop | 使用单一 Pi Coding Agent TUI 和 `gpt-5.4` | `data/baselines/m3/freeze.json` | 待填 |
| 工具面 | 模型可见工具恰好 4 个 | M0/M2/M3 审计与工具事件 | 待填 |
| DesignBundle | Schema 校验、Figma REST 来源、Variables 可选增强 | M1/M3 证据 | 待填 |
| UISpec | 多页面 json-render 规格、严格 Schema | M1/M2/M3 证据 | 待填 |
| Project Store | 本地 JSON、不可变 history、CAS、路径隔离 | M1 测试 | 待填 |
| Preview | React 三栏、页面/状态/viewport/缩放/错误状态 | M2/E2E | 待填 |
| Validator | Playwright 功能、键盘、console、截图和 exact RGBA diff | M2/M3 validation | 待填 |
| Flow 校准 | `m3-flow-20260723-h` 1 轮通过并冻结 | freeze report | 待填 |
| 盲测 | 三个未知输入同 baseline 通过 | `data/blind/m3/final-summary.json` | 待填 |
| 审计安全 | 脱敏、权限、无真实 URL/Token 泄漏 | 扫描命令输出 | 待填 |

## AC1-AC10 逐项结论

| AC | 状态 | 证据 | 残余风险 |
| --- | --- | --- | --- |
| AC1 运行时唯一性 | 待填 | 待填 | 待填 |
| AC2 四工具边界 | 待填 | 待填 | 待填 |
| AC3 Figma REST 能力 | 待填 | 待填 | 待填 |
| AC4 领域契约 | 待填 | 待填 | 待填 |
| AC5 持久化安全 | 待填 | 待填 | 待填 |
| AC6 Preview 完整性 | 待填 | 待填 | 待填 |
| AC7 验证器可重复 | 待填 | 待填 | 待填 |
| AC8 Flow 校准 | 待填 | 待填 | 待填 |
| AC9 未知输入盲测 | 待填 | 待填 | 待填 |
| AC10 审计与交付 | 待填 | 待填 | 待填 |

## 必跑验证命令

以下命令不得省略；如因冻结后 source hash 漂移导致失败，应停止并报告：

```bash
npm ci --ignore-scripts --audit=false --fund=false
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm exec -- vite build --config vite.config.ts
node --input-type=module -e 'import {loadAndVerifyFreeze, verifyFrozenRuntime} from "./scripts/m3-freeze-lib.mjs"; const {freeze}=await loadAndVerifyFreeze(process.cwd()); await verifyFrozenRuntime(process.cwd(), freeze); console.log(JSON.stringify({status:freeze.status,baselineId:freeze.baselineId,sourceHashCount:Object.keys(freeze.sourceHashes).length,viewportCount:freeze.controlledSurface.fixedViewports.length}, null, 2));'
export M3_CASE_IDS=case-a,case-b,case-c
npm run finalize:m3
```

`npm run probe:m3:local` 是冻结前门禁脚本；当前 freeze 已存在，不能把它作为最终 AC10
必跑项，也不能为修它而改 frozen source。

## 安全扫描

最终报告前必须执行：

```bash
rg -n 'figd_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|https://www\.figma\.com/(file|design)/[A-Za-z0-9_-]{12,}|https://figma\.com/(file|design)/[A-Za-z0-9_-]{12,}' \
  data/baselines/m3 reports README.md .env.example

find data/baselines/m3 data/calibration/m3/m3-flow-20260723-h data/projects/m3-flow-20260723-h data/blind/m3 -type f -perm +077 -print
```

要求：

- secret/URL 扫描无命中；
- 被忽略的 M3 证据文件不对 group/other 放开；
- 报告中只出现哈希、case id、相对证据路径和脱敏状态。

## 最终交付摘要模板

最终回复应包含：

- 实现了什么；
- 关键文件；
- 锁定版本；
- AC1-AC10 结果；
- Flow freeze baseline；
- 三个盲测 case 的脱敏结论；
- 本地验证命令和结果；
- 运行方式；
- 限制与残余风险；
- 未执行事项；
- 明确说明没有 Git/远程/部署操作，除非用户另行授权。

## 当前待填项

截至 2026-07-24：

- AC8 已冻结；
- AC9 尚未执行；
- `data/blind/m3/final-summary.json` 不存在；
- 本模板不能作为最终完成报告。
