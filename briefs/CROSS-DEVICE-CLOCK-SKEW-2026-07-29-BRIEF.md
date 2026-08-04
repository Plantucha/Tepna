<!--
  CROSS-DEVICE-CLOCK-SKEW-2026-07-29-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 (every Done-when item is closed; the ONE residual — confirming the predicted ≈21 min post-correction offset on a third clean tri-device night, currently n=2 fitting −22.25/−21.13 min — is owned by `POOLED-CLOCK-FIT-2026-07-31-BRIEF.md` §4, not by this brief — **CLOSED 2026-08-04 at that brief's §4a: 2026-08-01 fits −22.13 min, Z 8.1, p 0.032, making it three nights at −21.9 ± 0.6**) · **Created:** 2026-07-29 · **Found while executing:** `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS-2026-07-29-BRIEF.md` §1.1 · **Affects:** Integrator fusion, `tools/cpap-oxy-couple.mjs`, every CPAP↔other-node event comparison · **Spawned:** `OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md`

# The CPAP's clock is ~39 minutes wrong, and nothing in the suite can tell

Every CPAP-to-other-node event comparison the Integrator has ever made was aligned against a clock
that is **about 39 minutes slow**. The fusion did not fail loudly — it found no overlap, which is
indistinguishable from *there was no overlap*.

> **⚠️ REFINED 2026-07-30 — see §2d before applying a number.** The clock offset proper is
> **38.28 min (2,297 s) ± 3–4 s**, not 39.5. The 39.5 figure below is *correct for desaturations* and
> stays as measured — but it is `clock + the oximeter's detection lag`, so applying it as a clock
> correction over-shifts by ~1.2 min. Which number you want depends on which event class you are
> aligning; §2d gives the ladder.

This is a **device/configuration fault, not a Tepna bug**. What *is* a Tepna gap is that the suite
cannot detect it: `runFusion` takes a `toleranceSec` (default **120 s**) and silently reports nothing
when a node sits 2,370 s away.

---

## 1 · The measurement

Found while asking a different question. `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §1.1 asked whether
OxyDex's periodic-breathing episodes land inside the device's CSR spans. Answer: **0 of 20**, on the
three nights that have both — but with a chance expectation of only ~1.1, that is *consistent with*
chance and proves nothing on its own. What did stand out was the offsets: on 2026-06-25 and
2026-07-08 the first PB episode landed **exactly +24 min** after the CSR span ended, on both nights.

That is either physiology or a clock, so it was tested against a pairing with a **known** lag.
Apnea → desaturation is one: circulation time makes it 10–40 **seconds**, never minutes. Cross-
correlating CPAP-scored apnea/hypopnea times (read straight from the `_EVE.edf` TALs — no DSP in the
path) against OxyDex desaturation events, scanned over ±60 min of lag:

| | coincidences (±60 s) |
|---|---|
| **best lag +2,370 s (39.5 min)** | **240** |
| lag 0 | 27 |
| mean over all lags (the random floor) | 38.7 |

**6.21× over floor at +39.5 min; lag 0 is *below* the floor.** 36 nights, 807 CPAP events, 536 desat
events.

### It is not a parse bug

Every `_EVE.edf` / `_CSL.edf` header start time was checked against the ResMed filename, which encodes
`YYYYMMDD_HHMMSS` independently. **They agree on every file.**

### It is not drift, and not an artifact of pooling

Estimated **per night**, independently — 27 of 32 nights land within ±5 min of the corpus peak, each
with its own 4.7×–23.5× peak-to-floor ratio:

```
median best lag  39.5 min      min −33.5      max 42.0      n = 32
within ±5 min of 39.5 : 27/32
```

Stable across seven weeks (2026-06-10 → 07-27). The five outliers are the low-count nights (2–11
coincidences at peak), where no lag dominates.

### It is the CPAP that is wrong, not the oximeter

Repeating the cross-correlation against a **second, independently captured** node — ECGDex's
`autonomic_surge` events, which reach the corpus through the capture host exactly as the O2Ring does:

| | coincidences |
|---|---|
| **best lag +2,280 s (38.0 min)** | **384** |
| lag 0 | 93 |
| floor | 89.8 |

**4.28× over floor at +38.0 min**, and again nothing at zero. Two separately host-captured devices
both place the CPAP ~38–40 min behind. The three host-captured signals agree with each other by
construction — `trio-batch` requires a three-way *overlap* to accept a night at all, and it accepts
37 of them. So the outlier is the one device with its own user-set clock.

39 minutes is not a timezone (no zone is offset by 39 min) and it does not grow over seven weeks, so
it reads as a clock that was **set approximately once and never corrected**.

---

## 2 · What it breaks

- **Integrator fusion.** `integrator-dsp.js:3320` — `dtMs = (opts.toleranceSec ?? 120) * 1000`. A node
  2,370 s away never falls inside a 120 s window, so **no CPAP event has ever co-occurred with any
  other node's event** in this corpus. Everything downstream of that — `alsoObservedBy`, the apnea
  confirmation path, the redundancy accounting `INTEGRATOR-FUSION-ISSUES` §3.1 exists to protect —
  has been operating on an empty intersection.
- **`tools/cpap-oxy-couple.mjs`** is a CPAP↔oximetry coupling analysis built directly on this
  alignment.
- **`MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §1.1 is void as measured** and must be re-run with the
  offset removed before anything is concluded about the two PB detectors. The 0/20 result was
  measuring the clock, not the detectors.
- **Not affected:** anything per-night and aggregate. The AHI-vs-hypoxic-burden decorrelation
  (§1.2, `r = 0.06`) compares night totals, not event times, and stands.

---

## 2b · ROOT CAUSE, part-identified — 2026-07-29 (owner)

The AirSense 11 exposes **no time-of-day setting** in the accessible menus. It does expose a
**timezone**, and it was set to **GMT−5** for a device in **Asheville**. In late July Asheville is on
EDT = **GMT−4**, so the machine was running **exactly 60 min behind** local civil time. The owner
changed it to GMT−4 on 2026-07-29.

**That accounts for most, but not all, of the measured offset — and the residual is the interesting
part.** The corpus says **39 min** (per-night range 37.5–40.0, median 38.5), not 60. So:

```
   60 min   timezone error (GMT−5 where GMT−4 was correct)
 − 21 min   the machine's own clock running FAST
 ─────────
   39 min   net, behind the host cluster        ← what was measured
```

The ~21 min residual is a genuine oscillator/setting error with no exposed control to correct it.

### The falsifiable prediction this makes

Correcting the timezone adds 60 min, so it should **not** zero the offset — it should **flip** it:
nights recorded after 2026-07-29 should read about **+21 min AHEAD** of the host cluster. If instead
they read ≈ 0, the 21 min inference is wrong and the whole offset was timezone, with a measurement
bias in §1 that would need explaining. **Either result is informative; the first night after the
change decides it.**

### Two consequences that change the design

**The corpus now contains a STEP CHANGE.** Nights up to 2026-07-29 sit at −39 min; nights after sit
somewhere else. Any pooled per-device offset must therefore detect a **step**, not assume a constant
and not average across the discontinuity — §3.3's "carry a `clockOffsetSec` per source" is only safe
if it is versioned by date. The earlier framing ("alert if it drifts") was too weak: this is not
drift, it is a reconfiguration, and it happens instantly.

**This is a Clock Contract interaction, not just a bad oscillator.** The CPAP's EDF header carries
**local civil time with no zone**, which Tepna stores as floating wall-clock `tMs` (CLAUDE.md §🔒).
That is the right model — but it means a timezone change on the device shifts every subsequent
timestamp by a whole hour relative to every earlier one, with nothing in the file to say so. The
offset is a property of **device configuration**, not only of clock drift, and a device that travels
or crosses a DST boundary will step again. A detector that assumes "one device, one offset, slowly
varying" is wrong for this class. What is needed is an estimator that measures *when* as well as *how
much* — a per-moment offset rather than one number per night. **An anchor cross-correlation looked like
that estimator and is not; see §2c.**

---

## 2c · The movement-alignment route is NOT usable — proven by an ACC↔ACC control, 2026-07-29

**Why it was tried.** The coincidence estimator of §3.1 works but is not sensitive: tuned for zero
false positives it fires on **6 of 38** nights (median 38.5 min, range 37.5–40.0); loosened to catch 17
it produces 7 false positives. So a second, independent route was explored — align the CPAP's **own
flow signal** against a device on the precise host clock, reusing the anchor cross-correlation that
`pat-align.js` already provides (`PATAlign.alignByAnchors`, extracted for PAT). Flow disturbance vs H10
ACC came back essentially negative: **1 of 28 nights** near the known −39 min, against a chance
expectation of 2.8, with per-night anchor spreads covering the whole ±50 min search range.

**A negative result from an uncalibrated instrument is not evidence.** Before concluding that flow does
not track movement, the same code at the same parameters was run on a pair whose answer is **known**.

### The control

The capture host writes Polar **H10 chest** ACC and Polar **Verity arm** ACC through one daemon on one
clock, so their true offset is **0 by construction**. They are two different accelerometers at two
different body sites, correlated *only* through real body movement — structurally the same problem as
ACC↔flow, with a known answer. (ACC↔itself would only have tested the arithmetic.) 13 nights,
2026-07-16 → 07-28, 30–1313 min of overlap each.

Three legs, each carrying a decision:

| leg | parameters | result across 13 nights |
|---|---|---|
| **FINE @ true 0** | `PATAlign` DEFAULTS — 50 ms bins, ±1.6 s window, ±1.6 s search, minCorr 0.6 | **13/13** aligned, median offset **0.00 min**, anchor spread **0.1 min** |
| **COARSE @ true 0** | flow-vs-acc's — 250 ms bins, ±15 s window, **±50 min** search, minCorr 0.35 | 13/13 aligned, median **0.00 min**, but anchor spread **92.4 min** |
| **COARSE @ injected −39 min** | same, with a known −39 min shift planted in the Verity timeline | median **−20.11**; Δ vs @0 = **−14.31 min** where ±39 was planted — **recovered 1/13** |
| **COARSE @ injected +17.5 min** | same, +17.5 min planted | Δ vs @0 = **+12.58 min** — recovered 7/13 |

Scoring the injection as `recovered(I) − recovered(0)` makes it a pure self-consistency check that needs
no knowledge of the sign convention.

**FINE passes cleanly, COARSE cannot recover a planted offset.** So the two accelerometers genuinely do
share detectable movement events — 13/13 nights agree on an offset within ±1.6 s, exactly as one host
clock requires — while the wide-search parameterisation, on that *same data*, finds a −39 min offset on
1 night in 13 and attenuates the estimate to a third of its true size.

### The mechanism: the correlation gate is inoperative at these settings

Not a mystery. A ±50 min search at 250 ms bins evaluates **24,001 candidate lags**, while a ±15 s
window supplies only **121 bins** to correlate. For ~121 quasi-independent samples the sample
correlation has sd ≈ 1/√121 = 0.091, so the expected best-of-24,001 spurious correlation is
≈ 0.091·√(2 ln 24001) ≈ **0.41** — *above* the `minCorr` of **0.35** the wide search had to be lowered
to. Chance alone clears the gate, so the reported peak is noise by construction, and the median of that
noise is pulled toward the centre of the search range — which is why COARSE reports ≈ 0 whatever the
truth is, and why "median near 0" in the flow run was guaranteed by the method rather than measured.

| configuration | window bins | candidate lags | E[max spurious *r*] | minCorr | verdict |
|---|---|---|---|---|---|
| FINE (PATAlign defaults) | 65 | 65 | 0.358 | 0.60 | gate binds |
| COARSE, ±15 s window | 121 | 24,001 | **0.408** | **0.35** | **gate inoperative** |
| COARSE, ±60 s window | 481 | 24,001 | 0.205 | 0.35 | gate binds |
| COARSE, ±240 s window | 1,921 | 24,001 | 0.102 | 0.35 | gate binds |

The prediction that follows — lengthen the window and recovery should improve — was tested, and it does,
**monotonically**:

| correlation window | Δ recovered (−39 min planted) | nights recovered |
|---|---|---|
| ±15 s (as flown) | −14.31 min | 1/13 |
| ±60 s | −27.29 min | 3/13 |
| ±240 s | −31.35 min | 6/13 |

That dose-response is what turns this from "it failed" into a diagnosis. But note the endpoint: even an
**8-minute** correlation window still under-recovers (−31.4 of −39) on 6 of 13 nights — and a window
that long has stopped being an *anchor* at all, since it no longer isolates a single movement. The
approach does not converge on this problem.

### Verdict

1. **The flow-vs-movement negative is VOID.** It cannot distinguish "flow disturbance does not track
   body movement" from "this method cannot find a 39-minute offset". The underlying question is still
   open — but it was never answered, and the earlier 1/28 must not be cited as if it were.
2. **Anchor cross-correlation is the wrong tool for a wide-range clock search,** regardless of signal.
   It was built for PAT, where the search is ±1.6 s and the gate binds; stretching the range by four
   orders of magnitude while shortening nothing breaks it. Do not reuse it for this.
3. **The coincidence-histogram estimator of §3.1 is the right tool and its 6.21× peak stands.** It is
   immune to exactly this failure because it pools *every* event over the *whole night* at each candidate
   lag instead of correlating one short snippet, so its effective sample size grows with the recording
   rather than staying at 121 bins. Improving sensitivity beyond 6/38 should come from that direction —
   more event classes fed into the same histogram — not from a second alignment method.

### Incidental: the capture host changed its ACC schema mid-corpus

Through 2026-07-18 the host wrote `Phone timestamp;sensor timestamp [ns];timestamp [ms];X;Y;Z`; from
2026-07-21 the relative `timestamp [ms]` column is **gone** (5 columns). A positionally-indexed parser
yields **zero rows** on the newer layout — silently, since every line simply fails the field test. This
cost the first run of this control 11 of its 13 nights.
**No shipped code is affected:** `PPGDSP.parseSensorXYZ` is header-driven with a last-three-numeric-columns
fallback and its comment already names both layouts. The note is for anyone writing an ad-hoc parser:
read these columns from the header, and derive the per-row offset from the `sensor timestamp [ns]`
delta, which is present in both layouts and equals the retired `timestamp [ms]` column to all printed
digits.

---

## 2d · The offset is 38.28 min, and 39.5 was never the clock — 2026-07-30

§2c closed with: *"Improving sensitivity beyond 6/38 should come from that direction — more event
classes fed into the same histogram — not from a second alignment method."* That is what was done, and
it changed the answer.

**Eight channels across three devices and five independent mechanisms** were fed into §3.1's histogram
— O2Ring desaturation, ECGDex `autonomic_surge` and `movement_onset`, PpgDex `motion_artifact_segment`
and `movement_onset`, H10 ACC, Verity ACC/GYRO/MAG — and the per-pair lag distribution refined by its
**delta mode** rather than its argmax.

### The latency ladder — the finding that reframes §1

The channels do not agree, and their disagreement is *ordered by physiology*:

| responder | mechanism | best lag |
|---|---|---|
| body movement | mechanical, ~immediate | **37.5 min** |
| autonomic surge / optical artifact | sympathetic response, seconds | **38.0 min** |
| H10 `_RR` tachycardia | chronotropic response | **38.12 min** |
| SpO₂ desaturation | circulation + oximeter averaging | **39.5 min** |

That spread is not noise — it is **detection latency**, and it runs in the direction physiology
predicts. §1's 39.5 min is therefore a perfectly good measurement *of desaturation timing*; it is
simply `clock + ~1.2 min of oximeter lag`. The clock itself sits at the fast end where the mechanical
responders cluster: **38.28 min (2,297 s), ± 3–4 s**.

This also explains §1's own internal gap, which the brief noted without resolving: desat gave 39.5 and
ECGDex `autonomic_surge` gave 38.0. Those were never in conflict. They are two rungs of this ladder.

> **AMENDED 2026-07-31 — the ladder tells only half the story about desaturation.** Read on its own,
> the table above frames desat as the *laggiest, least useful* channel: last rung, +1.2 min of oximeter
> lag. It is also, by a wide margin, the **highest-SNR** channel in the set — `peakOverFloor` **6.75 /
> 9.34 / 9.63 / 18.9** on the nights examined, against **3.3–5.7** for every movement channel. Both
> facts are true and they pull in opposite directions: desaturation is the worst channel for *pinning
> the instant* and the best one for *establishing that there is an instant to pin*.
>
> That combination is exactly what the cluster vote handled worst, since it ranked on node count and so
> could be outvoted by three low-SNR movement channels — see the retraction above. It is also why the
> replacement pools rather than selects: a channel does not have to be the sharpest to contribute, and
> the sharpest channel does not get to win alone.
>
> **The ladder's own ordering is now in doubt**, independently of the clock work. Measured DIRECTLY as a
> pair — surge events as anchor, movement onsets as partner, 1 s grid, ±10 s window, 992 paired events
> over 30 nights — `autonomic_surge` → `PpgDex/movement_onset` is significant on **29 of 30 nights**
> (median Z 11.3) but its latency is **bimodal**: +12 s on 22 nights, −22 s on 7, with a pronounced
> depletion at simultaneity (**10 of 992 deltas fall within ±5 s**). The ladder puts movement 30 s
> *ahead* of the surge; the direct measurement says the two are coupled at a latency that changes sign.
> The ladder was inferred from separate CPAP fits under the now-deprecated estimator, so it is the
> weaker evidence of the two. See `POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md` §1 — unresolved, and
> deliberately not resolved by guessing.
>
> **RESOLVED 2026-08-01 — the bimodality was the FIDUCIAL, not physiology, and the ladder's autonomic
> rung is off by one CVHR half-cycle.** `autonomic_surge` stamps the **bradycardia trough** that opens
> a cyclic-variation cycle; the tachycardic rebound the event is named for occurs `periodSec` later
> (median 20 s, IQR 17–28). `detectCVHR` computes both — the trough at `s`, the rebound at `pkAt` — and
> stamps `s`. Nothing said so. Re-measuring the same 30 nights against trough + `periodSec`:
>
> | surge stamped at | shape | deltas within ±5 s |
> |---|---|---|
> | bradycardia trough (as shipped) | bimodal +10 s / −20 s, hole at simultaneity | **10 of 992 · 1.0 %** |
> | rebound peak (`+periodSec`) | **single mode** | **330 of 915 · 36.1 %** |
>
> A 36× improvement in coincidence, and the depletion at zero disappears — it existed because under
> the trough stamp the true partner is *never* near zero, so nearest-neighbour matching kept picking
> the neighbouring movement instead. §1's three rejected hypotheses were all rejected correctly; the
> mechanism was a fourth nobody had, because the stamp's meaning was undocumented.
>
> **What this does and does not settle.** The two channels are coupled at a single latency, not one
> that changes sign — so the ladder is not contradicted by a bimodal measurement any more. It IS still
> contradicted on ordering: measured from the rebound, the surge and the movement are near-simultaneous
> (mode at −5 s), where the ladder puts movement 30 s ahead. **The ladder is still not rewritten**, for
> the reason §2 of the follow-up gives: it was inferred under a deprecated estimator, and replacing one
> asserted ordering with another measured on one fiducial pair would repeat the original mistake. What
> has changed is that the *obstacle* to measuring it is gone.
>
> `meta.peakTMs` now publishes the rebound instant alongside the trough stamp (`tMs` unchanged — it is
> a published contract, and the trough is the correct CVHR convention). Any latency quoted against this
> channel must now say which instant it used.

### Per-night, and why the corroboration flag is the whole story

Sensitivity went from §2c's *"6 of 38"* to **7 of 14 nights corroborated by ≥2 distinct devices**,
spanning **37.75–38.45 min** with a median inter-sensor agreement of **39 s**. On 2026-07-26 four
channels from two devices landed at 38.28 / 38.28 / 38.00 / 38.10 — **38.20 min, agreeing within 17 s**.

> ### ⛔ RETRACTED 2026-07-31 — the corroboration rule below is FALSE
>
> The paragraph that follows claimed *"every corroborated night is in the band, and every wrong night
> is uncorroborated… consuming only corroborated fits is 7/7 correct."* Re-run over **31 nights**
> instead of 14 (`POOLED-CLOCK-FIT-2026-07-31-BRIEF.md` §2), that does not hold: **2026-06-15 reports
> 1.53 min while flagged `confident`**, corroborated by two distinct nodes. Three weak channels
> (`peakOverFloor` 3.40 / 4.38 / 4.46) outvoted one strong one (`OxyDex/desat_event`, peak **6.75**, CI
> 22 s wide, saying 40.23) — because the cluster vote ranks on **distinct-node count** and never reads
> the evidence strength it computed. The same pattern loses 2026-06-25 (desat peak 9.34 → 40.22, vote
> 27.10) and 2026-07-02 (desat peak 9.63 → 39.70, vote 31.98).
>
> `n=14` was simply too small to contain the counterexample. **A node count is not a strength measure**
> — that is the whole lesson, and it is why the replacement estimator calibrates each night against its
> own shuffled null instead of counting devices. `fitClockOffset` is deprecated in favour of
> `fitClockOffsetPooled`, which puts **29/29** pre-correction nights in the band against **22/25**.

The agreement between unrelated mechanisms recorded above is real, and remains the reason to believe
the ~38 min figure. What does *not* follow from it is the retracted inference — that the corroboration
flag separates right from wrong. The fit is still reported and never silently applied; the Integrator
UI and `trio-batch` now print the pooled Z against that night's own null instead of a node count.

A large part of that gain was not method at all: `trio-batch` had been feeding PpgDex **one fragment**
of each night's inertial data (`l[0]`), discarding 99 % of it, so the Verity's three inertial channels
were computed from roughly the first two minutes of each night. Fixed in the same day's work.

### What this does NOT settle

- **The post-correction offset is still UNKNOWN.** §2b's prediction — that the offset should flip to
  ≈ +21 min ahead rather than fall to 0 — remains untested; it needs one clean tri-device night after
  the timezone change.
- **H10 `_RR` tachycardia is measured but not wired** as an impulse. It is the earliest cardiac
  responder at 38.12 and would add a third device to nights that currently have two.
- **OxyDex has no `movement_onset`.** It is the third device on nights where the Verity is absent, and
  wiring it must respect `motionColumnStuck` (the per-source stuck-column fault).

---

## 3 · What to do

The device fault and the blindness are separate problems and want separate fixes.

### 3.1 · Detect it — the part that is Tepna's job

A fusion that finds **zero** overlap between two nodes that each reported plenty of events has learned
something, and currently discards it. Proposed: estimate the cross-node lag that maximises
co-occurrence, and when the best lag is far outside the tolerance while the peak clearly beats the
floor, **say so** — `clockSkewSuspected: { nodes: ['CPAPDex','OxyDex'], lagSec: 2370, peakOverFloor: 6.2 }`
— rather than reporting a quiet nothing. The estimator is ~30 lines and already prototyped in this
brief's measurement.

This is the same discipline as `MULTINIGHT-CORPUS-FINDINGS` §3 (a stuck motion column is a fault, not
a still night) and §2 (a shape violation is not low coverage): **a silent zero is the thing to catch.**

### 3.2 · Do NOT auto-correct

Tempting and wrong. An inferred offset applied silently would make the fusion look right while
resting on an estimate, and it would mask the real fix (set the machine's clock). Detect, report,
refuse to fuse across a suspected skew — the same fail-closed shape `DEEP-AUDIT-FOLLOWUPS` §C2 just
took for mismatched REM denominators.

### 3.3 · Fix the device, then re-measure

Set the AirSense clock against a reference and record the correction. Every night already on the card
keeps its skew, so a corpus-wide `clockOffsetSec` per source may be worth carrying in
`CPAP-AUTOHARVEST`'s harvest metadata — but as a **recorded observation**, never as a silent
adjustment.

### 3.4 · Then re-run §1.1

With the offset applied explicitly, ask again whether OxyDex's PB episodes and the device's CSR spans
describe the same physiology. That question is still open and still matters: OxyDex tells the user
"CS pattern likely — review CPAP pressure" on 28 of 37 nights while the machine scores CSR on 4.

---

## 4 · Done when

- [x] **DONE** — `detectClockSkew` + `estimateEventLag` ship in `integrator-dsp.js`; `runFusion`
      always emits a `clockSkew` block (checked-and-clean ≠ never checked) carrying `node`,
      `offsetSec`, `peakOverFloor` and `againstNodes`.
- [x] **DONE, with the second half INVERTED by a later decision — see §5.** The planted-offset gate
      exists (2370 s → the skew is declared, fitted and attributed), and so does the zero-offset
      control (*"three agreeing nodes produce NO skew finding"*), so it cannot pass vacuously. What
      the gate does **not** assert is "must not fuse": the shipped design aligns and fuses. §5.
- [x] **SUPERSEDED — the shipped design DOES correct, deliberately. See §5.** What is gated instead
      is that the correction is never *silent*: it is declared, attributed per sensor, applied only to
      a shallow copy (the caller's recs keep their original stamps), and `applyClockSkew:false` still
      declares while applying nothing.
- [x] The device clock is corrected and the correction recorded. **PARTLY DONE 2026-07-29** — the
      timezone was GMT−5 for a GMT−4 location and is now corrected (§2b); the ~21 min residual has
      no exposed control. **Verify the prediction** on the first night recorded after the change:
      the offset should flip to ≈ +21 min ahead, not fall to 0.
      **MEASURED 2026-07-31, not yet confirmed** — the two post-correction nights fit at **−22.25 min**
      (Z 9.9) and **−21.13 min** (Z 6.2), agreeing within **1.12 min**, against a predicted ≈21 min.
      Sign and magnitude both match. It is NOT called confirmed: n=2, and *neither night clears its own
      shuffled null* (p 0.19 and 0.52) — so the corpus-level agreement is the evidence, and one more
      clean tri-device night is still owed. The per-channel estimator could say nothing at all here
      (`uncorroborated` / `AMBIGUOUS`); see `POOLED-CLOCK-FIT-2026-07-31-BRIEF.md` §4.
- [x] **DONE 2026-07-31 — see §6.** The re-run could not be the same comparison: the device exports
      PB as ONE event per night carrying a nightly total, so there is nothing to overlap at episode
      resolution, clock or no clock. The night-level question — which the offset cannot affect — was
      run instead: **κ = −0.039 over 39 paired nights.** Verdict carried into
      `MULTINIGHT-CORPUS-FINDINGS-FOLLOWUPS` §1.1.
- [x] The offset is pinned to a usable precision, and the estimator is safe to consume.
      **DONE 2026-07-30** (§2d) — **38.28 min ± 3–4 s** from 8 channels / 3 devices / 5 mechanisms via
      delta-mode refinement; 7 of 14 nights corroborated by ≥2 distinct devices, 37.75–38.45, median
      agreement 39 s. §1's 39.5 is retained as the *desaturation* figure and explained by a physiologically
      ordered latency ladder. The fit is reported, never applied.
      **AMENDED 2026-07-31** — the *"`confident` separates right from wrong 7/7"* half of this claim is
      **RETRACTED** (see §2d): on 31 nights it is 2026-06-15 `confident` at 1.53 min. The offset itself
      stands and is now measured on 29/29 pre-correction nights by `fitClockOffsetPooled`
      (`POOLED-CLOCK-FIT-2026-07-31-BRIEF.md`), which calibrates each night against its own shuffled
      null rather than counting devices.
- [x] The movement-alignment alternative is settled. **DONE 2026-07-29** (§2c) — rejected, and rejected
      for a *proven* reason: an ACC↔ACC control on a known-zero pair shows the method recovers a planted
      −39 min offset on 1 night in 13 while succeeding 13/13 at its design range, because at wide-search
      settings the `minCorr` gate sits below the chance-maximum correlation. The flow-vs-movement negative
      it produced is **void** and must not be cited. Sensitivity work stays on §3.1's histogram.

---

## 5 · §3.2 was REVERSED in shipped code, deliberately — recorded here (2026-07-31)

§3.2 said *"Do NOT auto-correct… Detect, report, refuse to fuse across a suspected skew."* **The
shipped Integrator does correct.** That is not drift; it is a documented reversal at the call site,
and this brief's Done-when had gone stale against it.

The reasoning, from `runFusion`: the ResMed sits on its own cell network, so it **cannot be
NTP-disciplined and the offset is permanent**. Refusing to fuse would mean permanently discarding a
signal that is perfectly good apart from its timestamps — a worse outcome than aligning on a
measured offset. §3.2 was written before the offset was pinned to ±3–4 s (§2d); once it was, "refuse"
stopped being the cautious option and became the wasteful one.

**What replaced the ban is the thing §3.2 actually wanted — no SILENT correction.** All of this is
gated:

- the offset is fitted from the data, then **declared** in `clockSkew` with `peakOverFloor` and the
  nodes it was measured against;
- it is **attributed per sensor and per mechanism**, so a number resting on three unrelated
  physiologies is auditable rather than asserted;
- it is applied to a **shallow copy** — the caller's recs keep their original timestamps, gated by an
  explicit assertion, so nothing downstream inherits a shifted clock by surprise;
- **`applyClockSkew:false` still declares and applies nothing**, so a consumer that wants the strict
  §3.2 behaviour has it.

`runFusion` also always emits the block, clean or not, because *checked-and-clean* and *never checked*
must not look the same. The zero-offset control (*"three agreeing nodes produce NO skew finding"*)
stops the whole thing passing vacuously.

**Left as-is.** The shipped decision is better argued than the brief's, and re-litigating it to match
a stale checklist would be the wrong direction of edit.

## 6 · §3.4 · §1.1 RE-RUN (2026-07-31) — and it could not be the same comparison

### 6.1 The episode question is unanswerable from this export

§1.1 compared OxyDex PB episodes against device CSR spans and got 0 of 20, which §1 correctly voided
as a measurement of the clock. **The re-run cannot repeat it at all**, for a reason the clock has
nothing to do with: the device exports periodic breathing as **exactly one event per night**, carrying
`meta.totalSec` / `meta.pct` — a **nightly total, not located spans** (verified: 16 PB events across
16 distinct nights, never more than one on any night). There is nothing to overlap against at episode
resolution, with or without the 38.28 min correction.

So §1.1 is not "still open pending the offset". **The episode-level question is not answerable from
this data**, and that is the result rather than a failure to obtain one.

### 6.2 The night-level question IS answerable, and the offset cannot touch it

A nightly total compared to a nightly total is immune to a constant clock offset — which makes this
the cleaner test, not the fallback. Over **39 paired nights**:

| | OxyDex PB | OxyDex none |
|---|---|---|
| **device PB** | 4 | 1 |
| **device none** | 32 | 2 |

**Cohen's κ = −0.039** — chance-corrected agreement is *zero*. OxyDex emits `periodic_breathing` on
**36 of 39** nights; the device scores it on **5 of 39**. On the 4 nights where both fire, burden
correlates r = −0.448 (n = 4 — reported for completeness, not as evidence of anything).

κ is the right statistic and raw agreement is the wrong one: at 92 % vs 13 % base rates, two raters
agree by accident often enough to look concordant. The selftest pins exactly that case.

### 6.3 What this does and does not establish

It establishes that **OxyDex's emitted PB events and the device's PB scoring do not describe the same
nights.** It does *not* establish which is right — the device's scoring is a different instrument with
its own thresholds, not ground truth, and this is one subject.

**A precision worth recording.** This measured the **emitted `periodic_breathing` ganglior events** —
the cross-node currency, and what any consumer actually fuses on. It did **not** measure the app's
"CS pattern likely — review CPAP pressure" text, because that comes from `patScore`, which is
**absent from batch exports entirely**. That is the same browser-only/batch divergence documented in
`ECGDEX-CARDIOPULMONARY-COUPLING-FOLLOWUPS` §7.1 — a user-facing derivation no corpus measurement can
see — and it is why §1.1's "28 of 37" and this "36 of 39" are not the same quantity.

**Carried to a follow-up**, not fixed here: a 92 % emission rate against a 13 % device rate is an
over-call worth its own brief, and it is the same family as ECGDex's retired `estimatedAHI` — a
surface whose confidence outruns its validation. See
`OXYDEX-PB-OVERCALL-2026-07-31-BRIEF.md`.
