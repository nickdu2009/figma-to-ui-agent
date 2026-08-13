import type { MatchedRoute, NextAppSpec } from "../contract/types.js";

// Adapted from @json-render/next 0.19.0 packages/next/src/router.ts.

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
    const params: Record<string, string | string[]> = {};
    for (let index = 0; index < route.paramNames.length; index += 1) {
      const name = route.paramNames[index]!;
      const value = match[index + 1];
      params[name] = route.catchAll || route.optionalCatchAll
        ? value
          ? value.split("/")
          : []
        : (value ?? "");
    }
    return { route: spec.routes[route.pattern]!, pattern: route.pattern, params };
  }
  return null;
}

export function slugToPath(slug: string[] | undefined): string {
  return !slug || slug.length === 0 ? "/" : `/${slug.join("/")}`;
}
