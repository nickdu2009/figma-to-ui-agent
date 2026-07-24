# M3 下一硬门与候选执行参数

## 结论

截至 2026-07-24，本地实现和 M3 运行框架没有新的代码阻塞。八次真实 Flow 均已
获得独立授权并执行：

- 首次因 Pi JSON 流式事件放大到 20 MiB 而受控终止；
- 第二次已成功抽取 Figma 并保存 101 个节点的 UISpec，但 Extension 在 Pi 内部
  `turn_start` 错误重置 bounded-loop 状态，导致比较被拒绝；
- 第三次 Agent 正常退出且 Figma 抽取成功，但没有保存 UISpec、执行比较或输出最终
  文本。旧审计无法还原最后工具事件，精确根因保持未知。
- 第四次通过新增审计明确定位为 Figma REST HTTP `429` 限流；本地项目未创建，
  有效验证迭代仍为 0。
- 第五次在加长 REST 重试窗口后仍被 Figma REST `file` HTTP `429` 限流，并暴露
  模型重复调用 `inspect_figma` 会放大外部请求压力。
- 第六次确认同一请求内 inspect 失败关闭门已生效，重复 `inspect_figma` 被本地拒绝，
  没有再次访问 Figma；当前仍阻塞在 Figma REST `file` HTTP `429`。
- 更换 Figma token 后，单请求 rate-limit live 探针返回 HTTP `200`，证明新 token
  可以读取目标文件。
- 第七次使用 `m3-flow-20260723-g` 后，Figma 抽取、UISpec 保存和
  `render_and_compare` 均已执行；结果仍为 failed，但失败类别转为视觉校准目标
  不匹配。expected 是 `1832x3079` 的三手机画板复合大画布，候选视口是
  `1440x900` 与 `390x844`，两轮 exact RGBA 视觉差异均超过 92%。
- 采纳单画板路径后，M3 冻结策略允许 1 个 page 和 1 个 viewport 的校准结果；
  第八次使用 `m3-flow-20260723-h`、`landingpage` 单画板和 `440x996` viewport 后
  通过，1 次迭代内完成端到端 Flow，视觉差异比例 `0.003450`。

前两项根因已完成通用修复；第三次暴露的诊断缺口已由最小脱敏工具生命周期审计
补齐；第四次暴露的 Figma 限流已通过加长 429/5xx 重试窗口修复，并把 REST client
纳入 M3 受控哈希；第五次暴露的重复 inspect 已通过同一请求内失败关闭门修复。
相关变更已重新通过集成、typecheck、M3 预检和本地门禁。

当前下一硬门是审阅 `m3-flow-20260723-h` 的通过证据，并决定是否把 `landingpage`
单画板、`440x996` viewport 和当前视觉阈值作为 M3 calibration freeze 候选。新的真实
重试仍会访问 Figma 和 OpenAI，需要新的明确外部执行授权；但在已有通过证据下，不应
为了同一目标重复运行。三个未知输入盲测只能在 Flow 通过、配置完成冻结后开始，输入
不能由 Agent 生成或从开发样本复制。

## 本机配置核对

只解析了 `.envrc` 的变量声明，没有执行文件内容，也没有输出变量值：

- `FIGMA_API_KEY`：已声明；
- `OPENAI_API_KEY`：已声明；
- `OPENAI_BASE_URL`：已声明；
- `PI_OPENAI_MODEL`：精确为 `gpt-5.4`；
- `.envrc` 的非注释内容全部是变量赋值；
- `.envrc` 和 `data/` 均已被 `.gitignore` 排除；
- direnv 当前将 `.envrc` 标记为 blocked，本轮没有执行 `direnv allow`。

direnv blocked 是本机信任状态，不是 API 或凭据有效性结论。获得外部执行授权后，
运行器可以在受控子进程中读取该纯赋值文件；也可以由用户先自行允许 direnv。

## AC6 已实施契约

已实施：

- `button`、`input`、`checkbox` 节点增加可选 `disabled: boolean`；
- 省略时等价于 `false`，现有 UISpec 不需要迁移；
- Adapter 把值转换为受控 Catalog 的必需 boolean prop；
- React Registry 使用原生 HTML `disabled`；
- 禁用按钮不绑定 `dispatch`，禁用输入和复选框不能改变状态；
- 不增加动态状态绑定、通用 Disabled 包装器、依赖或 Schema 版本迁移。

