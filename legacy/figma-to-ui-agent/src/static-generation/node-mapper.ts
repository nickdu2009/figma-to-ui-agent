import type {
  DesignBundle,
  NormalizedNode,
} from "../design-bundle/schema.ts";
import type { UINode, UISpecDraft } from "../ui-spec/schema.ts";
import type { VisualLayerPlan } from "./visual-layer-planner.ts";
import { mapNodeStyle, pickTextVariant } from "./style-mapper.ts";

type InputType = "text" | "email" | "password" | "search";
type TextNode = NormalizedNode & { kind: "text" };
type ImageNode = NormalizedNode & { kind: "image" };
type ContainerNode = NormalizedNode & { kind: "container" };
type ComponentFamily =
  | "button"
  | "input"
  | "select"
  | "checkbox"
  | "radio"
  | "switch"
  | "modal"
  | "tag"
  | "avatar"
  | "icon"
  | "unknown";
type ComponentState =
  | "default"
  | "hover"
  | "disabled"
  | "error"
  | "selected";

const INPUT_TYPE_HINTS: Array<{
  pattern: RegExp;
  type: InputType;
}> = [
  { pattern: /email|e-mail|邮箱/i, type: "email" },
  { pattern: /password|密码|pwd/i, type: "password" },
  { pattern: /search|搜索/i, type: "search" },
];

const SELECT_INDICATOR_PATTERN =
  /(?:trailing icon|chevron|caret|dropdown|select|arrow down)/i;
const CHECKBOX_PATTERN = /(?:checkbox|check box|checkmark)/i;
const RADIO_PATTERN = /(?:radio|radio button)/i;
const SWITCH_PATTERN = /(?:switch|toggle)/i;
const MODAL_PATTERN = /(?:modal|dialog|popover|drawer)/i;
const TAG_PATTERN = /(?:badge|tag|pill|chip)/i;
const AVATAR_PATTERN = /(?:avatar|profile|portrait|userpic)/i;
const ICON_PATTERN = /(?:icon|glyph|logo|symbol)/i;
const DISABLED_STATE_PATTERN = /(?:disabled|disable|inactive|禁用)/i;
const ERROR_STATE_PATTERN = /(?:error|invalid|danger|错误|失败)/i;
const SELECTED_STATE_PATTERN = /(?:selected|active|checked|current|选中)/i;
const HOVER_STATE_PATTERN = /(?:hover|hovered|悬停)/i;

function isTextNode(node: NormalizedNode): node is TextNode {
  return node.kind === "text";
}

function isImageNode(node: NormalizedNode): node is ImageNode {
  return node.kind === "image";
}

function isContainerNode(node: NormalizedNode): node is ContainerNode {
  return node.kind === "container";
}

function isFrameLikeNode(node: NormalizedNode): boolean {
  return (
    node.kind === "container" ||
    node.kind === "instance" ||
    node.kind === "component"
  );
}

function isButtonLike(node: NormalizedNode): boolean {
  const name = node.name?.toLowerCase() ?? "";
  const height = node.bounds?.height;
  const hasControlHeight =
    height === undefined || (height >= 28 && height <= 140);
  return hasControlHeight && (
    name.includes("button") ||
    name.includes("btn") ||
    name.includes("sign in") ||
    name.includes("sign up") ||
    name.includes("login") ||
    name.includes("submit") ||
    name.includes("continue") ||
    name.includes("get started")
  );
}

function isInputLike(node: NormalizedNode): boolean {
  const name = node.name?.toLowerCase() ?? "";
  const height = node.bounds?.height;
  const hasInputHeight =
    height === undefined || (height >= 28 && height <= 160);
  return (
    hasInputHeight &&
    (name.includes("input") ||
      name.includes("email") ||
      name.includes("password") ||
      name.includes("search") ||
      name.includes("field"))
  );
}

function detectInputType(
  node: NormalizedNode,
  textHints: readonly string[] = [],
): InputType {
  const name = [node.name ?? "", ...textHints].join(" ");
  for (const hint of INPUT_TYPE_HINTS) {
    if (hint.pattern.test(name)) {
      return hint.type;
    }
  }
  return "text";
}

function optionValueFromLabel(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "option";
}

