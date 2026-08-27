<!--
  WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-17 (every §6 item re-verified against the tree, and the recorded ppm caveat DISCHARGED BY RE-MEASUREMENT — see §8) · **Created:** 2026-08-02 · **Corrects:** `papers/wearable-clock-drift.html` scope note (90–216 ppm), `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md`, `WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md` · **Affects:** `tools/dual-clock-rate.mjs`

# The inter-device rate is ~7 ppm, and it was in the raw files the whole time.

Every beat-derived drift estimate in this brief family — mine at 39–96 ppm, the paper's scope note at
90–216 ppm — is built on the same stack: match beats, block them, unwrap a comb, regress a slope. Four
retractions have come out of that stack in two days.

**None of it was necessary.** Every Polar Sensor Logger / capture-host raw file carries **two clocks**:

```
Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]
2026-07-26T21:56:26.765;838432586543515816;0.0;-166
```

`Phone timestamp` is the **host** clock — chrony, local stratum-1, 0.008 ppm. `sensor timestamp [ns]`
is the **device crystal**. Regressing one against the other inside a single fragment gives that
device's rate offset in ppm, directly. No beat matching, no blocks, no comb, no unwrap.

## 1 · What it measures

Four nights, every fragment over 3 MB:

| device | ppm vs host | spread |
|---|---|---|
| **Polar H10** | −18.7, −19.1, −19.2, −20.0, −20.3, −20.5, −20.5, −21.6, −23.5 | **≈ −20 ppm**, ±2 |
| **Polar Verity** | −23.9, −26.0, −26.7, −27.1, −27.6, −30.2 | **≈ −27 ppm**, ±3 |
| Wellue O2Ring | −1441, −796, −645, −188, −3.4, **+141** | **not a clock** |

Each Polar device's rate is stable to ±2–3 ppm **across fragments within a night and across four
nights** — the signature of a real crystal offset, and the kind of repeatability no beat-derived
estimate in this family has shown.

**Inter-device rate = −20 − (−27) ≈ 7 ppm.**

## 2 · What that overturns

