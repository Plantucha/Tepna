<!--
  O2RING-HOURLY-HR-ARTIFACT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-02 · **Created:** 2026-08-02 · **Affects:** `oxydex-dsp.js`, `tests/dex-tests.js`

# The vendor confirmed a firmware artifact. We were already rejecting it — and deleting a third of the real arousals to do it.

Wellue confirmed on 2026-05-14 (owner correspondence) a **timer-driven firmware routine near the top of
each clock hour** that transiently double-counts cardiac cycles: HR steps **+21…25 BPM in one 1 Hz
sample**, SpO₂ flat, motion zero, plateau 8–13 s, then a linear ramp down. Their guidance was to ignore
±60 s around each hour. Firmware 1.0.5.0, device O2Ring-S 2100.

## 1 · It is in our corpus, and it stops on 2026-05-27

Every 1-sample HR jump ≥15 BPM across the 37 committed O2Ring CSVs, bucketed by seconds past the hour:

- **62.7 %** fall within 60 s of a clock hour — against a **1.7 %** uniform-chance expectation.
- Present on nights **2026-05-03 → 2026-05-27**; **absent from 2026-05-28 onward** (one stray jump on
  06-18, not hour-aligned). That is ~2 weeks after the report, consistent with a firmware fix shipping.

The four events in the owner's report reproduce exactly: 01:01:51 51→76, 02:00:59 49→71, 03:00:43
48→71, 04:00:26 55→76.

## 2 · What it does NOT touch — checked, because the obvious guess was wrong twice

- **Timestamps are undisturbed.** Zero non-1-second steps across an affected night, and each spike sits
  on a normal 1 s step. This is a **different fault** from the drawn-axis problem
  (`WEARABLE-HOST-AXIS-FOLLOWUPS` §F1) and must not be conflated with it.
- **No fixture is affected** — both committed O2Ring CSV fixtures are June (06-12, 06-24).
- **The trio/clock corpus is June–July**, entirely after the window.
- **`nights-icc-analysis.html` / `odi-bias-analysis.html`** quote 2026-05-11…15 and use HR heavily,
  which looked like live exposure — but those are **synthetic scenario nights** (`story: 'CPAP started
  (intervention)'`, hand-authored `rmssd`/`rsaGain`), not ingested recordings. Cleared.

## 3 · The correction: it was never reaching `hrSpikes`

The intuitive reading of the raw CSV says the artifact should be counted as an arousal — it clears
`HR_SPIKE_MIN_PEAK`, motion is 0, and the 8–13 s plateau passes `sustain ≥ 5`. **That reading is wrong**,
and this brief nearly shipped on it. `cleanArtifactHR` runs FIRST and removes the impossible *samples*
(`HR_ARTIFACT_JUMP` = 20 BPM/s unconditionally, 15 within ±2 min of an hour), so `detectSpikes` normally
never sees the excursion. Measured on a planted night: **18 samples cleaned, 0 spikes detected.**

There were **three** layers, not one, and the first already worked.

## 4 · The real defect: the second layer deleted genuine arousals

`filterArtifactSpikes` dropped **every** detected spike within ±2 min of a clock hour — the vendor's
advice, applied at spike level behind a sample cleaner that had already done the job. Measured across
the 37 nights (79 detected spikes on raw rows; "artifact" = an onset no heart can produce):

| rule | artifacts missed | **genuine arousals deleted** |
|---|---|---|
| ±2 min clock window | 1 of 44 | **11 of 35 — 31 %** |
| onset ≥ 15 BPM/s | 0 of 44 | 0 of 35 |

±4 minutes of every hour is **6.7 % of the night**, so the window was discarding real events for their
position on the clock — and still missed an artifact that drifted outside it.

**Shipped:** the criterion is now the onset rate. `clockAligned` is still computed and reported
(`stats.artifactSpikesClockAligned`), because the hourly pattern is the signature that found this — but
it is evidence, never the criterion. The rejection is counted, never silent.

**Why a spike-level test at all, given `cleanArtifactHR`:** it catches the residue that pass misses —
an onset in [15, 20) BPM/s occurring *away* from a clock hour, where the soft clock-gated threshold does
not apply. That is exactly the 1-of-44 the window rule missed.

## 5 · The control that makes the threshold honest

On affected nights, "impossible onset" *is* the definition of artifact, so "0 missed" is circular. The
non-circular evidence is the **post-firmware-fix nights**: 13 detected spikes, onset median 5 BPM/s,
**max 7**. A 15 BPM/s bar has better than 2× headroom over the fastest genuine arousal this device has
ever produced, and rejects nothing on that control.

> An earlier version of this measurement read "max onset 6 BPM/s" on affected nights, which contradicted
> the +25 BPM step measured directly from the CSV. The window was misaligned — `detectSpikes` fires
> *before* the rise via its 12-sample lookahead, so the onset scan has to span the whole lookahead. A
> control that disagrees with a direct measurement is the control being wrong until proven otherwise.

## 6 · Done when

- [x] Artifact confirmed in our own data (62.7 % vs 1.7 % chance) and its end date established.
- [x] Blast radius checked and **cleared** — fixtures, trio corpus, and the two analyses that quote May.
- [x] Established that `cleanArtifactHR` already neutralised it, correcting this brief's own premise.
- [x] The ±2 min spike filter replaced by the physiologic onset test; 31 % genuine-arousal loss removed.
- [x] Gated — including the regression itself: the new test **fails against the old rule** (verified by
      restoring it), so it is evidence rather than a gate that has never fired.
- [x] 4929/4929 assertions, zero skips · typecheck · biome · all three drift guards clean · no export
      byte moved (diagnostics stay inside the detector, so committed fixtures reproduce exactly).
