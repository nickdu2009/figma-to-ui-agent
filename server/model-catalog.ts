/**
 * 服务端模型 catalog（纯数据，Node 可导入）——派生 catalog/prompt 的唯一来源。
 *
 * 由 src/catalog 的单一 CatalogContract 派生：
 * - base = shadcn 36 个定义只移除 Link（35 个）；
 * - overlays 合并 7 个白名单组件扩展；
 * - additions 为 P0 新组件；
 * - customActions 为 10 个受控业务动作（内置动作只进 Prompt/静态约束）。
 *
 * 其它模块（benchmark、生成器、契约测试）必须从这里消费，
 * 不得自行从 @json-render/shadcn 重新组装或过滤。
 */
import {
 catalogContract,
 CATALOG_VERSION,
 RUNTIME_OWNED_COMPONENTS,
 SPEC_COMPATIBILITY,
} from "../src/catalog/catalog-contract.ts";
import { deriveCatalog } from "../src/catalog/derive-catalog.ts";
import {
 buildBundlePromptFragment,
 buildPromptCatalog,
} from "./bundle/prompt-projection.ts";

/** 冻结的派生结果（进程内单例）。 */
export const derivedModelCatalog = deriveCatalog(catalogContract);

/** json-render catalog（validate/zodSchema/jsonSchema/prompt 的唯一来源）。 */
export const modelCatalog = derivedModelCatalog.catalog;

/** 压缩的派生能力摘要（Prompt 用，不含完整 JSON Schema）。 */
export const modelPromptCatalog = buildPromptCatalog(derivedModelCatalog);

/** ApplicationCandidate Bundle Prompt 片段（AC4b）。 */
export const bundlePromptFragment = buildBundlePromptFragment();

export {
 CATALOG_VERSION,
 catalogContract,
 RUNTIME_OWNED_COMPONENTS,
 SPEC_COMPATIBILITY,
};
