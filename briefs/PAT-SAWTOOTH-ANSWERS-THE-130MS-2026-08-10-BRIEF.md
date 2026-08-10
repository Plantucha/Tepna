<!--
  PAT-SAWTOOTH-ANSWERS-THE-130MS-2026-08-10-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-10 · **Consolidated-into:** `PAT-COMPENDIUM-2026-08-10-BRIEF.md` · **Created:** 2026-08-10 · **Answers:** `PAT-UNEXPLAINED-130MS-DISCOVERY-2026-08-09-BRIEF.md` · **Affects:** findings only — **no code changed**

# The ~130 ms was the acceptance window. `450/√12 = 129.90`.

> ⚠️ **SUPERSEDED 2026-08-10 (same day).** Its §2 left the drift's cause unestablished and nominated
> `Tepna_*_CLOCK.csv` as the next measurement — that file is the host's own NTP discipline log, not a
> host↔device record, so the nomination was wrong. The cause was found hours later: ECGDex's `fs`
> derivation rounded to the nominal 130 (fixed in #1121). See `PAT-COMPENDIUM-2026-08-10-BRIEF.md` §4.1.

`PAT-UNEXPLAINED-130MS-DISCOVERY` asked what the unexplained ~130 ms of PAT scatter is. It is not
scatter. It is `pat-align.js`'s own physiological window, marginalised over a slow inter-device
timebase drift that sweeps the entire cardiac cycle.

Two measured facts compose into the whole number:

1. The ECG↔PPG offset is a **sawtooth of peak-to-peak ≈ one RR interval** — measured 821–1162 ms
   (median **1064**) on **10 of 10** usable box nights. It ramps monotonically for tens of minutes,
   wraps, and ramps again.
2. `coupleRtoFoot` accepts only `PHYS = { LO_MS: 200, HI_MS: 650 }` — a **450 ms** slice of that
   sweep. A ramp crossing a window fills it **uniformly**, and a uniform distribution on width `w`
   has SD `w/√12`.

```
450 / √12  =  129.90 ms          reported PAT beat-to-beat SD: 131–136 ms      ratio 1.01–1.05
```

This is the discovery brief's own §6 trap — *"an 'achieved' 20 ms turned out to be exactly 70/√12"* —
arriving through the **data** rather than through a hand-chosen window. The brief warned to divide by
`w/√12` and the warning was correct; nobody had applied it to `PHYS` itself.

**Every PAT SD in this repo measures the acceptance window, not physiology.** That includes the
84–99 ms attributed to PTT variability, which the discovery brief had already downgraded to
*unfalsified, not established* for a different reason (phone capture).

---

## 1 · What the honest number is

Inside a 5-minute bin the ramp moves only tens of ms, so the within-bin spread is a real
beat-to-beat measurement. Over the same 10 nights, from `IQR/1.349`:

| | median | range |
|---|---|---|
| within-bin σ | **68 ms** | 46 – 94 |

That is the first PAT scatter figure on this corpus that is not a window artefact. It is still
**4–8× the published 8.22–15.4 ms** (PLOS One 2024, `10.1371/journal.pone.0298354`), so there is
real instrument work left — but the gap is now a factor of five, not a factor of twenty, and it is
a number that can be driven down and checked.

Beat pairing is **not** among the causes. Paired R-peak to nearest PPG peak over 60-beat runs, the
PPG index step is **1 on every beat**; per-10-minute beat counts agree to ±1 in 30 of 44 bins; the
two devices' HR curves cross-correlate at **r = 0.988 at lag 0**. The two records see the same heart,
beat for beat. What differs is only where that beat is placed on the clock.

## 2 · The drift is real, and it is NOT either device's crystal

After unwrapping the sawtooth, the residual rate mismatch is **−274 to +319 ppm**, and **its sign
changes between nights**. Neither property fits a crystal:

- Each file's own `DexClock.hostAxis` reports ECG **−14 … −30 ppm** and PPG **+7 … −99 ppm**, with
  per-night differences of 2–18 ppm. An order of magnitude too small, and consistently signed.
- A crystal error does not change sign from one night to the next on the same two devices.

So a ~100–300 ppm relative rate error survives host-axis discipline on both legs. **What produces it
is not established by this work** and is the obvious next question.

## 3 · RETRACTED — the PPG host-axis correction is not the culprit

On **2026-08-03 alone**, replacing `ppgdex-dsp.js`'s host-corrected `relSec` with the raw device axis
took within-bin σ from **79 ms to 25 ms** and the residual ramp from 101 to 31 ppm. That is a large,
clean single-night effect and it is what this investigation first concluded.

**The corpus refutes it.** Across the 10 usable nights the raw device axis is better on 4, worse on 3,
and indistinguishable on 3 — median σ **68 → 63 ms**. On 2026-08-01 and 2026-08-02 raw is markedly
*worse* (75 → 124, 60 → 99). Toggling the **ECG** axis changes nothing anywhere (79 → 79, 25 → 23 on
08-03), which independently re-confirms the `#1121` retraction.

Recorded here rather than deleted because the failure mode is this repo's recurring one: a large
effect on one night, in the direction being looked for. `brief-numbers-need-remeasuring`.

## 4 · Method, so it can be re-run and disagreed with

- **Corpus:** `boxcaps/` — box captures only, where `hostAxis.independent` is true. 15 nights have
  both `Polar_H10_*_ECG.txt` and `Polar_VeritySense_*_PPG.txt`; **5 are excluded** — 2026-07-26,
  -29, -30 have **zero** overlapping bins (the two files do not cover a common wall interval at all,
  itself worth a look), and 2026-07-25 / -31 have 12 and 7 bins.
- ECG R-peaks: `ECGDSP.parseECG → bandpass → detectPeaks`, times via `tMsAt`. PPG peaks:
  `PPGDSP.detectChannel(ch[0])`, times via `relSec`. Per the fleet rule, HR is derived from the raw
  waveform on both legs, never from a device `_HR.txt`.
- Offset series: for each R-peak, the signed gap to the **nearest** PPG peak — no window, no
  direction, so the measurement cannot inherit `PHYS`. Median and IQR per 5-minute bin, ≥50 beats.
- Peak-to-peak of the bin medians is the sawtooth amplitude; `IQR/1.349` is the within-bin σ; the
  ramp is a Theil-Sen slope over the bin medians unwrapped against the local RR.
- ⚠️ **Unwrapping beat-by-beat does not work** and will report a spurious ~1.5 cycles: beat-to-beat
  noise (±50 ms) against RR variability breaks the half-cycle test. Unwrap the 5-minute medians.

## 5 · What follows

Each is its own brief; none is started here.

1. **Find the 100–300 ppm.** It survives both host axes and changes sign nightly. The box writes
   `Tepna_*_CLOCK.csv` per session — a direct host↔device record that this work never opened, and
   the cheapest next measurement.
2. **`PHYS` cannot stay as it is.** A 450 ms window over a full-cycle sweep admits a uniform slice
   and reports `w/√12` forever. Whether it widens, narrows, or is replaced by drift removal is a
   design decision, but a fixed window over a drifting offset can only ever measure itself.
3. **Then re-derive the 68 ms.** With the drift removed rather than binned around, the within-bin
   figure becomes a whole-night figure and can be compared to the literature honestly.
4. The three zero-overlap nights (§4) mean 3 of 15 box nights produced no simultaneous ECG+PPG at
   all. That is a capture question, not an analysis one.

## Cross-references
- Answers: `PAT-UNEXPLAINED-130MS-DISCOVERY-2026-08-09-BRIEF.md` (§5.1's "wandering phase" was the
  right lead; §5.3's "`PHYS` may be wrong for this geometry" was right for the wrong reason — the
  problem is not the bounds' *placement* but that a fixed window over a sweep measures its own width).
- `PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md` — its SD figures are window artefacts.
- `JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08-BRIEF.md` — the two-population question there is this
  sawtooth's wrap, seen without the ramp.
- Clock Contract §7 (`CLAUDE.md`) — `hostAxis`, and why `.ppm` is a diagnostic and not a correction.
