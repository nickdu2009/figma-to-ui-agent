# Allowed differences from the v0.19.0 oracle

Parity is judged at the application-owned body, behavior, and decoded-pixel
levels. There is no non-zero pixel tolerance and no masked body region.

The following differences are intentional and bounded:

| Area | v0.19.0 oracle | Private candidate |
| --- | --- | --- |
| Framework container | Next.js production document, hydration data and scripts | Vite CSR document and module script |
| Server exports | RSC route/layout, metadata/static-param helpers and route handler | Absent; the package is client-only |
| Build/port | Temporary Next production build and explicit localhost port | Vite production build and a different explicit localhost port |
| Static attribution | Builder title/description name `json-render` and `@json-render/next` | Builder title/description identify `@next-app-runtime/client` |
| Spec storage medium | Process-local Node module value exposed by `/api/spec` | Versioned same-origin `localStorage` |
| Website read point | The three website routes are SSG output and remain on the build-time default even after a Builder edit | Website routes read the latest successful browser-stored spec on load |
| Store sharing scope | Builder requests handled by one server process share the module value; website SSG output and existing tabs are not pushed | Shared by same-origin tabs in one browser profile through native `storage` events |
| Loader snapshot ownership | Loader records are merged by reference on the server | Client runtime snapshots own and deeply freeze ownership-safe structured data (plain records/arrays, Map, Set, Date and Error); other values fail the loader instead of entering a mutable revision |
| Action lifecycle observation | `@json-render/core@0.19.0` exposes a process-global observer without a runtime identity | Runtime-scoped host component dispatch/settle events are reported; unscoped, watch and chained lifecycle notifications are suppressed rather than attributed to the wrong runtime. Action execution is unchanged |

Two compatibility substitutions do not grant visual or behavioral tolerance:

- The official shadcn `Link` registration is replaced by the runtime-owned
  `Link`; rendered anchors and navigation behavior remain equivalent.
- The upstream default spec omits some nullable `Stack` keys even though the
  published 0.19.0 catalog marks them required. The candidate's host-only
  adapter accepts those omissions and passes `null` to the unchanged shadcn
  implementation. This does not add or remove any `NextAppSpec` field or
  component/action name.

Not allowed: different application text, component inventory, route/layout
structure, visible DOM semantics, layout, styles, Builder controls, Visual JSON
editing behavior, page navigation result, metadata result, or any decoded RGB
pixel difference at a compared checkpoint.
