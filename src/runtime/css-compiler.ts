/**
 * 应用 CSS 编译器（设计 §11.2，计划 S6）：
 * - 全部应用选择器编译到 `[data-vma-preview-root][data-bundle-revision="<rev>"]` 下；
 * - `@keyframes` 名按 digestPrefix 命名空间化并重写 animation 引用；
 * - 拒绝宿主选择器（html/body/:root）、未知 at-rule、@import/@page 等、
 *   外部 url()（只允许 `url("asset:<assetId>")` 引用并产出资源 IR）、
 *   `position:fixed`、负/超限 z-index、view-transition-name、未知自定义属性；
 * - 数量限制：Rule ≤1000、Selector ≤2000、声明/Rule ≤64、选择器 ≤256 字符、
 *   组合符 ≤4、简单选择器 ≤8、@keyframes ≤32/关键帧合计 ≤200。
 *
 * 失败 fail closed（throw CssCompilerError，稳定 code）。
 */

export type CssCompilerErrorCode =
  | "css_parse_failed"
  | "css_host_selector"
  | "css_at_rule_forbidden"
  | "css_url_forbidden"
  | "css_property_forbidden"
  | "css_value_forbidden"
  | "css_selector_limit"
  | "css_rule_limit"
  | "css_keyframes_limit"
  | "css_custom_property_forbidden"
  | "css_dangling_asset_ref";

export class CssCompilerError extends Error {
  constructor(
    readonly code: CssCompilerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CssCompilerError";
  }
}

export const CSS_RULE_LIMIT = 1_000;
export const CSS_SELECTOR_LIMIT = 2_000;
export const CSS_DECLARATIONS_PER_RULE_LIMIT = 64;
export const CSS_SELECTOR_MAX_LENGTH = 256;
export const CSS_SELECTOR_MAX_COMBINATORS = 4;
export const CSS_SELECTOR_MAX_SIMPLE = 8;
export const CSS_KEYFRAMES_LIMIT = 32;
export const CSS_KEYFRAME_STEPS_LIMIT = 200;
export const CSS_MAX_Z_INDEX = 2147483647;

/** 允许的 at-rule（§11.2；@font-face 由平台生成，Bundle 原文禁止）。 */
const ALLOWED_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "keyframes",
]);
/** 幂等去重后的 at-rule 在嵌套校验后仍不允许：@import/@namespace/@page/@font-face 等。 */

/** 属性黑名单前的白名单策略：拒绝已知危险属性；其余属性允许。 */
const FORBIDDEN_PROPERTIES = new Set([
  "behavior",
  "-moz-binding",
  "view-transition-name",
  "view-transition-class",
]);

/** 值层拒绝：函数/协议黑名单（url 走单独解析）。 */
const FORBIDDEN_VALUE_PATTERN =
  /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*(?!asset:)[a-z][a-z0-9+.-]*:/i;

/** 宿主选择器：未编译前命中 html/body/:root/:host 的顶层或伪类选择器。 */
const HOST_SELECTOR_PATTERN = /(^|[\s,+>~(:])(html|body|:root|:host)\b/i;

/** 简单选择器拆分：按组合符。 */
const COMBINATOR_PATTERN = /\s*(?=[>+~])\s*|\s+/;

export interface CssAssetRef {
  assetId: string;
}

export interface CompiledCss {
  /** 完整编译产物（含作用域选择器、命名空间 keyframes、token 变量注入块）。 */
  cssText: string;
  /** `url(asset:<id>)` 引用集合（去重；Controller 交 AssetUrlResolver 闭合）。 */
  assetRefs: readonly CssAssetRef[];
  /** 命名空间化 keyframes 名映射（原名 → 编译名）。 */
  keyframesRenames: Readonly<Record<string, string>>;
}

/** 去注释与控制字符（不改变语义的最小净化）。 */
function stripComments(css: string): string {
  let result = "";
  let index = 0;
  while (index < css.length) {
    const start = css.indexOf("/*", index);
    if (start < 0) {
      result += css.slice(index);
      break;
    }
    const end = css.indexOf("*/", start + 2);
    if (end < 0) {
      throw new CssCompilerError("css_parse_failed", "未闭合的 CSS 注释");
    }
    result += css.slice(index, start);
    index = end + 2;
  }
  return result.replace(/\0/g, "");
}

/** 解析 url() 引用并校验：只允许 asset:<assetId>，产出占位与 IR。 */
function extractAssetUrls(
  value: string,
  assetRefs: CssAssetRef[],
  assetIdToVar: Map<string, string>,
): string {
  let result = value;
  const urlPattern = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(value)) !== null) {
    const rawUrl = match[2];
    if (!/^asset:[A-Za-z0-9._-]+$/.test(rawUrl)) {
      throw new CssCompilerError(
        "css_url_forbidden",
        `只允许 url("asset:<assetId>")：${rawUrl.slice(0, 40)}`,
      );
    }
    const assetId = rawUrl.slice("asset:".length);
    if (!assetIdToVar.has(assetId)) {
      const placeholder = `__VMA_ASSET_${assetIdToVar.size}__`;
      assetIdToVar.set(assetId, placeholder);
      assetRefs.push({ assetId });
    }
    result = result.replace(match[0], `var(${assetIdToVar.get(assetId)})`);
  }
  return result;
}

