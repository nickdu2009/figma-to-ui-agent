# M6 Restricted Live Final Aggregate

- runLabel: `20260727gf-v2-final-live`
- threshold: `0.05`
- apiBoundary: `figma=true`, `openai=false`, `figmaMe=false`, `variables=false`
- passed5PctCount: `6/6`
- averageDiff: `0.027818830936659007`
- minDiff: `0.009188834154351396`
- maxDiff: `0.04967816091954023`

| sample | projectId | diff | warnings | unsupported | status |
|---|---|---:|---:|---:|---|
| LoginUIConcept | `m6-live-community-login-001` | `0.04967816091954023` | 0 | 0 | passed |
| Mobile Profile | `m6-live-community-mobile-001-final` | `0.011221646055732361` | 6 | 1 | partial |
| Dashboard | `m6-live-community-dashboard-001-final` | `0.04832695855034722` | 36 | 1 | partial |
| Ecommerce | `m6-live-community-ecommerce-001` | `0.009188834154351396` | 6 | 0 | partial |
| Landing | `m6-live-community-landing-001` | `0.035881971465629055` | 33 | 0 | partial |
| Design System | `m6-live-community-design-system-001` | `0.012615414474353786` | 0 | 0 | passed |

Notes:

- Mobile and Dashboard were rerun against Figma live in the current code state.
- Mobile has one explainable `visual_stroke_icon_no_asset` unsupported item.
- Dashboard has one explainable `visual_layer_no_asset` unsupported item.
- No full-page screenshot/background fallback is used.
