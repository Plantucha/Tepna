<!--
  ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `INTEGRATOR-POOLED-CLOCK-APPLY-2026-08-01-BRIEF.md` §6 · **Affects:** *(built end-to-end, measured, then BACKED OUT — no code shipped)*

# Anchors are too sparse a carrier: 75 movements a night, 3 of them shared.

`INTEGRATOR-POOLED-CLOCK-APPLY` §6 identified the gap. `IntegratorDSP.activityEnvelope` /
`alignEnvelopes` and `PATAlign.alignByAnchors` can align two body-worn devices to **0.10–0.39 s**, and
the Integrator ships all of them — but it consumes node-exports, and **no node-export carries anything
mechanical.** Only events, which couple through physiology and are therefore tens of seconds wide. The
instrument was in the building; the fuel was not in the pipe.

This brief built the pipe, measured what came through, and **backed it out.**

## 1 · What was built (and works)

- `DexExport.motionAnchors(rows, t0Ms, durSec)` — reuses `PATAlign.envelope` + `findAnchors` rather
  than growing a second copy; normalises ECGDex's `tsMs` and PpgDex's `tMs` in one place; returns
  `null` (not an empty shape) when a node has no inertial data, because absent means *not measured*.
- Emitted as `timeseries.motionAnchors` by **ECGDex** (H10 chest ACC) and **PpgDex** (Verity limb ACC),
  computed inside `analyze` where the raw rows are still in scope and carried on the result, so the
  app path and `compute()` emit the identical field.
- `pat-align.js` co-loaded into both bundles and into `trio-batch`'s headless realm, and classified in
  the co-load gate's RESOLVE table.
- Suite green at **4847/4847**, both rich goldens regenerated, all drift guards current.

**Why anchors and not the raw envelope:** a 50 ms grid over 8 h is ~576,000 bins. Anchors are the bins
that carry information — strong, isolated, locally-maximal movements — and they are **aperiodic**,
which is the property that matters: a beat train pins an offset only modulo one RR interval
(`IBI-ALIGNMENT-LIMIT`), an isolated turn is unambiguous.

## 2 · What it measured — 2026-07-26, real fold through the real DSPs

| | |
|---|---|
| ECGDex (chest) anchors | **75** |
| PpgDex (limb) anchors | **67** |
| anchor-list match, ±500 ms | best shift −1.500 s → **13 / 75** (chance ≈ 0.2 — so real) |
| anchor-list match, ±120 ms | best shift −1.160 s → **5 / 75** |
| window refinement (`PATAlign.lagAtAnchor`) | **n = 3** clear `minCorr` · median **−1512 ms** · MAD **270 ms** |

**The instrument is sound; the sampling is not.** A planted-shift control confirms it: two synthetic
envelopes offset by exactly 100 ms are recovered by `lagAtAnchor` as **99.94 ms** — parabolic sub-bin
refinement working as documented. The problem is upstream of the estimator.

**A chest strap and an arm band do not see the same movements.** Roll onto a shoulder and both record
it; reach out an arm and only one does. Of 75 chest anchors, 13 have a limb counterpart within half a
second and only **3** produce windows correlated enough to refine. Three estimates with a 270 ms MAD is
not a sub-second alignment, and presenting it as one would be the point-estimate-without-error-bar
failure this repo has now retracted three times.

> **Why `WEARABLE-SYNC` succeeded where this did not.** It got 0.10–0.39 s from **windowed NCC over the
> whole 50 Hz accelerometer envelope**, regressing lag against time across the night. Anchors throw
> away exactly the data that made that work: they keep ~10² bins out of ~10⁵. The compaction that made
> the field affordable is the same choice that made it uninformative.

## 3 · Why it was backed out rather than shipped

`ganglior.node-export` is a **published contract**. A field added to it should land once, in the shape
its consumer needs — and this measurement says anchors are not that shape. Shipping them would mean a
MINOR bump, two regenerated goldens and a co-load change, followed by a second contract change when
the real carrier is chosen. Worse, it would put a field on the bus with **no working consumer**, which
is the defect `#636` had just fixed elsewhere (a resolver that existed, was gated, and had no caller).

Backed out: `dex-export.js`, `ecgdex-dsp.js`, `ppgdex-dsp.js`, both `.src.html` co-loads, both bundles,
both goldens, the co-load classification and the `trio-batch` realm load. `build --check` clean.

## 3.5 · CORRECTION — the export DOES already carry a sub-second shared channel, and it does not work

This brief opened by saying *"no node-export carries anything mechanical"*. That framing is wrong in a
way worth fixing: the exports already carry **explicit per-beat times** — `timeseries.rr.tSec`
(ECGDex) and `timeseries.ppi.tSec` (PpgDex), 22,460 and 22,145 beats on 2026-07-26 — anchored to each
node's own `startEpochMs`. Beat times are not mechanical, but they *are* a shared channel at
sub-second resolution, already on the bus, needing **no contract change at all**.

