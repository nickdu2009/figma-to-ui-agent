# `next-website-builder` 0.19.0 parity record

## Reference

- Source repository: [`vercel-labs/json-render`](https://github.com/vercel-labs/json-render)
- Reference tag: `v0.19.0`
- Reference commit: `0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7`
- Migrated source inventory: `provenance-manifest.json`
- Frozen source and license record: `UPSTREAM.md`
- Flow contract: `comparison/flow-matrix.md`
- Difference boundary: `comparison/allowed-differences.md`

The 23 files in the official `examples/next-website-builder` directory are
accounted for by the provenance manifest. `lib/default-spec.ts` remains
content-equivalent to the reference and is guarded by a source SHA-256 test.

## Deliberate platform substitutions

The migrated application keeps the example capability and appearance while
removing its Next.js server/runtime dependency:

| Reference | Migrated application |
| --- | --- |
| Next.js App Router and server helpers | Browser History API and `@next-app-runtime/client` |
| `/api/spec` process-local store | Versioned browser `localStorage` with same-tab and cross-tab notifications |
| React Server Component entry points | Vite client entry point |
| `next/font` integration | The same two `geist@1.7.0` OFL variable-font files loaded by CSS |
| Next build-time OKLCH conversion | Equivalent LAB theme overrides copied from the reference production CSS |
| shadcn `Link` component | Runtime-owned and injected `Link` component |

The migrated shadcn `Stack` catalog makes the five props optional and the
registry normalizes omitted values to `null`. This is the narrow compatibility
adapter required because the official default spec omits two props while the
private runtime deliberately validates component props strictly.

Server exports and the HTTP API are intentionally absent. No additional
NextAppSpec fields or semantics are introduced.

## Oracle procedure and result

The reference was cloned into an isolated temporary directory, checked out at
the exact commit above, installed with its frozen pnpm lockfile, and built in
dependency order. The reference example requires these workspace builds before
its own build:

1. `@internal/react-state`
2. `@json-render/core`
3. `@json-render/react`
4. `@json-render/next`
5. `@json-render/shadcn`
6. `example-next-website-builder`

The committed parity harness is run only when both already-running URLs are
provided:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
JSON_RENDER_ORACLE_URL=http://127.0.0.1:43193 \
NEXT_APP_RUNTIME_CANDIDATE_URL=http://127.0.0.1:43194 \
npm run test:parity --workspace next-app-runtime-website-builder
```

Validated routes: `/`, `/about`, `/contact`, and `/builder`. The harness uses
one Chromium process with a 1440x900 viewport, `en-US`, light color scheme, and
reduced motion. It verifies titles, representative visible content, Builder
controls, Visual JSON editing, persistence, new-tab website rendering, route
navigation, back/forward and refresh. It decodes full-page PNG output to compare
every RGB pixel with zero tolerance.

Result on 2026-08-12: the four baseline routes and the edited Builder
checkpoint all had zero changed RGB pixels. The full behavior flow passed on
both implementations, with the documented SSG-versus-browser-store read-point
difference at the newly opened website tab.
