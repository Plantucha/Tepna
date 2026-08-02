<!--
  PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-02 · **Follows:** `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` §F3-ter, `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §5 · **Affects:** no code yet — a capture decision and one measurement

# PAT has never been alignment-limited by precision. It was limited by there being **no valid non-beat anchor** for the ECG and PPG streams — so one was derived, and PAT came out at **218 ms**.

> **RESOLVED 2026-08-02 (§7).** The anchor is derivable from the raw columns without touching a beat:
> per-characteristic BLE buffering, `offset_ACC + Δ_Verity − Δ_H10 = −199 ms`. Under it, **PAT = 218 ms
> median with IQR 16–38 ms over hours 0–4**, clearing `pat-gate.js`'s ≤60 ms bar. One parameter is still
> fitted (the −34.5 ppm rate) and §8 explains why it cannot be derived on this tree: **the phone
> `Phone timestamp` column is not an independent clock** — 76/76 files agree with the device to 1 ms over a
> whole night. Route 1 (a box night) is now needed only to derive that last rate.

Three PAT verdicts have now been published from this repo and two of them were wrong. This brief exists
because the third one — reached on the cleanest night in the corpus, with the anchor held fixed exactly as
prescribed — **failed in a way that indicts the prescription rather than PAT.**

## 1 · What was retracted, and why the tell was visible all along

`WEARABLE-HOST-AXIS-FOLLOWUPS` §F3-ter concluded **"PAT is not alignment-limited"** — 130–215 ms residual
IQR against a 60 ms bar, unchanged by the host-axis fix, therefore no further clock work would help. It
claimed to close `PAT-UNDER-PERBLOCK-ALIGNMENT` §5 as a NO.

**That harness fitted a free offset per block.** A per-block offset absorbs exactly the quantity PAT is, so
the residual it reports is what is left *after* PAT has been removed. The tell was inside its own results
table and went unread: a **median lag of 406–498 ms** is not physiological for an arm site (arm/wrist PAT
is 200–250 ms; even ankle is 300–400).

Retracted. `PAT-UNDER-PERBLOCK-ALIGNMENT` §5 is **re-opened**.

## 2 · The clean single-segment night — selection, not convenience

The prior re-run happened on **2026-07-26**, which on inspection is a **21-hour daytime-inclusive capture:
34 ECG fragments, 18 742 s (5.2 h) of gaps**, including single holes of 2.6 h and 1.7 h. Hour-bucketed PAT
across that is meaningless. Selection criteria were therefore stated first: one continuous ECG fragment,
one continuous PPG fragment, multi-hour overlap, nocturnal, no drawn axis.

**2026-07-09** is the best night the corpus contains, and `WEARABLE-HOST-AXIS-FOLLOWUPS` §F2 had already
independently flagged it as the best of the fold (100 % beat correspondence vs a 24 % chance control):

| | |
|---|---|
| ECG | single fragment, **6.86 h, ZERO gaps**, `hostAxis.applied`, ppm 0.0 |
| PPG | single fragment, 6.86 h, 3-LED, `timingSource: device+host`, **not drawn** |
| overlap | **6.86 h**, starting 21:16 |

The ACC anchor on this night is genuinely stable — unlike 2026-07-26, where the lag walked 0.2 → 1.4 s.
Hourly ACC lag medians: **3.30 · 3.30 · 3.30 · 3.20 · 3.30 · 3.40 · 3.40 s**, 30 of 35 usable windows inside
3.2–3.4 s. The published `driftPpm` is still not identifiable (Theil–Sen 0.0 / OLS 22.8 / endpoint 4.2), but
the *bound* is what a fixed anchor needs: hourly medians move ≤0.2 s across 6.7 h ⇒ **drift < 8 ppm**, i.e.
under 0.2 s accumulated over the night, far below one RR, so no wrap ambiguity.

## 3 · Both anchors run, nothing fitted per block

| hour | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| IQR, **ACC anchor +3.30 s** | 177 | 222 | 284 | 283 | 491 | 592 |
| IQR, **single global beat offset −0.10 s** | **69** | **89** | **69** | **100** | **67** | **138** |

- **The single global offset nearly reaches the bar.** 67–138 ms against `pat-gate.js`'s ≤60 ms — still
  failing, but a real improvement on the retracted 130–215 ms, and it is ONE scalar for the whole night,
  not a per-block fit, so within-hour tightness is not guaranteed by construction. A residual **−28 ppm**
  ramp remains that one offset cannot absorb; `trio-batch`'s own estimator independently reports −24 ppm.
- **The ACC anchor does not lock at all** — 177–925 ms. If +3.30 s were the true clock offset, PAT would
  lock under it. It does not.

## 4 · The finding: the ACC anchor does not transfer to the ECG/PPG streams

The two anchors disagree by **3.40 s**, which PAT (~0.2–0.3 s) cannot explain. It is **not a comb alias**
either: 3.40 s ÷ 994 ms median RR = **3.42**, not an integer, so it is not the beat matcher locking onto a
neighbouring beat.

The mechanism that fits: **ACC and PPG are different BLE characteristics with different batch sizes**, so
the phone timestamps their notifications with different buffering latency. An offset measured ACC↔ACC is
then a valid clock comparison *for the ACC streams only*, and carrying it to PPG imports the difference in
buffering. This is consistent with the standing corpus fact that H10↔Verity sit ~3.3 s apart on **every**
phone-captured night and ~0.2 s on box nights — a capture-path property, not a crystal.

**This invalidates the remedy this brief family prescribed.** "Carry the ACC anchor end-to-end and let no
beat-derived offset touch it" was the stated fix for PAT after the §F3-ter retraction. Executed literally on
the cleanest available night, it produces a *worse* result than the thing it was replacing.

## 5 · Why the existing corpus cannot settle it — the two requirements are mutually exclusive

|  | single-segment? | anchor valid for ECG/PPG? |
|---|---|---|
| phone tree (`Ecg nightly/`, 2026-06→07) | **yes** — median fragment 19 976 s (5.5 h) | **no** — 3.3 s ACC↔PPG characteristic offset |
| box tree (`tepna-smoketest/captures/`) | **no** — 34 ECG fragments on 07-26 | tighter (0.2 s), host-disciplined |

The one box night with a single ECG fragment, **2026-07-30**, has **13 PPG fragments** and its ECG starts
05:29. There is no night in this corpus that is clean on both axes at once. Every previous PAT attempt has
been paying one of these two costs without naming which.

## 6 · The two routes — one is a capture decision, so it is not taken here

1. **Capture a new box night with a stable BLE link.** Single-segment *and* host-disciplined at 0.2 s gives
   a valid non-beat anchor and closes the question directly. Blocked on the adapter fault that fragments
   the Verity — the capture-side issue, not an analysis one.
2. **Characterise the per-characteristic latency** on phone nights: measure ACC vs PPG vs ECG arrival
   timestamps from the SAME device, and correct the ACC anchor by that difference before transferring it.
   This is a measurement the existing corpus CAN support, and it would also retro-validate every ACC-anchored
   number already published.

Route 2 is the cheaper test and does not depend on hardware. It should be done first, and if it explains the
3.40 s it also tells route 1 what to expect.

## 7 · Route 2 EXECUTED — the anchor is derivable, and PAT is DEMONSTRATED

**The derivation.** Within one device, both characteristics carry a `sensor timestamp` from the **same**
device clock, so for characteristic *c*:

```
d_c = host_c − dev_c = L_c − E_device          (L = latency, E = device epoch)
Δ_dev = d_physio − d_ACC = L_physio − L_ACC    (E cancels — pure per-characteristic buffering)
offset_streams = offset_ACC + Δ_Verity − Δ_H10
```

Measured on 2026-07-09, bucketed per host-hour so any device-crystal drift (shared by both characteristics)
cancels bucket-by-bucket:

| | value | stability |
|---|---|---|
| Δ_H10 (ECG − ACC) | **−865 ms** | spread **0 ms** across 7 hours |
| Δ_Verity (PPG − ACC) | **−4363 ms** | spread **0 ms** across 7 hours |
| offset_ACC (`wearable-sync`) | +3300 ms | |
| **derived anchor** | **3300 − 4363 + 865 = −199 ms** | |

Against the beat-derived −100 ms. **Per-characteristic buffering accounts for essentially the whole 3.40 s
discrepancy of §4**, leaving 99 ms — the size of a physiological PAT. The hypothesis is confirmed
quantitatively, from the raw columns, with no reference to beats.

**PAT under the derived anchor.** Only the *rate* is fitted (one DOF for the whole night, −34.5 ppm); the
**level — which IS PAT — comes from the beat-free anchor and is not tuned**:

| hour | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| median (ms) | 193 | 217 | 263 | 216 | 186 | 203 | 433 |
| IQR (ms) | **32** | **16** | **20** | **23** | **38** | 78 | 244 |

**Hours 0–4 clear `pat-gate.js`'s ≤60 ms bar with margin, and the overall median is 218 ms** — squarely in
the published arm/wrist band (200–250 ms). That the level lands there is an independent check, not a fit:
it falls out of `3300 − 4363 + 865`. Hours 5–6 degrade (78, 244 ms), consistent with waking movement.

**PAT is real, locked, and physiological on this night.** The three previous verdicts failed on the anchor,
never on PAT.

## 8 · Why the rate still has to be fitted: the phone tree has NO independent host clock

The one parameter still fitted is the −34.5 ppm rate, and on this tree it **cannot** be derived, because the
`Phone timestamp` column is not an independent clock. Measured as the range of `(host − device)` across each
file, every file ≥30 min in both trees:

| tree | files | median range | files < 5 ms | files > 100 ms |
|---|---|---|---|---|
| **phone** (`Ecg nightly/`) | 76 | **1 ms** (min 1, max 1) | **76 / 76** | 0 / 76 |
| **box** (`tepna-smoketest/captures/`) | 148 | **937 ms** | 0 / 148 | **148 / 148** |

Zero overlap. Two independent clocks cannot agree to **1 ms over 6.9 h** — that is 0.04 ppm, an order better
than the chrony-disciplined box itself measures (22 ppm). So on phone-captured nights the phone column is
**anchored once at stream start and thereafter extrapolated from the device clock**. It is the same class of
fault as the O2Ring's drawn axis (`O2RING-SYNTHESISED-AXIS`), in a column everything has been trusting.

Consequences, none of which require a code change:

- **`DexClock.hostAxis` is INERT on the phone tree, not wrong.** With host ≡ device it correctly measures
  ~0 ppm and corrects nothing — exactly what 2026-07-09's ECG reports (`applied: true`, **ppm 0.0**). The
  host-axis work is real, and its benefit is confined to box-captured nights.
- **The 3.30 s ACC↔ACC "offset" on phone nights is not a clock offset** — it is the difference in when each
  stream's anchor was established at connection. That is why it does not transfer, and why §4's mechanism
  is right for the wrong-sounding reason: the buffering shows up once, at anchoring, not continuously.
- **Only a box night can yield a DERIVED drift**, because only there does an independent host clock exist.
  This is what route 1 is actually for — not a cleaner PAT, but the last fitted parameter.

## 9 · Done when

- [x] §F3-ter's "PAT is not alignment-limited" retracted, with the per-block-fitting mechanism named and the
      406–498 ms median-lag tell recorded so the same harness is not rebuilt.
- [x] PAT re-run on a **clean single-segment sleep night** (2026-07-09: 6.86 h, zero gaps, not drawn),
      selection criteria stated before the night was picked.
- [x] Established that the **ACC anchor does not transfer** to the ECG/PPG streams — 3.40 s apart, not a comb
      alias (3.42 RR), and it fails to lock PAT where a single global offset nearly does.
- [x] Recorded that the corpus **cannot** currently satisfy both requirements at once, with the night that
      fails each.
- [x] **Route 2 EXECUTED** — per-characteristic latency measured (Δ_H10 −865 ms, Δ_Verity −4363 ms, both
      stable to **0 ms** across 7 hours), ACC anchor corrected by it to **−199 ms**, PAT re-run under it.
- [x] **A PAT verdict that survives an anchor NOT derived from beats.** PAT = **218 ms median, IQR 16–38 ms
      over hours 0–4**, clearing the ≤60 ms bar. The level comes from the beat-free anchor and lands in the
      arm/wrist band without being tuned there.
- [x] Established that the **phone tree carries no independent host clock** (76/76 files at 1 ms range vs
      148/148 box files > 100 ms), so `hostAxis` is inert there — and that this is why the rate must be
      fitted on this tree.
- [ ] **Route 1** — a single-segment box night, to DERIVE the −34.5 ppm rate instead of fitting it. This is
      now the only outstanding parameter; blocked on the adapter fault that fragments the Verity.
- [ ] Decide whether `hostAxis` should DECLARE an inert axis (host ≡ device ⇒ "no independent host clock")
      rather than silently reporting ~0 ppm, which is indistinguishable from "two clocks that agree".
