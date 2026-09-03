<!--
  PAT-FORENSICS-FIDUCIAL-JITTER-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **TRIAGED 2026-09-01 (Osprey): tool BUILT and RUNNABLE LOCALLY — `tools/pat-fiducial-jitter.mjs <ppg-file>` produces real output here (fiducial-family pairwise within-SD **6.55–9.84 ms**, IQR 8.75–12.92, every pair `NOT-DOMINANT`; TCH decomposition REFUSED on negative variance for three triplets, consistent with the known onset law). Run against 2 repo-tree files the `between-file SD` is empty, so those numbers only show the method works. **The real corpus is local after all** (`/srv/data/tepna-corpus/`, 1131 raw `_ECG.txt`, 43 usable box nights once `2026-08-23` is excluded), so this IS closable here — execution-bound, not access-bound.** · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (phase (b): §7 fiducial family, §6 R-jitter) · **Interlocks:** `EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md` §1, `PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md` · **DRAIN 2026-09-02 (Osprey):** re-verified — `tools/pat-fiducial-jitter.mjs` present and runnable locally. Unchanged since the 2026-09-01 triage. **Owner: Osprey. Next step:** one corpus run; pre-register the band first, as the oracle run did.

# The fiducial family is not a lever — every family agrees to under 6.2 ms

> **In one line:** across eight fiducial families on real pulses, the largest clock-free
> beat-to-beat disagreement between any two is **6.22 ms**. Changing which feature defines the
> "foot" therefore cannot move PAT by more than a few ms, and the standing **38.0 ms** residual IQR
> is **not** explained by fiducial choice.

**Label: not a defect.** This closes a candidate mechanism rather than finding one — §7 was the
charter's nominated "most likely fundamental limit", and on the *differential* question it is ruled
out. The *absolute* question survives, and §4 says why it must.

## 1 · The measurement, and why it excludes both known artefacts by construction

Two prior artefacts made every earlier §7 attempt answer a different question:

- **`pat-sd-is-the-window`** — every PAT SD previously reported measured the 450 ms PHYS window
  (450/√12 = 129.90 ms), i.e. the window's variance, not physiology.
- **EXTERNAL-METHODS-SURVEY §1** — comparing fiducials by *recovery rate* cannot work: the families
  differ by a near-constant translation (foot→half = **89.5 ms**, spread 22 ms over 30 nights) and
  the strict statistic's leave-one-block-out centre **absorbs a constant by design**. A
  translation-invariant estimator cannot see a translation.

**The fix is to compare two fiducials of the SAME beat.** They share the clock, `t0`, the axis and
the sample grid, so their difference is free of every clock term **identically** — not after
correction. No acceptance stage runs, so the PHYS window never enters either. This is the only §7
statistic in the repo that excludes both artefacts *by construction*.

That property is **gate-asserted**, not asserted in prose: `pat-fiducial-jitter.mjs --selftest`
plants a large varying clock shift on every beat and requires every pairwise SD to stay at 0, and a
**positive control** plants ±1 sample on one family and requires it to be seen. 11/11.

## 2 · Result — eight families, 8968 beats, 8 fragments

Clock-free beat-to-beat SD, computed **within** each file and reported as the median across files
(see §3 for why that qualifier is load-bearing):

| pair | within-file SD | between-file SD | band |
|---|---|---|---|
| `pct10\|pct25` | **0.88 ms** | 2.95 | NOT-DOMINANT |
| `tangent\|pct10` | 1.00 | 6.39 | NOT-DOMINANT |
| `pct25\|pct50` | 1.09 | 3.87 | NOT-DOMINANT |
| `tangent\|pct50` | 2.17 | 2.74 | NOT-DOMINANT |
| `maxSlope\|tangent` | 2.79 | 6.63 | NOT-DOMINANT |
| `min\|tangent` | 3.01 | 10.18 | NOT-DOMINANT |
| `min\|maxSlope` | 5.32 | 16.02 | NOT-DOMINANT |
| **`pct75\|d2max`** (worst of 28) | **6.22 ms** | 5.24 | NOT-DOMINANT |

**All 28 pairs land NOT-DOMINANT** against bands pre-stated before the first run
(≥20 MATERIAL · 10–20 INTERMEDIATE · <10 NOT-DOMINANT, closed, no gaps).

`tangent` is the **shipped** foot — `refineFeet`'s `cross = ms − (bp[ms]−mv)/msv` is exactly the
intersecting-tangent method, so the fiducial Tepna already uses is one of the eight compared, not an
outsider to them.

## 3 · Two methodological results worth more than the headline

