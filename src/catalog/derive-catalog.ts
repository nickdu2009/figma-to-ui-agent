/**
 * CatalogContract 派生器（设计 §5.3/§10.3）：
 * - 应用 overlays（additions 纯 optional 恒等校验、widenings 机械 union + 双分支夹具校验、
 *   children 只扩展、events/styleParts 只增不删、tokenBindings 只新增 key）；
 * - additions 不得覆盖 base；overlay 必须指向存在的 base 组件；
 * - customActions 与内置动作键互斥；
 * - children !== "none" 映射为原生 slots: ["default"]；
 * - 输出冻结的 json-render catalog、合并后的组件定义、registry 键集合与 compound 结构元数据。
 */
import { defineCatalog } from "@json-render/core";
import { schema } from "@next-app-runtime/client/schema";
import { z } from "zod";

import type { CatalogContract } from "./catalog-contract.ts";
import type { ChildrenContract } from "./component-contracts.ts";
import type { ExistingComponentOverlay } from "./overlays.ts";

/** json-render 组件定义的最小结构（与 @json-render/shadcn 的 ComponentDefinition 一致）。 */
export interface CatalogComponentDefinition {
  props: z.ZodType;
  slots?: string[];
  events?: string[];
  description: string;
  example?: Record<string, unknown>;
}

export interface CatalogActionDefinition {
  params?: z.ZodType;
  description?: string;
}

/** compound 结构元数据：供结构 Gate 校验合法父级/唯一性/必需项。 */
export interface CompoundStructureIndex {
  /** parent -> children 合同（来自 additions 声明）。 */
  childrenContracts: Record<string, Exclude<ChildrenContract, "none" | "any">>;
  /** parent -> overlay childrenExtension。 */
  childrenExtensions: Record<
    string,
    NonNullable<ExistingComponentOverlay["childrenExtension"]>
  >;
}

export interface DerivedCatalog {
  catalog: ReturnType<typeof defineCatalog>;
  /** overlay 合并后的完整组件定义（base 35 + P0 additions）。 */
  mergedComponentDefinitions: Record<string, CatalogComponentDefinition>;
  /** 模型可见组件键（不含运行时保留的 Link/Slot）。 */
  registryKeys: string[];
  /** customAction 键（与 Adapter handler map 精确键闭合）。 */
  customActionKeys: string[];
  compoundStructure: CompoundStructureIndex;
  jsonSchema: () => object;
  prompt: () => string;
}

function assertPureOptionalProp(componentKey: string, propKey: string, prop: z.ZodType): void {
  const parsed = prop.safeParse(undefined);
  if (!parsed.success || parsed.data !== undefined) {
    throw new Error(
      `overlay prop addition 必须是解析 undefined 后仍为 undefined 的纯 optional Prop：${componentKey}.${propKey}`,
    );
  }
}

function applyPropOverlay(
  componentKey: string,
  baseProps: z.ZodType,
  overlay: NonNullable<ExistingComponentOverlay["props"]>,
): z.ZodType {
  const additions = overlay.additions ?? {};
  const widenings = overlay.widenings ?? {};
  if (
    Object.keys(additions).length === 0 &&
    Object.keys(widenings).length === 0
  ) {
    return baseProps;
  }
  if (!(baseProps instanceof z.ZodObject)) {
    throw new Error(`overlay 目标组件的 props 不是 ZodObject：${componentKey}`);
  }
  const shape: Record<string, z.ZodType> = { ...baseProps.shape };

  for (const [propKey, prop] of Object.entries(additions)) {
    if (propKey in shape) {
      throw new Error(`overlay prop addition 与既有 Prop 冲突：${componentKey}.${propKey}`);
    }
    assertPureOptionalProp(componentKey, propKey, prop);
    shape[propKey] = prop;
  }

  for (const [propKey, widening] of Object.entries(widenings)) {
    const baseProp = shape[propKey];
    if (!baseProp) {
      throw new Error(`overlay widening 目标 Prop 不存在：${componentKey}.${propKey}`);
    }
    const widened = z.union([baseProp, widening.preferredSchema]);
    const legacy = widened.safeParse(widening.legacyFixture);
    if (!legacy.success || !baseProp.safeParse(widening.legacyFixture).success) {
      throw new Error(
        `overlay widening 的 legacyFixture 必须经 base 分支解析：${componentKey}.${propKey}`,
      );
    }
    if (!widened.safeParse(widening.preferredFixture).success) {
      throw new Error(
        `overlay widening 的 preferredFixture 无法解析：${componentKey}.${propKey}`,
      );
    }
    shape[propKey] = widened;
  }

  return z.object(shape).strict();
}

