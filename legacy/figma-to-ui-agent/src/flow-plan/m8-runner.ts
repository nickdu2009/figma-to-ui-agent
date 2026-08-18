import type {
  FlowM8FormSubmitStateMachineReport,
  FlowM8ValidationSummary,
} from "./m8-report.ts";
import { parseFlowM8FormSubmitStateMachineReport } from "./m8-report.ts";
import type { FlowM8PlannerResult } from "./m8-planner.ts";

export interface FlowM8ReportInput {
  readonly projectId: string;
  readonly runId: string;
  readonly flowPlanPath: string;
  readonly uiSpecRevision?: number;
  readonly flowPlanRevision?: number;
  readonly savedUISpecRevision?: number;
  readonly figmaInteractionSource?: "present" | "absent" | "unavailable" | "not_authorized";
  readonly conversion: FlowM8PlannerResult;
  readonly validation?: FlowM8ValidationSummary;
}

function reportStatus(
  input: FlowM8ReportInput,
): FlowM8FormSubmitStateMachineReport["status"] {
  if (input.validation && !input.validation.passed) {
    return "failed";
  }
  const successful = new Set(input.validation?.successfulFixtureIds ?? []);
  const hasSuccessfulM8Fixture = input.conversion.behaviorFixtures.some(
    (fixture) =>
      fixture.source === "flow_plan" &&
      (fixture.submit || fixture.stateMachineTransition) &&
      successful.has(fixture.fixtureId),
  );
  if (
    input.validation?.passed === true &&
    hasSuccessfulM8Fixture &&
    (input.conversion.trustedSubmitConvertedCount >= 1 ||
      input.conversion.stateMachineTransitionCount >= 2)
  ) {
    return "passed";
  }
  return "partial";
}

function reportReasons(input: FlowM8ReportInput): string[] {
  const reasons = new Set(input.conversion.reasons);
  if (
    input.conversion.trustedSubmitConvertedCount < 1 &&
    input.conversion.stateMachineTransitionCount < 2
  ) {
    reasons.add("flow_m8_no_trusted_submit_or_two_transitions");
  }
  if (!input.validation) {
    reasons.add("flow_m8_behavior_validation_missing");
  } else if (!input.validation.passed) {
    reasons.add("flow_m8_behavior_validation_failed");
  }
  if (input.conversion.scenarioOnlyFixtureIds.length > 0) {
    reasons.add("flow_m8_scenario_used_as_fixture_input_only");
  }
  return [...reasons];
}

export function buildFlowM8FormSubmitStateMachineReport(
  input: FlowM8ReportInput,
): FlowM8FormSubmitStateMachineReport {
  return parseFlowM8FormSubmitStateMachineReport({
    schemaVersion: "1",
    milestone: "Flow-M8",
    scope: "form_submit_state_machine",
    status: reportStatus(input),
    input: {
      projectId: input.projectId,
      runId: input.runId,
      flowPlanPath: input.flowPlanPath,
      uiSpecRevision: input.uiSpecRevision,
      flowPlanRevision: input.flowPlanRevision,
      savedUISpecRevision: input.savedUISpecRevision,
      figmaInteractionSource: input.figmaInteractionSource,
    },
    actions: {
      converted: input.conversion.convertedActions,
      rejected: input.conversion.rejectedInteractions,
    },
    behaviors: {
      fixtures: input.conversion.behaviorFixtures,
    },
    counts: {
      trustedSubmitConverted:
        input.conversion.trustedSubmitConvertedCount,
      userConfirmedConverted:
        input.conversion.userConfirmedConvertedCount,
      stateMachineTransitions:
        input.conversion.stateMachineTransitionCount,
      selectRadioAssertions:
        input.conversion.selectRadioAssertionCount,
      scenarioOnlyFixtures: input.conversion.scenarioOnlyFixtureIds.length,
      unresolved: input.conversion.unresolvedCount,
    },
    validation: input.validation,
    reasons: reportReasons(input),
    residualRisks: [
      "Flow-M8 submit 只表示本地 UI effect 和 Playwright postcondition，不表示真实后端业务成功。",
      "默认本地验证不调用 Figma/OpenAI；restricted-live submit 样本仍需要后续单独 gate。",
    ],
  });
}