function stableUINodeId(
  pagePlanId: string,
  sourceNodeId: string,
): string {
  return `ui-${pagePlanId}-${sourceNodeId.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function thickSurfaceStrokeOutset(sourceNode: NormalizedNode): number {
  const strokeWeight = sourceNode.visual?.strokeWeight;
  if (
    !sourceNode.bounds ||
    strokeWeight === undefined ||
    strokeWeight < 2 ||
    !sourceNode.visual?.clipsContent ||
    (sourceNode.visual?.strokeCount ?? 0) === 0 ||
    Math.min(sourceNode.bounds.width, sourceNode.bounds.height) < 240
  ) {
    return 0;
  }
  return strokeWeight;
}

function frameStyleForNode(
  sourceNode: NormalizedNode,
  parentNode: NormalizedNode | undefined,
  zIndex: number,
): UINode["style"] {
  if (!sourceNode.bounds) {
    return undefined;
  }

  if (!parentNode?.bounds) {
    const style: UINode["style"] = {
      position: "relative",
    };
    if (sourceNode.bounds.width > 0) {
      style.width = sourceNode.bounds.width;
    }
    if (sourceNode.bounds.height > 0) {
      style.height = sourceNode.bounds.height;
    }
    return style;
  }

  const strokeOutset = thickSurfaceStrokeOutset(sourceNode);
  const style: UINode["style"] = {
    position: "absolute",
    left: sourceNode.bounds.x - parentNode.bounds.x - strokeOutset,
    top: sourceNode.bounds.y - parentNode.bounds.y - strokeOutset,
    zIndex,
  };
  if (sourceNode.bounds.width > 0) {
    style.width = sourceNode.bounds.width;
  }
  if (sourceNode.bounds.height > 0) {
    style.height = sourceNode.bounds.height;
  }
  return style;
}

function mappedStyleForNode(
  sourceNode: NormalizedNode,
  styles: readonly DesignBundle["styles"][number][],
  designValues: readonly DesignBundle["designValues"][number][],
  parentNode: NormalizedNode | undefined,
  zIndex: number,
  childNodes: readonly NormalizedNode[] = [],
): UINode["style"] {
  const mapped = mapNodeStyle(sourceNode, styles, designValues);
  if (
    sourceNode.visual?.clipsContent &&
    sourceNode.bounds &&
    Math.abs(sourceNode.bounds.width - sourceNode.bounds.height) <= 1 &&
    childNodes.some(
      (child) =>
        child.kind === "image" &&
        child.bounds &&
        (child.bounds.x < sourceNode.bounds!.x ||
          child.bounds.y < sourceNode.bounds!.y ||
          child.bounds.x + child.bounds.width >
            sourceNode.bounds!.x + sourceNode.bounds!.width ||
          child.bounds.y + child.bounds.height >
            sourceNode.bounds!.y + sourceNode.bounds!.height),
    )
  ) {
    mapped.borderRadius = sourceNode.bounds.width / 2;
  }
  if (
    sourceNode.bounds &&
    Math.abs(sourceNode.bounds.width - sourceNode.bounds.height) <= 1 &&
    childNodes.some((child) => child.kind === "image") &&
    (/(avatar|profile|photo|portrait)/i.test(sourceNode.name ?? "") ||
      childNodes.some(
        (child) =>
          child.kind === "vector" &&
          (child.visual?.isMask === true || /mask/i.test(child.name ?? "")),
      ))
  ) {
    mapped.overflow = "hidden";
    mapped.borderRadius ??= sourceNode.bounds.width / 2;
  }
  if (
    sourceNode.bounds &&
    /(?:modal|dialog|popover|drawer)/i.test(sourceNode.name ?? "")
  ) {
    const roundedBackground = childNodes.find(
      (child) =>
        child.kind === "vector" &&
        child.bounds &&
        (child.visual?.fillCount ?? 0) > 0 &&
        child.visual?.cornerRadius !== undefined &&
        Math.abs(child.bounds.x - sourceNode.bounds!.x) <= 1 &&
        Math.abs(child.bounds.y - sourceNode.bounds!.y) <= 1 &&
        Math.abs(child.bounds.width - sourceNode.bounds!.width) <= 1 &&
        Math.abs(child.bounds.height - sourceNode.bounds!.height) <= 1,
    );
    if (roundedBackground?.visual?.cornerRadius !== undefined) {
      mapped.borderRadius ??= roundedBackground.visual.cornerRadius;
      mapped.overflow = "hidden";
    }
  }
  if (
    isButtonLike(sourceNode) &&
    sourceNode.visual?.clipsContent &&
    sourceNode.bounds &&
    mapped.backgroundColor &&
    mapped.borderRadius === undefined
  ) {
    const ratio = sourceNode.bounds.width / sourceNode.bounds.height;
    mapped.borderRadius = ratio >= 5 ? 8 : sourceNode.bounds.height / 2;
  }
  if (
    isInputLike(sourceNode) &&
    sourceNode.visual?.clipsContent &&
    sourceNode.bounds &&
    mapped.borderRadius === undefined
  ) {
    mapped.borderRadius = Math.min(12, sourceNode.bounds.height / 4);
  }
  if (
    !parentNode &&
    sourceNode.visual?.clipsContent &&
    (sourceNode.visual.strokeCount ?? 0) > 0 &&
    sourceNode.bounds &&
    Math.min(sourceNode.bounds.width, sourceNode.bounds.height) <= 480 &&
    mapped.borderRadius === undefined
  ) {
    mapped.borderRadius = 24;
  }
  return {
    ...mapped,
    ...frameStyleForNode(sourceNode, parentNode, zIndex),
  };
}

function visualLayerNodeForParent(
  layer: VisualLayerPlan,
  parentNode: NormalizedNode | undefined,
): UINode | undefined {
  if (!layer.uiNode) {
    return undefined;
  }
  if (!parentNode?.bounds) {
    return layer.uiNode;
  }
  const style = layer.uiNode.style;
  const leftDelta =
    typeof style?.left === "number"
      ? style.left - layer.pageRelativeBounds.x
      : 0;
  const topDelta =
    typeof style?.top === "number"
      ? style.top - layer.pageRelativeBounds.y
      : 0;
  const width =
    typeof style?.width === "number"
      ? style.width
      : layer.bounds.width;
  const height =
    typeof style?.height === "number"
      ? style.height
      : layer.bounds.height;

  return {
    ...layer.uiNode,
    style: {
      ...layer.uiNode.style,
      left: layer.bounds.x - parentNode.bounds.x + leftDelta,
      top: layer.bounds.y - parentNode.bounds.y + topDelta,
      width,
      height,
    },
  } as UINode;
}

function mapAlignItems(
  value: NonNullable<NormalizedNode["layout"]>["alignItems"],
): "start" | "center" | "end" | "stretch" | undefined {
  if (
    value === "start" ||
    value === "center" ||
    value === "end" ||
    value === "stretch"
  ) {
    return value;
  }
  return undefined;
}

function typographyWarnings(
  node: TextNode,
): Array<{ code: string; detail: string }> {
  const warnings: Array<{ code: string; detail: string }> = [];
  if (!node.text?.fontFamily) {
    warnings.push({
      code: "typography_missing_font_family",
      detail: `文本节点 ${node.id} 缺少 fontFamily，渲染会使用浏览器字体回退`,
    });
  }
  if (!node.text?.fontSize) {
    warnings.push({
      code: "typography_missing_font_size",
      detail: `文本节点 ${node.id} 缺少 fontSize，渲染会使用组件默认字号`,
    });
  }
  if (!node.text?.lineHeight) {
    warnings.push({
      code: "typography_missing_line_height",
      detail: `文本节点 ${node.id} 缺少 lineHeight，渲染会使用组件默认行高`,
    });
  }
  return warnings;
}

export interface MappedPageNodes {
  readonly rootNodeId: string;
  readonly nodes: UINode[];
  readonly stateEntries: UISpecDraft["state"];
  readonly warnings: Array<{ code: string; detail: string }>;
  readonly sourceToUiNodeId: Map<string, string>;
}

export interface MapPageNodesInput {
  readonly bundle: DesignBundle;
  readonly pagePlanId: string;
  readonly sourcePageId: string;
  readonly pagePath: string;
  readonly visualLayers: VisualLayerPlan[];
}

function sourceButtonAncestor(
  sourceNodeId: string,
  nodeById: ReadonlyMap<string, NormalizedNode>,
  parentByNodeId: ReadonlyMap<string, string | undefined>,
): NormalizedNode | undefined {
  let currentId = parentByNodeId.get(sourceNodeId);
  while (currentId) {
    const node = nodeById.get(currentId);
    if (node && isButtonLike(node)) {
      return node;
    }
    currentId = parentByNodeId.get(currentId);
  }
  return undefined;
}

const BRAND_BUTTON_PATTERN =
  /(?:google|facebook|github|apple|twitter|x\.com|microsoft|linkedin|slack)/i;
const PASSWORD_ICON_PATTERN = /(?:eye|show|hide|visibility)/i;
const SEARCH_ICON_PATTERN = /(?:search|magnif)/i;

export function mapPageNodes(
  input: MapPageNodesInput,
): MappedPageNodes {
  const page = input.bundle.pages.find(
    (candidate) => candidate.id === input.sourcePageId,
  );
  if (!page) {
    throw new Error(`Source page not found: ${input.sourcePageId}`);
  }

  const warnings: Array<{ code: string; detail: string }> = [];
  const nodes: UINode[] = [];
  const stateEntries: UISpecDraft["state"] = [];
  const pageNodes = page.nodes;
  const nodeBySourceId = new Map(pageNodes.map((node) => [node.id, node]));
  const componentById = new Map(
    input.bundle.components.map((component) => [component.id, component]),
  );
  const childrenByParent = new Map<string, NormalizedNode[]>();
  const parentById = new Map<string, string | undefined>();
  const sourceToUiNodeId = new Map<string, string>();
  const insertedVisualLayerIds = new Set<string>();
  const visualLayerSourceIds = new Set(
    input.visualLayers
      .filter((layer) => layer.rendered && layer.uiNode)
      .map((layer) => layer.sourceNodeId),
  );
  const backgroundCompositeSourceIds = new Set(
    input.visualLayers
      .filter((layer) => layer.reason === "background_composite")
      .map((layer) => layer.sourceNodeId),
  );
  const rootSourceNodeId = page.rootNodeIds[0];

  for (const node of pageNodes) {
    parentById.set(node.id, node.parentId);
    if (node.parentId) {
      const siblings = childrenByParent.get(node.parentId) ?? [];
      siblings.push(node);
      childrenByParent.set(node.parentId, siblings);
    }
  }

  function createStateKey(
    nodeId: string,
    options: {
      readonly valueType?: "string" | "boolean";
      readonly initialValue?: string | boolean;
    } = {},
  ): string {
    const valueType = options.valueType ?? "string";
    const key = `state-${input.pagePlanId}-${nodeId.replace(/[^a-z0-9_-]/gi, "-")}`;
    const existing = stateEntries.find((entry) => entry.key === key);
    if (existing) {
      if (
        existing.valueType === "string" &&
        typeof options.initialValue === "string" &&
        existing.initialValue === "" &&
        options.initialValue
      ) {
        existing.initialValue = options.initialValue;
      }
      if (
        existing.valueType === "boolean" &&
        typeof options.initialValue === "boolean" &&
        options.initialValue
      ) {
        existing.initialValue = true;
      }
    } else {
      if (valueType === "boolean") {
        stateEntries.push({
          key,
          valueType,
          initialValue:
            typeof options.initialValue === "boolean"
              ? options.initialValue
              : false,
        });
      } else {
        stateEntries.push({
          key,
          valueType,
          initialValue:
            typeof options.initialValue === "string"
              ? options.initialValue
              : "",
        });
      }
    }
    return key;
  }

  function componentDescriptor(sourceNode: NormalizedNode): string {
    const component = sourceNode.componentRef
      ? componentById.get(sourceNode.componentRef)
      : undefined;
    const propertyText = (sourceNode.componentProperties ?? [])
      .map((property) => `${property.name} ${String(property.value)}`)
      .join(" ");
    const variantText = Object.entries(sourceNode.variantProperties ?? {})
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(" ");
    return [
      sourceNode.name ?? "",
      component?.name ?? "",
      component?.description ?? "",
      propertyText,
      variantText,
    ].join(" ");
  }

  function inferComponentFamily(sourceNode: NormalizedNode): ComponentFamily {
    const descriptor = componentDescriptor(sourceNode);
    if (SWITCH_PATTERN.test(descriptor)) return "switch";
    if (RADIO_PATTERN.test(descriptor)) return "radio";
    if (CHECKBOX_PATTERN.test(descriptor)) return "checkbox";
    if (isFrameLikeNode(sourceNode) && isButtonLike(sourceNode)) return "button";
    if (isFrameLikeNode(sourceNode) && isSelectLikeInput(sourceNode)) {
      return "select";
    }
    if (isFrameLikeNode(sourceNode) && isInputLike(sourceNode)) return "input";
    if (MODAL_PATTERN.test(descriptor)) return "modal";
    if (TAG_PATTERN.test(descriptor)) return "tag";
    if (AVATAR_PATTERN.test(descriptor)) return "avatar";
    if (ICON_PATTERN.test(descriptor)) return "icon";
    return sourceNode.componentRef ||
      sourceNode.kind === "component" ||
      sourceNode.kind === "instance"
      ? "unknown"
      : "unknown";
  }

  function inferComponentState(sourceNode: NormalizedNode): ComponentState {
    const descriptor = componentDescriptor(sourceNode);
    if (DISABLED_STATE_PATTERN.test(descriptor)) return "disabled";
    if (ERROR_STATE_PATTERN.test(descriptor)) return "error";
    if (SELECTED_STATE_PATTERN.test(descriptor)) return "selected";
    if (HOVER_STATE_PATTERN.test(descriptor)) return "hover";
    return "default";
  }

  function sourceComponentForNode(
    sourceNode: NormalizedNode,
  ): UINode["sourceComponent"] {
    const family = inferComponentFamily(sourceNode);
    const state = inferComponentState(sourceNode);
    if (
      !sourceNode.componentRef &&
      sourceNode.kind !== "component" &&
      sourceNode.kind !== "instance" &&
      !sourceNode.componentProperties &&
      !sourceNode.variantProperties &&
      family === "unknown"
    ) {
      return undefined;
    }
    return {
      componentRef: sourceNode.componentRef,
      family,
      state,
      variantProperties: sourceNode.variantProperties,
    };
  }

  function isDisabledComponent(sourceNode: NormalizedNode): boolean {
    return sourceComponentForNode(sourceNode)?.state === "disabled";
  }

  function isSelectedComponent(sourceNode: NormalizedNode): boolean {
    return sourceComponentForNode(sourceNode)?.state === "selected";
  }

  function componentControlLabel(
    sourceNode: NormalizedNode,
    textHints: readonly string[],
  ): string {
    return textHints[0] ?? sourceNode.name ?? "Option";
  }

  function createComponentControlNode(
    sourceNode: NormalizedNode,
    uiNodeId: string,
    stateKeySourceId: string,
    textNodes: readonly TextNode[],
    textHints: readonly string[],
    style: UINode["style"],
  ): UINode | undefined {
    const sourceComponent = sourceComponentForNode(sourceNode);
    const family = sourceComponent?.family;
    if (
      family !== "checkbox" &&
      family !== "switch" &&
      family !== "radio"
    ) {
      return undefined;
    }
    const selected = isSelectedComponent(sourceNode);
    const disabled = isDisabledComponent(sourceNode) || undefined;
    const label = componentControlLabel(sourceNode, textHints);
    mapDescendantSourcesToControl(sourceNode, uiNodeId);
    if (family === "radio") {
      const value = optionValueFromLabel(label);
      return {
        id: uiNodeId,
        kind: "radio",
        label,
        stateKey: createStateKey(
          `${sourceNode.parentId ?? sourceNode.id}-radio-group`,
          {
            valueType: "string",
            initialValue: selected ? value : undefined,
          },
        ),
        value,
        disabled,
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style: {
          ...style,
          ...controlTextStyle(textNodes, 0),
        },
      };
    }
    return {
      id: uiNodeId,
      kind: family,
      label,
      stateKey: createStateKey(stateKeySourceId, {
        valueType: "boolean",
        initialValue: selected,
      }),
      disabled,
      sourceComponent,
      designValueRefs: [...sourceNode.designValueRefs],
      style: {
        ...style,
        ...controlTextStyle(textNodes, 0),
      },
    };
  }

  function descendantTextNodes(sourceNodeId: string): TextNode[] {
    const result: TextNode[] = [];
    const visit = (nodeId: string) => {
      for (const child of childrenByParent.get(nodeId) ?? []) {
        if (isTextNode(child)) {
          result.push(child);
        }
        visit(child.id);
      }
    };
    visit(sourceNodeId);
    return result.sort((left, right) => {
      const topDelta = (left.bounds?.y ?? 0) - (right.bounds?.y ?? 0);
      if (Math.abs(topDelta) > 1) {
        return topDelta;
      }
      return (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0);
    });
  }

  function mapDescendantSourcesToControl(
    sourceNode: NormalizedNode,
    uiNodeId: string,
  ): void {
    for (const text of descendantTextNodes(sourceNode.id)) {
      sourceToUiNodeId.set(text.id, uiNodeId);
    }
  }

  function descendantNodes(sourceNodeId: string): NormalizedNode[] {
    const result: NormalizedNode[] = [];
    const visit = (nodeId: string) => {
      for (const child of childrenByParent.get(nodeId) ?? []) {
        result.push(child);
        visit(child.id);
      }
    };
    visit(sourceNodeId);
    return result;
  }

  function isSelectLikeInput(sourceNode: NormalizedNode): boolean {
    if (!isInputLike(sourceNode)) {
      return false;
    }
    const indicatorNames = [
      sourceNode.name ?? "",
      ...descendantNodes(sourceNode.id).map((node) => node.name ?? ""),
    ].join(" ");
    if (SELECT_INDICATOR_PATTERN.test(indicatorNames)) {
      return true;
    }
    return input.visualLayers.some(
      (layer) =>
        layer.uiNode?.kind === "icon" &&
        layer.uiNode.symbol === "chevron-down" &&
        hasAncestor(layer.sourceNodeId, sourceNode.id),
    );
  }

  function createSelectNode(
    sourceNode: NormalizedNode,
    uiNodeId: string,
    stateKeySourceId: string,
    textNodes: readonly TextNode[],
    textHints: readonly string[],
    style: UINode["style"],
  ): UINode {
    const label = textHints[0] ?? sourceNode.name ?? "Select";
    const optionLabel = textHints[1] ?? textHints[0] ?? sourceNode.name ?? "Option";
    mapDescendantSourcesToControl(sourceNode, uiNodeId);
    return {
      id: uiNodeId,
      kind: "select",
      label,
      stateKey: createStateKey(stateKeySourceId),
      options: [
        {
          value: optionValueFromLabel(optionLabel),
          label: optionLabel,
        },
      ],
      placeholder: optionLabel,
      disabled: isDisabledComponent(sourceNode) || undefined,
      sourceComponent: sourceComponentForNode(sourceNode),
      designValueRefs: [...sourceNode.designValueRefs],
      style: {
        ...style,
        ...controlTextStyle(textNodes, textHints.length > 1 ? 1 : 0),
      },
    };
  }

  function hasAncestor(
    sourceNodeId: string,
    ancestorNodeId: string,
  ): boolean {
    let currentId = parentById.get(sourceNodeId);
    while (currentId) {
      if (currentId === ancestorNodeId) {
        return true;
      }
      currentId = parentById.get(currentId);
    }
    return false;
  }

  function hasBackgroundCompositeAncestor(sourceNodeId: string): boolean {
    let currentId = parentById.get(sourceNodeId);
    while (currentId) {
      if (
        currentId !== rootSourceNodeId &&
        backgroundCompositeSourceIds.has(currentId)
      ) {
        return true;
      }
      currentId = parentById.get(currentId);
    }
    return false;
  }

  function hasVisualLayerAncestor(sourceNodeId: string): boolean {
    let currentId = parentById.get(sourceNodeId);
    while (currentId) {
      if (visualLayerSourceIds.has(currentId)) {
        return true;
      }
      currentId = parentById.get(currentId);
    }
    return false;
  }

  function isIgnorableVectorPath(sourceNode: NormalizedNode): boolean {
    if (sourceNode.kind !== "vector" || !sourceNode.bounds) {
      return false;
    }
    if (
      (sourceNode.visual?.fillCount ?? 0) === 0 &&
      (sourceNode.visual?.strokeCount ?? 0) === 0 &&
      (sourceNode.visual?.effectCount ?? 0) === 0 &&
      sourceNode.imageRefs.length === 0
    ) {
      return true;
    }
    const area = sourceNode.bounds.width * sourceNode.bounds.height;
    const maxDim = Math.max(sourceNode.bounds.width, sourceNode.bounds.height);
    return area < 256 && maxDim <= 64;
  }

  function hasControlLikeAncestor(
    sourceNodeId: string,
    predicate: (node: NormalizedNode) => boolean,
  ): boolean {
    let currentId = parentById.get(sourceNodeId);
    while (currentId) {
      const ancestor = nodeBySourceId.get(currentId);
      if (ancestor && predicate(ancestor)) {
        return true;
      }
      currentId = parentById.get(currentId);
    }
    return false;
  }

  function hasDirectControlLikeChild(
    sourceNodeId: string,
    predicate: (node: NormalizedNode) => boolean,
  ): boolean {
    return (childrenByParent.get(sourceNodeId) ?? []).some(predicate);
  }

  function ancestorNodes(sourceNodeId: string): NormalizedNode[] {
    const result: NormalizedNode[] = [];
    let currentId = parentById.get(sourceNodeId);
    while (currentId) {
      const ancestor = nodeBySourceId.get(currentId);
      if (!ancestor) {
        break;
      }
      result.push(ancestor);
      currentId = parentById.get(currentId);
    }
    return result;
  }

  function buttonAllowsIconLayers(sourceNode: NormalizedNode): boolean {
    const text = descendantTextNodes(sourceNode.id)
      .map((node) => node.text?.characters ?? "")
      .join(" ");
    return BRAND_BUTTON_PATTERN.test(`${sourceNode.name ?? ""} ${text}`);
  }

  function inputAllowsIconLayer(sourceNodeId: string): boolean {
    const ancestors = ancestorNodes(sourceNodeId);
    const inputAncestors = ancestors.filter(isInputLike);
    if (inputAncestors.length === 0) {
      return false;
    }
    const iconNames = [
      nodeBySourceId.get(sourceNodeId)?.name ?? "",
      ...ancestors.map((node) => node.name ?? ""),
    ].join(" ");
    const inputText = inputAncestors
      .flatMap((node) => [
        node.name ?? "",
        ...descendantTextNodes(node.id).map(
          (textNode) => textNode.text?.characters ?? "",
        ),
      ])
      .join(" ");
    if (PASSWORD_ICON_PATTERN.test(iconNames) && /password|密码/i.test(inputText)) {
      return true;
    }
    if (SEARCH_ICON_PATTERN.test(iconNames) && /search|搜索/i.test(inputText)) {
      return true;
    }
    return false;
  }

  function controlOverlayStyle(
    sourceNode: NormalizedNode,
  ): UINode["style"] {
    return {
      position: "absolute",
      left: 0,
      top: 0,
      width: sourceNode.bounds?.width ?? 1,
      height: sourceNode.bounds?.height ?? 1,
      zIndex: 1_000,
      backgroundColor: "#FFFFFF00",
      textColor: "#FFFFFF00",
      borderWidth: 0,
    };
  }

  function controlTextStyle(
    textNodes: readonly TextNode[],
    preferredIndex: number,
  ): UINode["style"] {
    const textNode = textNodes[preferredIndex] ?? textNodes[0];
    if (!textNode) {
      return {};
    }
    const style = mapNodeStyle(
      textNode,
      input.bundle.styles,
      input.bundle.designValues,
    );
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textAlign: style.textAlign,
      whiteSpace: style.whiteSpace,
    };
  }

  function createControlOverlayNode(
    sourceNode: NormalizedNode,
    uiNodeId: string,
  ): UINode | undefined {
    const textNodes = descendantTextNodes(sourceNode.id);
    const textHints = textNodes
      .map((node) => node.text?.characters.trim())
      .filter((value): value is string => !!value);
    const componentControl = createComponentControlNode(
      sourceNode,
      `${uiNodeId}-control`,
      `${sourceNode.id}-control`,
      textNodes,
      textHints,
      {
        ...controlOverlayStyle(sourceNode),
      },
    );
    if (componentControl) {
      return componentControl;
    }
    if (isButtonLike(sourceNode)) {
      if (hasDirectControlLikeChild(sourceNode.id, isButtonLike)) {
        return undefined;
      }
      return {
        id: `${uiNodeId}-control`,
        kind: "button",
        label: textHints[0] ?? sourceNode.name ?? "Button",
        variant: "ghost",
        disabled: isDisabledComponent(sourceNode) || undefined,
        sourceComponent: sourceComponentForNode(sourceNode),
        designValueRefs: [...sourceNode.designValueRefs],
        style: {
          ...controlOverlayStyle(sourceNode),
          ...controlTextStyle(textNodes, 0),
        },
      };
    }
    if (isInputLike(sourceNode)) {
      if (hasControlLikeAncestor(sourceNode.id, isInputLike)) {
        return undefined;
      }
      if (isSelectLikeInput(sourceNode)) {
        return createSelectNode(
          sourceNode,
          `${uiNodeId}-control`,
          `${sourceNode.id}-control`,
          textNodes,
          textHints,
          {
            ...controlOverlayStyle(sourceNode),
          },
        );
      }
      return {
        id: `${uiNodeId}-control`,
        kind: "input",
        label: textHints[0] ?? sourceNode.name ?? "Input",
        stateKey: createStateKey(`${sourceNode.id}-control`),
        inputType: detectInputType(sourceNode, textHints),
        placeholder: textHints[1],
        disabled: isDisabledComponent(sourceNode) || undefined,
        sourceComponent: sourceComponentForNode(sourceNode),
        designValueRefs: [...sourceNode.designValueRefs],
        style: {
          ...controlOverlayStyle(sourceNode),
          ...controlTextStyle(textNodes, 1),
        },
      };
    }
    return undefined;
  }

  function mappedNonRootAncestorUiNodeId(
    sourceNodeId: string,
    rootSourceNodeId: string,
  ): string | undefined {
    let currentId = parentById.get(sourceNodeId);
    while (currentId) {
      if (currentId === rootSourceNodeId) {
        return undefined;
      }
      const uiNodeId = sourceToUiNodeId.get(currentId);
      if (uiNodeId) {
        return uiNodeId;
      }
      currentId = parentById.get(currentId);
    }
    return undefined;
  }

  function hasOnlyUnmappedVisualAncestorsBetween(
    sourceNodeId: string,
    ancestorNodeId: string,
  ): boolean {
    let currentId = parentById.get(sourceNodeId);
    let sawIntermediate = false;
    while (currentId) {
      if (currentId === ancestorNodeId) {
        return sawIntermediate;
      }
      sawIntermediate = true;
      if (sourceToUiNodeId.has(currentId)) {
        return false;
      }
      const currentNode = nodeBySourceId.get(currentId);
      const currentLayer = input.visualLayers.find(
        (layer) => layer.sourceNodeId === currentId,
      );
      if (
        currentNode?.kind !== "vector" ||
        !currentLayer ||
        currentLayer.rendered
      ) {
        return false;
      }
      currentId = parentById.get(currentId);
    }
    return false;
  }

  function mapNode(
    sourceNode: NormalizedNode,
    parentNode?: NormalizedNode,
  ): UINode | undefined {
    if (
      sourceNode.id !== rootSourceNodeId &&
      backgroundCompositeSourceIds.has(sourceNode.id)
    ) {
      sourceToUiNodeId.delete(sourceNode.id);
      return undefined;
    }
    const uiNodeId = stableUINodeId(input.pagePlanId, sourceNode.id);
    sourceToUiNodeId.set(sourceNode.id, uiNodeId);
    const zIndex = pageNodes.findIndex((node) => node.id === sourceNode.id);
    const children = childrenByParent.get(sourceNode.id) ?? [];

    if (!sourceNode.visible) {
      sourceToUiNodeId.delete(sourceNode.id);
      return undefined;
    }

    if (
      parentNode &&
      sourceNode.bounds &&
      (sourceNode.bounds.width <= 0 || sourceNode.bounds.height <= 0)
    ) {
      sourceToUiNodeId.delete(sourceNode.id);
      return undefined;
    }

    const style = mappedStyleForNode(
      sourceNode,
      input.bundle.styles,
      input.bundle.designValues,
      parentNode,
      zIndex < 0 ? 0 : zIndex,
      children,
    );
    const sourceComponent = sourceComponentForNode(sourceNode);

    if (isTextNode(sourceNode)) {
      warnings.push(...typographyWarnings(sourceNode));
      return {
        id: uiNodeId,
        kind: "text",
        text: sourceNode.text?.characters ?? "",
        variant: pickTextVariant(sourceNode),
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
    }

    if (isImageNode(sourceNode)) {
      const assetRef = sourceNode.imageRefs[0];
      if (!assetRef) {
        sourceToUiNodeId.delete(sourceNode.id);
        warnings.push({
          code: "image_node_missing_asset",
          detail: `图片节点 ${sourceNode.id} 没有可用资产`,
        });
        return undefined;
      }
      return {
        id: uiNodeId,
        kind: "image",
        assetRef,
        alt: sourceNode.name ?? "Image",
        fit: "cover",
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
    }

    const directComponentControl = parentNode && children.length === 0
      ? createComponentControlNode(
          sourceNode,
          uiNodeId,
          sourceNode.id,
          [],
          [],
          style,
        )
      : undefined;
    if (directComponentControl) {
      return directComponentControl;
    }

    if (children.length === 0 && parentNode && isButtonLike(sourceNode)) {
      const textNodes = descendantTextNodes(sourceNode.id);
      const label =
        textNodes
          .map((node) => node.text?.characters.trim())
          .find((value): value is string => !!value) ??
        sourceNode.name ??
        "Button";
      mapDescendantSourcesToControl(sourceNode, uiNodeId);
      return {
        id: uiNodeId,
        kind: "button",
        label,
        variant: "primary",
        disabled: isDisabledComponent(sourceNode) || undefined,
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
    }

    if (children.length === 0 && parentNode && isInputLike(sourceNode)) {
      const textNodes = descendantTextNodes(sourceNode.id);
      const textHints = textNodes
        .map((node) => node.text?.characters.trim())
        .filter((value): value is string => !!value);
      if (isSelectLikeInput(sourceNode)) {
        return createSelectNode(
          sourceNode,
          uiNodeId,
          sourceNode.id,
          textNodes,
          textHints,
          style,
        );
      }
      const label = textHints[0] ?? sourceNode.name ?? "Input";
      const placeholder = textHints[1];
      mapDescendantSourcesToControl(sourceNode, uiNodeId);
      return {
        id: uiNodeId,
        kind: "input",
        label,
        stateKey: createStateKey(sourceNode.id),
        inputType: detectInputType(sourceNode, textHints),
        placeholder,
        disabled: isDisabledComponent(sourceNode) || undefined,
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
    }

    if (isFrameLikeNode(sourceNode) && children.length > 0) {
      const childIds: string[] = [];

      for (const child of children) {
        const mapped = mapNode(child, sourceNode);
        if (mapped) {
          childIds.push(mapped.id);
          nodes.push(mapped);
        }
      }

      for (const layer of input.visualLayers) {
        if (!layer.uiNode || !layer.uiNodeId) {
          continue;
        }
        if (hasBackgroundCompositeAncestor(layer.sourceNodeId)) {
          continue;
        }
        if (insertedVisualLayerIds.has(layer.uiNodeId)) {
          continue;
        }
        if (layer.layerRole === "button_icon") {
          const buttonSource = sourceButtonAncestor(
            layer.sourceNodeId,
            nodeBySourceId,
            parentById,
          );
          if (buttonSource && !buttonAllowsIconLayers(buttonSource)) {
            continue;
          }
          const hasInputAncestor = ancestorNodes(layer.sourceNodeId).some(
            isInputLike,
          );
          if (
            !buttonSource &&
            hasInputAncestor &&
            !inputAllowsIconLayer(layer.sourceNodeId)
          ) {
            continue;
          }
        }
        const layerParent = nodeBySourceId.get(layer.sourceNodeId)
          ?.parentId;
        const acceptsNestedControlLayer =
          hasAncestor(layer.sourceNodeId, sourceNode.id) &&
          (isInputLike(sourceNode) ||
            (isButtonLike(sourceNode) &&
              buttonAllowsIconLayers(sourceNode)));
        const acceptsUnmappedVisualParentLayer =
          hasOnlyUnmappedVisualAncestorsBetween(
            layer.sourceNodeId,
            sourceNode.id,
          );
        if (
          layerParent === sourceNode.id ||
          acceptsNestedControlLayer ||
          acceptsUnmappedVisualParentLayer
        ) {
          childIds.push(layer.uiNodeId);
          const layerNode = visualLayerNodeForParent(layer, sourceNode);
          if (layerNode) {
            nodes.push(layerNode);
          }
          insertedVisualLayerIds.add(layer.uiNodeId);
        }
      }

      const controlOverlay =
        parentNode && createControlOverlayNode(sourceNode, uiNodeId);
      if (controlOverlay) {
        childIds.push(controlOverlay.id);
        nodes.push(controlOverlay);
        sourceToUiNodeId.set(sourceNode.id, controlOverlay.id);
      }

      const useSection =
        parentNode === undefined &&
        (sourceNode.name?.toLowerCase().includes("root") ?? false);

      if (useSection) {
        return {
          id: uiNodeId,
          kind: "section",
          semantic: "main",
          childIds,
          sourceComponent,
          designValueRefs: [...sourceNode.designValueRefs],
          style,
        };
      }

      const stackNode = {
        id: uiNodeId,
        kind: "stack" as const,
        direction:
          sourceNode.layout?.direction === "horizontal"
            ? "horizontal"
            : "vertical",
        childIds,
        gap: sourceNode.layout?.gap,
        padding: sourceNode.layout?.paddingTop,
        align: mapAlignItems(sourceNode.layout?.alignItems),
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
      return stackNode as UINode;
    }

    if (isButtonLike(sourceNode)) {
      return {
        id: uiNodeId,
        kind: "button",
        label: sourceNode.name ?? "Button",
        variant: "primary",
        disabled: isDisabledComponent(sourceNode) || undefined,
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
    }

    if (isInputLike(sourceNode)) {
      if (isSelectLikeInput(sourceNode)) {
        return createSelectNode(
          sourceNode,
          uiNodeId,
          sourceNode.id,
          [],
          [],
          style,
        );
      }
      return {
        id: uiNodeId,
        kind: "input",
        label: sourceNode.name ?? "Input",
        stateKey: createStateKey(sourceNode.id),
        inputType: detectInputType(sourceNode),
        disabled: isDisabledComponent(sourceNode) || undefined,
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      };
    }

    if (isFrameLikeNode(sourceNode)) {
      return {
        id: uiNodeId,
        kind: "stack",
        direction: "vertical",
        childIds: [],
        sourceComponent,
        designValueRefs: [...sourceNode.designValueRefs],
        style,
      } as UINode;
    }

    const isVisualLayer = input.visualLayers.some(
      (layer) => layer.sourceNodeId === sourceNode.id,
    );
    const isCoveredByVisualLayerAncestor =
      sourceNode.kind === "vector" && hasVisualLayerAncestor(sourceNode.id);

    if (
      sourceNode.kind === "component" ||
      sourceNode.kind === "unsupported" ||
      (sourceNode.kind === "vector" &&
        !isVisualLayer &&
        !isCoveredByVisualLayerAncestor &&
        !isIgnorableVectorPath(sourceNode))
    ) {
      sourceToUiNodeId.delete(sourceNode.id);
      warnings.push({
        code: `unmapped_node_${sourceNode.kind}`,
        detail: `未映射的节点类型 ${sourceNode.kind}: ${sourceNode.id}`,
      });
    }

    if (
      sourceNode.kind === "vector" &&
      (isVisualLayer || isCoveredByVisualLayerAncestor)
    ) {
      sourceToUiNodeId.delete(sourceNode.id);
    }

    return undefined;
  }

  const rootNode = pageNodes.find(
    (node) => node.id === page.rootNodeIds[0],
  );
  if (!rootNode) {
    throw new Error(`Root node not found for page ${input.sourcePageId}`);
  }

  const mappedRoot = mapNode(rootNode);
  if (!mappedRoot) {
    throw new Error(`Could not map root node for page ${input.sourcePageId}`);
  }

  for (const layer of input.visualLayers) {
    if (!layer.uiNode || !layer.uiNodeId) {
      continue;
    }
    if (hasBackgroundCompositeAncestor(layer.sourceNodeId)) {
      continue;
    }
    if (insertedVisualLayerIds.has(layer.uiNodeId)) {
      continue;
    }
    const layerNode = nodeBySourceId.get(layer.sourceNodeId);
    if (layerNode?.parentId === rootNode.id) {
      continue;
    }
    if (mappedNonRootAncestorUiNodeId(layer.sourceNodeId, rootNode.id)) {
      continue;
    }
    if (mappedRoot.kind === "section" || mappedRoot.kind === "stack") {
      if (!mappedRoot.childIds.includes(layer.uiNodeId)) {
        mappedRoot.childIds.push(layer.uiNodeId);
        nodes.push(layer.uiNode);
        insertedVisualLayerIds.add(layer.uiNodeId);
      }
    }
  }

  for (const layer of input.visualLayers) {
    if (
      layer.layerRole !== "button_icon" ||
      layer.uiNode ||
      !layer.assetRef ||
      !layer.rendered
    ) {
      continue;
    }
    if (hasBackgroundCompositeAncestor(layer.sourceNodeId)) {
      continue;
    }
    const buttonSource = sourceButtonAncestor(
      layer.sourceNodeId,
      nodeBySourceId,
      parentById,
    );
    if (!buttonSource) {
      continue;
    }
    if (!buttonAllowsIconLayers(buttonSource)) {
      continue;
    }
    const buttonUiNodeId = sourceToUiNodeId.get(buttonSource.id);
    if (!buttonUiNodeId) {
      continue;
    }
    const buttonUiNode = nodes.find(
      (node): node is Extract<UINode, { kind: "button" }> =>
        node.id === buttonUiNodeId && node.kind === "button",
    );
    if (!buttonUiNode) {
      continue;
    }
    if (!buttonUiNode.leadingIconAssetRef) {
      buttonUiNode.leadingIconAssetRef = layer.assetRef;
    } else if (!buttonUiNode.trailingIconAssetRef) {
      buttonUiNode.trailingIconAssetRef = layer.assetRef;
    }
  }

  nodes.push(mappedRoot);

  return {
    rootNodeId: mappedRoot.id,
    nodes,
    stateEntries,
    warnings,
    sourceToUiNodeId,
  };
}
