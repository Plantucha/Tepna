<!--
  PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-02 · **Follows:** `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02-BRIEF.md` §F3-ter, `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §5 · **Affects:** no code yet — a capture decision and one measurement

# PAT has never been alignment-limited by precision. It is limited by there being **no valid non-beat anchor** for the ECG and PPG streams on this corpus.

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

## 7 · Done when

- [x] §F3-ter's "PAT is not alignment-limited" retracted, with the per-block-fitting mechanism named and the
      406–498 ms median-lag tell recorded so the same harness is not rebuilt.
- [x] PAT re-run on a **clean single-segment sleep night** (2026-07-09: 6.86 h, zero gaps, not drawn),
      selection criteria stated before the night was picked.
- [x] Established that the **ACC anchor does not transfer** to the ECG/PPG streams — 3.40 s apart, not a comb
      alias (3.42 RR), and it fails to lock PAT where a single global offset nearly does.
- [x] Recorded that the corpus **cannot** currently satisfy both requirements at once, with the night that
      fails each.
- [ ] **Route 2** — per-characteristic arrival-latency measured on a phone night, ACC anchor corrected by it,
      PAT re-run under the corrected anchor.
- [ ] **Route 1** — a single-segment box night captured, if the adapter fault allows.
- [ ] A PAT verdict that survives an anchor NOT derived from beats. Until then PAT is **open** — neither
      demonstrated nor excluded — and no brief should record it as settled in either direction.
