<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-09 · **Owner decision:** option 3, taken 2026-08-09 · **Follows:** `OXYDEX-PB-OVERCALL-FOLLOWUPS-2026-08-04-BRIEF.md` §1 (which required this be spawned separately rather than patched in) · **Parent:** `OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md` · **Affects:** `oxydex-dsp.js detectOscillations` / `computePatternScores`, the OxyDex reference guide, `integrator-dsp.js`'s PB corroboration leg · **Amended 2026-08-16:** §3.1 gains a **third** adversarial twin (a red-noise null) — see `OXYDEX-FFT-CYCLE-NULL-2026-08-16-BRIEF.md`; no other section changed and the owner decision is untouched · **§2.1 SETTLED 2026-08-16: 40–130 s**, cited — AASM sets a 40 s *floor* with 45–90 s as a typicality, not a 40–90 window, so the code was right and this brief's 40–90 does not propagate

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

#### ✅ SETTLED 2026-08-16 — **40 s floor, 130 s ceiling. The code was right and this brief was wrong.**

**The 40–90 s figure is a misreading of AASM, and the misreading is specific.** The AASM Sleep Apnea
Definitions Task Force states the criterion as:

> *"episodes of ≥ 3 consecutive central apneas and/or central hypopneas separated by a crescendo and
> decrescendo change in breathing amplitude **with a cycle length of at least 40 seconds (typically 45
> to 90 seconds)**"*
>
> — Berry RB et al. 2012, *J Clin Sleep Med* 8(5):597–619, [10.5664/jcsm.2172](https://doi.org/10.5664/jcsm.2172)

That is a **one-sided floor** (≥ 40 s) plus a parenthetical **typicality** note. **90 s is not an upper
scoring bound in AASM and never was.** The parent's *"AASM scores Cheyne-Stokes on a 40–90 s cycle"*
converts a floor-plus-typicality into a two-sided window — the same shape as quoting a range as a
criterion. Note the parent is right about the *other* two criteria: "≥ 3 consecutive" is AASM verbatim.

**And a 90 s ceiling fails in the dangerous direction, which is measurable rather than arguable.** Cycle
length is set by circulatory delay, so it *lengthens as cardiac function worsens* — the correlation with
lung-to-ear circulation time is r = 0.939 (Naughton M et al. 1993, *Am Rev Respir Dis* 148(2):330–8,
[10.1164/ajrccm/148.2.330](https://doi.org/10.1164/ajrccm/148.2.330)) and r = 0.88 (Hall MJ et al. 1996,
*Am J Respir Crit Care Med* 154(2):376–81, [10.1164/ajrccm.154.2.8756809](https://doi.org/10.1164/ajrccm.154.2.8756809)).
Stratified by ejection fraction across 104 CSR patients, mean cycle length runs **49 ± 17 s at LVEF > 50 %
to 86 ± 23 s at LVEF < 20 %** (Wedewardt J et al. 2010, *Sleep Med* 11(2):137–42,
[10.1016/j.sleep.2009.09.004](https://doi.org/10.1016/j.sleep.2009.09.004)).

At the worst-LVEF end the **mean alone is 86 s**. A hard 90 s ceiling therefore discards roughly half of
the most severely impaired group — it is not a neutral narrowing, it is a filter that removes signal
precisely where the pathology is worst. The existing **130 s** sits near mean + 2 SD (86 + 46 = 132) and
is the defensible ceiling. The code comment's *"up to ~120 s in severe heart failure"* was right on the
physiology and merely uncited.

**Resolution:** keep `computePatternScores`'s **40–130 s**; the new detector uses the same. The brief's
40–90 does **not** propagate, and neither does `SYNTHETIC-CORPUS-BRIEF`'s "~40–90 s cycle" generator
default, which should widen so the corpus can express a long-cycle night at all.

⚠ Two consequences for whoever codes this. **"45–90 s" may stay as prose but must never become a gate** —
it is a typicality, and this section exists because it became one. And the citations above are in a
brief, which the `citation-ledger` gate deliberately does not cover; **moving any of these DOIs into
`oxydex-dsp.js` requires a matching `audits/CITATION-VERIFICATION-*.json` entry**, since root `*.js`
*is* a gated surface.

### 2.2 · ⚠ The interval machinery already exists — and it is NOT fit to gate on as written (measured 2026-08-16)

§2's criterion 2 says the cycle length is *"computed afterwards and discarded"*. That is right, and it
implies a cheap plan: reuse `computePatternScores`'s existing `crossingTimes` → `intervals` →
`cycleIntervals` (`oxydex-dsp.js:980–1036`) instead of writing new interval code. **Do not do that
without fixing the following first.** Each item below is marked with how strongly it is established.

**🔴 CONFIRMED by measurement — the cycle COUNT is inflated, and it defeats criterion 3.**
`cycleIntervals` is built by sliding one half-cycle at a time —
`for (i…) cycleIntervals.push(intervals[i] + intervals[i+1])` — so consecutive entries **share a
half-cycle**. For `k` true cycles it reports `2k − 1`:

| true cycles | 1 | 2 | 3 | 4 | 5 | 10 |
|---|---|---|---|---|---|---|
| `cycleIntervals.length` | 1 | **3** | 5 | 7 | 9 | 19 |

So **2 real cycles satisfy a naive `cycleIntervals.length >= 3`** — precisely the case §2's criterion 3
exists to reject (*"one dip is not periodicity; the word requires repetition"*), and precisely the count
AASM sets at ≥ 3. A count criterion must use **disjoint** pairing (`i += 2`) or divide by two; the
existing array is a sliding view, not a cycle list.

**🟢 REFUTED — the overlap does NOT bias `pbCycleLenSD`, so do not "fix" that.** The obvious follow-on
worry is that overlapping windows are correlated and understate dispersion, making everything look more
regular than it is. Measured on alternating 20/40 s half-cycles with jitter: overlapping SD **1.43** vs
disjoint **1.41**, and the means are identical. The SD is honest; only the **count** is wrong. Recorded
because this is a plausible-sounding claim that a later session would otherwise re-derive and act on.

**🔴 CERTAIN from the code — the machinery is BLIND on a high-baseline wearer.** Line 988 is
`if (segMean >= THRESH) continue;` with `THRESH = SPO2_OSC_THRESHOLD = 95`. Any 5-minute window whose
**mean** SpO₂ is ≥ 95 contributes no crossings at all, so for a wearer sitting at 96–97 % `pbCycleLen`
is `null` **by construction**, however cleanly they oscillate. This is §2's criterion 1 (baseline-relative
thresholds) seen from the other side, and it is worth checking against the parent's measured
*0/24 nights corroborating* before assuming that number reflects the wearer rather than this line.

**🟡 PLAUSIBLE, NOT VERIFIED — intervals may span skipped windows.** `crossingTimes` is concatenated
across windows while non-oscillating windows are `continue`d, so two consecutive entries can sit either
side of a gap. The only guard is `iv > 5 && iv < 300`, and `WIN` is *also* 300, so a gap-spanning pair
that lands under 300 s would be recorded as a cycle across a stretch that was explicitly judged
non-oscillating. Whether real data produces such a pair is **not established here** — check it before
relying on interval continuity.

**Also noted:** `lastCross` (line 989) is assigned and never read.

### 2.3 · 🔴 THE THREE CRITERIA ARE NOT ENOUGH — a fourth (regularity) is required. Measured 2026-08-16

A prototype implementing §2's three criteria exactly — baseline-relative crossings against a rolling
median, full cycles from **disjoint** half-cycle pairs (§2.2), cycle length gated to 40–130 s, and a run
of ≥ 3 consecutive in-window cycles — was run against §3.1's twins. It separates the periodic twin from
the aperiodic twin. **It fails the red-noise twin, and not marginally: AR(1) at ρ = 0.98 fired on 40 of
40 seeds.**

That is the §3.1 prediction coming true rather than a coding error. A smooth red series crosses its own
rolling baseline at intervals set by its correlation time; if those land in 40–130 s, "≥ 3 consecutive
in-window cycles" is satisfied with nothing periodic present. **A run-length criterion is not a
periodicity criterion.**

**What does separate them is the REGULARITY of the cycle length** — which is what the word "periodic"
means, and clinically what crescendo-decrescendo CSR looks like. Coefficient of variation of the cycle
lengths in the qualifying run, 40 seeds per row:

| signal | CV min | CV median | CV max |
|---|---|---|---|
| red AR(1) ρ = 0.98 | **0.147** | 0.271 | 0.406 |
| PB, ±0 s cycle jitter | 0.007 | 0.007 | 0.007 |
| PB, ±5 s | 0.031 | 0.045 | 0.059 |
| PB, ±10 s | 0.058 | 0.088 | **0.111** |
| PB, ±15 s | 0.085 | 0.108 | 0.153 |
| PB, ±20 s | 0.114 | 0.141 | 0.199 |

**A gate at CV < 0.13 rejects 0/40 red-noise realizations and accepts 40/40 PB with jitter up to ±10 s**,
with a graded band from ±15 s. The threshold is quoted with its margins deliberately: it is chosen
between two measured distributions, not fitted to one night.

**So the spec gains a fourth gating criterion:** *the qualifying run's cycle lengths must have
CV < `CFG.PB_MAX_CYCLE_CV`*. Three consequences:

1. §2's list must read **four** criteria, and §7's "implements all three criteria" becomes four.
2. **The threshold is the detector's main free parameter and must not be quietly retuned.** If it moves,
   the two distributions above are what justify the new value — re-measure them, do not adjust until the
   corpus gives a pleasing episode count. That would be tuning to the guardrail §5 forbids.
3. ⚠ **This bounds what the detector can claim.** It rejects red noise *of this ρ at this sampling rate*.
   §3.1's box requires ρ be re-measured on the corpus; if the real ρ differs materially, this table must
   be regenerated at that ρ before the threshold is trusted.

**Not yet established:** whether real PB nights in this corpus have within-night CV below 0.13 at all. If
they do not, the detector is correct and the corpus simply contains no PB — which is a legitimate answer
and the one §4's bar must then be evaluated against.

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

#### ⚠ A THIRD twin is required, and it is the one that will actually fire — added 2026-08-16

The pair above is a **point-process** null: same dips, randomised placement. It is necessary and it is
not sufficient, because it shares an assumption with the periodic twin — that the signal is *made of
dips*. The null that defeats a crossing-interval detector has no dips at all.

**SpO₂ is a red series**, and `OXYDEX-FFT-CYCLE-NULL-2026-08-16` measured how red: pure AR(1) at
**ρ = 0.98** is the null it builds against `computeSpO2FFT`. A strongly red series wanders smoothly and
crosses its own rolling baseline at intervals set by its **correlation time** — with no oscillation, no
dips, and nothing periodic anywhere in it. If that correlation time puts the crossings inside §2.1's
window, then "≥ 3 consecutive cycles in 40–130 s" is satisfied **by construction**, exactly as a
periodogram's argmax sits low in a red spectrum by construction.

So the third twin is: **pure AR(1) at ρ = 0.98, no oscillation planted ⇒ the detector reports no
episode.** It is the same negative control that brief specifies, applied to a different estimator.

**Do not assume the FFT finding does not transfer because the estimators differ.** It transfers because
the *null* is a property of the signal, not of the statistic — which is also why the fix is not shared:
that brief's remedy is peak height against a fitted background, and a crossing-interval detector needs
its own (a crossing-interval distribution compared against the one red noise of the same lag-1
autocorrelation produces, rather than against a fixed window). Whether the detector clears this twin is
the finding; the honest outcome is that it might not, and §4's bar cannot be evaluated until it does.

⚠ **The ρ must be measured on the corpus, not inherited.** ρ = 0.98 is that brief's figure at its
sampling rate; a null built at the wrong ρ is a null that examined nothing. State the rate beside it.

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

- [x] **§2.1's cycle window SETTLED 2026-08-16 — 40–130 s, cited (Berry 2012 · Wedewardt 2010 ·
      Naughton 1993 · Hall 1996).** The literature answer is that AASM sets a *floor* of 40 s with
      45–90 s as a typicality, not a 40–90 window, and that a 90 s ceiling would discard about half of
      the worst-LVEF group (mean cycle 86 ± 23 s). `computePatternScores` already used 40–130, so the
      two sites agree **without a code change at that site**; the brief's 40–90 is what moves.
      Still open: `SYNTHETIC-CORPUS-BRIEF`'s ~40–90 s generator default should widen to match.
- [x] **All FOUR criteria implemented and GATING — 2026-08-17** (`detectSpO2Periodicity`, #1395; wired
      into `detectOscillations` in #1398). Baseline-relative crossings of a rolling median · cycle
      length in 40–130 s · ≥ `PB_MIN_CYCLES` consecutive cycles from **disjoint** pairs · cycle-length
      **regularity** (CV < `PB_MAX_CYCLE_CV`). The cycle test decides the episode rather than being
      computed after it, and the fixed 300 s window is gone entirely — four cycles at up to 130 s need
      520 s and could never have fitted the window they were scored in.
      `PB_MIN_CYCLES` is **4**, one above AASM's floor of 3: at 3 the aperiodic twin false-positives on
      **5/40** seeds, at 4 it is **0/40** with true positives unchanged at 40/40. Recorded because it is
      a deliberate instrument-specific deviation, not a rounding.
- [x] **§3.1's twin pair committed and separated — group `oxydex · pb-detector`, 7/7** (#1395).
      ⚠️ **The second half of this box — "shown to FAIL against the current detector" — is NOT satisfied
      by a committed test, and is ticked on other evidence.** The old detector no longer exists to run
      the twins against, so a red-then-green demonstration is no longer constructible in-tree. What
      stands in its place: (a) the old gate was `lowMotion && sustained && cross >= OSC_FLAG_CROSSINGS`,
      containing **no term that depends on crossing SPACING**, so it could not separate the twins as a
      matter of construction rather than of tuning; (b) the paired corpus measurement over 18 identical
      nights — nights firing **14/18 → 4/18**, episodes **119 → 5**. Written down plainly because "the
      test fails against the old code" is exactly the claim that quietly becomes unverifiable once the
      old code is deleted.
- [x] **§3.1's third twin — red noise — produces no episode** (#1395). AR(1) **ρ = 0.98** at **1 Hz**
      (the oximetry sample rate), no oscillation planted: **0/20 seeds fire**, run over 20 seeds rather
      than one. Carries an anti-vacuity leg asserting the twin is rejected **by regularity**
      (`longestRun >= 3 && cycleCV >= 0.13`) rather than by producing no cycles at all — without it, a
      detector that never fires would pass this twin and the aperiodic one for free.
      ⚠️ **ρ = 0.98 is still INHERITED from `OXYDEX-FFT-CYCLE-NULL`, not measured on this corpus**, which
      is what the box actually asked for. Left as a stated limitation rather than silently satisfied: if
      the real ρ differs materially, §2.3's CV table must be regenerated at that ρ before the 0.13
      threshold is trusted.
- [x] **§3.2's corpus decorrelation MEASURED 2026-08-16 — r = 0.910 → 0.370.** Paired on the **same
      42 nights**, old code vs wired (`tools/pb-operating-point.mjs`): nights flagged 38/42 → 16/42;
      episodes vs % time below 95 % **0.910 → 0.370**; episodes vs mean SpO₂ −0.832 → −0.380. Stated
      "whatever it is", as the box asks: **0.370 is not zero.** PB and hypoxemia genuinely co-occur, so
      a detector correlating *zero* with burden would be suspicious in the other direction; the claim
      is that burden no longer explains most of the signal, not that the two are independent.
      ⚠️ The tool's header quotes 36/37 nights and r = 0.893 from a **37-night** corpus; the 42-night
      baseline re-measured here is 38/42 and r = 0.910. Compare like with like — the improvement is
      0.910 → 0.370 on one corpus, not 0.893 → 0.370 across two.
- [x] **§3.3's κ REPORTED 2026-08-17 — −0.036 → +0.149**, paired on 56 nights, beside the parent's −0.039 (which the old column reproduces). Explicitly an observation, and a fragile one: 4 device-positive nights.
      **BASELINE MEASURED 2026-08-17; the new detector's κ is still owed.**
      > ⚠️ **A "BLOCKED — not on this machine" note stood here for a few hours and was WRONG.** It is
      > left described rather than deleted because the mistake is instructive — and the FIRST correction
      > to it was also wrong. The corpus is **`<647A>/Ecg nightly/CPAP`**, 192 night folders (2026-01-11
      > → 07-21, 1194 files), i.e. inside a path `CORPUS-LOCATIONS.md` already listed. It is mirrored
      > byte-identically at `/run/media/michal/data/Ecg-nightly-archive/CPAP`.
      > What actually happened: I searched for `DATALOG`/`STR.edf`, **neither of which exists in this
      > layout**, and that `find` **timed out at 120 s** and returned an empty file, which I read as a
      > negative. Then, told the data existed, I found the mirror and concluded "it was on the volume I
      > never searched" — a tidy story that fit the symptom and was still wrong. A wrong search term plus
      > an unfinished search produced a false absence; the first explanation that fit was not re-tested
      > against the volume already walked.

      **Baseline κ, old-code exports, 29 paired nights:** device PB 4/29, OxyDex PB **26/29**,
      **κ = −0.051**, burden r = −0.494 where both fire (n = 3). That 26/29 is the *old* 90 % flagging.
      (It sits beside the parent's −0.039, which was a different night set; both are ~0, i.e. chance.)

      > ⚠️ **"NOT COMPUTABLE — a date gap" stood here and was ALSO WRONG.** It said the raw needed to
      > re-run OxyDex existed only in `tepna-smoketest/captures` (starts 2026-07-16), giving a 5-night
      > overlap with a device that scored PB on 0 of them. That was true of *that* tree and false as a
      > claim about the corpus: **`<647A>/Ecg nightly` holds 61 O2Ring nights from 2026-05-03**, and
      > OxyDex needs only the O2Ring CSV — not a tri-device capture. I had reached for `trio-batch`
      > (which wants capture-host layout) and concluded from *its* input requirements that the data was
      > missing. **Third false-absence of the day on this same corpus**, each from a different wrong
      > assumption about where to look; the pattern is that I kept asking "can this tool run?" instead
      > of "does the measurement need that tool?".

      ### ✅ §3.3 MEASURED 2026-08-17 — κ −0.036 → **+0.149**, paired on the same 56 nights

      Exports generated for all 61 `Ecg nightly` O2Ring nights through the **shipped** headless surface
      `OxyDex.compute` (the same entry point the equivalence gate uses), once with the pre-wiring code
      (`baa681fd`, the first parent of #1398's merge) and once with the wired code — then both run
      through `pb-agreement.mjs` against the same 189-night CPAP export set. 56 nights pair.

      | same 56 nights | OLD | NEW |
      |---|---|---|
      | Cohen's κ | **−0.036** | **+0.149** |
      | OxyDex flags PB | **55/56** (98 %) | **20/56** (36 %) |
      | device flags PB | 4/56 | 4/56 |
      | 2×2 `a,b,c,d` | 3, 1, **52**, **0** | 3, 1, **17**, **35** |

      **The old column independently reproduces the parent's published κ = −0.039** (here −0.036, a
      different night set), which is the reason to trust the new figure: the harness recovers the known
      answer before being asked for an unknown one. Note `d = 0` for the old detector — it never once
      agreed that a night was PB-free, because it flagged 55 of 56.

      **What improved and what did not.** Sensitivity held exactly: `a = 3` in both columns, i.e. both
      detectors caught 3 of the device's 4 PB nights, and both missed the same one. The entire gain is
      specificity — false positives **52 → 17**.

      ⚠️ **Read κ = +0.149 as "slight, and fragile", not as agreement.** On Landis & Koch it is the
      bottom band (0–0.20). More importantly it rests on **4 device-positive nights**: one night moving
      between cells shifts it materially, so this is a direction-of-travel result, not a validation.
      Below chance → above chance is the claim; "the two now agree" is not.
      ⚠️ The `Ecg nightly` tree is **phone-captured**, so its timing provenance is the lower tier
      (`timingSource: device`, no independent host clock). That does not affect this measurement —
      night-level PB agreement is immune to sub-second alignment, which is the same argument
      `pb-agreement.mjs` makes for ignoring the 38 min CPAP clock offset — but do not reuse these
      exports for anything beat-level.

      **What IS measurable locally, and it is a genuine paired result — 18 nights, identical dates,
      old-code committed exports vs new-code regenerated:**

      | | old | new |
      |---|---|---|
      | nights with ≥ 1 PB episode | **14/18** | **4/18** |
      | total PB episodes | **119** | **5** |

      Per-night, e.g. 07-19 19 → 0, 07-26 23 → 1, 07-28 20 → 0. This is an **independent corroboration**
      of §3.2's 38 %-of-nights figure: different corpus slice, different code path (the node-export,
      not `processNight` directly), same direction and magnitude.
      ⚠️ Caveat stated rather than buried: the "old" column is the *committed* `uploads/trio` exports,
      which were produced at various times by whatever code shipped then — not a single pinned version.
      They are the shipped baseline artifacts, which is the right comparison for "what did users see",
      but it is not a controlled A/B of one commit against another.

      ⚠️ Pointing `cpap-corpus.mjs --root` at the wrong layout reports **nights: 0**, writes a valid
      empty exports file and **exits 0** — check the night count, never the exit code.
- [ ] §4's bar is measured: removing the leg now changes the fused outcome on some nights — or it does
      not, and option 1 is revisited on that evidence.
      **UNBLOCKED** — `tools/pb-fusion-blast.mjs` takes the same `--cpap` set, which now exists. It
      needs the regenerated trio exports for the same reason §3.3 does.
- [x] **Fixtures regenerated, build surfaces rebuilt, `verify-fixtures` re-run — 2026-08-16.** The
      equivalence gate **red first** (`ranked.0` "PB Episodes 16 eps" no longer computed), which is what
      GATE C is for; `tools/regen-oxydex-goldens.mjs` moved 2 fixtures and the synthetic golden was
      unchanged. `manifestHash` 979be8301f81 → 30e45b3ce49b, `verifiedUnder` → 16ae6cce27f0 after a
      green corpus run. Both orchestrators re-bundled (they inline `oxydex-dsp.js`). Full suite **with**
      the corpus: 7631/7631, zero skips; `build:check`/`verify:docs`/`verify:analysis`/`verify:manifest`
      /`lint` all rc=0.
      ⚠️ `npm run test:hooks` fails — but **identically on `origin/main`** (rc=1 both), so it is
      pre-existing and not attributable to this work. Recorded rather than omitted.
