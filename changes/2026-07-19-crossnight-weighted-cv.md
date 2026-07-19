<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [oxydex, ecgdex, ppgdex, pulsedex, cpapdex]
brief: DEEP-AUDIT-II-2026-07-18-BRIEF.md
---
Cross-night `central.sd` and `central.cv` divided an **unweighted** spread by a **coverage-weighted** centre: `const m = wmean(vals, w), s = sd(vals)`. A night the envelope had deliberately down-weighted still contributed its full deviation, so the spread — and the CV% built from it — over-reported instability. On routine CPAP partial-use that reads **74.6 % where the consistent figure is 49.8 %**.

It was a breach of the spec in writing: `CROSSNIGHT-ENVELOPE-SPEC` §3 states low-quality items are "down-weighted in **every** fit/aggregate via `weight`". `ols(idx, vals, w)` one line below already passed weights; `sd()` had no weight parameter at all.

Cloned identically across all five `*-cross.js` modules, so all five are fixed as one unit with a shared `wsd(vals, w)` using the reliability-weight form: `V1 = Σw`, `V2 = Σw²`, `s² = Σw(x−m_w)² / (V1 − V2/V1)`.

**Why every committed fixture holds.** Under uniform weights `V1 = n` and `V2 = n`, so the denominator is exactly `n−1` — the new form reduces to the existing Bessel-corrected `sd()` bit for bit. That is also why the defect survived: *every* crossnight test fed a uniform weight vector (the two long-standing pins directly above the new ones use coverage 90 on all 8 nights), so the two formulas were indistinguishable to the entire suite. Confirmed empirically rather than argued — all **10** re-verified fixtures reproduced byte-identical, including `cpapdex_synthetic_multinight_golden`, which does carry a crossNight block.

Only a **varying** weight vector separates the formulas, so that is what the gate adds. Hand-derived: meanSpo2 `[95,95,95,80]` at coverage `[100,100,100,20]` ⇒ `m_w = 94.0625`, `denom = 2.25`, `Σw(x−m_w)² = 42.1875` ⇒ `s_w = √18.75 ≈ 4.33`, `cv_w ≈ 4.60`. The pre-fix numbers on the same input are `sd = 7.5` and `cv = 8.0`. Mutation-verified: reverting to `sd(vals)` reproduces exactly 7.5 and 8.0 while every uniform-weight pin stays green — the old code passes the whole suite and fails only the varying-weight case.

Export-inert — **proven**, not asserted: 10 fixtures re-ran through the suite and reproduced byte-identical (`verify-fixtures` stamps only on reproduction). Five bundles plus both orchestrators rebuilt.
