# Flow-M9 restricted-live interaction extraction 报告

- runId：20260809t0621
- status：passed
- mode：restricted-live
- figmaRestCalled：true
- sampleCount：3
- readableSamples：3
- trustedNavigate：65
- trustedStateChange：12
- submitLikeNeedsConfirmation：104
- unsupported：1
- missingEvidence：1
- notAccessible：0

## Samples

- community-mobile-001：readable，trusted=12，needsConfirmation=0，missing=0
- community-login-001：readable，trusted=0，needsConfirmation=3，missing=1
- reaction-cake-ordering-home-navigate-001：readable，trusted=65，needsConfirmation=101，missing=0

## Reasons

- 无

## 残留风险

- Flow-M9 只证明 interaction 抽取与分类；submit-like 业务语义仍需 Flow-M10 用户确认。
- restricted-live 样本权限和 Community 文件结构可能随时间变化。