**7 ppm over a 7 h night is 176 ms** — comfortably under one RR (1190 ms at this subject's ~50 bpm).

- **The 90–216 ppm scope note is 13–30× too high.** A ramp that large would be 2.3–5.4 s per night, five
  times the tooth spacing.
- **My own 39–96 ppm figures are 6–14× too high** and are already retracted for a different reason
  (`JOINT-UNWRAP-ATTEMPT` §3.4).
- **Drift cannot produce a one-RR slip.** At 7 ppm you need ~47 h to accumulate 1190 ms. So every
  one-RR slip observed in beat matching is a **pairing failure, not clock drift** — which means an
  unwrap that removes slips and then reports the remaining slope as drift is removing the signal and
  fitting the noise. That is the mechanism behind the 89–216 ppm numbers.
- **It is close to the paper's v2 figure** (1.46 ppm median by `halfDrift`), same order and same
  conclusion: the clocks are, for this purpose, stable. v2's headline survives; the scope note added
  on top of it does not.

## 3 · Why the O2Ring's legs were always weak — a mechanism, at last

The O2Ring's `sensor timestamp` swings from **−1441 to +141 ppm between fragments of one night**. It is
not a disciplined counter and cannot be used as a clock. Every O2Ring pairing in
`CLOCK-CLOSURE-THREE-SOURCE` sat at 2–54 % correspondence against 13–22 % chance, and this is why —
not sensor quality, not physiology, not the night. **Any three-source closure that includes an O2Ring
leg is checking one good measurement against two derived from an unusable timebase.**

That also re-reads the closure results: the two nights that "closed" did so with O2Ring legs in them,
so their agreement is weaker evidence than it appeared.

## 4 · The re-anchoring question, answered

The paper's §(iii) argues the host path caps accumulated drift at 8.6 ms by re-anchoring every
fragment (median 3.0 min). That cap **does not apply on these nights**: the H10 ECG on 2026-07-26 is a
**single 208 MB fragment spanning 433 min**, not 3-minute pieces. So the H10 free-runs all night while
the Verity re-anchors across 47 fragments — the two paths are not symmetric, and §(iii)'s cap describes
a different capture regime than the one these ramps were measured in.

With the direct measurement in hand this matters less than it looked: at 7 ppm neither regime
accumulates enough to matter.

## 5 · Ships

`tools/dual-clock-rate.mjs <night-dir>` — subsamples every fragment > 3 MB, regresses host ms against
device ms, prints ppm per fragment. Reads the Clock Contract way (explicit regex → `Date.UTC`, never
`Date.parse`). Runs in seconds on a full night.

## 6 · Done when

- [x] Inter-device rate measured without beat matching, blocks, combs or unwrapping.
- [x] Repeatability shown across fragments **and** across nights (±2–3 ppm), which no beat-derived
      estimate here achieved.
- [x] The O2Ring's unusable timebase identified, with the mechanism for its weak legs.
- [x] The instrument shipped as a tool rather than left in a scratch script.
- [x] **The instrument now refuses when there is no second clock (2026-08-03).** See §7.
- [x] **APPLIED 2026-08-08.** The paper's §Corrections already retracted "the scope note added on top
      of it" in the abstract, but the scope note ITSELF still read *"a linear 90–216 ppm ramp is
      present and is not beat slip"* with no pointer to the direct measurement — so a reader meeting
      the number met the retracted figure, not the correction. Corrected **in place, additively**: the
      passage now carries the directly-measured H10 −20.3 / Verity −27.0 ppm vs the capture host,
      ≈7 ppm inter-device (202 ms over 7 h, not 2.5 s), and states that the paper's conclusion is
      unaffected because 7 ppm still exceeds the ~2.4–3 ppm bar — which is exactly why the inflated
      figure survived, the ordering holding at both rates. Another session's argument is not rewritten;
      a correction is added where the number appears.

      ⚠ **Recorded caveat:** every ppm here is measured against the CAPTURE HOST's clock. A
      125/stratum capture change was in flight on 2026-08-08; if it alters how the host stamps or
      disciplines time, these baselines and the `maxTolerableDriftPpm` verdicts citing them must be
      re-measured. Noted in the paper too.
- [~] **⛔ CORRECTED 2026-08-04 (same day). The claim below — "it CANNOT be run on this corpus" — is
      RETRACTED. It IS runnable; I checked the wrong artifact.** The table below is about the committed
      *exports*, and leg C never needed them: it comes from the **raw captures**, which carry both
      `Phone timestamp` and `sensor timestamp [ns]`. Scanning them, **38 fragment pairs have >30 min of
      simultaneous H10+Verity coverage, the longest 563 min (9.4 h)**. Nothing about the corpus blocks
      the closure. See §7.4 for what actually does.

      *(Original entry retained below, since its export-level facts are correct and its legs A/B table is
      what §7.4 builds on.)*

- [x] **RUN 2026-08-04 — the committed EXPORTS cannot supply leg C; the two export requirements are met
      by DISJOINT night sets.** §7.3 identified the third clock (the box host) and left the leg open rather than
      faking it. Attempting it honestly shows why it stays open, and exactly what would unblock it.

      | requirement | needs | available |
      |---|---|---|
      | legs A/B — device↔host | a **box** capture with a genuinely independent host clock | **2026-07-16 →** |
      | leg C — H10↔Verity, independent of A/B | beat intervals in **device-axis** exports | **≤ 2026-07-13** |

      > ### ✅ SUPERSEDED 2026-08-27 — the impossibility held for the EXPORTS, and dissolved when the
      > ### tool stopped needing them
      >
      > *"No night satisfies both"* was true of the stated inputs: legs A/B need a **box** capture, and
      > leg C was assumed to need beat intervals from **device-axis exports** — which the box nights do
      > not carry (`rr: 0` / `ppi: 0`). **`tools/beat-leg-closure.mjs` never reads an export.** It detects
      > beats from the **raw waveform** on each device's own `sensor timestamp [ns]` axis, so a single box
      > night satisfies A, B **and** C. The disjoint-night-sets problem was a property of the input
      > format, not of the corpus.
      >
      > **Demonstrated 2026-08-27 on `2026-07-18`** — a box night by its own evidence (host residual
      > **1887 ms**, not the 1.00 ms one-stamp-quantum signature of a phone capture, so the host column is
      > a second clock): 15,682 H10 beats · 8,538 Verity beats · **16 blocks** · leg C **+9.6 ppm**,
      > against **+6.4 ppm** predicted from that night's own host legs (H10 −19.1 over 3 fragments,
      > spread 1.1; Verity −25.5).
      >
      > **So the remedy below — *"regenerate the box nights' trio exports WITH the interval series"* — is
      > no longer required for this purpose.** It remains the right fix for consumers that genuinely need
      > interval series in exports; it is not a precondition for closing this leg. ⚠️ Its warning still
      > stands and matters more than ever: leg C must be built on the **device axis**. Reading raw files
      > satisfies that by construction, which is precisely why the check retains its power to fail.
      >
      > **Estimator error is not the limiting term, so a residual may be attributed to the host legs.**
      > `node tools/beat-leg-closure.mjs --selftest` recovers planted rates to **±0.0 ppm** across
      > −40…+40 ppm under realistic HRV (CV 0.052), 2 % dropouts per side and ±20 ms PAT jitter, 7/7.
      >
      > **Acceptance band, PRE-STATED 2026-08-27 before any σ was measured** (approved as an a-priori
      > coverage choice; the factor 2 is fixed and does not move once the data is seen):
      >
      > > closure holds iff **|legC − (A−B)| ≤ 2·σ_pred**, with **σ_pred = √(σ_H10² + σ_Verity²)** taken
      > > from each device's **within-night fragment spread** — a per-night band, since leg precision
      > > varies with fragment count.
      >
      > ⚠️ **A night where either device yields <2 fragments has no measurable σ and therefore REFUSES**
      > rather than borrowing one — the `hostAxis` ≥3-anchor discipline applied to this check. The
      > five-night table below has exactly that hole: its Verity legs are single figures with no spread.
      > If the bandable set collapses, *"this corpus cannot band the host-leg closure yet — multi-fragment
      > nights are the missing input"* is the result, not a reason to widen the band.

      **No night satisfies both.** The box nights' trio exports carry `rr: 0` / `ppi: 0` — no interval
      series at all; they predate `INTERVAL-SERIES-EXPORT`. And the interval-bearing nights are phone
      captures: `dual-clock-rate` on 2026-07-13 reports **`no-second-clock`**, residual spread **1.00 ms
      = exactly one stamp quantum**, i.e. the "host" column is the device stamp rounded. That is §7 of
      the Clock Contract confirming itself on this very question.

      **Legs A and B are solid and are recorded here so the check is ready when C exists** — five box
      nights with both devices:

      | night | H10 vs host | Verity vs host | ⇒ predicted H10↔Verity |
      |---|---|---|---|
      | 2026-07-24 | −21.9 | −27.6 | **+5.7** |
      | 2026-07-25 | −20.0 | −23.9 | **+3.9** |
      | 2026-07-26 | −19.2 | −30.2 | **+11.0** |
      | 2026-07-27 | −20.3 | −26.0 | **+5.7** |
      | 2026-07-28 | −21.6 | −26.7 | **+5.1** |

      Median predicted **+5.7 ppm**, and every crystal lands in the physically sensible −19…−30 ppm band.
      **This prediction is NOT the closure** — it is precisely the algebra §7.3 forbids passing off as
      one. It is the number an independent leg C would have to reproduce.

      **The remedy is concrete: regenerate the box nights' trio exports WITH the interval series.**
      ⚠ And regenerate them **on the device axis**. If they come back host-disciplined, leg C becomes the
      difference of two host-referenced series — the check that cannot fail. The stale pre-host-axis
      cohort flagged in `WEARABLE-HOST-AXIS-FOLLOWUPS` §F3-quater is, for this one purpose, the *correct*
      state: it is what makes leg C independent.

