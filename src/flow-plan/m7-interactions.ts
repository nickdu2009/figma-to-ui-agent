import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import { uiSpecDraftSchema } from "../ui-spec/schema.ts";
import type {
  FlowPlan,
  FlowPlanDraft,
  FlowPlanInteraction,
} from "./schema.ts";
import type { ApplyFlowPlanOptions } from "./to-ui-spec.ts";
import { applyFlowPlanToUISpec } from "./to-ui-spec.ts";
import type { FlowM7BehaviorScenario } from "./m7-scenario.ts";

export interface FlowM7ConvertedAction {
  readonly interactionId: string;
  readonly actionId: string;
  readonly intent: FlowPlanInteraction["intent"];
  readonly trusted: true;
}

export interface FlowM7BehaviorFixtureSummary {
  readonly fixtureId: string;
  readonly source: "flow_plan" | "scenario";
  readonly intent?: FlowPlanInteraction["intent"];
  readonly submitLike?: boolean;
}

export interface FlowM7InteractiveBehaviorResult {
  readonly uiSpec: UISpecDraft;
  readonly convertedActions: FlowM7ConvertedAction[];
  readonly rejectedInteractions: FlowPlanInteraction[];
  readonly behaviorFixtures: FlowM7BehaviorFixtureSummary[];
  readonly scenarioOnlyFixtureIds: string[];
  readonly submitLikeExpectationFixtureIds: string[];
  readonly trustedNonRouteConvertedCount: number;
  readonly unresolvedCount: number;
  readonly reasons: string[];
}

function isTrustedNonRoute(interaction: FlowPlanInteraction): boolean {
  return (
    interaction.confirmed &&
    interaction.intent !== "navigate" &&
    (interaction.source === "figma" ||
      interaction.source === "user_confirmed")
  );
}

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220) || "flow";
}

function actionIdMatchesInteraction(
  actionId: string,
  interactionId: string,
): boolean {
  const base = `flow-${safeId(interactionId)}`;
  return actionId === base || actionId.startsWith(`${base}-`);
}

function actionIntent(
  uiSpec: UISpecDraft,
  actionId: string,
): FlowPlanInteraction["intent"] | undefined {
  return uiSpec.actions.find((action) => action.id === actionId)?.kind;
}

function requireUniqueScenarioFixtureIds(
  uiSpec: UISpecDraft,
  scenario: FlowM7BehaviorScenario | undefined,
): void {
  if (!scenario) {
    return;
  }
  const existing = new Set(uiSpec.behaviorFixtures.map((fixture) => fixture.id));
  const duplicate = scenario.fixtures.find((fixture) => existing.has(fixture.id));
  if (duplicate) {
    throw new Error(`flow_m7_duplicate_scenario_fixture:${duplicate.id}`);
  }
}

function validateSubmitLikePostconditions(
  uiSpec: UISpecDraft,
  scenario: FlowM7BehaviorScenario | undefined,
): void {
  if (!scenario) {
    return;
  }
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  for (const expectation of scenario.submitLikeExpectations) {
    const fixture = scenario.fixtures.find(
      (candidate) => candidate.id === expectation.fixtureId,
    );
    if (!fixture) {
      continue;
    }
    const clickIndex = fixture.steps.findIndex(
      (step) =>
        step.kind === "click" && step.nodeId === expectation.clickNodeId,
    );
    const postcondition = fixture.steps
      .slice(clickIndex + 1)
      .find((step) =>
        step.kind === "expect_page" ||
        step.kind === "expect_visible" ||
        step.kind === "expect_text" ||
        step.kind === "expect_value" ||
        step.kind === "expect_checked",
      );
    if (!postcondition || !("nodeId" in postcondition)) {
      continue;
    }
    const target = nodeById.get(postcondition.nodeId);
    const staticVisible =
      postcondition.kind === "expect_visible" && target?.kind !== "dialog";
    const staticText =
      postcondition.kind === "expect_text" &&
      (target?.kind === "text" ||
        target?.kind === "button" ||
        target?.kind === "badge" ||
        target?.kind === "link");
    if (staticVisible || staticText) {
      throw new Error(
        `flow_m7_submit_static_expectation:${expectation.fixtureId}`,
      );
    }
  }
}

