<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-07-13 · **Executes:** `audits/PRIVACY-SECURITY-AUDIT-FINDINGS-2026-07-13.md` N1 · **Follows:** `SECURITY-REMEDIATION-FOLLOWUPS-2026-07-11-BRIEF.md` §2 (which extended *erasure* to these pages; this extends the *injection/egress backstop* to the same set)

# Extend CSP + the no-network gate to the standalone analysis pages (and `index.html`) — N1

## Goal & non-goals
**Goal:** bring the two defense-in-depth backstops the 10 owned bundles already carry — a meta-CSP and
no-network gate coverage — to the **same-origin, data-ingesting surfaces the remediation left uncovered**:
the standalone analysis/research pages and the `index.html` landing page. Close the inconsistency that
`dex-forget.js` already erases these pages' persisted checkpoints (`SECURITY-REMEDIATION-FOLLOWUPS §2`) yet
neither CSP nor the no-network gate touches them.

**Non-goals:** no runtime behavior change; no bundle edits (these pages are unbundled loose-`<script src>`
HTML); no strict-`script-src` refactor of the analysis pages unless it falls out for free (their inline
handlers are out of scope — baseline `connect-src`/`default-src` carries the value). The pure-narrative docs
and reference guides are a lower optional tier, not the priority.

## Why now
The no-network invariant is the suite's flagship privacy property and is now CI-enforced — but **only** over
the 8 bundles + 2 orchestrators (`no-network.html` `PAGES`, `tests/browser-gates.mjs` Gate 3). The analysis
pages load the real corpus, run DSP, and persist health-derived checkpoints, on the same origin as the
product. A stray `fetch`/beacon added to one of them — or an XSS via a crafted corpus file rendered there —
has no second line of defense and reds no gate. The remediation already conceded these pages hold
erasure-worthy health data; the backstop should follow the data.

## Scope — the surfaces (priority tier: data-ingesting)
`cgm-hrv-coupling-analysis.html` · `hrv-confound-analysis.html` · `nights-icc-analysis.html` ·
`sensor-trio-power-analysis.html` · `treatment-response-analysis.html` · `odi-bias-analysis.html` ·
`sigma-no-reference-analysis.html` · `qrs-equiv-analysis.html` · `qrs-yield-analysis.html` ·
`cohort-harness.html` · `cohort-runner.html` · `cohort-regression.html` · `PAT Feasibility.html` ·
`PpgDex Fusion Prototype.html` · **`index.html`** (landing).
**Lower optional tier (static, ingest nothing):** `* Reference.html`, `Science.html`, `Architecture.html`,
`Why This Exists.html`, `How to Collect Data.html`, the `*-selftest.html`/`*-roundtrip.html` harnesses.
Decide in-brief whether to sweep the lower tier for uniformity or leave it.

## Do
1. **Add the baseline meta-CSP** to each priority-tier page's `<head>` (first child, before any `<script>`):
   `default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
   - Pages that `fetch('uploads/…')` the local corpus (the cohort/analysis harnesses that read committed
     inputs) need **`connect-src 'self'`** instead of `'none'` — grep each for `fetch(` and set per-page.
     Record the per-page choice in a comment, mirroring the CPAPDex/Integrator `connect-src 'self'` note in the
     bundle CSP.
   - `style-src`/`script-src` keep `'unsafe-inline'` for now (these pages carry inline handlers/styles the
     strict-CSP refactor never touched — an explicit non-goal here; the value is the `connect-src` egress lock
     + `default-src`/`object-src`/`base-uri` injection surface reduction).
2. **Extend the no-network gate.** Add the priority-tier pages to `no-network.html`'s `PAGES` (a
   loose-`<script src>` page list alongside `ORCHESTRATORS`, `no-network.html:126`) so Layer-1 static scan +
   Layer-2 runtime boot cover them; the negative-control canary already proves the detector has teeth.
3. **Extend the CSP-presence assertion.** The `security · csp · *.src.html` group in `tests/dex-tests.js`
   (~`:1670`) asserts CSP on the bundles; add a sibling leg asserting the priority-tier standalone pages carry
   `connect-src 'none'|'self'`. Wire the page list into BOTH runners (`run-tests.mjs` + `Dex-Test-Suite.html`)
   the same way the bundle list is.

## Done when
- Every priority-tier page carries the meta-CSP (per-page `connect-src` recorded); `no-network.html` boots +
  scans them and is green including them; the `tests/dex-tests.js` CSP-presence leg covers them (both runners).
- `Dex-Test-Suite.html?full` all-green · `no-network.html` green (extended `PAGES`) · `verify-provenance.html`
  clean (untouched — no bundle changed) · `build.mjs --check` clean.
- **No bundle re-bundled, no `manifestHash` moved, no fixture regenerated** (these pages are outside
  `BUILD-MANIFEST.json`). If any owned bundle's `.src.html` is touched, that's out of scope — flag it.
- A changeset dropped in `changes/` (`bump: minor` — additive gate/hardening; `type`/`brief` per
  `changes/README.md`).

## Notes
- **EXPORT-INERT / no bundle churn** is the whole economics here — this is HTML `<head>` + test-list work, the
  cheap analogue of the F7 CSP pass, precisely because the analysis pages aren't inlined.
- Touches no frozen name (`Ganglior`, the `fascia` alias, `ganglior.node-export` schema) and no Clock Contract
  surface. Adds no egress — it *removes* the ability to add egress silently.
