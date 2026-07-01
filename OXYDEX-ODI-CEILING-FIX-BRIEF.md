# BRIEF — OxyDex ODI-4 ceiling-baseline fix (severity-proportional undercount)

**Author of brief:** design/analysis agent · June 2026
**For:** AI coder picking this up fresh (this is self-contained — read it top to bottom before editing)
**Scope:** Fix the rolling-baseline self-suppression that makes OxyDex ODI-4 under-count desaturations
proportionally to OSA severity. Then validate (synthetic + real), run the gates, re-bundle, regen
fixtures, and update the two papers that documented the bias. Honor `CLAUDE.md` throughout.

---

## 0. TL;DR of the change
`detectODI()` measures each desaturation against a **trailing 5-minute MEAN** of SpO₂
(`computeBaselineArr`). In severe OSA the closely-spaced dips drag that mean down, so the
`baseline − 4%` threshold sinks and later events of equal depth no longer clear it → the worse the
apnea, the more events are missed. **Fix:** measure desaturations against a **trailing high-percentile
"ceiling" baseline** (the stable resting SpO₂, which is what AASM desaturation is defined against),
which brief dips can't suppress. Keep it MINIMAL and PRINCIPLED — do not tune constants to make the
synthetic numbers match; the justification is the algorithm, not the simulation.

---

## 1. Root cause (verified, with exact locations)

- **`oxydex-dsp.js:2314` `detectODI(spo2, drop, n)`** — the ODI counter. Logic:
  ```js
  var blArr = computeBaselineArr(spo2, WIN);   // WIN=300 (5 min)
  for (i…) { var bl = blArr[i];
    if (spo2[i] <= bl - drop) { startEvent }   // drop = ODI_DROP (4) or 3
    else { endEvent if length>=10 } }
  ```
  Events must last ≥10 samples (≥10 s). `rate = count / hours`.
- **`oxydex-util.js:77` `computeBaselineArr(spo2, WIN)`** — returns `bl[i] = mean(spo2[i-WIN .. i-1])`,
  a **trailing arithmetic mean**. THIS is the defect: the mean includes the dips, so it self-suppresses
  in severe OSA.
- **Evidence (20k synthetic cohort, generator v1.6, `uploads/cohort-robustness-summary-20k-v16.json`):**
  ODI-4 vs planted truth-AHI mean bias by severity = none −1.4 / mild −5.1 / moderate −12.3 /
  **severe −30.8** events·h⁻¹, with calibration R² *rising* 0.77→0.92. A deterministic,
  severity-proportional under-count — the signature of baseline self-suppression, not random error.
- This is a **real oximetry-algorithm problem** (documented behavior of trailing-mean baselines), so
  the fix is a genuine real-world improvement, NOT overfitting to the generator.

## 2. The fix

### 2a. New baseline estimator (the core change)
Add a **ceiling baseline** that tracks the recent stable/resting SpO₂ and resists brief dips. Two
acceptable implementations (pick the simpler that passes validation):

- **Preferred — trailing high-percentile:** `bl[i] = p90( spo2[i-WIN .. i-1] )` (≈90th percentile of
  the last 5 min). Brief dips sit in the lower tail and barely move the 90th percentile, so the ceiling
  stays at the resting level. Implement O(n) with a small order-statistic structure or a coarse
  histogram over the integer SpO₂ range (50–100 → 51 bins) updated incrementally as the window slides
  (add `spo2[i-1]`, drop `spo2[i-WIN-1]`, read the percentile by walking the histogram). Integer SpO₂
  makes the histogram exact and fast.
- **Acceptable fallback — trailing rolling max with slow decay:** `bl[i] = max over window`, optionally
  with a gentle decay so a one-off spike-high reading doesn't pin it. Simpler but more sensitive to
  ceiling artifacts; the histogram-percentile is more robust.

Recommended signature (do NOT break the existing mean — see 2b):
```js
// oxydex-util.js — NEW, alongside computeBaselineArr (do not replace it)
function computeCeilingBaselineArr(spo2, WIN, pct) {  // pct default 90
  // O(n) sliding 51-bin histogram over SpO2 50..100; bl[i] = pct-th percentile of spo2[i-WIN..i-1]
}
```