**(a) Pool within files, never across them.** Pooling all 8968 beats into one difference distribution
gave **SD 41–56 ms (MATERIAL)** — the opposite verdict. The tell was that the pooled **IQR stayed at
1–8 ms** while the SD hit 56: a tight bulk with a between-group shift, i.e. `V_pool = within +
between` with the between term dominating. Each file carries its own near-constant family offset
(the survey's 89.5 ms ± 22 ms across nights), so pooling measures *that* spread. One tool, two
contradictory answers, and only the sign of `SD ≫ IQR` distinguished them. The between-file column
above is that quantity, reported separately because it is real — just not beat-to-beat jitter.

**(b) The three-cornered hat REFUSED on all three triples, and the refusal is the finding.** Every
triple returned a negative variance. The header pre-declared why: TCH assumes **independent** leg
errors, and fiducial families on one pulse share morphology — when a beat broadens or an artefact
tilts the upstroke, they all move together. `tch-corners-are-coupled` records coupling breaking this
assumption as a live failure mode here. The negatives were **surfaced, never clamped to zero**, and
they confirm the coupling rather than measuring around it.

## 4 · 🔴 What this does NOT establish — the common-mode limit is untouched

The pairwise difference sees only the **non-common** part of two fiducials' error. If every family is
wrong *together* — the whole upstroke displaced by noise, a slow rise, an artefact — that error
**cancels in the difference and is invisible here**. So:

- ✅ **Proven:** the fiducial *family* is not a lever. No choice among these eight buys more than
  ~6 ms, which corroborates the survey's paired Δ of **−0.0000** by a completely independent route.
- ❌ **Not proven:** that the foot contributes < 10 ms of absolute uncertainty. The 38.0 ms residual
  IQR could still be largely fiducial, if it is common-mode.

**Only an independent reference can separate those**, which is precisely §12/§13's oracle (perfect
beat labels / manually-reviewed feet). Reporting this bound as if it were the absolute answer would
be the same over-claim the axis brief had to correct one day earlier.

## 5 · §6 — the ECG axis: the comment's claim is VERIFIED on an independent population

`ecgRpeakTimes`' source comment claims *"on 160 of 187 real ECG fragments the ppm path is REFUSED by
its 40-min span gate … median divergence 48 ms on refused fragments (max 1479 ms)"*. The charter
forbids accepting that on faith. Re-measured on a **different** corpus — 505 `*_ECG.txt` under
`tepna-smoketest/captures` (`find -L`), 448 parsed:

| | comment (187 fragments) | this measurement (448 fragments) |
|---|---|---|
| ppm **refused** | 160/187 = **85.6 %** | 371/448 = **82.8 %** |
| median divergence on refused | **48 ms** | **42.5 ms** |
| max | 1479 ms | 3128 ms |

**VERIFIED.** Two populations, ~2.4× apart in size, agreeing to 3 points of percentage and 5.5 ms of
median. The mechanism is confirmed too: of the gate's four conditions, **`spanMs >= 2400 s` passes
only 77/448** while **`independent === false` is 0/448** — the span gate is the *sole* binding
constraint here, exactly as claimed. (`spanMs` median 427 s against a 2400 s bar; `ppm` median
−34.9, p10 −815, p90 +257.)

⚠️ **Two false starts got there, and both are the same error.** First `tMsCorrected` → "93.7 %
applied", which reads as a clean *refutation* — but it is a different gate, and the source says so
outright: *"the ppm is span-gated, the interpolation is not."* Then `hostAxis.totalMs` as the span →
"0/448 pass", with anchor spans of −0 s against 349 s fragments: not credible, wrong field again. The
rec exposes **`applied`** and **`spanMs`** *by name*. **Three times in this campaign, reading the
named field instead of a plausible proxy changed the answer** — and here the proxy manufactured a
false refutation, the more dangerous direction.

🔴 **42.5 ms is the fragment-END divergence, NOT what PAT eats** — the same discipline the axis brief
had to apply to its own 34.5 ms. `coupledPAT` centres within a 5-minute bin, so the decision-relevant
quantity is `|ppm| × 300 s`, not `|ppm| × span`. At the median ppm that is ~10 ms per bin; in the p10
tail (−815 ppm) it is ~245 ms. **That within-bin figure is not yet computed per fragment** and is
carried forward — quoting 42.5 ms as the PAT error term would repeat the mistake this campaign has
now caught twice.

**Label: ENGINEERING LIMITATION, not a bug.** The span gate is deliberate and correct — a *rate*
needs a baseline, and the source records the measurement behind the 2400 s knee. Refusing to quote a
rate from a 427 s fragment is the honest behaviour; the cost is that 83 % of fragments carry an
uncorrected axis.