It was measured, and it does not align these devices. Correlating the interval SEQUENCES (aperiodic in
value, so immune to the mod-RR trap that defeats a raw beat-time scan) gives a beat-index offset at
**r = 0.411**, and the time offset that pairing implies has **MAD 22 s / IQR 47 s** — the pairing
drifts, because dropped beats accumulate an index error the correlation cannot see.

| | 2026-07-26 (here) | `IBI-ALIGNMENT-LIMIT` |
|---|---|---|
| interval-sequence r | 0.411 | 0.532 |
| beats within 100 ms of a counterpart | **15.9 %** | 5–26 % |
| PAT-window deltas (60–700 ms) | median **336 ms**, **IQR 265 ms** | — |

**An independent reproduction on a night that brief did not use.** The median 336 ms is physiologically
right for pulse arrival and would clear `pat-gate.js`'s `physical` check; the **IQR fails the ≤ 60 ms
bar by 4.4×**, exactly as 16 % beat correspondence predicts — most "nearest" pulses are the wrong beat.

**So the limit is physiological, not a plumbing gap**, and one design direction is closed: do not build
an RR↔PPI aligner. The data is already exported and the correspondence is not there.

## 3.6 · A TWO-PASS scheme is the right shape and still fails — with the control that proves it

The natural fix for §3.5 is two passes: a coarse method that is unambiguous but low-resolution gets
inside one heartbeat, and the beat trains — no longer ambiguous modulo an RR interval — refine it. The
reasoning is sound; the mod-RR trap really is only a trap when the offset is unknown to better than
one beat. It was tested with the ACC lock (~−1.2 s) as pass 1 and the PAT gate's own statistic as
pass 2 (first pulse foot after each R-peak inside 60–700 ms; score median and beat-to-beat IQR).

| offset | n | coverage | median PAT | IQR |
|---|---|---|---|---|
| best over a ±3 s sweep (−0.90 s) | 10,792 | 48.0 % | 351 ms | **264 ms** |
| **control — shifted +1 hour** | 10,318 | 45.9 % | 388 ms | **330 ms** |

**Being an hour wrong looks the same as being right.** The IQR is flat across the whole sweep
(264–368 ms) with no minimum anywhere, and the chance control sits inside that range. Pass 2 has **no
discriminating statistic on this data**: at ~16 % beat correspondence, a 640 ms-wide acceptance window
with beats arriving every ~1 s fills by chance at every offset, so what is being measured is the width
of the window, not a pulse transit.

**The control is the finding.** Without it the sweep reports *"best IQR 264 ms at −0.90 s"*, which
reads like an alignment and is not one — the same shape as the point estimates this repo has now
retracted three times.

What would actually move pass 2 is **better beat correspondence, not a better search**: restrict it to
the highest-SQI PPG epochs, where the optical spine finds the same beats the ECG does.
`PAT-FEASIBILITY`'s gate already encodes this as `coupling >= 55 %`, and this night is nowhere near
it. That is a data-quality precondition, not an alignment algorithm.

## 4 · The design question the next iteration must answer first

**How do you carry a continuous envelope in a JSON export that is currently 30–400 KB?**

| carrier | resolution | ~size, 8 h |
|---|---|---|
| 50 ms bins (what `PATAlign` uses internally) | ~10 ms after refinement | 576,000 values — impossible |
| 4 Hz (what `WEARABLE-SYNC` used, 0.10–0.39 s) | ~250 ms before refinement | 115,200 values ≈ 700 KB — too big |
| 1 Hz | ~1 s | 28,800 values ≈ 170 KB — affordable, but not sub-second |
| anchors + windows (**this brief**) | sub-10 ms *per pair* | ~30 KB — **too few pairs** |

Three directions, none obviously right, none to be picked without measuring:

1. **Quantise and pack.** 4 Hz as `uint8` deviation + base64 ≈ 115 KB. Keeps the resolution that
   worked; costs a decoder and an opaque field.
2. **Coarse grid + parabolic refinement.** 1 Hz carried, sub-bin refinement at the consumer. Cheap;
   whether refinement recovers sub-second from a 1 Hz envelope is **unmeasured**.
3. **Not in the node-export at all.** A sidecar alignment artifact, or an offset measured once at
   capture time (the vigil box already sees both devices) and carried as a single number.

**Direction 3 deserves the first look**: the capture host has both raw streams and already disciplines
both Polar clocks on every connect. Measuring the offset where the data is dense, and exporting one
number instead of a waveform, is strictly cheaper than any carrier above.

## 5 · Done when

- [x] The pipe built end-to-end and proven to work mechanically (75/67 anchors, correctly stamped).
- [x] The estimator validated against a planted 100 ms shift (recovered as 99.94 ms).
- [x] Measured on a real night, and the result reported as the **negative** it is.
- [x] Backed out rather than shipped, so the contract changes once.
- [ ] *(next)* Pick a carrier from §4 — after measuring whether 1 Hz + refinement reaches sub-second,
      and after checking what the capture host could measure directly.
