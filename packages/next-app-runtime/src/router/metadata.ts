import type {
  NextAppSpec,
  NextMetadata,
  NextRouteSpec,
} from "../contract/types.js";

// Adapted from @json-render/next 0.19.0 packages/next/src/metadata.ts.

export type ResolvedMetadata = Record<string, unknown>;

function resolveTitle(
  globalTitle: NextMetadata["title"],
  routeTitle: NextMetadata["title"],
): unknown {
  if (!routeTitle && !globalTitle) return undefined;
  if (!routeTitle) {
    return typeof globalTitle === "object" && globalTitle
      ? globalTitle.default
      : globalTitle;
  }
  if (typeof routeTitle === "object" && routeTitle) {
    if (routeTitle.absolute) return routeTitle.absolute;
    return routeTitle;
  }
  if (
    typeof globalTitle === "object" &&
    globalTitle?.template
  ) {
    return globalTitle.template.replace("%s", routeTitle);
  }
  return routeTitle;
}

function mergeObject(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}

export function resolveMetadata(
  spec: NextAppSpec,
  route?: NextRouteSpec | null,
): ResolvedMetadata {
  const globalMeta = spec.metadata;
  const routeMeta = route?.metadata;
  if (!globalMeta && !routeMeta) return {};
  const result: ResolvedMetadata = {};
  const title = resolveTitle(globalMeta?.title, routeMeta?.title);
  if (title !== undefined) result.title = title;
  const description = routeMeta?.description ?? globalMeta?.description;
  if (description) result.description = description;
  const keywords = routeMeta?.keywords ?? globalMeta?.keywords;
  if (keywords) result.keywords = keywords;
  const openGraph = mergeObject(globalMeta?.openGraph, routeMeta?.openGraph);
  if (openGraph) result.openGraph = openGraph;
  const twitter = mergeObject(globalMeta?.twitter, routeMeta?.twitter);
  if (twitter) result.twitter = twitter;
  const robots = routeMeta?.robots ?? globalMeta?.robots;
  if (robots) result.robots = robots;
  const alternates = routeMeta?.alternates ?? globalMeta?.alternates;
  if (alternates) result.alternates = alternates;
  const icons = routeMeta?.icons ?? globalMeta?.icons;
  if (icons) result.icons = icons;
  return result;
}
