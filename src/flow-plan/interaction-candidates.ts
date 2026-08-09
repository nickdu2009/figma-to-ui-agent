import type {
  DesignBundle,
  NormalizedNode,
  PrototypeInteraction,
} from "../design-bundle/schema.ts";
import type { UISpec, UISpecDraft, UINode } from "../ui-spec/schema.ts";
import {
  FLOW_PLAN_DRAFT_SCHEMA_VERSION,
  type FlowConfidence,
  type FlowIntent,
  type FlowPlanDraft,
  type FlowPlanInteraction,
  type FlowPlanPage,
  type FlowTrigger,
  type InteractionSupplement,
  recomputeFlowPlanReport,
} from "./draft.ts";
import { identifyPageCandidates } from "./page-candidates.ts";

export interface BuildFlowPlanDraftInput {
  readonly bundle: DesignBundle;
  readonly uiSpec?: UISpec | UISpecDraft;
  readonly interactionSupplement?: InteractionSupplement;
}

function safeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 220);
  return normalized || "interaction";
}

function textKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function labelForNode(node: UINode): string {
  if ("label" in node) {
    return node.label;
  }
  if (node.kind === "text") {
    return node.text;
  }
  return node.id;
}

function isClickableActionNode(
  node: UINode | undefined,
): node is UINode {
  return (
    node?.kind === "button" ||
    node?.kind === "link" ||
    node?.kind === "checkbox" ||
    node?.kind === "radio" ||
    node?.kind === "switch" ||
    node?.kind === "stack"
  );
}

function childIdsForNode(node: UINode): string[] {
  const direct = "childIds" in node ? node.childIds : [];
  const tabChildren =
    node.kind === "tabs" ? node.tabs.flatMap((tab) => tab.childIds) : [];
  return [...direct, ...tabChildren];
}

function buildUiNodePageMap(uiSpec: UISpec | UISpecDraft): Map<string, string> {
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
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
  for (const page of uiSpec.pages) {
    visit(page.rootNodeId, page.id);
  }
  return nodeToPage;
}

function findDesignPageForNode(
  bundle: DesignBundle,
  sourceNodeId: string | undefined,
): string | undefined {
  if (!sourceNodeId) {
    return undefined;
  }
  return bundle.pages.find((page) =>
    page.nodes.some((node) => node.id === sourceNodeId),
  )?.id;
}

function findTargetPageFromNode(
  bundle: DesignBundle,
  flowPages: readonly FlowPlanPage[],
  targetNodeId: string | undefined,
): string | undefined {
  const sourcePageId = findDesignPageForNode(bundle, targetNodeId);
  if (!sourcePageId) {
    return undefined;
  }
  return flowPages.find((page) => page.sourcePageId === sourcePageId)?.id;
}

function flowPageForDesignNode(
  bundle: DesignBundle,
  flowPages: readonly FlowPlanPage[],
  sourceNodeId: string | undefined,
): string | undefined {
  const sourcePageId = findDesignPageForNode(bundle, sourceNodeId);
  if (!sourcePageId) {
    return undefined;
  }
  return flowPages.find((page) => page.sourcePageId === sourcePageId)?.id;
}

function buildUiNodeLookup(
  uiSpec: UISpec | UISpecDraft | undefined,
): Map<string, UINode> {
  return new Map(uiSpec?.nodes.map((node) => [node.id, node]) ?? []);
}

function findUiNodeForDesignNode(
  uiSpec: UISpec | UISpecDraft | undefined,
  flowPageId: string | undefined,
  sourceNodeId: string | undefined,
  options: { preferClickable?: boolean } = {},
): string | undefined {
  if (!uiSpec || !sourceNodeId) {
    return undefined;
  }
  const normalizedSource = safeId(sourceNodeId);
  const candidateIds = [
    sourceNodeId,
    normalizedSource,
    ...(flowPageId
      ? [
          `ui-${flowPageId}-${normalizedSource}-control`,
          `ui-${flowPageId}-${normalizedSource}`,
        ]
      : []),
  ];
  const uiNodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const uiNodeIdByLowerId = new Map(
    uiSpec.nodes.map((node) => [node.id.toLowerCase(), node.id] as const),
  );
  const existingCandidates = candidateIds
    .map(
      (candidate) =>
        uiNodeById.get(candidate)?.id ??
        uiNodeIdByLowerId.get(candidate.toLowerCase()),
    )
    .filter((candidate): candidate is string => candidate !== undefined);
  if (options.preferClickable) {
    const clickable = existingCandidates.find((candidate) =>
      isClickableActionNode(uiNodeById.get(candidate)),
    );
    if (clickable) {
      return clickable;
    }
  }
  return existingCandidates[0];
}