function mergeDefinition(
  key: string,
  base: CatalogComponentDefinition,
  overlay: ExistingComponentOverlay | undefined,
): CatalogComponentDefinition {
  if (!overlay) return base;
  const merged: CatalogComponentDefinition = {
    ...base,
    props: overlay.props ? applyPropOverlay(key, base.props, overlay.props) : base.props,
  };
  if (overlay.childrenExtension) {
    if (overlay.childrenExtension.preserveBase !== true) {
      throw new Error(`childrenExtension 必须 preserveBase：${key}`);
    }
    merged.slots = base.slots ?? ["default"];
  }
  if (overlay.eventAdditions?.length) {
    const baseEvents = base.events ?? [];
    const dup = overlay.eventAdditions.filter((event) => baseEvents.includes(event));
    if (dup.length > 0) {
      throw new Error(`overlay eventAdditions 与既有 events 重复：${key} -> ${dup.join(",")}`);
    }
    merged.events = [...baseEvents, ...overlay.eventAdditions];
  }
  return merged;
}

function additionToDefinition(contract: CatalogContract["components"]["additions"][string]): CatalogComponentDefinition {
  const definition: CatalogComponentDefinition = {
    props: contract.props,
    description: contract.description,
  };
  if (contract.children !== "none") definition.slots = ["default"];
  if (contract.events.length > 0) definition.events = [...contract.events];
  if (contract.example) definition.example = contract.example;
  return definition;
}

/** 派生冻结 catalog（构建期调用；任何校验失败直接 throw，fail closed）。 */
export function deriveCatalog(contract: CatalogContract): DerivedCatalog {
  const { base, overlays, additions } = contract.components;

  const merged: Record<string, CatalogComponentDefinition> = {};

  for (const [key, baseDef] of Object.entries(base)) {
    merged[key] = mergeDefinition(
      key,
      baseDef as CatalogComponentDefinition,
      overlays[key as keyof typeof overlays],
    );
  }

  for (const key of Object.keys(overlays)) {
    if (!(key in base)) {
      throw new Error(`overlay 指向不存在的组件：${key}`);
    }
  }

  for (const [key, addition] of Object.entries(additions)) {
    if (key in merged) {
      throw new Error(`P0 component addition 覆盖上游组件：${key}`);
    }
    merged[key] = additionToDefinition(addition);
  }

  const builtInNames = new Set(
    (contract.builtInActions ?? []).map((action) => action.name),
  );
  const actionDefinitions: Record<string, CatalogActionDefinition> = {};
  for (const [key, action] of Object.entries(contract.customActions)) {
    if (builtInNames.has(key)) {
      throw new Error(`customAction 重复声明内置动作：${key}`);
    }
    actionDefinitions[key] = {
      params: action.params,
      description: action.description,
    };
  }

  const catalog = defineCatalog(schema, {
    components: merged,
    actions: actionDefinitions,
  } as Parameters<typeof defineCatalog>[1]);

  const childrenContracts: CompoundStructureIndex["childrenContracts"] = {};
  for (const [key, addition] of Object.entries(additions)) {
    if (typeof addition.children === "object") {
      childrenContracts[key] = addition.children;
    }
  }
  const childrenExtensions: CompoundStructureIndex["childrenExtensions"] = {};
  for (const [key, overlay] of Object.entries(overlays)) {
    if (overlay?.childrenExtension) {
      childrenExtensions[key] = overlay.childrenExtension;
    }
  }

  const registryKeys = Object.keys(merged).sort((a, b) => a.localeCompare(b));
  const customActionKeys = Object.keys(actionDefinitions).sort((a, b) => a.localeCompare(b));

  return {
    catalog,
    mergedComponentDefinitions: merged,
    registryKeys,
    customActionKeys,
    compoundStructure: { childrenContracts, childrenExtensions },
    jsonSchema: () => catalog.jsonSchema(),
    prompt: () => catalog.prompt(),
  };
}
