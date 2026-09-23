<!--
  COUPLING-BOUT-FPR-2026-09-20.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — re-measure if `event-coupling.js`'s null or the SHHS1 corpus changes) · **last-verified:** 2026-09-20

# The event-coupling null under real OSA bout structure — DEEP-AUDIT-V F8, measured

**Question (F8).** `event-coupling.js` nulls a coupling with circular time-shift surrogates at ±5–17 min.
Two independent streams whose *rates* are both modulated by one shared process at that same scale
defeat the shift — A's events are carried out of the bouts B's events sit in, the null hit rate drops,
and a coupling is reported that the bout structure manufactured. A synthetic bout profile gave
**36–53 % residual FPR** (DEEP-AUDIT-V punch-list 2.2). The trio corpus is a healthy sleeper and the
committed CPAP night carries 20 events, so no local night could say whether that profile is real. SHHS1
carries 5136 scored, untreated OSA nights; the DUA was signed 2026-09-20.

**Instrument.** `tools/nsrr-coupling-bout-fpr.mjs` — annotation XML only, no EDF. 400 hash-shuffled
records, 10 trials each (30 for the two bout-scale confirmations), Integrator config throughout
(window −15 s/+60 s, `shiftsForAlpha(0.05)` = 80 shifts, coverage = the scored span, only
*usable* measurements counted). Bands were registered in the tool header before the first run.
`--selftest` plants the mechanism (two draws from one 10-min bout profile fool the null; one modulated
stream against a uniform one does not) and fails if it cannot see it.

## The result is a curve, not a number

| profile smoothing σ | what the shared profile carries | L3 shared-λ FPR | per-record median | AUC fano10 / rateLift |
|---|---|---|---|---|
| 90 s | every event as a ~3-min feature | **87.6 %** | 90 % | 0.985 / 0.993 |
| 3 min | clusters of a few events | **57.7 %** | 60 % | 0.817 / 0.906 |
| **5 min** | **bouts (the F8 scale)** | **30.0 %** (31.0 % at 30 trials) | 30 % · IQR 23–40 | 0.641 / 0.673 (0.763 / 0.687) |
| 10 min | long bouts | **13.0 %** (12.9 %) | 10–13 % · IQR 7–17 | 0.576 / 0.658 (0.651 / 0.622) |
| 20 min | REM-period scale | **6.9 %** | 0 % | 0.491 / 0.717 |

Held across every row: **L2 real-crossed 4.4 %** (resp of record *i* × desats of record *j* — real
clustering on both sides, no shared modulation: the null is exact, as designed) · **L3c control
4.2–5.3 %** (one modulated stream only) · **L1 real-paired 100 %** (apnea → desat; the primitive's reach
on real OSA is complete).

Real OSA event streams ARE bouted: median Fano factor of 10-min counts **3.73** (Poisson = 1), over
390 records.

## What it decides

1. **F8 reaches on real profiles.** At the bout scale the brief named (5–20 min features) the FPR is
   **13–30 %**; the synthetic 36–53 % corresponds to a 3–5 min shared feature. The worry was real and
   is now bounded per scale instead of quoted as one range.
2. **The per-record density diagnostic the punch list prescribed does NOT discriminate, and is not
   shipped.** At σ ≥ 5 min neither `fano10` nor `rateLift` clears the pre-registered AUC 0.8 (best
   0.76 at 30 trials); FPR correlates with either at r ≈ 0.3 and with the event count at r ≈ −0.08.
   The vulnerability is a property of the null-and-scale, roughly uniform over nights — a flag that
   ranked nights by it would tell a reader that *this* night is safe when the next one at the same
   statistic is not. The band said what to do with an AUC below 0.8, and it is done: say so.
3. **The p-value is untouched**, as the punch list required. What a reader of `apneaCoupling` owes
   themselves is the scale statement: *a coupling verdict at a 75-s window is not distinguishable from
   two streams sharing a rate process finer than the ±5–17 min shifts.* For the Integrator's desat ⟷
   HR-surge pair this is mostly moot — both are driven by the same apneas, and that is a coupling —
   but for any pair whose only link is a shared bout process (position, REM), a significant lift at
   this window is the inherited kind about 30 % of the time.

## What it does not decide

- Whether two REAL streams on a real night share modulation at 2–5 min *without* an event-level link.
  L3 shares the *profile* with a real night, not the night; a real desat stream is caused by the resp
  stream, so a real-paired FPR does not exist. This is the closest a true null gets to real bout
  structure and it is stated as that.
- The remedy. A multi-scale or local-block surrogate would be a *second null*, which the punch list
  forbade for this unit; it is sized as its own work if anyone wants it, with this curve as the target.

## Residue

- `2026-09-20-event-coupling-header-lacks-shared-modulation-caveat` — the module's header lists four
  caveats (wrap · coverage · saturation · resonance) and not this one. A comment edit to a module in
  Integrator's compute closure moves `computeHash`, so it rides the next Integrator compute-path change
  rather than spending a re-verify on a comment.

⚠️ P5: measured internally under the owner's 2026-09-12 ruling; not for external quotation.
