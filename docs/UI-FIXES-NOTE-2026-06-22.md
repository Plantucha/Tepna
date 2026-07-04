<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# Dated Note — Dashboard UI fixes + cross-night σ guard (2026-06-22)

Brief record of a review-driven pass. All apps were edited at source (`*.js` / `*.src.html`),
re-bundled via the inliner, and gated before close. **Both gates green at end:**
`Dex-Test-Suite.html` = **757 passed / all green**; `verify-provenance.html` = **GATE A all-match,
no drift**.

## 1. Per-app UI fixes

### OxyDex
- **σ overflow fixed** — z-scores no longer explode (`+100000000σ`) on a degenerate baseline; see §3.
- **Secondary hero (Apnea Bench) filled** — added a measured oximetry KPI strip (Min SpO₂ / Mean SpO₂ /
  T90) to `oxyHeroBenchCard` (`oxydex-fusion.js`) + `.opc-kpi*` CSS, so it no longer reads half-empty.
- **VO₂max trend graph removed** from `oxydex-render.js` (per-night VO₂ cards kept).
- **License ribbon → page bottom** — `.dxl-ribbon{order:10}` in the `#results` flex column (`OxyDex.src.html`).

### CPAPDex
- **Primary hero added** — `heroCard(night)` in `cpapdex-render.js`: "Therapy Control · Last Night",
  residual-AHI headline + tier, Usage/Leak/Pressure/ODI subscores, compliance/PB/OA·CA chips
  (reuses `ans-design.css` `.readiness-hero`).
- **Demo oximeter simulation** — `simulateOximetrySA2()` (`cpapdex-app.js`) rewrites ONLY the SpO₂/Pulse
  sample bytes of the demo SA2 EDF **in memory** (captured `.edf` on disk untouched → capture provenance
  intact). Desaturations are placed at the night's OWN scored apnea/hypopnea events (parsed from EVE/CSL
  annotations, ~12 s kinetic lag), so **ODI ≈ device AHI** (3.0 vs 2.8, T90 0) — coherent well-controlled
  night, not the earlier mismatched ODI ~12.

### PulseDex · ECGDex · PpgDex · HRVDex
- **Validated secondary hero added** — `renderHrvBench(r)` in each node's render/profile/overview file,
  filling the `#heroTop` slot vacated by the removed ANS-age card. Reuses `.proj-card` heroTop styling;
  content is the node's validated time-domain HRV bench (rMSSD headline; SDNN / Poincaré SD1·SD2 or CAI /
  pNN50 · HF n.u.; node-appropriate extras).
- **ECGDex signal-quality badge repositioned** — the "% analyzable" indicator moved out of the readiness
  recommendation chips to a pinned **top-right corner badge** on the hero (`.readiness-quality-badge`,
  `ECGDex.src.html`).
- **PpgDex generator now emits a device `*_PPI.txt`** so the Pulse-Interval Validation lane populates.
  Built from the window's ground-truth RR + zero-mean optical beat-detection noise (σ≈34 ms) so device ↔
  self agree on BOTH mean and rMSSD (**96.5% agreement; rMSSD 60.6/54.4**), instead of the 2× rMSSD gap a
  clean-truth reference produced.

### index.html (standalone, not bundled)
- Animations frozen into a **static picture**: each canvas loop renders a single frame (RAF recursion
  removed), the score reveal is fixed at its end value, and the looping CSS animations (pulse/ring/eq/fire)
  are disabled (eq bars given static heights). (Interim step before this: animations had been slowed ~4×.)

## 2. Latent bug found during the pass — fixed suite-wide
The exact σ-overflow cause (`const ps = sd(prior) || 1e-9; … /ps`) was present in **all five** cross-night
modules. A near-zero baseline SD made z explode to ±1e8 σ and overflow trend cards. Replaced with a
mean-relative SD floor + clamp to ±20 σ in:
`oxydex-cross.js`, `ppgdex-cross.js`, `pulsedex-cross.js`, `ecgdex-cross.js`, `cpapdex-cross.js`.
Normal-variance data is unaffected (the existing `zLatest finite` + baseline-reconstruction tests stay green).

## 3. Build / gate bookkeeping
- Re-bundled (inliner): OxyDex, PulseDex, ECGDex, PpgDex, CPAPDex, HRVDex.
- `BUILD-MANIFEST.json` — updated `manifestHash` (GATE A) for every re-bundled app. Final values:
  OxyDex `61ce90b82bc2` · PulseDex `e1eda5281400` · ECGDex `5832bc943f2b` · PpgDex `fcea253de06e` ·
  CPAPDex `bd1852840379` · HRVDex `3a9f8636c012`. (`buildHash` left as-is — coarse / GATE-A-irrelevant.)
- `FIXTURE-PROVENANCE.json` — OxyDex fixture stamp bumped to the new `manifestHash` (the single-night
  summary's numeric content is unchanged by render/CSS edits + the non-firing clamp; only the bundle hash
  moved).
- `Dex-Test-Suite.html` — updated ONE browser-only render-coverage assertion: the CPAPDex demo now ships a
  simulated oximeter, so the check asserts the SA2 lane POPULATES (ODI rendered) rather than the old
  oximeter-absent path. Group is 13/13.

## Not changed (considered, left intentionally)
- `buildHash` fields (documented coarse / non-deterministic; GATE A uses `manifestHash`).
- Other DSP `||1e-9` guards (bounded correlation/slope denominators — not the user-visible σ class).
- HRVDex has no `*-cross.js` (its z is computed differently) — unaffected by §2.
