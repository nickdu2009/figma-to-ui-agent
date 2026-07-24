import type {
  DesignBundle,
  NormalizedNode,
} from "../design-bundle/schema.ts";

const MAX_CONTEXT_NODES = 2_000;
const MAX_NODES_PER_PAGE = 500;
const MAX_CONTEXT_ITEMS = 500;
const MAX_NODE_REFS = 50;
const MAX_TEXT_CHARACTERS = 1_000;

function boundedRefs(values: readonly string[]): string[] {
  return values.slice(0, MAX_NODE_REFS);
}

function summarizeNode(node: NormalizedNode) {
  return {
    id: node.id,
    parentId: node.parentId,
    kind: node.kind,
    name: node.name,
    visible: node.visible,
    bounds: node.bounds,
    layout: node.layout,
    text: node.text
      ? {
          ...node.text,
          characters: node.text.characters.slice(
            0,
            MAX_TEXT_CHARACTERS,
          ),
          truncated:
            node.text.characters.length > MAX_TEXT_CHARACTERS,
        }
      : undefined,
    componentRef: node.componentRef,
    styleRefs: boundedRefs(node.styleRefs),
    imageRefs: boundedRefs(node.imageRefs),
    designValueRefs: boundedRefs(node.designValueRefs),
    warningCodes: boundedRefs(node.warningCodes),
  };
}

function screenshotPathForPage(
  bundle: DesignBundle,
  pageId: string,
): string | undefined {
  const sourceHash = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "page" &&
      entry.entityId === pageId,
  )?.sourceIdHash;
  if (!sourceHash) {
    return undefined;
  }
  const path = bundle.provenance.find(
    (entry) =>
      entry.entityKind === "screenshot" &&
      entry.sourceIdHash === sourceHash,
  )?.entityId;
  return bundle.screenshots.some(
    (screenshot) => screenshot.path === path,
  )
    ? path
    : undefined;
}

export function buildInspectAgentContext(bundle: DesignBundle) {
  let remainingNodes = MAX_CONTEXT_NODES;
  const pages = bundle.pages.map((page) => {
    const includedNodes = page.nodes.slice(
      0,
      Math.min(MAX_NODES_PER_PAGE, remainingNodes),
    );
    remainingNodes -= includedNodes.length;
    return {
      id: page.id,
      name: page.name,
      width: page.width,
      height: page.height,
      rootNodeIds: page.rootNodeIds,
      nodeCount: page.nodes.length,
      nodes: includedNodes.map(summarizeNode),
      screenshotPath: screenshotPathForPage(bundle, page.id),
      nodesTruncated: includedNodes.length < page.nodes.length,
    };
  });

  return {
    schemaVersion: "1" as const,
    kind: "inspect_agent_context" as const,
    projectId: bundle.projectId,
    designBundleRevision: bundle.revision,
    pages,
    components: bundle.components.slice(0, MAX_CONTEXT_ITEMS),
    styles: bundle.styles.slice(0, MAX_CONTEXT_ITEMS),
    designValues: bundle.designValues.slice(0, MAX_CONTEXT_ITEMS),
    assets: bundle.assets.slice(0, MAX_CONTEXT_ITEMS),
    truncation: {
      nodes: bundle.pages.reduce(
        (total, page) => total + page.nodes.length,
        0,
      ) - pages.reduce(
        (total, page) => total + page.nodes.length,
        0,
      ),
      components: Math.max(
        bundle.components.length - MAX_CONTEXT_ITEMS,
        0,
      ),
      styles: Math.max(
        bundle.styles.length - MAX_CONTEXT_ITEMS,
        0,
      ),
      designValues: Math.max(
        bundle.designValues.length - MAX_CONTEXT_ITEMS,
        0,
      ),
      assets: Math.max(
        bundle.assets.length - MAX_CONTEXT_ITEMS,
        0,
      ),
    },
  };
}

export type InspectAgentContext = ReturnType<
  typeof buildInspectAgentContext
>;
