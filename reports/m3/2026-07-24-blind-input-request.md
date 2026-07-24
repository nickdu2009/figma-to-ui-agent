# M3 未知输入请求包

## 目的

当前项目已经冻结 M3 Flow 校准基线，下一步需要三个开发阶段未使用过的 Figma 输入来
完成 AC9 盲测。2026-07-24 用户已确认先把三组真实 Figma 输入写入本文档和本机
`.envrc`，用于后续本机执行；不要把包含真实 URL、文件键、节点明文或 Token 的版本
提交、共享或迁入 Worktrail。对外报告仍只记录 manifest 哈希和相对证据路径。

## 每个输入需要的信息

为每个 case 准备以下字段：

```bash
export M3_CASE_ID=case-a
export M3_FIGMA_URL='<真实 Figma design URL，仅本机配置>'
export M3_TARGET_NODES='<目标 node id，多个用逗号分隔>'
export M3_BEHAVIOR_NOTES='无交互，仅验证页面呈现'
export M3_UNKNOWN_INPUT_CONFIRMED=1
```

case id 建议固定为：

- `case-a`
- `case-b`
- `case-c`

## 已选择输入

以下三组输入来自 Figma Community 打开后的真实 Design 文件，已通过 Figma REST API
只读校验目标节点可读。三组输入均未用于 M0、M2、M3 Flow 校准或 429 排查。

| Case | 覆盖意图 | `M3_FIGMA_URL` | `M3_TARGET_NODES` | 节点名称 | 节点尺寸 |
| --- | --- | --- | --- | --- | --- |
| `case-a` | 登录/注册移动端；多页面来源；移动单屏 | `https://www.figma.com/design/m7n2YELcPxVC0XSkoPrFgI/20-Screen-Login---Register-Mobile-App--Community-?node-id=3-5123` | `3:5123` | `Login Version 1` | `375x812` |
| `case-b` | 电商结账；组件复用；移动单屏 | `https://www.figma.com/design/h5GijatCPSITusTB3s5hi3/Open-Fashion---Free-eCommerce-UI-Kit--Community-?node-id=728-1889` | `728:1889` | `Checkout` | `375x797` |
| `case-c` | 移动 Dashboard；图片/复杂布局候选；长页面 | `https://www.figma.com/design/V6tT6OcSYzm9SYK0yRS1wf/BankDash---Dashboard-UI-Kit---Admin-Template-Dashboard---Admin-Dashboard--Community-?node-id=169-3352` | `169:3352` | `Dashboard for Mobile` | `375x1778` |

## 输入选择标准

三个 case 必须来自三个不同的 Figma 文件，并且没有用于：

- M0 live probe；
- M2/Flow test；
- M3 429 排查；
- `m3-flow-20260723-a` 到 `m3-flow-20260723-h` 任一校准；
- Prompt、Catalog、Schema 或 Adapter 调试。

每个目标最好天然适配冻结 viewport `440x996`。如果目标是大画布、多个并排画板或
桌面页面，视觉比较很可能失败。

## 覆盖建议

三个输入合计最好覆盖：

- `case-a`：多页面结构，最好没有 Variables 绑定；
- `case-b`：组件实例或复用组件，并包含 Variables 绑定；
- `case-c`：图片资产和复杂 Auto Layout。

如果无法提前判断，仍可执行盲测；最终由 `finalize:m3` 根据 `featureEvidence` 判断
覆盖是否足够。

## 执行顺序

每个 case 先生成 manifest：

```bash
npm run manifest:m3
```

该步骤不访问网络，只保存哈希。如果成功，再明确授权外部调用并执行：

```bash
export M3_EXTERNAL_AUTHORIZED=1
npm run blind:m3
```

三个 case 都通过后：

```bash
export M3_CASE_IDS=case-a,case-b,case-c
npm run finalize:m3
```

## 不能做的事

- 不要重复使用开发阶段的 Figma 文件；
- 不要把真实 URL 或 Token 写入报告；
- 不要在盲测之间改源码、Prompt、Catalog、Schema、工具、模型、浏览器、viewport 或阈值；
- 不要覆盖已有 `data/blind/m3/<case-id>/source-manifest.json` 或 `result.json`；
- 不要把失败 case 当场扩容修复；失败后只记录证据并决定停止或回到 M2。

## 当前状态

`.envrc` 已配置凭据、模型变量名和三组 `M3_CASE_A/B/C_*` 输入变量。当前活动输入默认
指向 `case-a`。继续 AC9 前仍需逐个 case 生成 manifest，并只在执行 `blind:m3` 前设置
`M3_EXTERNAL_AUTHORIZED=1`。
