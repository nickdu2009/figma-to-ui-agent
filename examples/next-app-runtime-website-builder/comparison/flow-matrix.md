# Oracle and candidate flow matrix

Both implementations run production builds in one Chromium process with a
1440x900 viewport, DPR 1, `en-US`, light color scheme, reduced motion, and font
readiness waits.

| Step | Oracle action and expected result | Candidate action and expected result |
| --- | --- | --- |
| 1. Home | Open `/`; heading `Build the future with Acme`, title `Home \| Acme Inc` | Same |
| 2. About | Open/click `/about`; heading `About Acme Inc`, matching title | Same; same-origin clicks use Browser History without document replacement |
| 3. Contact | Open/click `/contact`; heading `Get in Touch`, matching title | Same; same-origin clicks use Browser History without document replacement |
| 4. History | Back to About, forward to Contact, refresh Contact | Same |
| 5. Builder baseline | Open `/builder`; `spec.json`, route tabs, address bar, Visual JSON, resizable preview, and default heading are visible | Same; only private package attribution differs in `document.title` |
| 6. Visual JSON edit | Double-click the Visual JSON headline value, enter `Edited in the parity flow`, press Enter; embedded preview changes immediately | Same selector, action, and immediate result |
| 7. Persistence | Wait more than 500ms, refresh `/builder`; edited heading remains | Same, backed by `localStorage` |
| 8. Edited pixels | Capture full-page Builder PNG after fonts and two animation frames settle | Decode both PNGs and require zero changed RGB pixels |
| 9. New tab | Click `View Website`; the SSG `/` output displays the build-time default heading and route metadata | The new `/` tab reads browser storage and displays the edited heading and route metadata |
| 10. Website navigation | Navigate About and Contact, then back, forward, and refresh; route headings/titles remain correct | Same observable route result through the private History Router; the edited home value remains available |
| 11. Existing-tab update | No push channel exists; another tab observes the module-store value after a load | A later Visual JSON edit is delivered immediately to an existing same-origin tab by the native `storage` event |
| 12. Invalid persisted value | Invalid input must not become a valid rendered page | Explicit storage error is shown and the last runtime `current` remains rendered; no silent default repair |

The automated parity test covers steps 1-10 and strict pixels at the baseline
and edited Builder checkpoints. Candidate browser tests additionally cover
steps 11-12 because the accepted storage medium deliberately has a different
notification scope from the oracle.
