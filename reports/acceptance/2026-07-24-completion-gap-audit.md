# Figma-to-UI Agent MVP 完成度缺口审计

> 状态更新：本审计记录的是 2026-07-24 早前的未完成状态，已被
> `reports/m3/2026-07-24-productization-ready.md` 和
> `data/blind/m3/final-summary.json` 取代。当前 active baseline
> `1d45b3359769ddd39d072f343752cf93bd139df0d348a7aa008a9e2036a10d1b`
> 已通过 `case-a2-r6,case-b-r6,case-c-r6` 三个盲测并生成
> `productization_ready` 结论。以下正文保留为历史缺口证据。

## 结论

截至 2026-07-24，项目不能标记为完成。当前证据证明 AC1-AC8 已达到可审计状态，其中
AC8 已在修复后重新冻结；AC9 已完成外部盲测运行，但没有三个通过 case，AC10 只能
保持部分完成。

不能完成的直接证据：

- `data/blind/m3/final-summary.json` 不存在；
- 旧 baseline `7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`
  的 source hash 清单漏掉 `src/figma/inspector.ts`，已保留为 superseded 证据；
- 当前 active baseline 为
  `306135dd8a0e2dbad51c4b8db6e9073eaf1ec36030ee91c09ab83ded31c02636`；
- active freeze 覆盖 76 个受控源码/测试/脚本文件，并纳入 `src/figma/inspector.ts`；
- `case-a` 已有 `blind:m3` 运行结果但 `passed=false`，且该失败触发源码修复，因此不再
  作为未知盲测计数；
- `case-b-r2` 和 `case-c-r2` 已完成外部盲测，`sourceMatched=true`，但视觉检查未通过；
- `case-d4-r2` 已完成外部盲测运行，但失败在 `inspect_figma` 输入 schema，未形成
  validation；
- 当前设置 `M3_CASE_IDS=case-b-r2,case-c-r2,case-d4-r2` 执行 `finalize:m3` 会非零退出，
  错误为 `m3_case_evidence_invalid:case-c-r2`；
- 尚无三次盲测后的覆盖矩阵和最终 `productization_ready` 结论。

## 当前已证明范围

| 范围 | 状态 | 证据 |
| --- | --- | --- |
| P0 计划复核 | 已完成 | Worktrail 正式计划已推广并作为事实来源。 |
| M0 能力探针 | 已完成 | `reports/m0/2026-07-23-local.md`、`reports/m0/2026-07-23-live.md`。 |
| M1 通用能力 | 已完成 | `reports/m1/2026-07-23-local.md`。 |
| M2 本地 Preview/Validator/四工具 | 已完成 | `reports/m2/2026-07-23-local.md`。 |
| M3 Flow 校准 | 已重新冻结 | `reports/m3/2026-07-24-freeze-candidate.md` 与 `data/baselines/m3/freeze.json`。 |
| 冻结后 AC9 准备 | 已完成且已运行 | `reports/m3/2026-07-24-blind-runbook.md`、`reports/m3/2026-07-24-blind-evidence-ledger.md`、`reports/m3/2026-07-24-blind-input-request.md`。 |
| AC10 最终审计模板 | 已准备 | `reports/acceptance/2026-07-24-final-audit-template.md`。 |

## 当前冻结事实

- baselineId：`306135dd8a0e2dbad51c4b8db6e9073eaf1ec36030ee91c09ab83ded31c02636`；
- status：`frozen`；
- 受控源码哈希数：76；
- 固定 viewport：1 个，`mobile-393 393x852 DPR 1`；
- 视觉阈值：`maxDiffPixelRatio=0.05`、`maxDiffPixels=50000`、`timeoutMs=30000`；
- 当前验证：`freeze:m3` 已生成 active freeze，`finalize:m3` 失败门已拒绝未通过 case；
- 旧 freeze 已保留为 `data/baselines/m3/freeze.superseded-20260724t033621z.json`。

## 未完成要求逐项映射

| 要求 | 当前状态 | 需要的证明 |
| --- | --- | --- |
| 三个未知 Figma 输入 | 已提供 | 三组本机 `M3_CASE_A/B/C_*` 输入变量。 |
| 未用于开发确认 | 已确认 | 每个 case 已设置 `M3_UNKNOWN_INPUT_CONFIRMED=1` 并由 `manifest:m3` 生成哈希清单。 |
| 三个 source manifest | 已生成多组 | `data/blind/m3/case-b-r2|case-c-r2|case-d4-r2/source-manifest.json`，另有失败/历史 evidence。 |
| 三次独立盲测 | 已执行但未通过 | `case-b-r2`、`case-c-r2`、`case-d4-r2` 均有 `result.json` 和脱敏审计日志。 |
| 同一冻结基线 | 已证明但失败 | 三个 r2 result 的 baselineId 均等于当前 active freeze baselineId。 |
| 三个来源互异 | 未形成通过证明 | 三个 r2 manifest 的 sourceFileKeyHash 互异，但 `finalize:m3` 在 case 通过性处失败。 |
| 三轮内通过 | 未证明 | 每个 result `passed=true`、`agentExitCode=0`、`iterationCount` 为 1 到 3。 |
| 覆盖矩阵 | 未证明 | `final-summary.json` 中覆盖 Variables、页面、组件、图片、复杂 Auto Layout 和冻结 viewport。 |
| AC10 最终结论 | 未完成 | `finalize:m3` 成功后执行最终审计模板、验证命令和扫描。 |

## 下一步最短路径

1. 停止当前 active baseline 下的 AC9 通过判定；不要覆盖任何 `data/blind/m3/<case-id>/`
   产物。
2. 回到 M2 增强 Catalog/UISpec 生成能力，重点降低移动电商与 dashboard 的视觉差异，并调查
   Coffee Shop case 的 Agent URL 转写/工具输入 schema 失败。
3. 完成源码修复后重新执行本地验证、`prepare:m3`、真实 Flow 校准和 `freeze:m3`，再选择
   新的未知输入生成新 case ID。
4. 三次新 case 均通过后运行：

```bash
export M3_CASE_IDS=<three-passed-case-ids>
npm run finalize:m3
```

5. `finalize:m3` 成功后填写 `reports/acceptance/2026-07-24-final-audit-template.md` 并执行
   最终验证和安全扫描。

## 停止条件

任一盲测失败时：

- 不修改 frozen source；
- 不扩容 Catalog、Prompt、Schema 或工具；
- 保留失败 case 的脱敏证据；
- 在 `reports/m3/2026-07-24-blind-evidence-ledger.md` 记录失败错误码、unsupported
  feature、最大残余 diff 和建议；
- 给出“停止”或“回到 M2 补 Catalog 后重新校准”的结论。

## 当前不能宣称完成的原因

完成定义要求未知设计三次运行来自同一基线并通过冻结环境比较。当前 active baseline
下已经执行外部盲测，但 `case-b-r2` 和 `case-c-r2` 视觉失败，`case-d4-r2` 未进入
validation，且 `finalize:m3` 正确拒绝生成最终汇总。因此目标仍然未完成；继续推进需要
回到 M2 修复生成质量和 URL/tool 输入稳定性，然后重新校准、重新冻结、重新选择未知输入。
