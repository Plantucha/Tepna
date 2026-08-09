<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-09 · **Owner decision:** option 3, taken 2026-08-09 · **Follows:** `OXYDEX-PB-OVERCALL-FOLLOWUPS-2026-08-04-BRIEF.md` §1 (which required this be spawned separately rather than patched in) · **Parent:** `OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md` · **Affects:** `oxydex-dsp.js detectOscillations` / `computePatternScores`, the OxyDex reference guide, `integrator-dsp.js`'s PB corroboration leg

# Build a periodic-breathing detector that measures periodicity

> **The owner chose option 3 on 2026-08-09**: *fix the detector so the leg earns its place*, rather than
> withdrawing it (option 1, measured cost 0/24 nights corroborating) or re-wording around it (option 2).
> This brief exists because the parent forbade patching a new detector into a wording fix — a detector
> is a measurement, and it needs its own validation.

---

## 1 · What is wrong, measured

`detectOscillations` does not detect oscillation. It counts **downward crossings of an ABSOLUTE 95 %
SpO₂ level**, and that is the whole test:

- **no cycle-length criterion.** `cycleLen` is computed into `meta` *after* the decision and gates
  nothing.
- **no crescendo–decrescendo shape test.**
- **no requirement of consecutive cycles.**

On a corpus whose overnight mean is **94.6–96.6 %**, the trace straddles that absolute line all night,
and 1 Hz oximetry reports **integers** — so a value dithering 94/95/96 crosses continually with no
breathing periodicity whatever.

**The consequence, measured (parent §5.1):**

| relationship | r |
|---|---|
| episode count ↔ time below 95 % | **+0.893** |
| episode count ↔ mean SpO₂ | **−0.821** |

It is measuring **mild hypoxemia burden** — a real quantity, but not the one "Cheyne-Stokes" or
"periodic breathing" names. And against the CPAP's own device-scored PB, night-level agreement was
**κ = −0.039**, worse than chance.

## 2 · The spec

Three criteria, all of which the current detector lacks:

1. **Baseline-relative crossings, not an absolute 95 % level.** The threshold must follow the night's
   own baseline (a rolling percentile or a slow-moving median), so a wearer whose mean sits at 94 % is
   not scored as oscillating all night, and one at 98 % is not scored as never oscillating.
2. **Cycle length inside the clinical window**, measured on the crossing intervals rather than
   computed afterwards and discarded.
3. **≥ 3 consecutive cycles** before an episode is declared. One dip is not periodicity; the word
   requires repetition.

### 2.1 · ⚠ The cycle window is not agreed, and this must be settled before any coding

The parent's option 3 says **40–90 s**. `computePatternScores` already uses **40–130 s** and calls it
the *"clinical CSR cycle window (~40–130 s; classic 45–90 s, up to ~120 s in severe heart failure)"*.
Those are different specs in the same codebase for the same phenomenon.

**Decide it once, from the literature, and cite it** — do not let the detector and the score disagree,
and do not pick the narrower one merely because it is the newer sentence. Whichever is chosen, both
sites move together.

## 3 · Validation — and the hard part is that there is no ground truth

The obvious plan is "agree with the CPAP better than κ = −0.039". **That plan is not sufficient and
must not be the acceptance criterion**, for the reason the parent already established: the device is
**not** ground truth, it is **n = 1** wearer, and its own scoring is a black box. Tuning to it is the
guardrail the parent explicitly forbids.

So the acceptance test is **construct validity**, which needs no reference at all:

### 3.1 · The discriminating test the current detector fails by construction

Two synthetic nights with the **same total desaturation burden**, differing only in whether the
desaturations are **periodic**:

- **periodic twin** — regular dips at the chosen cycle length, ≥ 3 consecutive.
- **aperiodic twin** — the same number of dips, the same depth, the same time-below-threshold, placed
  at randomised intervals.

