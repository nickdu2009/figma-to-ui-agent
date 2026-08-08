# Flow-M12 corpus/regression 报告

- runId：flow-m12-corpus-20260808-r2
- status：partial
- sampleCount：5
- executableSampleCount：2
- passedExecutableSampleCount：1
- partialExecutableSampleCount：1
- failedExecutableSampleCount：0
- notExecutableSampleCount：3
- restrictedLiveSummarySampleCount：3

## Coverage

- navigate：true
- setState：true
- submit：true
- stateMachine：true
- selectRadioCheckbox：true
- restrictedLiveSummary：true

## Samples

- local-m11-submit-state-machine：passed，source=local_fixture，reasons=flow_plan_untrusted_source
- restricted-live-fitness-set-state：partial，source=restricted_live_artifact，reasons=flow_plan_untrusted_source, flow_m11_trusted_submit_fixture_missing, flow_m11_multistep_submit_fixture_missing, flow_m11_select_radio_toggle_missing
- community-mobile-001：not_executable，source=restricted_live_summary，reasons=flow_plan_artifact_missing
- community-design-system-001：not_executable，source=restricted_live_summary，reasons=flow_plan_artifact_missing
- community-login-001：not_executable，source=restricted_live_summary，reasons=flow_plan_artifact_missing

## Reasons

- flow_m12_real_flowplan_artifacts_missing

## Residual Risks

- Flow-M12 corpus runner 只执行本地已有 artifact，不调用 Figma/OpenAI；restricted-live summary 样本只能证明真实 provenance，不能替代 M11 可执行 artifact。
