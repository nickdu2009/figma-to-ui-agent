---worktrail
{
  "schema": "worktrail.knowledge.v1",
  "id": "figma-to-ui-agent-community-corpus-m5-coverage-result",
  "scope": "project",
  "type": "validation",
  "title": "Figma-to-UI Agent Community Corpus M5 Coverage 验证结果",
  "status": "active",
  "lifecycle": "current",
  "topic": "figma-to-ui-agent"
}
---

# Figma-to-UI Agent Community Corpus M5 Coverage 验证结果

## 结论

2026-07-26 已完成第一批 6 个 Figma Community 样本的真实 REST 可读性探针和 M5 coverage scanner。6 个样本均达到 `rest_readable_node_selected`，并已选出代表性 frame `nodeId`。Coverage scanner 全部完成，但整体视觉覆盖仍不达标，主要瓶颈是 vector 覆盖不足。

## 样本与节点

| sampleId | fileKey | nodeId | selectedNode | size |
|---|---|---|---|---|
| community-login-001 | jLjZfh0AntwoJ0Z7NjfKnY | 3:5123 | Login Version 1 | 375x812 |
| community-mobile-001 | NfIJDaLmWpNuVzugWT12xs | 3186:4543 | 6.11 - A - Profile | 393x1029 |
| community-dashboard-001 | krSvKTElV3sqy0wbbrzsnM | 0:2 | Light - Dashboard - 1 | 1440x1024 |
| community-ecommerce-001 | pAd2NPLRFjI3eZ70IxYbTf | 0:303 | Featured | 375x812 |
| community-landing-001 | qXqo1OokdWnXvg0UjFaDX3 | 10:948 | Home | 1440x1285 |
| community-design-system-001 | dgYDpEYe2yITqznx3e2hPw | 5:37426 | In modals | 1829x924 |

## REST 探针结果

- targetSampleCount: 6
- `rest_readable_node_selected`: 6/6
- Figma REST 429: 0
- OpenAI: 未调用
- `community-login-001` 首次完整 `/files` 读取超时，随后使用 `depth=2` 文件结构探针选出顶层 frame，再通过 `/nodes` 验证可读。

## Coverage 汇总

| 指标 | 结果 |
|---|---:|
| sampleCount | 6 |
| sourceNodeCount | 1430 |
| visibleNodeCount | 1397 |
| unsupported | 563 (40.30%) |
| unmapped | 0 (0.00%) |
| vectorRendered | 160/740 (21.62%) |
| imageFillRendered | 8/9 (88.89%) |
| textRendered | 228/235 (97.02%) |
| budgetExceeded | 0 |

## 单样本 unsupported

| sampleId | unsupported |
|---|---:|
| community-login-001 | 9.1% |
| community-mobile-001 | 29.5% |
| community-dashboard-001 | 35.3% |
| community-ecommerce-001 | 42.4% |
| community-landing-001 | 68.9% |
| community-design-system-001 | 20.6% |

## 判断

当前 M5.1 Coverage Engine 对文本和图片填充已有基本可用能力，但对 vector、组合图标、装饰形状和 landing page 大面积视觉层覆盖不足。下一阶段应优先做通用 Coverage Engine v2，而不是继续针对单页调视觉阈值。

建议 M5.2 coverage 门槛：

- unsupported < 20%
- vectorRendered > 60%
- imageFillRendered >= 95%
- textRendered >= 97%
- unmapped = 0

## 本地证据

- `tests/fixtures/figma/community-sample-manifest.json`
- `reports/community-corpus/20260726-rest-access-probe.json`
- `reports/community-corpus/20260726-m5-coverage-index.json`
- `reports/community-corpus/20260726-m5-coverage-summary.json`
- `reports/community-corpus/20260726-m5-coverage-summary.md`

上述报告已扫描确认不包含 Figma token、`fuid` 或临时 URL query 参数。
