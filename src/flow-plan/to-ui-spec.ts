import type { FlowPlanDraft, FlowPlanInteraction } from "./draft.ts";
import {
  uiSpecDraftSchema,
  type UISpec,
  type UISpecDraft,
} from "../ui-spec/schema.ts";

export interface ApplyFlowPlanOptions {
  readonly viewportId?: string;
}

export interface ApplyFlowPlanResult {
  readonly uiSpec: UISpecDraft;
  readonly convertedActionIds: string[];
  readonly behaviorFixtureIds: string[];
  readonly unresolvedInteractions: FlowPlanInteraction[];
}

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220) || "flow";
}

function draftFromSpec(uiSpec: UISpec | UISpecDraft): UISpecDraft {
  const cloned = structuredClone(uiSpec) as UISpec | UISpecDraft;
  if ("revision" in cloned) {
    const { revision: _revision, ...draft } = cloned;
    return draft;
  }
  return cloned;
}

function existingActionIdFor(
  actionIds: Set<string>,
  interactionId: string,
): string {
  const base = `flow-${safeId(interactionId)}`.slice(0, 250);
  if (!actionIds.has(base)) {
    return base;
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base}-${index}`.slice(0, 256);
    if (!actionIds.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("flow_action_id_exhausted");
}

function scalarMatchesState(
  state: UISpecDraft["state"][number] | undefined,
  value: string | number | boolean | undefined,
): boolean {
  return Boolean(
    state &&
      value !== undefined &&
      typeof value === state.valueType,
  );
}

export function applyFlowPlanToUISpec(
  uiSpec: UISpec | UISpecDraft,
  draft: FlowPlanDraft,
  options: ApplyFlowPlanOptions = {},
): ApplyFlowPlanResult {
  const next = draftFromSpec(uiSpec);
  const nodeById = new Map(next.nodes.map((node) => [node.id, node]));
  const stateByKey = new Map(
    next.state.map((state) => [state.key, state]),
  );
  const actionIds = new Set(next.actions.map((action) => action.id));
  const convertedActionIds: string[] = [];
  const behaviorFixtureIds: string[] = [];
  const unresolvedInteractions: FlowPlanInteraction[] = [];
  const viewportId = options.viewportId ?? next.viewports[0]?.id;
  if (!viewportId) {
    throw new Error("flow_plan_viewport_missing");
  }

  for (const interaction of draft.interactions) {
    const trusted =
      interaction.confirmed &&
      (interaction.source === "figma" ||
        interaction.source === "user_confirmed") &&
      interaction.uiNodeId;
    if (!trusted) {
      if (
        interaction.source === "inferred" ||
        interaction.source === "missing" ||
        interaction.blockedReason
      ) {
        unresolvedInteractions.push(interaction);
      }
      continue;
    }
    const node = nodeById.get(interaction.uiNodeId!);
    if (!node || (node.kind !== "button" && node.kind !== "link")) {
      unresolvedInteractions.push({
        ...interaction,
        blockedReason: "ui_node_not_clickable",
      });
      continue;
    }
    if (interaction.intent === "navigate" && !interaction.targetPageId) {
      unresolvedInteractions.push({
        ...interaction,
        blockedReason: "target_page_missing",
      });
      continue;
    }
    if (
      interaction.intent === "set_state" &&
      (!scalarMatchesState(
        interaction.stateKey
          ? stateByKey.get(interaction.stateKey)
          : undefined,
        interaction.value,
      ) ||
        !interaction.targetNodeId ||
        !nodeById.has(interaction.targetNodeId))
    ) {
      unresolvedInteractions.push({
        ...interaction,
        blockedReason: "state_action_not_verifiable",
      });
      continue;
    }
    if (
      interaction.intent === "open_dialog" &&
      (!interaction.dialogNodeId ||
        nodeById.get(interaction.dialogNodeId)?.kind !== "dialog")
    ) {
      unresolvedInteractions.push({
        ...interaction,
        blockedReason: "dialog_action_not_verifiable",
      });
      continue;
    }
    if (
      interaction.intent !== "navigate" &&
      interaction.intent !== "set_state" &&
      interaction.intent !== "open_dialog"
    ) {
      unresolvedInteractions.push({
        ...interaction,
        blockedReason: "unsupported_flow_intent",
      });
      continue;
    }
    const actionId = existingActionIdFor(actionIds, interaction.id);
    actionIds.add(actionId);
    node.actionId = actionId;
    if (interaction.intent === "navigate") {
      next.actions.push({
        id: actionId,
        kind: "navigate",
        pageId: interaction.targetPageId!,
      });
    } else if (interaction.intent === "set_state") {
      next.actions.push({
        id: actionId,
        kind: "set_state",
        stateKey: interaction.stateKey!,
        value: interaction.value!,
      });
    } else {
      next.actions.push({
        id: actionId,
        kind: "open_dialog",
        dialogNodeId: interaction.dialogNodeId!,
      });
    }
    const fixtureId = `${actionId}-fixture`.slice(0, 256);
    const fixtureSteps =
      interaction.intent === "navigate"
        ? [
            { kind: "click" as const, nodeId: node.id },
            { kind: "expect_page" as const, pageId: interaction.targetPageId! },
          ]
        : interaction.intent === "open_dialog"
          ? [
              { kind: "click" as const, nodeId: node.id },
              {
                kind: "expect_visible" as const,
                nodeId: interaction.dialogNodeId!,
              },
            ]
          : [
              { kind: "click" as const, nodeId: node.id },
              {
                kind: "expect_visible" as const,
                nodeId: interaction.targetNodeId!,
              },
            ];
    next.behaviorFixtures.push({
      id: fixtureId,
      name: `Flow: ${node.label} -> ${
        interaction.intent === "navigate"
          ? next.pages.find((page) => page.id === interaction.targetPageId)
              ?.title ?? interaction.targetPageId
          : interaction.intent
      }`,
      viewportId,
      initialPageId:
        interaction.fromPageId ??
        next.pages.find((page) => page.rootNodeId === node.id)?.id ??
        next.pages[0]!.id,
      steps: fixtureSteps,
    });
    convertedActionIds.push(actionId);
    behaviorFixtureIds.push(fixtureId);
  }

  return {
    uiSpec: uiSpecDraftSchema.parse(next),
    convertedActionIds,
    behaviorFixtureIds,
    unresolvedInteractions,
  };
}
