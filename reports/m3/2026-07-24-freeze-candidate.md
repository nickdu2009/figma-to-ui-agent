# M3 Freeze 候选与执行报告

## 结论

更新：2026-07-24 的 AC9 首次盲测暴露出旧冻结清单漏掉
`src/figma/inspector.ts`，因此原 baseline
`7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`
已保留为 `data/baselines/m3/freeze.superseded-20260724t033621z.json`，
不再作为 active freeze。

当前 active freeze 来自 `m3-flow-20260724-b`，baselineId 为
`306135dd8a0e2dbad51c4b8db6e9073eaf1ec36030ee91c09ab83ded31c02636`。
它使用新的非盲测 Community 单屏移动 frame 和 `393x852` viewport，在 1 次迭代内
通过 Figma 抽取、UISpec 保存、Preview 渲染和 exact RGBA validation。当前
`data/baselines/m3/freeze.json` 已覆盖 76 个受控源码/测试/脚本文件，包含
`src/figma/inspector.ts`。

历史记录：`m3-flow-20260723-h` 曾是已确认并冻结的真实 Flow 校准结果。它使用已登记
开发输入中的单个 `landingpage` 画板和 `440x996` viewport，在 1 次迭代内通过 Figma
抽取、UISpec 保存、Preview 渲染和 exact RGBA validation。

人工确认校准结果和视觉阈值后，曾生成旧 `data/baselines/m3/freeze.json`。该文件已
被新 active freeze 取代，但保留为 superseded 证据。

本报告不包含 Figma URL、文件键、节点明文、Token、私有响应或未脱敏 Agent 输出。

## 候选证据

### 当前 active freeze

- Flow 项目：`m3-flow-20260724-b`；
- 结果文件：`data/calibration/m3/m3-flow-20260724-b/result.json`；
- 最终 validation：`data/projects/m3-flow-20260724-b/runs/mrye1iin-129e80b1a6c4479f902e77290b4cfbc6/validation.json`；
- Agent 退出码：`0`；
- 有效迭代数：`1`；
- `sourceMatched=true`；
- `firstPassPassed=true`；
- `finalPassed=true`；
- DesignBundle revision：`1`；
- UISpec revision：`1`；
- Variables：`unavailable_optional`，仍按可选增强能力处理；
- 工具顺序：`inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`，随后正常停止。

### 历史 superseded freeze

- Flow 项目：`m3-flow-20260723-h`；
- 结果文件：`data/calibration/m3/m3-flow-20260723-h/result.json`；
- 最终 validation：`data/projects/m3-flow-20260723-h/runs/mrya4oqu-a4a51f7f9eb74fef9b5d9b7b32a1a25f/validation.json`；
- Agent 退出码：`0`；
- 有效迭代数：`1`；
- `sourceMatched=true`；
- `firstPassPassed=true`；
- `finalPassed=true`；
- DesignBundle revision：`1`；
- UISpec revision：`1`；
- Variables：`unavailable_optional`，仍按可选增强能力处理；
- 工具顺序：`inspect_figma`、`load_ui_spec`、`save_ui_spec`、`render_and_compare`，随后正常停止。

## 候选冻结面

当前 active viewport：

```json
[
  {
    "id": "mobile-393",
    "width": 393,
    "height": 852,
    "deviceScaleFactor": 1
  }
]
```

当前 active 比较参数：

```json
{
  "maxDiffPixelRatio": 0.05,
  "maxDiffPixels": 50000,
  "timeoutMs": 30000
}
```

历史 superseded viewport：

Viewport：

```json
[
  {
    "id": "landingpage",
    "width": 440,
    "height": 996,
    "deviceScaleFactor": 1
  }
]
```

比较参数：

```json
{
  "maxDiffPixelRatio": 0.05,
  "maxDiffPixels": 50000,
  "timeoutMs": 30000
}
```

运行时：

- 模型：`gpt-5.4`；
- Pi：`0.81.1`；
- Chromium：`149.0.7827.55`；
- Diff 策略：`playwright-exact-rgba-v1`；
- locale：`zh-CN`；
- timezone：`UTC`；
- color scheme：`light`；
- reduced motion：`reduce`；
- 字体族：`Arial, sans-serif`；
- 动画禁用：`true`；
- service workers：`block`。

## Validation 结果

当前 active validation result：

