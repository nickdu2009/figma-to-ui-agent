# M3 未知输入盲测证据台账

## 使用规则

本台账用于 AC9 三次未知输入盲测的审计记录。不得写入真实 Figma URL、文件键、节点
明文、Token、Cookie、私有响应、截图原始内容或未脱敏 Agent 输出。

允许记录：

- case id；
- 覆盖意图；
- 是否已人工确认“开发阶段未使用”；
- source manifest、result、validation、audit log 的相对路径；
- 文件键、URL、目标节点和行为说明的哈希；
- variables capability、feature evidence、残余 diff 和结论。

冻结基线：

- baselineId：`306135dd8a0e2dbad51c4b8db6e9073eaf1ec36030ee91c09ab83ded31c02636`；
- fixed viewport：`mobile-393 393x852 DPR 1`；
- visual threshold：`maxDiffPixelRatio=0.05`、`maxDiffPixels=50000`；
- 受控源码哈希数：76；
- 旧 baseline `7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`
  已保留为 `data/baselines/m3/freeze.superseded-20260724t033621z.json`，不再作为
  active AC9 基线。

## 输入登记

| Case | 状态 | 覆盖意图 | 未用于开发确认 | 输入哈希证据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `case-a` | blind 未通过 | 登录/注册移动端 / 多页面来源 / 移动单屏 | 已确认 | `data/blind/m3/case-a/source-manifest.json` | `inspect_figma` 响应超过大小上限，停止后续盲测。 |
| `case-b` | manifest 已生成 | 电商结账 / 组件复用 / 移动单屏 | 已确认 | `data/blind/m3/case-b/source-manifest.json` | 不记录真实 URL。 |
| `case-c` | manifest 已生成 | 移动 Dashboard / 图片与复杂布局候选 / 长页面 | 已确认 | `data/blind/m3/case-c/source-manifest.json` | 不记录真实 URL。 |
| `case-b-r2` | blind 未通过 | 电商结账 / 组件复用 / 移动单屏 | 已确认 | `data/blind/m3/case-b-r2/source-manifest.json` | active baseline 下执行，视觉未通过。 |
| `case-c-r2` | blind 未通过 | Dashboard / 图片与复杂布局候选 | 已确认 | `data/blind/m3/case-c-r2/source-manifest.json` | active baseline 下执行，视觉未通过。 |
| `case-d-r2` | blind 未通过 | Coffee Shop 移动 Home 候选 | 已确认 | `data/blind/m3/case-d-r2/source-manifest.json` | Agent 工具调用时 URL 被判无效。 |
| `case-d2-r2` | manifest 污染，不计入 | Coffee Shop 移动 Home 候选 | 已确认 | `data/blind/m3/case-d2-r2/source-manifest.json` | `.envrc` 默认目标节点污染 manifest，运行被 mismatch 拒绝。 |
| `case-d3-r2` | blind 未通过 | Coffee Shop 移动 Home 候选 | 已确认 | `data/blind/m3/case-d3-r2/source-manifest.json` | 输入一致，但 Agent 工具调用时 URL 被判无效。 |
| `case-d4-r2` | blind 未通过 | Coffee Shop 移动 Home 候选 | 已确认 | `data/blind/m3/case-d4-r2/source-manifest.json` | 短 URL 仍被 Agent 工具调用判无效。 |

覆盖意图可以调整，但三个 case 合计必须满足 `finalize:m3` 的覆盖矩阵。

## 执行记录模板

每个 case 完成后复制一段并填写脱敏事实。

### case-a

- manifest：`data/blind/m3/case-a/source-manifest.json`；
- blind result：`data/blind/m3/case-a/result.json`；
- redacted log：`data/blind/m3/case-a/pi-output.redacted.log`；
- tool audit：`data/blind/m3/case-a/tool-events.redacted.jsonl`；
- project root：`data/projects/blind-case-a`；
- sourceFileKeyHash：`6d37d23b085b85e7e68c4d467e0b2c8fa7e6146db9ad0a3411f9816ec8b993f3`；
- sourceUrlHash：`730bef694d55549c32c949ee1f215b37b82679deb1e437c6c99c421785086fd8`；
- targetNodeHashes：`6013ecf4f37ad7e5ac2a4883a3902e9e8651aae1d31f4860b9c6c07e8fea13b8`；
- behaviorNotesHash：`9f733bc41784514597d3e20859b2f9b5f38f1341787e190e5299456a258d6162`；
- variablesCapability：未生成；
- featureEvidence：未生成；
- residualDiff：`maxDiffPixelCount=0`、`maxDiffPixelRatio=0`；
- iterationCount：`0`；
- sourceMatched：`false`；
- passed：`false`；
- unsupportedFeatures：`Inspect oversized Figma response in current bounded run`；
- 结论：未通过。`inspect_figma` 返回 `Figma REST 响应超过大小上限`，随后同请求内部重试门返回
  `bounded_loop_inspect_failed`，未生成 DesignBundle、UISpec、project 或截图比较结果。按冻结盲测规则
  停止后续 case，不现场改源码、Prompt、Catalog、Schema、工具、模型、viewport 或阈值。

