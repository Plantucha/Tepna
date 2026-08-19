<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-18 (closed as EXECUTED-AND-REFUTED, no further work in this brief. Phase 0 ran twice and NO-GO both times; per §2's own kill criterion the promotion phases (§3+) are VOID, and the two revival paths this brief left open have since been MEASURED OUT elsewhere: the §4 dual-site differentiator was run and does not differentiate (arm→finger cancels PEP by construction and scatter does not collapse — 92 ms vs 84, 1/43 clearing the bar), and the §2-RESULT-II.4 beat-correspondence audit is subsumed by [`PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md`](PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md), which eliminates every analysis-side candidate and finds only two things could move the ~96 ms floor — a tighter foot or a longer transit path, NEITHER analysis. The live successor thread is [`PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md`](PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF.md) (176 Hz Verity foot), not a re-run of anything here. Original park note kept below for the record: Phase 0 run 2026-07-29 — **NO-GO on COUPLING**, and the drift criterion is **unmeasurable with this instrument**; §1's premise that "the blocker moved" is refuted — single-host and phone-stamped capture are indistinguishable. Parked per §2's kill criterion; the coupler defect found on the way is fixed and gated. **Re-measured OFFSET-FREE 2026-07-29 — NO-GO stands and hardens: 0 of 54 pairings clear the gate, coupling unchanged at ~19 %, and the real limit is ~96 ms of beat-to-beat scatter while `halfDrift` passes 47/54, so drift was never the blocker.** See §2-RESULT then §2-RESULT-II) · **Created:** 2026-07-18

# Integrator: promote PAT/PTT into a beat-level Vascular (trend-only) fusion layer — dual-site, drift-gated

> **What this is.** An executable plan to lift the **already-built, already-validated** PAT engine
> (`PAT Feasibility.html` + `pat-feasibility.js`, the `ECGDSP`×`PPGDSP` beat-coupler shipped by the DONE
> [`PAT-FEASIBILITY-2026-07-08-BRIEF.md`](PAT-FEASIBILITY-2026-07-08-BRIEF.md)) **into the Integrator** as a
> real cross-node **pulse-arrival-time** stage — and to add the differentiator the single-tool spike could
> not: **dual-site PAT** (one R-peak → two peripheral feet), whose difference cancels the pre-ejection-period
> confound. **This does not invent PTT.** The timing math exists and works; the question this brief answers is
> whether the **new capture path** clears the bar the feasibility spike set, and if so, wires it in.

---

## 1 · Why now — the blocker moved, and the new capture path is its named unblock

`PAT-FEASIBILITY` (DONE) proved, on real data, that the obstacle to PAT is **not** the sensor — it is
**inter-device clock drift**. On **Polar Sensor Logger** phone-timestamped dumps the two device crystals
drift **~48 ppm** apart (~**1147 ms** across a night ≈ one whole cardiac cycle at ~50 bpm) — **~24× the
physiological PAT signal** — so absolute PAT is impossible and even a relative trend is swamped. Its ACC-tap
resync fallback **failed**. Its recorded verdict: **needs single-host synchronised capture** (unblock-path #1,
under [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md)) — *"when either lands,
re-run `PAT Feasibility.html`."*

**That path has now landed.** The Tepna daemon (`CAPTURE-HOST-FOLLOWUPS-II`) captures **H10 ECG · Verity PPG ·
O2Ring finger PPG** through **one host** on a **`CLOCK_MONOTONIC`-anchored** timeline — the single-host common
reference the feasibility brief named. So the correct next action is **exactly the step that brief scheduled**:
re-run the go/no-go gate on a Tepna-captured night. This brief is that re-run, plus the promotion it unlocks.

⚠️ **Not automatically solved — one honest caveat.** The three streams are **stamped differently**: PMD
(H10/Verity) carries a device-monotonic sensor timestamp; the O2Ring pleth is **host-arrival back-timed**
(`O2RING-LIVE-PPG-WAVEFORM` Phase 2 — the ring's own RTC free-runs +151 s and must not stamp the waveform). So
BLE-arrival **jitter** replaces crystal **drift** as the residual noise floor. Whether that floor is under the
bar is an **empirical question Phase 0 must answer**, not an assumption.

## 2 · Phase 0 — RE-RUN the go/no-go gate on a single-host night (do first; measurement, no new code)

Re-run the existing instrument (`PAT Feasibility.html`) on a **Tepna single-host** night, per pairing:
- **H10 R→O2Ring finger foot** and **H10 R→Verity wrist foot**, characterising each pairing's **baseline
  drift**, **coupling %**, and **beat-to-beat IQR** separately (the two feet are stamped differently, so their
  jitter floors differ).
- **The bar (verbatim from `PAT-FEASIBILITY`):** promote only if **drift ≤ 60 ms**, **coupling ≥ 55 %**,
  **beat-to-beat IQR ≤ 60 ms**. Below that → **FEASIBLE — provisional trend**.
- **Kill criterion:** if drift stays > 60 ms even single-host (i.e. the host-arrival jitter, not crystal
  drift, dominates), **park this brief PROPOSED with the number inline** and route the fix to the
  SDK-synchronised-timestamp path (`POLAR-SDK-CAPTURE`). Do **not** ship a Vascular panel on a failed gate —
  that is the exact discipline the feasibility brief enforced.

## 2-RESULT · Phase 0 EXECUTED 2026-07-29 — NO-GO, and not for the reason the gate reported

Run with the shipped coupler over **both** corpora, pairing on true temporal overlap, per site,
never pooled.

### The gate, as measured

| corpus | pairing | n | drift | coupling | beat IQR | clears the bar |
|---|---|---|---|---|---|---|
| single-host (capture-host daemon) | H10→Verity wrist | 13 | 420.8 ms | **21.5 %** | 42.7 ms | 0/13 |
| single-host | H10→O2Ring finger | 11 | 379.2 ms | **15.4 %** | 42.2 ms | 0/11 |
| phone-stamped (Polar Sensor Logger) | H10→Verity wrist | 28 | 429.9 ms | **26.7 %** | 42.8 ms | 0/28 |

**Beat-to-beat IQR PASSES everywhere** (~43 ms against a 60 ms bar). **Coupling fails everywhere**
(15–27 % against 55 %). That is the honest verdict: PAT does not couple reliably on this data.

### Three findings that change what this brief says

**1 · The gate's drift criterion is not measurable with this instrument.** `driftRange` never measured
inter-device clock drift. Before the fix below it measured **beat-slip**: drift/RR clustered at
0.85–0.98 across 24 pairings and the per-bin medians were bimodal exactly one RR apart, while
`residIQR` stayed at 8–45 ms. A night cannot carry 8 ms of beat-to-beat scatter and 1058 ms of genuine
clock wander (2026-07-19 wrist: 87 % coupling, 8.0 ms IQR, 1058 ms "drift"). After the fix it measures
~420 ms ≈ the width of the 450 ms physiological window, because under low coupling the accepted lags
scatter across it. **In neither configuration is it drift.** Any future gate must estimate drift from
something else — the anchor aligner in `pat-align.js` is the candidate.

**2 · §1's premise is refuted: the blocker did NOT move.** After the fix, single-host and
phone-stamped capture are **statistically indistinguishable** (drift 420.8 vs 429.9 ms; coupling 21.5
vs 26.7 %; IQR 42.7 vs 42.8 ms). The capture path was never the limiting factor, so §2's kill-criterion
routing to `POLAR-SDK-CAPTURE` — premised on host-arrival jitter dominating — **would not help**.
Better timestamps cannot fix a coupling rate this low. The limiting factor is upstream: peripheral foot
detection, and/or whether this subject's PAT sits inside 200–650 ms at these two sites at all
(`inPhysPct` is 100 % *by construction* once the window is enforced, so it is no longer evidence).

**3 · `PAT-FEASIBILITY`'s recorded no-go was mis-attributed.** That brief (DONE) reported "~48 ppm →
**~1147 ms** across a night" as *crystal drift*, and everything since — including this brief's
existence — rests on it. 1147 ms is **one RR interval** at ~50 bpm, and the phone-stamped corpus
reproduces the same ~430 ms window-width signature as the single-host one once slip is removed. The
number was real; calling it crystal drift was not. That does not un-DONE the feasibility work, but its
*cause* attribution should be corrected rather than inherited.

### The coupler defect, fixed and gated

`coupledPAT` accepted the first foot with `lag >= 0` inside a **2000 ms** search span while declaring a
200–650 ms physiological window that only ever fed a display diagnostic (`inPhysPct`). 2000 ms exceeds
one RR, so a missed foot let the **next** beat's foot be accepted as this beat's PAT. Now extracted to
`pat-align.js` as `coupleRtoFoot` with the window **enforced**, which makes slip structurally
impossible (`PHYS_HI` < 1 RR) and makes `matchRate` report real coupling instead of a trivially high
number. 16 gated assertions, including a mutation control that re-opens the window past 1 RR and
demonstrates the slip returning — and pinning the detail that let this survive in production: the
**IQR does not move at all** under slip (10 outliers in 60 beats cannot shift a quartile), which is
why the metric beside `driftRange` looked healthy the whole time.

### What must happen before this brief can be reconsidered

- Establish why coupling is 15–27 %: is the foot detector missing beats, or is the true PAT outside
  200–650 ms for these sites on this subject? That is a **measurement**, not a build.
  **→ MEASURED, §2-RESULT-II.1: neither, in the simple form. Feet are plentiful (median feet/R = 0.99)
  and the window IS mis-centred, but re-centring it does not rescue coupling.**
- Replace `driftRange` with an estimator that actually measures drift (anchor-based; `pat-align.js`).
  **→ MEASURED, §2-RESULT-II.2: replaced by `halfDrift`, which PASSES 47/54. Drift was never the
  blocker — a third independent confirmation.**
- Only then re-evaluate the bar. **No Vascular panel is built on the current numbers** — §4's
  discipline holds. **→ Re-evaluated in §2-RESULT-II. The NO-GO stands and hardens.**

---

## 2-RESULT-II · Phase 0 re-measured OFFSET-FREE, 2026-07-29 — still NO-GO, cause now located

§2-RESULT closed with two open **measurements**, not builds. Both are now done, and together they move
the NO-GO from "coupling is low, we don't know why" to a located cause.

**Why re-measure at all.** The absolute 200–650 ms window assumes the two clocks agree to within the
physiological range. Several nights show a *tight* lag distribution sitting at a *different centre*
each night, so beats were being rejected for the offset rather than for implausible physiology. And
this brief only ever wanted a **trend** (§4: "a Vascular trend only — NEVER an absolute BP number") —
a trend does not need the absolute offset. It needs the lag to be **stable** and its **changes** real.
So the honest gate is offset-free.

### II.1 · Dropout is refuted; the window is mis-centred; neither explains the failure

Two candidate causes with opposite fixes, so guessing was not an option. Unconstrained nearest-foot
lags, restricted to the overlap, 54 pairings:

| diagnostic | measured | reading |
|---|---|---|
| `feet/R` (PPG feet per ECG R-peak) | median **0.99**, **52/54 ≥ 0.95** (min 0.73, 2026-06-13) | **net dropout REFUTED** — the PPG yields ~one foot per beat |
| `inWin%` (lags inside 200–650 ms) | median **36.6 %**, range 0.0–64.4 | the window admits only ~a third |
| lag distribution within a night | p10 ~100–150 · median ~550–800 · p90 ~1000–1200 | ~**1000 ms** of spread ≈ **one RR** |
| per-night lag centre | **171.9 ms** (2026-06-14) → **1171.1 ms** (2026-06-18) | the centre moves 7× between nights |

Some nights are narrow *but* offset — 2026-07-28 wrist spans p10 555 → p90 874 (319 ms) centred at
**715**; 2026-07-03 spans 763 → 1092 centred at **956**; 2026-07-08 sits at **942**; 2026-06-14 at
**172**, below the window. So the window genuinely is mis-centred. That was worth removing.

### II.2 · The offset-free gate — same bars, honest metrics

`modalLag` = the night's median nearest-foot lag (offset and true PAT conflated, deliberately) ·
`couplingStable` = fraction of beats within **±100 ms** of `modalLag` · `residIQR` = IQR of
(lag − modalLag) over those beats · **`halfDrift`** = |median(2nd half) − median(1st half)|, a real
wander measurement that replaces the discredited `driftRange` and is immune to both beat-slip and
window placement.

| corpus | pairing | n | coupling (≥55 %) | residIQR (≤60 ms) | halfDrift (≤60 ms) | clears the bar |
|---|---|---|---|---|---|---|
| single-host | H10→Verity wrist | 13 | **18.8 %** | **96.9 ms** | 26.9 ms | 0/13 |
| single-host | H10→O2Ring finger | 11 | **19.2 %** | **98.7 ms** | 12.6 ms | 0/11 |
| phone-stamped | H10→Verity wrist | 30 | **19.0 %** | **95.6 ms** | 21.1 ms | 0/30 |

**0 of 54 pairings clear the gate.** And the near-misses are the informative part, because they fail on
**disjoint** criteria — no night is close on both at once:

- clears **coupling ≥ 55 %**: exactly **2** — 2026-06-14 (56.0 %) and 2026-07-08 (55.9 %) — and both
  fail `residIQR` badly (90.8, 87.8 ms).
- clears **residIQR ≤ 60 ms**: exactly **2** — 2026-07-19 (44.6 ms) and 2026-07-10 (54.7 ms) — and both
  fail coupling (51.0 %, 40.9 %). 2026-07-19 is the single closest night in the corpus and misses by
  **4 percentage points of coupling** while passing both other bars.
- clears **halfDrift ≤ 60 ms**: **47/54 (87 %)**, median **19.7 ms**, and **20/54 under 10 ms**.

### II.3 · What this settles

1. **Drift was never the blocker — confirmed a third independent way, and now quantified.** `halfDrift`
   passes 47/54 with a 19.7 ms median. Converting each night's wander into an implied inter-device rate
   (halfDrift ÷ half the overlap) puts it at a **1.46 ppm** median on the 27 nights ≥ 240 min (max 8.6),
   and **excludes `PAT-FEASIBILITY`'s 47.7 ppm on 51 of 54 pairings**. The implied rate moreover *falls*
   as nights lengthen (`r(overlap, ppm) = −0.54`) — the signature of a metric hitting its own noise floor
   on short recordings, not of a fixed rate. A real 48 ppm offset cannot hide on a 7 h night.
2. **Removing the offset does NOT rescue coupling.** It stays at ~19 % (18.8 / 19.2 / 19.0) — statistically
   identical to the windowed run's 21.5 / 15.4 / 26.7 %. The mis-centred window was real and was *not*
   the cause.
3. **The limit is beat-to-beat scatter.** `residIQR` ≈ **96 ms** against a 60 ms bar, measured against
   each night's *own* modal lag, so it is offset-free by construction. The R→foot interval is stable in
   its centre and loose in its detail — the opposite of what PAT needs.
4. **§1's premise is refuted a second way, and the single-host leg is a GENUINE test of the remedy.**
   Single-host 18.8 % vs phone-stamped 19.0 % — indistinguishable offset-free, exactly as windowed. The
   single-host path is not merely "a different app"; it removes the clock term three ways at once:
   - `capture-host` **sets both device clocks from the host on every connect** (`time.auto_sync_devices`,
     default **True** — `settings_schema.py:24`, applied at `capture.py:960`, skew logged per sync).
   - The host clock itself is **chrony-disciplined against a LOCAL stratum-1** — 5.9 µs offset, **0.008 ppm**
     residual, 0.027 ppm skew (measured on the box 2026-07-29).
   - Captures are written as **fragments re-anchored to the host clock at each first row**; across 858
     measured fragments the median is **3.0 min**. So either crystal free-runs for minutes, never a night.

   Consequence: accumulated inter-device drift is **structurally capped at 8.6 ms even granting
   `PAT-FEASIBILITY`'s 47.7 ppm** (0.3 ms at the measured 1.46 ppm) — negligible against a 200–650 ms window.
   **Even if the 48 ppm claim were entirely true, this corpus could not express it**, and coupling is still
   18.8 %. `POLAR-SDK-CAPTURE` is therefore **applied-and-unhelpful**, not merely unnecessary.

   One nuance to carry forward: the host writes the **device** counter (`sensor timestamp [ns]`) as the
   sample clock and its own stamp only as an **arrival** time — deliberately, since arrival stamping inherits
   BLE burst jitter and steps backwards on 0.5–0.8 % of rows (`capture-host/writers.py`). The correct
   architecture is a precise *device* counter repeatedly re-referenced to a disciplined host, **not** stamping
   every sample at the host. Also note device clock discipline is imperfect in practice — the host logs the
   Verity at −5.0 s and once uncorrectable after 3 re-syncs, and the H10 (which implements no read-back) once
   at −239,071,318 s. That does not touch this analysis, which uses per-fragment **differences**, so an epoch
   error cancels — but it means **absolute** device time on these sensors is unusable and only **relative**
   sample timing is sound.

### II.4 · The one ambiguity this run does NOT resolve — and it matters

A lag component of **one whole RR** is **indistinguishable from a one-beat slip** by any of these
statistics. So the per-night `modalLag` (172–1171 ms) must **not** be read as a measured inter-device
offset: a night centred at 942 ms may be a genuine 942 ms offset or a correctly-centred PAT plus one
skipped beat, and nothing here separates them.

Relatedly, **`feet/R` ≈ 1.0 refutes NET dropout but not local insertion/deletion pairs** — a missed foot
here and a spurious foot there preserve the ratio while destroying beat correspondence, and would produce
exactly the observed signature: plentiful feet, ~1 RR of lag spread, ~96 ms residual scatter. **That is
the next measurement** if this brief is ever revived: audit beat *correspondence* directly (monotone
one-to-one R↔foot assignment, counting insertions and deletions), not foot *counts*. Until then,
"the PPG foot detector is adequate" is not established — only "it produces about the right number of feet".

### Verdict

**The NO-GO stands and hardens.** Both remediation paths §2-RESULT named have now been measured and
neither rescues the gate: drift was never the problem, and the mis-centred window was real but not
causal. No Vascular panel is built. `pat-align.js` and its 16 gated assertions stay — they are correct,
reusable, and they earned their keep by falsifying two prior attributions — but the Phase 1–3 build
below remains **unstarted by design**.

*(Reproduce: the offset-free gate and the cause diagnostic are the two throwaway harnesses described
above; they load the real `ECGDSP`/`PPGDSP`/`PATAlign` in a co-loaded realm and read the corpus
read-only. Cf. `tools/acc-acc-control.mjs`, which is the same pattern committed, for
`CROSS-DEVICE-CLOCK-SKEW` §2c.)*

---

## ⚠️ READ THIS BEFORE §2-RESULT-III…XII — WHAT IS CURRENT, AND WHAT IS SUPERSEDED

The twelve sections below are a **running investigation with nine self-corrections recorded in place**,
per house style. That is deliberate — but it means a claim and its refutation can sit 300 lines apart,
and several superseded figures still read as plain statements in their original sections. **This table is
authoritative; anything below it that disagrees is superseded.**

| claim, as first written | where | **CURRENT** |
|---|---|---|
| "PAT recoverable on **2 of 29** nights (7 %)" | IV, V | **11 of 29 (38 %)** — the lag search was asymmetric (VIII) |
| "**93 %** of nights fail" | V | **~62 %** |
| beat-to-beat precision "**4.5–5.7 ms**" | IV | **~2.7 ms** — beat times were on a synthetic uniform grid (IX) |
| "the PPG foot detector is **REFUTED**" | III draft | **False.** Feet correspond 96–97.7 % at a wide window; that number measured the *window* |
| alternation is "**the mechanism**" | V | **Not sufficient.** A strong negative screen only; clean-ratio nights still fail (VI) |
| multimodality "sufficient but not necessary" | VII | **Necessary, not sufficient** — 11/11 identifiable are unimodal, 0/8 multimodal (VIII) |
| monotone pairing fixes cross-slip pairing | IX, and §4g of METROLOGY | **It changes nothing.** Monotone ≡ nearest-match at every tolerance; the difference was the tolerance (XII) |
| detrending removes "**89 %** of variance" | IX | **Pipeline-specific.** On the common pairing it moves 33.6 → 33.4 ms (XII) |
| "the **clock** is the cause" | IX | **Half.** Drift explains beats failing to MATCH; it does not explain matched beats SCATTERING (XI) |
| RR↔PPI margin as the identifiability gate | IV | **Superseded** by the `w/√12` ratio trajectory — simpler, no alignment needed (XII) |

### What stands, in one paragraph

The **anchor**, not the foot detector, is why PAT fails; feet correspond at a wide window. **PAT SD is
dominated by the matching window** — 1.9–7.1× spread on a single night from pipeline choice alone — so no
PAT statistic means anything without its tolerance and correspondence rate beside it. The **`w/√12` ratio
trajectory** separates real measurements from window artefacts (0.83→0.13 vs 0.93→0.55) and is the
recommended gate. **Inter-device drift is 5–306 ppm**, per-block unwrapping recovers coverage
(68.6 % → 79.4 %) but not precision (71.7 → 67.5 ms). On the cleanest night the instrument reaches
**16.7 ms**, and **5.5 ms** after removing a 20 ppm trend — so the capability is real. **The cause of the
residual scatter is NOT found**; amplitude, upslope, rise time, LED channel, missing beats, fiducial
switching, uniform-grid timestamps and drift are each excluded by measurement.

## 2-RESULT-III · §II.4's NEXT MEASUREMENT, RUN 2026-08-15 — the detector is FINE; the OFFSET is not

§II.4 said: *"`feet/R` ≈ 1.0 refutes NET dropout but not local insertion/deletion pairs … **That is the
next measurement**: audit beat correspondence directly (monotone one-to-one R↔foot assignment, counting
insertions and deletions), not foot counts."* Run on 29 matched H10+Verity nights, by
dynamic-programming a monotone one-to-one assignment (monotonicity forbids crossing, so a slip cannot be
paired through).

**And the answer depends entirely on a parameter, which is itself the finding.** A match requires the
foot to fall within ±TOL of the night's modal offset. Sweeping TOL:

| tolerance | ±50 | ±100 | ±150 | ±250 | **±400** | **±600** |
|---|---|---|---|---|---|---|
| median correspondence | 25.2 % | 48.3 % | 68.6 % | 90.1 % | **96.0 %** | **97.7 %** |
| nights ≥ 95 % | 0/29 | 1/29 | 3/29 | 8/29 | 16/29 | **24/29** |
| **median PAT SD** | 27.8 ms | 52.5 ms | 70.7 ms | 101.9 ms | **126.9 ms** | **144.6 ms** |

### The PPG foot detector is NOT the problem

**At a wide enough window essentially every R peak has a corresponding foot** — 96 % at ±400 ms, 97.7 %
at ±600 ms, ≥95 % on 24 of 29 nights. There is no epidemic of missing feet, and no epidemic of spurious
ones. §II.4's insertion/deletion hypothesis is **not supported**: the feet are there and they correspond
one-to-one.

⚠️ **An earlier draft of this section concluded the opposite** — "the foot detector is REFUTED" — from
the ±150 ms row alone (68.6 %). That number measures the **window**, not the detector. Correspondence is
a joint property of the detector *and* the tolerance, and quoting it without the tolerance beside it is
meaningless. Caught before merge by sweeping the parameter instead of trusting a single value of it.

### The real finding: no tolerance buys both

Correspondence and scatter move together, and there is **no operating point where both are acceptable**:

- at **±150 ms** the matched PAT is tight (70.7 ms) but only **68.6 %** of beats participate;
- at **±400 ms** nearly every beat participates but PAT SD is **126.9 ms**.

A true PAT for these sites is ~150–300 ms with beat-to-beat variability of tens of ms. **A 127 ms SD is
not a PAT distribution** — it is a distribution of something else that happens to contain PAT.

### The modal offset is the thing that is broken

Across the 29 nights the modal offset spans **100 → 1175 ms**, a **1075 ms** spread, against a plausible
PAT range of ~150 ms. Several nights sit a full RR above the rest — precisely §II.4's ambiguity, now
quantified rather than suspected.

And the discriminating detail: **offset magnitude does NOT predict matching quality.** Nights with
offset < 500 ms and ≥ 500 ms match equally well (68.2 % vs 68.6 % at ±150) with equal scatter (73.3 vs
69.4 ms). So a whole-RR error shifts the anchor **without degrading the monotone assignment** — the
relative beat-to-beat structure is sound while the absolute offset is uninterpretable. That is exactly
what §II.4 warned `modalLag` must not be read as.

### What it changes

- **The NO-GO stands, with the cause relocated.** Not "the foot detector is inadequate" — that is
  refuted — but **"the R↔foot anchor is not identifiable per night from these streams."** Reviving this
  brief requires an anchor that is right in absolute terms, not a better foot detector.
- **Any PAT statistic must be quoted with its tolerance and its correspondence rate.** Alone, a PAT SD
  describes an unspecified subset selected by an unstated parameter.
- **It corrects a downstream analysis:** `METROLOGY-METHOD-ADOPTION` §4d–§4g decomposed PAT variance at a
  single fixed tolerance without reporting it — see its §4g.

## 2-RESULT-IV · THE ANCHOR IS RECOVERABLE — by interval sequence, on 2 of 29 nights

§2-RESULT-III relocated the failure from the foot detector to the **anchor**: the R↔foot offset is
ambiguous modulo one RR, and beat *times* cannot resolve it. Beat *intervals* can, because an RR
sequence is aperiodic where a beat train is not — the standard fix
([[beat-trains-align-only-mod-rr]]: "align on aperiodic features").

**Method.** Normalised cross-correlation of the ECG **RR** sequence against the PPG **PPI** sequence over
integer BEAT-INDEX lags, both trains first restricted to their common time span. The **margin** between
best and second-best lag is the identifiability measure, and it is self-validating: no threshold is
chosen, the two populations separate by three orders of magnitude.

| night | ncc | margin | PAT SD | acf₁ | acf₁₀ |
|---|---|---|---|---|---|
| **2026-07-12** | **0.9964** | 0.2228 | **36.8 ms** | 0.988 | 0.967 |
| **2026-07-09** | **0.9953** | 0.1963 | **28.1 ms** | 0.987 | 0.960 |
| 2026-07-08 | 0.8003 | 0.1275 | 62.6 ms | 0.762 | 0.309 |
| 2026-07-11 | 0.7304 | 0.0813 | 162.6 ms | — | — |
| *(24 further nights)* | *0.06–0.70* | **0.0003–0.036** | — | — | — |

### Only 2 of 29 nights are cleanly identifiable — and on those, PAT is a precise instrument

**PAT SD 28.1 and 36.8 ms**, against a corpus median of 70.7 ms at ±150 ms tolerance. And the
autocorrelation is near-unity: **acf₁ = 0.987**, still **0.96 at lag 10**. Which means the beat-to-beat
component is

    sigma_beat = SD * sqrt(2(1 - acf1)) = 28.1 * sqrt(2*0.013) = 4.5 ms   (2026-07-09)
                                          36.8 * sqrt(2*0.012) = 5.7 ms   (2026-07-12)

**Beat-to-beat PAT precision is ~4.5–5.7 ms.** The 28 ms total is almost entirely *slow drift*, not
noise. Compare the same computation on the next-best night (acf₁ 0.762): **43.2 ms** — an order of
magnitude worse, and that night is already below the clean pair.

### What this establishes, and what it does not

- **The instrument is capable.** When the two devices demonstrably see the same beats, PAT is resolved to
  a few milliseconds beat-to-beat. Nothing in §4a–§4c's estimator work could have revealed this, because
  it was never an estimator problem.
- **It works on ~7 % of nights.** 2 of 29 clean, 5 of 29 identifiable at all. Every corpus-median PAT
  statistic in this project — including `METROLOGY-METHOD-ADOPTION` §4d–§4g — **averaged over nights
  where the PAT series is not PAT**.
- **The physiology conclusion SURVIVES and strengthens.** §4d found the residual correlated (acf₁
  +0.772); on cleanly-anchored nights it is **+0.987**, decaying to 0.96 over ten beats. The correlated
  structure is not a pairing artifact — repairing the anchor made it *stronger*, which is the direction
  that distinguishes signal from artifact.
- ⚠️ **n = 2.** This is an existence result: it proves the instrument *can* work and quantifies it when it
  does. It does not establish a distribution, and this brief has already been burned once by reporting a
  handful of nights (§2-RESULT-III's first draft). The identifiability gate is objective, and only two
  nights pass it — that is the finding, not a sampling choice.
- **Confound ruled out:** identifiable and non-identifiable nights carry the same beat counts (median
  2151 vs 2136 R-peaks), so this is not sample size in disguise.

### What to do with it

**Gate on identifiability before computing PAT at all.** The RR↔PPI margin is cheap, needs no reference,
and separates cleanly. A PAT statistic from a night with margin < 0.05 is not a weak measurement — it is
a measurement of something else. This is the missing precondition that §2-RESULT's original go/no-go gate
never had, and it explains why that gate failed: it was scored on a corpus that was ~93 % unidentifiable.

## 2-RESULT-V · THE MECHANISM — PPG beat alternation, which PpgDex already detects

§2-RESULT-IV showed PAT is recoverable on 2 of 29 nights and unrecoverable on the rest, and that more
data does not rescue the failures (tripling the slice, 2388 → 6426 beats, left margins at 0.001–0.003).
So the failure is a property of the beat train. **It has a named cause, and this repo already ships a
detector for it.**

`rMSSD > sdnnRobust` is PpgDex's shipped beat-alternation detector — when the optical detector alternates
between two fiducials, successive intervals swing long-short-long and rMSSD inflates 3–6× while the
robust SD does not. Computed per night and set against identifiability:

| | altPPG = rMSSD / sdnnRobust |
|---|---|
| **identifiable** (margin ≥ 0.05, n=5) | median **0.97**, range 0.79–1.24 |
| **not identifiable** (n=24) | median **2.24**, range 0.68–7.56 |

- gate `altPPG < 1.0` → catches **4/5** identifiable and **23/24** unidentifiable
- `corr(altPPG, ncc)` = **−0.662**
- rMSSD on unidentifiable nights runs **127–592 ms** against a physiological 20–50 ms

**So the answer to "why does PAT fail on 93 % of nights" is: the PPG beat train is alternating, and
PpgDex already knows.** The metric is computed today and used for HRV plausibility; nobody had connected
it to PAT identifiability.

### Honest bounds — it is strong, not perfect

⚠️ **A seven-night spot check suggested clean separation. The corpus says 93 %.** Two nights break it:

- `2026-07-11_221615` is identifiable (margin 0.0813) at altPPG **1.24** — above the gate;
- `2026-06-18_214249` is NOT identifiable (margin 0.0149) at altPPG **0.68** — below it, and it fails for
  a different reason: `sdnnRobust` is **100.2 ms**, i.e. genuinely high interval variability rather than
  alternation.

So alternation is *a* dominant cause and not the only one, and a gate built on it must be stated with its
error rate rather than as a clean separator. **This is the fifth time in this investigation that a
handful of nights implied a cleaner result than the corpus supports** — recorded because the pattern
matters more than any individual number.

### What it means for the PAT programme

- **The instrument is not the problem and the estimator was never the problem.** §4a–§4c of
  `METROLOGY-METHOD-ADOPTION` tried a template TOA, eight fiducials and an admission gate, and moved
  ~1.7 ms. All three were averaging over nights whose beat train was wrong.
- **PAT has a cheap, PPG-only precondition.** `altPPG < 1.0` needs no ECG and no reference; it is already
  computed. Applying it first is the difference between a 28 ms PAT and a 70 ms one.
- **The fix is upstream of PAT entirely** — it is the optical beat detector's alternation, which is a
  PpgDex defect with its own detector and its own history, not a fusion problem.

## 2-RESULT-VI · SCOPE AND LIMITS of §2-RESULT-III–V — three checks that narrow the claims

Three follow-up checks, each run because the claim above would have been unsafe without it.

### 1 · The harness does NOT carry the known `fs` bug — checked, not assumed

`pat-sd-is-the-window` records that ECGDex once derived `fs` from the lossy `timestamp [ms]` column and
**rounded it to a nominal 130 Hz**, so the axis ran 46–126 ppm fast — **1.25–4.16 s per night** (fixed,
PR #1121). A seconds-scale drift across a 40-minute window is exactly what would destroy interval-sequence
alignment, so the obvious worry is that §2-RESULT-IV rediscovered a fixed bug in its own harness.

**It does not.** The harness derives `fs` from the measured span rather than rounding to nominal, and on
a real file the two columns agree to nine decimals:

    fs from 'timestamp [ms]'        129.957632 Hz
    fs from 'sensor timestamp [ns]' 129.957623 Hz     -> 0 ms drift over a 3078 s slice

### 2 · It is NOT specific to the phone-captured tree

§2-RESULT-III–V ran on `Ecg nightly/`, which is **phone-captured**. The box tree
(`tepna-smoketest/captures/`) is the one with a real second clock, and `pat-sd-is-the-window` reports
prior box work finding beat pairing clean. Three box segments tested:

| segment | beats | ncc | margin | altPPG |
|---|---|---|---|---|
| 2026-07-29 22:06 | 1465 | 0.1046 | 0.0068 | **0.95** |
| 2026-07-29 21:24 | 1432 | −0.0175 | 0.0050 | 4.52 |
| 2026-07-29 23:09 | 888 | 0.0361 | 0.0014 | **0.93** |

**Box nights fail too**, so the finding is not an artifact of the phone tree. ⚠️ But the box segments are
short and **fragmented** — that night alone holds 22 ECG and 7 PPG files from BLE reconnects — so this is
a weaker test than the phone corpus, not a stronger one.

⚠️ **And there is no contradiction with the prior box result**, which correlated **HR curves** at lag 0
(r = 0.988). An HR curve is smooth; a raw RR *sequence* is not. Correlating smoothed rates is a far
weaker statement than aligning beat-to-beat intervals, and the two measurements are not comparable.

### 3 · Alternation is NOT sufficient — the §2-RESULT-V mechanism is weakened

**Two of the three box segments carry clean alternation ratios (0.95, 0.93) and are still
unidentifiable.** Together with the two phone-corpus exceptions already recorded (an identifiable night
at altPPG 1.24, an unidentifiable one at 0.68 failing on genuine variability instead), the honest
statement is:

> `altPPG` is a strong **negative** predictor on the phone corpus — a night with alternation will not
> yield PAT — but a clean `altPPG` does **not** imply identifiability. It is a necessary-not-sufficient
> screen, and §2-RESULT-V's framing of it as "the mechanism" is too strong.

### What survives all three checks

- PAT is recoverable on **2 of 29** phone nights, at **28.1 / 36.8 ms** SD and **4.5–5.7 ms**
  beat-to-beat — an existence result, and unaffected by the above.
- The **anchor**, not the foot detector, is the failure — §2-RESULT-III's tolerance sweep stands.
- The **identifiability gate itself** (RR↔PPI margin) stands: it is objective, self-validating, and
  needed no threshold. What is now uncertain is the *cause* of non-identifiability, not the fact of it.

## 2-RESULT-VII · THE CAUSE HUNT — NOT FOUND. Two partial indicators, and an overfitted rule.

§2-RESULT-VI ended with "the *cause* of non-identifiability is uncertain, not the fact of it". This
section went looking. **It did not find a cause**, and the negative result is recorded in full because
the intermediate steps each looked like an answer.

### The hypothesis, and why it was the right one to test

The feet **do** correspond one-to-one (97.7 % at ±600 ms), so beats are not missing — yet their times
scatter by hundreds of ms against R. §4a measured the template's *precision* at **0.44 ms**, which cannot
produce that. The gap must be **model error, not noise error**: the detector locking onto a *different
waveform feature* on different beats. That predicts a **multimodal** PAT distribution, with modes
separated by the foot→peak or foot→notch spacing.

Measured (PAT as the gap to the nearest preceding R — no window, so it cannot inherit a tolerance;
20 ms bins, modes = smoothed local maxima ≥ 40 % of the global peak):

| | n | identifiable |
|---|---|---|
| **unimodal** | 21 | **5 / 21** |
| **multimodal** | 8 | **0 / 8** |
| correlation(mode count, ncc) | | **−0.053** |

### 🔴 Multimodality is SUFFICIENT but not NECESSARY — so it is not the cause

Every multimodal night fails, and multimodality is real (up to **5 modes** on 2026-07-04, at
170/250/410/570/910 ms). But **16 unimodal nights fail as well**, and the correlation with
identifiability is **−0.053 — indistinguishable from zero.** Multimodality explains at most 8 of 24
failures.

⚠️ **A six-night sample said otherwise.** It happened to contain four multimodal failures and two
unimodal successes, which looked like clean separation. **That is the sixth time in this investigation
that a handful of nights implied a cleaner result than the corpus supports.**

### The combined rule works, and is overfitted

| gate | identifiable passing | unidentifiable passing |
|---|---|---|
| `modes ≤ 1` | 5/5 | 16/24 |
| `altPPG < 1.25` | 5/5 | 5/24 |
| **both** | **5/5** | **2/24** |

⚠️ **Do not adopt this rule from this brief.** The threshold **1.25 was chosen after seeing that the
highest identifiable night is 1.24** — the textbook definition of fitting to the sample. The two
survivors sit at **1.23 and 1.24**, i.e. exactly at the boundary the threshold was drawn around. With
**n = 5** positives, this corpus cannot validate a two-parameter rule; it can only propose one.

### Honest end-state

- **No single cause.** Multimodality is specific but insensitive; alternation is sensitive but not
  sufficient; neither is mechanism enough to act on.
- **What is established and unchanged:** the anchor rather than the foot detector is the failure
  (§2-RESULT-III); PAT is recoverable on 2 of 29 nights at 28.1/36.8 ms and 4.5–5.7 ms beat-to-beat
  (§2-RESULT-IV); and the identifiability gate itself is objective and threshold-free.
- **What would settle it:** the mode structure and the alternation ratio are both *symptoms* measured on
  the PPI series. The cause is inside the optical beat detector, and finding it needs the **waveform**
  — which beat is being picked, and what the detector saw on the beats where it picked differently.
  That is a `ppgdex-dsp` investigation, not a fusion one, and it is where this should go next.

## 2-RESULT-VIII · 🔴 ERROR FOUND IN MY OWN HARNESS — the identifiable count was 5, it is 11

A deliberate audit of the analysis code (not of its conclusions) found a real bug, and it changes the
headline of §2-RESULT-IV–VII. **Every count in those sections derived from a broken lag search.**

### The bug

`ncc(RR, PPI, lag)` searched **non-negative lags only** — `for (k = 0; k <= 40; …)`, with the function
itself returning `null` for `lag < 0`. A negative lag means the **PPG train leads the ECG**, which
happens whenever the optical detector emits an extra beat early in the overlap. Those nights could not
be aligned at any lag the search examined, so they were scored unidentifiable **by construction**.

**20 of 29 nights have a negative best lag.** The search was blind to two thirds of the corpus.

### What it changes

| | buggy (lag ≥ 0) | corrected (symmetric) |
|---|---|---|
| **identifiable (margin ≥ 0.05)** | **5 / 29** | **11 / 29** |
| PAT SD on those nights | 28.1–36.8 ms | median **38.5 ms**, best **13.3 ms** |

Individual nights moved substantially — `2026-07-08` ncc **0.8003 → 0.9976**; `2026-06-20 22:55`
**0.5876 → 0.8750** with **PAT SD 13.3 ms**, the tightest in the corpus, previously scored a failure.

**So "PAT is recoverable on 2 of 29 nights (7 %)" is WRONG. It is 11 of 29 (38 %)**, and the "93 % of
nights fail" framing in §2-RESULT-V must be read as ~62 %.

### What SURVIVES the correction — and this is the useful part

The structural conclusions were computed against the identifiability split, so all of them were at risk.
Recomputed on the corrected split, they are **unchanged**:

| | buggy split | corrected split |
|---|---|---|
| `corr(altPPG, ncc)` | −0.662 | **−0.670** |
| multimodal nights identifiable | 0 / 8 | **0 / 8** |
| unimodal nights identifiable | 5 / 21 | 11 / 21 |

- **Unimodality is NECESSARY, now perfectly:** every one of the 11 identifiable nights is unimodal
  (**11/11**), and no multimodal night is identifiable (**0/8**), on *both* splits. §2-RESULT-VII's
  "sufficient but not necessary" was the right shape and the wrong direction — it is **necessary but not
  sufficient**: 10 of 21 unimodal nights still fail.
- **The alternation correlation is unmoved** (−0.662 → −0.670), so §2-RESULT-V's graded relationship
  stands, still as a screen rather than a mechanism.
- **The tolerance sweep (§2-RESULT-III) is unaffected** — it never used the lag search.
- **The combined gate now has perfect specificity**: `modes ≤ 1 AND altPPG < 1.25` passes **7/11**
  identifiable and **0/18** unidentifiable. Still fitted post hoc; still not for adoption from here.

### Why this one was findable and the earlier six were not

The six previous corrections were all **sampling** errors — a handful of nights implying more than the
corpus supported. This is a **code** error, and it has the opposite signature: it was invisible in every
individual result and visible only in the harness. Reading the analysis code as an artifact in its own
right, rather than re-reading the conclusions, is what surfaced it — and it is the check that should have
run before the first corpus batch, not after seven sections of interpretation.

## 2-RESULT-IX · SECOND ERROR PASS, and WHERE TO FIX PAT — it is the clock, not the detector

### Three further harness errors, found by auditing the code rather than the conclusions

| # | error | impact |
|---|---|---|
| 3 | `acf` computed on `tight` (PAT filtered to \|v−med\|<300 ms) — removing outliers smooths a series and inflates autocorrelation | **none on the claim**: identifiable nights had 100 % retention, so filtered ≡ raw (0.987 both). One night moved 0.992 → 0.896 |
| 4 | mode detection used the nearest **preceding** R — directional, truncates at 0 and wraps at one RR, so it can *manufacture* modes | 4 of 29 mode counts changed; **conclusion unchanged** — identifiable nights are 11/11 unimodal, 0/11 multimodal on both versions |
| 5 | **beat times rebuilt on a synthetic uniform grid** at the mean rate, discarding the real per-sample stamps | **large.** The uniform grid drifts up to **106.5 ms** across a 40-min ECG slice. Fixed: PAT SD **28.1 → 16.7 ms** and **13.3 → 10.9 ms** on the two best nights; identifiability unaffected (interval differences cancel drift) |

**Beat-to-beat PAT precision is therefore ~2.7 ms**, not the 4.5 ms reported in §2-RESULT-IV.

### Where to fix PAT — four candidates eliminated by measurement, one confirmed

| candidate | test | verdict |
|---|---|---|
| weak pulses / poor perfusion | corr(PAT deviation, amplitude / upslope / rise) | **REFUTED** — r = 0.02–0.22, inconsistent sign; on 4 of 5 nights *low*-amplitude beats deviate *less* |
| wrong LED channel / consensus | PAT SD computed per channel | **REFUTED** — all three identical (46/46/46, 264/263/266, 299/300/300) |
| missing or spurious beats | monotone correspondence at ±600 ms | **REFUTED** — 97.7 % correspond one-to-one |
| fiducial-feature switching | mode count | **partial** — explains 7 of 18 failures; 11 unimodal nights still fail |
| **inter-device clock drift** | linear fit of PAT against elapsed time | ✅ **CONFIRMED on identifiable nights** |

    2026-07-09   PAT SD 16.7 -> 5.5 ms detrended,  89.0 % of variance,  20.7 ppm
    2026-06-20   PAT SD 10.9 -> 8.2 ms detrended,  43.1 % of variance,   9.5 ppm

**~20 ppm is exactly a crystal difference between two independent devices**, and 20 ppm over a 2500 s
window is 50 ms — the observed magnitude. Remove it and **PAT resolves to 5.5 ms**.

⚠️ On failing nights the same fit returns **902 ppm and 11 010 ppm**. 1.1 % is not a crystal; there the
linear term is absorbing something else (a step, or a wrap), so **drift does not explain the failures** —
only the residual scatter on nights that already align.

### The recommendation, and the trap in it

**Look at the clock, not the optical detector.** Every detector-side hypothesis this investigation raised
— fiducial precision (§4a), fiducial choice (§4b), admission gating (§4c), channel selection, pulse
quality — has now been measured and eliminated. The remaining term on good nights is a crystal-scale
drift between the H10 and the Verity.

⚠️ **But do NOT fit it out of PAT.** That is circular: a linear PAT trend is exactly what a slow
physiological drift also looks like, and this brief has spent seven sections learning what fitting an
unvalidated model costs. The drift must be measured **independently of PAT**.

**That is what `DexClock.hostAxis` exists for — and it cannot run on this corpus.** `Ecg nightly/` is
phone-captured: `independent = false`, `spreadMs` 0.13–1.00, the host column is the device stamp
*rounded*, so there is no second clock to discipline against. **Every night analysed in §2-RESULT-III–IX
is one where the correction that would fix PAT is structurally unavailable.**

**So the next step is a corpus change, not a code change:** re-run this whole analysis on **box
captures**, where `independent = true` and `hostAxis` can measure the inter-device drift without touching
PAT. The prediction is specific and falsifiable — if drift is the cause, box nights should show
materially higher identifiability and PAT SD near 5 ms *without* detrending. ⚠️ Three box segments tested
in §2-RESULT-VI did **not** align, but they were 888–1465-beat fragments from a night with 22 ECG and 7
PPG files; that is not a fair test of the hypothesis and should not be read as one.

## 2-RESULT-X · THE REPO ALREADY HAD THE FIX — per-block offset + RR unwrap, implemented and measured

§2-RESULT-IX concluded "look at the clock, not the detector" and recommended a corpus change. **Before
proposing new work, the existing briefs were checked — and the method already exists, is validated, and
this investigation rediscovered its premise from scratch.**

`CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01` §1 states it outright: *"Body-worn devices drift relative to
each other by tens to hundreds of ppm — enough to walk past a whole heartbeat inside one night. Every
cross-node measurement that fits a **single** offset per night is therefore measuring a moving target,
and reports the movement as noise, as poor coupling, or as a physiological limit."* Its §2.4 is a control
titled *"the drift is in the CLOCKS, not in the beat detection"*; its §2.1 is *"beat correspondence is
high once drift is removed"*.

**That brief lists three prior independent arrivals at the same finding, two of them via self-retraction.
§2-RESULT-III–IX is the fourth.** Recorded plainly: the conclusion is corroborated, not novel, and the
cost of not reading it first was several sections of rediscovery.

### The step this investigation was missing

§2.2: *"As the true offset drifts past a tooth boundary, the argmax falls back exactly one RR… Fitting a
slope through that measures the sawtooth, not the clock. **Unwrap by whole RRs first.**"* Every offset in
§2-RESULT-III–IX was **one modal offset per night** — exactly the "moving target" §1 warns about.

### Implemented: per-block (5 min) modal offset, unwrapped by whole RRs

| night | measured drift | offset range | PAT SD global → per-block | beats recovered |
|---|---|---|---|---|
| 2026-07-09 | **5.4 ppm** | 65 ms | 41.0 → 41.3 | 2305 → 2316 |
| 2026-06-10 | **276.5 ppm** | 561 ms | 176.8 → **109.0** | 1785 → **2258** |
| 2026-07-13 | **178.8 ppm** | 435 ms | 149.8 → **98.6** | 1819 → **2091** |
| 2026-07-04 | **−305.6 ppm** | 1312 ms | 181.6 → **157.9** | 842 → **1476** |
| 2026-06-29 | 107.7 ppm | 233 ms | 114.2 → 106.8 | 2360 → 2380 |

**It works, and it also measures the thing.** The drift is **5–306 ppm**, and the offset walks **65–1312 ms**
across a night — §1's "tens to hundreds of ppm" confirmed on this corpus. PAT SD falls 13–38 % and up to
**75 % more beats** are recovered on the worst nights.

**And it explains the identifiability split directly:** the night that worked all along carries **5.4 ppm**;
every night that failed carries **100–300 ppm**. Identifiability was never a property of the PPG detector
— it was whether that night's two crystals happened to agree.

### What it does NOT fix, and the honest next step

Shorter blocks do not help — 120 s is marginally better, 60 s worse, 30 s fails outright (too few beats
per block to find a modal offset). Per-block refitting **saturates at 38–157 ms**, far from the **5.5 ms**
reachable on a clean night.

The reason is visible in the one directly comparable number: on 2026-07-09 per-block gives **41.3 ms**
while interval-anchoring (§2-RESULT-IV) gives **16.7 ms**. **The two methods fix different halves.**
Per-block tracks the drift but still pairs by nearest-match inside a ±300 ms window, which admits wrong
partners; interval-anchoring gets exact beat correspondence but assumes a single constant lag, which the
drift destroys.

**Neither brief combines them, and the combination is the obvious next build:** per-block offset to track
the drift, then **interval-sequence anchoring within each block** for exact correspondence. That is a
concrete, testable proposal — and it is deliberately left unbuilt here rather than rushed, because this
investigation has already recorded eight corrections, five of them from moving faster than the evidence.

⚠️ **Do not reach for the three-corner closure to replace the missing host clock.** `CLOCK-CLOSURE-THREE-SOURCE`
is DONE but carries a ⛔ VOID banner: the third corner was the O2Ring, whose `sensor timestamp` is
**drawn, not measured** — built as `sample_index × an assumed rate` — so its apparent ppm is the error in
that constant. There is no free third clock in this corpus.

## 2-RESULT-XI · THE COMBINATION, BUILT — it recovers BEATS, not PRECISION

§2-RESULT-X named the obvious next build: per-block offset to track the drift, then exact one-to-one
correspondence *within* each block. Built and run on all 29 nights — 5-min blocks, modal offset unwrapped
by whole RRs, then a monotone DP assignment inside each block with the window centred on that block's own
offset.

| | single global offset (§4g) | **per-block + unwrap + monotone** |
|---|---|---|
| correspondence | 68.6 % | **79.4 %** (≥75 % on **20/29** nights) |
| PAT SD | 71.71 ms | **67.5 ms** |
| acf₁ | +0.772 | +0.694 |

### 🔴 A 5-night table said 40–60 %. The corpus says 6 %. The error was mine, and it was a strawman baseline.

The per-night comparison in the working notes showed 176.8 → 71.4 ms and 181.6 → 80.2 ms and read as a
halving. **Those baselines came from a different, weaker method** — `perblock.mjs`'s global fallback,
which pairs by *nearest-match within ±300 ms*. §4g's actual baseline is a **monotone assignment at
±150 ms, 71.71 ms**. Compared like for like, the combination improves PAT SD by **6 %**, not 40–60 %.

**Comparing a new method against a weaker variant of itself, rather than against the standing result, is
the same class of error as every tolerance-conditional number this brief has had to correct** — and it is
the seventh time here that a handful of nights implied more than the corpus supports.

### What the combination is actually worth

- ✅ **Coverage: real and useful.** Correspondence 68.6 % → **79.4 %**, and ≥75 % on 20 of 29 nights
  against 3 of 29 at ±150 ms globally. Drift tracking is what recovers those beats, exactly as
  `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.1 predicts.
- ❌ **Precision: essentially unchanged.** 71.7 → 67.5 ms.

**That result is informative rather than disappointing: after per-block drift removal, ~67 ms of scatter
remains.** So inter-device drift explains the *correspondence* loss and **not** the residual scatter.
§2-RESULT-IX's "the clock is the cause" is therefore too broad — the clock is the cause of *beats not
matching*; something else is the cause of *matched beats scattering*.

### Where that leaves the cause

Still open, and now more sharply bounded. Eliminated by measurement: pulse amplitude, upstroke slope,
rise time, LED channel choice, missing/spurious beats, fiducial-feature switching (7 of 18 only), my own
uniform-grid timestamps, and now inter-device drift as an explanation of the residual. What survives on
the two cleanest nights — **16.7 ms falling to 5.5 ms after removing a 20 ppm trend** — says the
instrument reaches single-digit ms when the geometry cooperates, and nothing measured so far explains why
it usually does not.

## 2-RESULT-XII · THE WHOLE THREAD IN ONE TABLE — PAT SD is the WINDOW, and the repo said so first

Every PAT SD in §2-RESULT-III–XI came from a different pipeline. Run them all on the **same night, in one
harness**, so the comparison is finally like-for-like:

| pipeline | 2026-07-09 (n / SD) | 2026-06-10 (n / SD) |
|---|---|---|
| nearest ±50 ms | 2001 / **23.9** | 659 / **26.9** |
| nearest ±150 ms | 2277 / 33.6 | 1242 / 60.9 |
| nearest ±300 ms | 2305 / 41.0 | 1684 / 119.6 |
| nearest ±600 ms | 2316 / 46.0 | 2361 / **191.8** |
| monotone ±50…±600 | **identical to nearest at every tolerance** | **identical** |
| monotone ±150 + detrend | 2277 / 33.4 | 1242 / 58.7 |

**Spread on one night: 1.9× (good) and 7.1× (bad), from pipeline choice alone.**

### 🔴 Two of my own claims fall here

1. **Monotonicity does nothing.** §4g attributed a 37.57 → 71.71 ms change to replacing nearest-match with
   a monotone assignment, arguing nearest-match "pairs across slips". **The two agree exactly at every
   tolerance.** That change was entirely the tolerance moving ±80 → ±150. The monotone DP is a correct
   implementation of an irrelevant refinement.
2. **Detrending is not worth 89 %.** §2-RESULT-IX reported a 20.7 ppm fit removing 89 % of variance. Here
   the same operation moves 33.6 → 33.4 and 60.9 → 58.7. The 89 % applied to the *interval-anchored*
   series only, which is a different pairing — so it is a property of that pipeline, not of PAT.

### 🟢 And the repo's own prescribed test separates the nights cleanly

`pat-sd-is-the-window` says: *"before quoting a PAT scatter, divide by w/√12 for whatever window produced
it — a ratio near 1.00 means the window was measured, not the subject."* Applied across the sweep:

| window | w/√12 | 2026-07-09 ratio | 2026-06-10 ratio |
|---|---|---|---|
| ±50 ms | 28.9 | 0.83 | 0.93 |
| ±150 ms | 86.6 | 0.39 | 0.70 |
| ±300 ms | 173.2 | 0.24 | 0.69 |
| ±600 ms | 346.4 | **0.13** | **0.55** |

**The TRAJECTORY is the test.** Widen the window and a real measurement pulls away from `w/√12`
(0.83 → 0.13); a non-measurement tracks it (0.93 → 0.55). That single curve separates the two nights more
cleanly than the RR↔PPI margin of §2-RESULT-IV, **and it needs no interval alignment, no unwrapping, and
no second device** — only the PAT series and the window that produced it.

**It should replace the identifiability gate proposed in §2-RESULT-IV.** Simpler, assumption-free, and
already written down in this repo before this investigation started.

### The standing lesson

Nine corrections are recorded across §2-RESULT-III–XII. Seven were **sampling** (a handful of nights
promising more than the corpus delivered), one was a **code** error (the asymmetric lag search), and one
was a **baseline** error (comparing a new method against a weaker variant of itself). None was an
estimator that computed the wrong thing. **Every single one was an inference drawn faster than the
measurement supported it** — and the two cheapest guards against all nine were already in the repo: run
the corpus first, and read the existing brief before building.

## 3 · Phase 1 — promote the coupler into the Integrator (consume EXPORTS, add the missing one)

- **Move the timing engine** `coupledPAT`/`ecgRpeakTimes`/`ppgFootTimes`/`sharedClock` from
  `pat-feasibility.js` into an `integrator-dsp.js` PAT stage. The Integrator fuses on the shared wall-clock;
  this adds a **beat-level** stage beside its event/scalar fusion.
- **Feed it from node exports, not private calls.** Today ECGDex's `ganglior_events` carry only
  `autonomic_surge` — the **per-beat R-peak series is computed (`ECGDSP.detectPeaks`) but not exported**. Add an
  **R-peak time series to the ECGDex node-export** (additive field; the `{tsMs, rr}` `deviceRR` stream already
  exists internally at `ecgdex-dsp.js:373` — surface it). PpgDex feet come from the wrist site today and the
  **finger site** via [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md)
  (its prerequisite). All three nodes already emit absolute floating `tMs` (contract in `dex-contracts.js`).

## 4 · Phase 2 — dual-site PAT (the differentiator) + what may and may NOT be surfaced

- **Single-site PAT** = foot − R-peak, per site. **PAT = PEP + PTT** — it carries the pre-ejection-period, a
  BP-independent confound.
- **Dual-site PAT** = (H10→finger) − (H10→wrist): the **shared PEP cancels**, leaving a cleaner **peripheral
  pulse-transit** term. This is the two-site advantage the O2Ring finger site newly makes possible.
- **Surface a Vascular *trend* only — NEVER an absolute BP number.** Evidence tier **experimental**
  (trend), and BP explicitly **out of scope** at any tier without a per-subject cuff calibration: the largest
  validation (n=3077) shows cuffless SBP **degrades badly in older/hypertensive users** and calibration-free is
  not ready (Liu 2023). A relative overnight PAT/stiffness trend is defensible; a mmHg readout is fabricated
  authority (`LITERATURE-USE-POLICY` — no badge upgrade on "the literature says").

## 5 · Phase 3 — validate on the tri-device corpus + surface

- **Corpus:** the real **20-night O2Ring + H10 + Verity** set (`CLAUDE.md` §🎙️) is the ground truth — check the
  promoted engine's per-night drift/coupling against Phase-0 numbers before any surfaced metric.
- **Surface:** an Integrator **Vascular (trend)** panel — nightly PAT/dual-PAT trend + a stiffness-trend proxy,
  every number badged **experimental**, with the drift/coupling QC shown (a night that fails the gate shows
  **no** vascular metric, not a fabricated one).
- **Gates:** Integrator is an **owned** bundle (`tools/build.mjs --check` covers it); if the ECGDex export
  changes, **re-bundle ECGDex** → **GATE A/B**, its equiv leg regenerated by re-running the app (never
  hand-edited), **`Dex-Test-Suite.html?full`** green, **changeset** (`bump: minor` — additive export field +
  new fusion stage; no contract break).

## 6 · Method sources (literature — attribution mandatory, `LITERATURE-USE-POLICY`)

Used as **method/priors**, cited; none is networked into a bundle; none upgrades a badge to `validated`.
- PAT/PTT→BP needs per-subject calibration; PPG-intensity-ratio adds value — *Ding et al. 2017, Scientific Reports*; *Ganti et al. 2020, IEEE JBHI (SeismoWatch)*.
- Dual-PPG / 2PPG cuffless design (two peripheral sites) — *Wong et al. 2024, Comput. Methods Programs Biomed.*
- Calibration-free cuffless BP degrades in older/hypertensive at scale (n=3077) — *Liu et al. 2023, IEEE JBHI*.
- PPG morphology → vascular age / arterial stiffness (single-signal indices) — *Charlton et al. 2021, Am. J. Physiol. Heart Circ. (VascAgeNet review)*; *Pilt et al. 2014, Physiol. Meas.*
- (DOIs to be filled at author time from the citation — do not fabricate; attribution + journal + year stand.)

## 7 · Done when

Phase 0 re-run on a single-host Tepna night is recorded (pass **or** documented no-go with the drift number);
**if pass** — the coupler runs inside the Integrator off node exports (ECGDex R-peak series added), dual-site
PAT computes and its PEP-cancellation is demonstrated, a Vascular **trend** panel surfaces **experimental**-
badged with QC gating (no metric on a failed night, no BP number ever), corpus-checked, bundles re-built with
GATE A/B + full suite green + changeset. Then flip this header `DONE` and spawn `-FOLLOWUPS`. **If no-go** —
park PROPOSED with the number inline.

**OUTCOME: no-go, parked.** The `POLAR-SDK-CAPTURE` routing this line originally prescribed is **withdrawn,
not pending** — it has effectively already been run. The single-host path sets both device clocks from a host
held to **0.008 ppm** against a local stratum-1 and re-anchors every ~3.0 min fragment, capping accumulated
inter-device drift at **8.6 ms even granting the 47.7 ppm premise** — and coupling is still 18.8 % vs 19.0 %
(§2-RESULT-II.3 item 4). The clock term is both measured small (~1.5 ppm, item 1) *and* structurally bounded,
and PAT does not couple either way. Reviving the brief requires the beat-correspondence audit of
§2-RESULT-II.4, not a capture change.

---

## Cross-references
- [`PAT-FEASIBILITY-2026-07-08-BRIEF.md`](PAT-FEASIBILITY-2026-07-08-BRIEF.md) — the DONE feasibility this promotes; its go/no-go bar + instrument are reused verbatim.
- [`PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md`](PPGDEX-O2RING-FINGER-SITE-2026-07-18-BRIEF.md) — **prerequisite**: produces the finger foot-stream the dual-site leg consumes.
- [`O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md`](O2RING-LIVE-PPG-WAVEFORM-2026-07-17-BRIEF.md) — captures the finger pleth (host-arrival back-timing — the jitter caveat's source).
- [`POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md`](POLAR-SDK-CAPTURE-2026-07-07-BRIEF.md) — the SDK-synchronised-timestamp fallback if Phase 0 fails the drift bar.
- [`MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md`](MULTI-SENSOR-DERIVATIONS-2026-07-16-BRIEF.md) — routes PAT here; [`LITERATURE-USE-POLICY-2026-07-11-BRIEF.md`](LITERATURE-USE-POLICY-2026-07-11-BRIEF.md) — the attribution/tier rules.
- `ECGDex-BUILD-BRIEF.md` §6 (vascular-metric verdicts) · `INTEGRATOR-BUILD-BRIEF.md` · `CLAUDE.md` §🔒 Clock Contract · §🎫 badges · §🧪/§🔏 gates.
- Code: `pat-feasibility.js` / `pat-feasibility-worker.js` / `PAT Feasibility.html`; `integrator-dsp.js`; `ecgdex-dsp.js` (`detectPeaks`, `deviceRR`); `dex-contracts.js`.
