# Flow-M9 restricted-live interaction extraction 报告

- runId：20260809t0604
- status：passed
- mode：restricted-live
- figmaRestCalled：true
- sampleCount：3
- readableSamples：3
- trustedNavigate：36
- trustedStateChange：5
- submitLikeNeedsConfirmation：51
- unsupported：5
- missingEvidence：15
- notAccessible：0

## Samples

- community-mobile-001：readable，trusted=5，needsConfirmation=0，missing=0
- community-login-001：readable，trusted=0，needsConfirmation=3，missing=1
- reaction-cake-ordering-home-navigate-001：readable，trusted=36，needsConfirmation=48，missing=14

## Reasons

- 无

## 残留风险

- Flow-M9 只证明 interaction 抽取与分类；submit-like 业务语义仍需 Flow-M10 用户确认。
- restricted-live 样本权限和 Community 文件结构可能随时间变化。
