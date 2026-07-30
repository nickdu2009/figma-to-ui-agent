import type {
  FlowM7InteractiveBehaviorReport,
  FlowM7ValidationSummary,
} from "./m7-report.ts";
import { parseFlowM7InteractiveBehaviorReport } from "./m7-report.ts";
import type { FlowM7InteractiveBehaviorResult } from "./m7-interactions.ts";

export interface FlowM7ReportInput {
  readonly projectId: string;
  readonly runId: string;
  readonly flowPlanPath: string;
  readonly uiSpecRevision?: number;
  readonly flowPlanRevision?: number;
  readonly savedUISpecRevision?: number;
  readonly figmaInteractionSource?: "present" | "absent" | "unavailable" | "not_authorized";
  readonly conversion: FlowM7InteractiveBehaviorResult;
  readonly validation?: FlowM7ValidationSummary;
}

function reportStatus(
  input: FlowM7ReportInput,
): FlowM7InteractiveBehaviorReport["status"] {
  if (input.validation && !input.validation.passed) {
    return "failed";
  }
  const successfulFixtureIds = new Set(
    input.validation?.successfulFixtureIds ?? [],
  );
  const hasSuccessfulNonRouteFixture = input.conversion.behaviorFixtures.some(
    (fixture) =>
      fixture.source === "flow_plan" &&
      fixture.intent !== "navigate" &&
      successfulFixtureIds.has(fixture.fixtureId),
  );
  if (
    input.conversion.trustedNonRouteConvertedCount >= 1 &&
    input.validation?.passed === true &&
    hasSuccessfulNonRouteFixture
  ) {
    return "passed";
  }
  return "partial";
}

function reportReasons(input: FlowM7ReportInput): string[] {
  const reasons = new Set(input.conversion.reasons);
  if (input.conversion.trustedNonRouteConvertedCount < 1) {
    reasons.add("flow_m7_no_trusted_non_route_interaction");
  }
  if (!input.validation) {
    reasons.add("flow_m7_behavior_validation_missing");
  } else if (!input.validation.passed) {
    reasons.add("flow_m7_behavior_validation_failed");
  }
  if (
    input.conversion.submitLikeExpectationFixtureIds.length > 0 &&
    input.conversion.submitLikeExpectationFixtureIds.every(
      (fixtureId) => !input.validation?.successfulFixtureIds.includes(fixtureId),
    )
  ) {
    reasons.add("flow_m7_submit_expectation_missing");
  }
  return [...reasons];
}

export function buildFlowM7InteractiveBehaviorReport(
  input: FlowM7ReportInput,
): FlowM7InteractiveBehaviorReport {
  const submitLikeVerified =
    input.validation?.successfulFixtureIds.filter((fixtureId) =>
      input.conversion.submitLikeExpectationFixtureIds.includes(fixtureId),
    ).length ?? 0;
  return parseFlowM7InteractiveBehaviorReport({
    schemaVersion: "1",
    milestone: "Flow-M7",
    scope: "interactive_behavior",
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
      trustedNonRouteConverted:
        input.conversion.trustedNonRouteConvertedCount,
      scenarioOnlyFixtures: input.conversion.scenarioOnlyFixtureIds.length,
      submitLikeVerified,
      unresolved: input.conversion.unresolvedCount,
    },
    validation: input.validation,
    reasons: reportReasons(input),
    residualRisks: [
      "Flow-M7 v1 不新增 submit action kind；复杂业务状态机、select/radio 完整选择语义和真实后端仍不在本期范围。",
      "restricted-live 只读取 Figma REST 且不调用 OpenAI；非点击控件或无法映射到 UISpec 可点击节点的 Figma interaction 仍会保持 rejected。",
    ],
  });
}