## 7 · The tool could not tell "the clocks agree" from "there is only one clock" (2026-08-03)

§1's method is *regress the host column against the device counter*. That is only a measurement if the
two columns are two clocks — and on a **phone** capture they are not. Polar Sensor Logger writes a host
column that is the device stamp rounded to the millisecond, so the fit is perfect and the tool reported:

| capture | span | ppm | residual spread |
|---|---|---|---|
| phone `20260606_220643_ECG` | 481.2 min | **−0.0** | **1.00 ms** |
| phone `20260704_225626_ECG` | 476.4 min | **0.0** | **1.00 ms** |
| phone `20260611_210411_ECG` | 463.2 min | **−0.0** | **1.00 ms** |
| box `20260802121358_ECG` | 6.7 min | −68.6 | **283.63 ms** |
| box `20260802122506_PPG` | 22.9 min | −36.5 | **551.84 ms** |

Six such phone fragments were **long enough to be quoted** in the summary, and every one read as a
flawless crystal. This is `CLAUDE.md` §7's rule exactly — *a rate of ~0 has two opposite meanings; read
`independent`, never a ~0 ppm* — and the one tool whose whole job is device-vs-host rate was not
applying it. The discriminator is the residual **spread**, bimodal here with a ~100× gap (1.00 ms
against 283–552 ms), so the 2-quantum threshold is a property of the data, not a knob.

