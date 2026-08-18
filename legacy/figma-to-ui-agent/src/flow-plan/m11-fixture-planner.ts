import type { UISpec, UISpecDraft } from "../ui-spec/schema.ts";
import { uiSpecDraftSchema } from "../ui-spec/schema.ts";
import type { ApplyFlowPlanOptions } from "./to-ui-spec.ts";
import { applyFlowPlanToUISpec } from "./to-ui-spec.ts";
import type {
  FlowM11ArtifactLoadResult,
  FlowM11ArtifactRejection,
} from "./m11-artifact-loader.ts";
import type {
  FlowM11BehaviorFixture,
  FlowM11BehaviorStep,
} from "./m11-fixture-schema.ts";
import type { FlowPlanInteraction } from "./schema.ts";

export interface FlowM11FixtureSummary {
  readonly fixtureId: string;
  readonly interactionId: string;
  readonly intent: FlowPlanInteraction["intent"];
  readonly source: FlowPlanInteraction["source"];
  readonly submit: boolean;
  readonly inputStepCount: number;
  readonly selectRadioToggleStepCount: number;
  readonly postconditionStepCount: number;
}

export interface FlowM11PlannerResult {
  readonly status: "planned" | "partial" | "failed";
  readonly uiSpec: UISpecDraft;
  readonly behaviorFixtures: FlowM11FixtureSummary[];
  readonly executableFixtureIds: string[];
  readonly rejectedInteractions: FlowPlanInteraction[];
  readonly artifactRejections: FlowM11ArtifactRejection[];
  readonly unresolvedCount: number;
  readonly trustedSubmitFixtureCount: number;
  readonly multiStepSubmitFixtureCount: number;
  readonly selectRadioToggleStepCount: number;
  readonly reasons: string[];
}

interface PlanFlowM11BehaviorFixturesInput {
  readonly artifact: FlowM11ArtifactLoadResult;
  readonly uiSpec: UISpec | UISpecDraft;
  readonly fieldValues?: Readonly<Record<string, string | boolean>>;
  readonly options?: ApplyFlowPlanOptions;
}

function draftFromSpec(uiSpec: UISpec | UISpecDraft): UISpecDraft {
  const cloned = structuredClone(uiSpec) as UISpec | UISpecDraft;
  if ("revision" in cloned) {
    const { revision: _revision, ...draft } = cloned;
    return draft;
  }
  return cloned;
}

function safeId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 220) || "flow"
  );
}

function actionIdMatchesInteraction(
  actionId: string,
  interactionId: string,
): boolean {
  const base = `flow-${safeId(interactionId)}`;
  return actionId === base || actionId.startsWith(`${base}-`);
}

function childIdsForNode(node: UISpecDraft["nodes"][number]): string[] {
  const direct = "childIds" in node ? node.childIds : [];
  const tabs =
    node.kind === "tabs"
      ? node.tabs.flatMap((tab) => tab.childIds)
      : [];
  return [...direct, ...tabs];
}

function nodePageMap(uiSpec: UISpecDraft): Map<string, string> {
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const result = new Map<string, string>();
  const visit = (nodeId: string, pageId: string): void => {
    if (result.has(nodeId)) {
      return;
    }
    result.set(nodeId, pageId);
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }
    for (const childId of childIdsForNode(node)) {
      visit(childId, pageId);
    }
  };
  for (const page of uiSpec.pages) {
    visit(page.rootNodeId, page.id);
  }
  return result;
}

function isDisabled(node: UISpecDraft["nodes"][number]): boolean {
  return "disabled" in node && node.disabled === true;
}

function valueForInput(
  node: Extract<UISpecDraft["nodes"][number], { kind: "input" | "textarea" }>,
  fieldValues: Readonly<Record<string, string | boolean>> | undefined,
): string {
  const explicit = fieldValues?.[node.stateKey];
  if (typeof explicit === "string") {
    return explicit;
  }
  if (node.kind === "textarea") {
    return "Flow M11 note";
  }
  if (node.inputType === "email") {
    return "flow-m11@example.com";
  }
  if (node.inputType === "password") {
    return "FlowM11-pass1";
  }
  if (node.inputType === "search") {
    return "Flow M11 search";
  }
  return "Flow M11 value";
}

