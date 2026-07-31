<!--
  POOLED-CLOCK-FIT-FOLLOWUPS-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-07-31 · **Found while executing:** `POOLED-CLOCK-FIT-2026-07-31-BRIEF.md` · **Affects:** `ecgdex-dsp.js` / `ppgdex-dsp.js` event fiducials, `CROSS-DEVICE-CLOCK-SKEW` §2d's latency ladder, `PAPERS-ROADMAP`

# Once the clock is pinned, every channel is on one timeline — and the pairs do not say what the ladder says

Executing the pooled clock fit produced a tool nobody asked it for: with each night's CPAP↔wearable
offset measured, **all channels from all four devices sit on a single timeline**, and any pair of them
can be swept at 1 s resolution with its own shuffled null. That is a physiology instrument, not a clock
instrument, and pointing it at the corpus surfaced one reproducible structure the suite cannot currently
explain and one it should stop asserting.

**Nothing here is a claim of new physiology.** It is a measurement with three candidate explanations,
all three tested and all three rejected. That is precisely the state that belongs in a brief rather than
in a paper or a metric.

---

## 1 · `autonomic_surge` ↔ `movement_onset` is strongly coupled and its latency changes sign

**Method.** For every night with a fitted offset, every channel pair with ≥8 events on each side was fit
with `fitClockOffsetPooled` at `{maxLagSec: 600, stepSec: 1, matchSec: 10, nullIters: 30}` — the same
gated estimator, at physiological rather than clock resolution. 44 pairs tested across 30–31 nights.
Nine pairs are significant on ≥5 nights:

| pair (anchor → partner) | nights | significant | median lag | MAD | median Z |
|---|---|---|---|---|---|
| PpgDex `motion_artifact_segment` → PpgDex `movement_onset` | 30 | **30** | −1 s | 1.5 | 20.4 |
| ECGDex `autonomic_surge` → PpgDex `motion_artifact_segment` | 29 | **29** | +13 s | 2 | 10.8 |
| ECGDex `autonomic_surge` → PpgDex `movement_onset` | 30 | **29** | +14 s | 3 | 11.3 |
| ECGDex `autonomic_surge` → CPAP `apnea` | 30 | 18 | −11 s | 10.5 | 7.0 |
| ECGDex `autonomic_surge` → ECGDex `movement_onset` | 30 | 9 | +14 s | 9 | 9.0 |
| PpgDex `motion_artifact_segment` → CPAP `apnea` | 30 | 9 | +3 s | 14 | 9.9 |
| PpgDex `movement_onset` → CPAP `apnea` | 31 | 9 | −12 s | 17 | 7.8 |
| ECGDex `movement_onset` → PpgDex `movement_onset` | 31 | 8 | +1 s | 2.5 | 10.5 |
| ECGDex `movement_onset` → PpgDex `motion_artifact_segment` | 30 | 8 | −2 s | 3.5 | 9.4 |

Row 1 and the last two are **controls, and they pass**: two detectors on the same device agree to 1 s,
and the chest IMU agrees with the arm IMU to 1 s. A method that could not recover those would not be
worth reading further.

### The MAD is lying, and the histogram says why

`autonomic_surge → movement_onset` reads as a tight +14 s ± 3 s. It is not. The per-night lags are
**bimodal** — 22 nights at +10…+21 s, 7 nights at −20…−25 s — and the MAD is small only because the
median sits inside the larger mode. Pooling the raw deltas instead of the per-night argmaxes (992 paired
events, nearest partner within ±60 s, 30 nights) shows the real shape:

```
 -35s   28 ██████
 -30s   64 ███████████████
 -25s  122 ████████████████████████████
 -20s  140 ████████████████████████████████
 -15s   74 █████████████████
 -10s   11 ███
  -5s    3 █
   0s    7 ██          ← 10 of 992 deltas fall within ±5 s
   5s   70 ████████████████
  10s  216 ██████████████████████████████████████████████████
  15s  140 ████████████████████████████████
  20s   61 ██████████████
  25s   17 ████
```

Two clean modes at **+12 s** and **−22 s**, and a **depletion at simultaneity**. The two events almost
never co-occur. A bimodal split alone could be a detector quirk; a *hole at zero* is a structural
signature and is the part worth explaining.

### Three explanations, all tested, all rejected

1. **Epoch quantisation.** Rejected — 0 % of event timestamps in either channel land on a 5/10/15/30/60 s
   grid. Both fiducials are at native resolution.
