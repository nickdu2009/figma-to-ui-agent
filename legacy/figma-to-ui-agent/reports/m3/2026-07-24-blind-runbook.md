# M3 未知输入盲测运行手册

## 当前状态

M3 Flow 校准已冻结。冻结基线：

- baselineId：`7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`；
- 固定 viewport：`landingpage`，`440x996`，DPR `1`；
- 视觉阈值：`maxDiffPixelRatio=0.05`、`maxDiffPixels=50000`、`timeoutMs=30000`；
- 模型：`gpt-5.4`；
- Pi：`0.81.1`；
- Chromium：`149.0.7827.55`；
- 受控源码哈希：37 个。

盲测尚未执行。AC9 只有在三个开发阶段未使用的 Figma 输入都在同一冻结基线下通过后
才算完成。

## 冻结后禁止事项

盲测开始后到 `finalize:m3` 完成前，不得修改以下内容：

- `package.json`、`package-lock.json`；
- `src/`、`scripts/`、`preview/src/`、`tests/` 和 `playwright.e2e.config.ts` 中已被
  freeze manifest 纳入的 37 个受控文件；
- Prompt、Catalog、Schema、工具名称或工具数量；
- 模型、Pi 版本、Chromium 二进制、viewport、DPR、Diff 算法或视觉阈值；
- 任何盲测 case 的 `source-manifest.json` 或 `result.json`。

`README.md`、`reports/` 和 `.env.example` 不在当前 freeze source hash 中，可以继续
用于记录审计事实，但不能用文档变更替代盲测证据。

## 三个未知输入要求

每个 case 必须满足：

- Figma 文件没有在开发、校准、排错或 h freeze 中使用过；
- URL 可以由当前 `FIGMA_API_KEY` 读取；
- URL 中带目标 node，或同时提供 `M3_TARGET_NODES`；
- 每个 case 使用不同 `M3_CASE_ID`，并且三个 case 来自三个不同 Figma 文件；
- 行为只来自 Figma 可见结构或显式 `M3_BEHAVIOR_NOTES`，不得靠模型猜测；
- 目标适合当前冻结 viewport `440x996`，否则视觉比较会失败；
- 如果没有交互，`M3_BEHAVIOR_NOTES` 应明确写“无交互，仅验证页面呈现”。

三个 case 合计还必须覆盖最终矩阵：

- 至少一个多页面输入；
- 至少一个组件输入；
- 至少一个图片资产输入；
- 至少一个复杂 Auto Layout 输入；
- 至少一个 Variables 不可用且没有绑定引用的输入；
- 至少一个 Variables 不可用但存在绑定引用回退的输入；
- Variables 全量能力若不可用，则由冻结清单中的 non-live fixture 覆盖全量 Variables
  契约。

如果三个真实输入无法覆盖上述矩阵，`finalize:m3` 会返回
`m3_blind_coverage_incomplete:<items>`，此时不能现场补 Catalog 或改源码，只能记录失败
结论，并决定停止或回到 M2 重新校准。

## Case 输入模板

不要把真实 URL、节点、Token 或私有响应写入报告或 Worktrail。以下模板只应在本机
shell 中使用：

```bash
export M3_CASE_ID=case-a
export M3_FIGMA_URL='<unknown-figma-design-url>'
export M3_TARGET_NODES='<node-id-1>[,<node-id-2>]'
export M3_BEHAVIOR_NOTES='无交互，仅验证页面呈现'
export M3_UNKNOWN_INPUT_CONFIRMED=1
npm run manifest:m3
```

`manifest:m3` 不访问网络，只读取冻结清单并写入
`data/blind/m3/<case-id>/source-manifest.json`。该文件只保存 Figma 文件、URL、目标节点
和行为说明的哈希，权限应为 `0600`。如果输入来自开发阶段，命令会返回
`m3_input_was_used_for_development`。

## 盲测执行模板

每个 case 的 `manifest:m3` 成功后，确认本轮会调用 Figma 和 OpenAI，再执行：

```bash
export M3_EXTERNAL_AUTHORIZED=1
npm run blind:m3
```

`blind:m3` 会在执行前校验：

- freeze manifest 存在且状态为 `frozen`；
- 当前 Node、npm、`package-lock.json` 和 Chromium 二进制与 freeze 一致；
- 当前受控源码哈希与 freeze 一致；
- `PI_OPENAI_MODEL` 或 `OPENAI_MODEL` 等于 `gpt-5.4`；
- `FIGMA_API_KEY` 和 `OPENAI_API_KEY` 存在；
- `source-manifest.json` 与当前输入哈希一致；
- `data/projects/blind-<case-id>` 不存在，保证从空项目开始。