function findUiNodeForDesignNodeOrAncestor(
  uiSpec: UISpec | UISpecDraft | undefined,
  flowPageId: string | undefined,
  sourceNodeById: ReadonlyMap<string, NormalizedNode>,
  sourceNodeId: string | undefined,
  options: { preferClickable?: boolean } = {},
): { uiNodeId: string; designNodeId: string } | undefined {
  let currentId = sourceNodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const candidate = findUiNodeForDesignNode(
      uiSpec,
      flowPageId,
      currentId,
      options,
    );
    if (candidate) {
      return { uiNodeId: candidate, designNodeId: currentId };
    }
    currentId = sourceNodeById.get(currentId)?.parentId;
  }
  return undefined;
}

function targetNodeIdForPrototype(
  interaction: PrototypeInteraction,
): string | undefined {
  return interaction.transitionNodeId ?? interaction.destinationId;
}

function designNodeById(bundle: DesignBundle): Map<string, NormalizedNode> {
  return new Map(
    bundle.pages.flatMap((page) =>
      page.nodes.map((node) => [node.id, node] as const),
    ),
  );
}

function variantPropertyCandidates(
  node: NormalizedNode | undefined,
): Array<readonly [string, string | number | boolean]> {
  if (!node) {
    return [];
  }
  const explicit: Array<readonly [string, string | number | boolean]> = [
    ...Object.entries(node.variantProperties ?? {}),
    ...(node.componentProperties ?? [])
      .filter((property) => property.type === "VARIANT")
      .map((property) => [property.name, property.value] as const),
  ];
  if (explicit.length > 0) {
    return explicit;
  }
  if (
    (node.kind === "component" || node.kind === "instance") &&
    node.name?.includes("=")
  ) {
    const [rawKey, ...rawValueParts] = node.name.split("=");
    const key = rawKey?.trim();
    const value = rawValueParts.join("=").trim();
    if (key && value) {
      return [[key, value]];
    }
  }
  return [];
}

function stateCandidateForChangeTo(
  sourceDesignNode: NormalizedNode | undefined,
  targetDesignNode: NormalizedNode | undefined,
  uiSpec: UISpec | UISpecDraft | undefined,
):
  | {
      stateKey: string;
      value: string | number | boolean;
      stateInitialValue?: string | number | boolean;
    }
  | undefined {
  if (!targetDesignNode || !uiSpec) {
    return undefined;
  }
  const stateByKey = new Map(uiSpec.state.map((state) => [state.key, state]));
  const targetCandidates = variantPropertyCandidates(targetDesignNode);
  for (const [rawKey, value] of targetCandidates) {
    const keys = [rawKey, safeId(rawKey)];
    for (const key of keys) {
      const state = stateByKey.get(key);
      if (state && typeof value === state.valueType) {
        return { stateKey: key, value };
      }
    }
  }
  const sourceCandidates = new Map<
    string,
    string | number | boolean
  >(variantPropertyCandidates(sourceDesignNode));
  for (const [rawKey, value] of targetCandidates) {
    const sourceValue = sourceCandidates.get(rawKey);
    if (
      sourceValue !== undefined &&
      typeof sourceValue === typeof value &&
      sourceValue !== value
    ) {
      return {
        stateKey: `variant-${safeId(sourceDesignNode?.id ?? rawKey)}-${safeId(rawKey)}`.slice(
          0,
          256,
        ),
        value,
        stateInitialValue: sourceValue,
      };
    }
  }
  return undefined;
}