- pageId：`customer-service`；
- viewportId：`mobile-393`；
- functional：通过；
- keyboard：通过，页面没有可交互控件；
- console：通过；
- visual：通过；
- diffPixelCount：`408`；
- diffPixelRatio：`0.001219`。

该结果低于候选阈值 `maxDiffPixelRatio=0.05` 和 `maxDiffPixels=50000`。

历史 superseded validation result：

唯一 validation result：

- pageId：`page-landingpage`；
- viewportId：`landingpage`；
- functional：通过；
- keyboard：通过，页面没有可交互控件；
- console：通过；
- visual：通过；
- diffPixelCount：`1512`；
- diffPixelRatio：`0.0034501642935377873`。

该结果低于候选阈值 `maxDiffPixelRatio=0.05` 和 `maxDiffPixels=50000`。

## Freeze 执行

当前 active freeze 执行命令：

```bash
M3_FLOW_CALIBRATION_CONFIRMED=1 \
M3_VISUAL_THRESHOLD_CONFIRMED=1 \
npm run freeze:m3 -- --confirm \
  --flow-record data/projects/m3-flow-20260724-b/runs/mrye1iin-129e80b1a6c4479f902e77290b4cfbc6/validation.json
```

结果：

- status：`frozen`；
- baselineId：`306135dd8a0e2dbad51c4b8db6e9073eaf1ec36030ee91c09ab83ded31c02636`；
- fixedViewportCount：`1`；
- validationRecordSha256：`cef8c3da8e0569127f458e2214a47b02d32ae510243dfaf9a43d0ca98aada854`；
- `data/baselines/m3/freeze.json` 权限为 `0600`；
- 受控 source hash 数：`76`；
- `src/figma/inspector.ts` 已纳入 source hash。

历史 superseded freeze 执行记录：

冻结未调用 Figma 或 OpenAI，只读取已存在的 validation 记录和当前 M3 preflight
哈希。执行命令为：

```bash
M3_FLOW_CALIBRATION_CONFIRMED=1 \
M3_VISUAL_THRESHOLD_CONFIRMED=1 \
npm run freeze:m3 -- --confirm \
  --flow-record data/projects/m3-flow-20260723-h/runs/mrya4oqu-a4a51f7f9eb74fef9b5d9b7b32a1a25f/validation.json
```

结果：

- status：`frozen`；
- baselineId：`7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`；
- fixedViewportCount：`1`；
- validationRecordSha256：`5f157c345c04a43bf162615c820199058fcc3b227f768a3b4bd7f5d983c02cb1`；
- `data/baselines/m3/freeze.json` 权限为 `0600`。

冻结 manifest 加载、37 个受控源码哈希和 runtime 校验已通过。冻结清单、h 校准证据
和 h 项目证据未发现真实 token、Figma URL 或 group/other 权限放开。

冻结后未修改受控源码。`probe:m3:local` 是冻结前门禁脚本；冻结存在后，它对
`manifest:m3` 的旧断言会先遇到 `m3_case_id_invalid`。该脚本已被纳入冻结 source
hash，因此不在当前冻结基线上修改。AC9 入口已通过直接命令验证失败关闭：

- `manifest:m3` 缺输入返回 `m3_case_id_invalid`；
- `blind:m3` 缺外部授权返回 `m3_external_execution_not_authorized`；
- `finalize:m3` 缺三个 case 返回 `m3_finalization_requires_three_cases`。

## 限制与风险

- 该候选只覆盖 `landingpage` 单画板页面呈现；
- 不覆盖三画板复合 Flow；
- 不覆盖报价页、表单状态、业务交互或页面跳转；
- Variables 仍是可选不可用，不阻塞本候选；
- 后续三次盲测必须使用冻结后的同一 viewport、比较参数、模型、Prompt、Catalog、
  Schema、工具、浏览器和阈值；
- 盲测覆盖仍需通过三个未知输入补齐多页面、组件、图片、复杂 Auto Layout、Variables
  可选降级或 non-live fixture 等最终矩阵。

## 审阅结论

`m3-flow-20260724-b` 是当前 active M3 calibration freeze。下一硬门仍是三个开发阶段
未使用的未知 Figma 输入在同一 active baseline 下通过 `blind:m3` 并通过
`finalize:m3`。截至本更新，AC9 已执行外部盲测但未通过，不能宣称
`productization_ready`。