function valueForBooleanControl(
  node: Extract<UISpecDraft["nodes"][number], { kind: "checkbox" | "switch" }>,
  fieldValues: Readonly<Record<string, string | boolean>> | undefined,
): boolean {
  const explicit = fieldValues?.[node.stateKey];
  return typeof explicit === "boolean" ? explicit : true;
}

function buildSubmitPreparationSteps(
  uiSpec: UISpecDraft,
  fixture: FlowM11BehaviorFixture,
  fieldValues: Readonly<Record<string, string | boolean>> | undefined,
): FlowM11BehaviorStep[] {
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const pageByNodeId = nodePageMap(uiSpec);
  const firstStep = fixture.steps[0];
  const actionPageId =
    firstStep && "nodeId" in firstStep
      ? pageByNodeId.get(firstStep.nodeId)
      : undefined;
  const pageId = actionPageId ?? fixture.initialPageId;
  const steps: FlowM11BehaviorStep[] = [];
  const seenStateKeys = new Set<string>();

  for (const node of uiSpec.nodes) {
    if (pageByNodeId.get(node.id) !== pageId || isDisabled(node)) {
      continue;
    }
    if (node.kind === "input" || node.kind === "textarea") {
      if (seenStateKeys.has(node.stateKey)) {
        continue;
      }
      seenStateKeys.add(node.stateKey);
      const value = valueForInput(node, fieldValues);
      steps.push({ kind: "fill", nodeId: node.id, value });
      steps.push({ kind: "expect_value", nodeId: node.id, value });
      continue;
    }
    if (node.kind === "select") {
      if (seenStateKeys.has(node.stateKey)) {
        continue;
      }
      seenStateKeys.add(node.stateKey);
      const explicit = fieldValues?.[node.stateKey];
      const value =
        typeof explicit === "string" && explicit.length > 0
          ? explicit
          : node.options[0]!.value;
      steps.push({ kind: "select_option", nodeId: node.id, value });
      steps.push({ kind: "expect_selected", nodeId: node.id, value });
      continue;
    }
    if (node.kind === "radio") {
      if (seenStateKeys.has(node.stateKey)) {
        continue;
      }
      seenStateKeys.add(node.stateKey);
      const explicit = fieldValues?.[node.stateKey];
      const value =
        typeof explicit === "string" && explicit.length > 0
          ? explicit
          : node.value;
      steps.push({ kind: "choose_radio", nodeId: node.id, value });
      steps.push({ kind: "expect_selected", nodeId: node.id, value });
      continue;
    }
    if (node.kind === "checkbox" || node.kind === "switch") {
      if (seenStateKeys.has(node.stateKey)) {
        continue;
      }
      seenStateKeys.add(node.stateKey);
      const checked = valueForBooleanControl(node, fieldValues);
      const state = uiSpec.state.find((item) => item.key === node.stateKey);
      if (state?.initialValue !== checked) {
        steps.push({ kind: "toggle", nodeId: node.id });
      }
      steps.push({ kind: "expect_checked", nodeId: node.id, checked });
    }
  }

  return steps.filter((step) => {
    if (!("nodeId" in step)) {
      return true;
    }
    return nodeById.has(step.nodeId);
  });
}

function postconditionStepCount(
  fixture: FlowM11BehaviorFixture,
): number {
  return fixture.steps.filter((step) =>
    step.kind.startsWith("expect_"),
  ).length;
}

function selectRadioToggleStepCount(
  fixture: FlowM11BehaviorFixture,
): number {
  return fixture.steps.filter(
    (step) =>
      step.kind === "select_option" ||
      step.kind === "choose_radio" ||
      step.kind === "toggle",
  ).length;
}

function inputStepCount(fixture: FlowM11BehaviorFixture): number {
  return fixture.steps.filter((step) => step.kind === "fill").length;
}