**Fixed:** `rateOf` returns `residualSpreadMs` + `independent`; a pure exported `classifyRate` decides
`rate | no-second-clock | drawn-device-axis | too-short | unreadable`; a refused fragment prints **—**
where its ppm was, because printing the number beside the reason it is not a rate invites the very
quote the reason forbids. Ordering is asserted: a **drawn device axis** outranks a derived host column,
and a length complaint never pre-empts either — *"too short"* invites *"so use a longer file"*, which on
a phone capture is precisely wrong.

### 7.1 · The O2Ring stopped being DRAWN, and still is not a clock

§3 scoped the drawn axis as *"every session up to 2026-07-27"*. That scope was right, and what happened
after it matters: identical-delta share **99.4 % on 2026-07-27 → 2.2 % on 2026-08-01**. Something in the
capture changed. It did not become a clock — the same night's fragments disagree by **2282.6 ppm**.

So the drawn check alone no longer disqualifies it. A **cross-fragment spread** refusal was added
(`MAX_CRYSTAL_SPREAD_PPM = 50`): a crystal does not change rate between fragments of one night, so a
wide spread is not an imprecise rate but the absence of one, and the median is refused rather than
printed with a caveat beside it. **Known limit:** with only one usable fragment the spread check cannot
fire — single-fragment O2Ring nights still print −188.0 / −203.0 / −62.6 ppm, mutually absurd across
nights but individually unchallenged.

### 7.2 · §1's headline reproduces on nine nights, with the hardened tool

| device | nights | median ppm | range |
|---|---|---|---|
| **Polar H10** | 8 | **−20.3** | −18.7 … −21.6 |
| **Polar Verity** | 8 | **−27.0** | −23.9 … −30.2 |

**Inter-device ≈ 6.7 ppm** — §1's ~7 ppm, now on nine nights instead of four and with every
non-independent fragment excluded rather than silently averaged in.

### 7.5 · ✅ THE CLOSURE CLOSES — 4 of 4 box nights, residual −0.3…+3.0 ppm (2026-08-04)

The third source is the box host and the check is now **run and passed**. Leg C is beat-derived on each
device's own `sensor timestamp [ns]`, so it never touches the host column: it could have failed.

| night | H10 fast vs host | Verity fast vs host | ⇒ predicted V−H | **leg C (independent)** | residual | tol | |
|---|---|---|---|---|---|---|---|
| 2026-07-20 | +22.6 | +28.1 | +5.5 | **+7.6** | +2.1 | 7.0 | ✅ |
| 2026-07-27 | +20.3 | +27.6 | +7.3 | **+7.0** | −0.3 | 6.9 | ✅ |
| 2026-08-01 | +20.9 | +28.6 | +7.7 | **+10.7** | +3.0 | 7.2 | ✅ |
| 2026-08-03 | +20.5 | +29.6 | +9.1 | **+10.4** | +1.3 | 7.4 | ✅ |

Tolerance is `closeTriple`'s own rule, `max(5, 0.25·max|leg|)`. **The physical picture is coherent:**
both Polar crystals run FAST against the chrony-disciplined box (H10 +20.3…+22.6, Verity +27.6…+29.6),
the Verity faster by 5.5–9.1 ppm, and an entirely separate beat-derived measurement independently
returns +7.0…+10.7. Tool: `tools/beat-leg-closure.mjs` (`--selftest` for the known-answer).