影响面：

- UISpec Schema；
- Preview Catalog；
- JSON Adapter；
- React Registry 和禁用样式；
- Schema、Adapter、E2E 测试；
- M3 受控源码哈希。

验收结果：

1. 旧 UISpec 无 `disabled` 字段时继续通过；
2. 三类控件只接受 boolean，其他节点或非法类型失败关闭；
3. DOM 使用原生 `disabled`，控件不可操作并跳过 Tab；
4. 禁用按钮不触发 UISpec Action；
5. AC6 回归的 80 个单元测试、26 个集成测试和 4 个 E2E 全部通过；
6. M0/M2/M3 本地探针和构建通过，M3 已生成 36 个受控文件哈希。

Flow 运行器修复后，完整单元测试为 17 个文件、81 项，完整集成测试为 6 个文件、
29 项，全部通过。

## Flow 候选配置

以下候选配置已通过 `frozenRunPolicySchema` 本地校验，但尚未冻结：

```json
{
  "viewports": [
    {
      "id": "landingpage",
      "width": 440,
      "height": 996,
      "deviceScaleFactor": 1
    }
  ],
  "comparison": {
    "maxDiffPixelRatio": 0.05,
    "maxDiffPixels": 50000,
    "timeoutMs": 30000
  }
}
```

其他本地检查：

- 首次项目 ID：`m3-flow-20260723-a`，已保存失败证据，不能覆盖或复用；
- 第二次项目 ID：`m3-flow-20260723-b`，已保存失败证据，不能覆盖或复用；
- 第三次项目 ID：`m3-flow-20260723-c`，已保存失败证据，不能覆盖或复用；
- 第四次项目 ID：`m3-flow-20260723-d`，已保存失败证据，不能覆盖或复用；
- 第五次项目 ID：`m3-flow-20260723-e`，已保存失败证据，不能覆盖或复用；
- 第六次项目 ID：`m3-flow-20260723-f`，已保存失败证据，不能覆盖或复用；
- 第七次项目 ID：`m3-flow-20260723-g`，已保存失败证据，不能覆盖或复用；
- 第八次项目 ID：`m3-flow-20260723-h`，已保存通过证据，不能覆盖或复用；
- 当前已冻结 h，冻结 baselineId：
  `7233e8901294a6290bbc88a9b0cd52cf75f9b74ede0675824e577a1c4e2436e6`；
- 若未来因受控源码修复而丢弃并重冻，下一重试候选项目 ID：`m3-flow-20260723-i`，
  必须在执行前保持不存在；
- M3 预检在冻结前为：`pending_flow_calibration`；
- 已登记开发输入哈希：1 个；
- Flow 输入明文和文件键不写入本报告；
- `M3_FLOW_EXTERNAL_AUTHORIZED`、`M3_FLOW_INPUT_CONFIRMED` 和其他 Flow
  运行变量尚未在 `.envrc` 中设置。

候选阈值已在真实 Flow 结果通过并经审阅后冻结。八次真实 Flow 的详细脱敏结论见
`reports/m3/2026-07-23-flow-calibration.md`。后续不放宽工具边界、输出上限或视觉
阈值，也不加入样本分支。盲测运行会在对应 case 目录生成 `tool-events.redacted.jsonl`，
只保存脱敏后的最小生命周期元数据。

## 仍需明确的信息

真实 Flow 的业务行为只能来自 Figma 中已被 Adapter 支持的事实，或显式
`M3_FLOW_BEHAVIOR_NOTES`。当前本地 Adapter 不提取 Figma prototype reaction，
因此若 Flow 需要点击、导航、表单或对话框行为，需要在授权时给出最小行为说明；
不能根据画面文案猜测。

Flow 冻结完成后，三个盲测 case 分别需要：

- 未用于开发的 Figma URL；
- 目标 Node；
- 要求使用的 Viewport；
- 最小 `behaviorNotes`，没有交互时明确写“无交互，仅验证页面呈现”。