### 2b. Wire it into EVENT DETECTION only — mind the blast radius
`computeBaselineArr` is called by **~11 functions** (grep `computeBaselineArr` in `oxydex-dsp.js`:
lines ~1102, 1308, 1484, 1788, 1857, 2316, 2617, 2831, 4198, 4236, 4261, plus util). They split into:
- **Event COUNTING / detection** (should use the ceiling baseline): `detectODI` (2314, both ODI-4 &
  ODI-3), `computeODI1` (1303/1308), `computeDesatSlopes` (1097/1102), `computeDesaturationProfile`
  nadir detection (2582/2617), `computeHypoxicLoad` ODI-3 nadirs (1780/1788),
  `computeBreathingIrregularity` (1851/1857), `computeDesSev` (~4261), `computeCT` (~4236), `SBII`
  (~4198), the PD re-detect (~1484), cross-signal nadirs (~2831).
- **Decision:** the safest, most defensible change is to switch **all event-NADIR detection** to the
  ceiling baseline, because they all share the same physiological definition (a dip below the resting
  ceiling). But that is a wide behavior change. **Minimal first cut:** switch ONLY `detectODI`
  (line 2316) — that is what produces `odi4.rate`/`odi3.rate`, the headline ODI and the AHI surrogate.
  Get that validated and gated first; then, in a SECOND pass, migrate the other nadir detectors for
  consistency (otherwise ODI count and desat-profile count will diverge slightly — acceptable
  short-term, but note it).
- Do NOT change baseline use in non-event contexts if any exist (none obvious, but check).