2. **CVHR cycle aliasing.** `autonomic_surge` is emitted from `cvhr.events`, which are *cyclic* by
   construction, so two modes 34 s apart would be explained by a ~34 s cycle. Rejected — the corpus
   `meta.periodSec` distribution is median **20 s** (p25 17, p75 28), and a 20 s period predicts modes at
   +12 / −8, where the histogram has a hole.
3. **Detector mutual exclusion** (a surge suppressed during motion would manufacture the notch).
   Not supported by the emitter: `autonomic_surge` is stamped straight from `cvhr.events` with no motion
   gate in its path.

### What to do

- **Do not build a metric on this yet, and do not put it in a paper.** 44 pairs were swept with no
  multiple-comparison control; the strong rows survive that easily, but the *latency* is the claim at
  issue and it is unresolved.
- **Next test, cheapest first:** condition the delta on arousal intensity (`meta.ampBpm` for the surge,
  the onset's magnitude) and on whether a CPAP apnea is within the window. If the two modes separate on
  arousal type, this is physiology — two arousal sequences, autonomic-led and movement-led — and it is
  worth a `papers/` entry. If they separate on nothing, it is a fiducial-definition artifact and the fix
  belongs in the detectors.
- **Re-derive both fiducials to a stated instant.** Neither `autonomic_surge` nor `movement_onset`
  documents *which* instant of the event it stamps (onset, threshold crossing, peak). Until they do, any
  cross-channel latency mixes physiology with detector convention, and that is enough on its own to
  block a physiological reading.

## 2 · The latency ladder in `CROSS-DEVICE-CLOCK-SKEW` §2d is contradicted by direct measurement

The ladder orders movement **30 s ahead of** the autonomic surge. Measured directly as a pair, the surge
leads movement by 12 s on most nights. Both cannot be right.

The ladder is the weaker evidence: it was *inferred* from separate per-channel CPAP fits under the
estimator that the parent brief has now deprecated, whereas the pair fit measures the two channels
against each other with no clock in between. §2d has been amended to say so. **It has not been rewritten
to the new ordering** — §1 shows the pair latency is itself bimodal, so replacing one asserted ordering
with another would repeat the mistake.

Note the CPAP rows in §1's table cannot settle it either: they were aligned using that night's fitted
offset, which is itself dominated by these same channels. **Circular — do not quote them as independent
evidence of latency.** They are in the table because leaving them out would hide that they were tested.

## 3 · Smaller items

- **`spreadSec` changed meaning at the cutover.** Under the vote it was "how far apart the agreeing
  channels' estimates sat"; under pooling it is the width of the peak's support. Both are published as
  `spreadSec`. The Integrator UI and `trio-batch` were updated to render it as `± resolution`, but any
  *stored* historical value carries the old meaning. No fixture stores one today; if one ever does, it
  needs a distinct field name rather than a comment.
- **The ±45 s window and 5 s grid are still unswept** (parent §6). The planted-offset control shows the
  centroid removes the window's bias, so the cost of the coarse window is resolution, not accuracy — but
  a sweep would let the window be chosen rather than inherited.
- **9 nights (2026-07-16 … 07-24) remain unfoldable**, raw data gone from every tree. The corpus is 31
  nights and will not grow backwards.
- **`npx biome …` and `npx tsc …` silently do the wrong thing in this repo.** Biome and TypeScript are
  devDependencies, so a bare `npx biome ci <file>` resolves to nothing, prints nothing and **exits 0** —
  it looks like a pass. `npx tsc` hits the unrelated `tsc` shim package. Both gates therefore appeared
  green locally and failed in CI, on real defects (a `null`-narrowing error and an over-long line). The
  invocations that actually reproduce CI are the pinned ones the workflows use:
  `npx -y @biomejs/biome@2.5.3 ci <files>` and `npx -y -p typescript@5.5.4 tsc --noEmit -p tsconfig.json`
  (note `-p` before the package for tsc). Worth a line in `CONTRIBUTING.md`, since an exit-0 no-op is the
  most expensive kind of false green.

## 4 · Done when

- [ ] The bimodal latency of §1 is either explained (conditioned on arousal intensity / apnea proximity)
      or attributed to fiducial definition — and whichever it is, written back into §2d of
      `CROSS-DEVICE-CLOCK-SKEW`, which currently says only that the ordering is in doubt.
- [ ] `autonomic_surge` and `movement_onset` each document the instant they stamp, in their emitter.
- [ ] If §1 resolves to physiology: a `papers/` entry with the null calibration alongside, per
      `LITERATURE-USE-POLICY`. If it resolves to an artifact: a detector fix and a gate.
- [ ] The window/grid sweep of §3 is run, and the chosen values carry a reason.
