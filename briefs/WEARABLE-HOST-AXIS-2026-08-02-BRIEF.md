<!--
  WEARABLE-HOST-AXIS-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-02 · **Created:** 2026-08-02 · **Follows:** `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` · **Affects:** `clock.js`, `ppgdex-dsp.js`, `ecgdex-dsp.js`, `tools/dual-clock-rate.mjs`, `tests/dex-tests.js`

# Every capture row carried two clocks. We anchored on the good one once, then rode the bad one all night.

`WEARABLE-DRIFT-DIRECT` measured device-vs-host rate from the two columns every Polar-Sensor-Logger /
capture-host row already carries. This brief asks the question that measurement implies and the last one
did not ask: **which of those two clocks is on the exported time axis?**

It is the device's. `ppgdex-dsp.js` built `relSec[i] = nsArr[i]/1e9` from the `sensor timestamp [ns]`
column; `ecgdex-dsp.js` derived `fs` from the device's own `timestamp [ms]` column and placed every
sample at `t0 + i/fs`. Both read the host stamp **once**, to anchor `t0Ms`, and then never again — a
deliberate cost decision (EFFICIENCY-AUDIT §P1: `parseTimestamp` was ~half of `parsePPG`). So a
chrony-disciplined stratum-1 clock sat unused in column 0 of every row while an uncorrected crystal
carried the night.

## 1 · What that cost, measured by deciles with no fitting at all

| device | divergence by end of recording | shape |
|---|---|---|
| H10 ECG | **−0.70 s** over 434 min | smooth, −27 ppm |
| Verity PPG | **−0.34 s** over 189 min | smooth, −30 ppm |
| **O2Ring PPG** | **−18.49 s** over 190 min | smooth but **NON-LINEAR** — −3035 ppm decaying to −1622 |

A counter reset was ruled out first, because it would fake any global slope. The O2Ring ramp is smooth,
so it is a genuine error — and being non-linear, **no single ppm and no linear fit can remove it.** That
is why the shipped correction interpolates a measured curve instead of fitting a rate.

## 2 · `DexClock.hostAxis(anchors, opts)` — the correction, and the two properties that make it safe

Sample the host stamp 1 row in 500 (0.2 %, so §P1's finding stands), take the divergence at each anchor,
reject outliers with a running median, interpolate. Two properties, neither optional:

- **SLOW.** The correction's own slope is ~30 ppm — 30 µs per second — so **RR/PPI intervals keep the
  device's fine structure**. The crystal is excellent at short scales; only its *rate* is wrong. Gated:
  a 1 s interval survives as 999.14 ms.
- **ROBUST.** Host stamps carry BLE delivery jitter (~100 ms; the Verity's raw divergence wobbles
  −0.15/−0.08/−0.26/−0.24/−0.34). Interpolating raw anchors would inject that jitter straight into every
  beat time — **worse for HRV than the drift it removes.**

**The window was chosen by measurement, not taste** — planted recovery against ±100 ms jitter over the
real 190 min / 2873-anchor geometry (worst / rms residual, ms):

| win 9 | win 21 | win 41 | win 81 |
|---|---|---|---|
| 77 / 36.3 | **57 / 18.7** | 168 / 16.5 | 245 / 24.8 |

21 halves the jitter without over-smoothing; 41+ begins flattening the O2Ring's real curvature, which is
the one thing this must follow.

### A spike is not a step — and the difference is the whole design

The raw probe reported a "3.22 s step" on 2026-07-26's H10. It is a **transient spike**: the mean of the
30 anchors before and after differs by **0.010 s**. A running median rejects it; a slope fit would have
bent the entire axis around one bad host stamp. A *sustained* step is different and is followed, and
surfaced via `maxStepMs` — ECGDex cannot correct one (a scalar `fs` expresses a rate, not a step), so it
reports rather than silently absorbing it.

### It refuses rather than fabricating

A ±50000 ppm plausibility bound. This was **caught by an existing fixture, not by inspection**: the
ECGDex §4.3 synthetic's ms column runs at 2× its host stamps, and unbounded that became a −500000 ppm
"correction" that doubled `fs` from 130 to 259.9 Hz. Beyond the bound the two columns are not the two
clocks we think they are, and the honest answer is no correction — Clock Contract §2.6, one level up.

## 3 · The O2Ring does not have a clock problem. It has a PROVENANCE problem.

Its `sensor timestamp [ns]` is **drawn, not measured**. Across 16 files it has exactly **one** delta
value — 7,953,045 ns at 100.0 % — i.e. `sample_index × a constant`. Two populations, cleanly separated:

| | distinct deltas | nominal Hz | true Hz | divergence |
|---|---|---|---|---|
| **drawn** (16 files, ≤ 2026-07-27) | **1** (100 %) | always **125.738** | 125.68–126.05 | −527 … −2990 ppm |
| **measured** (2026-07-28 →) | 1744–4484 | 126.206 / **125.803** | 125.795 / **125.802** | +48 / **−162** ppm |

The apparent "ppm" is **the error in an assumption**, not a crystal property — which is why it is
erratic, why it is occasionally near-perfect, and why the counter also fails to advance across dropouts
(so the axis is wrong by both a rate mismatch *and* every lost sample). After the 2026-07-28 boundary the
ring emits real timestamps and nominal matches true to **1 ppm**.

> ### ⛔ The repo already walked into this trap once. Do not re-calibrate the constant.
> `O2RING-PROTOCOL-2026-07-17-BRIEF` §109–111 records the constant as a **calibration**: 125.738 Hz
> "measured … not the round 125.0 first guessed (which was 0.59 % low ⇒ ~212 s of divergence over a 10 h
> night)", fitted over 12 sessions / 2,616,483 samples. That was a careful piece of work and it is
> exactly the wrong move: **a better number makes a drawn axis more plausible without making it a
> measurement — and erases the evidence that it is drawn.** The delivered rate varies 125.68–126.05 Hz
> *per session*, so no constant can hold. The fix is not a third calibration. It is to stop drawing the
> axis and use the host clock that was in column 0 the whole time.

