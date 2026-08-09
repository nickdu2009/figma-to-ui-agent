# Flow-M9 restricted-live interaction extraction 报告

- runId：flow-m14-next-six-sample-extraction-20260809t2030
- status：passed
- mode：restricted-live
- figmaRestCalled：true
- sampleCount：6
- readableSamples：6
- trustedNavigate：0
- trustedStateChange：12
- submitLikeNeedsConfirmation：9
- unsupported：0
- missingEvidence：7
- notAccessible：0

## Samples

- community-login-001：readable，trusted=0，needsConfirmation=3，missing=1
- community-mobile-001：readable，trusted=12，needsConfirmation=0，missing=0
- community-dashboard-001：readable，trusted=0，needsConfirmation=0，missing=2
- community-ecommerce-001：readable，trusted=0，needsConfirmation=0，missing=2
- community-landing-001：readable，trusted=0，needsConfirmation=1，missing=1
- community-design-system-001：readable，trusted=0，needsConfirmation=5，missing=1

## Reasons

- 无

## 残留风险

- Flow-M9 只证明 interaction 抽取与分类；submit-like 业务语义仍需 Flow-M10 用户确认。
- restricted-live 样本权限和 Community 文件结构可能随时间变化。