## 5c · The within-bin residual — and it retires the "48 ms uncorrected divergence" as a budget term

Bands pre-stated before looking, reusing §2's MATERIAL threshold rather than inventing one:
**DOMINANT ≥ 60 ms** (exceeds `DRIFT_MAX_MS` alone) · **MATERIAL 20–60** · **MINOR < 20**. Closed.

Over the **343** refused fragments (290 carrying a stability curve):

| quantity, per 300 s bin | median | p75 | p90 | max |
|---|---|---|---|---|
| uncorrected-rate **ramp extent** | 38.6 ms *(MATERIAL)* | 139.1 | 645.2 *(DOMINANT)* | 7210.9 |
| **after bin-centring** (`extent/√12`) | **11.15 ms** *(MINOR)* | 40.2 *(MATERIAL)* | 186.3 *(DOMINANT)* | 2081.6 |

Bin-centring is not a modelling choice: `coupledPAT` subtracts a per-bin centre, so a linear ramp of
extent Δ survives only as Δ/√12. (The same √12 as the PHYS-window artefact, used correctly this
time — there it *was* the statistic; here it converts a known ramp to the SD that survives centring.)

### 🔴 But the tail is not clock divergence — it is noise, and the gate is empirically vindicated

CLAUDE.md §🔒.7 requires a ppm be quoted with its uncertainty **or not at all**. Doing so:

| | median | p90 |
|---|---|---|
| σ_y(300 s) as ms over the bin | 89.7 | 326.1 |
| **σ_y(300) / \|ppm\|** | **2.93** | **24.1** |
| fragments with σ_y ≥ \|ppm\| | **233/290 = 80.3 %** | |

**On four fifths of refused fragments the measured rate is smaller than its own Allan uncertainty at
τ = 300 s** — it is indistinguishable from noise. You cannot lose a correction you never had, so the
"cost of refusing" is largely illusory: the ramp-extent table above is measuring *rate-estimation
error*, not clock behaviour.

**And the ratio is WORST exactly where the apparent ppm is largest** (p90 ratio 24.1). That is this
repo's anti-selection law for the third time (`uncertainty-band-as-gate-anti-selects`,
`compare-rates-through-uncertainties`): a spread taken over estimates of differing precision
manufactures a tail out of the worst-measured items. **The p90 of 186 ms is not a night whose clock
ran away; it is a short fragment whose rate was never determined.**

**Conclusion — and it reverses the direction the §6 headline pointed.** The ECG span gate is not
merely conservative-by-design, it is **empirically correct**: it refuses precisely the fragments whose
rate is noise. The honest §21D entry is the **median centred residual, 11.15 ms — MINOR** — and the
42.5 ms fragment-end figure must **not** enter the budget at all.

⚠️ **Two limits on this.** σ_y(300) is extrapolated along the measured Allan slope from each
fragment's longest measured τ, so for short fragments it is an extension rather than a measurement;
and where a fragment's span is under 300 s a "5-minute bin" is truncated, making its ramp extent an
upper bound. Both push the same way — toward *over*-stating the residual — so the MINOR verdict is
conservative.

## 5b · §17 — the two corpora differ in clock provenance

| corpus | `independent` | reading |
|---|---|---|
| `uploads/` Polar PPG (phone) | **false 8/8** (spreadMs 0.98–1.00 ms) | no second clock |
| `tepna-smoketest/captures` ECG (box) | **false 0/448** | two real clocks |

The comment's *"every H10 ECG capture in this corpus is a phone capture"* is true of **its**
population and false of this one. **Every claim here must carry its population** — the box/phone
split is not a detail, it decides whether a second clock exists at all.

## 5d · §8/§9 partial — forward beat-slip is structurally impossible, with a stated HR condition

Read from `coupledPAT` (`pat-feasibility-worker.js`), recorded here so the charter's §8/§9 cells are
not left looking unvisited while the oracles run.