#### ⚠ Two sign conventions, both established only by PLANTING TRUTH — and I assumed both wrong first

Each error alone produced a confident, publishable, wrong answer. Recorded because neither convention is
stated in prose anywhere, and the next reader will assume as I did.

1. **`dual-clock-rate`'s ppm is NEGATIVE when the device runs FAST** — it reports `(slope − 1)` where
   `slope = host ms per device ms`. Planted a device fast by +20 ppm → it reports **−19.5**. Assuming the
   opposite inverts the prediction and turns this closing triple into an **18 ppm INCONSISTENT** verdict.
2. **`legC` returns `(V_rate − H_rate)`.** Planted −20 ppm → returns −20.0.

#### ⚠ And the matcher must TRACK, not band-filter

The first leg C used a fixed acceptance window. Once accumulated drift pushes the true lag outside it,
the estimator silently adopts the adjacent beat one RR away and **the trend inverts**: planted −20 ppm
read **+17.9**. It also happened to return +9.6 on 2026-08-01 against a then-assumed +7.7 — agreement
close enough to publish, from an estimator that could not recover planted truth. Tracking the pairing
from a seeded reference recovers −40…+40 ppm to **0.0 ppm** under realistic HRV (CV 0.0522), 2 % dropouts
per side and ±20 ms PAT jitter.

Tracking is safe *here* specifically because block-to-block lag change is ~12 ms against an RR of ~1000.
That is the opposite of `JOINT-UNWRAP-ATTEMPT`'s regime, where per-block offsets were themselves
imprecise to a large fraction of an RR and no unwrap could work. **Do not generalise either verdict.**

### 7.4 · The closure IS runnable — and the blocker is the beat estimator, not the corpus (2026-08-04)

§7.3 left the beat leg open; the entry above then over-read that as "the corpus cannot supply it". Both
were wrong about *where* the obstruction is. Correcting it, with what was actually measured.

**The corpus is fine.** Leg C needs beat times on each device's OWN clock — not exports. The raw
Polar files carry `sensor timestamp [ns]` beside `Phone timestamp`, so both axes are present in every
capture. 38 fragment pairs exceed 30 min of simultaneous H10+Verity coverage; the longest is 563 min.

**The mod-one-heartbeat ambiguity does not bite at this span.** `beat-trains-align-only-mod-RR` is the
reason whole-night comb matching fails, but here the *expected* divergence is ~8 ppm over 563 min =
**0.27 s**, a quarter of one RR. The pairing is unambiguous if it is tracked rather than searched.

**Legs A and B, on the identical fragments (2026-08-01):**

| leg | ppm vs host | span |
|---|---|---|
| H10 | **−20.9** | 563 min |
| Verity | **−28.6** | 589 min |
| ⇒ predicted H10↔Verity | **+7.7** | |

**Beat extraction works** — 30,222 H10 beats (Pan–Tompkins, fs 130.0) and 30,616 Verity beats
(`consensusBeats.feet`), each on its own device ns axis, so leg C is genuinely independent of the host
column.

⛔ **BUT NO CLOSURE IS CLAIMED, because the estimator fails its own known-answer test.** A first
per-block nearest-lag + Theil–Sen leg C read **+9.6 ppm** against the predicted +7.7 — agreement close
enough to be tempting. Planting truth instead: with **V running −20.0 ppm relative to H**, the same
estimator reports **+17.9 ppm** — **sign inverted, magnitude 11 % low**. The nearest-beat pairing walks
to the adjacent beat as lag accumulates, which inverts the trend. So the +9.6 is not evidence of
anything, and the apparent agreement with +7.7 is coincidence until the estimator is fixed.

**This family has four retractions from exactly this stack.** A number that looks right, from an
estimator that cannot recover planted truth, would be the fifth. What is owed is not a closure run but a
leg-C matcher that recovers a planted rate in **sign and magnitude** — then, and only then, the
comparison against +7.7 means something.

### 7.3 · The third source with a real clock is the CAPTURE HOST — and only on box captures

