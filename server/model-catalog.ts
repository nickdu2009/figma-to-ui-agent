import { defineCatalog } from "@json-render/core";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { schema } from "@next-app-runtime/client/schema";

/**
 * 服务端模型 catalog（纯数据，Node 可导入）：
 * 与浏览器 src/runtime/catalog.tsx 的模型侧定义保持同一来源——
 * @json-render/shadcn 0.19.0 全部 36 个定义，移除运行时接管的 Link 后 35 个。
 * 仅供生成器 catalog.prompt() 使用；不包含 React registry。
 */
const { Link: _runtimeOwnedLink, ...modelComponentDefinitions } =
 shadcnComponentDefinitions;

export const modelCatalog = defineCatalog(schema, {
 components: modelComponentDefinitions,
 actions: {},
});
