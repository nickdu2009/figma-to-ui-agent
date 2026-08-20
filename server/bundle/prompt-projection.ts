/**
 * Prompt 投影（设计 §10.2、AC4b）：
 * - Prompt 只消费压缩的派生能力摘要，不发送完整 catalog-aware JSON Schema；
 * - builtInActions 只进入 Prompt/静态约束；customActions 才进入 catalog.data.actions；
 * - Bundle Prompt 片段明确：Patch 根为 ApplicationCandidate、持久 state 只允许 /ui、
 *   businessSchema:null 是唯一空业务模型表示、禁止把业务样例记录写入 Bundle state；
 * - 不复用原生 catalog.prompt() 的旧 sample-data/root-output 指令。
 */
import type { DerivedCatalog } from "../../src/catalog/derive-catalog.ts";

/** 组件能力摘要行：名称 + 简述 + 关键 prop 名。 */
function summarizeComponent(
  name: string,
  definition: DerivedCatalog["mergedComponentDefinitions"][string],
): string {
  const propKeys =
    definition.props && "shape" in definition.props
      ? Object.keys((definition.props as { shape: Record<string, unknown> }).shape)
      : [];
  const keyProps = propKeys.slice(0, 6).join(", ");
  const children = definition.slots?.length ? "可含 children" : "无 children";
  return `- ${name}: ${definition.description}（props: ${keyProps}${propKeys.length > 6 ? ", …" : ""}；${children}）`;
}

/** 压缩的派生能力摘要（组件 + custom actions；不含 Link/Slot）。 */
export function buildPromptCatalog(derived: DerivedCatalog): string {
  const lines: string[] = ["## 可用组件", ""];
  for (const key of derived.registryKeys) {
    const definition = derived.mergedComponentDefinitions[key];
    if (definition) lines.push(summarizeComponent(key, definition));
  }
  lines.push("", "## 受控业务 Action", "");
  for (const key of derived.customActionKeys) {
    lines.push(`- ${key}: 见 catalog.data.actions 中的 params/result 合同`);
  }
  lines.push(
    "",
    "## 内置 Action（静态约束，不在 catalog.data.actions 中）",
    "",
    "- setState / pushState / removeState：只允许写 /ui/** 纯客户端状态",
    "- navigate：只改变 Preview Route",
  );
  return lines.join("\n");
}

/**
 * Bundle Prompt 片段（AC4b 契约测试的断言目标）：
 * 明确 ApplicationCandidate 根路径、/ui state 约束与 businessSchema:null 语义。
 */
export function buildBundlePromptFragment(): string {
  return [
    "## 输出契约（ApplicationCandidate）",
    "",
    "- RFC 6902 Patch 根对象是 ApplicationCandidate；只允许路径 /uiBundle/spec/**、/uiBundle/designSystem/**、/uiBundle/assets/**、/businessSchema、/businessSchema/**、/migrationPlan/**、/reverseMigrationPlan/**。",
    "- /migrationEdge 由服务端拥有，不在模型可写路径中；不存在 /dataAccessPolicy/** 根。",
    "- 持久 state 只允许 /ui 命名空间（顶层键只能为 ui）；业务记录与用户表单数据只能写 /runtime/**，不得写入 Bundle state。",
    "- 不得把业务样例记录写入 Bundle state；state 中只放 UI 初始值。",
    "- businessSchema:null 是唯一空业务模型表示；第一次声明业务集合时用完整 BusinessSchema 替换 null，不得使用 { collections: [] }。",
    "- Link 与 Slot 由运行时保留，不得出现在生成内容中；导航使用 NavMenu/Breadcrumb 或内置 navigate Action。",
    "- 图标只能使用受控 Icon/IconButton 白名单名称，不得输出 SVG 字符串。",
  ].join("\n");
}