### 2c. The AHI surrogate constant
`computeAHIestimates` (oxydex-dsp.js:1341) maps `ahiODI4 = odi4Rate * 1.1`. Once ODI-4 stops
under-counting, **re-examine the ×1.1** — with a correct ODI, AHI≈ODI×1.1 may now over-shoot. Re-fit
the constant against the planted truth-AHI on the v1.6 cohort (regress truth-AHI on the NEW ODI-4;
report slope). Keep it a single transparent constant with a sourced comment. This is the one place a
data-derived constant is legitimate (it's an explicit surrogate calibration, not detector tuning).

## 3. Validation (BEFORE running gates) — two-sided, truth only exists in sim

1. **Synthetic (necessary condition):** run `cohort-runner.html` at N≈5,000 FAST on v1.6 (durable;
   it auto-resumes). Recompute ODI-4 vs truth-AHI bias by severity. **Success = the severe-stratum
   bias shrinks substantially (target: severe |bias| from ~31 down toward the mild/moderate range)
   and the gradient flattens**, without inflating the `none` stratum into false positives (none-bias
   must stay near 0; watch for ODI-4 > 0 on truly normal nights). Recall (`recall_low_severe` flag
   count) should drop sharply.
2. **Real (guard against overfitting):** run `sigma-no-reference`-style and the OxyDex app on the
   6 real O₂Ring nights in `uploads/` (`O2Ring S 2100_*.csv` for 06-10/11/12/14/15/17). There is **no
   PSG AHI truth** on real data, so you CANNOT score accuracy — instead check **sanity + stability**:
   ODI-4 stays physiologically plausible (no night explodes to absurd rates), night-to-night ranking
   is preserved, and normal-looking nights don't sprout false events. If a real night's ODI jumps
   implausibly, the ceiling baseline is too aggressive (e.g. percentile too high / window too short).
3. Keep a short before/after table (per-severity bias synthetic; per-night ODI real) in the PR/notes.

## 4. Gates (CLAUDE.md — non-negotiable, in order)

1. **Regression suite:** open `Dex-Test-Suite.html`, wait ~3 s, `#summary` must be all-green. The
   shared assertions in `tests/dex-tests.js` ARE the public contract. ODI-related assertions WILL
   move — update them **deliberately** (don't edit a number to force green without understanding it),
   and remember `node tests/run-tests.mjs` uses the same file, so update both runners' expectations if
   needed. If you changed a function signature/return shape, keep back-compat (new args last+optional,
   new return data in NEW fields) per CLAUDE.md.
2. **Re-bundle** `OxyDex.html` from `OxyDex.src.html` + the edited `*.js` via the inliner (edit the
   `.js`/`.src.html`, NEVER the bundled `.html`; re-bundle after).
3. **Provenance:** open `verify-provenance.html`. NOTE: `buildHash` is over the `.src.html` template,
   so a **JS-only change does NOT move buildHash** — OxyDex fixtures stay `reproducible ✓`. BUT you
   changed node *code*, so per CLAUDE.md "regenerate fixtures whenever you change a node's code, not
   only when buildHash moves": regenerate any committed `uploads/*oxydex*` / fusion fixtures that
   embed ODI values. Confirm no red verdicts.
4. **Evidence badges:** ODI-4's evidence tier lives in `OXY_REGISTRY` (`<node>-registry.js`). If the
   metric's grade is unaffected, leave it; the `cohesion-badges` test group must stay green.

## 5. Paper updates (after the fix is gated)

Both papers currently DOCUMENT the undercount as a finding. Reframe to "characterized → corrected":

- **`papers/robustness-benchmark.html`** (now at 20k v1.6): the headline "one systematic failure =
  severity-proportional ODI undercount" becomes "…undercount, **traced to trailing-mean baseline
  self-suppression and corrected by a ceiling baseline (vX)**." Re-run the 20k cohort on the fixed
  detector and update: Table 2 (per-severity slope/R²/bias), the abstract numbers, Figure 1 middle
  panel, §3.3, and the discussion. Keep the *method* point (scale-as-test found it) intact.
- **`papers/odi4-ahi-bias.html`** (real 5-night + synthetic power arm): this paper's whole thesis is
  the ×1.1 undercount. Update it to present the ceiling-baseline fix as the resolution, with
  before/after ODI→AHI calibration on the synthetic cohort, and the re-fitted surrogate constant
  (§2c). The real-night arm stays descriptive (no truth).
- **`papers/papers.html`**: add a changelog entry under the generator/fix list documenting the OxyDex
  ceiling-baseline fix (date, mechanism, before/after severe bias, that it's a real-world improvement).
- **`papers/RERUN-RESULTS.md`** and **`FINDINGS-AND-FIXES-BRIEF.md`**: log the fix + final numbers.

## 6. Guardrails / do-nots
- Do **not** tune the percentile/window to chase the synthetic numbers. Choose defensible values
  (p90, WIN=300 to match the existing clinical 5-min window) and justify by mechanism; report whatever
  residual bias remains honestly.
- Do **not** replace `computeBaselineArr` wholesale in one commit — add the ceiling fn, migrate
  `detectODI` first, validate, then optionally migrate the other nadir detectors in a second pass.
- Do **not** edit the bundled `OxyDex.html` directly. Edit `.js`/`.src.html`, re-bundle.
- Keep the SPDX header on any new file (`licensing/SPDX-HEADERS.txt`).
- The generator (`cohort-gen.js`, now **v1.6**) is the source of truth for synthetic ground truth —
  do NOT modify it as part of this fix; it provides the independent AHI truth you validate against.

## 7. Definition of done
- [ ] `computeCeilingBaselineArr` added (O(n), histogram percentile); `detectODI` uses it.
- [ ] AHI surrogate constant re-fit against v1.6 truth-AHI (or justified unchanged).
- [ ] Synthetic: severe ODI-bias materially reduced, gradient flattened, `none` not inflated
      (before/after table recorded).
- [ ] Real 6 O₂Ring nights: ODI plausible + stable (sanity table recorded).
- [ ] `Dex-Test-Suite.html` all-green (assertions updated deliberately; `run-tests.mjs` matches).
- [ ] `OxyDex.html` re-bundled from source.
- [ ] `verify-provenance.html` clean; ODI-bearing fixtures regenerated.
- [ ] robustness-benchmark + odi4-ahi-bias papers + index changelog + RERUN-RESULTS updated.
- [ ] OxyDex version string / changelog comment bumped with a one-line description.

## 8. Pointers (files)
- Detector: `oxydex-dsp.js` (`detectODI` 2314, `computeAHIestimates` 1341, processNight ~2123).
- Baseline util: `oxydex-util.js` (`computeBaselineArr` 77).
- Runner for synthetic validation: `cohort-runner.html` (FAST, worker pool, IndexedDB resume; set
  N, Start; export summary.json). Truth-AHI is in each patient's ground truth via `CohortGen`.
- Real nights: `uploads/O2Ring S 2100_2026061{0,1,2,4,5,7}*.csv`.
- Gate: `Dex-Test-Suite.html` + `tests/dex-tests.js` + `tests/run-tests.mjs`.
- Provenance: `verify-provenance.html` (+ `ganglior-provenance.js`).
- Prior context: `FINDINGS-AND-FIXES-BRIEF.md`, `papers/RERUN-RESULTS.md`, `papers/PAPERS-AUDIT.md`,
  `uploads/cohort-robustness-summary-20k-v16.json` (the 20k baseline numbers to beat).