### case-b

- manifest：`data/blind/m3/case-b/source-manifest.json`；
- blind result：`data/blind/m3/case-b/result.json`；
- redacted log：`data/blind/m3/case-b/pi-output.redacted.log`；
- tool audit：`data/blind/m3/case-b/tool-events.redacted.jsonl`；
- project root：`data/projects/blind-case-b`；
- sourceFileKeyHash：`163d3856195242deef91b7eed1ea414c237067e4676d3f3d107613f84304b366`；
- sourceUrlHash：`aac77b9b1f64982f21b13134ce4efb5244141adab98e8f10b988e77bfa4852fc`；
- targetNodeHashes：`20bca826def7212ba6ebd8d4538709703b138b20cf6449e7b7a424bcfc227173`；
- behaviorNotesHash：`9f733bc41784514597d3e20859b2f9b5f38f1341787e190e5299456a258d6162`；
- variablesCapability：待填；
- featureEvidence：待填；
- residualDiff：待填；
- iterationCount：待填；
- sourceMatched：待填；
- passed：待填；
- 结论：待填。

### case-c

- manifest：`data/blind/m3/case-c/source-manifest.json`；
- blind result：`data/blind/m3/case-c/result.json`；
- redacted log：`data/blind/m3/case-c/pi-output.redacted.log`；
- tool audit：`data/blind/m3/case-c/tool-events.redacted.jsonl`；
- project root：`data/projects/blind-case-c`；
- sourceFileKeyHash：`9755f74d4e49df84bfdc915303431e981a981f62af3230aac753cdb5d665db65`；
- sourceUrlHash：`98b52cd999effce727b1d1a1a7259f95ce71aef5c8cc9e38a9f9d188d3afeb5d`；
- targetNodeHashes：`8ea1a01dcc87dcec3ebeb19606d7f4b3e505af60fa67d7c7430db1b9cb0647d0`；
- behaviorNotesHash：`9f733bc41784514597d3e20859b2f9b5f38f1341787e190e5299456a258d6162`；
- variablesCapability：待填；
- featureEvidence：待填；
- residualDiff：待填；
- iterationCount：待填；
- sourceMatched：待填；
- passed：待填；
- 结论：待填。

### case-b-r2

- manifest：`data/blind/m3/case-b-r2/source-manifest.json`；
- blind result：`data/blind/m3/case-b-r2/result.json`；
- redacted log：`data/blind/m3/case-b-r2/pi-output.redacted.log`；
- tool audit：`data/blind/m3/case-b-r2/tool-events.redacted.jsonl`；
- project root：`data/projects/blind-case-b-r2`；
- sourceFileKeyHash：`163d3856195242deef91b7eed1ea414c237067e4676d3f3d107613f84304b366`；
- targetNodeHashes：`20bca826def7212ba6ebd8d4538709703b138b20cf6449e7b7a424bcfc227173`；
- variablesCapability：`unavailable_optional/unknown`；
- featureEvidence：`pageCount=1`、`componentCount=10`、`imageAssetCount=1`、`autoLayoutNodeCount=3`、`boundVariableRefCount=0`、`unsupportedNodeCount=0`；
- warningCodes：`unsupported_style_value`、`variables_unavailable_optional`；
- residualDiff：`maxDiffPixelCount=189014`、`maxDiffPixelRatio=0.5644972464131695`；
- iterationCount：`2`；
- sourceMatched：`true`；
- passed：`false`；
- 结论：未通过。功能、键盘和 console 均通过，但视觉检查未通过，差异比例高于冻结阈值
  `0.05`。该 case 已形成有效盲测失败证据，不覆盖、不计为 AC9 通过。

### case-c-r2

