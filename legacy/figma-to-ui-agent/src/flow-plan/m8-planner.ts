import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import { uiSpecDraftSchema } from "../ui-spec/schema.ts";
import type {
  FlowPlan,
  FlowPlanDraft,
  FlowPlanInteraction,
} from "./schema.ts";
import type { ApplyFlowPlanOptions } from "./to-ui-spec.ts";
import { applyFlowPlanToUISpec } from "./to-ui-spec.ts";
import type { FlowM8BehaviorScenario } from "./m8-scenario.ts";

export interface FlowM8ConvertedAction {
  readonly interactionId: string;
  readonly actionId: string;
  readonly intent: FlowPlanInteraction["intent"];
  readonly trusted: true;
  readonly source: FlowPlanInteraction["source"];
}

export interface FlowM8BehaviorFixtureSummary {
  readonly fixtureId: string;
  readonly source: "flow_plan" | "scenario";
  readonly intent?: FlowPlanInteraction["intent"];
  readonly submit?: boolean;
  readonly stateMachineTransition?: boolean;
  readonly selectRadioAssertionCount?: number;
}

export interface FlowM8PlannerResult {
  readonly uiSpec: UISpecDraft;
  readonly convertedActions: FlowM8ConvertedAction[];
  readonly rejectedInteractions: FlowPlanInteraction[];
  readonly behaviorFixtures: FlowM8BehaviorFixtureSummary[];
  readonly scenarioOnlyFixtureIds: string[];
  readonly trustedSubmitConvertedCount: number;
  readonly userConfirmedConvertedCount: number;
  readonly stateMachineTransitionCount: number;
  readonly selectRadioAssertionCount: number;
  readonly unresolvedCount: number;
  readonly reasons: string[];
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

function requireUniqueScenarioFixtureIds(
  uiSpec: UISpecDraft,
  scenario: FlowM8BehaviorScenario | undefined,
): void {
  if (!scenario) {
    return;
  }
  const existing = new Set(uiSpec.behaviorFixtures.map((fixture) => fixture.id));
  const duplicate = scenario.fixtures.find((fixture) => existing.has(fixture.id));
  if (duplicate) {
    throw new Error(`flow_m8_duplicate_scenario_fixture:${duplicate.id}`);
  }
}

function selectRadioAssertionCount(
  steps: UISpecDraft["behaviorFixtures"][number]["steps"],
): number {
  return steps.filter(
    (step) =>
      step.kind === "select_option" ||
      step.kind === "choose_radio" ||
      step.kind === "expect_selected",
  ).length;
}

export function applyFlowM8FormSubmitStateMachineToUISpec(
  uiSpec: UISpec | UISpecDraft,
  flowPlan: FlowPlan | FlowPlanDraft,
  scenario?: FlowM8BehaviorScenario,
  options: ApplyFlowPlanOptions = {},
): FlowM8PlannerResult {
  const conversion = applyFlowPlanToUISpec(uiSpec, flowPlan, options);
  requireUniqueScenarioFixtureIds(conversion.uiSpec, scenario);

  const convertedActions: FlowM8ConvertedAction[] = [];
  for (const actionId of conversion.convertedActionIds) {
    const action = conversion.uiSpec.actions.find(
      (candidate) => candidate.id === actionId,
    );
    const interaction = flowPlan.interactions.find((candidate) =>
      actionIdMatchesInteraction(actionId, candidate.id),
    );
    if (!action || !interaction) {
      continue;
    }
    convertedActions.push({
      actionId,
      interactionId: interaction.id,
      intent: action.kind,
      trusted: true,
      source: interaction.source,
    });
  }

  const transitionIds = new Set(
    flowPlan.stateMachines.flatMap((machine) =>
      machine.transitions.map((transition) => transition.id),
    ),
  );
  const convertedInteractionIds = new Set(
    convertedActions.map((action) => action.interactionId),
  );
  const convertedTransitionIds = new Set(
    flowPlan.interactions
      .filter(
        (interaction) =>
          interaction.stateMachineTransitionId &&
          transitionIds.has(interaction.stateMachineTransitionId) &&
          convertedInteractionIds.has(interaction.id),
      )
      .map((interaction) => interaction.stateMachineTransitionId!),
  );
  const fixtureByActionId = new Map<string, UISpecDraft["behaviorFixtures"][number]>();
  for (const fixture of conversion.uiSpec.behaviorFixtures) {
    const actionId = fixture.id.endsWith("-fixture")
      ? fixture.id.slice(0, -"fixture".length - 1)
      : undefined;
    if (actionId) {
      fixtureByActionId.set(actionId, fixture);
    }
  }
  const behaviorFixtures: FlowM8BehaviorFixtureSummary[] = convertedActions.map(
    (action) => {
      const fixture = fixtureByActionId.get(action.actionId);
      const interaction = flowPlan.interactions.find(
        (candidate) => candidate.id === action.interactionId,
      );
      return {
        fixtureId: fixture?.id ?? `${action.actionId}-fixture`.slice(0, 256),
        source: "flow_plan",
        intent: action.intent,
        submit: action.intent === "submit",
        stateMachineTransition: Boolean(
          interaction?.stateMachineTransitionId &&
            convertedTransitionIds.has(interaction.stateMachineTransitionId),
        ),
        selectRadioAssertionCount: fixture
          ? selectRadioAssertionCount(fixture.steps)
          : 0,
      };
    },
  );
  const scenarioFixtureSummaries = (scenario?.fixtures ?? []).map(
    (fixture) =>
      ({
        fixtureId: fixture.id,
        source: "scenario",
        selectRadioAssertionCount: selectRadioAssertionCount(fixture.steps),
      }) satisfies FlowM8BehaviorFixtureSummary,
  );
  behaviorFixtures.unshift(...scenarioFixtureSummaries);

  const trustedSubmitConvertedCount = convertedActions.filter(
    (action) => action.intent === "submit",
  ).length;
  const userConfirmedConvertedCount = convertedActions.filter(
    (action) => action.source === "user_confirmed",
  ).length;
  const selectRadioAssertions = behaviorFixtures.reduce(
    (sum, fixture) => sum + (fixture.selectRadioAssertionCount ?? 0),
    0,
  );
  const reasons: string[] = [];
  if (
    trustedSubmitConvertedCount < 1 &&
    convertedTransitionIds.size < 2 &&
    (scenario?.fixtures.length ?? 0) > 0
  ) {
    reasons.push("flow_m8_scenario_only_not_sufficient");
  }

  return {
    uiSpec: uiSpecDraftSchema.parse({
      ...conversion.uiSpec,
      behaviorFixtures: [
        ...(scenario?.fixtures ?? []),
        ...conversion.uiSpec.behaviorFixtures,
      ],
    }),
    convertedActions,
    rejectedInteractions:
      conversion.unresolvedInteractions as FlowPlanInteraction[],
    behaviorFixtures,
    scenarioOnlyFixtureIds:
      scenario?.fixtures.map((fixture) => fixture.id) ?? [],
    trustedSubmitConvertedCount,
    userConfirmedConvertedCount,
    stateMachineTransitionCount: convertedTransitionIds.size,
    selectRadioAssertionCount: selectRadioAssertions,
    unresolvedCount: conversion.unresolvedInteractions.length,
    reasons,
  };
}
