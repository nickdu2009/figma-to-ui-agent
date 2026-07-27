import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  DesignBundleWarning,
  NormalizedComponent,
  NormalizedDesignValue,
  NormalizedNode,
  NormalizedPage,
  NormalizedStyle,
  ProvenanceEntry,
} from "../design-bundle/schema.ts";
import { normalizeFigmaNodeId } from "./url.ts";
import {
  analyzeVisualAssetCandidates,
} from "../static-generation/visual-asset-priority.ts";

const DEFAULT_MAX_NODES = 50_000;
const DEFAULT_MAX_DEPTH = 100;

const rawNodeSchema = z
  .object({
    id: z.string().min(1).max(512),
    name: z.string().max(2_000).optional(),
    type: z.string().min(1).max(128),
    visible: z.boolean().optional(),
    children: z.array(z.unknown()).optional(),
    absoluteBoundingBox: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .passthrough()
      .nullable()
      .optional(),
    layoutMode: z.string().optional(),
    itemSpacing: z.number().finite().optional(),
    paddingTop: z.number().finite().optional(),
    paddingRight: z.number().finite().optional(),
    paddingBottom: z.number().finite().optional(),
    paddingLeft: z.number().finite().optional(),
    primaryAxisAlignItems: z.string().optional(),
    counterAxisAlignItems: z.string().optional(),
    characters: z.string().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    styles: z.record(z.string(), z.unknown()).optional(),
    fills: z.array(z.unknown()).optional(),
    strokes: z.array(z.unknown()).optional(),
    strokeWeight: z.unknown().optional(),
    effects: z.array(z.unknown()).optional(),
    vectorPaths: z.array(z.unknown()).optional(),
    cornerRadius: z.unknown().optional(),
    rectangleCornerRadii: z.array(z.unknown()).optional(),
    opacity: z.number().min(0).max(1).optional(),
    blendMode: z.string().max(128).optional(),
    isMask: z.boolean().optional(),
    clipsContent: z.boolean().optional(),
    boundVariables: z.record(z.string(), z.unknown()).optional(),
    componentId: z.string().optional(),
    componentProperties: z.record(z.string(), z.unknown()).optional(),
    variantProperties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const rawFileSchema = z
  .object({
    document: z.unknown(),
    components: z
      .record(z.string(), z.unknown())
      .optional()
      .default({}),
    componentSets: z
      .record(z.string(), z.unknown())
      .optional()
      .default({}),
    styles: z
      .record(z.string(), z.unknown())
      .optional()
      .default({}),
  })
  .passthrough();

type RawNode = z.infer<typeof rawNodeSchema>;
type RawFile = z.infer<typeof rawFileSchema>;

interface IndexedNode {
  node: RawNode;
  parentId?: string;
  canvasId?: string;
  order: number;
}

export type FigmaNormalizationErrorCode =
  | "invalid_payload"
  | "invalid_document"
  | "duplicate_node_id"
  | "target_not_found"
  | "node_limit_exceeded"
  | "depth_limit_exceeded";

export class FigmaNormalizationError extends Error {
  readonly code: FigmaNormalizationErrorCode;

  constructor(
    code: FigmaNormalizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FigmaNormalizationError";
    this.code = code;
  }
}

export interface NormalizeFigmaOptions {
  targetNodeIds?: readonly string[];
  imagePathBySourceRef?: ReadonlyMap<string, string>;
  maxNodes?: number;
  maxDepth?: number;
}

export interface FigmaImageSourceReference {
  nodeId: string;
  sourceRef: string;
}

export type FigmaVisualLayerReason =
  | "image_fill"
  | "button_icon"
  | "named_logo"
  | "nav_header_icon"
  | "line_or_divider"
  | "large_visual"
  | "named_icon"
  | "named_decorative"
  | "structural_visual";

export interface FigmaVisualLayerReference {
  nodeId: string;
  reason: FigmaVisualLayerReason;
}

export interface FigmaBoundVariableSource {
  sourceIdHash: string;
  sourceVariableId: string;
}

export type FigmaObservedDesignValue =
  | { r: number; g: number; b: number; a: number }
  | number
  | string
  | boolean;

export interface FigmaBindingObservation {
  nodeId: string;
  property: string;
  sourceIdHash: string;
  sourceVariableId: string;
  resolvedValue?: FigmaObservedDesignValue;
}

export interface NormalizedFigmaDocument {
  pages: NormalizedPage[];
  components: NormalizedComponent[];
  styles: NormalizedStyle[];
  designValues: NormalizedDesignValue[];
  imageSourceRefs: FigmaImageSourceReference[];
  visualLayerRefs: FigmaVisualLayerReference[];
  boundVariableSources: FigmaBoundVariableSource[];
  bindingObservations: FigmaBindingObservation[];
  provenance: ProvenanceEntry[];
  warnings: DesignBundleWarning[];
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableObservedValue(value: FigmaObservedDesignValue): string {
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  return JSON.stringify({
    r: value.r,
    g: value.g,
    b: value.b,
    a: value.a,
  });
}

function scalarValue(value: unknown): string | number | boolean | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return undefined;
}

function normalizedComponentPropertyType(
  value: unknown,
): "BOOLEAN" | "INSTANCE_SWAP" | "TEXT" | "VARIANT" | "UNKNOWN" {
  return value === "BOOLEAN" ||
    value === "INSTANCE_SWAP" ||
    value === "TEXT" ||
    value === "VARIANT"
    ? value
    : "UNKNOWN";
}

function directFillDesignValue(
  color: Extract<FigmaObservedDesignValue, object>,
): NormalizedDesignValue {
  const key = stableObservedValue(color);
  const suffix = stableHash(key);
  return {
    id: `inferred.${suffix}`,
    name: `color.fill.${suffix.slice(0, 8)}`,
    origin: "inferred",
    kind: "color",
    value: color,
  };
}

function parsePositiveLimit(
  value: number | undefined,
  fallback: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new FigmaNormalizationError(
      "invalid_payload",
      "标准化限制必须是正整数",
    );
  }
  return resolved;
}

function parseRawNode(value: unknown): RawNode {
  const result = rawNodeSchema.safeParse(value);
  if (!result.success) {
    throw new FigmaNormalizationError(
      "invalid_payload",
      "Figma 节点载荷结构无效",
    );
  }
  return result.data;
}

function visibleCanvasChildIds(node: RawNode): string[] {
  return (node.children ?? [])
    .map(parseRawNode)
    .filter((child) => child.visible !== false)
    .map((child) => child.id);
}

function normalizedBounds(node: RawNode): NormalizedNode["bounds"] {
  const bounds = node.absoluteBoundingBox;
  if (!bounds) {
    return undefined;
  }
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function normalizedAxisAlignment(
  value: string | undefined,
): "start" | "center" | "end" | "space_between" | undefined {
  if (value === "MIN") {
    return "start";
  }
  if (value === "CENTER") {
    return "center";
  }
  if (value === "MAX") {
    return "end";
  }
  if (value === "SPACE_BETWEEN") {
    return "space_between";
  }
  return undefined;
}

function normalizedCounterAlignment(
  value: string | undefined,
): "start" | "center" | "end" | "stretch" | "baseline" | undefined {
  if (value === "MIN") {
    return "start";
  }
  if (value === "CENTER") {
    return "center";
  }
  if (value === "MAX") {
    return "end";
  }
  if (value === "BASELINE") {
    return "baseline";
  }
  return undefined;
}

function normalizedLayout(node: RawNode): NormalizedNode["layout"] {
  const direction =
    node.layoutMode === "HORIZONTAL"
      ? "horizontal"
      : node.layoutMode === "VERTICAL"
        ? "vertical"
        : "none";
  const layout: NonNullable<NormalizedNode["layout"]> = { direction };
  const finiteNonnegative = (
    value: number | undefined,
  ): number | undefined =>
    value !== undefined && value >= 0 ? value : undefined;

  layout.gap = finiteNonnegative(node.itemSpacing);
  layout.paddingTop = finiteNonnegative(node.paddingTop);
  layout.paddingRight = finiteNonnegative(node.paddingRight);
  layout.paddingBottom = finiteNonnegative(node.paddingBottom);
  layout.paddingLeft = finiteNonnegative(node.paddingLeft);
  layout.alignItems = normalizedCounterAlignment(
    node.counterAxisAlignItems,
  );
  layout.justifyContent = normalizedAxisAlignment(
    node.primaryAxisAlignItems,
  );

  if (
    direction === "none" &&
    Object.values(layout).every(
      (value) => value === undefined || value === "none",
    )
  ) {
    return undefined;
  }
  return layout;
}

function normalizedText(node: RawNode): NormalizedNode["text"] {
  if (node.type !== "TEXT") {
    return undefined;
  }
  const style = node.style ?? {};
  const optionalNumber = (key: string): number | undefined => {
    const value = style[key];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  };
  const fontFamily =
    typeof style.fontFamily === "string" && style.fontFamily.length > 0
      ? style.fontFamily
      : undefined;
  const textAlign =
    style.textAlignHorizontal === "LEFT" ||
    style.textAlignHorizontal === "CENTER" ||
    style.textAlignHorizontal === "RIGHT" ||
    style.textAlignHorizontal === "JUSTIFIED"
      ? style.textAlignHorizontal.toLowerCase().replace(
          "justified",
          "justify",
        )
      : undefined;

  return {
    characters: node.characters ?? "",
    fontFamily,
    fontSize: optionalNumber("fontSize"),
    fontWeight: optionalNumber("fontWeight"),
    lineHeight: optionalNumber("lineHeightPx"),
    letterSpacing: optionalNumber("letterSpacing"),
    textAlign: textAlign as
      | "left"
      | "center"
      | "right"
      | "justify"
      | undefined,
  };
}

function normalizedComponentProperties(
  node: RawNode,
): NormalizedNode["componentProperties"] {
  const properties = node.componentProperties;
  if (!properties) {
    return undefined;
  }
  const result = Object.entries(properties)
    .flatMap(([name, raw]) => {
      if (!raw || typeof raw !== "object") {
        return [];
      }
      const value = scalarValue(Reflect.get(raw, "value"));
      if (value === undefined) {
        return [];
      }
      const rawName = Reflect.get(raw, "name");
      return [
        {
          name:
            typeof rawName === "string" && rawName.trim()
              ? rawName.trim()
              : name,
          type: normalizedComponentPropertyType(Reflect.get(raw, "type")),
          value,
        },
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  return result.length > 0 ? result : undefined;
}

function normalizedVariantProperties(
  node: RawNode,
): NormalizedNode["variantProperties"] {
  const properties = node.variantProperties;
  if (!properties) {
    return undefined;
  }
  const result = Object.fromEntries(
    Object.entries(properties)
      .flatMap(([name, value]) => {
        const scalar = scalarValue(value);
        return scalar === undefined ? [] : [[name, scalar] as const];
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

function nodeKind(node: RawNode, hasImageFill: boolean): NormalizedNode["kind"] {
  if (hasImageFill) {
    return "image";
  }
  if (
    node.type === "FRAME" ||
    node.type === "GROUP" ||
    node.type === "SECTION" ||
    node.type === "DOCUMENT" ||
    node.type === "CANVAS"
  ) {
    return "container";
  }
  if (node.type === "TEXT") {
    return "text";
  }
  if (node.type === "INSTANCE") {
    return "instance";
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    return "component";
  }
  if (
    node.type === "VECTOR" ||
    node.type === "BOOLEAN_OPERATION" ||
    node.type === "STAR" ||
    node.type === "LINE" ||
    node.type === "ELLIPSE" ||
    node.type === "POLYGON" ||
    node.type === "RECTANGLE"
  ) {
    return "vector";
  }
  return "unsupported";
}

function visibleCollectionCount(values: readonly unknown[] | undefined): number {
  return (values ?? []).filter((value) => {
    if (!value || typeof value !== "object") {
      return false;
    }
    if (Reflect.get(value, "visible") === false) {
      return false;
    }
    return true;
  }).length;
}

function visiblePaintCount(values: readonly unknown[] | undefined): number {
  return (values ?? []).filter((fill) => {
    if (!fill || typeof fill !== "object") {
      return false;
    }
    if (Reflect.get(fill, "visible") === false) {
      return false;
    }
    return typeof Reflect.get(fill, "type") === "string";
  }).length;
}

function firstSolidPaintColor(values: readonly unknown[] | undefined):
  | { r: number; g: number; b: number; a: number }
  | undefined {
  for (const paint of values ?? []) {
    if (
      !paint ||
      typeof paint !== "object" ||
      Reflect.get(paint, "visible") === false ||
      Reflect.get(paint, "type") !== "SOLID"
    ) {
      continue;
    }
    const color = Reflect.get(paint, "color");
    if (!color || typeof color !== "object") {
      continue;
    }
    const r = Reflect.get(color, "r");
    const g = Reflect.get(color, "g");
    const b = Reflect.get(color, "b");
    const opacity = Reflect.get(paint, "opacity");
    if (
      typeof r === "number" &&
      typeof g === "number" &&
      typeof b === "number"
    ) {
      return {
        r,
        g,
        b,
        a: typeof opacity === "number" ? opacity : 1,
      };
    }
  }
  return undefined;
}

function normalizedCornerRadius(node: RawNode): number | undefined {
  if (typeof node.cornerRadius === "number") {
    return node.cornerRadius;
  }
  if (!node.rectangleCornerRadii) {
    return undefined;
  }
  const [topLeft, topRight, bottomRight, bottomLeft] =
    node.rectangleCornerRadii;
  if (
    typeof topLeft !== "number" ||
    typeof topRight !== "number" ||
    typeof bottomRight !== "number" ||
    typeof bottomLeft !== "number"
  ) {
    return undefined;
  }
  return topLeft === topRight &&
    topLeft === bottomRight &&
    topLeft === bottomLeft
    ? topLeft
    : undefined;
}

function normalizedVisualMetadata(
  node: RawNode,
): NormalizedNode["visual"] | undefined {
  const opacity = typeof node.opacity === "number" ? node.opacity : undefined;
  const blendMode =
    typeof node.blendMode === "string" && node.blendMode.length > 0
      ? node.blendMode
      : undefined;
  const fillCount = visiblePaintCount(node.fills);
  const strokeCount = visiblePaintCount(node.strokes);
  const strokeWeight =
    strokeCount > 0 && typeof node.strokeWeight === "number"
      ? node.strokeWeight
      : undefined;
  const strokeColor =
    strokeCount > 0 ? firstSolidPaintColor(node.strokes) : undefined;
  const effectCount = visibleCollectionCount(node.effects);
  const vectorPathCount = Array.isArray(node.vectorPaths)
    ? node.vectorPaths.length
    : 0;
  const cornerRadius = normalizedCornerRadius(node);
  const hasSignal =
    opacity !== undefined ||
    blendMode !== undefined ||
    fillCount > 0 ||
    strokeCount > 0 ||
    strokeWeight !== undefined ||
    strokeColor !== undefined ||
    effectCount > 0 ||
    vectorPathCount > 0 ||
    cornerRadius !== undefined ||
    node.isMask !== undefined ||
    node.clipsContent !== undefined;
  if (!hasSignal) {
    return undefined;
  }
  return {
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blendMode !== undefined ? { blendMode } : {}),
    fillCount,
    strokeCount,
    ...(strokeWeight !== undefined ? { strokeWeight } : {}),
    ...(strokeColor !== undefined ? { strokeColor } : {}),
    effectCount,
    vectorPathCount,
    ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    ...(node.isMask !== undefined ? { isMask: node.isMask } : {}),
    ...(node.clipsContent !== undefined
      ? { clipsContent: node.clipsContent }
      : {}),
  };
}

function imageSourceRefs(node: RawNode): string[] {
  const refs: string[] = [];
  for (const fill of node.fills ?? []) {
    if (!fill || typeof fill !== "object") {
      continue;
    }
    if (
      Reflect.get(fill, "type") === "IMAGE" &&
      typeof Reflect.get(fill, "imageRef") === "string"
    ) {
      refs.push(Reflect.get(fill, "imageRef") as string);
    }
  }
  return [...new Set(refs)];
}

function firstSolidColor(node: RawNode):
  | { r: number; g: number; b: number; a: number }
  | undefined {
  for (const fill of node.fills ?? []) {
    if (
      !fill ||
      typeof fill !== "object" ||
      Reflect.get(fill, "type") !== "SOLID"
    ) {
      continue;
    }
    const color = Reflect.get(fill, "color");
    if (!color || typeof color !== "object") {
      continue;
    }
    const r = Reflect.get(color, "r");
    const g = Reflect.get(color, "g");
    const b = Reflect.get(color, "b");
    const opacity = Reflect.get(fill, "opacity");
    if (
      typeof r === "number" &&
      typeof g === "number" &&
      typeof b === "number"
    ) {
      return {
        r,
        g,
        b,
        a: typeof opacity === "number" ? opacity : 1,
      };
    }
  }
  return undefined;
}

function collectVariableIds(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectVariableIds(item, output));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (
    Reflect.get(value, "type") === "VARIABLE_ALIAS" &&
    typeof Reflect.get(value, "id") === "string"
  ) {
    output.add(Reflect.get(value, "id") as string);
  }
  for (const nested of Object.values(value)) {
    collectVariableIds(nested, output);
  }
}

function bindingResolvedValue(
  node: RawNode,
  property: string,
): FigmaObservedDesignValue | undefined {
  const normalizedProperty = property.toLowerCase();
  if (normalizedProperty === "fills") {
    return firstSolidColor(node);
  }
  if (normalizedProperty === "characters") {
    return node.characters;
  }
  if (normalizedProperty === "visible") {
    return node.visible ?? true;
  }

  const layoutValues: Record<string, number | undefined> = {
    itemspacing: node.itemSpacing,
    paddingtop: node.paddingTop,
    paddingright: node.paddingRight,
    paddingbottom: node.paddingBottom,
    paddingleft: node.paddingLeft,
  };
  const layoutValue = layoutValues[normalizedProperty];
  if (layoutValue !== undefined && Number.isFinite(layoutValue)) {
    return layoutValue;
  }

  const style = node.style ?? {};
  const styleKeyByProperty: Record<string, string> = {
    fontfamily: "fontFamily",
    fontsize: "fontSize",
    fontweight: "fontWeight",
    lineheight: "lineHeightPx",
    letterspacing: "letterSpacing",
  };
  const styleKey = styleKeyByProperty[normalizedProperty];
  const styleValue = styleKey ? style[styleKey] : undefined;
  if (
    typeof styleValue === "string" ||
    typeof styleValue === "boolean" ||
    (typeof styleValue === "number" && Number.isFinite(styleValue))
  ) {
    return styleValue;
  }

  const rawValue = Reflect.get(node, property);
  if (
    typeof rawValue === "string" ||
    typeof rawValue === "boolean" ||
    (typeof rawValue === "number" && Number.isFinite(rawValue))
  ) {
    return rawValue;
  }
  return undefined;
}

function bindingObservationsForNode(
  node: RawNode,
): FigmaBindingObservation[] {
  const observations: FigmaBindingObservation[] = [];
  for (const [property, rawBinding] of Object.entries(
    node.boundVariables ?? {},
  )) {
    const variableIds = new Set<string>();
    collectVariableIds(rawBinding, variableIds);
    const resolvedValue = bindingResolvedValue(node, property);
    for (const sourceVariableId of variableIds) {
      observations.push({
        nodeId: node.id,
        property,
        sourceIdHash: stableHash(sourceVariableId),
        sourceVariableId,
        resolvedValue,
      });
    }
  }
  return observations;
}

function metadataName(
  metadata: unknown,
): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const name = Reflect.get(metadata, "name");
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function buildComponentCatalog(
  file: RawFile,
  warnings: DesignBundleWarning[],
): Map<string, NormalizedComponent> {
  const output = new Map<string, NormalizedComponent>();
  const addEntries = (
    entries: Record<string, unknown>,
    sourceType: "component" | "component_set",
  ) => {
    for (const [id, metadata] of Object.entries(entries)) {
      const name = metadataName(metadata);
      if (!name) {
        warnings.push({
          code: "component_metadata_incomplete",
          entityId: id,
          detail: "组件元数据缺少名称，未纳入组件目录",
        });
        continue;
      }
      const description =
        metadata &&
        typeof metadata === "object" &&
        typeof Reflect.get(metadata, "description") === "string"
          ? (Reflect.get(metadata, "description") as string)
          : undefined;
      output.set(id, {
        id,
        name,
        sourceType,
        description,
      });
    }
  };
  addEntries(file.components, "component");
  addEntries(file.componentSets, "component_set");
  return output;
}

function styleMetadataLookup(
  styles: Record<string, unknown>,
): Map<string, unknown> {
  const output = new Map<string, unknown>();
  for (const [id, metadata] of Object.entries(styles)) {
    output.set(id, metadata);
    if (
      metadata &&
      typeof metadata === "object" &&
      typeof Reflect.get(metadata, "key") === "string"
    ) {
      output.set(Reflect.get(metadata, "key") as string, metadata);
    }
  }
  return output;
}

function styleRefsForNode(
  node: RawNode,
  metadataById: Map<string, unknown>,
  styles: Map<string, NormalizedStyle>,
  warnings: DesignBundleWarning[],
): string[] {
  const refs: string[] = [];
  for (const [slot, rawId] of Object.entries(node.styles ?? {})) {
    if (typeof rawId !== "string") {
      continue;
    }
    if (styles.has(rawId)) {
      refs.push(rawId);
      continue;
    }
    const metadata = metadataById.get(rawId);
    const name = metadataName(metadata) ?? `style-${stableHash(rawId).slice(0, 8)}`;
    const color = firstSolidColor(node);
    if (slot.toLowerCase().includes("fill") && color) {
      styles.set(rawId, {
        id: rawId,
        name,
        kind: "color",
        value: color,
      });
      refs.push(rawId);
      continue;
    }
    if (slot.toLowerCase().includes("text") && node.type === "TEXT") {
      const text = normalizedText(node);
      if (
        text?.fontFamily &&
        text.fontSize &&
        text.fontWeight &&
        text.lineHeight &&
        text.letterSpacing !== undefined
      ) {
        styles.set(rawId, {
          id: rawId,
          name,
          kind: "typography",
          value: {
            fontFamily: text.fontFamily,
            fontSize: text.fontSize,
            fontWeight: text.fontWeight,
            lineHeight: text.lineHeight,
            letterSpacing: text.letterSpacing,
          },
        });
        refs.push(rawId);
        continue;
      }
    }
    warnings.push({
      code: "unsupported_style_value",
      entityId: node.id,
      detail: `样式槽 ${slot} 缺少可安全标准化的值`,
    });
  }
  return [...new Set(refs)];
}

function isAncestor(
  ancestorId: string,
  nodeId: string,
  index: Map<string, IndexedNode>,
): boolean {
  let current = index.get(nodeId);
  while (current?.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = index.get(current.parentId);
  }
  return false;
}

export function normalizeFigmaDocument(
  rawInput: unknown,
  options: NormalizeFigmaOptions = {},
): NormalizedFigmaDocument {
  const parsedFile = rawFileSchema.safeParse(rawInput);
  if (!parsedFile.success) {
    throw new FigmaNormalizationError(
      "invalid_payload",
      "Figma 文件载荷结构无效",
    );
  }
  const file = parsedFile.data;
  const document = parseRawNode(file.document);
  if (document.type !== "DOCUMENT") {
    throw new FigmaNormalizationError(
      "invalid_document",
      "Figma 根节点必须是 DOCUMENT",
    );
  }

  const maxNodes = parsePositiveLimit(
    options.maxNodes,
    DEFAULT_MAX_NODES,
  );
  const maxDepth = parsePositiveLimit(
    options.maxDepth,
    DEFAULT_MAX_DEPTH,
  );
  const index = new Map<string, IndexedNode>();
  const rawObjects = new WeakSet<object>();
  let order = 0;

  const walk = (
    rawValue: unknown,
    parentId: string | undefined,
    canvasId: string | undefined,
    depth: number,
  ): void => {
    if (depth > maxDepth) {
      throw new FigmaNormalizationError(
        "depth_limit_exceeded",
        "Figma 节点树超过最大深度",
      );
    }
    if (rawValue && typeof rawValue === "object") {
      if (rawObjects.has(rawValue)) {
        throw new FigmaNormalizationError(
          "duplicate_node_id",
          "Figma 节点树包含循环或共享对象",
        );
      }
      rawObjects.add(rawValue);
    }
    const node = parseRawNode(rawValue);
    if (index.has(node.id)) {
      throw new FigmaNormalizationError(
        "duplicate_node_id",
        "Figma 节点标识重复",
      );
    }
    if (index.size >= maxNodes) {
      throw new FigmaNormalizationError(
        "node_limit_exceeded",
        "Figma 节点数量超过上限",
      );
    }
    const resolvedCanvasId =
      node.type === "CANVAS" ? node.id : canvasId;
    index.set(node.id, {
      node,
      parentId,
      canvasId: resolvedCanvasId,
      order,
    });
    order += 1;
    for (const child of node.children ?? []) {
      walk(child, node.id, resolvedCanvasId, depth + 1);
    }
  };
  walk(file.document, undefined, undefined, 0);

  const warnings: DesignBundleWarning[] = [];
  const requestedTargetIds = [
    ...new Set(
      (options.targetNodeIds ?? []).map(normalizeFigmaNodeId),
    ),
  ];
  for (const targetId of requestedTargetIds) {
    if (!index.has(targetId)) {
      throw new FigmaNormalizationError(
        "target_not_found",
        `目标节点不存在：${targetId}`,
      );
    }
  }
  const targetIds = requestedTargetIds.filter((targetId) => {
    const redundant = requestedTargetIds.some(
      (otherId) =>
        otherId !== targetId && isAncestor(otherId, targetId, index),
    );
    if (redundant) {
      warnings.push({
        code: "redundant_target_node",
        entityId: targetId,
        detail: "目标节点已包含在另一个显式目标内",
      });
    }
    return !redundant;
  });

  const canvasNodes = [...index.values()]
    .filter((entry) => entry.node.type === "CANVAS")
    .sort((left, right) => left.order - right.order);
  const candidateIds =
    targetIds.length > 0
      ? targetIds.flatMap((targetId) => {
          const target = index.get(targetId)?.node;
          if (target?.type !== "CANVAS") {
            return [targetId];
          }
          const childIds = visibleCanvasChildIds(target);
          if (childIds.length === 0) {
            return [targetId];
          }
          warnings.push({
            code: "canvas_target_expanded_to_child_pages",
            entityId: targetId,
            detail:
              "显式 CANVAS 目标已展开为可见顶层子节点，避免把整张 Figma 说明画布当作单页参考图",
          });
          return childIds;
        })
      : canvasNodes.flatMap((canvas) => {
          const childIds = visibleCanvasChildIds(canvas.node);
          return childIds.length > 0 ? childIds : [canvas.node.id];
        });

  const components = buildComponentCatalog(file, warnings);
  const styles = new Map<string, NormalizedStyle>();
  const directFillDesignValues = new Map<string, NormalizedDesignValue>();
  const metadataByStyleId = styleMetadataLookup(file.styles);
  const imageSources: FigmaImageSourceReference[] = [];
  const boundVariableSourceIds = new Set<string>();
  const bindingObservations: FigmaBindingObservation[] = [];
  const visualLayerRefs: FigmaVisualLayerReference[] = [];
  const pages: NormalizedPage[] = [];
  const selectedNodeIds = new Set<string>();

  for (const candidateId of candidateIds) {
    const candidateEntry = index.get(candidateId);
    if (!candidateEntry) {
      continue;
    }
    const candidate = candidateEntry.node;
    const isCanvas = candidate.type === "CANVAS";
    const rootIds = isCanvas
      ? (candidate.children ?? []).map((child) => parseRawNode(child).id)
      : [candidate.id];
    const pageNodes: NormalizedNode[] = [];
    const pageBounds = normalizedBounds(candidate);

    const appendSubtree = (
      nodeId: string,
      parentId: string | undefined,
    ): void => {
      const entry = index.get(nodeId);
      if (!entry) {
        return;
      }
      if (selectedNodeIds.has(nodeId)) {
        throw new FigmaNormalizationError(
          "duplicate_node_id",
          "页面候选之间包含重复节点",
        );
      }
      selectedNodeIds.add(nodeId);
      const node = entry.node;
      const sourceImageRefs = imageSourceRefs(node);
      sourceImageRefs.forEach((sourceRef) => {
        imageSources.push({ nodeId: node.id, sourceRef });
      });
      const observations = bindingObservationsForNode(node);
      bindingObservations.push(...observations);
      const variableIds = new Set(
        observations.map((observation) => observation.sourceVariableId),
      );
      variableIds.forEach((id) => boundVariableSourceIds.add(id));
      const warningCodes: string[] = [];
      const kind = nodeKind(node, sourceImageRefs.length > 0);
      if (kind === "unsupported") {
        warningCodes.push("unsupported_node_type");
        warnings.push({
          code: "unsupported_node_type",
          entityId: node.id,
          detail: `节点类型 ${node.type} 暂不支持，已保留占位语义`,
        });
      }
      let componentRef: string | undefined;
      if (node.type === "INSTANCE" && node.componentId) {
        if (components.has(node.componentId)) {
          componentRef = node.componentId;
        } else {
          warningCodes.push("missing_component_metadata");
          warnings.push({
            code: "missing_component_metadata",
            entityId: node.id,
            detail: "实例引用的组件元数据不可用",
          });
        }
      }
      if (
        (node.type === "COMPONENT" ||
          node.type === "COMPONENT_SET") &&
        !components.has(node.id)
      ) {
        components.set(node.id, {
          id: node.id,
          name: node.name ?? `component-${stableHash(node.id).slice(0, 8)}`,
          sourceType:
            node.type === "COMPONENT" ? "component" : "component_set",
          nodeId: node.id,
        });
      }
      const styleRefs = styleRefsForNode(
        node,
        metadataByStyleId,
        styles,
        warnings,
      );
      const directFillColor = firstSolidColor(node);
      const hasFillStyleRef = Object.keys(node.styles ?? {}).some((slot) =>
        slot.toLowerCase().includes("fill"),
      );
      const directFillRefs =
        directFillColor && !hasFillStyleRef
          ? [directFillDesignValue(directFillColor)]
          : [];
      for (const value of directFillRefs) {
        directFillDesignValues.set(value.id, value);
      }
      const boundVariableRefs = [...variableIds].map(stableHash);
      pageNodes.push({
        id: node.id,
        parentId,
        kind,
        name: node.name,
        visible: node.visible !== false,
        bounds: normalizedBounds(node),
        layout: normalizedLayout(node),
        text: normalizedText(node),
        visual: normalizedVisualMetadata(node),
        componentRef,
        componentProperties: normalizedComponentProperties(node),
        variantProperties: normalizedVariantProperties(node),
        styleRefs,
        imageRefs: sourceImageRefs.flatMap((sourceRef) => {
          const path = options.imagePathBySourceRef?.get(sourceRef);
          return path ? [path] : [];
        }),
        boundVariableRefs,
        designValueRefs: directFillRefs.map((value) => value.id),
        warningCodes,
      });
      for (const child of node.children ?? []) {
        const childNode = parseRawNode(child);
        appendSubtree(childNode.id, node.id);
      }
    };

    rootIds.forEach((rootId) => appendSubtree(rootId, undefined));
    const bounds = candidate.absoluteBoundingBox;
    const pageWidth = bounds?.width ?? 0;
    const pageHeight = bounds?.height ?? 0;
    const pageOrigin = { x: bounds?.x ?? 0, y: bounds?.y ?? 0 };
    const pageArea = pageWidth * pageHeight;
    const page: NormalizedPage = {
      id: candidate.id,
      name: candidate.name ?? `page-${stableHash(candidate.id).slice(0, 8)}`,
      width: pageWidth,
      height: pageHeight,
      rootNodeIds: rootIds,
      nodes: pageNodes,
    };
    const candidates = analyzeVisualAssetCandidates(
      page,
      pageOrigin,
      pageArea,
    );
    for (const visualCandidate of candidates) {
      if (visualCandidate.eligible) {
        visualLayerRefs.push({
          nodeId: visualCandidate.sourceNodeId,
          reason: visualCandidate.reasonCode as FigmaVisualLayerReason,
        });
      }
    }
    pages.push(page);
  }

  const normalizedComponents = [...components.values()].map((component) => {
    const nodeId = selectedNodeIds.has(component.id)
      ? component.id
      : component.nodeId &&
          selectedNodeIds.has(component.nodeId)
        ? component.nodeId
        : undefined;
    return nodeId ? { ...component, nodeId } : component;
  });
  const provenance: ProvenanceEntry[] = [
    ...pages.map((page) => ({
      entityKind: "page" as const,
      entityId: page.id,
      origin: "figma_node" as const,
      sourceIdHash: stableHash(page.id),
    })),
    ...pages.flatMap((page) =>
      page.nodes.map((node) => ({
        entityKind: "node" as const,
        entityId: node.id,
        origin: "figma_node" as const,
        sourceIdHash: stableHash(node.id),
      })),
    ),
    ...normalizedComponents.map((component) => ({
      entityKind: "component" as const,
      entityId: component.id,
      origin: "figma_node" as const,
      sourceIdHash: stableHash(component.id),
    })),
    ...[...styles.values()].map((style) => ({
      entityKind: "style" as const,
      entityId: style.id,
      origin: "figma_style" as const,
      sourceIdHash: stableHash(style.id),
    })),
    ...[...directFillDesignValues.values()].map((value) => ({
      entityKind: "design_value" as const,
      entityId: value.id,
      origin: "inferred" as const,
    })),
  ];

  return {
    pages,
    components: normalizedComponents,
    styles: [...styles.values()],
    designValues: [...directFillDesignValues.values()],
    imageSourceRefs: imageSources,
    visualLayerRefs,
    boundVariableSources: [...boundVariableSourceIds].map(
      (sourceVariableId) => ({
        sourceIdHash: stableHash(sourceVariableId),
        sourceVariableId,
      }),
    ),
    bindingObservations,
    provenance,
    warnings,
  };
}
