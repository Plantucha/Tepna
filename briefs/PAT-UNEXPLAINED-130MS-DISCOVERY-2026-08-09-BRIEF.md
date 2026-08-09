<!--
  PAT-UNEXPLAINED-130MS-DISCOVERY-2026-08-09-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-09 · **Follows:** `PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md` · **Affects:** investigation only — **no code change is in scope**

# ~130 ms of PAT scatter is unaccounted for. Find out what it is.

**DISCOVERY ONLY — no code changes, no fixes, no PRs.** The deliverable is a written finding.

## 1 · The question

Pulse Arrival Time (ECG R-peak → PPG foot) on this corpus measures a beat-to-beat SD of
**131–136 ms**. The published figure is **7.21 ms** with an optimised fiducial and **8.22–15.4 ms**
with traditional ones, of which **3.44–5.12 ms** is respiratory modulation (PLOS One 2024,
`10.1371/journal.pone.0298354`; fiducial ranking in Physiol. Meas. 2019, `10.1088/1361-6579/ab009b`;
intersecting tangents RMSE 5.69 ms). This repo's **own** earlier run
(`PPG-SAMPLE-RATE-AND-PAT-2026-08-03-BRIEF` §3) reached **18.68 ms** at 176 Hz with the machinery
still in the tree.

So the target is tens of milliseconds, the instrument has been close before, and **~130 ms is
unexplained**. That is the object of this investigation.

## 2 · Use the BOX captures. The phone corpus cannot answer this.

- **Box:** `boxcaps/` locally, or `/srv/tepna/captures` on the vigil box (`ssh vigil@192.168.0.41`).
  16 nights, 2026-07-25 → 08-09, full waveforms plus `Tepna_*_CLOCK.csv`.
- **Verified 2026-08-09:** `DexClock.hostAxis` returns `independent: true` on **30/30** stream-nights
  (residual spread 318–2968 ms). A real second clock exists on these nights.
- **Phone** (`/…/Ecg nightly`, and every `uploads/trio/` night before 2026-07-16) reports
  `independent: false` — host-column residual spread **0.98 ms**, exactly one stamp quantum, because
  the capture app derived the host column from the device stamp. `pat-gate.js` refuses it outright.

⚠️ **Every historical PAT verdict in this repo was computed on that phone data.** They are therefore
**unfalsified, not established** — including the 84–99 ms attributed to PTT variability. Do not treat
them as a baseline to reproduce.

## 3 · Placement — wearer-confirmed, and a prior analysis was invalidated by getting it wrong

| device | site |
|---|---|
| Polar H10 | **chest** (ECG) |
| Wellue O2Ring | **right index finger** |
| Polar Verity Sense | **LEFT ANKLE** — *not* the arm |

See `PAT-SENSOR-PLACEMENT-CORRECTION-2026-08-04-BRIEF`: *"a result was rejected on an anatomy it did
not have."* Chest→ankle is a ~100–120 cm path (the basis of baPWV). `pat-gate.js`'s 60 ms bar was set
assuming an arm — **question whether that bar is the right yardstick at all**, rather than assuming it.

## 4 · Ruled out BY MEASUREMENT — do not re-derive, but do feel free to challenge

| candidate | measured |
|---|---|
| host clock | chrony **24 µs RMS** (vigil is stratum 2 off a local stratum-1 at .123) |
| host scheduling / GIL / disk / CPU governor | SD **0.073 ms**, max 0.46 ms — sampled **during live capture**, governor `powersave` at 68 % clock |
| sampling quantisation | 2.2–5.2 ms |
| a constant timebase offset | SD stays flat **102–136 ms across a ±600 ms offset sweep** — no shift rescues it |
| BLE jitter | finger and ankle equally affected |
| fiducial jitter | **19.4 ms, measured** (§5.3) — ~2 % of the variance |

## 5 · The strongest leads

### 5.1 · CONFIRMED 2026-08-09 — the lag is a SAWTOOTH: it drifts and WRAPS mod one RR

Median lag per 15-min bin over `2026-08-03` (475 min, ~780 beats/bin) walks monotonically and resets:

```
t+0   1024 ms   t+60   272   t+120  313   t+180 1094 (max)   t+195   98  <- WRAP
t+15  1032      t+75   238   t+135  519   t+255 1090         t+360  101  <- WRAP
t+30   874      t+90   184   t+150  684   t+345 1058         t+375   71
t+45   598      t+105  145   t+165  870
```

Decomposed:

| term | |
|---|---|
| **drift** — SD of the bin medians | **385 ms** (dominant) |
| **local** — median within-bin SD | 139.7 ms |
| clean bins (no wrap inside) | **52–96 ms** |
| bins straddling a wrap | 322–551 ms |

So the whole-night 131–136 ms is largely **aliasing of a drifting relative phase**, not beat physiology.
⚠️ **But it is TWO terms, not one:** ~52–96 ms of local scatter survives inside clean bins, still 4–10×
the literature and well above the 19.4 ms measured fiducial. Explaining the drift does not close the
budget. Do not stop at the drift.