export function applyFlowM7InteractiveBehaviorToUISpec(
  uiSpec: UISpec | UISpecDraft,
  flowPlan: FlowPlan | FlowPlanDraft,
  scenario?: FlowM7BehaviorScenario,
  options: ApplyFlowPlanOptions = {},
): FlowM7InteractiveBehaviorResult {
  const conversion = applyFlowPlanToUISpec(uiSpec, flowPlan, options);
  requireUniqueScenarioFixtureIds(conversion.uiSpec, scenario);
  validateSubmitLikePostconditions(conversion.uiSpec, scenario);

  const convertedActions: FlowM7ConvertedAction[] = [];
  for (const actionId of conversion.convertedActionIds) {
    const action = conversion.uiSpec.actions.find(
      (candidate) => candidate.id === actionId,
    );
    const interaction = flowPlan.interactions.find(
      (candidate) => actionIdMatchesInteraction(actionId, candidate.id),
    );
    if (!action || !interaction) {
      continue;
    }
    convertedActions.push({
      actionId,
      interactionId: interaction.id,
      intent: action.kind,
      trusted: true,
    });
  }
  const submitLikeExpectationFixtureIds =
    scenario?.submitLikeExpectations.map(
      (expectation) => expectation.fixtureId,
    ) ?? [];
  const submitLikeConvertedActionIds = new Set(
    scenario?.submitLikeExpectations
      .map((expectation) => expectation.convertedActionId)
      .filter((actionId): actionId is string => Boolean(actionId)) ?? [],
  );

  const flowFixtureByActionId = new Map<string, string>();
  for (const actionId of conversion.convertedActionIds) {
    flowFixtureByActionId.set(actionId, `${actionId}-fixture`.slice(0, 256));
  }
  const behaviorFixtures: FlowM7BehaviorFixtureSummary[] = convertedActions
    .filter((action) => !submitLikeConvertedActionIds.has(action.actionId))
    .map((action) => ({
      fixtureId:
        flowFixtureByActionId.get(action.actionId) ?? `${action.actionId}-fixture`,
      source: "flow_plan",
      intent: action.intent,
    }));
  const filteredFlowFixtures = conversion.uiSpec.behaviorFixtures.filter(
    (fixture) =>
      ![...submitLikeConvertedActionIds].some(
        (actionId) => fixture.id === `${actionId}-fixture`.slice(0, 256),
      ),
  );

  const next: UISpecDraft = {
    ...conversion.uiSpec,
    behaviorFixtures: [
      ...(scenario?.fixtures ?? []),
      ...filteredFlowFixtures,
    ],
  };
  const submitLikeFixtureSet = new Set(submitLikeExpectationFixtureIds);
  const convertedActionIds = new Set(
    convertedActions.map((action) => action.actionId),
  );
  scenario?.submitLikeExpectations.forEach((expectation) => {
    if (
      expectation.convertedActionId &&
      !convertedActionIds.has(expectation.convertedActionId)
    ) {
      throw new Error(
        `flow_m7_submit_action_not_converted:${expectation.convertedActionId}`,
      );
    }
  });
  const scenarioFixtureSummaries = (scenario?.fixtures ?? []).map(
    (fixture) =>
      ({
      fixtureId: fixture.id,
      source: "scenario",
      submitLike: submitLikeFixtureSet.has(fixture.id),
      }) satisfies FlowM7BehaviorFixtureSummary,
  );
  behaviorFixtures.unshift(...scenarioFixtureSummaries);

  const trustedNonRouteConvertedCount = flowPlan.interactions.filter(
    (interaction) =>
      isTrustedNonRoute(interaction) &&
      convertedActions.some(
        (action) =>
          action.interactionId === interaction.id &&
          actionIntent(next, action.actionId) !== "navigate",
      ),
  ).length;
  const reasons: string[] = [];
  if (
    trustedNonRouteConvertedCount < 1 &&
    (scenario?.fixtures.length ?? 0) > 0
  ) {
    reasons.push("flow_m7_scenario_only_not_sufficient");
  }

  return {
    uiSpec: uiSpecDraftSchema.parse(next),
    convertedActions,
    rejectedInteractions:
      conversion.unresolvedInteractions as FlowPlanInteraction[],
    behaviorFixtures,
    scenarioOnlyFixtureIds:
      scenario?.fixtures.map((fixture) => fixture.id) ?? [],
    submitLikeExpectationFixtureIds,
    trustedNonRouteConvertedCount,
    unresolvedCount: conversion.unresolvedInteractions.length,
    reasons,
  };
}
