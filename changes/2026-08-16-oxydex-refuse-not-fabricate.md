---
bump: patch
type: fixed
brief: DEEP-AUDIT-V-FOLLOWUPS-2026-08-05-BRIEF.md
---

OxyDex fabricated a **clinical stratification** on insufficient input — the Clock Contract §2.6 rule
(*"a missing stamp must be visible (null), never fabricated"*) never inherited by the DSP.

**This is worse than a fabricated number.** All three metrics are `emerging` with goodDirection
`down`, so **0 is the best value the scale can express**, and the quintile labels say so outright:

```js
if (n < 60 || durationHr <= 0) return { sbii: 0, sbiiQ: 'Q1(low)' };
if (!n)                        return { pred3p: 0, pred3pQ: 'Q1' };
if (n < 60)                    return { desSev: 0 };
```

`sbii` is cited as *"SHHS-calibrated quintiles; best oximetry predictor of CVD mortality (Hui 2024,
Respirology 29:825)"*. Insufficient data returned the **lowest-risk quintile** — a judgement the
reader takes as made, not as missing.

**The direction is what makes this a class rather than three bugs.** Every surfaced default fails
toward the reassuring answer: `odi1Rate: 0` (no desaturations), `oxyCrashCount: 0`, `desSev: 0`,
`Q1(low)`, `Q1`. Missing data always read as healthy.

**The consumer completed the fabrication, exactly as `hfnu` did in ECGDex.** `0.6 * null` is 0, so an
absent DesSev silently dropped its term from the Kulkas estimate. Measured: `ahiKulkas` returned
**5.7 instead of refusing** — a specific, plausible, LOW AHI from a measurement that never happened.
`ahiODI4` had the same flaw via `null * 1.1 === 0`. Each now refuses only on the inputs it uses, so a
missing DesSev does not take `ahiODI4` down with it.

**One exit deliberately still returns zero, and that distinction is the point.** `computeSBII` has
two. `n < 60 || durationHr <= 0` could not look, so it refuses. `!nadirEvents.length` is reached only
AFTER that guard passed — the night was long enough and the detector found nothing, which is a
**measurement** whose honest answer is `0`/`Q1(low)`. Nulling it would fabricate ABSENCE and destroy
a true negative. **Refuse when you could not look; report zero when you looked and found nothing.**
Both cases are asserted, because a fix that only moves the failure is not a fix.

**Seen to fail against `origin/main` first** — seven red, not written after the change:

```
✕ sbii  got 0 · ✕ sbiiQ  got "Q1(low)" · ✕ pred3p  got 0 · ✕ pred3pQ  got "Q1"
✕ desSev  got 0 · ✕ ahiKulkas  got 5.7 · ✕ ahiODI4  got 0
✓ ahiODI4 still computes from the input it DOES have (5.5)   ← non-regression
```

## 🔴 PpgDex was attempted and REVERTED — the fleet already decided it the other way

`cvhrFromNN` has the identical shape, and `ppgdex-dsp.js:1885` states the Integrator corroborates
finger CVHR against ECGDex cardiac CVHR so *"they MUST share a method"*. Two sessions independently
concluded it therefore had to be nulled alongside ECGDex. **Both were wrong, and the suite already
said so** — nulling it broke six assertions across four groups:

- `'a 90 s recording refuses rather than guessing'` asserts `cvhrIndex === 0`: here **zero IS the
  refusal marker**, deliberately
- `'the golden carries apnea.cvhrIndex (a NUMBER — 0 is a measurement, null is not)'`
- two committed goldens pin it byte-for-byte, and the Integrator's `summary.cvhrIndexWave`
  corroboration reads a number

The fleet made a different contract for the Integrator-facing surface than for ECGDex's internal one.
Changing THAT has goldens and a consumer behind it and is not a refactor to slip into a refusal fix.
Recorded in `tests/dex-tests.js` beside the OxyDex group, where the next person will look.

The general lesson is the one this repo keeps paying for: **agreement between sessions is not
evidence.** Neither of us ran the group before concluding.

**Rebundled in one pass:** OxyDex, both orchestrators (each inlines every DSP, so unrelated PRs
collide there), `docs/` served copies, and the affected analysis tools. `build.mjs --check` clean at
11 owned; `verify:docs` and `verify:analysis` green.

**Scope, checked rather than assumed.** `integrator` L2592 already returns `{ok:false}`; `cpapdex`
L426 already returns `compliancePct: null` and L675 `{available:false, reason:'no-spo2-channel'}`;
`motiondex` pairs `conf:0` with an explicit `['no-data']` flag. `hrvdex` and `glucodex` have none —
**the pattern is avoidable, not inherent to the domain.** Registry tiers untouched. Still out of
scope: `std`/`median`/`quant` on empty input, and `accAnalyze`'s `respRate = period ? … : 0`.