输出：

- `data/blind/m3/<case-id>/pi-output.redacted.log`；
- `data/blind/m3/<case-id>/tool-events.redacted.jsonl`；
- `data/blind/m3/<case-id>/result.json`；
- `data/projects/blind-<case-id>/...` 下的 DesignBundle、UISpec、history、run 和截图证据。

通过条件：

- Agent exit code 为 `0`；
- validation 迭代数为 1 到 3；
- `sourceMatched=true`；
- 最新 validation `passed=true`；
- projectId 严格等于 `blind-<case-id>`；
- 视觉 diff 不超过冻结阈值。

失败时保留脱敏证据，不修改源码、不重跑同一个 case 目录、不覆盖已有结果。

## 最终汇总

三个 case 均通过后执行：

```bash
export M3_CASE_IDS=case-a,case-b,case-c
npm run finalize:m3
```

`finalize:m3` 只在以下条件全部满足时写入
`data/blind/m3/final-summary.json`：

- 三个 case id 合法且互不重复；
- 三个 case 都属于同一 baselineId；
- 三个 source manifest 与 result 哈希互相匹配；
- 三个 case 均通过且 Agent exit code 为 `0`；
- 三个 case 来自三个不同 Figma 文件；
- 合计覆盖 Variables、页面、组件、图片、复杂 Auto Layout 和冻结 viewport 矩阵。

成功后 AC9 可标记为已证明，随后才能执行 AC10 最终完成审计。

盲测执行过程中的脱敏状态、路径和覆盖结果记录到
`reports/m3/2026-07-24-blind-evidence-ledger.md`。该台账只记录哈希和相对证据路径，
不得记录真实 Figma URL、节点明文或凭据。

## 当前失败关闭证据

冻结后已在无真实输入或授权时直接验证：

- `manifest:m3` 缺 case 输入返回 `m3_case_id_invalid`；
- `blind:m3` 缺外部授权返回 `m3_external_execution_not_authorized`；
- `finalize:m3` 缺三个 case 返回 `m3_finalization_requires_three_cases`。

`probe:m3:local` 是冻结前门禁脚本，且已被纳入当前 freeze source hash。冻结后不修改该
脚本；如果需要修正它的 post-freeze 断言，必须先明确决定丢弃当前 freeze 并重新
freeze。

## 下一步输入清单

继续 AC9 需要三组未知输入，每组只在本机环境变量中配置：

| 字段 | 要求 |
| --- | --- |
| `M3_CASE_ID` | 例如 `case-a`、`case-b`、`case-c`；小写字母/数字开头，最多 48 字符。 |
| `M3_FIGMA_URL` | 未用于开发的 Figma design URL；不要写入报告。 |
| `M3_TARGET_NODES` | 目标 node id；URL 已带 node 时也建议显式提供。 |
| `M3_BEHAVIOR_NOTES` | 最小行为说明；无交互时写“无交互，仅验证页面呈现”。 |
| `M3_UNKNOWN_INPUT_CONFIRMED` | `1`，表示该输入未用于开发、校准或排错。 |
| `M3_EXTERNAL_AUTHORIZED` | 只在执行 `blind:m3` 前设置为 `1`。 |

## 本机已选输入

2026-07-24 已在本机 `.envrc` 写入三组候选变量：

- `M3_CASE_A_*`：登录/注册移动端，目标节点 `3:5123`；
- `M3_CASE_B_*`：电商结账页，目标节点 `728:1889`；
- `M3_CASE_C_*`：移动 Dashboard 长页面，目标节点 `169:3352`。

当前活动变量默认指向 `case-a`：

```bash
export M3_CASE_ID="$M3_CASE_A_ID"
export M3_FIGMA_URL="$M3_CASE_A_FIGMA_URL"
export M3_TARGET_NODES="$M3_CASE_A_TARGET_NODES"
export M3_BEHAVIOR_NOTES="$M3_CASE_A_BEHAVIOR_NOTES"
```

切换到 `case-b` 或 `case-c` 时，只改这四个活动变量指向对应 `M3_CASE_B_*` 或
`M3_CASE_C_*`。三组真实 URL 明文只允许保存在本机配置和本地输入请求包；证据台账、
最终审计和 Worktrail 仍只记录哈希。
