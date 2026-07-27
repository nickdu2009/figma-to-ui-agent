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
  imageMetadata?: (
    relativePath: string,
  ) => { width: number; height: number } | undefined;
  textStyleForNode?: (
    node: Extract<UINode, { kind: "text" }>,
  ) => UINode["style"] | undefined;
  textVisualOverlayForNode?: (
    node: Extract<UINode, { kind: "text" }>,
  ) =>
    | {
        assetRef: string;
        sourceWidth: number;
        sourceHeight: number;
        frame: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }
    | undefined;
}

function actionBinding(
  node: { disabled?: boolean; actionId?: string },
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

function tabPanelId(tabsId: string, value: string): string {
  return `__tabpanel__${tabsId}__${value}`;
}

interface ToElementResult {
  element: UIElement;
  extra?: Record<string, UIElement>;
}

function toElement(
  node: UINode,
  options: PreviewAdapterOptions,
): ToElementResult {
  const style =
    node.kind === "text"
      ? {
          ...node.style,
          ...options.textStyleForNode?.(node),
        }
      : node.style;
  const common = {
    nodeId: node.id,
    designValueRefs: node.designValueRefs,
    ...(style && Object.keys(style).length > 0 ? { style } : {}),
  };
  if (node.kind === "stack") {
    return {
      element: {
        type: "Stack",
        props: {
          ...common,
          direction: node.direction,
          gap: node.gap ?? null,
          padding: node.padding ?? null,
          align: node.align ?? null,
        },
        children: node.childIds,
      },
    };
  }
  if (node.kind === "grid") {
    return {
      element: {
        type: "Grid",
        props: {
          ...common,
          columns: node.columns,
          gap: node.gap ?? null,
        },
        children: node.childIds,
      },
    };
  }
  if (node.kind === "section") {
    return {
      element: {
        type: "Section",
        props: { ...common, semantic: node.semantic },
        children: node.childIds,
      },
    };
  }
  if (node.kind === "dialog") {
    return {
      element: {
        type: "Dialog",
        props: { ...common, title: node.title },
        children: node.childIds,
        visible: { $state: `/${node.openStateKey}` },
      },
    };
  }
  if (node.kind === "text") {
    const visualOverlay = options.textVisualOverlayForNode?.(node);
    return {
      element: {
        type: "Text",
        props: {
          ...common,
          text: node.text,
          variant: node.variant,
          visualOverlay: visualOverlay
            ? {
                src: options.imageUrl(visualOverlay.assetRef),
                sourceWidth: visualOverlay.sourceWidth,
                sourceHeight: visualOverlay.sourceHeight,
                frame: visualOverlay.frame,
              }
            : null,
        },
      },
    };
  }
  if (node.kind === "image") {
    return {
      element: {
        type: "Image",
        props: {
          ...common,
          src: options.imageUrl(node.assetRef),
          alt: node.alt,
          fit: node.fit,
        },
      },
    };
  }
  if (node.kind === "pixel_overlay") {
    const metadata = options.imageMetadata?.(node.assetRef);
    return {
      element: {
        type: "PixelOverlay",
        props: {
          ...common,
          src: options.imageUrl(node.assetRef),
          alt: node.alt,
          width: node.width,
          height: node.height,
          sourceWidth: metadata?.width ?? null,
          sourceHeight: metadata?.height ?? null,
          frame: node.frame ?? null,
        },
        children: node.childIds,
      },
    };
  }
  if (node.kind === "button") {
    return {
      element: {
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
      },
    };
  }
  if (node.kind === "input") {
    const transparentControl = node.style?.textColor === "#FFFFFF00";
    return {
      element: {
        type: "Input",
        props: {
          ...common,
          label: node.label,
          value: { $bindState: `/${node.stateKey}` },
          inputType: node.inputType,
          placeholder: node.placeholder ?? null,
          disabled: node.disabled ?? false,
          hideLabel: transparentControl,
        },
      },
    };
  }
  if (node.kind === "checkbox") {
    return {
      element: {
        type: "Checkbox",
        props: {
          ...common,
          label: node.label,
          checked: { $bindState: `/${node.stateKey}` },
          disabled: node.disabled ?? false,
        },
      },
    };
  }
  if (node.kind === "link") {
    return {
      element: {
        type: "Link",
        props: {
          ...common,
          label: node.label,
          disabled: node.disabled ?? false,
        },
        on: actionBinding(node),
      },
    };
  }
  if (node.kind === "radio") {
    return {
      element: {
        type: "Radio",
        props: {
          ...common,
          label: node.label,
          value: node.value,
          stateKey: node.stateKey,
          disabled: node.disabled ?? false,
        },
      },
    };
  }
  if (node.kind === "switch") {
    return {
      element: {
        type: "Switch",
        props: {
          ...common,
          label: node.label,
          checked: { $bindState: `/${node.stateKey}` },
          disabled: node.disabled ?? false,
        },
      },
    };
  }
  if (node.kind === "select") {
    return {
      element: {
        type: "Select",
        props: {
          ...common,
          label: node.label,
          value: { $bindState: `/${node.stateKey}` },
          options: node.options,
          placeholder: node.placeholder ?? null,
          disabled: node.disabled ?? false,
        },
      },
    };
  }
  if (node.kind === "textarea") {
    return {
      element: {
        type: "Textarea",
        props: {
          ...common,
          label: node.label,
          value: { $bindState: `/${node.stateKey}` },
          placeholder: node.placeholder ?? null,
          disabled: node.disabled ?? false,
        },
      },
    };
  }
  if (node.kind === "form_field") {
    return {
      element: {
        type: "FormField",
        props: {
          ...common,
          label: node.label,
          helpText: node.helpText ?? null,
          errorText: node.errorText ?? null,
          required: node.required ?? false,
        },
        children: node.childIds,
      },
    };
  }
  if (node.kind === "icon") {
    return {
      element: {
        type: "Icon",
        props: {
          ...common,
          src: node.assetRef ? options.imageUrl(node.assetRef) : null,
          symbol: node.symbol ?? null,
          alt: node.alt ?? "",
          decorative: node.decorative ?? false,
        },
      },
    };
  }
  if (node.kind === "spacer") {
    return {
      element: {
        type: "Spacer",
        props: {
          ...common,
          width: node.width ?? null,
          height: node.height ?? null,
        },
      },
    };
  }
  if (node.kind === "card") {
    return {
      element: {
        type: "Card",
        props: common,
        children: node.childIds,
      },
    };
  }
  if (node.kind === "list") {
    return {
      element: {
        type: "List",
        props: {
          ...common,
          ordered: node.ordered ?? false,
        },
        children: node.childIds,
      },
    };
  }
  if (node.kind === "list_item") {
    return {
      element: {
        type: "ListItem",
        props: common,
        children: node.childIds,
      },
    };
  }
  if (node.kind === "badge") {
    return {
      element: {
        type: "Badge",
        props: {
          ...common,
          label: node.label,
          tone: node.tone ?? null,
        },
      },
    };
  }
  if (node.kind === "avatar") {
    return {
      element: {
        type: "Avatar",
        props: {
          ...common,
          src: node.assetRef
            ? options.imageUrl(node.assetRef)
            : null,
          initials: node.initials ?? null,
          alt: node.alt,
        },
      },
    };
  }
  if (node.kind === "tabs") {
    const extra: Record<string, UIElement> = {};
    const panelIds: string[] = [];
    for (const tab of node.tabs) {
      const panelId = tabPanelId(node.id, tab.value);
      panelIds.push(panelId);
      extra[panelId] = {
        type: "TabPanel",
        props: {
          nodeId: panelId,
          designValueRefs: [],
          stateKey: node.stateKey,
          value: tab.value,
        },
        children: tab.childIds,
      };
    }
    return {
      element: {
        type: "Tabs",
        props: {
          ...common,
          selectedTab: { $bindState: `/${node.stateKey}` },
          tabs: node.tabs.map(({ value, label }) => ({ value, label })),
        },
        children: panelIds,
      },
      extra,
    };
  }
  if (node.kind === "nav") {
    return {
      element: {
        type: "Nav",
        props: {
          ...common,
          orientation: node.orientation,
        },
        children: node.childIds,
      },
    };
  }
  return {
    element: {
      type: "Divider",
      props: common,
    },
  };
}

function childNodeIds(node: UINode): string[] {
  const direct = "childIds" in node ? node.childIds : [];
  const tabs =
    node.kind === "tabs"
      ? node.tabs.flatMap((tab) => tab.childIds)
      : [];
  return [...direct, ...tabs];
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
    if (node) {
      queue.push(...childNodeIds(node));
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
  const elements: Record<string, UIElement> = {};
  for (const nodeId of reachableNodeIds(page.rootNodeId, nodeById)) {
    const { element, extra } = toElement(nodeById.get(nodeId)!, options);
    elements[nodeId] = {
      ...element,
      children: element.children ?? [],
      visible: element.visible ?? true,
    };
    if (extra) {
      for (const [extraId, extraElement] of Object.entries(extra)) {
        elements[extraId] = {
          ...extraElement,
          children: extraElement.children ?? [],
          visible: extraElement.visible ?? true,
        };
      }
    }
  }
  for (const node of uiSpec.nodes) {
    if (
      node.kind !== "form_field" ||
      node.style?.position !== "absolute"
    ) {
      continue;
    }
    for (const childId of node.childIds) {
      const child = elements[childId];
      if (child?.type === "Input") {
        child.props = { ...child.props, hideLabel: true };
      }
    }
  }
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