**The pairer takes the FIRST foot whose lag lies in `[PHYS_LO=200, PHYS_HI=650]` ms after R, then
breaks** — not the nearest, not the best. A slip (taking beat *i+1*'s foot for beat *i*) therefore
requires **both**:

1. beat *i*'s own foot to be missing — otherwise it is found first and the loop breaks; **and**
2. beat *i+1*'s foot to land inside the window: `RR + PAT_true ≤ PHYS_HI`.

Condition 2 is the structural one. Taking the most permissive true PAT the window admits
(`PAT = PHYS_LO = 200 ms`):

```
RR ≤ 650 − 200 = 450 ms   ⇒   HR ≥ 133 bpm
```

At a more typical `PAT ≈ 250 ms` the requirement is `RR ≤ 400 ms`, i.e. **HR ≥ 150 bpm**. So **§9's
±RR secondary modes cannot appear in the current code at any sleeping heart rate** — the window is
narrower than one cardiac cycle by construction, which is precisely what the source comment says it
was widened-then-narrowed to achieve (the prior `LAG_SEARCH_MS = 2000` bound *was* wider than one RR
and produced exactly the whole-cycle jumps that read as 900–1250 ms of "drift").

⚠️ **The guarantee is conditional, and this brief states the condition rather than inheriting the
claim.** It is not "slip is impossible"; it is "slip requires HR ≥ 133 bpm *and* a missing foot".
The mode test in §9 must therefore run against a **no-window** pairing bounded by `0.9 × local RR` —
otherwise it measures the window, not the modes. That harness already exists in-source as
`coupledPAT`'s `censOut/censIn` censoring diagnostic, and the oracle replay needs it anyway.

**§8 and §16 are one finding seen twice.** The same `[200, 650]` window that prevents slip is a
**censoring cut**: the source records it discarding most of the data on **16 of 19 site-nights**, with
one night running a median lag of 831 ms — **95.9 % above `PHYS_HI`** — and still emitting a confident
PAT number. Survivors are edge-biased, because only beats under the ceiling can pair. A pairing audit
(§8) and a gate self-selection audit (§16) are therefore reading the same mechanism from two sides,
and neither should be reported without the other.

## 5e · The §12 instrument, and a claim this brief got WRONG

The §12-class instrument is `tools/pat-per-led.mjs`, which already existed: the Verity's three optical
channels are three independent detectors of the same beat, so differencing two cancels the beat and
**every physiological term**, and a three-cornered hat returns σ per LED.

**The open cell, closed:** TCH fiducial jitter is **1.88 – 6.33 ms per LED** (mostly 2–3), against the
literature's 5.69 ms intersecting-tangent RMSE. Two independent routes now agree — varying the
*definition* on one signal gave ≤ 6.22 ms (§2), varying the *detector* on one definition gives 2–6 ms.
**The fiducial is not the limiting term, by either route.** This part stands.

🔴 **What this brief claimed next was WRONG and is retracted.** It reported that accepted PAT is
*universally* uniform over the acceptance window and that PAT *"cannot clear a 60 ms bar on any
hardware"*. That run was piped through `tail -40`; the surviving rows were the last few and happened
to be one cluster. The untruncated 42-night re-run falsified it **in both directions** — there are
nights **below** the bar and nights **above** uniform. See
[`PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md`](PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md)
for the corrected result: four regimes, window-domination at 37 % rather than 100 %, and one night in
42 resolving below the bar.

**What survives the retraction**, because it is a single row read whole rather than an aggregate: on
2026-08-24, LED1/LED2 with foot-to-foot SD of **15427 / 15437 ms** — catastrophically broken — report
PAT SD **130.6 / 129.9**, statistically identical to healthy LED0's **130.4** (foot-to-foot 102.0).
**A broken channel and a working channel report the same PAT SD.** That proves window-domination
*occurs*; the regimes brief establishes how often.

## 6 · Done when

- [x] Per-family beat-to-beat variability measured, clock excluded by construction, gate-asserted.
- [x] Pre-stated closed bands; all 28 pairs classified.
- [x] Pooling hazard found, corrected, and documented.
- [x] TCH independence violation surfaced as refusals rather than clamped.
- [x] §6 ECG axis: the 160/187 @ 48 ms claim VERIFIED on an independent 448-fragment population (82.8 % @ 42.5 ms).
- [x] The within-5-min-bin ECG residual computed per fragment: **11.15 ms median centred (MINOR)**, and the tail shown to be rate-estimation noise (σ_y ≥ |ppm| on 80.3 %), which vindicates the span gate empirically.
- [x] Common-mode fiducial error: TCH per-LED gives **1.88–6.33 ms**, agreeing with the definition route (≤6.22 ms). The fiducial is not the limiting term by either route.
- [x] ~~Central result: accepted PAT is universally uniform over its window~~ — **RETRACTED**, read off a truncated run. Corrected in `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md`: window-domination is a **37 % regime**, not a law, and one night in 42 resolves below the bar.
- [x] §8/§9 partial: slip structurally impossible for HR < 133 bpm (condition derived, not inherited); §8 and §16 shown to be one mechanism.