interface ParsedDeclaration {
  property: string;
  value: string;
}

function parseDeclaration(
  raw: string,
  context: string,
  assetRefs: CssAssetRef[],
  assetIdToVar: Map<string, string>,
): ParsedDeclaration {
  const colon = raw.indexOf(":");
  if (colon <= 0) {
    throw new CssCompilerError(
      "css_parse_failed",
      `声明缺少属性名：${context}`,
    );
  }
  const property = raw.slice(0, colon).trim();
  let value = raw.slice(colon + 1).trim();
  if (property === "") {
    throw new CssCompilerError("css_parse_failed", `空属性名：${context}`);
  }
  // 应用层自定义属性只允许 --app- 命名空间（--vma-* 是平台 token 变量区，
  // 防止应用覆写 --vma-pt/st/ct）。
  if (property.startsWith("--") && !property.startsWith("--app-")) {
    throw new CssCompilerError(
      "css_custom_property_forbidden",
      `未知自定义属性：${property}`,
    );
  }
  if (FORBIDDEN_PROPERTIES.has(property.toLowerCase())) {
    throw new CssCompilerError(
      "css_property_forbidden",
      `禁止属性：${property}`,
    );
  }
  if (property.toLowerCase() === "position" && /fixed/i.test(value)) {
    throw new CssCompilerError("css_value_forbidden", "拒绝 position:fixed");
  }
  if (property.toLowerCase() === "z-index") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new CssCompilerError(
        "css_value_forbidden",
        `z-index 非整数：${value}`,
      );
    }
    if (parsed < 0 || parsed > CSS_MAX_Z_INDEX) {
      throw new CssCompilerError(
        "css_value_forbidden",
        `z-index 超出平台界限：${value}`,
      );
    }
  }
  if (FORBIDDEN_VALUE_PATTERN.test(raw)) {
    throw new CssCompilerError(
      "css_value_forbidden",
      `声明含禁止值：${property}（${context}）`,
    );
  }
  value = extractAssetUrls(value, assetRefs, assetIdToVar);
  return { property, value };
}

