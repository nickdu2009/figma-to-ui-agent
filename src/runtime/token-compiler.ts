/**
 * Design Token 编译器（设计 §5.1/§11.2，计划 S6）：
 * - primitive→semantic→component 三层解析：引用必须闭合、无环、无悬空；
 * - 只接受 allowlist 值（颜色 #RRGGBB[AA]、带单位长度、受限字重/缓动等）；
 * - 输出限定在 Preview root 的 CSS 自定义属性表（--vma-pt-/--vma-st-/--vma-ct-）
 *   与结构化 fontFamily 资源 IR（供 AssetUrlResolver 生成命名空间 FontFace）；
 * - Token 键与 CSS 标识符注入：键只允许安全字符，编译产物确定性可缓存。
 *
 * 编译失败 fail closed（throw TokenCompilerError，携带稳定 code）。
 */

/** 稳定错误码（S6 合同测试锁定）。 */
export type TokenCompilerErrorCode =
  | "token_key_invalid"
  | "token_ref_dangling"
  | "token_ref_cycle"
  | "token_limit_exceeded"
  | "token_value_invalid";

export class TokenCompilerError extends Error {
  constructor(
    readonly code: TokenCompilerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TokenCompilerError";
  }
}

/** §11.2：CSS 自定义变量总数 ≤ 512。 */
export const TOKEN_CUSTOM_PROPERTY_LIMIT = 512;

/** Token 键：字母开头，允许字母数字与 `.`/`-`/`_`（`.` 编译为 `-`）。 */
const TOKEN_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const CSS_IDENT_PATTERN = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

/** 字体家族的 CSS 标识符（candidateDigest 命名空间后的最终名）。 */
export const FONT_FAMILY_PREFIX = "vmaf";

export interface CompiledFontAssetRef {
  assetId: string;
  /** 平台生成的命名空间 family 名（vmaf-<digest>-<assetId>）。 */
  familyName: string;
}

export interface CompiledTokens {
  /** Preview root 作用域的自定义属性声明块（不含选择器）。 */
  customProperties: string;
  /** fontFamily(assetId) 资源 IR（Controller 交 AssetUrlResolver 解析）。 */
  fontAssetRefs: readonly CompiledFontAssetRef[];
  /** token 键 → 编译后 CSS 变量名（供诊断/测试；不进入运行时状态）。 */
  variableNames: Readonly<Record<string, string>>;
}

function sanitizeKey(key: string): string {
  return key.replaceAll(".", "-");
}

function assertKey(key: string, layer: string): string {
  if (!TOKEN_KEY_PATTERN.test(key)) {
    throw new TokenCompilerError(
      "token_key_invalid",
      `${layer} token 键含非法字符：${key}`,
    );
  }
  return sanitizeKey(key);
}

function colorValue(value: string): string {
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
    throw new TokenCompilerError("token_value_invalid", `非法颜色字面量：${value}`);
  }
  return value.toLowerCase();
}

function lengthValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) {
    throw new TokenCompilerError("token_value_invalid", "长度 token 非有限数");
  }
  return `${value}${unit}`;
}

function shadowValue(
  stops: ReadonlyArray<{
    x: number;
    y: number;
    blur: number;
    spread: number;
    color: string;
  }>,
): string {
  if (stops.length === 0) {
    throw new TokenCompilerError("token_value_invalid", "shadow token 缺少 stops");
  }
  return stops
    .map(
      (stop) =>
        `${stop.x}px ${stop.y}px ${stop.blur}px ${stop.spread}px ${colorValue(stop.color)}`,
    )
    .join(", ");
}

/** 编译单个 primitive 值为 CSS 值；fontFamily(assetId) 产出 IR 而非字面量。 */
function compilePrimitiveValue(
  token: Record<string, unknown>,
  digestPrefix: string,
  fontRefs: CompiledFontAssetRef[],
): string {
  switch (token.type) {
    case "color":
      return colorValue(token.value as string);
    case "length":
      return lengthValue(token.value as number, token.unit as string);
    case "number":
      return String(token.value);
    case "fontWeight":
      return String(token.value);
    case "shadow":
      return shadowValue(token.value as Parameters<typeof shadowValue>[0]);
    case "duration":
      return `${token.valueMs}ms`;
    case "easing": {
      const points = token.value as readonly number[];
      return `cubic-bezier(${points.join(", ")})`;
    }
    case "fontFamily": {
      const value = token.value as { system?: string; assetId?: string };
      if (value.system) {
        return value.system;
      }
      const assetId = value.assetId ?? "";
      if (assetId === "") {
        throw new TokenCompilerError("token_value_invalid", "fontFamily 缺少 assetId");
      }
      const familyName = `${FONT_FAMILY_PREFIX}-${digestPrefix}-${sanitizeKey(assetId)}`;
      if (!CSS_IDENT_PATTERN.test(familyName)) {
        throw new TokenCompilerError("token_value_invalid", `fontFamily 标识符非法：${familyName}`);
      }
      fontRefs.push({ assetId, familyName });
      return familyName;
    }
    default:
      throw new TokenCompilerError("token_value_invalid", `未知 primitive 类型`);
  }
}

