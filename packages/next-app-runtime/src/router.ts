export { matchRoute, slugToPath } from "./router/match-route.js";
export { collectStaticParams } from "./router/static-params.js";
export {
  resolveMetadata,
  type ResolvedMetadata,
} from "./router/metadata.js";
export type {
  MatchedRoute,
  NextAppSpec,
  NextMetadata,
  NextRouteSpec,
} from "./contract/types.js";
