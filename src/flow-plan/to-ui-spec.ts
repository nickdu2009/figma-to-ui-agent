import type {
  FlowPlanDraft as LegacyFlowPlanDraft,
  FlowPlanInteraction as LegacyFlowPlanInteraction,
} from "./draft.ts";
import type {
  FlowPlan,
  FlowPlanDraft,
  FlowPlanInteraction,
} from "./schema.ts";
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
  readonly unresolvedInteractions: Array<
    FlowPlanInteraction | LegacyFlowPlanInteraction
  >;
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

function isActionAttachableNode(
  node: UISpecDraft["nodes"][number] | undefined,
): node is Extract<
  UISpecDraft["nodes"][number],
  {
    kind:
      | "button"
      | "link"
      | "checkbox"
      | "radio"
      | "switch"
      | "stack";
  }
> {
  return (
    node?.kind === "button" ||
    node?.kind === "link" ||
    node?.kind === "checkbox" ||
    node?.kind === "radio" ||
    node?.kind === "switch" ||
    node?.kind === "stack"
  );
}

function actionNodeLabel(node: UISpecDraft["nodes"][number]): string {
  if ("label" in node) {
    return node.label;
  }
  return node.id;
}

function valueTypeFor(
  value: string | number | boolean,
): UISpecDraft["state"][number]["valueType"] {
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "number") {
    return "number";
  }
  return "boolean";
}

function interactionStateInitialValue(
  interaction: FlowPlanInteraction | LegacyFlowPlanInteraction,
): string | number | boolean | undefined {
  return "stateInitialValue" in interaction
    ? interaction.stateInitialValue
    : undefined;
}

function ensureStateEntry(
  next: UISpecDraft,
  stateByKey: Map<string, UISpecDraft["state"][number]>,
  stateKey: string | undefined,
  value: string | number | boolean | undefined,
  initialValue: string | number | boolean | undefined,
): boolean {
  if (!stateKey || value === undefined) {
    return false;
  }
  const existing = stateByKey.get(stateKey);
  if (existing) {
    return scalarMatchesState(existing, value);
  }
  if (initialValue === undefined || typeof initialValue !== typeof value) {
    return false;
  }
  const entry = {
    key: stateKey,
    valueType: valueTypeFor(value),
    initialValue,
  } as UISpecDraft["state"][number];
  next.state.push(entry);
  stateByKey.set(stateKey, entry);
  return true;
}

function childIdsForNode(node: UISpecDraft["nodes"][number]): string[] {
  const direct = "childIds" in node ? node.childIds : [];
  const tabs =
    node.kind === "tabs"
      ? node.tabs.flatMap((tab) => tab.childIds)
      : [];
  return [...direct, ...tabs];
}

function buildParentByChild(
  nodes: readonly UISpecDraft["nodes"][number][],
): Map<string, string> {
  const parentByChild = new Map<string, string>();
  for (const node of nodes) {
    for (const childId of childIdsForNode(node)) {
      parentByChild.set(childId, node.id);
    }
  }
  return parentByChild;
}

function buildNodePageMap(
  pages: readonly UISpecDraft["pages"][number][],
  nodeById: ReadonlyMap<string, UISpecDraft["nodes"][number]>,
): Map<string, string> {
  const nodeToPage = new Map<string, string>();
  const visit = (nodeId: string, pageId: string): void => {
    if (nodeToPage.has(nodeId)) {
      return;
    }
    nodeToPage.set(nodeId, pageId);
    const node = nodeById.get(nodeId);
    if (!node) {
      return;
    }
    for (const childId of childIdsForNode(node)) {
      visit(childId, pageId);
    }
  };
  for (const page of pages) {
    visit(page.rootNodeId, page.id);
  }
  return nodeToPage;
}

function remapChildReferences(
  node: UISpecDraft["nodes"][number],
  remapId: (id: string) => string,
): void {
  if ("childIds" in node) {
    node.childIds = node.childIds.map(remapId);
  }
  if (node.kind === "tabs") {
    node.tabs = node.tabs.map((tab) => ({
      ...tab,
      childIds: tab.childIds.map(remapId),
    }));
  }
}

function insertSiblingAfter(
  parent: UISpecDraft["nodes"][number],
  sourceId: string,
  siblingId: string,
): boolean {
  if (!("childIds" in parent)) {
    return false;
  }
  const index = parent.childIds.indexOf(sourceId);
  if (index < 0 || parent.childIds.includes(siblingId)) {
    return false;
  }
  parent.childIds.splice(index + 1, 0, siblingId);
  return true;
}