- manifest：`data/blind/m3/case-c-r2/source-manifest.json`；
- blind result：`data/blind/m3/case-c-r2/result.json`；
- redacted log：`data/blind/m3/case-c-r2/pi-output.redacted.log`；
- tool audit：`data/blind/m3/case-c-r2/tool-events.redacted.jsonl`；
- project root：`data/projects/blind-case-c-r2`；
- sourceFileKeyHash：`9755f74d4e49df84bfdc915303431e981a981f62af3230aac753cdb5d665db65`；
- targetNodeHashes：`8ea1a01dcc87dcec3ebeb19606d7f4b3e505af60fa67d7c7430db1b9cb0647d0`；
- variablesCapability：`unavailable_optional/unknown`；
- featureEvidence：`pageCount=1`、`componentCount=0`、`imageAssetCount=6`、`autoLayoutNodeCount=0`、`boundVariableRefCount=0`、`unsupportedNodeCount=0`；
- warningCodes：`unsupported_style_value`、`variables_unavailable_optional`；
- residualDiff：`maxDiffPixelCount=362586`、`maxDiffPixelRatio=0.5189036484943199`；
- iterationCount：`2`；
- sourceMatched：`true`；
- passed：`false`；
- 结论：未通过。功能、键盘和 console 均通过，但视觉检查未通过，差异比例高于冻结阈值
  `0.05`。该 case 已形成有效盲测失败证据，不覆盖、不计为 AC9 通过。

### case-d4-r2

- manifest：`data/blind/m3/case-d4-r2/source-manifest.json`；
- blind result：`data/blind/m3/case-d4-r2/result.json`；
- redacted log：`data/blind/m3/case-d4-r2/pi-output.redacted.log`；
- tool audit：`data/blind/m3/case-d4-r2/tool-events.redacted.jsonl`；
- project root：`data/projects/blind-case-d4-r2`；
- sourceFileKeyHash：`3a18026a65bc66fec31748164d22a1bdcb1ca969d55b4452a9fb148dee00a3f8`；
- targetNodeHashes：`aa545aa549b11bb5abb81bf9e23e28d85f4cd476e135646427e8b3e2386e3f74`；
- variablesCapability：未生成；
- featureEvidence：未生成；
- residualDiff：`maxDiffPixelCount=0`、`maxDiffPixelRatio=0`；
- iterationCount：`0`；
- sourceMatched：`false`；
- passed：`false`；
- 结论：未通过。Agent 调用 `inspect_figma` 时工具输入被 schema 判定为 `Figma URL 无效`，
  随后 `load_ui_spec` 返回项目不存在，未生成 DesignBundle、UISpec 或 validation。
  `case-d-r2` 与 `case-d3-r2` 为同类失败；`case-d2-r2` 是 manifest 环境变量污染导致
  `m3_source_manifest_mismatch`，不计入有效盲测。

## 最终汇总记录

三个 case 均通过后执行：

```bash
export M3_CASE_IDS=<three-passed-case-ids>
npm run finalize:m3
```

成功后填写：

- final summary：`data/blind/m3/final-summary.json`；
- status：待填；
- sourceFilesDistinct：待填；
- allCasesPassed：待填；
- coverage.noVariables：待填；
- coverage.bindingsWithoutFullVariables：待填；
- coverage.fullVariablesOrExplicitNonLiveContractFixture：待填；
- coverage.multiplePages：待填；
- coverage.frozenViewports：待填；
- coverage.components：待填；
- coverage.images：待填；
- coverage.complexAutoLayout：待填；
- AC9 结论：待填。

## 失败记录规则

任一 case 失败时：

- 保留 `data/blind/m3/<case-id>/` 与 `data/projects/blind-<case-id>/`；
- 不覆盖 `source-manifest.json` 或 `result.json`；
- 不现场修改 frozen source、Prompt、Catalog、Schema、工具、模型、浏览器、viewport 或阈值；
- 在对应 case 的“结论”中记录失败错误码、unsupported feature、最大残余 diff 和建议；
- 明确给出“停止”或“回到 M2 补 Catalog 后重新校准”的判断。

## 当前状态

截至 2026-07-24 11:45 CST：

- AC8 已用 active baseline 重新冻结；
- AC9 三个外部盲测运行已执行，但没有三个通过 case；
- `case-a` 外部盲测已执行但未通过，失败阶段为 `inspect_figma`，并触发 targeted
  nodes 修复，因此不再作为未知盲测计数；
- `case-b-r2` 与 `case-c-r2` 在 active baseline 下完成验证但视觉未通过；
- `case-d4-r2` 在 active baseline 下未通过，失败阶段为 `inspect_figma` 输入 schema；
- `.envrc` 已配置三组 `M3_CASE_A/B/C_*` 输入变量，当前活动输入默认指向 `case-a`；
- 凭据与模型变量已存在于 `.envrc`，但本台账不记录其值；
- `M3_CASE_IDS=case-b-r2,case-c-r2,case-d4-r2 npm run finalize:m3` 正确非零退出，
  错误为 `m3_case_evidence_invalid:case-c-r2`；
- `data/blind/m3/final-summary.json` 未生成，不能宣称 `productization_ready`。