A periodicity detector must fire on the first and **not** the second. The current one cannot tell them
apart, because nothing it computes depends on the spacing. **This is the single test that decides
whether the new detector is a detector at all**, and it is cheap: no corpus, no reference, and it can
be a committed adversarial twin in the suite.

### 3.2 · Decorrelation from hypoxemia burden — the falsifiable corpus criterion

Over the 42-night O2Ring corpus, the new detector's episode count must **break** the r = 0.893
relationship with time-below-95 %. State the achieved r. If it is still above ~0.6 the detector is
still substantially measuring hypoxemia burden under a new name, and the work is not done.

**This is falsifiable and does not require a reference** — which is exactly why it is the corpus
criterion rather than κ.

### 3.3 · κ against the CPAP: reported, never optimised

Report the new κ beside the old **−0.039**, on the CPAP-paired nights, as a *observation*. An
improvement is encouraging; it is not the bar, and no constant may be tuned to move it. If κ stays ≈ 0
while §3.1 and §3.2 pass, the honest reading is that this wearer's CPAP and this wearer's oximeter
disagree about PB — which is itself a publishable negative and not a failure of the detector.

## 4 · What "earns its place" means for the fusion leg

The leg exists so the Integrator can corroborate a CPAP-scored PB finding. Today it corroborates
everything, which is why 0 of 3 corroborated nights survive removing it — a witness that always agrees
is not a witness.

**The measurable bar:** after the fix, removing the OxyDex leg must change the fused outcome on **some**
nights. If it still changes nothing, the leg has not earned its place and option 1 (withdraw) becomes
correct on evidence rather than on argument.

## 5 · Guardrails, inherited and non-negotiable

- **Do NOT tune any constant toward the CPAP's PB scoring** (parent §2, κ = −0.039, n = 1).
- **Do NOT ship a threshold nobody can derive.** Parent §5.2 swept the operating point and found no
  defensible threshold on this corpus; that finding applies to the new detector too, so any cut-point
  must come from the literature with a citation, or be published as a tunable with its arbitrariness
  stated.
- **The evidence tier moves with the evidence.** A detector that passes §3.1/§3.2 is still
  `experimental` until something external validates it; passing a self-designed construct test is not
  external validation. Do not upgrade the badge on the strength of this brief.
- **The user-facing vocabulary stays honest.** `OXYDEX-PB-OVERCALL-FOLLOWUPS` §2 withdrew the
  likelihood ladder in favour of an indicator count; a better detector does not license bringing
  "Probable"/"Likely" back. If the detector ever supports a likelihood, that needs its own argument.

## 6 · Cost, stated honestly

This is a DSP change, so it carries the full §🔒 cycle: regenerate OxyDex fixtures with
`tools/regen-oxydex-goldens.mjs`, re-bundle — and note that `oxydex-dsp.js` reaches **four** build
surfaces (the app, five analysis tools, **both orchestrators**, and the served `docs/` copies; only
`build.mjs --all` covers the orchestrators) — then `DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs`
because `computeHash` will move. The episode count is also consumed by `integrator-dsp.js`'s PB
corroboration and by the OxyDex reference guide, both of which move with it.

## 7 · Done when

- [ ] §2.1's cycle window is settled from the literature, cited, and the detector and
      `computePatternScores` use the SAME one.
- [ ] The detector implements all three criteria, with the cycle test **gating** the decision rather
      than being computed after it.
- [ ] §3.1's adversarial twin pair is committed and the detector separates them — and the test is shown
      to FAIL against the current detector, which cannot.
- [ ] §3.2's corpus decorrelation is measured and the achieved r is stated, whatever it is.
- [ ] §3.3's κ is reported beside −0.039, explicitly as an observation.
- [ ] §4's bar is measured: removing the leg now changes the fused outcome on some nights — or it does
      not, and option 1 is revisited on that evidence.
- [ ] Fixtures regenerated, all four build surfaces rebuilt, `verify-fixtures` re-run, `npm run check`
      green.