function emptyFailureResult(
  input: PlanFlowM11BehaviorFixturesInput,
  reason: string,
): FlowM11PlannerResult {
  return {
    status: "failed",
    uiSpec: draftFromSpec(input.uiSpec),
    behaviorFixtures: [],
    executableFixtureIds: [],
    rejectedInteractions: [],
    artifactRejections: input.artifact.rejections,
    unresolvedCount: 0,
    trustedSubmitFixtureCount: 0,
    multiStepSubmitFixtureCount: 0,
    selectRadioToggleStepCount: 0,
    reasons: [reason],
  };
}

export function planFlowM11BehaviorFixtures(
  input: PlanFlowM11BehaviorFixturesInput,
): FlowM11PlannerResult {
  if (input.artifact.status === "rejected") {
    return emptyFailureResult(input, "flow_m11_artifact_rejected");
  }

  const conversion = applyFlowPlanToUISpec(
    input.uiSpec,
    input.artifact.flowPlan,
    input.options,
  );
  const next = structuredClone(conversion.uiSpec);
  const fixtureByActionId = new Map<string, FlowM11BehaviorFixture>();
  for (const fixture of next.behaviorFixtures) {
    const actionId = fixture.id.endsWith("-fixture")
      ? fixture.id.slice(0, -"fixture".length - 1)
      : undefined;
    if (actionId) {
      fixtureByActionId.set(actionId, fixture);
    }
  }

  const summaries: FlowM11FixtureSummary[] = [];
  for (const actionId of conversion.convertedActionIds) {
    const action = next.actions.find((candidate) => candidate.id === actionId);
    const interaction = input.artifact.flowPlan.interactions.find((candidate) =>
      actionIdMatchesInteraction(actionId, candidate.id),
    );
    const fixture = fixtureByActionId.get(actionId);
    if (!action || !interaction || !fixture) {
      continue;
    }
    if (action.kind === "submit") {
      const originalSteps = [...fixture.steps];
      fixture.steps = [
        ...buildSubmitPreparationSteps(
          next,
          fixture,
          input.fieldValues,
        ),
        ...originalSteps,
      ];
    }
    summaries.push({
      fixtureId: fixture.id,
      interactionId: interaction.id,
      intent: interaction.intent,
      source: interaction.source,
      submit: action.kind === "submit",
      inputStepCount: inputStepCount(fixture),
      selectRadioToggleStepCount: selectRadioToggleStepCount(fixture),
      postconditionStepCount: postconditionStepCount(fixture),
    });
  }

  const executableFixtureIds = summaries.map((summary) => summary.fixtureId);
  const trustedSubmitFixtureCount = summaries.filter(
    (summary) => summary.submit,
  ).length;
  const multiStepSubmitFixtureCount = summaries.filter(
    (summary) => summary.submit && summary.inputStepCount > 0,
  ).length;
  const totalSelectRadioToggleStepCount = summaries.reduce(
    (sum, summary) => sum + summary.selectRadioToggleStepCount,
    0,
  );
  const reasons: string[] = [...input.artifact.reasonCodes];
  if (trustedSubmitFixtureCount === 0) {
    reasons.push("flow_m11_trusted_submit_fixture_missing");
  }
  if (multiStepSubmitFixtureCount === 0) {
    reasons.push("flow_m11_multistep_submit_fixture_missing");
  }
  if (totalSelectRadioToggleStepCount === 0) {
    reasons.push("flow_m11_select_radio_toggle_missing");
  }

  return {
    status: reasons.length === 0 ? "planned" : "partial",
    uiSpec: uiSpecDraftSchema.parse(next),
    behaviorFixtures: summaries,
    executableFixtureIds,
    rejectedInteractions:
      conversion.unresolvedInteractions as FlowPlanInteraction[],
    artifactRejections: input.artifact.rejections,
    unresolvedCount: conversion.unresolvedInteractions.length,
    trustedSubmitFixtureCount,
    multiStepSubmitFixtureCount,
    selectRadioToggleStepCount: totalSelectRadioToggleStepCount,
    reasons,
  };
}