function inferTargetPage(
  label: string,
  fromPageId: string | undefined,
  pages: readonly FlowPlanPage[],
): { pageId?: string; confidence: FlowConfidence; reason: string } {
  const normalizedLabel = textKey(label);
  const direct = pages.find(
    (page) =>
      page.id !== fromPageId &&
      (normalizedLabel.includes(textKey(page.name)) ||
        normalizedLabel.includes(textKey(page.id))),
  );
  if (direct) {
    return {
      pageId: direct.id,
      confidence: "medium",
      reason: `按钮文案与页面 ${direct.name} 匹配，仍需用户确认。`,
    };
  }
  if (
    /continue|next|start|submit|login|sign|buy|checkout|quote|继续|下一步|开始|提交|登录|注册|购买|报价/.test(
      normalizedLabel,
    )
  ) {
    const fromIndex = pages.findIndex((page) => page.id === fromPageId);
    const nextPage = pages[fromIndex >= 0 ? fromIndex + 1 : 1];
    if (nextPage) {
      return {
        pageId: nextPage.id,
        confidence: "low",
        reason: `按钮文案暗示继续流程，推断目标为下一个页面 ${nextPage.name}。`,
      };
    }
  }
  if (/back|home|return|返回|首页/.test(normalizedLabel)) {
    const entry = pages.find((page) => page.role === "entry") ?? pages[0];
    if (entry && entry.id !== fromPageId) {
      return {
        pageId: entry.id,
        confidence: "low",
        reason: `按钮文案暗示返回入口，推断目标为 ${entry.name}。`,
      };
    }
  }
  return {
    confidence: "low",
    reason: "无法从 Figma interaction 或控件文案确认目标页面。",
  };
}

function figmaPrototypeIntent(
  interaction: PrototypeInteraction,
  targetPageId: string | undefined,
  stateCandidate:
    | { stateKey: string; value: string | number | boolean }
    | undefined,
): FlowIntent {
  if (interaction.reason) {
    return "unknown";
  }
  if (interaction.navigation === "CHANGE_TO") {
    return stateCandidate ? "set_state" : "unknown";
  }
  if (
    (interaction.navigation === "NAVIGATE" ||
      interaction.navigation === "SWAP") &&
    targetPageId
  ) {
    return "navigate";
  }
  return "unknown";
}

function blockedReasonForPrototype(
  interaction: PrototypeInteraction,
  sourceUiNode: UINode | undefined,
  targetNodeId: string | undefined,
  targetUiNodeId: string | undefined,
  targetPageId: string | undefined,
  stateCandidate:
    | { stateKey: string; value: string | number | boolean }
    | undefined,
): string | undefined {
  if (interaction.reason) {
    return interaction.reason;
  }
  if (!isClickableActionNode(sourceUiNode)) {
    return "ui_node_not_clickable";
  }
  if (interaction.navigation === "CHANGE_TO") {
    if (!targetNodeId) {
      return "prototype_target_missing";
    }
    if (!targetUiNodeId || !stateCandidate) {
      return "change_to_target_not_representable";
    }
    return undefined;
  }
  if (
    interaction.navigation === "NAVIGATE" ||
    interaction.navigation === "SWAP"
  ) {
    return targetPageId ? undefined : "prototype_target_page_missing";
  }
  return "unsupported_figma_action";
}

function intentForSupplement(
  item: InteractionSupplement["interactions"][number],
  targetPageId: string | undefined,
): FlowIntent {
  if (item.dialogNodeId) {
    return "open_dialog";
  }
  if (item.stateKey) {
    return "set_state";
  }
  if (
    targetPageId &&
    (item.trigger === "click" || item.trigger === "submit")
  ) {
    return "navigate";
  }
  return "unknown";
}

