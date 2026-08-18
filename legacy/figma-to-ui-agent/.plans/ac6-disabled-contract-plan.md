# AC6 disabled 最小追加契约实施计划

## 来源与边界

- 正式要求：Worktrail 项目实施计划 AC6；
- 已确认设计：`button`、`input`、`checkbox` 增加可选
  `disabled: boolean`，省略时等价于 `false`；
- 兼容策略：加法兼容，不提升 Schema/Catalog 版本，不迁移既有 UISpec；
- 真相所有者：`src/ui-spec/schema.ts` 的 UISpec 节点契约；
- 非真相表面：Catalog props、JSON Adapter 输出、React DOM 和测试 fixture；
- 已授权：公共契约及本地代码、测试、报告和 M3 哈希更新；
- 未授权：依赖变更、外部服务、Git、发布和正式 Worktrail 知识变更。

## 并行性

```text
[parallelism:
- independent lanes: none
- sequential blockers: UISpec Schema -> Catalog/Adapter -> Registry/CSS -> tests -> M3 hashes
- shared write surfaces: UISpec node contract and Preview Catalog are single-owner surfaces
- delegation: 0, because all consumers depend on one additive contract
]
```

## GATE-00

- [x] AC6 明确要求禁用状态；
- [x] 公共契约设计与影响分析已完成；
- [x] 用户已明确授权本次最小追加契约；
- [x] 不新增依赖、不调用外部服务、不执行 Git。

## 验收条件

- AC6-D1：旧 UISpec 不含 `disabled` 时继续通过；
- AC6-D2：Button/Input/Checkbox 接受 boolean，非法类型和其他节点上的未知字段失败；
- AC6-D3：Adapter 总是输出受控 boolean，禁用 Button 不生成 `press` ActionBinding；
- AC6-D4：React 使用原生 `disabled`，禁用控件不可操作并跳过 Tab；
- AC6-D5：禁用视觉状态清晰，桌面与移动布局不受破坏；
- AC6-D6：M3 基线覆盖 Schema、Catalog、Adapter、Registry、样式和对应测试；
- AC6-D7：类型、unit、integration、E2E、构建、M0/M2/M3 本地验证全部通过。

## 实施顺序

1. 更新 `src/ui-spec/schema.ts`。
   - 为三类交互节点增加可选 boolean。
   - 验证：Schema 单元测试证明兼容、接受和拒绝路径。
   - 覆盖：AC6-D1、AC6-D2。
2. 更新 `src/preview/catalog.ts` 和 `src/preview/json-render-adapter.ts`。
   - Catalog 使用必需 boolean prop；Adapter 将缺省值归一化为 `false`。
   - 禁用 Button 不绑定 `dispatch`。
   - 验证：Adapter 单元测试检查三类控件和 ActionBinding。
   - 覆盖：AC6-D3。
3. 更新 `preview/src/catalog-registry.tsx` 和 `preview/src/styles.css`。
   - 把 boolean 传给原生控件并增加明确禁用样式。
   - 验证：Playwright 检查原生禁用、不可操作、状态不变和 Tab 顺序。
   - 覆盖：AC6-D4、AC6-D5。
4. 更新 E2E fixture 与测试。
   - 在 E2E 独立修订中标记 Button/Input/Checkbox 为禁用。
   - 不改变 M2 基础探针的导航行为。
   - 覆盖：AC6-D2、AC6-D4、AC6-D5。
5. 更新 `scripts/prepare-m3.mjs`。
   - 将 JSON Adapter 和本次核心单元测试加入受控哈希。
   - 覆盖：AC6-D6。
6. 自审并执行本地回归。
   - `npm run typecheck`
   - `npm run test:unit`
   - `npm run test:integration`
   - `npm run test:e2e`
   - `npm exec -- vite build --config vite.config.ts`
   - `npm run probe:m0:local`
   - `npm run probe:m2:local`
   - `npm run prepare:m3`
   - `npm run probe:m3:local`
   - 覆盖：AC6-D7。
7. 更新中文 README、AC1-AC10 证据矩阵、M3 报告和 Worktrail state。

## 风险与回滚

- 风险：Catalog 与 Adapter 字段不一致会使 Preview 失败关闭。
  - 缓解：先更新共享契约，再运行 Adapter 单元测试和 TypeScript 检查。
- 风险：禁用 Button 仍携带 ActionBinding。
  - 缓解：Adapter 明确不生成 `on.press`，E2E 验证点击不导航。
- 风险：现有 UISpec 因新字段变为必需而失效。
  - 缓解：UISpec 字段保持可选，只有 Adapter 输出的 Catalog prop 为必需。
- 回滚：删除三类节点的可选字段及对应消费者和测试即可；没有数据迁移或版本提升。