/** 校验单个复合选择器并前缀化。 */
function scopeSelector(selector: string, scopeAttr: string): string {
  const trimmed = selector.trim();
  if (trimmed === "") {
    throw new CssCompilerError("css_parse_failed", "空选择器");
  }
  // 严格拒绝前导或尾部组合符（+ / ~ / > / ||），防止突破 scope 前缀定位到宿主同级兄弟节点
  if (/^[+~>|]/.test(trimmed) || /[+~>|]$/.test(trimmed)) {
    throw new CssCompilerError(
      "css_host_selector",
      `禁止以前导或尾部组合符构造选择器：${trimmed.slice(0, 48)}`,
    );
  }
  if (trimmed.length > CSS_SELECTOR_MAX_LENGTH) {
    throw new CssCompilerError(
      "css_selector_limit",
      `选择器超过 ${CSS_SELECTOR_MAX_LENGTH} 字符`,
    );
  }
  if (HOST_SELECTOR_PATTERN.test(trimmed)) {
    throw new CssCompilerError(
      "css_host_selector",
      `宿主选择器被拒绝：${trimmed.slice(0, 48)}`,
    );
  }
  const parts = trimmed.split(COMBINATOR_PATTERN).filter((part) => part !== "");
  const combinatorCount = Math.max(0, parts.length - 1);
  if (combinatorCount > CSS_SELECTOR_MAX_COMBINATORS) {
    throw new CssCompilerError(
      "css_selector_limit",
      `选择器组合符超过 ${CSS_SELECTOR_MAX_COMBINATORS}`,
    );
  }
  let simpleCount = 0;
  for (const part of parts) {
    simpleCount += Math.max(
      1,
      part.split(/(?=[.#[*])/).length - part.split(/::/).length + 1 - 1,
    );
  }
  if (simpleCount > CSS_SELECTOR_MAX_SIMPLE) {
    throw new CssCompilerError(
      "css_selector_limit",
      `选择器简单选择器超过 ${CSS_SELECTOR_MAX_SIMPLE}`,
    );
  }
  // 全部编译到 Preview root 作用域下。
  return `${scopeAttr} ${trimmed}`;
}

export interface CssCompilerInput {
  applicationCss: string;
  /** Preview root 属性（形如 `[data-vma-preview-root][data-bundle-revision="3"]`）。 */
  scopeAttribute: string;
  /** candidateDigest 短前缀（keyframes 命名空间）。 */
  digestPrefix: string;
  /** 编译后的 token 自定义属性块（注入 :scope 规则）。 */
  tokenCustomProperties?: string;
  /** token 编译产出的字体资源 IR（闭合校验 url(asset:) 引用用）。 */
  manifestAssetIds?: ReadonlySet<string>;
}

/** 顶层切分：at-rule 块与普通 rule（花括号配对；无嵌套普通规则）。 */
function splitTopLevel(
  css: string,
): Array<{ atRule: string | null; header: string; body: string }> {
  const blocks: Array<{ atRule: string | null; header: string; body: string }> =
    [];
  let index = 0;
  while (index < css.length) {
    const nextBrace = css.indexOf("{", index);
    if (nextBrace < 0) {
      const tail = css.slice(index).trim();
      if (tail !== "") {
        throw new CssCompilerError(
          "css_parse_failed",
          `顶级孤立内容：${tail.slice(0, 32)}`,
        );
      }
      break;
    }
    const header = css.slice(index, nextBrace).trim();
    let depth = 1;
    let cursor = nextBrace + 1;
    while (cursor < css.length && depth > 0) {
      const char = css[cursor];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) {
      throw new CssCompilerError(
        "css_parse_failed",
        `花括号不配对：${header.slice(0, 32)}`,
      );
    }
    const body = css.slice(nextBrace + 1, cursor - 1);
    const atMatch = header.match(/^@([a-zA-Z-]+)/);
    if (atMatch) {
      blocks.push({ atRule: atMatch[1].toLowerCase(), header, body });
    } else {
      blocks.push({ atRule: null, header, body });
    }
    index = cursor;
  }
  return blocks;
}

function parseRuleBody(
  body: string,
  context: string,
  assetRefs: CssAssetRef[],
  assetIdToVar: Map<string, string>,
): ParsedDeclaration[] {
  const declarations: ParsedDeclaration[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) {
      if (current.trim() !== "") {
        declarations.push(
          parseDeclaration(current, context, assetRefs, assetIdToVar),
        );
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") {
    declarations.push(
      parseDeclaration(current, context, assetRefs, assetIdToVar),
    );
  }
  if (declarations.length > CSS_DECLARATIONS_PER_RULE_LIMIT) {
    throw new CssCompilerError(
      "css_rule_limit",
      `${context} 声明数超过 ${CSS_DECLARATIONS_PER_RULE_LIMIT}`,
    );
  }
  return declarations;
}

/** keyframes 名命名空间化：原名 → digest 前缀名（校验 CSS 标识符合法）。 */
function renameKeyframes(name: string, digestPrefix: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "_");
  return `vma-${digestPrefix}-${safe}`;
}

export function compileApplicationCss(input: CssCompilerInput): CompiledCss {
  const css = stripComments(input.applicationCss);
  if (css.trim() === "") {
    return { cssText: "", assetRefs: [], keyframesRenames: {} };
  }
  const assetRefs: CssAssetRef[] = [];
  const assetIdToVar = new Map<string, string>();
  const keyframesRenames: Record<string, string> = {};
  const output: string[] = [];
  let ruleCount = 0;
  let selectorCount = 0;
  let keyframesCount = 0;
  let keyframeSteps = 0;

  const blocks = splitTopLevel(css);

  // 先重命名 keyframes（两遍法：先收集名，再重写 animation 引用）。
  for (const block of blocks) {
    if (block.atRule === "keyframes") {
      keyframesCount += 1;
      if (keyframesCount > CSS_KEYFRAMES_LIMIT) {
        throw new CssCompilerError(
          "css_keyframes_limit",
          `@keyframes 超过 ${CSS_KEYFRAMES_LIMIT}`,
        );
      }
      const name = block.header.replace(/^@keyframes\s+/i, "").trim();
      if (name === "") {
        throw new CssCompilerError("css_parse_failed", "@keyframes 缺少名称");
      }
      keyframesRenames[name] = renameKeyframes(name, input.digestPrefix);
    }
  }

  for (const block of blocks) {
    if (block.atRule !== null) {
      if (!ALLOWED_AT_RULES.has(block.atRule)) {
        throw new CssCompilerError(
          "css_at_rule_forbidden",
          `未知/禁止 at-rule：@${block.atRule}`,
        );
      }
      if (block.atRule === "keyframes") {
        const name = block.header.replace(/^@keyframes\s+/i, "").trim();
        const compiledName = keyframesRenames[name];
        // 步骤块（from/to/百分比）也按花括号配对切分，再逐步骤编译声明。
        const steps = splitTopLevel(block.body);
        if (steps.length === 0) {
          throw new CssCompilerError(
            "css_parse_failed",
            `@keyframes ${name} 缺少关键帧步骤`,
          );
        }
        keyframeSteps += steps.length;
        if (keyframeSteps > CSS_KEYFRAME_STEPS_LIMIT) {
          throw new CssCompilerError(
            "css_keyframes_limit",
            `关键帧合计超过 ${CSS_KEYFRAME_STEPS_LIMIT}`,
          );
        }
        const compiledSteps = steps.map((step) => {
          if (step.atRule !== null) {
            throw new CssCompilerError(
              "css_at_rule_forbidden",
              `@keyframes 内不允许 @${step.atRule}`,
            );
          }
          const declarations = parseRuleBody(
            step.body,
            `@keyframes ${name} ${step.header}`,
            assetRefs,
            assetIdToVar,
          );
          if (declarations.length === 0) {
            throw new CssCompilerError(
              "css_parse_failed",
              `关键帧步骤无声明：@keyframes ${name} ${step.header}`,
            );
          }
          const declText = declarations
            .map(
              (declaration) => `${declaration.property}: ${declaration.value};`,
            )
            .join(" ");
          return `${step.header} { ${declText} }`;
        });
        output.push(
          `@keyframes ${compiledName} { ${compiledSteps.join(" ")} }`,
        );
        continue;
      }
      // media/supports/container：头原样（仅字面量条件），体内规则递归同规则编译。
      const inner = splitTopLevel(block.body);
      if (inner.length === 0) {
        throw new CssCompilerError(
          "css_parse_failed",
          `@${block.atRule} 块为空`,
        );
      }
      const compiledInner: string[] = [];
      for (const innerBlock of inner) {
        if (innerBlock.atRule !== null) {
          throw new CssCompilerError(
            "css_at_rule_forbidden",
            `@${block.atRule} 内不允许嵌套 @${innerBlock.atRule}`,
          );
        }
        compiledInner.push(
          compilePlainRule(
            innerBlock,
            input.scopeAttribute,
            keyframesRenames,
            assetRefs,
            assetIdToVar,
          ),
        );
        ruleCount += 1;
        selectorCount += innerBlock.header.split(",").length;
      }
      output.push(`${block.header} { ${compiledInner.join(" ")} }`);
      continue;
    }
    output.push(
      compilePlainRule(
        block,
        input.scopeAttribute,
        keyframesRenames,
        assetRefs,
        assetIdToVar,
      ),
    );
    ruleCount += 1;
    selectorCount += block.header.split(",").length;
  }

  if (ruleCount > CSS_RULE_LIMIT) {
    throw new CssCompilerError(
      "css_rule_limit",
      `Rule 总数超过 ${CSS_RULE_LIMIT}`,
    );
  }
  if (selectorCount > CSS_SELECTOR_LIMIT) {
    throw new CssCompilerError(
      "css_selector_limit",
      `Selector 总数超过 ${CSS_SELECTOR_LIMIT}`,
    );
  }

  // token 变量注入块：作用域 root 直接声明。
  if (input.tokenCustomProperties) {
    output.unshift(
      `${input.scopeAttribute} { ${input.tokenCustomProperties} }`,
    );
  }

  return {
    cssText: output.join("\n"),
    assetRefs,
    keyframesRenames,
  };
}

function compilePlainRule(
  block: { header: string; body: string },
  scopeAttribute: string,
  keyframesRenames: Record<string, string>,
  assetRefs: CssAssetRef[],
  assetIdToVar: Map<string, string>,
): string {
  const selectors = block.header.split(",").map((selector) => selector.trim());
  const scoped = selectors.map((selector) =>
    scopeSelector(selector, scopeAttribute),
  );
  const declarations = parseRuleBody(
    block.body,
    scoped[0] ?? "",
    assetRefs,
    assetIdToVar,
  ).map((declaration) => {
    let value = declaration.value;
    // animation 名引用重写（简写与 animation-name）。
    if (/^animation(-name)?$/i.test(declaration.property)) {
      for (const [original, compiled] of Object.entries(keyframesRenames)) {
        value = value.replaceAll(original, compiled);
      }
    }
    return `${declaration.property}: ${value};`;
  });
  if (declarations.length === 0) {
    throw new CssCompilerError(
      "css_parse_failed",
      `规则无声明：${block.header.slice(0, 32)}`,
    );
  }
  return `${scoped.join(", ")} { ${declarations.join(" ")} }`;
}