function cloneVariantTargetIntoSourcePage(input: {
  readonly next: UISpecDraft;
  readonly nodeById: Map<string, UISpecDraft["nodes"][number]>;
  readonly actionNodeId: string;
  readonly interactionId: string;
  readonly targetNodeId: string;
  readonly stateKey: string;
  readonly sourceValue: string | number | boolean;
  readonly targetValue: string | number | boolean;
}): string | undefined {
  const parentByChild = buildParentByChild(input.next.nodes);
  const nodeToPage = buildNodePageMap(input.next.pages, input.nodeById);
  const sourcePageId = nodeToPage.get(input.actionNodeId);
  const targetPageId = nodeToPage.get(input.targetNodeId);
  if (!sourcePageId || !targetPageId || sourcePageId === targetPageId) {
    return input.targetNodeId;
  }

  const actionNode = input.nodeById.get(input.actionNodeId);
  const sourceVariantRootId =
    actionNode?.kind === "stack"
      ? input.actionNodeId
      : parentByChild.get(input.actionNodeId) ?? input.actionNodeId;
  const sourceVariantRoot = input.nodeById.get(sourceVariantRootId);
  const sourceParentId = parentByChild.get(sourceVariantRootId);
  const sourceParent = sourceParentId
    ? input.nodeById.get(sourceParentId)
    : undefined;
  const targetRoot = input.nodeById.get(input.targetNodeId);
  if (!sourceVariantRoot || !sourceParent || !targetRoot) {
    return undefined;
  }

  const existingIds = new Set(input.next.nodes.map((node) => node.id));
  const cloneIdFor = (nodeId: string): string => {
    const base = `variant-${safeId(input.interactionId)}-${safeId(nodeId)}`.slice(
      0,
      248,
    );
    if (!existingIds.has(base)) {
      existingIds.add(base);
      return base;
    }
    for (let index = 1; index < 1000; index += 1) {
      const candidate = `${base}-${index}`.slice(0, 256);
      if (!existingIds.has(candidate)) {
        existingIds.add(candidate);
        return candidate;
      }
    }
    throw new Error("variant_clone_id_exhausted");
  };
  const cloneIdByOriginalId = new Map<string, string>();
  const targetSubtreeIds: string[] = [];
  const collect = (nodeId: string): void => {
    if (cloneIdByOriginalId.has(nodeId)) {
      return;
    }
    const node = input.nodeById.get(nodeId);
    if (!node) {
      return;
    }
    cloneIdByOriginalId.set(nodeId, cloneIdFor(nodeId));
    targetSubtreeIds.push(nodeId);
    for (const childId of childIdsForNode(node)) {
      collect(childId);
    }
  };
  collect(input.targetNodeId);
  if (!cloneIdByOriginalId.has(input.targetNodeId)) {
    return undefined;
  }

  for (const originalId of targetSubtreeIds) {
    const original = input.nodeById.get(originalId)!;
    const clone = structuredClone(original) as UISpecDraft["nodes"][number];
    clone.id = cloneIdByOriginalId.get(originalId)!;
    remapChildReferences(
      clone,
      (childId) => cloneIdByOriginalId.get(childId) ?? childId,
    );
    if (originalId === input.targetNodeId) {
      clone.style = {
        ...clone.style,
        ...sourceVariantRoot.style,
      };
      clone.visibleWhen = {
        stateKey: input.stateKey,
        equals: input.targetValue,
      };
    }
    input.next.nodes.push(clone);
    input.nodeById.set(clone.id, clone);
  }

  sourceVariantRoot.visibleWhen = {
    stateKey: input.stateKey,
    equals: input.sourceValue,
  };
  const clonedTargetRootId = cloneIdByOriginalId.get(input.targetNodeId)!;
  return insertSiblingAfter(
    sourceParent,
    sourceVariantRootId,
    clonedTargetRootId,
  )
    ? clonedTargetRootId
    : undefined;
}

export function applyFlowPlanToUISpec(
  uiSpec: UISpec | UISpecDraft,
  draft: FlowPlanDraft | FlowPlan | LegacyFlowPlanDraft,
  options: ApplyFlowPlanOptions = {},
): ApplyFlowPlanResult {
  const next = draftFromSpec(uiSpec);
  if ("revision" in draft) {
    next.sourceFlowPlanRevision = draft.revision;
  }
  const nodeById = new Map(next.nodes.map((node) => [node.id, node]));
  const stateByKey = new Map(
    next.state.map((state) => [state.key, state]),
  );
  const actionIds = new Set(next.actions.map((action) => action.id));
  const convertedActionIds: string[] = [];
  const behaviorFixtureIds: string[] = [];
  const unresolvedInteractions: Array<
    FlowPlanInteraction | LegacyFlowPlanInteraction
  > = [];
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
    if (!isActionAttachableNode(node)) {
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
      (!ensureStateEntry(
        next,
        stateByKey,
        interaction.stateKey,
        interaction.value,
        interactionStateInitialValue(interaction),
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
    let setStateFixtureTargetNodeId = interaction.targetNodeId;
    if (
      interaction.intent === "set_state" &&
      interaction.stateKey &&
      interaction.value !== undefined
    ) {
      const initialValue = interactionStateInitialValue(interaction);
      const hydratedTarget =
        initialValue !== undefined
          ? cloneVariantTargetIntoSourcePage({
              next,
              nodeById,
              actionNodeId: node.id,
              interactionId: interaction.id,
              targetNodeId: interaction.targetNodeId!,
              stateKey: interaction.stateKey,
              sourceValue: initialValue,
              targetValue: interaction.value,
            })
          : interaction.targetNodeId;
      if (!hydratedTarget) {
        unresolvedInteractions.push({
          ...interaction,
          blockedReason: "state_action_not_verifiable",
        });
        continue;
      }
      setStateFixtureTargetNodeId = hydratedTarget;
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
                nodeId: setStateFixtureTargetNodeId!,
              },
            ];
    next.behaviorFixtures.push({
      id: fixtureId,
      name: `Flow: ${actionNodeLabel(node)} -> ${
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
