import type { ActionBinding, UIElement } from "@json-render/core";

import type { UISpec, UINode } from "../ui-spec/schema.ts";
import {
  previewCatalog,
  type PreviewJsonSpec,
} from "./catalog.ts";

export class PreviewAdapterError extends Error {
  readonly code: "page_not_found" | "catalog_validation_failed";

  constructor(
    code: "page_not_found" | "catalog_validation_failed",
    message: string,
  ) {
    super(message);
    this.name = "PreviewAdapterError";
    this.code = code;
  }
}

export interface PreviewAdapterOptions {
  imageUrl: (relativePath: string) => string;
}

function actionBinding(
  node: Extract<UINode, { kind: "button" }>,
): Record<string, ActionBinding> | undefined {
  if (node.disabled || !node.actionId) {
    return undefined;
  }
  return {
    press: {
      action: "dispatch",
      params: { actionId: node.actionId },
    },
  };
}

function toElement(
  node: UINode,
  options: PreviewAdapterOptions,
): UIElement {
  const common = {
    nodeId: node.id,
    designValueRefs: node.designValueRefs,
    ...(node.style ? { style: node.style } : {}),
  };
  if (node.kind === "stack") {
    return {
      type: "Stack",
      props: {
        ...common,
        direction: node.direction,
        gap: node.gap ?? null,
        padding: node.padding ?? null,
        align: node.align ?? null,
      },
      children: node.childIds,
    };
  }
  if (node.kind === "grid") {
    return {
      type: "Grid",
      props: {
        ...common,
        columns: node.columns,
        gap: node.gap ?? null,
      },
      children: node.childIds,
    };
  }
  if (node.kind === "section") {
    return {
      type: "Section",
      props: { ...common, semantic: node.semantic },
      children: node.childIds,
    };
  }
  if (node.kind === "dialog") {
    return {
      type: "Dialog",
      props: { ...common, title: node.title },
      children: node.childIds,
      visible: { $state: `/${node.openStateKey}` },
    };
  }
  if (node.kind === "text") {
    return {
      type: "Text",
      props: {
        ...common,
        text: node.text,
        variant: node.variant,
      },
    };
  }
  if (node.kind === "image") {
    return {
      type: "Image",
      props: {
        ...common,
        src: options.imageUrl(node.assetRef),
        alt: node.alt,
        fit: node.fit,
      },
    };
  }
  if (node.kind === "pixel_overlay") {
    return {
      type: "PixelOverlay",
      props: {
        ...common,
        src: options.imageUrl(node.assetRef),
        alt: node.alt,
        width: node.width,
        height: node.height,
      },
      children: node.childIds,
    };
  }
  if (node.kind === "button") {
    return {
      type: "Button",
      props: {
        ...common,
        label: node.label,
        variant: node.variant,
        disabled: node.disabled ?? false,
        leadingIconSrc: node.leadingIconAssetRef
          ? options.imageUrl(node.leadingIconAssetRef)
          : null,
        trailingIconSrc: node.trailingIconAssetRef
          ? options.imageUrl(node.trailingIconAssetRef)
          : null,
      },
      on: actionBinding(node),
    };
  }
  if (node.kind === "input") {
    return {
      type: "Input",
      props: {
        ...common,
        label: node.label,
        value: { $bindState: `/${node.stateKey}` },
        inputType: node.inputType,
        placeholder: node.placeholder ?? null,
        disabled: node.disabled ?? false,
      },
    };
  }
  if (node.kind === "checkbox") {
    return {
      type: "Checkbox",
      props: {
        ...common,
        label: node.label,
        checked: { $bindState: `/${node.stateKey}` },
        disabled: node.disabled ?? false,
      },
    };
  }
  return {
    type: "Divider",
    props: common,
  };
}

function reachableNodeIds(
  rootNodeId: string,
  nodes: ReadonlyMap<string, UINode>,
): string[] {
  const output: string[] = [];
  const queue = [rootNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    output.push(nodeId);
    const node = nodes.get(nodeId);
    if (node && "childIds" in node) {
      queue.push(...node.childIds);
    }
  }
  return output;
}

export function toPreviewJsonSpec(
  uiSpec: UISpec,
  pageId: string,
  options: PreviewAdapterOptions,
): PreviewJsonSpec {
  const page = uiSpec.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new PreviewAdapterError(
      "page_not_found",
      "UISpec 页面不存在",
    );
  }
  const nodeById = new Map(uiSpec.nodes.map((node) => [node.id, node]));
  const elements = Object.fromEntries(
    reachableNodeIds(page.rootNodeId, nodeById).map((nodeId) => {
      const element = toElement(nodeById.get(nodeId)!, options);
      return [
        nodeId,
        {
          ...element,
          children: element.children ?? [],
          visible: element.visible ?? true,
        },
      ];
    }),
  );
  const spec: PreviewJsonSpec = {
    root: page.rootNodeId,
    elements,
    state: Object.fromEntries(
      uiSpec.state.map((entry) => [entry.key, entry.initialValue]),
    ),
  };
  const validation = previewCatalog.validate(spec);
  if (!validation.success) {
    throw new PreviewAdapterError(
      "catalog_validation_failed",
      "UISpec 无法转换为受控 Preview Catalog",
    );
  }
  return spec;
}
