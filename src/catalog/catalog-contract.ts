/**
 * 单一 CatalogContract（设计 §5.3/§10.3）：
 * - base = shadcnComponentDefinitions 只移除 Link（35 个基础定义）；
 * - Link 与 Slot 由运行时保留，任何 generation/catalog 派生器都不得发出；
 * - overlays 只覆盖 7 个白名单组件；additions 为 P0 新组件；
 * - builtInActions 来自 runtime schema，customActions 为 10 个受控业务动作；
 * - server-safe：不导入任何 React binding。
 */
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { schema } from "@next-app-runtime/client/schema";

import {
  type ActionContract,
  p0CustomActions,
} from "./action-contracts.ts";
import {
  type ComponentContract,
  p0ComponentAdditions,
} from "./component-contracts.ts";
import {
  type ExistingComponentOverlay,
  p0ComponentOverlays,
} from "./overlays.ts";

/** 运行时保留组件：不进入任何生成目录或派生器输出。 */
export const RUNTIME_OWNED_COMPONENTS = ["Link", "Slot"] as const;

/** Catalog 语义版本：仅允许 1.x.y 且不允许前导零（格式由 AppUiBundle 合同强制）。 */
export const CATALOG_VERSION = "1.0.0" as const;

/** 与生成器/运行时对齐的 spec 兼容版本。 */
export const SPEC_COMPATIBILITY = "0.19.0" as const;

const { Link: _runtimeOwnedLinkDefinition, ...baseComponentDefinitions } =
  shadcnComponentDefinitions;

export type BaseComponentDefinitions = typeof baseComponentDefinitions;

export interface CatalogContract {
  components: {
    base: BaseComponentDefinitions;
    overlays: Partial<
      Record<keyof BaseComponentDefinitions, ExistingComponentOverlay>
    >;
    additions: Record<string, ComponentContract>;
  };
  builtInActions: typeof schema.builtInActions;
  customActions: Record<string, ActionContract>;
}

function indexAdditions(
  additions: readonly ComponentContract[],
): Record<string, ComponentContract> {
  const out: Record<string, ComponentContract> = {};
  for (const addition of additions) {
    if (out[addition.key]) {
      throw new Error(`重复的 component addition：${addition.key}`);
    }
    out[addition.key] = addition;
  }
  return out;
}

/** 冻结的单一 CatalogContract（全应用唯一目录真相）。 */
export const catalogContract: CatalogContract = {
  components: {
    base: baseComponentDefinitions,
    overlays: p0ComponentOverlays,
    additions: indexAdditions(p0ComponentAdditions),
  },
  builtInActions: schema.builtInActions,
  customActions: p0CustomActions,
};
