# Upstream reference

This example is a private client-runtime port of the Apache-2.0 licensed
`examples/next-website-builder` application in
[`vercel-labs/json-render`](https://github.com/vercel-labs/json-render).

## Frozen source

- Tag: `v0.19.0`
- Commit: `0bbe6ed6394b23b5aee25320d03c9b7ac717e5b7`
- Example tree object: `9d5a6f72b1b37b229f520aa568684b0e4ae8fe39`
- Source root: `examples/next-website-builder`
- Upstream license SHA-256: `014bb31e83d5c2e76aea1cc6e82217346ab41362f32cb355ad0f5c10aa0aeaff`
- `packages/next/package.json` SHA-256:
  `eb0032c6d2988c9e7f31dd3577bc491e67ae8d8b043b5b2764234ea15a352174`

`provenance-manifest.json` accounts for all 23 files under the source root and
pins each source file by SHA-256. The source checkout is an evidence input, not
a build-time dependency of this workspace.

## Published 0.19.0 dependencies

The npm lock records these verified tarball integrities:

| Package | Integrity |
| --- | --- |
| `@json-render/core@0.19.0` | `sha512-vvcyZ+10EDZKbEyB1J2kXOGfDaiZR2LurZGSqi2r5STHyKr+Te85DWaBxTwRGgM7U1LtIvNx85BzzjElRKoAIg==` |
| `@json-render/react@0.19.0` | `sha512-kTW6b6cSNRrlEfCUf/69SLoLn+CufC968ruge9tnQlp9pDTGG/SK8pgM541FdgwMFA4zm3s5mpM3G8rdODKc/A==` |
| `@json-render/shadcn@0.19.0` | `sha512-W4q/n1fEQPH4vV0ITCkwv60D27dgr8xGj41MUt905aefPX2ZDfr3M7A38whJaYhlD/2QUI0bGudBercDBSy1ow==` |

The two checked-in Geist variable-font files and `LICENSES/OFL-1.1.txt` are
exact copies from `geist@1.7.0`. Their source paths and SHA-256 values are
pinned under `bundledArtifacts` in `provenance-manifest.json` and verified
against the checked-in targets by the migration contract test.

## Ownership

The upstream application and `@json-render/*` code remain under Apache-2.0.
The migrated example itself is private and `UNLICENSED`; its private package
identity must not imply that it is an official json-render package.