The open item asked for *"a third source that has a real clock"*. It is the **vigil box** (chrony,
local stratum-1, 0.008 ppm) — the same host column §1 regresses against. Two consequences:

1. **A closure can only be attempted on BOX captures.** On phone captures there is no second clock in
   the file at all, so a host-anchored leg does not exist to close against. This also re-reads
   `wearable-clocks-diverge`: H10↔Verity ~3.3 s apart on phone nights against ~0.2 s on box nights,
   because only the box actually puts the two devices on one timebase.
2. **The O2Ring is disqualified twice over** — drawn through 2026-07-27, incoherent after.

**NOT DONE, deliberately:** the closure itself needs an *independent* H10↔Verity leg, and the only one
available is beat-derived — the exact stack that produced four retractions in this family. Deriving
`H10↔Verity` as the difference of the two host-referenced rates would be algebra, not a check: it
cannot fail. Running the beat leg honestly is a work unit of its own and is left open rather than
faked; what is settled here is *which* third clock the closure should use, and on which nights it can
exist at all.


## 8 · Header flip 2026-08-17 — verified, not stamped

`brief-checkboxes-are-not-status`: a `[x]` is a claim about the day it was written. Each §6 item was
re-checked against the tree before flipping, and the one **conditional** in it was settled by
measurement rather than by reading.

**The conditional first, because it was the only thing that could have blocked this.** §6's applied
item carries: *"every ppm here is measured against the CAPTURE HOST's clock. A 125/stratum capture
change was in flight on 2026-08-08; if it alters how the host stamps or disciplines time, these
baselines … must be re-measured."* Rather than establish what that change was, the baseline was simply
**re-run with this brief's own instrument** across nights spanning it — the direct test of the thing the
caveat is about:

| night | H10 ppm | Verity ppm | ⇒ inter-device |
|---|---|---|---|
| 2026-07-25 | −18.7 | −27.1 | 8.4 |
| 2026-07-27 | −20.3 | −27.6 | 7.3 |
| 2026-08-01 | −20.9 | −28.6 | 7.7 |
| **2026-08-07** | **−21.7** | **−28.5** | **6.8** |
| **2026-08-10** | **−19.8** | **−28.4** | **8.6** |

§7.2 claims H10 median **−20.3** [−18.7…−21.6] and Verity **−27.0** [−23.9…−30.2], inter-device ≈**6.7**.
Re-measured: H10 −18.7…−21.7 (median −20.3, *identical*), Verity −26.0…−28.6 (inside the stated band),
inter-device 5.7–8.6. **The nights after the change (bold) match the nights before it**, so whatever it
did, it did not move the baseline. **Caveat discharged — by the measurement it asked for.**

**The remaining items, each checked in the file that would carry it:**

| §6 item | verified how |
|---|---|
| rate measured without beat matching / blocks / combs / unwrap | `tools/dual-clock-rate.mjs` re-run above — a two-column regression, no beat code reached |
| repeatability across fragments **and** nights | the table above, spanning 17 days |
| O2Ring's unusable timebase + mechanism | §7.1; independently re-confirmed 2026-08-17 — the ring fails a χ²-weighted crystal test on 2026-08-01 (χ²red 6.30) while all 39 other device-nights pass |
| instrument shipped as a tool | `tools/dual-clock-rate.mjs` present and executable |
| refuses when there is no second clock | `no-second-clock` verdict present; the re-run prints `— … not a rate` on every short fragment |
| paper's scope note corrected in place | `papers/wearable-clock-drift.html` reads *"the H10 runs −20.3 ppm and the Verity −27.0 ppm versus the capture host … ≈7 ppm, not 90–216 (over 7 h: 202 ms, not 2.5 s)"* |
| leg C from committed exports | recorded as impossible, then **superseded by §7.5** — the closure closes **4 of 4** box nights, `tools/beat-leg-closure.mjs` shipped with a `--selftest` |

The one `[~]` is a **same-day retraction record**, not an open item; it is left as-is because deleting a
withdrawn claim is how a correction chain stops being auditable.

**Not claimed:** this flip says every acceptance item is met, not that the drift question is closed.
`CROSS-DEVICE-DRIFT-AND-CLOSURE` §5 still holds one open PAT item, and the §7.4 estimator warning stands.
