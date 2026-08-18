import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  DesignBundleWarning,
  NormalizedDesignValue,
  NormalizedPage,
  NormalizedStyle,
  ProvenanceEntry,
  VariablesCapability,
} from "../design-bundle/schema.ts";
import type {
  FigmaBindingObservation,
  FigmaObservedDesignValue,
} from "./normalize.ts";
import { FigmaRestError } from "./rest-client.ts";

const MAX_ALIAS_DEPTH = 32;

const rawCollectionSchema = z
  .object({
    id: z.string().min(1).max(1_000),
    name: z.string().min(1).max(512),
    modes: z
      .array(
        z
          .object({
            modeId: z.string().min(1).max(1_000),
            name: z.string().min(1).max(512),
          })
          .passthrough(),
      )
      .max(100),
    defaultModeId: z.string().min(1).max(1_000).optional(),
  })
  .passthrough();

const rawVariableSchema = z
  .object({
    id: z.string().min(1).max(1_000),
    name: z.string().min(1).max(512),
    variableCollectionId: z.string().min(1).max(1_000),
    resolvedType: z.string().min(1).max(128),
    valuesByMode: z.record(z.string(), z.unknown()),
    codeSyntax: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const rawVariablesPayloadSchema = z
  .object({
    meta: z
      .object({
        variables: z.record(z.string(), z.unknown()),
        variableCollections: z.record(z.string(), z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

type RawCollection = z.infer<typeof rawCollectionSchema>;
type RawVariable = z.infer<typeof rawVariableSchema>;
type DesignValueKind = NormalizedDesignValue["kind"];

interface ResolvedMode {
  value: FigmaObservedDesignValue;
  aliasTargetRefHash?: string;
}

export interface DesignValueExtraction {
  designValues: NormalizedDesignValue[];
  provenance: ProvenanceEntry[];
  warnings: DesignBundleWarning[];
  nodeDesignValueRefs: Map<string, string[]>;
}

export interface FigmaVariablesExtraction extends DesignValueExtraction {
  capability: Extract<VariablesCapability, { status: "available" }>;
  designValueIdBySourceHash: Map<string, string>;
}

export class FigmaVariablesError extends Error {
  readonly code:
    | "invalid_payload"
    | "alias_cycle"
    | "alias_depth_exceeded";

  constructor(
    code:
      | "invalid_payload"
      | "alias_cycle"
      | "alias_depth_exceeded",
    message: string,
  ) {
    super(message);
    this.name = "FigmaVariablesError";
    this.code = code;
  }
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedId(prefix: string, source: string): string {
  return `${prefix}.${stableHash(source)}`;
}

function designValueKind(
  resolvedType: string,
): DesignValueKind | undefined {
  if (resolvedType === "COLOR") {
    return "color";
  }
  if (resolvedType === "FLOAT") {
    return "number";
  }
  if (resolvedType === "STRING") {
    return "string";
  }
  if (resolvedType === "BOOLEAN") {
    return "boolean";
  }
  return undefined;
}

function parsePrimitiveValue(
  kind: DesignValueKind,
  value: unknown,
): FigmaObservedDesignValue | undefined {
  if (kind === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }
  if (kind === "string") {
    return typeof value === "string" && value.length <= 4_000
      ? value
      : undefined;
  }
  if (kind === "boolean") {
    return typeof value === "boolean" ? value : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const r = Reflect.get(value, "r");
  const g = Reflect.get(value, "g");
  const b = Reflect.get(value, "b");
  const a = Reflect.get(value, "a");
  if (
    typeof r !== "number" ||
    typeof g !== "number" ||
    typeof b !== "number" ||
    typeof a !== "number" ||
    ![r, g, b, a].every(
      (component) =>
        Number.isFinite(component) && component >= 0 && component <= 1,
    )
  ) {
    return undefined;
  }
  return { r, g, b, a };
}

function aliasId(value: unknown): string | undefined {
  if (
    value &&
    typeof value === "object" &&
    Reflect.get(value, "type") === "VARIABLE_ALIAS" &&
    typeof Reflect.get(value, "id") === "string"
  ) {
    return Reflect.get(value, "id") as string;
  }
  return undefined;
}

function selectedModeId(
  variable: RawVariable,
  collection: RawCollection | undefined,
  preferredModeId: string,
): string | undefined {
  if (variable.valuesByMode[preferredModeId] !== undefined) {
    return preferredModeId;
  }
  if (
    collection?.defaultModeId &&
    variable.valuesByMode[collection.defaultModeId] !== undefined
  ) {
    return collection.defaultModeId;
  }
  return Object.keys(variable.valuesByMode)[0];
}

function resolveModeValue(
  variable: RawVariable,
  modeId: string,
  variables: ReadonlyMap<string, RawVariable>,
  collections: ReadonlyMap<string, RawCollection>,
  stack: readonly string[],
): ResolvedMode | undefined {
  if (stack.length >= MAX_ALIAS_DEPTH) {
    throw new FigmaVariablesError(
      "alias_depth_exceeded",
      "Variable 别名链超过最大深度",
    );
  }
  if (stack.includes(variable.id)) {
    throw new FigmaVariablesError(
      "alias_cycle",
      "Variable 别名链存在循环",
    );
  }

  const actualModeId = selectedModeId(
    variable,
    collections.get(variable.variableCollectionId),
    modeId,
  );
  if (!actualModeId) {
    return undefined;
  }
  const rawValue = variable.valuesByMode[actualModeId];
  const targetId = aliasId(rawValue);
  const kind = designValueKind(variable.resolvedType);
  if (!kind) {
    return undefined;
  }
  if (!targetId) {
    const value = parsePrimitiveValue(kind, rawValue);
    return value === undefined ? undefined : { value };
  }

  const target = variables.get(targetId);
  if (
    !target ||
    designValueKind(target.resolvedType) !== kind
  ) {
    return undefined;
  }
  const resolved = resolveModeValue(
    target,
    modeId,
    variables,
    collections,
    [...stack, variable.id],
  );
  return resolved
    ? {
        value: resolved.value,
        aliasTargetRefHash: stableHash(targetId),
      }
    : undefined;
}

function normalizedCodeSyntax(
  raw: Record<string, string> | undefined,
): NormalizedDesignValue["codeSyntax"] {
  if (!raw) {
    return undefined;
  }
  const value = {
    web: raw.WEB,
    android: raw.ANDROID,
    ios: raw.iOS ?? raw.IOS,
  };
  return Object.values(value).some((item) => item !== undefined)
    ? value
    : undefined;
}

function createFigmaDesignValue(
  variable: RawVariable,
  collection: RawCollection,
  variables: ReadonlyMap<string, RawVariable>,
  collections: ReadonlyMap<string, RawCollection>,
): NormalizedDesignValue | undefined {
  const kind = designValueKind(variable.resolvedType);
  if (!kind) {
    return undefined;
  }
  const resolvedModes = collection.modes.flatMap((mode) => {
    const resolved = resolveModeValue(
      variable,
      mode.modeId,
      variables,
      collections,
      [],
    );
    return resolved
      ? [
          {
            sourceRefHash: stableHash(mode.modeId),
            name: mode.name,
            value: resolved.value,
            aliasTargetRefHash: resolved.aliasTargetRefHash,
          },
        ]
      : [];
  });
  if (resolvedModes.length < 1) {
    return undefined;
  }
  const defaultModeId =
    collection.defaultModeId ?? collection.modes[0]?.modeId;
  const defaultMode =
    resolvedModes.find(
      (mode) =>
        mode.sourceRefHash ===
        (defaultModeId ? stableHash(defaultModeId) : ""),
    ) ?? resolvedModes[0]!;
  const common = {
    id: normalizedId("figma_variable", variable.id),
    name: variable.name,
    origin: "figma_variable" as const,
    sourceRefHash: stableHash(variable.id),
    collection: {
      sourceRefHash: stableHash(collection.id),
      name: collection.name,
    },
    codeSyntax: normalizedCodeSyntax(variable.codeSyntax),
  };

  if (kind === "color") {
    return {
      ...common,
      kind,
      value: defaultMode.value as Extract<
        FigmaObservedDesignValue,
        object
      >,
      modes: resolvedModes.map((mode) => ({
        ...mode,
        value: mode.value as Extract<FigmaObservedDesignValue, object>,
      })),
    };
  }
  if (kind === "number") {
    return {
      ...common,
      kind,
      value: defaultMode.value as number,
      modes: resolvedModes.map((mode) => ({
        ...mode,
        value: mode.value as number,
      })),
    };
  }
  if (kind === "string") {
    return {
      ...common,
      kind,
      value: defaultMode.value as string,
      modes: resolvedModes.map((mode) => ({
        ...mode,
        value: mode.value as string,
      })),
    };
  }
  return {
    ...common,
    kind,
    value: defaultMode.value as boolean,
    modes: resolvedModes.map((mode) => ({
      ...mode,
      value: mode.value as boolean,
    })),
  };
}

export function extractFigmaVariables(
  rawInput: unknown,
  bindingObservations: readonly FigmaBindingObservation[] = [],
): FigmaVariablesExtraction {
  const payloadResult = rawVariablesPayloadSchema.safeParse(rawInput);
  if (!payloadResult.success) {
    throw new FigmaVariablesError(
      "invalid_payload",
      "Figma Variables 载荷结构无效",
    );
  }

  const warnings: DesignBundleWarning[] = [];
  const collections = new Map<string, RawCollection>();
  for (const raw of Object.values(
    payloadResult.data.meta.variableCollections,
  )) {
    const parsed = rawCollectionSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push({
        code: "invalid_variable_collection",
        detail: "一个 Variable Collection 结构无效，已跳过",
      });
      continue;
    }
    collections.set(parsed.data.id, parsed.data);
  }

  const variables = new Map<string, RawVariable>();
  for (const raw of Object.values(payloadResult.data.meta.variables)) {
    const parsed = rawVariableSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push({
        code: "invalid_figma_variable",
        detail: "一个 Figma Variable 结构无效，已跳过",
      });
      continue;
    }
    variables.set(parsed.data.id, parsed.data);
  }

  const designValues: NormalizedDesignValue[] = [];
  const designValueIdBySourceHash = new Map<string, string>();
  for (const variable of variables.values()) {
    const collection = collections.get(variable.variableCollectionId);
    if (!collection) {
      warnings.push({
        code: "missing_variable_collection",
        entityId: normalizedId("figma_variable", variable.id),
        detail: "Figma Variable 缺少所属集合，已跳过",
      });
      continue;
    }
    try {
      const designValue = createFigmaDesignValue(
        variable,
        collection,
        variables,
        collections,
      );
      if (!designValue) {
        warnings.push({
          code: "unsupported_figma_variable",
          entityId: normalizedId("figma_variable", variable.id),
          detail: "Figma Variable 类型或模式值暂不支持，已跳过",
        });
        continue;
      }
      designValues.push(designValue);
      designValueIdBySourceHash.set(
        stableHash(variable.id),
        designValue.id,
      );
    } catch (error) {
      if (!(error instanceof FigmaVariablesError)) {
        throw error;
      }
      warnings.push({
        code: error.code,
        entityId: normalizedId("figma_variable", variable.id),
        detail: error.message,
      });
    }
  }

  const nodeDesignValueRefs = new Map<string, string[]>();
  for (const observation of bindingObservations) {
    const designValueId = designValueIdBySourceHash.get(
      observation.sourceIdHash,
    );
    if (!designValueId) {
      continue;
    }
    const refs = nodeDesignValueRefs.get(observation.nodeId) ?? [];
    if (!refs.includes(designValueId)) {
      refs.push(designValueId);
    }
    nodeDesignValueRefs.set(observation.nodeId, refs);
  }
  const includedCollectionIds = new Set(
    designValues.map((value) => value.collection!.sourceRefHash),
  );
  return {
    capability: {
      status: "available",
      variableCount: designValues.length,
      collectionCount: includedCollectionIds.size,
    },
    designValues,
    provenance: designValues.map((value) => ({
      entityKind: "design_value",
      entityId: value.id,
      origin: "figma_variable",
      sourceIdHash: value.sourceRefHash,
    })),
    warnings,
    nodeDesignValueRefs,
    designValueIdBySourceHash,
  };
}

function stableValue(value: FigmaObservedDesignValue): string {
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

function kindForObservedValue(
  value: FigmaObservedDesignValue,
): DesignValueKind {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "color";
}

function createInferredDesignValue(
  input: {
    id: string;
    name: string;
    origin: "inferred_from_binding" | "inferred";
    sourceRefHash?: string;
    value: FigmaObservedDesignValue;
  },
): NormalizedDesignValue {
  const common = {
    id: input.id,
    name: input.name,
    origin: input.origin,
    sourceRefHash: input.sourceRefHash,
  };
  const kind = kindForObservedValue(input.value);
  if (kind === "color") {
    return { ...common, kind, value: input.value as Extract<FigmaObservedDesignValue, object> };
  }
  if (kind === "number") {
    return { ...common, kind, value: input.value as number };
  }
  if (kind === "string") {
    return { ...common, kind, value: input.value as string };
  }
  return { ...common, kind, value: input.value as boolean };
}

function addNodeRef(
  refs: Map<string, string[]>,
  nodeId: string,
  designValueId: string,
): void {
  const nodeRefs = refs.get(nodeId) ?? [];
  if (!nodeRefs.includes(designValueId)) {
    nodeRefs.push(designValueId);
  }
  refs.set(nodeId, nodeRefs);
}

export function inferDesignValuesFromBindings(
  observations: readonly FigmaBindingObservation[],
): DesignValueExtraction {
  const groups = new Map<
    string,
    {
      sourceRefHash: string;
      value: FigmaObservedDesignValue;
      nodeIds: Set<string>;
    }
  >();
  const warnings: DesignBundleWarning[] = [];
  for (const observation of observations) {
    if (observation.resolvedValue === undefined) {
      warnings.push({
        code: "binding_value_unresolved",
        entityId: observation.nodeId,
        detail: `变量绑定槽 ${observation.property} 缺少可安全推导的值`,
      });
      continue;
    }
    const key = `${observation.sourceIdHash}:${stableValue(
      observation.resolvedValue,
    )}`;
    const group = groups.get(key) ?? {
      sourceRefHash: observation.sourceIdHash,
      value: observation.resolvedValue,
      nodeIds: new Set<string>(),
    };
    group.nodeIds.add(observation.nodeId);
    groups.set(key, group);
  }

  const counters = new Map<DesignValueKind, number>();
  const designValues: NormalizedDesignValue[] = [];
  const nodeDesignValueRefs = new Map<string, string[]>();
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const kind = kindForObservedValue(group.value);
    const index = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, index);
    const designValue = createInferredDesignValue({
      id: normalizedId("binding", key),
      name: `${kind}.binding.${index}`,
      origin: "inferred_from_binding",
      sourceRefHash: group.sourceRefHash,
      value: group.value,
    });
    designValues.push(designValue);
    group.nodeIds.forEach((nodeId) =>
      addNodeRef(nodeDesignValueRefs, nodeId, designValue.id),
    );
  }
  return {
    designValues,
    provenance: designValues.map((value) => ({
      entityKind: "design_value",
      entityId: value.id,
      origin: "inferred_from_binding",
      sourceIdHash: value.sourceRefHash,
    })),
    warnings,
    nodeDesignValueRefs,
  };
}

interface RepeatedObservation {
  category: "surface" | "spacing" | "typography";
  value: FigmaObservedDesignValue;
  nodeId: string;
}

function repeatedObservations(
  pages: readonly NormalizedPage[],
  styles: readonly NormalizedStyle[],
): RepeatedObservation[] {
  const styleById = new Map(styles.map((style) => [style.id, style]));
  const output: RepeatedObservation[] = [];
  for (const page of pages) {
    for (const node of page.nodes) {
      for (const styleId of node.styleRefs) {
        const style = styleById.get(styleId);
        if (style?.kind === "color") {
          output.push({
            category: "surface",
            value: style.value,
            nodeId: node.id,
          });
        }
      }
      const layoutNumbers = node.layout
        ? [
            node.layout.gap,
            node.layout.paddingTop,
            node.layout.paddingRight,
            node.layout.paddingBottom,
            node.layout.paddingLeft,
          ]
        : [];
      for (const value of layoutNumbers) {
        if (value !== undefined) {
          output.push({
            category: "spacing",
            value,
            nodeId: node.id,
          });
        }
      }
      const textNumbers = node.text
        ? [
            node.text.fontSize,
            node.text.fontWeight,
            node.text.lineHeight,
            node.text.letterSpacing,
          ]
        : [];
      for (const value of textNumbers) {
        if (value !== undefined) {
          output.push({
            category: "typography",
            value,
            nodeId: node.id,
          });
        }
      }
    }
  }
  return output;
}

export function inferRepeatedDesignValues(
  pages: readonly NormalizedPage[],
  styles: readonly NormalizedStyle[],
): DesignValueExtraction {
  const groups = new Map<
    string,
    {
      category: RepeatedObservation["category"];
      value: FigmaObservedDesignValue;
      nodeIds: Set<string>;
    }
  >();
  for (const observation of repeatedObservations(pages, styles)) {
    const key = `${observation.category}:${stableValue(
      observation.value,
    )}`;
    const group = groups.get(key) ?? {
      category: observation.category,
      value: observation.value,
      nodeIds: new Set<string>(),
    };
    group.nodeIds.add(observation.nodeId);
    groups.set(key, group);
  }

  const counters = new Map<string, number>();
  const designValues: NormalizedDesignValue[] = [];
  const nodeDesignValueRefs = new Map<string, string[]>();
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (group.nodeIds.size < 2) {
      continue;
    }
    const kind = kindForObservedValue(group.value);
    const counterKey = `${kind}.${group.category}`;
    const index = (counters.get(counterKey) ?? 0) + 1;
    counters.set(counterKey, index);
    const designValue = createInferredDesignValue({
      id: normalizedId("inferred", key),
      name: `${kind}.${group.category}.${index}`,
      origin: "inferred",
      value: group.value,
    });
    designValues.push(designValue);
    group.nodeIds.forEach((nodeId) =>
      addNodeRef(nodeDesignValueRefs, nodeId, designValue.id),
    );
  }
  return {
    designValues,
    provenance: designValues.map((value) => ({
      entityKind: "design_value",
      entityId: value.id,
      origin: "inferred",
    })),
    warnings: [],
    nodeDesignValueRefs,
  };
}

export function applyNodeDesignValueRefs(
  pages: readonly NormalizedPage[],
  refs: ReadonlyMap<string, readonly string[]>,
): NormalizedPage[] {
  return pages.map((page) => ({
    ...page,
    nodes: page.nodes.map((node) => ({
      ...node,
      designValueRefs: [
        ...new Set([
          ...node.designValueRefs,
          ...(refs.get(node.id) ?? []),
        ]),
      ],
    })),
  }));
}

export function classifyVariablesUnavailable(
  error: unknown,
): Extract<
  VariablesCapability,
  { status: "unavailable_optional" }
> | undefined {
  if (!(error instanceof FigmaRestError)) {
    return undefined;
  }
  if (error.status === 401) {
    return {
      status: "unavailable_optional",
      reasonCode: "unauthorized",
    };
  }
  if (error.status === 403) {
    return {
      status: "unavailable_optional",
      reasonCode: "unknown",
    };
  }
  return undefined;
}
