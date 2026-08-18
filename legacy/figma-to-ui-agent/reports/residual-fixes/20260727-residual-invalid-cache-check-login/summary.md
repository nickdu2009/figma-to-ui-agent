# M5 静态生成报告

- runId: 20260727-residual-invalid-cache-check-login
- projectId: login-ui-concept-perceptual-20260724a
- designBundleRevision: 1
- uiSpecRevision: 未保存
- status: failed
- scope: static_generation_only
- behaviorFlowVerified: false
- m4ValidationStatus: pending

## 页面摘要

## 覆盖率摘要

- sourceNodeCount: 0
- visibleNodeCount: 0
- unsupportedCount: 0
- unmappedCount: 0

### unsupported 诊断

- byReason: {}
- byKind: {}



## Warnings

- **page_dimensions_missing**: 页面 0:1 缺少有效尺寸，跳过
- **no_renderable_pages**: DesignBundle 中没有可渲染页面

## 残留风险

- M5 仅验证静态页面生成，行为 Flow 未验证（M6/M7）。
- 图标按钮缺少真实业务 action，仅保留静态语义。
- 复杂 vector/decorative 层无可用资产时仅记录 unsupportedFeature。