/** 悬空引用检测 + 环检测的语义层解析（返回叶子 primitive 键）。 */
function resolveSemanticChain(
  key: string,
  semantic: Readonly<Record<string, { $token: string }>>,
  primitiveKeys: ReadonlySet<string>,
): { leaf: string } {
  const seen = new Set<string>([key]);
  let current: string = key;
  for (let depth = 0; depth < 512; depth += 1) {
    if (primitiveKeys.has(current)) return { leaf: current };
    const next = semantic[current]?.$token;
    if (next === undefined) {
      throw new TokenCompilerError("token_ref_dangling", `semantic token 悬空引用：${current}`);
    }
    if (seen.has(next)) {
      throw new TokenCompilerError("token_ref_cycle", `semantic token 引用成环：${next}`);
    }
    seen.add(next);
    current = next;
  }
  throw new TokenCompilerError("token_ref_cycle", "semantic 解析超过最大深度");
}

export interface TokenCompilerInput {
  tokens: {
    primitive: Readonly<Record<string, Record<string, unknown>>>;
    semantic: Readonly<Record<string, { $token: string }>>;
    component: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
  };
  /** candidateDigest 的短前缀（keyframes/font 命名空间用）。 */
  digestPrefix: string;
}

/**
 * 编译三层 token：
 * - primitive：直接产出值（fontFamily assetId → IR + 命名空间 family 名）；
 * - semantic：链式解析到 primitive 叶子（悬空/成环 fail closed）；
 * - component：值允许 TokenRef（同上解析）或内联 primitive。
 * 总自定义属性数（含 IR）不超过 512。
 */
export function compileTokens(input: TokenCompilerInput): CompiledTokens {
  const { tokens } = input;
  const fontRefs: CompiledFontAssetRef[] = [];
  const declarations: string[] = [];
  const variableNames: Record<string, string> = {};

  const primitiveKeys = new Set(Object.keys(tokens.primitive));
  for (const [rawKey, token] of Object.entries(tokens.primitive)) {
    const key = assertKey(rawKey, "primitive");
    const value = compilePrimitiveValue(token, input.digestPrefix, fontRefs);
    const varName = `--vma-pt-${key}`;
    declarations.push(`${varName}: ${value};`);
    variableNames[`primitive.${rawKey}`] = varName;
  }

  for (const [rawKey, ref] of Object.entries(tokens.semantic)) {
    const key = assertKey(rawKey, "semantic");
    if (ref?.$token === undefined) {
      throw new TokenCompilerError("token_value_invalid", `semantic token 非法：${rawKey}`);
    }
    const { leaf } = resolveSemanticChain(rawKey, tokens.semantic, primitiveKeys);
    const varName = `--vma-st-${key}`;
    declarations.push(`${varName}: var(--vma-pt-${sanitizeKey(leaf)});`);
    variableNames[`semantic.${rawKey}`] = varName;
  }

  for (const [component, props] of Object.entries(tokens.component)) {
    const compKey = assertKey(component, "component");
    for (const [rawProp, value] of Object.entries(props ?? {})) {
      const propKey = assertKey(rawProp, "component.prop");
      const varName = `--vma-ct-${compKey}-${propKey}`;
      if (
        value !== null &&
        typeof value === "object" &&
        "$token" in (value as Record<string, unknown>)
      ) {
        const target = (value as { $token: string }).$token;
        if (typeof target !== "string") {
          throw new TokenCompilerError("token_value_invalid", `component token 引用非法：${component}.${rawProp}`);
        }
        if (primitiveKeys.has(target)) {
          declarations.push(`${varName}: var(--vma-pt-${sanitizeKey(target)});`);
        } else if (tokens.semantic[target] === undefined) {
          throw new TokenCompilerError(
            "token_ref_dangling",
            `component token 悬空引用：${component}.${rawProp} -> ${target}`,
          );
        } else {
          declarations.push(`${varName}: var(--vma-st-${sanitizeKey(target)});`);
        }
      } else {
        const inline = compilePrimitiveValue(
          value as Record<string, unknown>,
          input.digestPrefix,
          fontRefs,
        );
        declarations.push(`${varName}: ${inline};`);
      }
      variableNames[`component.${component}.${rawProp}`] = varName;
    }
  }

  const totalVars = declarations.length + fontRefs.length;
  if (totalVars > TOKEN_CUSTOM_PROPERTY_LIMIT) {
    throw new TokenCompilerError(
      "token_limit_exceeded",
      `token 自定义属性总数 ${totalVars} 超过 ${TOKEN_CUSTOM_PROPERTY_LIMIT}`,
    );
  }

  return {
    customProperties: declarations.join("\n"),
    fontAssetRefs: fontRefs,
    variableNames,
  };
}
