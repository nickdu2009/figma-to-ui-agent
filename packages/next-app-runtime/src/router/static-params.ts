import type { NextAppSpec } from "../contract/types.js";

// Adapted from @json-render/next 0.19.0 packages/next/src/router.ts.

function ownStringParam(
  params: Record<string, string>,
  name: string,
): string | undefined {
  if (!Object.hasOwn(params, name)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(params, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function buildSlugFromPattern(
  pattern: string,
  params: Record<string, string>,
): string[] | null {
  if (pattern === "/") return [];
  const result: string[] = [];
  for (const segment of pattern.split("/").slice(1)) {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      const value = ownStringParam(params, segment.slice(5, -2));
      if (value) result.push(...value.split("/"));
    } else if (segment.startsWith("[...") && segment.endsWith("]")) {
      const value = ownStringParam(params, segment.slice(4, -1));
      if (!value) return null;
      result.push(...value.split("/"));
    } else if (segment.startsWith("[") && segment.endsWith("]")) {
      const value = ownStringParam(params, segment.slice(1, -1));
      if (!value) return null;
      result.push(value);
    } else {
      result.push(segment);
    }
  }
  return result;
}

export function collectStaticParams(spec: NextAppSpec): { slug: string[] }[] {
  const result: { slug: string[] }[] = [];
  for (const [pattern, route] of Object.entries(spec.routes)) {
    if (route.staticParams) {
      for (const params of route.staticParams) {
        const slug = buildSlugFromPattern(pattern, params);
        if (slug) result.push({ slug });
      }
    } else if (!pattern.includes("[")) {
      result.push({ slug: pattern === "/" ? [] : pattern.slice(1).split("/") });
    }
  }
  return result;
}