export function buildFlowPlanDraft({
  bundle,
  uiSpec,
  interactionSupplement,
}: BuildFlowPlanDraftInput): FlowPlanDraft {
  if (
    interactionSupplement &&
    (interactionSupplement.projectId !== bundle.projectId ||
      interactionSupplement.sourceDesignBundleRevision !== bundle.revision)
  ) {
    throw new Error("interaction_supplement_source_mismatch");
  }
  const pageResult = identifyPageCandidates(bundle, uiSpec);
  const pages = pageResult.pages;
  const sourcePageToFlowPage = new Map(
    pages.map((page) => [page.sourcePageId, page.id]),
  );
  const uiNodeToPage = uiSpec ? buildUiNodePageMap(uiSpec) : new Map();
  const uiNodeById = buildUiNodeLookup(uiSpec);
  const sourceNodeById = designNodeById(bundle);
  const coveredUiNodes = new Set<string>();
  const interactions: FlowPlanInteraction[] = [];

  for (const page of bundle.pages) {
    for (const sourceNode of page.nodes) {
      for (const [index, prototype] of (
        sourceNode.prototypeInteractions ?? []
      ).entries()) {
        const fromPageId = sourcePageToFlowPage.get(page.id);
        const uiNodeMapping = findUiNodeForDesignNodeOrAncestor(
          uiSpec,
          fromPageId,
          sourceNodeById,
          sourceNode.id,
          { preferClickable: true },
        );
        const uiNodeId = uiNodeMapping?.uiNodeId;
        if (uiNodeId) {
          coveredUiNodes.add(uiNodeId);
        }
        const sourceUiNode = uiNodeId ? uiNodeById.get(uiNodeId) : undefined;
        const stateSourceNode =
          uiNodeMapping?.designNodeId
            ? sourceNodeById.get(uiNodeMapping.designNodeId)
            : sourceNode;
        const targetDesignNodeId = targetNodeIdForPrototype(prototype);
        const targetPageId =
          prototype.navigation === "NAVIGATE" ||
          prototype.navigation === "SWAP"
            ? findTargetPageFromNode(bundle, pages, targetDesignNodeId)
            : undefined;
        const targetFlowPageId = flowPageForDesignNode(
          bundle,
          pages,
          targetDesignNodeId,
        );
        const targetUiNodeId = findUiNodeForDesignNode(
          uiSpec,
          targetFlowPageId ?? fromPageId,
          targetDesignNodeId,
        );
        const stateCandidate = stateCandidateForChangeTo(
          stateSourceNode,
          targetDesignNodeId
            ? sourceNodeById.get(targetDesignNodeId)
            : undefined,
          uiSpec,
        );
        const intent = figmaPrototypeIntent(
          prototype,
          targetPageId,
          stateCandidate,
        );
        const blockedReason = blockedReasonForPrototype(
          prototype,
          sourceUiNode,
          targetDesignNodeId,
          targetUiNodeId,
          targetPageId,
          stateCandidate,
        );
        interactions.push({
          id:
            prototype.id ??
            `figma-${safeId(sourceNode.id)}-${String(index)}`,
          source: "figma",
          sourceNodeId: sourceNode.id,
          uiNodeId,
          sourceNodeName: sourceNode.name,
          trigger: prototype.trigger,
          intent,
          fromPageId,
          targetNodeId:
            intent === "set_state" ? targetUiNodeId : targetDesignNodeId,
          targetPageId,
          stateKey: intent === "set_state" ? stateCandidate?.stateKey : undefined,
          value: intent === "set_state" ? stateCandidate?.value : undefined,
          stateInitialValue:
            intent === "set_state"
              ? stateCandidate?.stateInitialValue
              : undefined,
          confirmed: intent !== "unknown" && !blockedReason,
          confidence: intent !== "unknown" && !blockedReason ? "high" : "low",
          reason:
            intent !== "unknown" && !blockedReason
              ? "来自 Figma REST prototype interaction 的受控转换。"
              : "Figma prototype interaction 存在，但无法安全转换为 UISpec action。",
          blockedReason,
        });
      }
    }
  }

  for (const [index, item] of (
    interactionSupplement?.interactions ?? []
  ).entries()) {
    const fromSourcePageId = findDesignPageForNode(
      bundle,
      item.sourceNodeId,
    );
    const fromPageId =
      (fromSourcePageId && sourcePageToFlowPage.get(fromSourcePageId)) ||
      (item.uiNodeId ? uiNodeToPage.get(item.uiNodeId) : undefined);
    const targetPageId =
      item.targetPageId ??
      findTargetPageFromNode(bundle, pages, item.targetNodeId);
    if (item.uiNodeId) {
      coveredUiNodes.add(item.uiNodeId);
    }
    const intent = intentForSupplement(item, targetPageId);
    interactions.push({
      id: item.id ?? `figma-${safeId(item.sourceNodeId ?? String(index))}`,
      source: "figma",
      sourceNodeId: item.sourceNodeId,
      uiNodeId: item.uiNodeId,
      sourceNodeName: item.sourceNodeName,
      trigger: item.trigger as FlowTrigger,
      intent,
      fromPageId,
      targetNodeId: item.targetNodeId,
      targetPageId,
      stateKey: item.stateKey,
      dialogNodeId: item.dialogNodeId,
      value: item.value,
      stateInitialValue: item.stateInitialValue,
      confirmed: intent !== "unknown",
      confidence: intent === "unknown" ? "low" : "high",
      reason:
        intent === "unknown"
          ? "Figma interaction 存在，但 spike 无法安全转换为 UISpec action。"
          : "来自 spike-only interaction supplement 的 Figma interaction。",
      blockedReason: intent === "unknown" ? "unsupported_figma_action" : undefined,
    });
  }

  if (uiSpec) {
    const existingActionIds = new Set(
      uiSpec.nodes
        .filter(
          (node): node is Extract<UINode, { kind: "button" | "link" }> =>
            node.kind === "button" || node.kind === "link",
        )
        .flatMap((node) => (node.actionId ? [node.actionId] : [])),
    );
    const actionIds = new Set(uiSpec.actions.map((action) => action.id));
    const activePageIds = new Set(pages.map((page) => page.id));

    for (const node of uiSpec.nodes) {
      if (node.kind !== "button" && node.kind !== "link") {
        continue;
      }
      if (coveredUiNodes.has(node.id)) {
        continue;
      }
      if (node.actionId && actionIds.has(node.actionId)) {
        continue;
      }
      const fromPageId = uiNodeToPage.get(node.id);
      if (fromPageId && !activePageIds.has(fromPageId)) {
        continue;
      }
      const inferred = inferTargetPage(labelForNode(node), fromPageId, pages);
      const hasTarget = Boolean(inferred.pageId);
      interactions.push({
        id: `${hasTarget ? "inferred" : "missing"}-${safeId(node.id)}`,
        source: hasTarget ? "inferred" : "missing",
        uiNodeId: node.id,
        sourceNodeName: labelForNode(node),
        trigger: "click",
        intent: hasTarget ? "navigate" : "unknown",
        fromPageId,
        targetPageId: inferred.pageId,
        confirmed: false,
        confidence: inferred.confidence,
        reason: inferred.reason,
        blockedReason: hasTarget
          ? "requires_user_confirmation"
          : "interaction_target_missing",
      });
    }

    for (const actionId of existingActionIds) {
      if (!actionIds.has(actionId)) {
        interactions.push({
          id: `missing-action-${safeId(actionId)}`,
          source: "missing",
          intent: "unknown",
          confirmed: false,
          confidence: "low",
          reason: `UISpec 控件引用了不存在的 action：${actionId}。`,
          blockedReason: "dangling_ui_action",
        });
      }
    }
  }

  const draft: FlowPlanDraft = {
    schemaVersion: FLOW_PLAN_DRAFT_SCHEMA_VERSION,
    projectId: bundle.projectId,
    sourceDesignBundleRevision: bundle.revision,
    sourceUISpecRevision: uiSpec && "revision" in uiSpec ? uiSpec.revision : undefined,
    pages,
    interactions,
    confirmationQuestions: [],
    report: {
      unsupportedCount: 0,
      unresolvedInteractionCount: 0,
      convertedActionCount: 0,
      behaviorFixtureCount: 0,
    },
  };
  draft.report = recomputeFlowPlanReport(draft);
  return draft;
}
