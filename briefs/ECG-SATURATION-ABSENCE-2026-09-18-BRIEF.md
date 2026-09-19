<!-- Copyright 2026 Michal Planicka -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

**Status:** PROPOSED — 2026-09-18 · **Created:** 2026-09-18 · **Supersedes-row:** 2026-09-18-ecg-saturation-unflagged

# A fix keyed on the CAUSE it was written for does not generalise to a second cause with the same consequence

**Measurement complete; no threshold proposed and no remedy taken.** Promoted from residue row
`2026-09-18-ecg-saturation-unflagged`, which turned out to be ≥ one work-unit and to be **wrong in a
useful direction** — the row said "ECG saturates and nothing flags it", and something flags half of
it by accident.

## 1 · The thesis, which outlives the ECG instance

`buildNN`'s §∅ gap-straddle rule is **correct and works**. It keys on **elapsed time**: an inter-beat
interval longer than `GAP_S = 10 s` is `spansGap` and is excluded as an *absence* rather than repaired
as a corrupted beat. Its own comment records the defect it fixed — *"each a multi-second absence
replaced by a plausible ~1 s heartbeat that then fed rMSSD and SDNN as if it were a measurement."*

**It was calibrated for DROPOUTS.** A saturated stretch is just as much an absence, and produces a
*shorter* span — so it slips under the cut and is median-filled. Same defect, second entry path.

> **A fix keyed on the CAUSE it was written for does not generalise to a second cause with the same
> consequence.** The rule is not wrong; its *domain* was drawn around the cause that motivated it.

## 2 · What the guard is, and the two ways it fails

`ecgdex-dsp.js:948-961`, per-beat SQI, two legs:

| leg | rule | fires on the observed population |
|---|---|---|
| rail | `|int16[j]| > 31000` | **0 of 112** |
| flat | `maxFlat > 0.2·fs` (26 samples at 130 Hz) | 112 of 112 — *where it looks* |

**2a · The rail leg is gated above the phenomenon.** It looks for saturation at 31000; the H10
saturates at **~18,100–19,500**, at a **per-file** rail (29 distinct values across 62 files). It cannot
fire on real H10 clipping and never has. Third instance today of a detector configured past the thing
it exists to find, after the sidecar's `min_run=200` and `class_b_runs` having no mid-range rule.

**2b · The flat leg is PEAK-CONDITIONAL, and that is the sharper failure.** It examines only ±130 ms
around a **detected** peak — and saturation is precisely what suppresses detection. Measured over 112
runs ≥200 samples across 597 deduplicated files:

    a detected peak is near  55     <- the guard looks
    no detected peak near    57     <- the guard never looks

**A guard whose coverage is decided by the very failure it guards against.** The 55 it catches, it
catches through the flat leg by accident of geometry, not by the leg meant for this.

## 3 · The consequence — 28 absences median-filled

For the 57 the guard never examines, the bracketing beats yield ONE RR interval spanning the stretch.
**55 of 57 do** (2 have no bracketing beat). Span: **min 3,570 ms · median 9,818 · max 15,698** — all
55 over 2,000 ms, 50 over 5,000. A 9.8-second "beat" is 6 bpm.

Split at `buildNN`'s own cut:

| | n | fate |
|---|---|---|
| **> 10 s** | 27 | `spansGap` → correctly **excluded** as an absence |
| **2–10 s** | **28** | `rangeBad` → **median-filled**, an absence treated as a corrupted beat |

## 4 · 🔴 WHICH REMEDY IS BLOCKED — checked, not assumed

An earlier report from this session said both remedies "interact with the deferred finger-off
capture". **That was a generalisation and it is wrong.** Checked:

| remedy | blocked by the capture? | actual constraint |
|---|---|---|
| **rail leg (`31000`)** | **NO** | `31000` has exactly ONE live site (`ecgdex-dsp.js:958`), ECG-only, no PPG path. The capture answers what the **O2Ring's PPG** rests at — different device, signal and phenomenon. **Independently fixable now.** |
| **`GAP_S`** | **NO** — but coupled | ECG-local in code, yet `ppgdex-dsp.js:4108` holds `PPG_CVHR_GAP_S = 10; // ECGDex GAP_S — one cut, so the two nodes' indices stay comparable`. **Two constants held equal by a COMMENT, not a shared symbol.** Moving one silently breaks a documented cross-node invariant. |

So neither is gated on the capture; one is a single-site fix and the other is a two-node threshold
decision. That distinction was invisible until the dependency was checked rather than inherited.

⚠️ **The rail leg's replacement is NOT a better constant.** The rail is a **per-file** quantity — 29
distinct values here — so any global number repeats the defect at a different magnitude.
`nightqc.rail_value` already solves exactly this (the histogram spike nearest the edge, not the edge).
Naming the mechanism, not proposing the parameter.

## 5 · ⚠️ Caveat that bounds §2b, stated unsoftened

The 55/57 split uses `detectPeaks` over the full record. **If detection is itself perturbed by the
saturation upstream of where this measured, the split could move.** The direction cannot — a saturated
stretch with no beats still yields a spanning interval — but the magnitude is unproven.

## 6 · Done when

- [x] Existing guard identified before proposing anything (two of three picked-up rows today were stale)
- [x] Detection rate vs CONSEQUENTIAL rate separated — 112 detected, 55 spanning, 28 median-filled
- [x] Each remedy's dependency **checked** rather than inherited (§4)
- [ ] Box census confirming 28-of-55 beyond these 597 files — **box lane**, read-only
- [ ] `GAP_S`: a threshold decision across TWO nodes — **owner**, and it must move `PPG_CVHR_GAP_S` with it or state why not
- [ ] rail leg: replace the global constant with a per-file rail — **unassigned, and not blocked**

**No threshold is proposed here.** 28-of-55 is a rate on 597 files and wants the census before anyone
moves a number.

**Fleet-Session:** Magpie