**Detect provenance, don't infer it.** The delta-distribution test used above is a heuristic; the
decisive test is `first sensor timestamp == 0 ⇒ drawn axis`.

## 4 · The sibling tool needed a gate this function must NOT inherit

`dual-clock-rate.mjs` selected fragments by **file size**, and bytes are not span: it quoted the same H10
at **−20.3 ppm over 373 min** and **−65.8 ppm over 10.9 min**, both >3 MB, with equal weight. `spanMin`
was computed and never gated on. Now gated at ≥60 min, with short fragments reported-but-not-counted so
the spread stays visible.

Why a *span* gate and not a formal standard error: with ~17k rows the least-squares SE is ~0.1 ppm, which
would call both fragments precise. The real error is systematic — **host stamps are non-monotonic (2,948
backward steps, max 287 ms)**, so a single endpoint slip is 712 ppm over 11 min and 21 ppm over 373. Only
a long lever arm defends against it.

**`hostAxis` deliberately does not inherit the gate.** It fits many anchors rather than two endpoints;
its exclusion cost would be the whole fragment; and its residual error is self-limiting at
span × rate-error — *it cannot exceed the jitter that caused it*. Gating on span would refuse exactly the
short O2Ring fragments that need it most (~3 s of real error). The ring's problem is provenance, which no
span gate reaches.

With the gate, the direct measurement **survives and sharpens**: H10 −17.3…−23.0, Verity −26.0…−33.1
across long fragments, inter-device ≈ 7 ppm. The wild values (+129.9, −71.4) are all short fragments.

## 5 · Done when

- [x] Both clocks identified in every ingest path; the exported axis disciplined to the host one.
- [x] Correction is slow (intervals preserved) and robust (jitter rejected) — both gated, not asserted.
- [x] Window chosen by planted measurement across four widths, not by taste.
- [x] Refuses on an implausible rate; refuses with <3 anchors — caught by an existing fixture.
- [x] Spike vs sustained step distinguished, and the distinction gated.
- [x] O2Ring axis shown to be **drawn**, with the "don't re-calibrate" guardrail recorded.
- [x] 4906/4906 assertions, **zero skips** · typecheck · biome · all three drift guards clean.
- [x] Fixtures regenerated via `tools/regen-{ecgdex,ppgdex}-goldens.mjs` and **re-verified green on the
      real corpus** (`tools/verify-fixtures.mjs` — 14 current, 0 unstamped).
- [ ] *(next — see `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md`)* Re-run the whole corpus under the
      disciplined axis; revisit three-cornered hat, closure and PAT, every one of which used the O2Ring's
      drawn axis as a clock; audit `papers/`.

## 6 · Scope this does NOT claim

This makes every device mutually consistent on **one** timebase. Whether that timebase is itself correct
is the host's business — 0.008 ppm on the capture box (chrony, local stratum-1, confirmed via
`captures/status.json`), and **unverified on phone captures**, where column 0 is a real phone. The
correction is honest about this: it is named `hostAxis`, not `trueTime`.
