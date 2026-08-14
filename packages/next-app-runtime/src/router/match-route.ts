import type { MatchedRoute, NextAppSpec } from "../contract/types.js";

// Adapted from @json-render/next 0.19.0 packages/next/src/router.ts.

const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_CREATE = Object.create;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_KEYS = Object.keys;
const ARRAY_IS_ARRAY = Array.isArray;

interface CompiledRoute {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  catchAll: boolean;
  optionalCatchAll: boolean;
  specificity: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileRoute(pattern: string): CompiledRoute {
  const paramNames: string[] = [];
  let catchAll = false;
  let optionalCatchAll = false;
  let specificity = 0;
  const segments = pattern === "/" ? [""] : pattern.split("/").slice(1);
  const regexParts: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      paramNames.push(segment.slice(5, -2));
      optionalCatchAll = true;
      regexParts.push("(?:/(.+))?");
    } else if (segment.startsWith("[...") && segment.endsWith("]")) {
      paramNames.push(segment.slice(4, -1));
      catchAll = true;
      regexParts.push("/(.+)");
    } else if (segment.startsWith("[") && segment.endsWith("]")) {
      paramNames.push(segment.slice(1, -1));
      regexParts.push("/([^/]+)");
    } else {
      specificity += 1;
      regexParts.push(`/${escapeRegExp(segment)}`);
    }
  }

  return {
    pattern,
    regex: new RegExp(pattern === "/" ? "^/$" : `^${regexParts.join("")}$`),
    paramNames,
    catchAll,
    optionalCatchAll,
    specificity,
  };
}

function encodeIdentityString(value: string): string {
  return `${value.length}:${value}`;
}

export function routeIdentity(
  pattern: string,
  params: Readonly<Record<string, string | string[]>>,
  discriminator?: string | null,
): string {
  const keys = OBJECT_KEYS(params).sort();
  let identity = `p${encodeIdentityString(pattern)}n${keys.length}:`;
  for (const key of keys) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(params, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Route parameters must be own data properties");
    }
    identity += `k${encodeIdentityString(key)}`;
    const value = descriptor.value as unknown;
    if (typeof value === "string") {
      identity += `s${encodeIdentityString(value)}`;
      continue;
    }
    if (!ARRAY_IS_ARRAY(value)) {
      throw new TypeError("Route parameter values must be strings or string arrays");
    }
    identity += `a${value.length}:`;
    for (let index = 0; index < value.length; index += 1) {
      const item = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, String(index));
      if (!item || !("value" in item) || typeof item.value !== "string") {
        throw new TypeError("Catch-all route parameters must contain own string values");
      }
      identity += encodeIdentityString(item.value);
    }
  }
  return discriminator === undefined
    ? identity
    : discriminator === null
      ? `${identity}d-`
      : `${identity}d${encodeIdentityString(discriminator)}`;
}

export function matchRoute(
  spec: NextAppSpec,
  pathname: string,
): MatchedRoute | null {
  const normalizedPath = pathname === "" ? "/" : pathname;
  const compiled = Object.keys(spec.routes).map(compileRoute);
  compiled.sort((left, right) => {
    if (left.optionalCatchAll !== right.optionalCatchAll) {
      return left.optionalCatchAll ? 1 : -1;
    }
    if (left.catchAll !== right.catchAll) {
      return left.catchAll ? 1 : -1;
    }
    if (left.specificity !== right.specificity) {
      return right.specificity - left.specificity;
    }
    return left.paramNames.length - right.paramNames.length;
  });

  for (const route of compiled) {
    const match = route.regex.exec(normalizedPath);
    if (!match) continue;
    const params = OBJECT_CREATE(null) as Record<string, string | string[]>;
    for (let index = 0; index < route.paramNames.length; index += 1) {
      const name = route.paramNames[index]!;
      const value = match[index + 1];
      const param = route.catchAll || route.optionalCatchAll
        ? value
          ? value.split("/")
          : []
        : (value ?? "");
      OBJECT_DEFINE_PROPERTY(params, name, {
        configurable: true,
        enumerable: true,
        value: param,
        writable: true,
      });
    }
    return { route: spec.routes[route.pattern]!, pattern: route.pattern, params };
  }
  return null;
}

export function slugToPath(slug: string[] | undefined): string {
  return !slug || slug.length === 0 ? "/" : `/${slug.join("/")}`;
}