⚠️ **A `0.9835` beat-COUNT ratio is not a per-beat rate divergence** — it is 1.65 % missed detections.
An analysis that multiplies it by the beat count to derive the drift reaches roughly the right number
(396 ms vs the measured 385) by an invalid route. Measure the walk; do not derive it from the ratio.

### 5.1a · The original statement of this lead, kept for the record

ECG 24 447 R-peaks against Verity 24 043 feet — count ratio **0.9835**. Yet only **18–37 %** of
R-peaks find a foot inside a 450 ms window. The feet exist in nearly the right number and are not
where the window expects them. Compare the reasoning behind `beat-trains-align-only-mod-rr`.

### 5.2 · The O2Ring's feet are UNIFORMLY distributed against the R-peaks

The histogram of nearest-foot-after-R is **flat** — ~1000 counts per 50 ms bin from 150 ms to 1150 ms.
Uniform means **no temporal relationship to the cardiac cycle at all**. Its foot-to-foot SD is
**1714 ms** against the ECG's RR SD of **101.8 ms** on the same heart. The Verity is markedly better:
genuinely bimodal, per-LED foot-to-foot SD 118–121 ms.

**No physiology produces a uniform arrival distribution.** This is a software signature — detection or
timestamping — and it is the largest single unexplained effect. Start here. Note `_PPG.txt` from the
ring is **single-channel**, and there is an **unread `_PPG2W.txt`** (second wavelength) beside it.

### 5.3 · `PHYS = [200, 650]` may be wrong for this geometry

The Verity's primary mode sits near **~175 ms**, *below* the window's floor, so most beats are rejected
as unphysiological and the survivors are drawn from the valley between two modes. That constant lives
in `pat-align.js` and is inherited by `pat-matchrate-strict`, `pat-feasibility-worker`, and every
verdict in the tree.

## 6 · Traps. Each cost real time on 2026-08-09; please do not re-pay them.

- **`pat-matchrate-strict.mjs` silently falls back to the Verity** when it cannot align the ring (the
  ring has no accelerometer). It answers the *ankle* question while appearing to answer the finger one.
- **`tch-reference-validation.mjs` has `CLIP_MIN = 30`** — it analyses only the first 30 minutes of
  each night. Read a tool's constants before trusting its output.
- **Narrowing the pairing window fakes a good result.** A uniform distribution on a width-`w` window
  has SD `w/√12`. An "achieved" 20 ms turned out to be exactly `70/√12`. **Always report
  `measured_SD ÷ (w/√12)`** — a ratio near **1.00** means you measured your own window, not physiology.
- **`consensusBeats` degrades the feet**: per-LED foot-to-foot SD 120.9 / 118.8 / 118.0 ms, consensus
  **133.2 ms**, worse than the worst individual channel. The Verity's three LEDs are the **same green
  wavelength** differing only in SNR, so differencing two **cancels the beat entirely** — physiology,
  PEP, PTT, HRV all drop out — and a three-cornered hat over them measures **fiducial jitter directly**.
  That is how §4's 19.4 ms was obtained. Treat each LED as an independent sensor; do not rank or select.
- **`ppgFootTimes` picks its reference channel by PEAK COUNT**, which rewards over-detection.
  `PPGDSP.pickChannel` (SNR-ranked) exists and is unused.
- **A closure test of the form `lag(A→C) = lag(A→B) + lag(B→C)` is a TAUTOLOGY** when both paths select
  the same beat (verified 2001/2001 on a synthetic train). It reports ~0 ms for *any* data.
  `tools/pat-three-corner.mjs` retains one only as a documented warning against itself.
- **The positive control had never executed.** `tools/pat-ppg-ppg-control.mjs` referenced `RE_WRIST`,
  defined in no revision, added by #936 under a `docs(pat):` prefix. Fixed 2026-08-09 — but it means no
  PAT verdict here was ever backed by its own control.

## 7 · Where to look

- `pat-align.js` (`coupleRtoFoot`, `PHYS`) · `pat-gate.js` · `pat-feasibility-worker.js`
  (`ecgRpeakTimes`, `ppgFootTimes`) · `ppgdex-dsp.js` (`detectChannel`, `consensusBeats`, `refineFeet`,
  `detectBeats`) · `ecgdex-dsp.js` (`detectPeaks`).
- `tools/pat-per-led.mjs` · `pat-literature-spec.mjs` · `pat-window-scaling.mjs` ·
  `pat-hrv-windows.mjs` · `pat-three-corner.mjs` — all take `--dir <captures root>`.
- Briefs: `PAT-VERDICT-CONSOLIDATED-2026-08-04` · `PAT-NO-VALID-ANCHOR-2026-08-02` ·
  `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02` · `PPG-SAMPLE-RATE-AND-PAT-2026-08-03`.
  **Treat their numbers as hypotheses** — several failed re-measurement on 2026-08-09.

## 8 · Done when

- [ ] A written finding: what the ~130 ms is, with the measurement that shows it — **or** a ranked list
      of candidates with the experiment that would discriminate between them.
- [ ] What was ruled out, and how it was ruled out, stated explicitly.
- [ ] Any existing brief number that fails to reproduce is named as such. That has happened repeatedly
      in this family and going unrecorded is how it recurs.
- [ ] **No code changed.** A fix, if one is warranted, is spawned as its own executable brief with its
      own gates.
